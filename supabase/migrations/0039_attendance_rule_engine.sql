-- ============================================================================
-- Retail HRMS — Rule resolution + calculation engine, wired into every
-- existing attendance RPC (single source of truth, no forked formulas)
-- Migration 0039
--
-- Adds four small, composable SQL functions and then re-points
-- attendance_punch_in() / attendance_punch_out() / attendance_admin_punch() /
-- attendance_admin_upsert() at them in place of their previous inline
-- `greatest(0, ...)` formulas. Nothing else in any of those four functions
-- changes — same signatures, same validation, same error messages, same
-- shift-resolution logic, same duplicate-punch guards.
--
-- public.apply_attendance_rounding(minutes, method, custom_minutes)
--   Shared by both late and overtime — one rounding implementation, not two.
--   round_down/round_up/custom all round to a MULTIPLE of custom_minutes
--   (falls back to 5 if unset for round_down/round_up); nearest_5/10/15/30
--   use their fixed unit. Matches the spec's own worked example: 17 actual
--   minutes with a 15-minute unit -> "Nearest 15" = 15, "Round Up" = 30.
--
-- public.resolve_attendance_rule(company, employee, shift, store, date, kind)
--   kind = 'late' | 'overtime'. Priority Employee > Shift > Store > Company,
--   each checked via attendance_rule_assignments' own effective_from/to
--   window for the given date. Returns NULL if nothing is assigned at any
--   scope — callers must treat NULL as "no rule configured", not an error.
--
-- public.calculate_late_minutes(late_rule_id, raw_late_minutes)
-- public.calculate_overtime_minutes(overtime_rule_id, raw_overtime_minutes, day_type)
--   Both return the CURRENT hard-coded behaviour unchanged
--   (greatest(0, raw)) whenever rule_id IS NULL or the rule is inactive/
--   missing — so no company's attendance changes until Super Admin
--   explicitly creates AND assigns a rule. day_type is one of
--   'normal'/'weekly_off'/'holiday'/'leave'; only attendance_admin_upsert()
--   can derive this today (it receives an explicit status from Super Admin —
--   self-service punches are always 'normal', documented as a limitation:
--   an employee physically punching in on their own weekly-off day is not
--   yet distinguished from a normal working day for OT-eligibility purposes).
-- ============================================================================

create or replace function public.apply_attendance_rounding(
  p_minutes int,
  p_method text,
  p_custom_minutes int
) returns int as $$
declare
  v_unit int;
begin
  if p_minutes is null then
    return null;
  end if;

  case p_method
    when 'exact' then
      return p_minutes;
    when 'round_down' then
      v_unit := greatest(1, coalesce(p_custom_minutes, 5));
      return (p_minutes / v_unit) * v_unit;
    when 'round_up' then
      v_unit := greatest(1, coalesce(p_custom_minutes, 5));
      return ceil(p_minutes::numeric / v_unit)::int * v_unit;
    when 'nearest_5' then
      v_unit := 5;
    when 'nearest_10' then
      v_unit := 10;
    when 'nearest_15' then
      v_unit := 15;
    when 'nearest_30' then
      v_unit := 30;
    when 'custom' then
      v_unit := greatest(1, coalesce(p_custom_minutes, 1));
    else
      return p_minutes; -- unknown method: never crash a live calculation, just pass through
  end case;

  return round(p_minutes::numeric / v_unit)::int * v_unit;
end;
$$ language plpgsql immutable;

create or replace function public.resolve_attendance_rule(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_date date,
  p_kind text -- 'late' | 'overtime'
) returns uuid as $$
declare
  v_rule_id uuid;
  v_scope text;
  v_scope_id uuid;
