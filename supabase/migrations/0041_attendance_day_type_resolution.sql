-- ============================================================================
-- Retail HRMS — Resolve real day type (Weekly Off) for Overtime Rule gating
-- Migration 0041
--
-- WHY: attendance_punch_out() / attendance_admin_punch() (punch_out branch) /
-- attendance_admin_upsert() previously always passed day_type='normal' (the
-- two punch RPCs) or derived it ONLY from the explicitly-chosen status (the
-- admin-upsert RPC) to calculate_overtime_minutes(). That meant an employee
-- who genuinely punched in/out on their own historical weekly-off day never
-- got the Overtime Rule's "Weekly Off Overtime Allowed" flag applied — the
-- day looked identical to a normal working day to the OT calculator.
--
-- FIX: all three now resolve day_type as:
--   Leave (explicit status)  >  Holiday (explicit status)  >
--   Weekly Off (explicit status OR public.is_weekly_off_on_date(), migration
--   0040 — the employee's HISTORICAL weekly-off configuration for that exact
--   date, never today's)  >  Normal.
-- Leave/Holiday have no automatic source in this codebase (no Leave
-- Management data, no Holiday Calendar table) — they stay explicit-status-only,
-- exactly as before. Only Weekly Off gained automatic historical resolution,
-- because employee_weekly_off_history/weekly_off_overrides already exist and
-- are already the single source of truth used everywhere else.
--
-- Nothing else in any of the three functions changes — same signatures, same
-- validation, same shift resolution, same duplicate-punch guards, same Late
-- calculation. This is a pure CREATE OR REPLACE; no table or row is touched.
-- Behaviourally inert for every company today: zero Overtime Rules are
-- currently assigned anywhere, so calculate_overtime_minutes(NULL, ...) still
-- returns the legacy greatest(0, raw) regardless of day_type until Super
-- Admin actually assigns a rule with a Weekly-Off/Holiday/Leave flag set to
-- "No".
-- ============================================================================

create or replace function public.attendance_punch_out()
returns public.attendance_records as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
  v_record public.attendance_records%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_raw_minutes int;
  v_working int;
  v_raw_overtime int;
  v_overtime int;
  v_overtime_rule_id uuid;
  v_day_type text;
begin
  if v_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_record
  from public.attendance_records
  where employee_id = v_employee_id
    and attendance_date = current_date
  limit 1;

  if not found or v_record.punch_in_at is null then
    raise exception 'Please punch in before punching out.';
  end if;

  if v_record.punch_out_at is not null then
    raise exception 'You have already punched out for today.';
  end if;

  select * into v_shift from public.attendance_shifts where id = v_record.shift_id and is_active;
  if not found then
    raise exception 'Assigned shift is not available.';
  end if;

  v_raw_minutes := greatest(0, floor(extract(epoch from (now() - v_record.punch_in_at)) / 60)::int);
  v_working := greatest(0, v_raw_minutes - coalesce(v_shift.break_minutes, 0));
  v_raw_overtime := case when v_shift.overtime_enabled then v_working - coalesce(v_shift.minimum_work_minutes, 0) else 0 end;

  if v_shift.overtime_enabled then
    v_day_type := case when public.is_weekly_off_on_date(v_employee_id, current_date) then 'weekly_off' else 'normal' end;
    v_overtime_rule_id := public.resolve_attendance_rule(v_record.company_id, v_employee_id, v_shift.id, v_record.store_id, current_date, 'overtime');
    v_overtime := public.calculate_overtime_minutes(v_overtime_rule_id, v_raw_overtime, v_day_type);
  else
    v_overtime_rule_id := null;
    v_overtime := 0;
  end if;

  update public.attendance_records
  set punch_out_at = now(),
      working_minutes = v_working,
      overtime_minutes = v_overtime,
      overtime_rule_id = v_overtime_rule_id,
      status = 'present',
      source = 'web',
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_record.id
  returning * into v_record;

  return v_record;
end;
$$ language plpgsql security definer;

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
  v_raw_late int;
  v_late int;
  v_late_rule_id uuid;
  v_raw_minutes int;
  v_working int;
  v_raw_overtime int;
  v_overtime int;
  v_overtime_rule_id uuid;
  v_day_type text;
  v_note text;
begin
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

    v_raw_late := floor(extract(epoch from ((v_now at time zone 'Asia/Kolkata')::time - v_shift.start_time)) / 60)::int - v_shift.grace_minutes;
    v_late_rule_id := public.resolve_attendance_rule(v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date, 'late');
    v_late := public.calculate_late_minutes(v_late_rule_id, v_raw_late);

    v_note := 'Punched in by Super Admin on behalf of employee.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

    if v_existing.id is not null then
      update public.attendance_records
      set punch_in_at = v_now,
          late_minutes = v_late,
          late_rule_id = v_late_rule_id,
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
        punch_in_at, late_minutes, late_rule_id, status, source, remarks, created_by, updated_by
      ) values (
        v_employee.company_id, v_employee.id, v_employee.store_id, current_date, v_shift.id,
        v_now, v_late, v_late_rule_id, 'present', 'admin', p_remark, auth.uid(), auth.uid()
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

    select * into v_shift from public.attendance_shifts where id = v_existing.shift_id and is_active;
    if not found then
      raise exception 'Assigned shift is not available.';
    end if;

    v_raw_minutes := greatest(0, floor(extract(epoch from (v_now - v_existing.punch_in_at)) / 60)::int);
    v_working := greatest(0, v_raw_minutes - coalesce(v_shift.break_minutes, 0));
    v_raw_overtime := case when v_shift.overtime_enabled then v_working - coalesce(v_shift.minimum_work_minutes, 0) else 0 end;

    if v_shift.overtime_enabled then
      v_day_type := case when public.is_weekly_off_on_date(v_employee.id, current_date) then 'weekly_off' else 'normal' end;
      v_overtime_rule_id := public.resolve_attendance_rule(v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date, 'overtime');
      v_overtime := public.calculate_overtime_minutes(v_overtime_rule_id, v_raw_overtime, v_day_type);
    else
      v_overtime_rule_id := null;
      v_overtime := 0;
    end if;

    v_note := 'Punched out by Super Admin on behalf of employee.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

    update public.attendance_records
    set punch_out_at = v_now,
        working_minutes = v_working,
        overtime_minutes = v_overtime,
        overtime_rule_id = v_overtime_rule_id,
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
  v_raw_late int;
  v_late int;
  v_late_rule_id uuid;
  v_raw_minutes int;
  v_working int;
  v_raw_overtime int;
  v_overtime int;
  v_overtime_rule_id uuid;
  v_day_type text;
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

  if p_punch_in_time is not null then
    v_punch_in_at := (p_attendance_date + p_punch_in_time) at time zone 'Asia/Kolkata';
  end if;
  if p_punch_out_time is not null then
    v_punch_out_at := (p_attendance_date + p_punch_out_time) at time zone 'Asia/Kolkata';
  end if;

  -- Day type: explicit status wins for Leave/Holiday (no automatic source exists for either in
  -- this codebase); Weekly Off is explicit OR resolved historically via is_weekly_off_on_date()
  -- for p_attendance_date — so an employee marked 'present' (worked) on their real weekly-off day
  -- still correctly triggers the Overtime Rule's Weekly-Off-Allowed gate, not just a literal
  -- status='weekly_off' choice.
  v_day_type := case
    when p_status = 'leave' then 'leave'
    when p_status = 'holiday' then 'holiday'
    when p_status = 'weekly_off' then 'weekly_off'
    when public.is_weekly_off_on_date(v_employee.id, p_attendance_date) then 'weekly_off'
    else 'normal'
  end;

  if v_punch_in_at is not null then
    v_raw_late := floor(extract(epoch from ((v_punch_in_at at time zone 'Asia/Kolkata')::time - v_shift.start_time)) / 60)::int - v_shift.grace_minutes;
    v_late_rule_id := public.resolve_attendance_rule(v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, p_attendance_date, 'late');
    v_late := public.calculate_late_minutes(v_late_rule_id, v_raw_late);
  end if;

  if v_punch_in_at is not null and v_punch_out_at is not null then
    v_raw_minutes := greatest(0, floor(extract(epoch from (v_punch_out_at - v_punch_in_at)) / 60)::int);
    v_working := greatest(0, v_raw_minutes - coalesce(v_shift.break_minutes, 0));
    v_raw_overtime := case when v_shift.overtime_enabled then v_working - coalesce(v_shift.minimum_work_minutes, 0) else 0 end;
    if v_shift.overtime_enabled then
      v_overtime_rule_id := public.resolve_attendance_rule(v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, p_attendance_date, 'overtime');
      v_overtime := public.calculate_overtime_minutes(v_overtime_rule_id, v_raw_overtime, v_day_type);
    else
      v_overtime := 0;
    end if;
  end if;

  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = p_attendance_date
  limit 1;

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
        late_rule_id = v_late_rule_id,
        overtime_minutes = v_overtime,
        overtime_rule_id = v_overtime_rule_id,
        source = 'admin',
        remarks = coalesce(p_remark, remarks),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;
  else
    insert into public.attendance_records (
      company_id, employee_id, store_id, attendance_date, shift_id,
      punch_in_at, punch_out_at, working_minutes, late_minutes, late_rule_id, overtime_minutes, overtime_rule_id,
      status, source, remarks, created_by, updated_by
    ) values (
      v_employee.company_id, v_employee.id, v_employee.store_id, p_attendance_date, v_shift.id,
      v_punch_in_at, v_punch_out_at, v_working, v_late, v_late_rule_id, v_overtime, v_overtime_rule_id,
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
