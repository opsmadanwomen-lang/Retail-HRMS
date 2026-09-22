-- ============================================================================
-- Retail HRMS — Information/Half-Day/Penalty/Early-Going/Extended-Duty engine,
-- wired into every attendance-writing RPC, plus Night Duty approval
-- Migration 0045
--
-- ONE CENTRAL ENGINE (Part 21/40 requirement): two shared functions do all the
-- new work; every RPC below calls them instead of embedding its own copy.
--   compute_late_and_penalty_facts()   — punch-in-only facts: Late, Half-Day
--     (late-coming), Information usage, Penalty. Used standalone by
--     attendance_punch_in()/attendance_admin_punch() punch_in branch, and
--     internally by the function below.
--   compute_extended_attendance_facts() — the full picture once both punch
--     times exist: everything above PLUS Half-Day (early-going), Working
--     Hours, Normal OT (now Shift-End-based per your Part 15/16 correction,
--     capped at the midnight threshold), and Extended Duty (the ladder past
--     midnight). Used by attendance_punch_out(), attendance_admin_punch()
--     punch_out branch, and attendance_admin_upsert().
--
-- NO-DOUBLE-OT GUARANTEE: Normal OT = min(PunchOut, MidnightThreshold) -
-- ShiftEnd; Extended Duty's hourly OT only ever starts counting AT that same
-- MidnightThreshold instant. The two spans are mathematically disjoint by
-- construction — see calculate_extended_duty() (migration 0044).
--
-- BACKWARD COMPATIBILITY: every new dimension is NULL-passthrough-safe — no
-- Information/Penalty/Half-Day/Early-Going/Extended-Duty rule is configured
-- for any company today, so status/late/working/OT continue to compute
-- exactly as before UNLESS this migration's own explicit, approved formula
-- fix applies (Normal OT is now Shift-End-based, not working-minus-required —
-- this was a corrected bug per your worked example, not a gated feature, so
-- it takes effect immediately for any future punch).
-- ============================================================================

alter table public.attendance_records
  add column if not exists payable_extra_duty_value numeric;

create or replace function public.compute_late_and_penalty_facts(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_punch_in_at timestamptz,
  p_use_information boolean,
  out o_late_minutes int,
  out o_late_rule_id uuid,
  out o_used_information boolean,
  out o_information_rule_id uuid,
  out o_is_weekly_off boolean,
  out o_half_day_late_coming boolean,
  out o_half_day_rule_id uuid,
  out o_penalty_minutes int,
  out o_penalty_rule_id uuid
) as $$
declare
  v_shift public.attendance_shifts%rowtype;
  v_info_rule public.attendance_information_rules%rowtype;
  v_half_day_rule public.attendance_half_day_rules%rowtype;
  v_penalty_rule public.attendance_penalty_rules%rowtype;
  v_punch_in_ist_time time;
  v_uses_noon_rule boolean := false;
  v_late_base_time time;
  v_raw_late int;
  v_month_start date;
  v_month_end date;
  v_used_count int;
  v_penalty_applicable boolean := false;
