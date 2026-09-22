-- ============================================================================
-- Retail HRMS — Penalty + Extended Duty calculation functions
-- Migration 0044
--
-- calculate_penalty_minutes(): mirrors calculate_late_minutes()'s shape —
-- reuses apply_attendance_rounding is NOT needed here (penalty methods are
-- multiplier/fixed/slab, not a rounding concept), but follows the identical
-- "NULL/inactive rule => safe passthrough" discipline. Passthrough here is 0
-- (no penalty), not "actual", because no penalty concept existed in this
-- system before this migration — 0 is the true "nothing changes until
-- Super Admin configures it" default.
--
-- calculate_extended_duty(): OUT-params function computing Normal OT (capped
-- at the midnight threshold) and the Extended Duty ladder (extra-duty tier +
-- hourly OT within the current band) in one place, so the "no double OT for
-- the same period" guarantee lives in exactly one function, not duplicated
-- across every call site. NULL/inactive rule => Normal OT uncapped (the
-- pre-existing Shift-End-based behaviour), zero Extended Duty — legacy-safe.
-- ============================================================================

create or replace function public.calculate_penalty_minutes(
  p_penalty_rule_id uuid,
  p_actual_late_minutes int
) returns int as $$
declare
  v_rule public.attendance_penalty_rules%rowtype;
  v_value int;
begin
  if p_actual_late_minutes is null or p_actual_late_minutes <= 0 then
    return 0;
  end if;

  if p_penalty_rule_id is null then
    return 0;
  end if;

  select * into v_rule from public.attendance_penalty_rules where id = p_penalty_rule_id;
  if not found or not v_rule.is_active then
    return 0;
  end if;

  case v_rule.method
    when 'none' then
      v_value := 0;
    when 'actual' then
      v_value := p_actual_late_minutes;
    when 'double' then
      v_value := p_actual_late_minutes * 2;
    when '1.5x' then
      v_value := ceil(p_actual_late_minutes * 1.5)::int;
    when '2x' then
      v_value := p_actual_late_minutes * 2;
    when 'fixed' then
      v_value := coalesce(v_rule.fixed_minutes, 0);
    when 'custom_fixed' then
      v_value := coalesce(v_rule.fixed_minutes, 0);
    when 'custom_multiplier' then
      v_value := ceil(p_actual_late_minutes * coalesce(v_rule.multiplier, 1))::int;
    when 'slab' then
      select t.calculated_minutes into v_value
      from public.attendance_penalty_rule_thresholds t
      where t.penalty_rule_id = v_rule.id
        and t.from_minutes <= p_actual_late_minutes
        and (t.to_minutes is null or t.to_minutes >= p_actual_late_minutes)
      order by t.from_minutes desc
      limit 1;
      if v_value is null then
        v_value := p_actual_late_minutes; -- no slab covers this value: fall back, never silently zero it
      end if;
    else
      v_value := p_actual_late_minutes;
  end case;

  return greatest(0, v_value);
end;
$$ language plpgsql stable;

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
    o_extra_duty_value := v_rule.second_day_extra_duty_value;
    o_night_ot_minutes := 0; -- documented cap: no further hourly window is defined past the second threshold
  end if;

  o_night_ot_minutes := public.apply_attendance_rounding(o_night_ot_minutes, v_rule.hourly_ot_rounding_method, v_rule.hourly_ot_custom_rounding_minutes);
end;
$$ language plpgsql stable;
