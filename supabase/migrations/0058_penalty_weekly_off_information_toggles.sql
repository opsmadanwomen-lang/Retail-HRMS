-- ============================================================================
-- Retail HRMS — Penalty Rule: independent Weekly Off / Information Used Day toggles
-- Migration 0058
--
-- Adds two new, INDEPENDENT boolean settings to the Penalty Rule:
--   apply_on_weekly_off        -- Apply Penalty on Weekly Off (Yes/No)
--   apply_on_information_day   -- Apply Penalty on Information Used Day (Yes/No)
--
-- New penalty applicability priority (Half Day always wins, regardless of any setting):
--   1. Half Day (Late Arrival)     -> Penalty NEVER applies. Not configurable.
--   2. Weekly Off                  -> governed by apply_on_weekly_off alone.
--   3. Information Used Day        -> governed by apply_on_information_day alone
--                                      (explicit Information Day usage only — Weekly Off is
--                                      already handled by branch 2 above and never reaches this).
--   4. Normal Working Day          -> UNCHANGED. The existing `applicability` enum switch is kept
--                                      byte-for-byte identical and only reached once none of 1-3
--                                      apply — "do not change existing Normal Day Penalty logic"
--                                      is honoured literally: not one line of that switch changes.
--
-- Late itself is NEVER touched by this migration — Weekly Off Late Rule (migration 0057) and the
-- Information/Intimation noon-cutoff formula are completely unchanged. Only WHETHER a Penalty is
-- computed from an already-calculated Late value changes; the Late value itself never does.
--
-- DEFAULT for the two new columns is `true` — this preserves the CURRENT live behaviour for the
-- most common existing applicability setting ('after_information_exhausted', 'every_late'), which
-- already evaluates to Penalty-applies on both Weekly Off and Information Day lateness today
-- (since migration 0057 made v_uses_noon_rule false-on-Weekly-Off, 'after_information_exhausted'
-- => not v_uses_noon_rule => true there). Companies that want Penalty OFF for either day type must
-- explicitly turn the new toggle off — this is a one-time, reviewable default, not a silent
-- behaviour change for a specific outcome; flagged here for the Super Admin to review.
-- ============================================================================

alter table public.attendance_penalty_rules
  add column if not exists apply_on_weekly_off boolean not null default true,
  add column if not exists apply_on_information_day boolean not null default true;

comment on column public.attendance_penalty_rules.apply_on_weekly_off is
  'Independent Penalty applicability switch for Weekly Off lateness. Does NOT affect Weekly Off Late calculation — Late is always computed regardless of this setting.';
comment on column public.attendance_penalty_rules.apply_on_information_day is
  'Independent Penalty applicability switch for explicit Information Used Day lateness. Does NOT affect Late calculation — Late is always computed regardless of this setting.';

-- ---------------------------------------------------------------------------
-- compute_late_and_penalty_facts() — ONLY the penalty-applicability block changes. Late
-- calculation (all branches above it) is byte-for-byte identical to migration 0057.
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

  select * into v_wo_rule
  from public.attendance_weekly_off_late_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;

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

  -- CHANGED (this migration): Day-Type priority gate BEFORE the existing switch.
  --   1. Half Day always wins -> Penalty never applies, no exceptions, not configurable.
  --   2. Weekly Off -> apply_on_weekly_off alone decides (independent of Information entirely).
  --   3. Information Used Day (explicit use only) -> apply_on_information_day alone decides.
  --   4. Otherwise (plain Normal Day) -> the EXISTING applicability switch, byte-for-byte
  --      unchanged from before this migration.
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
