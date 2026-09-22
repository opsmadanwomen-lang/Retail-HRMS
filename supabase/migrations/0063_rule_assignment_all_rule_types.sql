-- ============================================================================
-- Retail HRMS — Rule Assignments: extend to ALL 8 configurable rule types
-- Migration 0063
--
-- Extends the Store x Employee assignment model (migration 0062) from Late/Overtime-only to all
-- eight configurable attendance rules: Normal Late, Weekly Off Late, Information/Intimation,
-- Penalty, Half Day, Early Going, Normal Overtime, Extended Duty. Reuses the EXACT SAME
-- attendance_rule_assignments table and resolve_attendance_rule() — no second resolution engine,
-- no new table. Six new nullable rule-id columns are added, one per newly-assignable rule type;
-- each assignment ROW may set any subset of the eight rule-id columns (a row can assign ONLY
-- Penalty and leave the other seven untouched — enforced structurally: resolution for each kind
-- is independent, and an assignment row with e.g. penalty_rule_id set and late_rule_id NULL is
-- simply invisible to the 'late' resolution query, which only looks at rows where late_rule_id IS
-- NOT NULL).
--
-- CALCULATION SAFETY: the actual FORMULAS in compute_late_and_penalty_facts() and
-- compute_extended_attendance_facts() are completely unchanged. The ONLY thing that changes is
-- WHICH specific rule ROW is looked up for each of the 6 newly-assignable kinds (Information,
-- Weekly Off Late, Half Day, Penalty, Early Going, Extended Duty) — each lookup now tries
-- resolve_attendance_rule() first (Employee+Store > Store > All Stores priority, matching
-- Late/Overtime exactly) and, only if that finds nothing, falls back to the EXISTING company-wide
-- singleton lookup (byte-for-byte identical to before this migration). Once the correct rule row
-- is selected, every downstream calculation line is untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema: six new nullable rule-id columns + relaxed "at least one rule set" constraint.
-- ---------------------------------------------------------------------------
alter table public.attendance_rule_assignments
  add column if not exists information_rule_id uuid references public.attendance_information_rules (id) on delete set null,
  add column if not exists penalty_rule_id uuid references public.attendance_penalty_rules (id) on delete set null,
  add column if not exists half_day_rule_id uuid references public.attendance_half_day_rules (id) on delete set null,
  add column if not exists early_going_rule_id uuid references public.attendance_early_going_rules (id) on delete set null,
  add column if not exists extended_duty_rule_id uuid references public.attendance_extended_duty_rules (id) on delete set null,
  add column if not exists weekly_off_late_rule_id uuid references public.attendance_weekly_off_late_rules (id) on delete set null;

alter table public.attendance_rule_assignments drop constraint if exists attendance_rule_assignments_check1;
alter table public.attendance_rule_assignments add constraint attendance_rule_assignments_check1
  check (
    late_rule_id is not null or overtime_rule_id is not null or information_rule_id is not null
    or penalty_rule_id is not null or half_day_rule_id is not null or early_going_rule_id is not null
    or extended_duty_rule_id is not null or weekly_off_late_rule_id is not null
  );

-- ---------------------------------------------------------------------------
-- 2. resolve_attendance_rule(): generalized to all 8 rule kinds via a whitelisted column-name
--    dispatch (format('%I', ...) — v_column only ever comes from the hardcoded CASE below, never
--    from raw external input, so this is not a SQL-injection surface). Same 4-tier priority as
--    migration 0062, now shared by every rule kind instead of duplicated per-kind.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_attendance_rule(p_company_id uuid, p_employee_id uuid, p_shift_id uuid, p_store_id uuid, p_date date, p_kind text)
 returns uuid
 language plpgsql
 stable security definer
as $function$
declare
  v_rule_id uuid;
  v_scope text;
  v_scope_id uuid;
  v_column text;
