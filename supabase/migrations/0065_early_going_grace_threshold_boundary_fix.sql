-- ============================================================================
-- Retail HRMS — Early Going Grace boundary fix (migration 0065)
--
-- CONFIRMED BY INVESTIGATION: Early Going Grace was ALREADY a threshold gate,
-- not a subtraction — compute_extended_attendance_facts() already did
-- "if raw <= grace then 0 else raw" in spirit, not "raw - grace". Aparna
-- Dutt's real 03-Aug-2026 record (punch out 20:02, shift end 20:30, raw=28,
-- grace=15) was already stored correctly as early_going_minutes = 28, live-
-- recomputation matches, and apply_attendance_rounding() has no subtraction
-- path either. There is no "28 -> 13" bug anywhere in the calculation engine.
--
-- The ONE real defect found: the threshold comparison used strict `<` instead
-- of `<=`, so a punch-out landing EXACTLY on the grace boundary (raw == grace)
-- was incorrectly left non-zero instead of being zeroed out. Example: grace=15,
-- punch out exactly 15 minutes early -> raw=15 -> old code: `15 < 15` is
-- false -> stayed 15 (WRONG, should be 0 per "punch out 08:15 PM -> Final
-- Early Going = 0" in the confirmed business rule). This migration changes
-- that one comparison from `<` to `<=` in compute_extended_attendance_facts().
-- Every other line is byte-for-byte unchanged from the live definition
-- fetched immediately before writing this migration. No other rule
-- (Late/Overtime/Weekly Off/Information/Penalty/Half Day/Extended Duty/
-- Working Hours/Break/Night Duty) is touched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_extended_attendance_facts(p_company_id uuid, p_employee_id uuid, p_shift_id uuid, p_store_id uuid, p_attendance_date date, p_punch_in_at timestamp with time zone, p_punch_out_at timestamp with time zone, p_use_information boolean, p_day_type_override text, OUT o_status text, OUT o_late_minutes integer, OUT o_late_rule_id uuid, OUT o_used_information boolean, OUT o_information_rule_id uuid, OUT o_half_day_reason text, OUT o_half_day_rule_id uuid, OUT o_penalty_minutes integer, OUT o_penalty_rule_id uuid, OUT o_total_working_minutes integer, OUT o_break_deduction_minutes integer, OUT o_working_minutes integer, OUT o_early_going_minutes integer, OUT o_early_going_rule_id uuid, OUT o_overtime_minutes integer, OUT o_overtime_rule_id uuid, OUT o_extra_duty_value numeric, OUT o_night_ot_minutes integer, OUT o_extended_duty_rule_id uuid)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  -- Half Day Rule lookup (used for the early-going half-day check) -- resolve-first, fallback-to-
  -- singleton pattern, unchanged from migration 0063.
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

  -- Early Going Rule lookup -- resolve-first, fallback-to-singleton pattern, unchanged from
  -- migration 0063.
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
      -- FIX (migration 0065): Grace is a THRESHOLD only -- punch-out landing EXACTLY on the grace
      -- boundary (raw == grace) must also zero out, per the confirmed business rule ("Punch Out
      -- 08:15 PM -> Raw=15 -> Final=0" for a 15-minute grace). Was `<`, now `<=`. Never subtracts
      -- grace from raw either way -- raw stays the full raw value once it exceeds grace.
      if v_raw_early_going <= coalesce(v_early_going_rule.grace_minutes, 0) then
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

  -- Extended Duty Rule lookup -- resolve-first, fallback-to-singleton pattern, unchanged from
  -- migration 0063.
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
