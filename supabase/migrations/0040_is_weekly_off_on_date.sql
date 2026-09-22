-- ============================================================================
-- Retail HRMS — SQL weekly-off resolver (server-side counterpart of the
-- existing TS isWeeklyOffOnDate)
-- Migration 0040
--
-- WHY: src/lib/weeklyOffResolver.ts's isWeeklyOffOnDate() already resolves
-- "was this date a weekly off for this employee" correctly (override
-- priority, then the historical employee_weekly_off_history period covering
-- the date) but only exists in TypeScript, used for display. Migration 0041
-- needs the identical algorithm server-side so attendance_punch_out() /
-- attendance_admin_punch() / attendance_admin_upsert() can resolve the
-- correct day type (for Overtime Rule's Weekly-Off-Allowed gate) using the
-- WEEKLY OFF THAT APPLIED ON THE ATTENDANCE DATE — never today's.
--
-- This is the SQL half of one authoritative algorithm; the TS half
-- (weeklyOffResolver.ts) is unchanged and remains the source for the read
-- side. Both implement the identical three-step priority:
--   1. An override naming this exact date as the NEW off day       -> true
--   2. An override naming this exact date as the ORIGINAL off day  -> false
--   3. The recurring weekly-off pattern in effect on this date
-- Additive only — no existing table/row is touched.
-- ============================================================================

create or replace function public.is_weekly_off_on_date(p_employee_id uuid, p_date date)
returns boolean as $$
declare
  v_weekly_off_day int;
begin
  if exists (
    select 1 from public.weekly_off_overrides
    where employee_id = p_employee_id and new_off_date = p_date
  ) then
    return true;
  end if;

  if exists (
    select 1 from public.weekly_off_overrides
    where employee_id = p_employee_id and original_off_date = p_date
  ) then
    return false;
  end if;

  select weekly_off_day into v_weekly_off_day
  from public.employee_weekly_off_history
  where employee_id = p_employee_id
    and is_active
    and effective_from <= p_date
    and (effective_to is null or effective_to >= p_date)
  order by effective_from desc
  limit 1;

  if v_weekly_off_day is null then
    return false;
  end if;

  -- extract(dow from date): 0 = Sunday .. 6 = Saturday, matching JS Date.getDay() exactly,
  -- and is a pure calendar calculation on a `date` value — no timezone involved.
  return extract(dow from p_date)::int = v_weekly_off_day;
end;
$$ language plpgsql stable security definer;
