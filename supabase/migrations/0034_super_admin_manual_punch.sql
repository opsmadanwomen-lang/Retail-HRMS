-- ============================================================================
-- Retail HRMS — Super Admin manual Punch In/Out + attendance_records write RLS fix
-- Migration 0034
--
-- FINDING 2 FIX — attendance_records write RLS had no role check:
--   attendance_records_insert_scoped / _update_scoped / _delete_scoped (from
--   migration 0017) only checked `is_super_admin() OR company_id = current
--   company`, with no `current_user_role() <> 'staff'` clause — unlike the
--   sibling tables patched in 0026/0030. Any authenticated user in the same
--   company (including staff) could INSERT/UPDATE/DELETE any attendance_records
--   row directly via the Supabase table API, bypassing the punch RPCs and
--   their business rules entirely. This tightens all three write policies to
--   the same "staff excluded from direct table writes" pattern already used
--   for employee_shift_assignments / employee_weekly_off_history. This does
--   NOT affect attendance_punch_in()/attendance_punch_out()/the new
--   attendance_admin_punch() below — all three are SECURITY DEFINER and have
--   always executed with the owning role's privileges, bypassing RLS, which
--   is why staff self-punch keeps working unchanged.
--
-- FINDING 1 FIX — Super Admin manual Punch In/Out for another employee:
--   New RPC public.attendance_admin_punch(p_employee_id, p_type, p_remark).
--   Mirrors attendance_punch_in()/attendance_punch_out() exactly (same shift
--   resolution, same late/working/overtime formulas from migration 0031) but:
--     - is gated by `if not is_super_admin() then raise exception` INSIDE the
--       function body, so the restriction holds even if a non-super-admin
--       calls supabase.rpc('attendance_admin_punch', ...) directly — it is
--       not a UI-only restriction.
--     - always uses now() for the punch timestamp — no caller-supplied time.
--     - writes source = 'admin' and a remark, and inserts a matching row into
--       the existing (previously unused) attendance_audit_logs table so every
--       admin-initiated punch is traceable to who performed it.
--   No new employee/auth account is created or touched; no historical
--   attendance_records row is modified — only today's row for the selected
--   employee, exactly like the self-service RPCs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Finding 2: tighten attendance_records write policies
-- ---------------------------------------------------------------------------

drop policy if exists "attendance_records_insert_scoped" on public.attendance_records;
create policy "attendance_records_insert_scoped"
  on public.attendance_records for insert
  with check (
    public.is_super_admin()
    or (public.current_user_role() <> 'staff' and company_id = public.current_user_company_id())
  );

drop policy if exists "attendance_records_update_scoped" on public.attendance_records;
create policy "attendance_records_update_scoped"
  on public.attendance_records for update
  using (
    public.is_super_admin()
    or (public.current_user_role() <> 'staff' and company_id = public.current_user_company_id())
  );

drop policy if exists "attendance_records_delete_scoped" on public.attendance_records;
create policy "attendance_records_delete_scoped"
  on public.attendance_records for delete
  using (
    public.is_super_admin()
    or (public.current_user_role() <> 'staff' and company_id = public.current_user_company_id())
  );

-- ---------------------------------------------------------------------------
-- Finding 1: Super Admin manual Punch In / Punch Out RPC
-- ---------------------------------------------------------------------------

create or replace function public.attendance_admin_punch(
  p_employee_id uuid,
  p_type text,
  p_remark text default null
)
returns public.attendance_records as $$
declare
  v_employee record;
  v_shift public.attendance_shifts%rowtype;
  v_assignment record;
  v_now timestamptz := now();
  v_existing public.attendance_records%rowtype;
  v_late int;
  v_raw_minutes int;
  v_working int;
  v_overtime int;
  v_note text;