begin
  v_column := case p_kind
    when 'late' then 'late_rule_id'
    when 'overtime' then 'overtime_rule_id'
    when 'information' then 'information_rule_id'
    when 'penalty' then 'penalty_rule_id'
    when 'half_day' then 'half_day_rule_id'
    when 'early_going' then 'early_going_rule_id'
    when 'extended_duty' then 'extended_duty_rule_id'
    when 'weekly_off_late' then 'weekly_off_late_rule_id'
    else null
  end;
  if v_column is null then
    raise exception 'resolve_attendance_rule: unknown rule kind %', p_kind;
  end if;

  -- Tier 1: store_employee, exact employee match (prefer a store-specific row over a
  -- store-agnostic one for the same employee, then most recent effective_from).
  execute format(
    'select %I from public.attendance_rule_assignments
       where company_id = $1 and scope_type = ''store_employee'' and employee_id = $2
         and (store_id is null or store_id = $3) and is_active and %I is not null
         and effective_from <= $4 and (effective_to is null or effective_to >= $4)
       order by (store_id is not null) desc, effective_from desc
       limit 1', v_column, v_column
  ) into v_rule_id using p_company_id, p_employee_id, p_store_id, p_date;
  if v_rule_id is not null then
    return v_rule_id;
  end if;

  -- Tier 2: store_employee, this store, ALL employees.
  if p_store_id is not null then
    execute format(
      'select %I from public.attendance_rule_assignments
         where company_id = $1 and scope_type = ''store_employee'' and store_id = $2 and employee_id is null
           and is_active and %I is not null
           and effective_from <= $3 and (effective_to is null or effective_to >= $3)
         order by effective_from desc
         limit 1', v_column, v_column
    ) into v_rule_id using p_company_id, p_store_id, p_date;
    if v_rule_id is not null then
      return v_rule_id;
    end if;
  end if;

  -- Tier 3: store_employee, ALL stores + ALL employees.
  execute format(
    'select %I from public.attendance_rule_assignments
       where company_id = $1 and scope_type = ''store_employee'' and store_id is null and employee_id is null
         and is_active and %I is not null
         and effective_from <= $2 and (effective_to is null or effective_to >= $2)
       order by effective_from desc
       limit 1', v_column, v_column
  ) into v_rule_id using p_company_id, p_date;
  if v_rule_id is not null then
    return v_rule_id;
  end if;

  -- Tier 4: legacy scope_type ladder (employee -> shift -> store -> company). Only Late and
  -- Overtime ever had rows in this legacy shape (migration 0039-era) — for every other kind this
  -- loop simply finds nothing and falls through, which is correct: those 6 rule types have their
  -- own pre-existing company-wide-singleton lookup as the ultimate fallback, wired directly into
  -- compute_late_and_penalty_facts()/compute_extended_attendance_facts() below, unchanged.
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

    execute format(
      'select %I from public.attendance_rule_assignments
         where company_id = $1 and scope_type = $2 and scope_id is not distinct from $3
           and is_active and %I is not null
           and effective_from <= $4 and (effective_to is null or effective_to >= $4)
         order by effective_from desc
         limit 1', v_column, v_column
    ) into v_rule_id using p_company_id, v_scope, v_scope_id, p_date;

    if v_rule_id is not null then
      return v_rule_id;
    end if;
  end loop;

  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. compute_late_and_penalty_facts(): wire Information, Weekly Off Late, Half Day, and Penalty
