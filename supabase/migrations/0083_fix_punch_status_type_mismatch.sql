-- ============================================================================
-- Retail HRMS — URGENT BUG FIX: Staff Punch In (and Punch Out / Admin Punch)
-- failing with "column status is of type attendance_status but expression is
-- of type text"
-- Migration 0083
--
-- ROOT CAUSE (confirmed via direct type inspection on the live database, no
-- guessing):
--
--   select pg_typeof('present');                                    -- unknown
--   select pg_typeof(case when true then 'half_day' else 'present' end); -- text
--
-- A bare string literal ('present') has Postgres's special "unknown" type,
-- which is implicitly, automatically coercible to ANY target type, including
-- a user-defined enum like attendance_status -- this is why every OTHER
-- place in this codebase that writes `status` with a literal or an explicit
-- `::attendance_status` cast (e.g. attendance_admin_upsert's
-- `v_final_status::public.attendance_status`) has always worked fine.
--
-- But `CASE WHEN <cond> THEN 'half_day' ELSE 'present' END` is NOT a bare
-- literal -- Postgres resolves the CASE expression's branches to a concrete
-- type first, and two text literals resolve to plain `text`. Assigning a
-- `text` value to an enum column has NO implicit assignment cast in
-- PostgreSQL (unlike unknown), so `status = <that case expression>` (or, in
-- attendance_punch_out()/attendance_admin_punch()'s punch_out branch,
-- `status = v_facts.o_status` where compute_extended_attendance_facts()
-- declares `out o_status text`) fails with exactly the reported error.
--
-- Verified via a rolled-back test transaction that BOTH attendance_punch_
-- in() and attendance_punch_out() are affected (the user reported Punch In;
-- Punch Out has the identical bug and was silently never exercised before,
-- since every attendance record used for testing so far in this project was
-- created through attendance_admin_upsert(), which already casts
-- correctly). attendance_admin_punch() (Super Admin manual "punch now")
-- has the exact same pattern in both its punch_in and punch_out branches
-- and is fixed here too, for full consistency -- same root cause, same fix,
-- not a second bug.
--
-- FIX: explicit `::public.attendance_status` cast at each of the 5 affected
-- assignment sites (2 in attendance_punch_in, 1 in attendance_punch_out, 2 in
-- attendance_admin_punch). Confirmed valid targets: 'present' and
-- 'half_day' both exist in the live attendance_status enum. NOTHING else in
-- any of these three functions changes -- no Night Duty/Night OT/Overtime/
-- Break Deduction/Final Working/Late/approval logic is touched, and no
-- historical attendance_records row is modified (this migration only
-- replaces function definitions).
-- ============================================================================