begin
  -- Backend-enforced role gate — holds even if called directly via supabase.rpc(),
  -- not just when the UI button is hidden.
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can perform a manual attendance punch for another employee.'
      using errcode = '42501';
  end if;

  if p_type not in ('punch_in', 'punch_out') then
    raise exception 'Invalid punch type: must be punch_in or punch_out.';
  end if;

  select id, company_id, store_id, status into v_employee
  from public.employees e
  where e.id = p_employee_id
    and status = 'active'
  limit 1;

  if not found then
    raise exception 'Selected employee was not found or is not active.';
  end if;

  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = current_date
  limit 1;

  if p_type = 'punch_in' then
    if found and v_existing.punch_in_at is not null then
      raise exception 'This employee has already punched in for today.';
    end if;

    -- Same shift resolution as attendance_punch_in(): current effective assignment,
    -- falling back to the company's active shift.
    select * into v_assignment
    from public.employee_shift_assignments
    where employee_id = v_employee.id
      and is_active
      and effective_from <= current_date
      and (effective_to is null or effective_to >= current_date)
    order by effective_from desc
    limit 1;

    if found then
      select * into v_shift from public.attendance_shifts where id = v_assignment.shift_id and is_active;
    end if;

    if v_shift.id is null then
      select * into v_shift
      from public.attendance_shifts
      where company_id = v_employee.company_id
        and is_active
      order by name
      limit 1;
    end if;

    if v_shift.id is null then
      raise exception 'No active shift is assigned to this employee.';
    end if;

    v_late := greatest(
      0,
      floor(extract(epoch from ((v_now at time zone 'Asia/Kolkata')::time - v_shift.start_time)) / 60)::int - v_shift.grace_minutes
    );

    v_note := 'Punched in by Super Admin on behalf of employee.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

    if v_existing.id is not null then
      update public.attendance_records
      set punch_in_at = v_now,
          late_minutes = v_late,
          status = 'present',
          source = 'admin',
          shift_id = v_shift.id,
          remarks = coalesce(p_remark, remarks),
          updated_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id
      returning * into v_existing;
    else
      insert into public.attendance_records (
        company_id, employee_id, store_id, attendance_date, shift_id,
        punch_in_at, late_minutes, status, source, remarks, created_by, updated_by
      ) values (
        v_employee.company_id, v_employee.id, v_employee.store_id, current_date, v_shift.id,
        v_now, v_late, 'present', 'admin', p_remark, auth.uid(), auth.uid()
      ) returning * into v_existing;
    end if;

    insert into public.attendance_audit_logs (
      company_id, employee_id, attendance_record_id, action, source, performed_by, notes
    ) values (
      v_employee.company_id, v_employee.id, v_existing.id, 'punch_in', 'admin', auth.uid(), v_note
    );

    return v_existing;

  else -- punch_out
    if not found or v_existing.punch_in_at is null then
      raise exception 'This employee has not punched in yet today.';
    end if;

    if v_existing.punch_out_at is not null then
      raise exception 'This employee has already punched out for today.';
    end if;

    -- Same shift resolution as attendance_punch_out(): the shift already attached
    -- to today's record, not a re-resolution against the current assignment.
    select * into v_shift from public.attendance_shifts where id = v_existing.shift_id and is_active;
    if not found then
      raise exception 'Assigned shift is not available.';
    end if;

    v_raw_minutes := greatest(0, floor(extract(epoch from (v_now - v_existing.punch_in_at)) / 60)::int);
    v_working := greatest(0, v_raw_minutes - coalesce(v_shift.break_minutes, 0));
    v_overtime := case
      when v_shift.overtime_enabled then greatest(0, v_working - coalesce(v_shift.minimum_work_minutes, 0))
      else 0
    end;

    v_note := 'Punched out by Super Admin on behalf of employee.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

    update public.attendance_records
    set punch_out_at = v_now,
        working_minutes = v_working,
        overtime_minutes = v_overtime,
        status = 'present',
        source = 'admin',
        remarks = coalesce(p_remark, remarks),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    insert into public.attendance_audit_logs (
      company_id, employee_id, attendance_record_id, action, source, performed_by, notes
    ) values (
      v_employee.company_id, v_employee.id, v_existing.id, 'punch_out', 'admin', auth.uid(), v_note
    );

    return v_existing;
  end if;
end;
$$ language plpgsql security definer;

-- Defense in depth: only authenticated sessions may even attempt this RPC (the
-- is_super_admin() check inside is still the real gate — anon has no auth.uid()
-- and would fail it anyway, but revoking PUBLIC removes the call surface entirely).
revoke all on function public.attendance_admin_punch(uuid, text, text) from public;
grant execute on function public.attendance_admin_punch(uuid, text, text) to authenticated;
