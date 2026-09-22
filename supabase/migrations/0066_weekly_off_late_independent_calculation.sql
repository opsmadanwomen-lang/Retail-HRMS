-- ============================================================================
-- Retail HRMS — Weekly Off Late must not be re-graced by the Normal Late Rule
-- (migration 0066)
--
-- ROOT CAUSE: compute_late_and_penalty_facts() already computed the correct
-- RAW Weekly Off lateness (punch_in - Weekly Off Late Rule's cutoff_time, 0 at
-- or under the cutoff) in its is_weekly_off branch. But the raw value was then
-- UNCONDITIONALLY passed through calculate_late_minutes(o_late_rule_id, ...)
-- using the NORMAL Late Rule (resolved via kind 'late') for every day type,
-- including weekly-off days. attendance_weekly_off_late_rules has no
-- calculation-method/rounding/min/max columns of its own — it was never meant
-- to go through that function at all. calculate_late_minutes() applies the
-- Normal Late Rule's own threshold gate ("raw <= minimum_late_minutes -> 0"),
-- so whenever a company's Normal Late Rule grace happened to be >= the Weekly
-- Off raw lateness (e.g. both configured to 10 minutes, as in the real
-- 04-Aug-2026 case), the correct Weekly Off Late value was silently zeroed by
-- an entirely unrelated rule's grace.
--
-- FIX: when the Weekly Off Late Rule actually governed this day's raw
-- lateness (o_is_weekly_off, a rule resolved, and the Half Day late-arrival
-- override did NOT separately fire), o_late_minutes is now the raw value
-- exactly as already computed by the Weekly Off Late Rule's own cutoff gate —
-- never re-run through calculate_late_minutes()/the Normal Late Rule. Every
-- other branch (normal day, Information/noon-cutoff day, or a weekly-off day
-- where Half Day's late-arrival override also fires) is completely
-- unchanged — still resolves the Normal Late Rule and calls
-- calculate_late_minutes() exactly as before.
--
-- o_late_rule_id is NOT changed to the Weekly Off Late Rule's id: attendance_
-- records.late_rule_id has a foreign key to attendance_late_rules only (the
-- Normal Late Rule catalog), and there is no separate weekly-off-late-rule-id
-- column on attendance_records to attribute it to instead — introducing one
-- would be a schema change beyond what this fix requires. o_late_rule_id
-- keeps resolving/storing the Normal Late Rule id exactly as before; only the
-- MINUTES value is corrected.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_late_and_penalty_facts(p_company_id uuid, p_employee_id uuid, p_shift_id uuid, p_store_id uuid, p_attendance_date date, p_punch_in_at timestamp with time zone, p_use_information boolean, p_day_type_override text DEFAULT NULL::text, OUT o_late_minutes integer, OUT o_late_rule_id uuid, OUT o_used_information boolean, OUT o_information_rule_id uuid, OUT o_is_weekly_off boolean, OUT o_half_day_late_coming boolean, OUT o_half_day_rule_id uuid, OUT o_penalty_minutes integer, OUT o_penalty_rule_id uuid)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  v_uses_weekly_off_rule boolean := false;
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
    v_uses_weekly_off_rule := true;
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
    -- Half Day's own late-arrival override supersedes the Weekly Off Late cutoff for this day's
    -- raw value (unchanged pre-existing behavior) -- so the raw value is no longer purely
    -- Weekly-Off-Late-Rule-derived; fall through to the Normal Late Rule calculation path below,
    -- exactly as before this migration.
    v_uses_weekly_off_rule := false;
  end if;

  o_late_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'late');

  -- FIX (migration 0066): Weekly Off Late is an independent rule with no calculation-method/
  -- rounding/min-max configuration of its own -- its raw value (already correctly gated to 0 at
  -- or under the Weekly Off Late Rule's cutoff_time above) must be used exactly as computed, never
  -- re-run through calculate_late_minutes(), which applies the UNRELATED Normal Late Rule's own
  -- grace/rounding/caps and could incorrectly zero out or reshape an already-correct value.
  if v_uses_weekly_off_rule then
    o_late_minutes := v_raw_late;
  else
    o_late_minutes := public.calculate_late_minutes(o_late_rule_id, v_raw_late);
  end if;

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