create or replace function public.attendance_punch_in(p_use_information boolean default false)
returns public.attendance_records as $$
declare
  v_employee record;
  v_shift record;
  v_assignment record;
  v_punch_in timestamptz := now();
  v_existing public.attendance_records%rowtype;
  v_facts record;
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

  select * into v_facts from public.compute_late_and_penalty_facts(
    v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date, v_punch_in, coalesce(p_use_information, false)
  );

  if found then
    update public.attendance_records
    set punch_in_at = v_punch_in,
        late_minutes = v_facts.o_late_minutes,
        late_rule_id = v_facts.o_late_rule_id,
        used_information = v_facts.o_used_information,
        information_rule_id = v_facts.o_information_rule_id,
        half_day_reason = case when v_facts.o_half_day_late_coming then 'late_coming' else null end,
        half_day_rule_id = v_facts.o_half_day_rule_id,
        penalty_minutes = v_facts.o_penalty_minutes,
        penalty_rule_id = v_facts.o_penalty_rule_id,
        status = (case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end)::public.attendance_status,
        source = 'web',
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    return v_existing;
  end if;

  insert into public.attendance_records (
    company_id, employee_id, store_id, attendance_date, shift_id,
    punch_in_at, late_minutes, late_rule_id, used_information, information_rule_id,
    half_day_reason, half_day_rule_id, penalty_minutes, penalty_rule_id,
    status, source, created_by, updated_by
  ) values (
    v_employee.company_id, v_employee.id, v_employee.store_id, current_date, v_shift.id,
    v_punch_in, v_facts.o_late_minutes, v_facts.o_late_rule_id, v_facts.o_used_information, v_facts.o_information_rule_id,
    case when v_facts.o_half_day_late_coming then 'late_coming' else null end, v_facts.o_half_day_rule_id,
    v_facts.o_penalty_minutes, v_facts.o_penalty_rule_id,
    (case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end)::public.attendance_status, 'web', auth.uid(), auth.uid()
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
  v_facts record;
  v_shift_end_at timestamptz;
  v_now timestamptz := now();
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

  select * into v_facts from public.compute_extended_attendance_facts(
    v_record.company_id, v_employee_id, v_shift.id, v_record.store_id, current_date,
    v_record.punch_in_at, v_now, v_record.used_information, null
  );

  update public.attendance_records
  set punch_out_at = v_now,
      total_working_minutes = v_facts.o_total_working_minutes,
      break_deduction_minutes = v_facts.o_break_deduction_minutes,
      working_minutes = v_facts.o_working_minutes,
      early_going_minutes = v_facts.o_early_going_minutes,
      early_going_rule_id = v_facts.o_early_going_rule_id,
      overtime_minutes = v_facts.o_overtime_minutes,
      overtime_rule_id = v_facts.o_overtime_rule_id,
      extra_duty_value = v_facts.o_extra_duty_value,
      night_ot_minutes = v_facts.o_night_ot_minutes,
      extended_duty_rule_id = v_facts.o_extended_duty_rule_id,
      half_day_reason = coalesce(v_facts.o_half_day_reason, v_record.half_day_reason),
      status = v_facts.o_status::public.attendance_status,
      source = 'web',
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_record.id
  returning * into v_record;

  v_shift_end_at := (current_date + v_shift.end_time) at time zone 'Asia/Kolkata';
  perform public.ensure_night_duty_approval(
    v_record.company_id, v_employee_id, v_record.id, current_date, v_shift_end_at, v_now,
    v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_record.store_id
  );

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
  v_facts record;
  v_shift_end_at timestamptz;
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

    select * into v_facts from public.compute_late_and_penalty_facts(
      v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date, v_now, false
    );

    v_note := 'Punched in by Super Admin on behalf of employee.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

    if v_existing.id is not null then
      update public.attendance_records
      set punch_in_at = v_now,
          late_minutes = v_facts.o_late_minutes,
          late_rule_id = v_facts.o_late_rule_id,
          half_day_reason = case when v_facts.o_half_day_late_coming then 'late_coming' else null end,
          half_day_rule_id = v_facts.o_half_day_rule_id,
          penalty_minutes = v_facts.o_penalty_minutes,
          penalty_rule_id = v_facts.o_penalty_rule_id,
          status = (case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end)::public.attendance_status,
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
        punch_in_at, late_minutes, late_rule_id, half_day_reason, half_day_rule_id,
        penalty_minutes, penalty_rule_id, status, source, remarks, created_by, updated_by
      ) values (
        v_employee.company_id, v_employee.id, v_employee.store_id, current_date, v_shift.id,
        v_now, v_facts.o_late_minutes, v_facts.o_late_rule_id,
        case when v_facts.o_half_day_late_coming then 'late_coming' else null end, v_facts.o_half_day_rule_id,
        v_facts.o_penalty_minutes, v_facts.o_penalty_rule_id,
        (case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end)::public.attendance_status, 'admin', p_remark, auth.uid(), auth.uid()
      ) returning * into v_existing;
    end if;

    insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
    values (v_employee.company_id, v_employee.id, v_existing.id, 'punch_in', 'admin', auth.uid(), v_note);

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

    select * into v_facts from public.compute_extended_attendance_facts(
      v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date,
      v_existing.punch_in_at, v_now, v_existing.used_information, null
    );

    v_note := 'Punched out by Super Admin on behalf of employee.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

    update public.attendance_records
    set punch_out_at = v_now,
        total_working_minutes = v_facts.o_total_working_minutes,
        break_deduction_minutes = v_facts.o_break_deduction_minutes,
        working_minutes = v_facts.o_working_minutes,
        early_going_minutes = v_facts.o_early_going_minutes,
        early_going_rule_id = v_facts.o_early_going_rule_id,
        overtime_minutes = v_facts.o_overtime_minutes,
        overtime_rule_id = v_facts.o_overtime_rule_id,
        extra_duty_value = v_facts.o_extra_duty_value,
        night_ot_minutes = v_facts.o_night_ot_minutes,
        extended_duty_rule_id = v_facts.o_extended_duty_rule_id,
        half_day_reason = coalesce(v_facts.o_half_day_reason, v_existing.half_day_reason),
        status = v_facts.o_status::public.attendance_status,
        source = 'admin',
        remarks = coalesce(p_remark, remarks),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    v_shift_end_at := (current_date + v_shift.end_time) at time zone 'Asia/Kolkata';
    perform public.ensure_night_duty_approval(
      v_employee.company_id, v_employee.id, v_existing.id, current_date, v_shift_end_at, v_now,
      v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_employee.store_id
    );

    insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
    values (v_employee.company_id, v_employee.id, v_existing.id, 'punch_out', 'admin', auth.uid(), v_note);

    return v_existing;
  end if;
end;
$$ language plpgsql security definer;