begin
  foreach v_scope in array array['employee', 'shift', 'store', 'company']
  loop
    v_scope_id := case v_scope
      when 'employee' then p_employee_id
      when 'shift' then p_shift_id
      when 'store' then p_store_id
      else null
    end;

    if v_scope <> 'company' and v_scope_id is null then
      continue;
    end if;

    if p_kind = 'late' then
      select late_rule_id into v_rule_id
      from public.attendance_rule_assignments
      where company_id = p_company_id
        and scope_type = v_scope
        and scope_id is not distinct from v_scope_id
        and is_active
        and late_rule_id is not null
        and effective_from <= p_date
        and (effective_to is null or effective_to >= p_date)
      order by effective_from desc
      limit 1;
    else
      select overtime_rule_id into v_rule_id
      from public.attendance_rule_assignments
      where company_id = p_company_id
        and scope_type = v_scope
        and scope_id is not distinct from v_scope_id
        and is_active
        and overtime_rule_id is not null
        and effective_from <= p_date
        and (effective_to is null or effective_to >= p_date)
      order by effective_from desc
      limit 1;
    end if;

    if v_rule_id is not null then
      return v_rule_id;
    end if;
  end loop;

  return null;
end;
$$ language plpgsql stable security definer;

create or replace function public.calculate_late_minutes(
  p_late_rule_id uuid,
  p_raw_late_minutes int
) returns int as $$
declare
  v_rule public.attendance_late_rules%rowtype;
  v_value int;
begin
  if p_raw_late_minutes is null then
    return null;
  end if;

  if p_late_rule_id is null then
    return greatest(0, p_raw_late_minutes);
  end if;

  select * into v_rule from public.attendance_late_rules where id = p_late_rule_id;
  if not found or not v_rule.is_active then
    return greatest(0, p_raw_late_minutes);
  end if;

  v_value := greatest(0, p_raw_late_minutes);

  if v_rule.calculation_method = 'slab' then
    select t.calculated_minutes into v_value
    from public.attendance_late_rule_thresholds t
    where t.late_rule_id = v_rule.id
      and t.from_minutes <= greatest(0, p_raw_late_minutes)
      and (t.to_minutes is null or t.to_minutes >= greatest(0, p_raw_late_minutes))
    order by t.from_minutes desc
    limit 1;
    if v_value is null then
      v_value := greatest(0, p_raw_late_minutes); -- no slab covers this value: fall back, never silently zero it
    end if;
  end if;

  v_value := public.apply_attendance_rounding(v_value, v_rule.rounding_method, v_rule.custom_rounding_minutes);
  v_value := greatest(v_value, v_rule.minimum_late_minutes);
  if v_rule.maximum_late_minutes is not null then
    v_value := least(v_value, v_rule.maximum_late_minutes);
  end if;

  return greatest(0, v_value);
end;
$$ language plpgsql stable;

create or replace function public.calculate_overtime_minutes(
  p_overtime_rule_id uuid,
  p_raw_overtime_minutes int,
  p_day_type text -- 'normal' | 'weekly_off' | 'holiday' | 'leave'
) returns int as $$
declare
  v_rule public.attendance_overtime_rules%rowtype;
  v_value int;
  v_allowed boolean;
begin
  if p_raw_overtime_minutes is null then
    return null;
  end if;

  if p_overtime_rule_id is null then
    return greatest(0, p_raw_overtime_minutes);
  end if;

  select * into v_rule from public.attendance_overtime_rules where id = p_overtime_rule_id;
  if not found or not v_rule.is_active then
    return greatest(0, p_raw_overtime_minutes);
  end if;

  case coalesce(p_day_type, 'normal')
    when 'weekly_off' then v_allowed := v_rule.weekly_off_overtime_allowed;
    when 'holiday' then v_allowed := v_rule.holiday_overtime_allowed;
    when 'leave' then v_allowed := v_rule.leave_overtime_allowed;
    else v_allowed := true;
  end case;

  if not v_allowed then
    return 0;
  end if;

  v_value := greatest(0, p_raw_overtime_minutes);

  if v_rule.calculation_method = 'slab' then
    select t.calculated_minutes into v_value
    from public.attendance_overtime_rule_thresholds t
    where t.overtime_rule_id = v_rule.id
      and t.from_minutes <= greatest(0, p_raw_overtime_minutes)
      and (t.to_minutes is null or t.to_minutes >= greatest(0, p_raw_overtime_minutes))
    order by t.from_minutes desc
    limit 1;
    if v_value is null then
      v_value := greatest(0, p_raw_overtime_minutes);
    end if;
  end if;

  if v_value < v_rule.minimum_overtime_minutes then
    return 0;
  end if;

  v_value := public.apply_attendance_rounding(v_value, v_rule.rounding_method, v_rule.custom_rounding_minutes);

  if v_rule.maximum_overtime_minutes is not null then
    v_value := least(v_value, v_rule.maximum_overtime_minutes);
  end if;

  return greatest(0, v_value);
