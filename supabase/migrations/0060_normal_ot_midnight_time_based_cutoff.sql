-- ============================================================================
-- Retail HRMS — Normal OT vs Extended Duty: TIME-BASED midnight cutoff (supersedes 0059)
-- Migration 0060
--
-- ROOT CAUSE (in the version migration 0059 left live): calculate_extended_duty() forced
-- o_normal_ot_minutes := 0 UNCONDITIONALLY the moment any active Extended Duty Rule was resolved
-- for the shift — with no comparison against the midnight threshold at all. That satisfied the
-- "no double counting at/after midnight" requirement but incorrectly also zeroed Normal OT for
-- punch-outs BEFORE midnight (e.g. 8:30 PM, 11:59 PM), which must still earn Normal OT normally.
--
-- CORRECTED RULE (time-based, exactly as specified):
--   Punch Out <  next calendar midnight -> Normal OT = Punch Out - Shift End (uncapped, normal).
--                                           Extra Duty = 0. No Extended Duty ladder involvement.
--   Punch Out >= next calendar midnight -> Normal OT = 0. Extended Duty / Extra Duty ladder
--                                           applies (Shift End -> Midnight folds into the Extra
--                                           Duty Value tier; Midnight -> Punch Out is the hourly
--                                           Post-Midnight OT).
--
-- "Next calendar midnight" is unchanged from before — always the midnight immediately following
-- attendance_date, at the configured midnight_threshold_time (normally 00:00), completely
-- independent of the shift's own end time. This already works for ANY shift (10AM-8PM, 11AM-9PM,
-- 12PM-10PM, 9AM-6PM, ...) because p_shift_end_at is a parameter — never hardcoded — and the shift
-- used is always the one resolved for that specific attendance_records row (v_record.shift_id /
-- the effective-dated employee_shift_assignments lookup at punch-in time), never "today's" shift
-- definition. That resolution mechanism is untouched by this migration.
--
-- Ladder thresholds (midnight/first-day/second-day) are completely untouched — byte-for-byte
-- identical to migration 0044/0059. Only the o_normal_ot_minutes assignment and its now-explicit
-- midnight-time-based branch change.
-- ============================================================================

create or replace function public.calculate_extended_duty(
  p_extended_duty_rule_id uuid,
  p_attendance_date date,
  p_shift_end_at timestamptz,
  p_punch_out_at timestamptz,
  out o_normal_ot_minutes int,
  out o_extra_duty_value numeric,
  out o_night_ot_minutes int
) as $$
declare
  v_rule public.attendance_extended_duty_rules%rowtype;
  v_midnight_at timestamptz;
  v_first_day_at timestamptz;
  v_second_day_at timestamptz;
begin
  o_normal_ot_minutes := 0;
  o_extra_duty_value := 0;
  o_night_ot_minutes := 0;

  if p_punch_out_at is null or p_shift_end_at is null then
    return;
  end if;

  if p_extended_duty_rule_id is null then
    -- No Extended Duty rule configured: legacy behaviour — Normal OT uncapped, no Extended Duty.
    -- UNCHANGED.
    o_normal_ot_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_shift_end_at)) / 60)::int);
    return;
  end if;

  select * into v_rule from public.attendance_extended_duty_rules where id = p_extended_duty_rule_id;
  if not found or not v_rule.is_active then
    -- Rule id given but not found/inactive: same legacy fallback. UNCHANGED.
    o_normal_ot_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_shift_end_at)) / 60)::int);
    return;
  end if;

  -- "Midnight" for this work session is the midnight immediately following attendance_date — the
  -- night between attendance_date and attendance_date+1 — regardless of the configured clock time,
  -- and completely independent of the shift's own end time. UNCHANGED.
  v_midnight_at := ((p_attendance_date + 1) + v_rule.midnight_threshold_time) at time zone 'Asia/Kolkata';
  v_first_day_at := ((p_attendance_date + 1) + v_rule.first_day_salary_threshold_time) at time zone 'Asia/Kolkata';
  v_second_day_at := ((p_attendance_date + 1) + v_rule.second_day_salary_threshold_time) at time zone 'Asia/Kolkata';

  -- CHANGED (this migration): TIME-BASED cutoff, not an unconditional zero.
  if p_punch_out_at < v_midnight_at then
    -- BEFORE midnight: Normal OT works normally, no Extended Duty involvement at all.
    o_normal_ot_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_shift_end_at)) / 60)::int);
    o_extra_duty_value := 0;
    o_night_ot_minutes := 0;
  else
    -- AT/AFTER midnight: Normal OT stops completely; the Shift-End -> Midnight span folds into the
    -- Extra Duty Value tier below (never re-counted as Normal OT), and only time AFTER midnight is
    -- eligible for the hourly Post-Midnight OT.
    o_normal_ot_minutes := 0;

    if p_punch_out_at < v_first_day_at then
      o_extra_duty_value := v_rule.midnight_extra_duty_value;
      o_night_ot_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - v_midnight_at)) / 60)::int);
    elsif p_punch_out_at < v_second_day_at then
      o_extra_duty_value := v_rule.first_day_extra_duty_value;
      o_night_ot_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - v_first_day_at)) / 60)::int);
    else
      o_extra_duty_value := v_rule.second_day_extra_duty_value;
      o_night_ot_minutes := 0; -- documented cap: no further hourly window is defined past the second threshold
    end if;

    o_night_ot_minutes := public.apply_attendance_rounding(o_night_ot_minutes, v_rule.hourly_ot_rounding_method, v_rule.hourly_ot_custom_rounding_minutes);
  end if;
end;
$$ language plpgsql stable;