begin
  o_late_minutes := 0;
  o_late_rule_id := null;
  o_used_information := false;
  o_information_rule_id := null;
  o_is_weekly_off := false;
  o_half_day_late_coming := false;
  o_half_day_rule_id := null;
  o_penalty_minutes := 0;
  o_penalty_rule_id := null;

  if p_punch_in_at is null then
    return;
  end if;

  select * into v_shift from public.attendance_shifts where id = p_shift_id;
  v_punch_in_ist_time := (p_punch_in_at at time zone 'Asia/Kolkata')::time;

  o_is_weekly_off := public.is_weekly_off_on_date(p_employee_id, p_attendance_date);

  select * into v_info_rule
  from public.attendance_information_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;
  o_information_rule_id := v_info_rule.id;

  if v_info_rule.id is not null and p_use_information then
    v_month_start := date_trunc('month', p_attendance_date)::date;
    v_month_end := (date_trunc('month', p_attendance_date) + interval '1 month - 1 day')::date;

    select count(*) into v_used_count
    from public.employee_information_usage
    where employee_id = p_employee_id
      and attendance_date >= v_month_start
      and attendance_date <= v_month_end;

    if v_used_count >= v_info_rule.monthly_limit then
      raise exception 'No Information/Intimation remaining for this month (limit %).', v_info_rule.monthly_limit;
    end if;

    insert into public.employee_information_usage (company_id, employee_id, attendance_date, used_by)
    values (p_company_id, p_employee_id, p_attendance_date, auth.uid())
    on conflict (employee_id, attendance_date) do nothing;

    o_used_information := true;
  end if;

  v_uses_noon_rule := v_info_rule.id is not null and (o_used_information or (o_is_weekly_off and v_info_rule.applicable_on_weekly_off));

  if v_uses_noon_rule then
    v_late_base_time := v_info_rule.cutoff_time;
    v_raw_late := greatest(0, floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int);
  else
    v_late_base_time := v_shift.start_time;
    v_raw_late := floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int - coalesce(v_shift.grace_minutes, 0);
  end if;

  select * into v_half_day_rule
  from public.attendance_half_day_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;
  o_half_day_rule_id := v_half_day_rule.id;

  if v_half_day_rule.id is not null and v_punch_in_ist_time >= v_half_day_rule.late_arrival_cutoff_time then
    o_half_day_late_coming := true;
    v_raw_late := greatest(0, floor(extract(epoch from (v_punch_in_ist_time - v_half_day_rule.late_arrival_cutoff_time)) / 60)::int);
  end if;

  o_late_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'late');
  o_late_minutes := public.calculate_late_minutes(o_late_rule_id, v_raw_late);

  select * into v_penalty_rule
  from public.attendance_penalty_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;
  o_penalty_rule_id := v_penalty_rule.id;

  if v_penalty_rule.id is not null and o_late_minutes > 0 then
    v_penalty_applicable := case v_penalty_rule.applicability
      when 'every_late' then true
      when 'after_information_exhausted' then not v_uses_noon_rule
      when 'normal_day_only' then not v_uses_noon_rule and not o_is_weekly_off
      when 'information_day_after_cutoff' then v_uses_noon_rule
      when 'weekly_off' then o_is_weekly_off
      when 'half_day' then o_half_day_late_coming
      else true
    end;

    if v_penalty_applicable then
      o_penalty_minutes := public.calculate_penalty_minutes(o_penalty_rule_id, o_late_minutes);
    end if;
  end if;
end;
$$ language plpgsql security definer;

create or replace function public.compute_extended_attendance_facts(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_punch_in_at timestamptz,
  p_punch_out_at timestamptz,
  p_use_information boolean,
  p_day_type_override text, -- 'leave' | 'holiday' | null — only attendance_admin_upsert() supplies this
  out o_status text,
  out o_late_minutes int,
  out o_late_rule_id uuid,
  out o_used_information boolean,
  out o_information_rule_id uuid,
  out o_half_day_reason text,
  out o_half_day_rule_id uuid,
  out o_penalty_minutes int,
  out o_penalty_rule_id uuid,
  out o_working_minutes int,
  out o_early_going_minutes int,
  out o_early_going_rule_id uuid,
  out o_overtime_minutes int,
  out o_overtime_rule_id uuid,
  out o_extra_duty_value numeric,
  out o_night_ot_minutes int,
  out o_extended_duty_rule_id uuid
) as $$
declare
  v_shift public.attendance_shifts%rowtype;
  v_late_facts record;
  v_half_day_rule public.attendance_half_day_rules%rowtype;
  v_early_going_rule public.attendance_early_going_rules%rowtype;
  v_extended_duty_rule_id uuid;
  v_punch_out_ist_time time;
  v_punch_out_ist_date date;
  v_shift_end_at timestamptz;
  v_raw_overtime int;
  v_ext record;
  v_early_going_base_time time;
  v_raw_early_going int;
  v_is_half_day_early boolean := false;
  v_day_type text;
