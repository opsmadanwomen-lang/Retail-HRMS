-- ============================================================================
-- Retail HRMS — Weekly Off Late is conditional on Information availability
-- Migration 0056
--
-- FINAL CORRECTION (supersedes part of migrations 0052/0053's "Late is ALWAYS 0 on Weekly Off"):
-- The Weekly Off 12:00 PM noon-cutoff benefit is NOT unconditional. It only applies when the
-- employee actually has an Information credit remaining for the month:
--
--   CASE 1 — Information available (remaining > 0):
--     Late Base = the Information Rule's cutoff_time (12:00 PM by default).
--     Punch In <= cutoff  -> Late = 0 (nothing to cover, nothing consumed).
--     Punch In >  cutoff  -> raw Late = Punch In - cutoff; this lateness is then AUTOMATICALLY
--       covered by consuming one Information credit (employee_information_usage row inserted,
--       o_used_information = true) and the raw Late becomes 0. No explicit "use Information today"
--       toggle is required for this automatic Weekly-Off path — it always applies whenever
--       Information is available, mirroring how the noon-rule already applied automatically for
--       Weekly Off before this fix; what changes is that it now correctly checks availability
--       first, and now genuinely consumes the credit instead of granting the benefit for free.
--
--   CASE 2 — Information exhausted (remaining = 0, or no Information Rule at all):
--     The 12:00 PM cutoff does NOT apply. Late Base = Shift Start, exactly like a Normal day:
--     Late = Punch In - Shift Start, in FULL (never floored to 0, never capped) — this is the
--     literal fix: a Weekly-Off-worked employee with no Information left is no longer silently
--     forgiven all lateness; they are late by the full amount from Shift Start, same as any other
--     working day.
--
-- The explicit p_use_information = true path (an employee/admin actively choosing to spend an
-- Information credit on an ordinary Information Day) is completely UNCHANGED — it still validates
-- against the monthly limit and still raises if exhausted. This migration only changes the
-- AUTOMATIC Weekly-Off path's gating and consumption.
--
-- Holiday's "Late always 0" treatment (added in migration 0053, "Holiday Late/OT behaviour follows
-- the Weekly Off rule") is INTENTIONALLY left untouched by this migration — this message is
-- specifically about the Weekly-Off/Information interaction only, per its own explicit "Do not
-- modify other rules" instruction. Only 'weekly_off' is removed from the final forced-zero gate;
-- 'holiday' stays.
--
-- Nothing else changes: Half Day's late-arrival-cutoff override, Penalty's applicability switch,
-- calculate_late_minutes()'s threshold-gate (migration 0055), Early Going, Normal OT, Extended
-- Duty, Night Duty, and Working/Break/Final Working are all completely untouched — this function's
-- other branches are byte-for-byte identical to the live version before this migration.
-- ============================================================================

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

  -- Monthly usage-so-far is now computed UNCONDITIONALLY whenever an Information Rule exists (not
  -- only inside the explicit p_use_information branch) — the new Weekly-Off availability gate below
  -- needs to know "Information Remaining" regardless of whether an explicit use was requested.
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

  -- CHANGED (this migration): the automatic Weekly-Off branch now requires Information to actually
  -- be available (v_used_count < monthly_limit) BEFORE this punch. Previously it applied
  -- unconditionally whenever the rule was flagged applicable_on_weekly_off, regardless of quota.
  v_uses_noon_rule := v_info_rule.id is not null
    and (o_used_information or (o_is_weekly_off and v_info_rule.applicable_on_weekly_off and v_used_count < v_info_rule.monthly_limit));

  if v_uses_noon_rule then
    v_late_base_time := v_info_rule.cutoff_time;
    if v_punch_in_ist_time <= v_late_base_time then
      v_raw_late := 0;
    else
      v_raw_late := floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int;

      -- NEW: the automatic Weekly-Off path (distinct from the explicit p_use_information branch
      -- above, which already consumed+marked if it ran) genuinely consumes one Information credit
      -- to cover this lateness, and the covered lateness becomes 0 — exactly like a real used
      -- Information day, not a free pass.
      if not o_used_information and o_is_weekly_off and v_info_rule.applicable_on_weekly_off then
        insert into public.employee_information_usage (company_id, employee_id, attendance_date, used_by)
        values (p_company_id, p_employee_id, p_attendance_date, auth.uid())
        on conflict (employee_id, attendance_date) do nothing;
        o_used_information := true;
        v_raw_late := 0;
      end if;
    end if;
  else
    -- CASE 2 (this migration): Weekly Off with Information exhausted (or no Information Rule at
    -- all) falls through here — the SAME Shift-Start-based formula as a Normal day, in full.
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

  -- CHANGED (this migration): 'weekly_off' REMOVED from this forced-zero list — Weekly Off Late is
  -- now entirely determined by the Case 1 / Case 2 logic above (0 when Information covers it or
  -- punch is within the noon cutoff; the FULL Shift-Start-based value when Information is
  -- exhausted). 'holiday' is intentionally left untouched (out of scope for this fix) and
  -- Late Eligible = No still forces 0 regardless of day type.
  if not coalesce(v_shift.late_eligible, true) or v_day_type = 'holiday' then
    o_late_minutes := 0;
    o_half_day_late_coming := false;
    o_penalty_minutes := 0;
  end if;
end;
$function$;