end;
$$ language plpgsql stable;

-- ---------------------------------------------------------------------------
-- Wire the engine into every existing attendance-writing RPC.
-- ---------------------------------------------------------------------------

create or replace function public.attendance_punch_in()
returns public.attendance_records as $$
declare
  v_employee record;
  v_shift record;
  v_assignment record;
  v_punch_in timestamptz := now();
  v_raw_late int;
  v_late int;
  v_late_rule_id uuid;
  v_existing public.attendance_records%rowtype;
begin
  select id, company_id, store_id, status into v_employee
  from public.employees e
  where e.auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if not found then
    select id, company_id, store_id, status into v_employee
    from public.employees e
    where company_id = public.current_user_company_id()
      and e.auth_user_id is null
      and e.email is not null
      and lower(e.email) = lower(public.current_user_profile_email())
      and status = 'active'
    limit 1;
  end if;

  if not found then
    raise exception 'No active employee record is linked to the current user.';
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

  if v_shift is null then
    select * into v_shift
    from public.attendance_shifts
    where company_id = v_employee.company_id
      and is_active
    order by name
    limit 1;
  end if;

  if v_shift is null then
    raise exception 'No active shift is assigned to this employee.';
  end if;

  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = current_date
  limit 1;

  if found and v_existing.punch_in_at is not null then
    raise exception 'You have already punched in for today.';
  end if;

  v_raw_late := floor(extract(epoch from ((v_punch_in at time zone 'Asia/Kolkata')::time - v_shift.start_time)) / 60)::int - v_shift.grace_minutes;
  v_late_rule_id := public.resolve_attendance_rule(v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date, 'late');
  v_late := public.calculate_late_minutes(v_late_rule_id, v_raw_late);

  if found then
    update public.attendance_records
    set punch_in_at = v_punch_in,
        late_minutes = v_late,
        late_rule_id = v_late_rule_id,
        status = 'present',
        source = 'web',
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    return v_existing;
  end if;

  insert into public.attendance_records (
    company_id,
    employee_id,
    store_id,
    attendance_date,
    shift_id,
    punch_in_at,
    late_minutes,
    late_rule_id,
    status,
    source,
    created_by,
    updated_by
  ) values (
    v_employee.company_id,
    v_employee.id,
    v_employee.store_id,
    current_date,
    v_shift.id,
    v_punch_in,
    v_late,
    v_late_rule_id,
    'present',
    'web',
    auth.uid(),
    auth.uid()
  ) returning * into v_existing;

  return v_existing;
end;
$$ language plpgsql security definer;

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
    v_overtime_rule_id := public.resolve_attendance_rule(v_record.company_id, v_employee_id, v_shift.id, v_record.store_id, current_date, 'overtime');
    v_overtime := public.calculate_overtime_minutes(v_overtime_rule_id, v_raw_overtime, 'normal');
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
      v_overtime_rule_id := public.resolve_attendance_rule(v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date, 'overtime');
      v_overtime := public.calculate_overtime_minutes(v_overtime_rule_id, v_raw_overtime, 'normal');
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

  -- Day type for overtime-eligibility gating comes directly from the status Super Admin chose —
  -- this is the one write path where day type is unambiguous and known up front.
  v_day_type := case p_status
    when 'weekly_off' then 'weekly_off'
    when 'holiday' then 'holiday'
    when 'leave' then 'leave'
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