begin
  select * into v_shift from public.attendance_shifts where id = p_shift_id;

  select * into v_late_facts from public.compute_late_and_penalty_facts(
    p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, p_punch_in_at, p_use_information
  );

  o_late_minutes := v_late_facts.o_late_minutes;
  o_late_rule_id := v_late_facts.o_late_rule_id;
  o_used_information := v_late_facts.o_used_information;
  o_information_rule_id := v_late_facts.o_information_rule_id;
  o_half_day_rule_id := v_late_facts.o_half_day_rule_id;
  o_penalty_minutes := v_late_facts.o_penalty_minutes;
  o_penalty_rule_id := v_late_facts.o_penalty_rule_id;

  o_half_day_reason := case when v_late_facts.o_half_day_late_coming then 'late_coming' else null end;
  o_status := case when o_half_day_reason is not null then 'half_day' else 'present' end;

  o_working_minutes := null;
  o_early_going_minutes := null;
  o_early_going_rule_id := null;
  o_overtime_minutes := null;
  o_overtime_rule_id := null;
  o_extra_duty_value := null;
  o_night_ot_minutes := null;
  o_extended_duty_rule_id := null;

  if p_punch_in_at is null or p_punch_out_at is null then
    return;
  end if;

  v_punch_out_ist_time := (p_punch_out_at at time zone 'Asia/Kolkata')::time;
  v_punch_out_ist_date := (p_punch_out_at at time zone 'Asia/Kolkata')::date;

  select * into v_half_day_rule
  from public.attendance_half_day_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;

  if v_half_day_rule.id is not null and v_punch_out_ist_date = p_attendance_date and v_punch_out_ist_time <= v_half_day_rule.early_going_cutoff_time then
    v_is_half_day_early := true;
    if o_half_day_reason is null then
      o_half_day_reason := 'early_going';
    end if;
    o_status := 'half_day';
  end if;

  o_working_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_punch_in_at)) / 60)::int - coalesce(v_shift.break_minutes, 0));

  select * into v_early_going_rule
  from public.attendance_early_going_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;
  o_early_going_rule_id := v_early_going_rule.id;

  if v_early_going_rule.id is not null then
    if v_is_half_day_early then
      v_early_going_base_time := v_half_day_rule.early_going_cutoff_time;
      v_raw_early_going := greatest(0, floor(extract(epoch from (v_early_going_base_time - v_punch_out_ist_time)) / 60)::int);
    elsif v_punch_out_ist_date = p_attendance_date and v_punch_out_ist_time < v_shift.end_time then
      v_raw_early_going := greatest(0, floor(extract(epoch from (v_shift.end_time - v_punch_out_ist_time)) / 60)::int - coalesce(v_early_going_rule.grace_minutes, 0));
    else
      v_raw_early_going := 0;
    end if;

    if v_early_going_rule.calculation_method = 'slab' then
      select t.calculated_minutes into o_early_going_minutes
      from public.attendance_early_going_rule_thresholds t
      where t.early_going_rule_id = v_early_going_rule.id
        and t.from_minutes <= v_raw_early_going
        and (t.to_minutes is null or t.to_minutes >= v_raw_early_going)
      order by t.from_minutes desc
      limit 1;
      if o_early_going_minutes is null then
        o_early_going_minutes := v_raw_early_going;
      end if;
    else
      o_early_going_minutes := v_raw_early_going;
    end if;

    o_early_going_minutes := public.apply_attendance_rounding(o_early_going_minutes, v_early_going_rule.rounding_method, v_early_going_rule.custom_rounding_minutes);
  end if;

  v_shift_end_at := (p_attendance_date + v_shift.end_time) at time zone 'Asia/Kolkata';

  select id into v_extended_duty_rule_id
  from public.attendance_extended_duty_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;
  o_extended_duty_rule_id := v_extended_duty_rule_id;

  select * into v_ext from public.calculate_extended_duty(v_extended_duty_rule_id, p_attendance_date, v_shift_end_at, p_punch_out_at);
  o_extra_duty_value := v_ext.o_extra_duty_value;
  o_night_ot_minutes := v_ext.o_night_ot_minutes;

  if v_shift.overtime_enabled then
    v_raw_overtime := v_ext.o_normal_ot_minutes;
    v_day_type := coalesce(p_day_type_override, case when v_late_facts.o_is_weekly_off then 'weekly_off' else 'normal' end);
    o_overtime_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'overtime');
    o_overtime_minutes := public.calculate_overtime_minutes(o_overtime_rule_id, v_raw_overtime, v_day_type);
  else
    o_overtime_minutes := 0;
    o_extra_duty_value := 0;
    o_night_ot_minutes := 0;
  end if;
end;
$$ language plpgsql security definer;