--    rule lookups through resolve_attendance_rule() first, falling back to the EXISTING
--    company-wide singleton lookup unchanged. Every other line — the noon-rule math, the Weekly
--    Off Case 1/Case 2 branch, the Half Day override, the Penalty priority gate, the final
--    Late-Eligible/Holiday zero-out — is byte-for-byte identical to the live migration-0060/0058
--    version fetched immediately before writing this migration.
-- ---------------------------------------------------------------------------
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
  v_wo_rule public.attendance_weekly_off_late_rules%rowtype;
  v_half_day_rule public.attendance_half_day_rules%rowtype;
  v_penalty_rule public.attendance_penalty_rules%rowtype;
  v_punch_in_ist_time time;
  v_uses_noon_rule boolean := false;
  v_late_base_time time;
  v_raw_late int;
  v_month_start date;
  v_month_end date;
  v_used_count int := 0;
  v_penalty_applicable boolean := false;
  v_day_type text;
  v_resolved_id uuid;
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

  -- CHANGED (this migration): try a Store/Employee-scoped Information Rule assignment first;
  -- fall back to the existing company-wide singleton lookup, unchanged, if none resolves.
  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'information');
  if v_resolved_id is not null then
    select * into v_info_rule from public.attendance_information_rules where id = v_resolved_id and is_active;
  end if;
  if v_info_rule.id is null then
    select * into v_info_rule
    from public.attendance_information_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
  o_information_rule_id := v_info_rule.id;

  if v_info_rule.id is not null then
    v_month_start := date_trunc('month', p_attendance_date)::date;
    v_month_end := (date_trunc('month', p_attendance_date) + interval '1 month - 1 day')::date;

    select count(*) into v_used_count
    from public.employee_information_usage
    where employee_id = p_employee_id
      and attendance_date >= v_month_start
      and attendance_date <= v_month_end;
  end if;

  if v_info_rule.id is not null and p_use_information then
    if v_used_count >= v_info_rule.monthly_limit then
      raise exception 'No Information/Intimation remaining for this month (limit %).', v_info_rule.monthly_limit;
    end if;

    insert into public.employee_information_usage (company_id, employee_id, attendance_date, used_by)
    values (p_company_id, p_employee_id, p_attendance_date, auth.uid())
    on conflict (employee_id, attendance_date) do nothing;

    o_used_information := true;
  end if;

  v_uses_noon_rule := v_info_rule.id is not null and o_used_information;

  -- CHANGED (this migration): same resolve-first, fallback-to-singleton pattern for Weekly Off
  -- Late Rule.
  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'weekly_off_late');
  if v_resolved_id is not null then
    select * into v_wo_rule from public.attendance_weekly_off_late_rules where id = v_resolved_id and is_active;
  end if;
  if v_wo_rule.id is null then
    select * into v_wo_rule
    from public.attendance_weekly_off_late_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;

  if o_is_weekly_off and v_wo_rule.id is not null then
    v_late_base_time := v_wo_rule.cutoff_time;
    if v_punch_in_ist_time <= v_late_base_time then
      v_raw_late := 0;
    else
      v_raw_late := floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int;
    end if;
  elsif v_uses_noon_rule then
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

  -- CHANGED (this migration): same resolve-first, fallback-to-singleton pattern for Half Day Rule.
  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'half_day');
  if v_resolved_id is not null then
    select * into v_half_day_rule from public.attendance_half_day_rules where id = v_resolved_id and is_active;
  end if;
  if v_half_day_rule.id is null then
    select * into v_half_day_rule
    from public.attendance_half_day_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
  o_half_day_rule_id := v_half_day_rule.id;

  if v_half_day_rule.id is not null and v_punch_in_ist_time >= v_half_day_rule.late_arrival_cutoff_time then
    o_half_day_late_coming := true;
    v_raw_late := greatest(0, floor(extract(epoch from (v_punch_in_ist_time - v_half_day_rule.late_arrival_cutoff_time)) / 60)::int);
  end if;

  o_late_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'late');
  o_late_minutes := public.calculate_late_minutes(o_late_rule_id, v_raw_late);

  -- CHANGED (this migration): same resolve-first, fallback-to-singleton pattern for Penalty Rule.
  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'penalty');
  if v_resolved_id is not null then
    select * into v_penalty_rule from public.attendance_penalty_rules where id = v_resolved_id and is_active;
  end if;
  if v_penalty_rule.id is null then
    select * into v_penalty_rule
    from public.attendance_penalty_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
  o_penalty_rule_id := v_penalty_rule.id;

  if v_penalty_rule.id is not null and o_late_minutes > 0 then
    if o_half_day_late_coming then
      v_penalty_applicable := false;
    elsif o_is_weekly_off then
      v_penalty_applicable := coalesce(v_penalty_rule.apply_on_weekly_off, false);
    elsif v_uses_noon_rule then
      v_penalty_applicable := coalesce(v_penalty_rule.apply_on_information_day, false);
    else
      v_penalty_applicable := case v_penalty_rule.applicability
        when 'every_late' then true
        when 'after_information_exhausted' then not v_uses_noon_rule
        when 'normal_day_only' then not v_uses_noon_rule and not o_is_weekly_off
        when 'information_day_after_cutoff' then v_uses_noon_rule
        when 'weekly_off' then o_is_weekly_off
        when 'half_day' then o_half_day_late_coming
        else true
      end;
    end if;

    if v_penalty_applicable then
      o_penalty_minutes := public.calculate_penalty_minutes(o_penalty_rule_id, o_late_minutes);
    end if;
  end if;

  if not coalesce(v_shift.late_eligible, true) or v_day_type = 'holiday' then
    o_late_minutes := 0;
    o_half_day_late_coming := false;
    o_penalty_minutes := 0;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. compute_extended_attendance_facts(): wire Half Day (2nd, independent lookup), Early Going,
