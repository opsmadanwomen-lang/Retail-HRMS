-- ============================================================================
-- Retail HRMS — Fix Late Rule "Minimum Late Minutes" semantics: threshold GATE, not a floor
-- Migration 0055
--
-- ROOT CAUSE (confirmed by reading the live function before changing anything):
-- calculate_late_minutes() — the ONE function every write path (attendance_punch_in,
-- attendance_punch_out, attendance_admin_punch, attendance_admin_upsert, all via
-- compute_late_and_penalty_facts) calls to turn raw lateness into the stored Late Minutes —
-- applied `v_value := greatest(v_value, v_rule.minimum_late_minutes)` AFTER slab/rounding. That is
-- a FLOOR: any nonzero-but-small raw lateness gets silently pushed UP to the configured minimum
-- (e.g. raw=9, minimum=10 -> stored 10). The business rule requires the opposite semantics: the
-- configured value is a GATE. At or under it, Late is 0. Beyond it, the FULL actual lateness from
-- Shift Start counts — never reduced to "just the excess", never floored up.
--
-- FIX: the gate check now happens FIRST, on the raw value, before any slab/rounding/cap logic:
--   if raw <= minimum_late_minutes: return 0
--   else: proceed with the full raw value through slab -> rounding -> maximum cap, exactly as before
--
-- Nothing else in this function changes. The Information/Weekly-Off noon-cutoff gate (a completely
-- separate mechanism inside compute_late_and_penalty_facts, using the Information Rule's own
-- cutoff_time, never minimum_late_minutes) is untouched — it already worked as a correct gate and
-- was never part of this bug. Half Day's late-arrival-cutoff override and Penalty (which is always
-- derived from the FINAL calculated Late, unchanged) are both untouched — they call this same
-- function, so they inherit the fix automatically without any code change of their own.
--
-- The `minimum_late_minutes` DATABASE COLUMN is NOT renamed (safest approach — no schema
-- disruption, no historical-data risk) — only its semantics (this function) and its UI label
-- change.
-- ============================================================================

create or replace function public.calculate_late_minutes(p_late_rule_id uuid, p_raw_late_minutes integer)
returns integer
language plpgsql
stable
as $function$
declare
  v_rule public.attendance_late_rules%rowtype;
  v_value int;
  v_raw int;
begin
  if p_raw_late_minutes is null then
    return null;
  end if;

  if p_late_rule_id is null then
    return greatest(0, p_raw_late_minutes);
  end if;

  select * into v_rule from public.attendance_late_rules where id = p_late_rule_id;
  if not found or not v_rule.is_active then
    return greatest(0, p_raw_late_minutes);
  end if;

  v_raw := greatest(0, p_raw_late_minutes);

  -- THRESHOLD GATE (this migration's fix): at/under the configured value, Late is 0. Beyond it,
  -- the full raw value proceeds unreduced into slab/rounding/cap below. Never
  -- `greatest(value, minimum)`, never `raw - minimum`.
  if v_raw <= v_rule.minimum_late_minutes then
    return 0;
  end if;

  v_value := v_raw;

  if v_rule.calculation_method = 'slab' then
    select t.calculated_minutes into v_value
    from public.attendance_late_rule_thresholds t
    where t.late_rule_id = v_rule.id
      and t.from_minutes <= v_raw
      and (t.to_minutes is null or t.to_minutes >= v_raw)
    order by t.from_minutes desc
    limit 1;
    if v_value is null then
      v_value := v_raw; -- no slab covers this value: fall back, never silently zero it
    end if;
  end if;

  v_value := public.apply_attendance_rounding(v_value, v_rule.rounding_method, v_rule.custom_rounding_minutes);
  if v_rule.maximum_late_minutes is not null then
    v_value := least(v_value, v_rule.maximum_late_minutes);
  end if;

  return greatest(0, v_value);
end;
$function$;