-- Auto-creates a PENDING Night Duty approval the first time a record's Extended Duty value is
-- positive (idempotent via the unique(attendance_record_id) constraint). Skipped entirely when the
-- active Night Duty Approval Config has approval_required = false (defaults to true when no config
-- row exists — matching the table's own column default).
create or replace function public.ensure_night_duty_approval(
  p_company_id uuid,
  p_employee_id uuid,
  p_attendance_record_id uuid,
  p_attendance_date date,
  p_shift_end_at timestamptz,
  p_actual_punch_out_at timestamptz,
  p_extra_duty_value numeric,
  p_night_ot_minutes int
) returns void as $$
declare
  v_config public.attendance_night_duty_approval_config%rowtype;
  v_approval_required boolean := true;
begin
  if p_extra_duty_value is null or p_extra_duty_value <= 0 then
    return;
  end if;

  select * into v_config
  from public.attendance_night_duty_approval_config
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;

  if v_config.id is not null then
    v_approval_required := v_config.approval_required;
  end if;

  if not v_approval_required then
    return;
  end if;

  insert into public.attendance_night_duty_approvals (
    company_id, employee_id, attendance_record_id, attendance_date, shift_end_at,
    actual_punch_out_at, extra_duty_value, night_ot_minutes, approval_status
  ) values (
    p_company_id, p_employee_id, p_attendance_record_id, p_attendance_date, p_shift_end_at,
    p_actual_punch_out_at, p_extra_duty_value, p_night_ot_minutes, 'pending'
  )
  on conflict (attendance_record_id) do nothing;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- attendance_punch_in(): + optional Information usage
-- ---------------------------------------------------------------------------
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
        status = case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end,
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
    case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end, 'web', auth.uid(), auth.uid()
  ) returning * into v_existing;

  return v_existing;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- attendance_punch_out(): full pipeline + auto Night Duty approval
-- ---------------------------------------------------------------------------
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
      working_minutes = v_facts.o_working_minutes,
      early_going_minutes = v_facts.o_early_going_minutes,
      early_going_rule_id = v_facts.o_early_going_rule_id,
      overtime_minutes = v_facts.o_overtime_minutes,
      overtime_rule_id = v_facts.o_overtime_rule_id,
      extra_duty_value = v_facts.o_extra_duty_value,
      night_ot_minutes = v_facts.o_night_ot_minutes,
      extended_duty_rule_id = v_facts.o_extended_duty_rule_id,
      half_day_reason = coalesce(v_facts.o_half_day_reason, v_record.half_day_reason),
      status = v_facts.o_status,
      source = 'web',
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_record.id
  returning * into v_record;

  v_shift_end_at := (current_date + v_shift.end_time) at time zone 'Asia/Kolkata';
  perform public.ensure_night_duty_approval(
    v_record.company_id, v_employee_id, v_record.id, current_date, v_shift_end_at, v_now,
    v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes
  );

  return v_record;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- attendance_admin_punch(): both branches use the shared engine
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
          status = case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end,
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
        case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end, 'admin', p_remark, auth.uid(), auth.uid()
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
        working_minutes = v_facts.o_working_minutes,
        early_going_minutes = v_facts.o_early_going_minutes,
        early_going_rule_id = v_facts.o_early_going_rule_id,
        overtime_minutes = v_facts.o_overtime_minutes,
        overtime_rule_id = v_facts.o_overtime_rule_id,
        extra_duty_value = v_facts.o_extra_duty_value,
        night_ot_minutes = v_facts.o_night_ot_minutes,
        extended_duty_rule_id = v_facts.o_extended_duty_rule_id,
        half_day_reason = coalesce(v_facts.o_half_day_reason, v_existing.half_day_reason),
        status = v_facts.o_status,
        source = 'admin',
        remarks = coalesce(p_remark, remarks),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    v_shift_end_at := (current_date + v_shift.end_time) at time zone 'Asia/Kolkata';
    perform public.ensure_night_duty_approval(
      v_employee.company_id, v_employee.id, v_existing.id, current_date, v_shift_end_at, v_now,
      v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes
    );

    insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
    values (v_employee.company_id, v_employee.id, v_existing.id, 'punch_out', 'admin', auth.uid(), v_note);

    return v_existing;
  end if;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- attendance_admin_upsert(): full pipeline, explicit status/day-type override
