-- ============================================================================
-- Retail HRMS — Separate Total Working / Break Deduction / Final Working
-- Migration 0053
--
-- SUPERSEDES part of migration 0052: Weekly Off no longer skips the break deduction. Break
-- Deduction is now ALWAYS the shift's configured break_minutes whenever Punch In/Out both exist,
-- regardless of day type (Normal, Weekly Off, Holiday, On Duty, Work From Home, ...). What changes
-- is that the three quantities are now computed and STORED separately instead of only storing the
-- already-break-deducted figure:
--   Total Working  = punch_out - punch_in                         (raw span, every day type)
--   Break Deduction = shift.break_minutes                         (applied whenever punches exist)
--   Final Working  = max(0, Total Working - Break Deduction)      (same column as before: working_minutes)
--
-- Late/Overtime remain completely independent of Working/Break, exactly as before — this migration
-- does not touch how Late or Overtime are computed, only adds the two new stored/output figures and
-- reverts the Weekly-Off break skip. Late continues to be forced to 0 on Weekly Off (migration
-- 0052); this migration EXTENDS that same forced-0 treatment to Holiday too (new requirement:
-- "Holiday Late/OT behaviour follows the Weekly Off rule") by threading a day-type override into
-- compute_late_and_penalty_facts() — previously only compute_extended_attendance_facts()'s Overtime
-- gate knew about day type at all. Holiday is only reachable via attendance_admin_upsert(), the only
-- RPC that can set p_status = 'holiday'; self-service punch-in/out never passes a day-type override
-- and is unaffected by this addition.
--
-- attendance_records gains two nullable columns (total_working_minutes, break_deduction_minutes) —
-- purely additive, no existing column dropped or renamed, no historical row touched.
-- ============================================================================

alter table public.attendance_records
  add column if not exists total_working_minutes integer,
  add column if not exists break_deduction_minutes integer;

comment on column public.attendance_records.total_working_minutes is 'Raw Punch Out - Punch In, before any break deduction. Always populated whenever both punches exist, for every day type.';
comment on column public.attendance_records.break_deduction_minutes is 'The break duration actually deducted to arrive at working_minutes (Final Working). Currently always the assigned shift''s break_minutes when both punches exist.';
comment on column public.attendance_records.working_minutes is 'Final Working = total_working_minutes - break_deduction_minutes (floored at 0).';

-- ---------------------------------------------------------------------------
-- compute_late_and_penalty_facts(): add p_day_type_override so Holiday can be forced to Late=0,
-- exactly mirroring how Weekly Off already is. Appended as a new, defaulted, final IN parameter —
-- existing 7-positional-argument callers (attendance_punch_in) resolve correctly against the new
-- signature since the 8th parameter defaults to null. Dropped and recreated (not CREATE OR REPLACE)
-- since the old 7-argument signature is a distinct overload identity to Postgres.
-- ---------------------------------------------------------------------------
drop function if exists public.compute_late_and_penalty_facts(uuid, uuid, uuid, uuid, date, timestamptz, boolean);

create or replace function public.compute_late_and_penalty_facts(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_punch_in_at timestamptz,
  p_use_information boolean,
  p_day_type_override text default null,
  out o_late_minutes integer,
  out o_late_rule_id uuid,
  out o_used_information boolean,
  out o_information_rule_id uuid,
  out o_is_weekly_off boolean,
  out o_half_day_late_coming boolean,
  out o_half_day_rule_id uuid,
  out o_penalty_minutes integer,
  out o_penalty_rule_id uuid
)
returns record
language plpgsql
security definer
as $function$
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
  v_day_type text;
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
  v_day_type := coalesce(p_day_type_override, case when o_is_weekly_off then 'weekly_off' else 'normal' end);

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
    if v_punch_in_ist_time <= v_late_base_time then
      v_raw_late := 0;
    else
      v_raw_late := floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int;
    end if;
  else
    v_late_base_time := v_shift.start_time;
    v_raw_late := greatest(0, floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int);
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

  -- Late is ALWAYS 0 on Weekly Off (migration 0052) AND now Holiday (this migration — "Holiday
  -- Late/OT behaviour follows the Weekly Off rule"), in addition to Late Eligible = No.
  if not coalesce(v_shift.late_eligible, true) or v_day_type in ('weekly_off', 'holiday') then
    o_late_minutes := 0;
    o_half_day_late_coming := false;
    o_penalty_minutes := 0;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- compute_extended_attendance_facts(): thread p_day_type_override into
-- compute_late_and_penalty_facts(); add o_total_working_minutes / o_break_deduction_minutes;
-- Break Deduction now ALWAYS applies (no more Weekly-Off skip) whenever both punches exist.
-- The OUT-parameter row type is changing (two new fields), which Postgres does not allow via
-- CREATE OR REPLACE — the function must be dropped and recreated.
-- ---------------------------------------------------------------------------
drop function if exists public.compute_extended_attendance_facts(uuid, uuid, uuid, uuid, date, timestamptz, timestamptz, boolean, text);

create or replace function public.compute_extended_attendance_facts(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_punch_in_at timestamptz,
  p_punch_out_at timestamptz,
  p_use_information boolean,
  p_day_type_override text,
  out o_status text,
  out o_late_minutes integer,
  out o_late_rule_id uuid,
  out o_used_information boolean,
  out o_information_rule_id uuid,
  out o_half_day_reason text,
  out o_half_day_rule_id uuid,
  out o_penalty_minutes integer,
  out o_penalty_rule_id uuid,
  out o_total_working_minutes integer,
  out o_break_deduction_minutes integer,
  out o_working_minutes integer,
  out o_early_going_minutes integer,
  out o_early_going_rule_id uuid,
  out o_overtime_minutes integer,
  out o_overtime_rule_id uuid,
  out o_extra_duty_value numeric,
  out o_night_ot_minutes integer,
  out o_extended_duty_rule_id uuid
)
returns record
language plpgsql
security definer
as $function$
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
    p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, p_punch_in_at, p_use_information, p_day_type_override
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

  o_total_working_minutes := null;
  o_break_deduction_minutes := null;
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

  -- CHANGED (this migration): Total Working / Break Deduction / Final Working are now three
  -- separate figures, ALWAYS computed the same way regardless of day type (Normal, Weekly Off,
  -- Holiday, On Duty, Work From Home, ...) whenever both punches exist. Break Deduction is no
  -- longer skipped on Weekly Off (that was migration 0052's rule; this migration supersedes it).
  o_total_working_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_punch_in_at)) / 60)::int);
  o_break_deduction_minutes := coalesce(v_shift.break_minutes, 0);
  o_working_minutes := greatest(0, o_total_working_minutes - o_break_deduction_minutes);

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
      v_raw_early_going := floor(extract(epoch from (v_shift.end_time - v_punch_out_ist_time)) / 60)::int;
      if v_raw_early_going < coalesce(v_early_going_rule.grace_minutes, 0) then
        v_raw_early_going := 0;
      end if;
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

  -- Overtime is UNCHANGED by this migration: Shift-End-based (calculate_extended_duty,
  -- punch_out - shift_end), never derived from Working/Break, and gated by the applicable
  -- Overtime Rule's weekly_off_overtime_allowed / holiday_overtime_allowed flag via v_day_type.
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
$function$;
