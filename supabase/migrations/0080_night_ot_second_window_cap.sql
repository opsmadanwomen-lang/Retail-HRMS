-- ============================================================================
-- Retail HRMS — FINAL Night Duty / Night OT business rule: second Night OT
-- window (08:00 reset, capped at a configurable end time, default 10:00)
-- Migration 0080
--
-- BACKGROUND: calculate_extended_duty() (migration 0044) already correctly
-- implements two of the three Night OT windows:
--   - Pre-02:00 (Midnight tier, 0.5 Day): Night OT = elapsed since midnight_threshold_time.
--   - 02:00-08:00 (First Day tier, 1 Day): Night OT = elapsed since first_day_salary_threshold_time.
-- Both already verified correct against every test case in the FINAL business
-- rule (01:30=90, 02:00=0, 03:00=60, 04:00=120, 07:59=359) — NEITHER is
-- touched by this migration.
--
-- THE BUG: the third branch (>= second_day_salary_threshold_time, "2 Days")
-- hard-coded Night OT to 0 for EVERY punch-out from 08:00 onward, per the
-- original (now superseded) design note "no further hourly window is defined
-- past the second threshold." The FINAL approved business rule requires a
-- second Night OT window here too: it resets to 0 exactly at
-- second_day_salary_threshold_time (08:00), then accrues 1:1 same as the
-- other two windows, capped once elapsed reaches a configurable end time
-- (default 10:00 -> 120 minutes) — Night Duty DAYS still stay at the "2 Days"
-- terminal tier throughout (untouched: extra_duty_value logic is not
-- changed by this migration at all).
--
-- New column `third_day_salary_threshold_time` (default '10:00:00', i.e. the
-- configured 120-minute cap for the live rule row) follows the exact same
-- configurable-column pattern as midnight/first_day/second_day — no
-- literal "120" is hard-coded into the function; the cap is a company-
-- configurable value like every other threshold in this ladder.
-- ============================================================================

alter table public.attendance_extended_duty_rules
  add column if not exists third_day_salary_threshold_time time not null default '10:00:00';

alter table public.attendance_extended_duty_rules
  drop constraint if exists attendance_extended_duty_rules_third_day_after_second_day;
alter table public.attendance_extended_duty_rules
  add constraint attendance_extended_duty_rules_third_day_after_second_day
  check (third_day_salary_threshold_time > second_day_salary_threshold_time);

comment on column public.attendance_extended_duty_rules.third_day_salary_threshold_time is
  'End of the second Night OT window (which starts at second_day_salary_threshold_time / resets to 0 there). Night OT accrued between second_day_salary_threshold_time and this time is payable; beyond this time it no longer increases. Night Duty Days (extra_duty_value) is unaffected — it stays at second_day_extra_duty_value ("2 Days") for any punch-out at or after second_day_salary_threshold_time, with no further tier.';

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
  v_third_day_at timestamptz;
begin
  o_normal_ot_minutes := 0;
  o_extra_duty_value := 0;
  o_night_ot_minutes := 0;

  if p_punch_out_at is null or p_shift_end_at is null then
    return;
  end if;

  if p_extended_duty_rule_id is null then
    -- No Extended Duty rule configured: legacy behaviour — Normal OT uncapped, no Extended Duty.
    o_normal_ot_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_shift_end_at)) / 60)::int);
    return;
  end if;

  select * into v_rule from public.attendance_extended_duty_rules where id = p_extended_duty_rule_id;
  if not found or not v_rule.is_active then
    o_normal_ot_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_shift_end_at)) / 60)::int);
    return;
  end if;

  -- "Midnight" for this work session is the midnight immediately following attendance_date — the
  -- night between attendance_date and attendance_date+1 — regardless of the configured clock time.
  v_midnight_at := ((p_attendance_date + 1) + v_rule.midnight_threshold_time) at time zone 'Asia/Kolkata';
  v_first_day_at := ((p_attendance_date + 1) + v_rule.first_day_salary_threshold_time) at time zone 'Asia/Kolkata';
  v_second_day_at := ((p_attendance_date + 1) + v_rule.second_day_salary_threshold_time) at time zone 'Asia/Kolkata';
  v_third_day_at := ((p_attendance_date + 1) + v_rule.third_day_salary_threshold_time) at time zone 'Asia/Kolkata';

  -- Normal OT: Shift End up to the midnight threshold, NEVER beyond it — this cap is what
  -- prevents double-counting with Extended Duty's hourly OT below, which only ever starts at this
  -- same instant.
  o_normal_ot_minutes := greatest(0, floor(extract(epoch from (least(p_punch_out_at, v_midnight_at) - p_shift_end_at)) / 60)::int);

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
    -- FINAL business rule (migration 0080): Night Duty Days stays at the "2 Days" terminal tier
    -- for any punch-out at or after v_second_day_at (unchanged). Night OT resets to 0 exactly at
    -- v_second_day_at and accrues again, capped at v_third_day_at (least(...), same idiom as Normal
    -- OT's cap above) — never a literal "120" in this function, purely the configured column.
    o_extra_duty_value := v_rule.second_day_extra_duty_value;
    o_night_ot_minutes := greatest(0, floor(extract(epoch from (least(p_punch_out_at, v_third_day_at) - v_second_day_at)) / 60)::int);
  end if;

  o_night_ot_minutes := public.apply_attendance_rounding(o_night_ot_minutes, v_rule.hourly_ot_rounding_method, v_rule.hourly_ot_custom_rounding_minutes);
end;
$$ language plpgsql stable;