-- for Leave/Holiday, existing validation/history-immutability unchanged
-- ---------------------------------------------------------------------------
create or replace function public.attendance_admin_upsert(
  p_employee_id uuid,
  p_attendance_date date,
  p_status text,
  p_punch_in_time time default null,
  p_punch_out_time time default null,
  p_remark text default null,
  p_use_information boolean default false
)
returns public.attendance_records as $$
declare
  v_employee record;
  v_shift public.attendance_shifts%rowtype;
  v_assignment record;
  v_existing public.attendance_records%rowtype;
  v_punch_in_at timestamptz;
  v_punch_out_at timestamptz;
  v_facts record;
  v_day_type_override text;
  v_final_status text;
  v_shift_end_at timestamptz;
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

  v_day_type_override := case when p_status in ('leave', 'holiday') then p_status else null end;

  select * into v_facts from public.compute_extended_attendance_facts(
    v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, p_attendance_date,
    v_punch_in_at, v_punch_out_at, coalesce(p_use_information, false), v_day_type_override
  );

  -- Super Admin's explicit status choice is authoritative and is NEVER silently overridden — the
  -- computed half_day_reason/status is still stored as an informational annotation either way, so
  -- the UI can show "half-day eligible by the rule" without forcing the final status.
  v_final_status := p_status;

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
    || ': ' || v_prev_status || ' -> ' || v_final_status || '.'
    || v_punch_in_note || v_punch_out_note || v_remark_note;

  if v_existing.id is not null then
    update public.attendance_records
    set status = v_final_status::public.attendance_status,
        shift_id = v_shift.id,
        punch_in_at = v_punch_in_at,
        punch_out_at = v_punch_out_at,
        working_minutes = v_facts.o_working_minutes,
        late_minutes = v_facts.o_late_minutes,
        late_rule_id = v_facts.o_late_rule_id,
        used_information = v_facts.o_used_information,
        information_rule_id = v_facts.o_information_rule_id,
        half_day_reason = v_facts.o_half_day_reason,
        half_day_rule_id = v_facts.o_half_day_rule_id,
        penalty_minutes = v_facts.o_penalty_minutes,
        penalty_rule_id = v_facts.o_penalty_rule_id,
        early_going_minutes = v_facts.o_early_going_minutes,
        early_going_rule_id = v_facts.o_early_going_rule_id,
        overtime_minutes = v_facts.o_overtime_minutes,
        overtime_rule_id = v_facts.o_overtime_rule_id,
        extra_duty_value = v_facts.o_extra_duty_value,
        night_ot_minutes = v_facts.o_night_ot_minutes,
        extended_duty_rule_id = v_facts.o_extended_duty_rule_id,
        source = 'admin',
        remarks = coalesce(p_remark, remarks),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;
  else
    insert into public.attendance_records (
      company_id, employee_id, store_id, attendance_date, shift_id,
      punch_in_at, punch_out_at, working_minutes, late_minutes, late_rule_id,
      used_information, information_rule_id, half_day_reason, half_day_rule_id,
      penalty_minutes, penalty_rule_id, early_going_minutes, early_going_rule_id,
      overtime_minutes, overtime_rule_id, extra_duty_value, night_ot_minutes, extended_duty_rule_id,
      status, source, remarks, created_by, updated_by
    ) values (
      v_employee.company_id, v_employee.id, v_employee.store_id, p_attendance_date, v_shift.id,
      v_punch_in_at, v_punch_out_at, v_facts.o_working_minutes, v_facts.o_late_minutes, v_facts.o_late_rule_id,
      v_facts.o_used_information, v_facts.o_information_rule_id, v_facts.o_half_day_reason, v_facts.o_half_day_rule_id,
      v_facts.o_penalty_minutes, v_facts.o_penalty_rule_id, v_facts.o_early_going_minutes, v_facts.o_early_going_rule_id,
      v_facts.o_overtime_minutes, v_facts.o_overtime_rule_id, v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_facts.o_extended_duty_rule_id,
      v_final_status::public.attendance_status, 'admin', p_remark, auth.uid(), auth.uid()
    ) returning * into v_existing;
  end if;

  if v_punch_out_at is not null then
    v_shift_end_at := (p_attendance_date + v_shift.end_time) at time zone 'Asia/Kolkata';
    perform public.ensure_night_duty_approval(
      v_employee.company_id, v_employee.id, v_existing.id, p_attendance_date, v_shift_end_at, v_punch_out_at,
      v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes
    );
  end if;

  insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
  values (v_employee.company_id, v_employee.id, v_existing.id, 'admin_correction', 'admin', auth.uid(), v_note);

  return v_existing;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- Night Duty approval decision — Super Admin only (per your explicit decision;
-- no Store Manager role exists yet). Never touches punch_out_at/working_minutes
-- /overtime_minutes/extra_duty_value/night_ot_minutes (the ACTUAL figures) —
-- Disallow recomputes into payable_working_minutes/payable_overtime_minutes/
-- payable_extra_duty_value using the manager-confirmed time instead.
-- ---------------------------------------------------------------------------
create or replace function public.attendance_night_duty_decide(
  p_approval_id uuid,
  p_decision text,
  p_manager_payable_out_time timestamptz default null,
  p_remark text default null
)
returns public.attendance_night_duty_approvals as $$
declare
  v_approval public.attendance_night_duty_approvals%rowtype;
  v_record public.attendance_records%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_ext record;
  v_payable_working int;
  v_note text;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can approve or disallow Night Duty.'
      using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'disallowed') then
    raise exception 'Invalid decision: must be approved or disallowed.';
  end if;

  select * into v_approval from public.attendance_night_duty_approvals where id = p_approval_id;
  if not found then
    raise exception 'Night Duty approval record was not found.';
  end if;

  select * into v_record from public.attendance_records where id = v_approval.attendance_record_id;
  if not found then
    raise exception 'The underlying attendance record was not found.';
  end if;

  if p_decision = 'disallowed' then
    if p_manager_payable_out_time is null then
      raise exception 'Please confirm the payable Out Time before disallowing Night Duty.';
    end if;
    if p_manager_payable_out_time < v_record.punch_in_at or p_manager_payable_out_time > v_approval.actual_punch_out_at then
      raise exception 'Payable Out Time must be between Punch In and the actual Punch Out.';
    end if;

    select * into v_shift from public.attendance_shifts where id = v_record.shift_id;

    select * into v_ext from public.calculate_extended_duty(
      v_record.extended_duty_rule_id, v_approval.attendance_date, v_approval.shift_end_at, p_manager_payable_out_time
    );

    v_payable_working := greatest(0, floor(extract(epoch from (p_manager_payable_out_time - v_record.punch_in_at)) / 60)::int - coalesce(v_shift.break_minutes, 0));

    update public.attendance_records
    set payable_working_minutes = v_payable_working,
        payable_overtime_minutes = v_ext.o_normal_ot_minutes + v_ext.o_night_ot_minutes,
        payable_extra_duty_value = v_ext.o_extra_duty_value,
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_record.id;

    v_note := 'Night Duty DISALLOWED for ' || to_char(v_approval.attendance_date, 'DD Mon YYYY')
      || '. Actual Punch Out ' || to_char(v_approval.actual_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
      || ', Manager Confirmed Payable Out ' || to_char(p_manager_payable_out_time at time zone 'Asia/Kolkata', 'HH12:MI AM') || '.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;
  else
    update public.attendance_records
    set payable_working_minutes = working_minutes,
        payable_overtime_minutes = coalesce(overtime_minutes, 0) + coalesce(night_ot_minutes, 0),
        payable_extra_duty_value = extra_duty_value,
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_record.id;

    v_note := 'Night Duty APPROVED for ' || to_char(v_approval.attendance_date, 'DD Mon YYYY')
      || '. Actual Punch Out ' || to_char(v_approval.actual_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM') || ' is payable.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;
  end if;

  update public.attendance_records set night_duty_approval_id = v_approval.id where id = v_record.id and night_duty_approval_id is null;

  update public.attendance_night_duty_approvals
  set approval_status = p_decision,
      manager_confirmed_payable_out_at = case when p_decision = 'disallowed' then p_manager_payable_out_time else null end,
      manager_remark = p_remark,
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  where id = p_approval_id
  returning * into v_approval;

  insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
  values (v_approval.company_id, v_approval.employee_id, v_approval.attendance_record_id, 'admin_correction', 'admin', auth.uid(), v_note);

  return v_approval;
end;
$$ language plpgsql security definer;

revoke all on function public.attendance_night_duty_decide(uuid, text, timestamptz, text) from public;
grant execute on function public.attendance_night_duty_decide(uuid, text, timestamptz, text) to authenticated;