--    and Extended Duty rule lookups the same way. Every other line — Total/Break/Final Working,
--    the Half-Day-early-going override, Overtime's own resolve_attendance_rule('overtime') call —
--    is byte-for-byte identical to the live version fetched immediately before writing this
--    migration.
-- ---------------------------------------------------------------------------
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
  v_resolved_id uuid;
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

  -- CHANGED (this migration): same resolve-first, fallback-to-singleton pattern for Half Day Rule
  -- (this function's OWN independent lookup, used for the early-going half-day check — separate
  -- from compute_late_and_penalty_facts()'s late-arrival half-day check above, exactly as before).
  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'half_day');
  if v_resolved_id is not null then
    select * into v_half_day_rule from public.attendance_half_day_rules where id = v_resolved_id and is_active;
  end if;
  if v_half_day_rule.id is null then
    select * into v_half_day_rule
    from public.attendance_half_day_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;

  if v_half_day_rule.id is not null and v_punch_out_ist_date = p_attendance_date and v_punch_out_ist_time <= v_half_day_rule.early_going_cutoff_time then
    v_is_half_day_early := true;
    if o_half_day_reason is null then
      o_half_day_reason := 'early_going';
    end if;
    o_status := 'half_day';
  end if;

  o_total_working_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_punch_in_at)) / 60)::int);
  o_break_deduction_minutes := coalesce(v_shift.break_minutes, 0);
  o_working_minutes := greatest(0, o_total_working_minutes - o_break_deduction_minutes);

  -- CHANGED (this migration): same resolve-first, fallback-to-singleton pattern for Early Going Rule.
  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'early_going');
  if v_resolved_id is not null then
    select * into v_early_going_rule from public.attendance_early_going_rules where id = v_resolved_id and is_active;
  end if;
  if v_early_going_rule.id is null then
    select * into v_early_going_rule
    from public.attendance_early_going_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
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

  -- CHANGED (this migration): same resolve-first, fallback-to-singleton pattern for Extended Duty
  -- Rule.
  v_extended_duty_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'extended_duty');
  if v_extended_duty_rule_id is not null then
    if not exists (select 1 from public.attendance_extended_duty_rules where id = v_extended_duty_rule_id and is_active) then
      v_extended_duty_rule_id := null;
    end if;
  end if;
  if v_extended_duty_rule_id is null then
    select id into v_extended_duty_rule_id
    from public.attendance_extended_duty_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
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
$function$;
