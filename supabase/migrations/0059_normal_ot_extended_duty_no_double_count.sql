-- ============================================================================
-- Retail HRMS — Normal OT / Extended Duty must be mutually exclusive
-- Migration 0059
--
-- ROOT CAUSE: calculate_extended_duty() computed
--   o_normal_ot_minutes := least(punch_out, midnight) - shift_end
-- UNCONDITIONALLY, even on the SAME branch that separately assigns o_extra_duty_value (0.5 Day /
-- 1 Day / 2 Days) for that exact Shift-End -> Midnight span once punch-out reaches midnight. The
-- existing comment claimed this cap "prevents double-counting with Extended Duty's hourly OT" —
-- true only for Normal OT vs. Night OT (post-midnight minutes), NOT for Normal OT vs. Extra Duty
-- Value, which is a second, independent compensation for the identical Shift-End -> Midnight
-- minutes. Example (Shift End 20:00, Punch Out 01:00 next day): Normal OT = 240 min (8PM-12AM) AND
-- Extra Duty Value = 0.5 Day (ALSO representing 8PM-12AM) were both being reported — the same 4
-- hours compensated twice, in two different units.
--
-- FIX: whenever a valid, active Extended Duty Rule applies to this shift, o_normal_ot_minutes is
-- now ALWAYS 0 — the entire Shift-End-onward span is governed exclusively by the Extended Duty /
-- Extra Duty domain (Shift-End -> Midnight folds into the Extra Duty Value tier; Midnight ->
-- Punch Out is the hourly Night OT). Normal OT only ever applies when NO Extended Duty Rule is
-- configured/active for this shift at all — that legacy, uncapped, Shift-End-based branch
-- (`p_extended_duty_rule_id is null` / rule not found / inactive) is COMPLETELY UNCHANGED, exactly
-- preserving today's behaviour for companies that don't use Extended Duty.
--
-- Verified against the exact business example (Shift 10:00-20:00, Punch Out 01:00 next day):
--   Normal OT = 0, Extra Duty Value = 0.5 Day, Post-Midnight OT = 60 min, Total Salary Duty = 1.5
--   Days. No minute is ever counted in two categories.
--
-- Ladder thresholds (midnight/first-day/second-day) are completely untouched — this migration only
-- changes what happens to o_normal_ot_minutes once an active rule is in play; the ladder itself
-- (which tier of Extra Duty Value / Night OT applies) is byte-for-byte identical to migration 0044.
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
    -- UNCHANGED by this migration.
    o_normal_ot_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_shift_end_at)) / 60)::int);
    return;
  end if;

  select * into v_rule from public.attendance_extended_duty_rules where id = p_extended_duty_rule_id;
  if not found or not v_rule.is_active then
    -- Rule id given but not found/inactive: same legacy fallback. UNCHANGED by this migration.
    o_normal_ot_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_shift_end_at)) / 60)::int);
    return;
  end if;

  -- "Midnight" for this work session is the midnight immediately following attendance_date — the
  -- night between attendance_date and attendance_date+1 — regardless of the configured clock time.
  v_midnight_at := ((p_attendance_date + 1) + v_rule.midnight_threshold_time) at time zone 'Asia/Kolkata';
  v_first_day_at := ((p_attendance_date + 1) + v_rule.first_day_salary_threshold_time) at time zone 'Asia/Kolkata';
  v_second_day_at := ((p_attendance_date + 1) + v_rule.second_day_salary_threshold_time) at time zone 'Asia/Kolkata';

  -- CHANGED (this migration): Normal OT is now ALWAYS 0 whenever an active Extended Duty Rule
  -- applies — the Shift-End -> Midnight span is exclusively represented by Extra Duty Value below
  -- (even when it evaluates to 0, e.g. punch-out never reaches midnight — that span simply isn't
  -- double-claimed as Normal OT either; it belongs entirely to the Extended Duty domain).
  o_normal_ot_minutes := 0;

  if p_punch_out_at < v_midnight_at then
    o_extra_duty_value := 0;
    o_night_ot_minutes := 0;
  elsif p_punch_out_at < v_first_day_at then
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
end;
$$ language plpgsql stable;
