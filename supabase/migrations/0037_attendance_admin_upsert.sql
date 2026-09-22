-- ============================================================================
-- Retail HRMS — Super Admin manual attendance create/edit for any date <= today
-- Migration 0037
--
-- WHY: attendance_admin_punch() (migration 0034) only handles "punch now" for
-- TODAY. The Employee Schedule / Complete Attendance workflow needs Super
-- Admin to create or correct attendance for any historical date up to and
-- including today — set status, punch in/out times, and a remark — with the
-- same Late/Working/Overtime formulas (migration 0031) and the shift that was
-- actually assigned to the employee ON THAT DATE (not today's current shift).
-- This is deliberately a SEPARATE RPC from attendance_admin_punch(): punching
-- "now" and editing an arbitrary past record are different operations with
-- different safety semantics (a live punch always uses now(); an edit lets
-- Super Admin specify an explicit corrective wall-clock time for a date that
-- has already happened) — attendance_admin_punch() is untouched and remains
-- the dedicated quick-action for today's Punch In/Punch Out.
--
-- SECURITY:
--   - is_super_admin() checked INSIDE the function body — a direct RPC call
--     as staff/company_admin is rejected server-side (errcode 42501),
--     regardless of what the UI shows.
--   - p_attendance_date > current_date is rejected (errcode 22007) using
--     Postgres's own `current_date` (the database server's date), never a
--     caller-supplied "today". There is no way to pass a fabricated "current
--     date" to bypass this — the date comparison always uses the server.
--   - p_punch_in_time/p_punch_out_time are wall-clock TIME values for the
--     given (already-past-or-today) attendance_date — this is legitimate
--     corrective data Super Admin is expected to supply (e.g. "the employee
--     actually punched in at 10:05 AM on 5 Aug"), not a live "now()" override;
--     record metadata (updated_at, the audit log's recorded_at) still always
--     uses now().
--
-- Reuses: employee_shift_assignments (historical resolution, same pattern as
-- attendance_punch_in), attendance_shifts, the break/required-hours formula
-- from migration 0031, and the existing attendance_audit_logs table (source
-- 'admin' from migration 0033, action 'admin_correction' from migration 0036).
-- No new table. No historical row is touched unless Super Admin explicitly
-- targets that date.
-- ============================================================================

create or replace function public.attendance_admin_upsert(
  p_employee_id uuid,
  p_attendance_date date,
  p_status text,
  p_punch_in_time time default null,
  p_punch_out_time time default null,
  p_remark text default null
)
returns public.attendance_records as $$
declare
  v_employee record;
  v_shift public.attendance_shifts%rowtype;
  v_assignment record;
  v_existing public.attendance_records%rowtype;
  v_punch_in_at timestamptz;
  v_punch_out_at timestamptz;
  v_late int;
  v_raw_minutes int;
  v_working int;
  v_overtime int;
  v_note text;
  v_prev_status text;
  v_punch_in_note text := '';
  v_punch_out_note text := '';
  v_remark_note text := '';
  v_valid_statuses text[] := array['present','absent','half_day','leave','weekly_off','holiday','work_from_home','on_duty'];
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can create or edit attendance for another employee.'
      using errcode = '42501';
  end if;

  if p_attendance_date > current_date then
    raise exception 'Cannot create or edit attendance for a future date (%). Only dates up to today are allowed.', p_attendance_date
      using errcode = '22007';
  end if;

  if p_status is null or not (p_status = any(v_valid_statuses)) then
    raise exception 'Invalid attendance status: %', coalesce(p_status, '<null>');
  end if;

  if p_punch_in_time is not null and p_punch_out_time is not null and p_punch_out_time <= p_punch_in_time then
    raise exception 'Punch Out must be after Punch In.';
  end if;

  select id, company_id, store_id into v_employee
  from public.employees
  where id = p_employee_id
  limit 1;

  if not found then
    raise exception 'Selected employee was not found.';
  end if;

  -- Historical shift resolution: the assignment in effect ON p_attendance_date — never today's
  -- current shift for a date in the past. Same lookup + company-default fallback as
  -- attendance_punch_in()/attendance_admin_punch(), just parameterized by the target date.
  select * into v_assignment
  from public.employee_shift_assignments
  where employee_id = v_employee.id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
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
    raise exception 'No active shift is assigned to this employee for %.', p_attendance_date;
  end if;

  -- Build punch timestamps from the supplied IST wall-clock time + the target date.
  if p_punch_in_time is not null then
    v_punch_in_at := (p_attendance_date + p_punch_in_time) at time zone 'Asia/Kolkata';
  end if;
  if p_punch_out_time is not null then
    v_punch_out_at := (p_attendance_date + p_punch_out_time) at time zone 'Asia/Kolkata';
  end if;

  if v_punch_in_at is not null then
    v_late := greatest(
      0,
      floor(extract(epoch from ((v_punch_in_at at time zone 'Asia/Kolkata')::time - v_shift.start_time)) / 60)::int - v_shift.grace_minutes
    );
  end if;

  if v_punch_in_at is not null and v_punch_out_at is not null then
    v_raw_minutes := greatest(0, floor(extract(epoch from (v_punch_out_at - v_punch_in_at)) / 60)::int);
    v_working := greatest(0, v_raw_minutes - coalesce(v_shift.break_minutes, 0));
    v_overtime := case
      when v_shift.overtime_enabled then greatest(0, v_working - coalesce(v_shift.minimum_work_minutes, 0))
      else 0
    end;
  end if;

  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = p_attendance_date
  limit 1;

  -- Build the audit narrative BEFORE overwriting v_existing — every piece is coalesced/defaulted
  -- so the final concatenation can never collapse to NULL from one missing optional value.
  v_prev_status := coalesce(v_existing.status::text, 'none (new record)');
  if v_punch_in_at is not null then
    v_punch_in_note := ' Punch In ' || to_char(v_punch_in_at at time zone 'Asia/Kolkata', 'HH12:MI AM');
  end if;
  if v_punch_out_at is not null then
    v_punch_out_note := ', Punch Out ' || to_char(v_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM');
  end if;
  if p_remark is not null and length(trim(p_remark)) > 0 then
    v_remark_note := ' Reason: ' || p_remark;
  end if;

  v_note := 'Super Admin ' || (case when v_existing.id is null then 'created' else 'edited' end)
    || ' attendance for ' || to_char(p_attendance_date, 'DD Mon YYYY')
    || ': ' || v_prev_status || ' -> ' || p_status || '.'
    || v_punch_in_note || v_punch_out_note || v_remark_note;

  if v_existing.id is not null then
    update public.attendance_records
    set status = p_status::public.attendance_status,
        shift_id = v_shift.id,
        punch_in_at = v_punch_in_at,
        punch_out_at = v_punch_out_at,
        working_minutes = v_working,
        late_minutes = v_late,
        overtime_minutes = v_overtime,
        source = 'admin',
        remarks = coalesce(p_remark, remarks),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;
  else
    insert into public.attendance_records (
      company_id, employee_id, store_id, attendance_date, shift_id,
      punch_in_at, punch_out_at, working_minutes, late_minutes, overtime_minutes,
      status, source, remarks, created_by, updated_by
    ) values (
      v_employee.company_id, v_employee.id, v_employee.store_id, p_attendance_date, v_shift.id,
      v_punch_in_at, v_punch_out_at, v_working, v_late, v_overtime,
      p_status::public.attendance_status, 'admin', p_remark, auth.uid(), auth.uid()
    ) returning * into v_existing;
  end if;

  insert into public.attendance_audit_logs (
    company_id, employee_id, attendance_record_id, action, source, performed_by, notes
  ) values (
    v_employee.company_id, v_employee.id, v_existing.id, 'admin_correction', 'admin', auth.uid(), v_note
  );

  return v_existing;
end;
$$ language plpgsql security definer;

revoke all on function public.attendance_admin_upsert(uuid, date, text, time, time, text) from public;
grant execute on function public.attendance_admin_upsert(uuid, date, text, time, time, text) to authenticated;
