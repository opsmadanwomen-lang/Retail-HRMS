-- ============================================================================
-- 0184: Company OT + Late hourly basis  =  (Basic + DA) / CALENDAR days of the payroll period / standard hours per day
--
-- WHY: Payroll Rules -> Overtime valued payable OT minutes at Basic+DA / <proration divisor> / std hours. The divisor followed the
-- Proration method (calendar / working / 26 / 30 / custom), so choosing "Working days" silently changed the OT rate. The company rule
-- is the ACTUAL calendar days of the payroll month (Sep 30, Oct 31, Feb 28/29) and 10 hours/day, for BOTH Overtime and Late.
--
-- WHAT (additive; no history rewritten; no payroll run touched):
--   1. payroll_policies.late_deduction_enabled (default false)  - Late becomes a payroll deduction only when a policy opts in.
--      The hours/day value is the EXISTING effective-dated policy field ot_std_hours_per_day - it is NOT duplicated for Late.
--   2. payroll_ot_late_basis()  - the ONE place the formula lives. Payroll lines, the Payroll Preview and the Salary Structure Test all read it.
--   3. payroll_policy_compute_lines (+ p_late_minutes) : OT and Late both use it. Proration / LWP / Night Duty keep the policy proration divisor.
--      OT hours are no longer rounded to 2dp and the hourly rate is not rounded before multiplying; ONE rounding at the final amount.
--   4. payroll_apply_policy (+ p_late_minutes) : passes Late through, orders the LATE line, records the basis in the policy snapshot.
--   5. payroll_calculate_run : reads SUM(attendance_records.penalty_minutes) (the Attendance Penalty Rule output = chargeable late
--      minutes, incl. the Information exemption and the rule's fixed / multiplier / slab) and passes it on.
--   6. payroll_policy_preview : accepts 'late_minutes' and returns an 'ot_late_basis' block (Structure Test + Policy Preview screens).
--   7. Data: policies that were never configured (ot_std_hours_per_day IS NULL) and that no payroll result references get 10 hours/day.
--
-- NOT CHANGED: Attendance (OT / Late / Penalty rules), Leave, Advance, Salary Structures, PF/ESI/Medical Fund/Incentive, LWP, F&F
-- (fnf_calculate still calls compute_lines - its OT now uses the same basis; it passes no Late minutes, see the report).
-- Applied by hand, NEVER via 'supabase db push':   supabase db query --linked -f supabase/migrations/0184_company_ot_late_hourly_basis.sql
-- ============================================================================

alter table public.payroll_policies
  add column if not exists late_deduction_enabled boolean not null default false;
comment on column public.payroll_policies.late_deduction_enabled is 'Deduct Late from salary: attendance_records.penalty_minutes (Attendance Penalty Rule output) valued at (Basic+DA)/calendar days/ot_std_hours_per_day.';
comment on column public.payroll_policies.ot_std_hours_per_day is 'Company standard hours per day for the OT AND Late hourly basis: (Basic+DA) / calendar days of the payroll period / this value. The premium still comes from the Attendance OT Rule, not here.';

create or replace function public.payroll_ot_late_basis(p_policy_id uuid, p_period_start date, p_period_end date, p_basic numeric, p_da numeric)
returns table (calendar_days int, std_hours numeric, wage_base numeric, daily_rate numeric, hourly_rate numeric)
language sql stable security definer set search_path = public, pg_temp
as $fn$
  -- calendar_days = the payroll period's own start..end (NOT working days, NOT today, NOT the joining date). Nothing is rounded here.
  select d.days,
         s.h,
         w.base,
         case when d.days > 0 then w.base / d.days end,
         case when d.days > 0 and s.h is not null then w.base / d.days / s.h end
  from (select (p_period_end - p_period_start + 1) as days) d
  cross join (select nullif(coalesce((select pp.ot_std_hours_per_day from public.payroll_policies pp where pp.id = p_policy_id), 0), 0) as h) s
  cross join (select coalesce(p_basic, 0) + coalesce(p_da, 0) as base) w
$fn$;
revoke all on function public.payroll_ot_late_basis(uuid, date, date, numeric, numeric) from public, anon, authenticated;
grant execute on function public.payroll_ot_late_basis(uuid, date, date, numeric, numeric) to service_role;

-- ---------------------------------------------------------------- payroll_policy_compute_lines (signature widened => drop + recreate)
drop function if exists public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[], date, boolean, jsonb, jsonb, jsonb);
drop function if exists public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[], date, boolean, jsonb, jsonb, jsonb, numeric);   -- re-runnable
CREATE FUNCTION public.payroll_policy_compute_lines(p_policy_id uuid, p_period_start date, p_period_end date, p_working_days numeric, p_joining_date date, p_basic numeric, p_da numeric, p_gross numeric, p_lwp_days numeric, p_ot_minutes numeric, p_nd_value numeric, p_structure_id uuid DEFAULT NULL::uuid, p_existing_codes text[] DEFAULT '{}'::text[], p_leaving_date date DEFAULT NULL::date, p_exit_date_payable boolean DEFAULT NULL::boolean, p_tds jsonb DEFAULT NULL::jsonb, p_manual_components jsonb DEFAULT '{}'::jsonb, p_component_amounts jsonb DEFAULT '{}'::jsonb, p_late_minutes numeric DEFAULT 0)
 RETURNS TABLE(kind text, line_type text, code text, name text, quantity numeric, rate numeric, amount numeric, calc_type text, calc_base text, calc_note text, unresolved boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  p public.payroll_policies;
  v_days int := (p_period_end - p_period_start + 1);
  v_prec int;
  v_div numeric;
  v_base numeric;
  v_daily numeric;
  v_lost numeric;
  v_lost_join numeric := 0;
  v_hours numeric;
  b record;
  v_rate numeric;
  v_amt numeric;
  v_note text;
  r record;
  v_sbase numeric;
  v_has_struct_stat boolean;
  v_custom boolean;
  v_ccode text;
  v_cname text;
  v_clt text;
  v_cctype text;
  v_ferr text;
  v_el record;
  v_last_payable date;
  v_mkey text;
  v_man jsonb;
  v_emp_amt numeric;
  v_er_amt numeric;
  v_mnote text;
  v_munres boolean;
  v_refamt numeric;
begin
  select * into p from public.payroll_policies where id = p_policy_id;
  if p.id is null then return; end if;
  v_prec := coalesce(p.currency_precision, 2);

  v_div := case p.proration_method
    when 'calendar_days' then v_days
    when 'working_days'  then nullif(p_working_days, 0)
    when 'fixed_26'      then 26
    when 'fixed_30'      then 30
    when 'custom'        then p.proration_custom_divisor
    else null end;
  v_base := case p.proration_basis
    when 'basic'    then p_basic
    when 'basic_da' then p_basic + p_da
    when 'gross'    then p_gross
    when 'custom'   then public.payroll_eval_formula(p.proration_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross))
    else null end;

  -- ---- 1. Joining-month proration ----
  if p_joining_date is not null and p_joining_date > p_period_start then
    v_lost_join := (p_joining_date - p_period_start);
    if v_div is not null then v_lost_join := least(v_lost_join, v_div); end if;
    if v_lost_join > 0 then
      if p.proration_method is null or v_div is null or v_div = 0 or v_base is null then
        kind := 'earning_prorate'; line_type := 'earning'; code := 'PRORATE'; name := 'Joining-month proration';
        quantity := v_lost_join; rate := null; amount := 0; calc_type := 'proration'; calc_base := p.proration_basis;
        calc_note := format('Joined %s - %s day(s) not worked. Proration method/basis/divisor not configured.', p_joining_date, v_lost_join);
        unresolved := true; return next;
      else
        v_daily := round(v_base / v_div, 6);
        kind := 'earning_prorate'; line_type := 'earning'; code := 'PRORATE'; name := 'Joining-month proration';
        quantity := v_lost_join; rate := v_daily; amount := - round(v_daily * v_lost_join, v_prec); calc_type := 'proration';
        calc_base := p.proration_basis;
        calc_note := format('Joined %s - %s day(s) x daily %s (%s / %s, %s)', p_joining_date, v_lost_join, v_daily, v_base, v_div, p.proration_method);
        unresolved := false; return next;
      end if;
    end if;
  end if;

  -- ---- 1b. Exit-month proration (SAME engine, SAME policy) ----
  if p_leaving_date is not null and p_leaving_date < p_period_end then
    if p_exit_date_payable is null then
      kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
      quantity := (p_period_end - p_leaving_date); rate := null; amount := 0; calc_type := 'proration_exit'; calc_base := p.proration_basis;
      calc_note := format('Left %s - exit_date_payable not confirmed (business decision). No exit proration applied.', p_leaving_date);
      unresolved := true; return next;
    else
      v_last_payable := case when p_exit_date_payable then p_leaving_date else p_leaving_date - 1 end;
      v_lost := greatest(p_period_end - v_last_payable, 0);
      if v_div is not null then v_lost := least(v_lost, greatest(v_div - v_lost_join, 0)); end if;
      if v_lost > 0 then
        if p.proration_method is null or v_div is null or v_div = 0 or v_base is null then
          kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
          quantity := v_lost; rate := null; amount := 0; calc_type := 'proration_exit'; calc_base := p.proration_basis;
          calc_note := format('Left %s - %s day(s) after last payable day. Proration method/basis/divisor not configured.', p_leaving_date, v_lost);
          unresolved := true; return next;
        else
          v_daily := round(v_base / v_div, 6);
          kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
          quantity := v_lost; rate := v_daily; amount := - round(v_daily * v_lost, v_prec); calc_type := 'proration_exit';
          calc_base := p.proration_basis;
          calc_note := format('Left %s (last payable %s) - %s day(s) x daily %s (%s / %s, %s)', p_leaving_date, v_last_payable, v_lost, v_daily, v_base, v_div, p.proration_method);
          unresolved := false; return next;
        end if;
      end if;
    end if;
  end if;

  -- ---- Company OT / Late hourly basis (migration 0184) ----
  -- (Basic + DA) / CALENDAR days of the payroll period / standard hours per day. It never depends on the proration method,
  -- the working-days method or the store calendar (those keep driving proration / LWP). ONE function owns the formula:
  -- payroll_ot_late_basis(); Overtime and Late both use its wage base / calendar days / standard hours below.
  select * into b from public.payroll_ot_late_basis(p_policy_id, p_period_start, p_period_end, p_basic, p_da);

  -- ---- 2. Overtime - SYSTEM-CALCULATED, sourced ONLY from the Attendance OT Rule Engine ----
  -- p_ot_minutes is attendance_records.payable_overtime_minutes: eligibility, minimum, slab, rounding and maximum have
  -- ALREADY been applied by the configured Attendance OT Rule. Payroll adds NO rate method, NO multiplier, NO fixed
  -- amount, NO %-of-salary, NO formula, NO Excel import and NO override - it only VALUES those payable minutes at the
  -- company hourly basis. Full precision is kept until the final amount, which is rounded once (currency precision).
  if p.ot_enabled and coalesce(p_ot_minutes, 0) > 0 and not ('OT' = any(p_existing_codes)) then
    v_hours := p_ot_minutes / 60.0;
    if b.hourly_rate is null then
      v_rate := null; v_amt := 0; unresolved := true;
      v_note := format('%s payable OT minute(s) from the Attendance OT Rule - cannot be valued: standard hours/day is not configured in the payroll policy.', p_ot_minutes);
    else
      v_rate := round(b.hourly_rate, 6);
      v_amt := round(p_ot_minutes * b.wage_base / (60.0 * b.calendar_days * b.std_hours), v_prec);
      unresolved := false;
      v_note := format('%s payable OT min (%s h) from the Attendance OT Rule x hourly wage %s = (Basic %s + DA %s) / %s calendar days / %s h', p_ot_minutes, round(v_hours, 4), v_rate, p_basic, p_da, b.calendar_days, b.std_hours);
    end if;
    kind := 'earning_ot'; line_type := 'earning'; code := 'OT'; name := 'Overtime';
    quantity := round(v_hours, 4); rate := v_rate; amount := v_amt; calc_type := 'overtime_attendance'; calc_base := 'basic_da'; calc_note := v_note;
    return next;
  end if;

  -- ---- 2b. Late deduction (migration 0184) - SAME hourly basis as Overtime ----
  -- p_late_minutes is attendance_records.penalty_minutes: the chargeable late minutes AFTER the Attendance Late Rule
  -- (grace / minimum / rounding), the Information exemption and the Attendance Penalty Rule (fixed / multiplier / slab,
  -- applicability). Payroll re-implements none of that; it only values the minutes.
  if p.late_deduction_enabled and coalesce(p_late_minutes, 0) > 0 and not ('LATE' = any(p_existing_codes)) then
    v_hours := p_late_minutes / 60.0;
    if b.hourly_rate is null then
      v_rate := null; v_amt := 0; unresolved := true;
      v_note := format('%s payable late minute(s) from the Attendance Penalty Rule - cannot be valued: standard hours/day is not configured in the payroll policy.', p_late_minutes);
    else
      v_rate := round(b.hourly_rate, 6);
      v_amt := round(p_late_minutes * b.wage_base / (60.0 * b.calendar_days * b.std_hours), v_prec);
      unresolved := false;
      v_note := format('%s payable late min (%s h) from the Attendance Late/Penalty Rule x hourly wage %s = (Basic %s + DA %s) / %s calendar days / %s h', p_late_minutes, round(v_hours, 4), v_rate, p_basic, p_da, b.calendar_days, b.std_hours);
    end if;
    kind := 'deduction_late'; line_type := 'deduction'; code := 'LATE'; name := 'Late Deduction';
    quantity := round(v_hours, 4); rate := v_rate; amount := v_amt; calc_type := 'late_attendance'; calc_base := 'basic_da'; calc_note := v_note;
    return next;
  end if;

  -- ---- 3. Night-Duty payroll earning ----
  if p.nd_earning_enabled and coalesce(p_nd_value, 0) > 0 and not ('NDUTY' = any(p_existing_codes)) then
    v_note := null;
    v_rate := case p.nd_rate_type
      when 'fixed'           then coalesce(p.nd_rate, p.night_duty_day_rate)
      when 'pct_of_basic'    then case when v_div is null then null else round(p_basic / v_div * coalesce(p.nd_rate, 0) / 100.0, 4) end
      when 'pct_of_basic_da' then case when v_div is null then null else round((p_basic + p_da) / v_div * coalesce(p.nd_rate, 0) / 100.0, 4) end
      when 'custom_formula'  then public.payroll_eval_formula(p.nd_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross, 'NDVALUE', p_nd_value, 'DIVISOR', coalesce(v_div, 0)))
      else null end;
    if v_rate is null then
      v_amt := 0; unresolved := true; v_note := 'Night-duty payroll rate not configured.';
    else
      v_amt := round(coalesce(p_nd_value, 0) * v_rate, case coalesce(p.nd_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
      unresolved := false; v_note := format('%s unit(s) x %s (%s)', p_nd_value, v_rate, coalesce(p.nd_rate_type, 'fixed'));
    end if;
    kind := 'earning_nd'; line_type := 'earning'; code := 'NDUTY'; name := 'Night Duty';
    quantity := p_nd_value; rate := v_rate; amount := v_amt; calc_type := 'night_duty'; calc_base := p.nd_basis; calc_note := v_note;
    return next;
  end if;

  -- ---- 4. LWP deduction ----
  if p.lwp_enabled and coalesce(p_lwp_days, 0) > 0 and not ('LWP' = any(p_existing_codes)) then
    declare
      v_ld numeric := case coalesce(p.lwp_proration_method, p.proration_method)
        when 'calendar_days' then v_days
        when 'working_days'  then nullif(p_working_days, 0)
        when 'fixed_26'      then 26
        when 'fixed_30'      then 30
        when 'custom'        then coalesce(p.proration_custom_divisor, p.lwp_divisor)
        else p.lwp_divisor end;
      v_lb numeric := case coalesce(p.lwp_basis, p.lwp_divisor_basis)
        when 'basic'    then p_basic
        when 'basic_da' then p_basic + p_da
        when 'gross'    then p_gross
        when 'custom'   then public.payroll_eval_formula(p.lwp_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross))
        else null end;
    begin
      if v_ld is null or v_ld = 0 or v_lb is null then
        kind := 'deduction_lwp'; line_type := 'deduction'; code := 'LWP'; name := 'Loss of Pay';
        quantity := p_lwp_days; rate := null; amount := 0; calc_type := 'lwp'; calc_base := coalesce(p.lwp_basis, p.lwp_divisor_basis);
        calc_note := format('%s LWP day(s) - LWP daily-rate needs a configured basis + divisor/method.', p_lwp_days);
        unresolved := true; return next;
      else
        v_daily := round(v_lb / v_ld, 6);
        kind := 'deduction_lwp'; line_type := 'deduction'; code := 'LWP'; name := 'Loss of Pay';
        quantity := p_lwp_days; rate := v_daily;
        amount := round(v_daily * p_lwp_days, case coalesce(p.lwp_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
        calc_type := 'lwp'; calc_base := coalesce(p.lwp_basis, p.lwp_divisor_basis);
        calc_note := format('%s day(s) x daily %s (%s / %s)', p_lwp_days, v_daily, v_lb, v_ld);
        unresolved := false; return next;
      end if;
    end;
  end if;

  -- ---- 5. Statutory (PF / ESI / PT / TDS / Gratuity / Other) ----
  for r in
    select * from public.payroll_statutory_rules sr
    where sr.payroll_policy_id = p_policy_id and sr.enabled
      and sr.effective_from <= p_period_end and (sr.effective_to is null or sr.effective_to >= p_period_start)
    order by array_position(array['pf','esi','pt','tds','gratuity','other'], sr.kind), sr.component_code nulls first, sr.created_at
  loop
    -- Common Payroll Component (0178): a kind='other' rule that carries its own component_code/name/type is a
    -- named, reusable component (Medical Fund, Incentive, ...). It is NOT tied to any salary structure. Every other
    -- rule (PF/ESI/PT/TDS/Gratuity/legacy Other) keeps the original code/name/line-type exactly.
    v_custom := (r.kind = 'other' and coalesce(btrim(r.component_code), '') <> '');
    v_ccode := case when v_custom then upper(btrim(r.component_code)) else upper(r.kind) end;
    v_cname := case when v_custom then coalesce(nullif(btrim(r.component_name), ''), v_ccode)
                    else (case r.kind when 'pf' then 'Provident Fund' when 'esi' then 'ESI' when 'gratuity' then 'Gratuity (employee)' else 'Statutory' end) end;
    v_clt := case when v_custom and r.component_type = 'earning' then 'earning' else 'deduction' end;
    v_cctype := case when v_custom then 'common_component' else 'statutory_' || r.kind end;
    v_has_struct_stat := not v_custom and p_structure_id is not null and exists (
      select 1 from public.salary_structure_components c
      where c.salary_structure_id = p_structure_id and c.is_active and c.statutory_kind = r.kind);
    if v_has_struct_stat or (v_ccode = any(p_existing_codes)) then continue; end if;

    -- ELIGIBILITY (migration 0181) — a generic, rule-level condition kept separate from the amount calculation.
    --   'after_months': the employee must have completed N months of service. The employee's joining date (read on the
    --   server from the employee record) + N calendar months must be on/before the PAYROLL PERIOD END date — the same date
    --   payroll uses to resolve salary structure, policy and employment status. Calendar-month arithmetic clamps month-end
    --   (e.g. joined 29-Feb-2024 + 12 months = 28-Feb-2025). No amount formula is involved; when not eligible the
    --   component is a Rs 0 "Not applicable" line, so the reason is visible on the preview and the payslip.
    if coalesce(r.eligibility_type, 'always') = 'after_months' then
      -- the ONE eligibility rule (shared with the "Test" screen): payroll_rule_eligibility()
      select * into v_el from public.payroll_rule_eligibility(r.eligibility_type, r.eligibility_months, p_joining_date, p_period_end);
      if not v_el.eligible then
        kind := (case when v_clt = 'earning' then 'earning_' else 'deduction_' end) || r.kind; line_type := v_clt;
        code := v_ccode; name := v_cname; quantity := null; rate := null; amount := 0;
        calc_type := v_cctype; calc_base := 'eligibility';
        calc_note := case when v_el.needs_review then format('%s: %s', v_ccode, v_el.note) else v_el.note end;
        unresolved := v_el.needs_review;
        return next;
        continue;
      end if;
    end if;

    -- A formula that cannot be evaluated is reported on ITS OWN line (unresolved, amount 0, reason in the note); it never aborts
    -- the whole calculation, so salary structure / grade resolution and every other component are unaffected.
    v_ferr := null;
    begin
      v_sbase := case r.calc_base
        when 'basic'    then p_basic
        when 'basic_da' then p_basic + p_da
        when 'gross'    then p_gross
        when 'custom'   then public.payroll_eval_formula(r.base_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross))
        else null end;
    exception when others then
      v_sbase := null; v_ferr := sqlerrm;
    end;
    if r.wage_ceiling is not null and v_sbase is not null then v_sbase := least(v_sbase, r.wage_ceiling); end if;
    v_prec := case coalesce(r.rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else coalesce(p.currency_precision, 2) end;

    if r.kind = 'pt' then
      select s.amount into v_amt from public.payroll_pt_slabs s
      where s.payroll_policy_id = p_policy_id
        and s.effective_from <= p_period_end and (s.effective_to is null or s.effective_to >= p_period_start)
        and coalesce(v_sbase, p_gross) >= s.min_salary and (s.max_salary is null or coalesce(v_sbase, p_gross) <= s.max_salary)
      order by s.min_salary desc limit 1;
      kind := 'deduction_pt'; line_type := 'deduction'; code := 'PT'; name := 'Professional Tax';
      quantity := null; rate := null; calc_type := 'statutory_pt'; calc_base := coalesce(r.calc_base, 'gross');
      if v_amt is null then amount := 0; unresolved := true; calc_note := 'PT slabs not configured for this salary.';
      else amount := round(v_amt, 0); unresolved := false; calc_note := format('PT slab @ %s', coalesce(v_sbase, p_gross)); end if;
      return next;

    elsif r.kind = 'tds' then
      kind := 'deduction_tds'; line_type := 'deduction'; code := 'TDS'; name := 'TDS';
      quantity := null; rate := null; calc_type := 'statutory_tds'; calc_base := r.calc_base;
      if p_tds is not null and coalesce((p_tds ->> 'configured')::boolean, false) then
        amount := round(coalesce((p_tds ->> 'monthly_tds')::numeric, 0), v_prec); unresolved := false;
        calc_note := format('TDS %s regime - annual %s / 12 (slab %s%%)', p_tds ->> 'tax_regime', p_tds ->> 'final_annual_tds', coalesce(p_tds ->> 'slab_rate', '?'));
      elsif p_tds is not null then
        amount := 0; unresolved := true; calc_note := 'TDS Not Configured - ' || coalesce(p_tds ->> 'reason', 'incomplete TDS policy.');
      elsif coalesce(btrim(r.base_formula), '') <> '' then
        begin
          amount := round(coalesce(public.payroll_eval_formula(r.base_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec);
          unresolved := false; calc_note := 'TDS via configured formula.';
        exception when others then
          amount := 0; unresolved := true; calc_note := 'TDS: formula is invalid — ' || sqlerrm;
        end;
      else
        amount := 0; unresolved := true; calc_note := 'TDS Not Configured - no tax engine / policy supplied.';
      end if;
      return next;

    else
      -- ============ PF / ESI / Gratuity / Other ============
      if r.calc_method = 'pct_of_base' then
        -- ----- original behaviour, unchanged -----
        if r.kind = 'esi' and r.wage_ceiling is not null and p_gross > r.wage_ceiling then
          kind := 'deduction_esi'; line_type := 'deduction'; code := 'ESI'; name := 'ESI';
          quantity := null; rate := 0; amount := 0; calc_type := 'statutory_esi'; calc_base := coalesce(r.calc_base, 'gross');
          calc_note := format('ESI not applicable - gross %s above ceiling %s.', p_gross, r.wage_ceiling); unresolved := false;
          return next;
        else
          kind := (case when v_clt = 'earning' then 'earning_' else 'deduction_' end) || r.kind; line_type := v_clt;
          code := v_ccode; name := v_cname;
          quantity := null; calc_type := v_cctype; calc_base := r.calc_base;
          if r.employee_rate is null then
            rate := null; amount := 0; unresolved := true; calc_note := format('%s employee rate not configured.', v_ccode);
          elsif v_sbase is null then
            rate := r.employee_rate; amount := 0; unresolved := true; calc_note := case when v_ferr is not null then format('%s: formula is invalid — %s', v_ccode, v_ferr) else format('%s calculation base not configured.', v_ccode) end;
          else
            rate := r.employee_rate; amount := round(v_sbase * r.employee_rate / 100.0, v_prec); unresolved := false;
            calc_note := format('%s%% of %s (%s)%s', r.employee_rate, coalesce(r.calc_base, 'base'), v_sbase,
                                case when r.wage_ceiling is not null then format(' capped @ %s', r.wage_ceiling) else '' end);
          end if;
          return next;
        end if;

        if r.employer_rate is not null and v_sbase is not null then
          kind := 'employer_' || r.kind; line_type := 'employer_contribution';
          code := v_ccode || '_ER'; name := 'Employer ' || (case when v_custom then v_cname else upper(r.kind) end);
          quantity := null; rate := r.employer_rate; amount := round(v_sbase * r.employer_rate / 100.0, v_prec);
          calc_type := 'employer_' || r.kind; calc_base := r.calc_base;
          calc_note := format('%s%% of %s (%s) - employer', r.employer_rate, coalesce(r.calc_base, 'base'), v_sbase); unresolved := false;
          return next;
        end if;

      else
        -- ----- fixed_amount / pct_of_component / formula / manual -----
        v_mkey := v_ccode;
        v_emp_amt := null; v_er_amt := null; v_mnote := null; v_munres := false;

        if r.calc_method = 'manual' then
          v_man := coalesce(p_manual_components -> v_mkey, p_manual_components -> lower(v_mkey));
          if v_man is null or (v_man ->> 'employee_amount') is null then
            v_munres := true;
            v_mnote := format('%s: Manual / Excel amount not entered for this employee and payroll period.', v_mkey);
          else
            v_emp_amt := round((v_man ->> 'employee_amount')::numeric, v_prec);   -- explicit 0 is respected
            v_er_amt := case when (v_man ->> 'employer_amount') is not null
                             then round((v_man ->> 'employer_amount')::numeric, v_prec) else null end;
            v_mnote := format('%s: manual/imported amount for this payroll period (%s).', v_mkey, coalesce(v_man ->> 'source', 'manual'));
          end if;

        elsif r.calc_method = 'fixed_amount' then
          if r.employee_amount is null then
            v_munres := true; v_mnote := format('%s: fixed amount not configured.', v_mkey);
          else
            v_emp_amt := round(r.employee_amount, v_prec);
            v_er_amt := case when r.employer_amount is not null then round(r.employer_amount, v_prec) else null end;
            v_mnote := format('%s: fixed amount %s.', v_mkey, v_emp_amt);
          end if;

        elsif r.calc_method = 'pct_of_component' then
          v_refamt := (p_component_amounts ->> coalesce(r.ref_component_code, ''))::numeric;
          if coalesce(btrim(r.ref_component_code), '') = '' or v_refamt is null then
            v_munres := true;
            v_mnote := format('%s: %% of component "%s" - the referenced component is not present in this payslip.', v_mkey, coalesce(r.ref_component_code, '?'));
          elsif r.employee_rate is null then
            v_munres := true; v_mnote := format('%s: %% of component rate not configured.', v_mkey);
          else
            if r.wage_ceiling is not null then v_refamt := least(v_refamt, r.wage_ceiling); end if;
            v_emp_amt := round(v_refamt * r.employee_rate / 100.0, v_prec);
            v_er_amt := case when r.employer_rate is not null then round(v_refamt * r.employer_rate / 100.0, v_prec) else null end;
            v_mnote := format('%s: %s%% of %s (%s).', v_mkey, r.employee_rate, r.ref_component_code, v_refamt);
          end if;

        elsif r.calc_method = 'formula' then
          if coalesce(btrim(r.base_formula), '') = '' then
            v_munres := true; v_mnote := format('%s: custom formula not configured.', v_mkey);
          else
            begin
              v_emp_amt := round(coalesce(public.payroll_eval_formula(r.base_formula,
                            jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec);
              v_er_amt := case when coalesce(btrim(r.employer_formula), '') <> ''
                               then round(coalesce(public.payroll_eval_formula(r.employer_formula,
                                     jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec)
                               else null end;
              v_mnote := format('%s: custom formula.', v_mkey);
            exception when others then
              v_emp_amt := null; v_er_amt := null; v_munres := true;
              v_mnote := format('%s: formula is invalid — %s', v_mkey, sqlerrm);
            end;
          end if;
        end if;

        -- employee deduction line
        kind := (case when v_clt = 'earning' then 'earning_' else 'deduction_' end) || r.kind; line_type := v_clt;
        code := v_ccode; name := v_cname;
        quantity := null;
        rate := case when r.calc_method = 'pct_of_component' then r.employee_rate else null end;
        calc_type := v_cctype;
        calc_base := coalesce(r.calc_base, case when r.calc_method = 'pct_of_component' then r.ref_component_code else r.calc_method end);
        if v_munres then amount := 0; unresolved := true; calc_note := v_mnote;
        else amount := coalesce(v_emp_amt, 0); unresolved := false; calc_note := v_mnote; end if;
        return next;

        -- employer contribution line (only when the method produced one)
        if v_er_amt is not null then
          kind := 'employer_' || r.kind; line_type := 'employer_contribution';
          code := v_ccode || '_ER'; name := 'Employer ' || (case when v_custom then v_cname else upper(r.kind) end);
          quantity := null;
          rate := case when r.calc_method = 'pct_of_component' then r.employer_rate else null end;
          amount := v_er_amt; calc_type := 'employer_' || r.kind; calc_base := r.calc_base;
          calc_note := format('%s employer contribution (%s).', v_ccode, r.calc_method); unresolved := false;
          return next;
        end if;
      end if;
    end if;
  end loop;

  return;
end;
$function$;

revoke all on function public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[], date, boolean, jsonb, jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[], date, boolean, jsonb, jsonb, jsonb, numeric) to service_role;

-- ---------------------------------------------------------------- payroll_apply_policy (signature widened => drop + recreate)
drop function if exists public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, date, boolean, jsonb);
drop function if exists public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, date, boolean, jsonb, numeric);   -- re-runnable
CREATE FUNCTION public.payroll_apply_policy(p_result_id uuid, p_policy_id uuid, p_period_start date, p_period_end date, p_working_days numeric, p_joining_date date, p_basic numeric, p_da numeric, p_gross numeric, p_lwp_days numeric, p_ot_minutes numeric, p_nd_value numeric, p_structure_id uuid, p_leaving_date date DEFAULT NULL::date, p_exit_date_payable boolean DEFAULT NULL::boolean, p_manual_components jsonb DEFAULT '{}'::jsonb, p_late_minutes numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_run uuid; v_company uuid; v_emp uuid;
  v_existing text[];
  v_comp_amounts jsonb := '{}'::jsonb;
  l record;
  v_gross numeric := p_gross;
  v_empc numeric := 0;
  v_lwp numeric := 0;
  v_stat_total numeric := 0;
  v_prorate numeric := 0;
  v_prorate_exit numeric := 0;
  v_deds jsonb := '[]'::jsonb;
  v_fin jsonb;
  o jsonb;
  v_note text := '';
  v_unresolved boolean := false;
  p public.payroll_policies;
  v_tds_pol public.tds_policies;
  v_tds jsonb := null;
  v_annual numeric;
  v_decl record;
  v_fy_start date;
begin
  select payroll_run_id, company_id, employee_id into v_run, v_company, v_emp
  from public.payroll_employee_results where id = p_result_id;
  select * into p from public.payroll_policies where id = p_policy_id;

  select coalesce(array_agg(code), '{}') into v_existing
  from public.payroll_lines where payroll_employee_result_id = p_result_id;

  -- component amounts already on this payslip (for a 'pct_of_component' statutory method)
  select coalesce(jsonb_object_agg(code, amt), '{}'::jsonb) into v_comp_amounts
  from (select code, sum(amount) as amt from public.payroll_lines
        where payroll_employee_result_id = p_result_id and line_type = 'earning' group by code) s;

  -- ---- real TDS resolution (inert unless fully configured) ----
  v_tds_pol := public.tds_resolve_policy(v_company, p_period_end);
  if v_tds_pol.id is not null then
    if v_tds_pol.annualization_method = 'flat_x12' then
      v_fy_start := coalesce(v_tds_pol.financial_year_start, make_date(extract(year from p_period_end)::int, 4, 1));
      select * into v_decl from public.tds_employee_declarations
      where employee_id = v_emp and financial_year_start = v_fy_start;
      v_annual := greatest(
        p_gross * 12
        + coalesce(v_decl.previous_employer_income, 0)
        + coalesce(v_decl.other_income, 0)
        - coalesce(v_tds_pol.standard_deduction, 0)
        - coalesce(v_decl.investment_declared, 0)
        - coalesce(v_decl.other_exemptions, 0), 0);
      v_tds := public.tds_compute(v_tds_pol.id, v_annual);
    else
      v_tds := jsonb_build_object('configured', false,
        'reason', format('Annualization method "%s" needs year-to-date income (not available in a single run).', coalesce(v_tds_pol.annualization_method, 'not defined')));
    end if;
  end if;

  -- 1. policy-driven lines
  for l in select * from public.payroll_policy_compute_lines(
             p_policy_id, p_period_start, p_period_end, p_working_days, p_joining_date,
             p_basic, p_da, p_gross, p_lwp_days, p_ot_minutes, p_nd_value, p_structure_id, v_existing,
             p_leaving_date, p_exit_date_payable, v_tds, coalesce(p_manual_components, '{}'::jsonb), v_comp_amounts, coalesce(p_late_minutes, 0))
  loop
    insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id,
      line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, calc_formula, sort_order)
    values (v_company, v_run, p_result_id, v_emp, l.line_type, l.code, l.name, l.quantity, l.rate, l.amount,
      'payroll_policy', l.calc_type, l.calc_base, l.calc_note,
      case l.kind
        when 'earning_ot' then 60 when 'earning_nd' then 65 when 'earning_prorate' then 70 when 'earning_prorate_exit' then 72
        when 'deduction_pf' then 300 when 'deduction_esi' then 310 when 'deduction_pt' then 320
        when 'deduction_tds' then 330 when 'deduction_lwp' then 350 when 'deduction_late' then 355
        when 'employer_pf' then 400 when 'employer_esi' then 410 when 'employer_gratuity' then 420
        else 360 end);

    if l.line_type = 'earning' then v_gross := v_gross + l.amount;
    elsif l.line_type = 'employer_contribution' then v_empc := v_empc + l.amount;
    end if;
    if l.kind = 'deduction_lwp' then v_lwp := l.amount; end if;
    if l.kind = 'earning_prorate' then v_prorate := l.amount; end if;
    if l.kind = 'earning_prorate_exit' then v_prorate_exit := l.amount; end if;
    if l.calc_type like 'statutory_%' then v_stat_total := v_stat_total + l.amount; end if;
    if l.unresolved then v_unresolved := true; v_note := v_note || coalesce(l.calc_note, '') || ' '; end if;
  end loop;

  -- 2. collect ALL employee-deduction lines for finalize
  for l in select code, amount from public.payroll_lines
           where payroll_employee_result_id = p_result_id and line_type = 'deduction'
  loop
    v_deds := v_deds || jsonb_build_object('code', l.code, 'amount', l.amount, 'protected', l.code = 'ADVREC');
  end loop;

  v_fin := public.payroll_policy_finalize(p_policy_id, v_gross, v_deds);

  for o in select * from jsonb_array_elements(v_fin -> 'ordered') loop
    if (o ? 'capped') or (o ? 'neg_blocked') then
      update public.payroll_lines
      set amount = (o ->> 'amount')::numeric,
          calc_formula = coalesce(calc_formula, '') ||
            case when (o ? 'capped') then ' [reduced by deduction cap]' else '' end ||
            case when (o ? 'neg_blocked') then ' [reduced to block negative net]' else '' end
      where payroll_employee_result_id = p_result_id and line_type = 'deduction' and code = (o ->> 'code');
    end if;
  end loop;

  if (v_fin ->> 'cap_reduction')::numeric > 0 then v_note := v_note || format('Deduction cap trimmed %s. ', v_fin ->> 'cap_reduction'); end if;
  if (v_fin ->> 'negative_flag')::boolean then v_note := v_note || format('Negative net (%s policy). ', v_fin ->> 'negative_net_policy'); end if;
  if not (v_fin ->> 'priority_configured')::boolean
     and exists (select 1 from public.payroll_lines where payroll_employee_result_id = p_result_id and line_type = 'deduction') then
    v_note := v_note || 'Deduction priority not configured. ';
  end if;

  -- ---- TDS calculation snapshot (only when it actually computed) ----
  if v_tds is not null and coalesce((v_tds ->> 'configured')::boolean, false) then
    insert into public.tds_calculations (company_id, payroll_employee_result_id, employee_id, tds_policy_id, tds_policy_version,
      tax_regime, annual_projected_income, taxable_income, applicable_slab_id, slab_rate, computed_tax, rebate, cess, final_annual_tds, monthly_tds, snapshot)
    values (v_company, p_result_id, v_emp, v_tds_pol.id, (v_tds ->> 'policy_version')::int,
      v_tds ->> 'tax_regime', v_annual, (v_tds ->> 'annual_taxable')::numeric,
      nullif(v_tds ->> 'applicable_slab_id', '')::uuid, (v_tds ->> 'slab_rate')::numeric,
      (v_tds ->> 'computed_tax_before_rebate')::numeric, (v_tds ->> 'rebate')::numeric, (v_tds ->> 'cess')::numeric,
      (v_tds ->> 'final_annual_tds')::numeric, (v_tds ->> 'monthly_tds')::numeric, v_tds)
    on conflict (payroll_employee_result_id) do update set
      snapshot = excluded.snapshot, monthly_tds = excluded.monthly_tds, final_annual_tds = excluded.final_annual_tds,
      taxable_income = excluded.taxable_income, annual_projected_income = excluded.annual_projected_income, computed_at = now();
  end if;

  return jsonb_build_object(
    'gross', v_gross,
    'total_deductions', (v_fin ->> 'total_deductions')::numeric,
    'net', (v_fin ->> 'net')::numeric,
    'employer_contribution_extra', v_empc,
    'lwp_amount', v_lwp,
    'prorate_amount', v_prorate,
    'prorate_exit_amount', v_prorate_exit,
    'statutory_total', v_stat_total,
    'needs_review', v_unresolved or (v_fin ->> 'negative_flag')::boolean,
    'review_note', nullif(btrim(v_note), ''),
    'snapshot', jsonb_build_object(
      'policy_id', p_policy_id, 'policy_code', p.code, 'policy_name', p.policy_name, 'version_no', p.version_no,
      'effective_from', p.effective_from, 'effective_to', p.effective_to,
      'proration_method', p.proration_method, 'proration_basis', p.proration_basis, 'exit_date_payable', p.exit_date_payable,
      'lwp', jsonb_build_object('enabled', p.lwp_enabled, 'basis', coalesce(p.lwp_basis, p.lwp_divisor_basis), 'method', coalesce(p.lwp_proration_method, p.proration_method), 'divisor', p.lwp_divisor),
      'overtime', jsonb_build_object('enabled', p.ot_enabled, 'rate_type', p.ot_rate_type, 'rate', p.ot_rate, 'std_hours_per_day', p.ot_std_hours_per_day),
      'late', jsonb_build_object('enabled', p.late_deduction_enabled, 'payable_late_minutes', coalesce(p_late_minutes, 0)),
      'ot_late_basis', (select jsonb_build_object('wage_base', b.wage_base, 'basic', p_basic, 'da', p_da, 'calendar_days', b.calendar_days, 'std_hours_per_day', b.std_hours,
                          'daily_rate', b.daily_rate, 'hourly_rate', b.hourly_rate, 'payable_ot_minutes', coalesce(p_ot_minutes, 0), 'payable_late_minutes', coalesce(p_late_minutes, 0))
                        from public.payroll_ot_late_basis(p_policy_id, p_period_start, p_period_end, p_basic, p_da) b),
      'night_duty', jsonb_build_object('enabled', p.nd_earning_enabled, 'rate_type', p.nd_rate_type, 'rate', p.nd_rate),
      'statutory', (select coalesce(jsonb_agg(jsonb_build_object('kind', sr.kind, 'enabled', sr.enabled, 'calc_method', sr.calc_method, 'base', sr.calc_base, 'employee_rate', sr.employee_rate, 'employer_rate', sr.employer_rate, 'employee_amount', sr.employee_amount, 'employer_amount', sr.employer_amount, 'ref_component_code', sr.ref_component_code, 'ceiling', sr.wage_ceiling)), '[]'::jsonb)
                    from public.payroll_statutory_rules sr where sr.payroll_policy_id = p_policy_id),
      'manual_components', coalesce(p_manual_components, '{}'::jsonb),
      'tds', coalesce(v_tds, jsonb_build_object('configured', false, 'reason', 'No active TDS policy for this company/period.')),
      'deduction_cap', jsonb_build_object('mode', p.deduction_cap_mode, 'value', p.deduction_cap_value),
      'negative_net_policy', p.negative_net_policy,
      'deduction_order', (select coalesce(jsonb_agg(jsonb_build_object('code', d.deduction_code, 'priority', d.priority) order by d.priority), '[]'::jsonb)
                          from public.payroll_deduction_order d where d.payroll_policy_id = p_policy_id and d.is_active)
    )
  );
end;
$function$;

revoke all on function public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, date, boolean, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, date, boolean, jsonb, numeric) to service_role;

-- ---------------------------------------------------------------- payroll_calculate_run (same signature; reads penalty_minutes)
CREATE OR REPLACE FUNCTION public.payroll_calculate_run(p_payroll_run_id uuid)
 RETURNS payroll_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_run public.payroll_runs;
  v_period public.payroll_periods;
  v_pol public.payroll_policies;
  v_emp record;
  v_sal record;
  v_comp record;
  v_rec record;
  v_bif record;
  v_adv_period_id uuid;
  v_result_id uuid;
  v_basic numeric; v_da numeric;
  v_present_full numeric; v_half numeric; v_woff numeric; v_holi numeric; v_absent numeric; v_att_leave numeric;
  v_ot_min numeric; v_nd_val numeric; v_late_min numeric;
  v_paid_leave numeric; v_lwp_days numeric; v_unassigned int;
  v_calendar int; v_working numeric; v_present numeric; v_paid_days numeric; v_unpaid_days numeric;
  v_gross numeric; v_ded numeric; v_advrec numeric; v_net numeric; v_empc numeric;
  v_qty numeric; v_rate numeric; v_amt numeric;
  v_review boolean; v_notes text; v_hasneg boolean;
  v_res_gross numeric; v_struct_id uuid; v_ambig boolean; v_resolve_note text; v_src text; v_ltype text; v_advrec_extra numeric;
  v_join date; v_leave date; v_exit_pay boolean; v_pol_j jsonb; v_gross_pre numeric;
  v_cal public.store_payroll_calendars; v_cal_wd numeric;
  v_elig_start date; v_elig_end date; v_eligible_days numeric; v_ss_scope text;
  v_r_gross numeric := 0; v_r_ded numeric := 0; v_r_adv numeric := 0; v_r_net numeric := 0; v_cnt int := 0;
  v_manual_amt numeric;
  v_manual_components jsonb;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then
    raise exception 'You are not authorised to run payroll for this company.' using errcode = '42501';
  end if;
  if v_run.status not in ('draft', 'processing', 'calculated') then
    raise exception 'Payroll run is % — a finalized/locked/reversed run cannot be recalculated.', v_run.status;
  end if;
  if not v_run.is_current then raise exception 'This is not the current run for its period.'; end if;

  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id;
  v_calendar := (v_period.period_end_date - v_period.period_start_date + 1);

  update public.payroll_runs set status = 'processing', started_at = coalesce(started_at, now()), processed_by = auth.uid() where id = v_run.id;
  delete from public.payroll_lines where payroll_run_id = v_run.id;
  delete from public.payroll_employee_results where payroll_run_id = v_run.id;

  select id into v_adv_period_id from public.advance_payroll_periods
  where company_id = v_run.company_id and period_month = v_period.period_month;
  if v_adv_period_id is null then
    insert into public.advance_payroll_periods (company_id, period_month, label, status, payroll_run_id, created_by, updated_by)
    values (v_run.company_id, v_period.period_month, coalesce(v_period.label, to_char(v_period.period_month, 'Mon YYYY')), 'draft', v_run.id, auth.uid(), auth.uid())
    returning id into v_adv_period_id;
  else
    update public.advance_payroll_periods set payroll_run_id = v_run.id, updated_by = auth.uid()
    where id = v_adv_period_id and status = 'draft';
  end if;

  for v_emp in
    select e.id, e.full_name, e.employee_code, e.store_id, e.store_department_id, e.store_designation_id,
           e.joining_date, e.leaving_date
    from public.employees e
    where e.company_id = v_run.company_id
      and (e.status in ('active', 'on_leave', 'notice_period')
           or (e.status in ('resigned', 'terminated', 'transferred') and e.leaving_date is not null and e.leaving_date >= v_period.period_start_date))
      and (e.joining_date is null or e.joining_date <= v_period.period_end_date)
      and (e.leaving_date is null or e.leaving_date >= v_period.period_start_date)
    order by e.full_name
  loop
    v_review := false; v_notes := ''; v_basic := 0; v_da := 0; v_empc := 0; v_advrec := 0; v_gross := 0; v_ded := 0;
    v_join := v_emp.joining_date; v_leave := v_emp.leaving_date;

    -- Manual / Excel-imported component amounts for THIS employee + period (PF/ESI/Gratuity/Other
    -- statutory rules whose calc_method = 'manual' — migration 0143's payroll_apply_policy already
    -- consumes this jsonb; it was simply never populated until now). One indexed lookup
    -- (idx_pca_period_emp), reused for both the dynamic-structure and legacy call below.
    select coalesce(jsonb_object_agg(pca.component_code, jsonb_build_object(
             'employee_amount', pca.employee_amount, 'employer_amount', pca.employer_amount, 'source', pca.source)), '{}'::jsonb)
      into v_manual_components
    from public.payroll_component_amounts pca
    where pca.payroll_period_id = v_period.id and pca.employee_id = v_emp.id;

    -- per-employee scoped Payroll Policy (falls back to the company-wide active policy)
    select * into v_pol from public.payroll_resolve_policy_for_employee(v_run.company_id, v_emp.id, v_period.period_end_date);
    v_exit_pay := v_pol.exit_date_payable;

    select sc.basic_salary, sc.da, sc.effective_from into v_sal
    from public.employee_salary_components sc
    where sc.employee_id = v_emp.id
      and sc.effective_from <= v_period.period_end_date
      and (sc.effective_to is null or sc.effective_to >= v_period.period_start_date)
    order by sc.effective_from desc limit 1;

    select
      coalesce(count(*) filter (where ar.status in ('present', 'work_from_home', 'on_duty')), 0),
      coalesce(count(*) filter (where ar.status = 'half_day'), 0) * 0.5,
      coalesce(count(*) filter (where ar.status = 'weekly_off'), 0),
      coalesce(count(*) filter (where ar.status = 'holiday'), 0),
      coalesce(count(*) filter (where ar.status = 'absent'), 0),
      coalesce(count(*) filter (where ar.status = 'leave'), 0),
      coalesce(sum(ar.payable_overtime_minutes), 0),
      coalesce(sum(ar.payable_extra_duty_value), 0),
      coalesce(sum(ar.penalty_minutes), 0)
    into v_present_full, v_half, v_woff, v_holi, v_absent, v_att_leave, v_ot_min, v_nd_val, v_late_min
    from public.attendance_records ar
    where ar.employee_id = v_emp.id and ar.attendance_date between v_period.period_start_date and v_period.period_end_date;

    select
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'paid'), 0),
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'unpaid'), 0),
      coalesce(count(*) filter (where lae.paid_status is null or lae.paid_status = 'unassigned'), 0)
    into v_paid_leave, v_lwp_days, v_unassigned
    from public.leave_attendance_effects lae
    where lae.employee_id = v_emp.id
      and lae.attendance_date between v_period.period_start_date and v_period.period_end_date
      and lae.reversed_at is null;
    if v_unassigned > 0 then
      v_review := true;
      v_notes := v_notes || format('%s approved leave day(s) not yet allocated as Paid Leave / LWP. ', v_unassigned);
    end if;

    v_present := coalesce(v_present_full, 0) + coalesce(v_half, 0);
    v_working := greatest(v_calendar - coalesce(v_woff, 0) - coalesce(v_holi, 0), 0);
    v_paid_days := v_present + coalesce(v_paid_leave, 0) + coalesce(v_woff, 0) + coalesce(v_holi, 0);
    v_unpaid_days := coalesce(v_lwp_days, 0) + coalesce(v_absent, 0);

    -- Store Calendar working days (§28) — only when the policy asks for it
    v_cal := null; v_cal_wd := null;
    if v_pol.working_days_method = 'store_calendar' then
      v_cal := public.payroll_resolve_store_calendar(v_run.company_id, v_emp.store_id, v_period.period_end_date);
      if v_cal.id is not null then
        v_cal_wd := public.payroll_calendar_working_days(v_cal.id, v_period.period_start_date, v_period.period_end_date);
        if v_cal_wd is not null then v_working := v_cal_wd; end if;
      else
        v_review := true; v_notes := v_notes || 'Store calendar working-days method selected but no active calendar resolves. ';
      end if;
    end if;

    -- Eligible days (joining / leaving inside the period)
    v_elig_start := greatest(v_period.period_start_date, coalesce(v_join, v_period.period_start_date));
    v_elig_end := case
      when v_leave is null then v_period.period_end_date
      when v_exit_pay is true then least(v_leave, v_period.period_end_date)
      when v_exit_pay is false then least(v_leave - 1, v_period.period_end_date)
      else v_period.period_end_date end;
    v_eligible_days := greatest((v_elig_end - v_elig_start) + 1, 0);

    insert into public.payroll_employee_results (
      company_id, payroll_run_id, payroll_period_id, employee_id,
      employee_code_snapshot, employee_name_snapshot, department_snapshot, designation_snapshot, store_snapshot,
      salary_effective_from, basic_snapshot, da_snapshot,
      calendar_days, working_days, present_days, paid_leave_days, lwp_days, weekly_off_days, holiday_days, absent_days, paid_days, unpaid_days,
      payroll_policy_id, store_calendar_id, store_calendar_snapshot, leaving_date_snapshot, eligible_days, status
    ) values (
      v_run.company_id, v_run.id, v_period.id, v_emp.id,
      v_emp.employee_code, v_emp.full_name,
      (select sd.name from public.store_departments sd where sd.id = v_emp.store_department_id),
      (select sg.title from public.store_designations sg where sg.id = v_emp.store_designation_id),
      (select s.name from public.stores s where s.id = v_emp.store_id),
      v_sal.effective_from, coalesce(v_sal.basic_salary, 0), coalesce(v_sal.da, 0),
      v_calendar, v_working, v_present, coalesce(v_paid_leave, 0), coalesce(v_lwp_days, 0), coalesce(v_woff, 0), coalesce(v_holi, 0), coalesce(v_absent, 0), v_paid_days, v_unpaid_days,
      v_pol.id, v_cal.id,
      case when v_cal.id is not null then jsonb_build_object('calendar_id', v_cal.id, 'name', v_cal.name, 'effective_from', v_cal.effective_from, 'effective_to', v_cal.effective_to,
        'weekly_off_days', to_jsonb(v_cal.weekly_off_days), 'alternate_saturday_off', v_cal.alternate_saturday_off, 'holiday_source', v_cal.holiday_source, 'working_days', v_cal_wd) else null end,
      v_leave, v_eligible_days, 'calculated'
    ) returning id into v_result_id;

    -- ================= PHASE 5A: dynamic salary structure path =================
    select r.gross_salary, r.salary_structure_id, r.ambiguous, r.resolve_note, r.source
      into v_res_gross, v_struct_id, v_ambig, v_resolve_note, v_src
    from public.salary_resolve_for_employee(v_emp.id, v_period.period_end_date) r;
    v_ss_scope := (regexp_match(coalesce(v_src, ''), 'assign_([a-z_]+)'))[1];

    if v_ambig then
      update public.payroll_employee_results
      set needs_review = true, review_notes = coalesce(v_resolve_note, 'Ambiguous salary structure — resolve the assignment.'),
          gross_earnings = 0, total_deductions = 0, net_salary = 0, salary_structure_scope = v_ss_scope
      where id = v_result_id;
      v_cnt := v_cnt + 1;
      continue;
    end if;

    if v_struct_id is not null then
      begin
        for v_bif in select * from public.salary_bifurcate(v_struct_id, v_res_gross) loop
          if v_bif.calculation_type = 'advance_recovery' then
            if exists (select 1 from public.advance_recovery_transactions x
                       where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
              select coalesce(sum(x.amount), 0) into v_advrec
              from public.advance_recovery_transactions x
              where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
                and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
            else
              v_advrec := 0;
              for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
                v_advrec := v_advrec + coalesce(v_rec.deducted_amount, 0);
              end loop;
            end if;
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, amount, source, calc_type, calculation_ref, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, 'deduction', v_bif.code, v_bif.name, round(v_advrec, 2), 'advance_recovery', 'advance_recovery',
                    'advance_payroll_period:' || v_adv_period_id::text, v_bif.display_order);
            v_ded := v_ded + round(v_advrec, 2);
          elsif v_bif.calculation_type = 'manual' then
            -- Manual / Excel Import (migration 0175) — reuses the EXACT SAME payroll_component_amounts
            -- table PF/ESI already use (migration 0143). Blank = not yet supplied -> flagged for
            -- review, amount 0 (never silently invented); an explicit stored 0 is respected as-is.
            select pca.employee_amount into v_manual_amt
            from public.payroll_component_amounts pca
            where pca.payroll_period_id = v_period.id and pca.employee_id = v_emp.id and pca.component_code = upper(v_bif.code);
            v_ltype := case v_bif.category when 'earning' then 'earning' when 'employer_contribution' then 'employer_contribution' else 'deduction' end;
            if v_manual_amt is null then
              v_review := true;
              v_notes := v_notes || format('%s: Manual / Excel amount not entered for this employee and payroll period. ', v_bif.code);
              v_manual_amt := 0;
            end if;
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_ltype, v_bif.code, v_bif.name, null, null, round(v_manual_amt, 2), 'manual_import', 'manual', 'manual', v_bif.display_order);
            if v_ltype = 'earning' then v_gross := v_gross + round(v_manual_amt, 2);
            elsif v_ltype = 'employer_contribution' then v_empc := v_empc + round(v_manual_amt, 2);
            else v_ded := v_ded + round(v_manual_amt, 2); end if;
            if v_bif.is_basic then v_basic := round(v_manual_amt, 2); end if;
            if v_bif.code = 'DA' then v_da := round(v_manual_amt, 2); end if;
          else
            v_ltype := case v_bif.category when 'earning' then 'earning' when 'employer_contribution' then 'employer_contribution' else 'deduction' end;
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, calc_formula, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_ltype, v_bif.code, v_bif.name, null, v_bif.calc_rate, v_bif.amount, v_bif.category, v_bif.calculation_type, v_bif.calc_base, v_bif.calc_formula, v_bif.display_order);
            if v_ltype = 'earning' then v_gross := v_gross + v_bif.amount;
            elsif v_ltype = 'employer_contribution' then v_empc := v_empc + v_bif.amount;
            else v_ded := v_ded + v_bif.amount; end if;
            if v_bif.is_basic then v_basic := v_bif.amount; end if;
            if v_bif.code = 'DA' then v_da := v_bif.amount; end if;
          end if;
        end loop;

        if not exists (select 1 from public.payroll_lines where payroll_employee_result_id = v_result_id and calc_type = 'advance_recovery') then
          if exists (select 1 from public.advance_recovery_transactions x
                     where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
            select coalesce(sum(x.amount), 0) into v_advrec_extra
            from public.advance_recovery_transactions x
            where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
              and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
          else
            v_advrec_extra := 0;
            for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
              v_advrec_extra := v_advrec_extra + coalesce(v_rec.deducted_amount, 0);
            end loop;
          end if;
          if coalesce(v_advrec_extra, 0) > 0 or exists (select 1 from public.advance_recovery_plans p where p.employee_id = v_emp.id and p.status in ('recovering', 'recovery_pending')) then
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, amount, source, calc_type, calculation_ref, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, 'deduction', 'ADVREC', 'Advance Recovery', round(coalesce(v_advrec_extra, 0), 2), 'advance_recovery', 'advance_recovery',
                    'advance_payroll_period:' || v_adv_period_id::text, 95);
            v_ded := v_ded + round(coalesce(v_advrec_extra, 0), 2);
            v_advrec := coalesce(v_advrec_extra, 0);
          end if;
        end if;
      exception when others then
        delete from public.payroll_lines where payroll_employee_result_id = v_result_id;
        v_gross := 0; v_ded := 0; v_empc := 0; v_advrec := 0;
        v_review := true; v_notes := v_notes || 'Salary structure calculation failed: ' || sqlerrm || '. ';
      end;

      for v_comp in
        select * from public.payroll_salary_components
        where company_id = v_run.company_id and is_active and component_type = 'earning' and source in ('overtime', 'night_duty')
          and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
          and not (source = 'overtime' and v_pol.ot_enabled)
          and not (source = 'night_duty' and v_pol.nd_earning_enabled)
        order by sort_order, code
      loop
        v_qty := null; v_rate := null; v_amt := 0;
        if v_comp.source = 'overtime' then
          v_qty := round(v_ot_min / 60.0, 2); v_rate := v_pol.overtime_hourly_rate;
          if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Overtime hourly rate not configured. '; end if;
          else v_amt := round(v_qty * v_rate, 2); end if;
        else
          v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate;
          if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
          else v_amt := round(v_qty * v_rate, 2); end if;
        end if;
        insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
        values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, 'attendance_input', v_comp.sort_order);
        v_gross := v_gross + v_amt;
      end loop;

      v_gross_pre := v_gross;
      v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                  v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), v_struct_id,
                  v_leave, v_exit_pay, v_manual_components, coalesce(v_late_min, 0));
      v_gross := (v_pol_j ->> 'gross')::numeric;
      v_ded := (v_pol_j ->> 'total_deductions')::numeric;
      v_net := (v_pol_j ->> 'net')::numeric;
      v_empc := v_empc + (v_pol_j ->> 'employer_contribution_extra')::numeric;
      if (v_pol_j ->> 'needs_review')::boolean then v_review := true; end if;
      if coalesce(v_pol_j ->> 'review_note', '') <> '' then v_notes := v_notes || (v_pol_j ->> 'review_note') || ' '; end if;
      v_hasneg := v_net < 0;

      update public.payroll_employee_results
      set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2),
          employer_contribution_total = v_empc, net_salary = v_net,
          salary_structure_id = v_struct_id, gross_from_structure = v_res_gross, structure_reconciled = true,
          basic_snapshot = v_basic, da_snapshot = v_da,
          policy_snapshot = v_pol_j -> 'snapshot',
          proration_factor = case when v_gross_pre = 0 then null else round(v_gross / nullif(v_gross_pre, 0), 6) end,
          lwp_deduction_amount = coalesce((v_pol_j ->> 'lwp_amount')::numeric, 0),
          statutory_deduction_total = coalesce((v_pol_j ->> 'statutory_total')::numeric, 0),
          exit_proration_amount = coalesce((v_pol_j ->> 'prorate_exit_amount')::numeric, 0),
          salary_structure_scope = v_ss_scope,
          has_negative_net = v_hasneg, needs_review = v_review, review_notes = nullif(v_notes, '')
      where id = v_result_id;

      v_r_gross := v_r_gross + v_gross; v_r_ded := v_r_ded + v_ded; v_r_adv := v_r_adv + round(v_advrec, 2); v_r_net := v_r_net + v_net; v_cnt := v_cnt + 1;
      continue;
    end if;
    -- ================= LEGACY Basic+DA path =================

    v_basic := coalesce(v_sal.basic_salary, 0);
    v_da := coalesce(v_sal.da, 0);
    if v_sal.effective_from is null then v_review := true; v_notes := v_notes || 'No effective salary structure for this period. '; end if;

    v_gross := 0;
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'earning'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        and not (source = 'overtime' and v_pol.ot_enabled)
        and not (source = 'night_duty' and v_pol.nd_earning_enabled)
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.source = 'basic' then v_amt := round(v_basic, 2);
      elsif v_comp.source = 'da' then v_amt := round(v_da, 2);
      elsif v_comp.source = 'overtime' then
        v_qty := round(v_ot_min / 60.0, 2); v_rate := v_pol.overtime_hourly_rate;
        if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Overtime hourly rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
      elsif v_comp.source = 'night_duty' then
        v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate;
        if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
      else v_amt := 0; end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, v_comp.calculation_method, v_comp.sort_order);
      v_gross := v_gross + v_amt;
    end loop;

    v_ded := 0; v_advrec := 0;
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'deduction'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        and not (calculation_method = 'lwp' and v_pol.lwp_enabled)
        and not (source = 'statutory' and exists (
                   select 1 from public.payroll_statutory_rules sr
                   where sr.payroll_policy_id = v_pol.id and sr.enabled and upper(sr.kind) = payroll_salary_components.code))
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.calculation_method = 'not_configured' then v_amt := 0;
      elsif v_comp.calculation_method = 'lwp' then
        if v_pol.lwp_divisor is not null and coalesce(v_lwp_days, 0) > 0 then
          v_rate := round((case v_pol.lwp_divisor_basis when 'basic' then v_basic when 'gross' then v_gross else v_basic + v_da end) / v_pol.lwp_divisor, 4);
          v_qty := v_lwp_days; v_amt := round(v_rate * v_lwp_days, 2);
        else
          v_amt := 0;
          if coalesce(v_lwp_days, 0) > 0 then v_review := true; v_notes := v_notes || format('%s LWP day(s) — LWP salary divisor not configured. ', v_lwp_days); end if;
        end if;
      elsif v_comp.calculation_method = 'advance_recovery' then
        if exists (select 1 from public.advance_recovery_transactions x
                   where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
          select coalesce(sum(x.amount), 0) into v_advrec
          from public.advance_recovery_transactions x
          where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
            and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
        else
          v_advrec := 0;
          for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
            v_advrec := v_advrec + coalesce(v_rec.deducted_amount, 0);
          end loop;
        end if;
        v_amt := round(v_advrec, 2);
      else v_amt := 0; end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, calculation_ref, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'deduction', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, v_comp.calculation_method,
              case when v_comp.calculation_method = 'advance_recovery' then 'advance_payroll_period:' || v_adv_period_id::text else null end, v_comp.sort_order);
      v_ded := v_ded + v_amt;
    end loop;

    v_gross_pre := v_gross;
    v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), null,
                v_leave, v_exit_pay, v_manual_components, coalesce(v_late_min, 0));
    v_gross := (v_pol_j ->> 'gross')::numeric;
    v_ded := (v_pol_j ->> 'total_deductions')::numeric;
    v_net := (v_pol_j ->> 'net')::numeric;
    v_empc := (v_pol_j ->> 'employer_contribution_extra')::numeric;
    if (v_pol_j ->> 'needs_review')::boolean then v_review := true; end if;
    if coalesce(v_pol_j ->> 'review_note', '') <> '' then v_notes := v_notes || (v_pol_j ->> 'review_note') || ' '; end if;
    v_hasneg := v_net < 0;

    update public.payroll_employee_results
    set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2), net_salary = v_net,
        employer_contribution_total = coalesce(v_empc, 0),
        policy_snapshot = v_pol_j -> 'snapshot',
        proration_factor = case when v_gross_pre = 0 then null else round(v_gross / nullif(v_gross_pre, 0), 6) end,
        lwp_deduction_amount = coalesce((v_pol_j ->> 'lwp_amount')::numeric, 0),
        statutory_deduction_total = coalesce((v_pol_j ->> 'statutory_total')::numeric, 0),
        exit_proration_amount = coalesce((v_pol_j ->> 'prorate_exit_amount')::numeric, 0),
        salary_structure_scope = v_ss_scope,
        has_negative_net = v_hasneg, needs_review = v_review, review_notes = nullif(v_notes, '')
    where id = v_result_id;

    v_r_gross := v_r_gross + v_gross; v_r_ded := v_r_ded + v_ded; v_r_adv := v_r_adv + round(v_advrec, 2); v_r_net := v_r_net + v_net; v_cnt := v_cnt + 1;
  end loop;

  update public.payroll_runs
  set status = 'calculated', completed_at = now(),
      employee_count = v_cnt, gross_total = v_r_gross, deduction_total = v_r_ded, advance_recovery_total = v_r_adv, net_total = v_r_net
  where id = v_run.id
  returning * into v_run;
  update public.payroll_periods set status = 'calculated', updated_by = auth.uid() where id = v_period.id;
  return v_run;
end;
$function$;

-- ---------------------------------------------------------------- payroll_policy_preview (same signature; + late_minutes input, + ot_late_basis output)
CREATE OR REPLACE FUNCTION public.payroll_policy_preview(p_employee_id uuid, p_period_month date, p_inputs jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_company uuid; v_store uuid; v_pstart date; v_pend date; v_working numeric;
  v_pol public.payroll_policies;
  v_res record; v_struct uuid; v_gross numeric; v_basic numeric; v_da numeric;
  v_bif record;
  v_earn jsonb := '[]'::jsonb; v_ded jsonb := '[]'::jsonb; v_empc jsonb := '[]'::jsonb;
  l record; v_fin jsonb; o jsonb;
  v_g numeric := 0; v_join date; v_leave date; v_exit_pay boolean; v_adv numeric;
  v_lines_deds jsonb := '[]'::jsonb;
  v_cal public.store_payroll_calendars;
  v_manual_comp jsonb; v_comp_amounts jsonb := '{}'::jsonb;
  v_errs text[] := '{}'; v_issues jsonb := '[]'::jsonb; v_lnotes jsonb := '{}'::jsonb;
  v_tds_pol public.tds_policies; v_tds jsonb := null; v_annual numeric; v_decl record; v_fy date;
  b record; v_ot_amt numeric; v_late_amt numeric;
  v_ot_min numeric := coalesce((p_inputs ->> 'ot_minutes')::numeric, 0);
  v_late_min numeric := coalesce((p_inputs ->> 'late_minutes')::numeric, 0);
begin
  if p_employee_id is null then
    -- Virtual employee (Add Employee / Salary Structure Test): READ-ONLY what-if for a company + Gross (+ optional test joining date).
    v_company := nullif(p_inputs ->> 'company_id', '')::uuid;
    if nullif(p_inputs ->> 'gross', '') is null then raise exception 'Enter a Gross salary to preview.'; end if;
    v_join := nullif(p_inputs ->> 'joining_date', '')::date;
  else
    select company_id, store_id, joining_date, leaving_date into v_company, v_store, v_join, v_leave from public.employees where id = p_employee_id;
  end if;
  if v_company is null then raise exception 'Employee not found.'; end if;
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and v_company = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  v_pstart := date_trunc('month', p_period_month)::date;
  v_pend := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  v_working := (v_pend - v_pstart + 1);
  v_pol := public.payroll_resolve_policy_for_employee(v_company, p_employee_id, v_pend);
  -- What-if overrides of joining / leaving date are honoured ONLY for Super Admin / payroll managers (the Policy Preview tool).
  -- Everyone else is evaluated on the employee's real dates read here on the server (service-eligibility depends on them).
  if public.is_super_admin() or public.payroll_can_manage(v_company) then
    v_join := coalesce((p_inputs ->> 'joining_date')::date, v_join);
    v_leave := coalesce((p_inputs ->> 'leaving_date')::date, v_leave);
  end if;
  v_exit_pay := v_pol.exit_date_payable;

  if v_pol.working_days_method = 'store_calendar' then
    v_cal := public.payroll_resolve_store_calendar(v_company, v_store, v_pend);
    if v_cal.id is not null then v_working := coalesce(public.payroll_calendar_working_days(v_cal.id, v_pstart, v_pend), v_working); end if;
  end if;

  select r.gross_salary, r.salary_structure_id, r.structure_name, r.source, r.ambiguous, r.resolve_note into v_res
  from public.salary_resolve_core(p_employee_id, v_pend, nullif(p_inputs ->> 'gross', '')::numeric, v_company) r;
  v_gross := coalesce((p_inputs ->> 'gross')::numeric, v_res.gross_salary, 0);
  v_struct := v_res.salary_structure_id;
  v_basic := coalesce((p_inputs ->> 'basic')::numeric, 0);
  v_da := coalesce((p_inputs ->> 'da')::numeric, 0);

  if v_struct is not null then
    for v_bif in select * from public.salary_bifurcate(v_struct, v_gross) loop
      if v_bif.calculation_type = 'advance_recovery' then continue;
      elsif v_bif.category = 'earning' then
        v_earn := v_earn || jsonb_build_object('code', v_bif.code, 'name', v_bif.name, 'amount', v_bif.amount, 'calc_type', v_bif.calculation_type, 'calc_base', v_bif.calc_base);
        v_g := v_g + v_bif.amount;
        if v_bif.is_basic then v_basic := v_bif.amount; end if;
        if v_bif.code = 'DA' then v_da := v_bif.amount; end if;
      elsif v_bif.category = 'employer_contribution' then
        v_empc := v_empc || jsonb_build_object('code', v_bif.code, 'name', v_bif.name, 'amount', v_bif.amount);
      else
        v_ded := v_ded || jsonb_build_object('code', v_bif.code, 'name', v_bif.name, 'amount', v_bif.amount, 'calc_type', v_bif.calculation_type);
        v_lines_deds := v_lines_deds || jsonb_build_object('code', v_bif.code, 'amount', v_bif.amount);
      end if;
    end loop;
  else
    v_g := v_gross;
    v_earn := jsonb_build_array(jsonb_build_object('code', 'GROSS', 'name', 'Gross (flat)', 'amount', v_gross, 'calc_type', 'flat'));
  end if;

  v_adv := coalesce((p_inputs ->> 'advance_recovery')::numeric, 0);
  if v_adv > 0 then
    v_ded := v_ded || jsonb_build_object('code', 'ADVREC', 'name', 'Advance Recovery', 'amount', v_adv, 'calc_type', 'advance_recovery');
    v_lines_deds := v_lines_deds || jsonb_build_object('code', 'ADVREC', 'amount', v_adv, 'protected', true);
  end if;
  for o in select * from jsonb_array_elements(coalesce(p_inputs -> 'other_deductions', '[]'::jsonb)) loop
    v_ded := v_ded || (o || jsonb_build_object('calc_type', 'other'));
    v_lines_deds := v_lines_deds || jsonb_build_object('code', o ->> 'code', 'amount', (o ->> 'amount')::numeric);
  end loop;

  -- real TDS (inert unless fully configured)
  v_tds_pol := public.tds_resolve_policy(v_company, v_pend);
  if v_tds_pol.id is not null then
    if v_tds_pol.annualization_method = 'flat_x12' then
      v_fy := coalesce(v_tds_pol.financial_year_start, make_date(extract(year from v_pend)::int, 4, 1));
      select * into v_decl from public.tds_employee_declarations where employee_id = p_employee_id and financial_year_start = v_fy;
      v_annual := greatest(v_g * 12 + coalesce(v_decl.previous_employer_income, 0) + coalesce(v_decl.other_income, 0)
        - coalesce(v_tds_pol.standard_deduction, 0) - coalesce(v_decl.investment_declared, 0) - coalesce(v_decl.other_exemptions, 0), 0);
      v_tds := public.tds_compute(v_tds_pol.id, v_annual);
    else
      v_tds := jsonb_build_object('configured', false, 'reason', format('Annualization method "%s" needs year-to-date income.', coalesce(v_tds_pol.annualization_method, 'not defined')));
    end if;
  end if;

  -- manual / imported PF/ESI amounts: explicit override in p_inputs, else this period's stored values
  v_manual_comp := coalesce(p_inputs -> 'manual_components', '{}'::jsonb);
  if v_manual_comp = '{}'::jsonb then
    select coalesce(jsonb_object_agg(upper(pca.component_code),
             jsonb_build_object('employee_amount', pca.employee_amount, 'employer_amount', pca.employer_amount, 'source', pca.source)), '{}'::jsonb)
      into v_manual_comp
    from public.payroll_component_amounts pca
    join public.payroll_periods pp on pp.id = pca.payroll_period_id
    where pp.company_id = v_company and pp.period_month = v_pstart and pca.employee_id = p_employee_id;
  end if;
  select coalesce(jsonb_object_agg(x ->> 'code', (x ->> 'amount')::numeric), '{}'::jsonb) into v_comp_amounts
  from jsonb_array_elements(v_earn) x;

  begin   -- a failure while computing the common components must never hide the resolved Grade / Structure / Slab
  for l in select * from public.payroll_policy_compute_lines(
             v_pol.id, v_pstart, v_pend, v_working, v_join, v_basic, v_da, v_g,
             coalesce((p_inputs ->> 'lwp_days')::numeric, 0),
             v_ot_min,
             coalesce((p_inputs ->> 'nd_value')::numeric, 0),
             v_struct, (select coalesce(array_agg(x->>'code'), '{}') from jsonb_array_elements(v_earn || v_ded) x),
             v_leave, v_exit_pay, v_tds, v_manual_comp, v_comp_amounts, v_late_min)
  loop
    if l.code = 'OT' then v_ot_amt := l.amount; elsif l.code = 'LATE' then v_late_amt := l.amount; end if;
    v_lnotes := v_lnotes || jsonb_build_object(l.code, l.calc_note);   -- per-line explanation (e.g. "Not applicable - 12 months of service ...")
    if l.unresolved then   -- component-specific problem (e.g. invalid formula) with the reason, for the screen
      v_issues := v_issues || jsonb_build_object('code', l.code, 'name', l.name, 'line_type', l.line_type, 'note', l.calc_note);
    end if;
    if l.line_type = 'earning' then
      v_earn := v_earn || jsonb_build_object('code', l.code, 'name', l.name, 'amount', l.amount, 'calc_type', l.calc_type, 'note', l.calc_note, 'unresolved', l.unresolved);
      v_g := v_g + l.amount;
    elsif l.line_type = 'employer_contribution' then
      v_empc := v_empc || jsonb_build_object('code', l.code, 'name', l.name, 'amount', l.amount, 'note', l.calc_note);
    else
      v_ded := v_ded || jsonb_build_object('code', l.code, 'name', l.name, 'amount', l.amount, 'calc_type', l.calc_type, 'note', l.calc_note, 'unresolved', l.unresolved);
      v_lines_deds := v_lines_deds || jsonb_build_object('code', l.code, 'amount', l.amount);
    end if;
  end loop;
  exception when others then
    v_errs := array_append(v_errs, sqlerrm);
  end;

  v_fin := public.payroll_policy_finalize(v_pol.id, v_g, v_lines_deds);

  -- the SAME basis function the payroll lines use (never a second formula)
  select * into b from public.payroll_ot_late_basis(v_pol.id, v_pstart, v_pend, v_basic, v_da);

  return jsonb_build_object(
    'errors', to_jsonb(v_errs), 'issues', v_issues, 'line_notes', v_lnotes,
    'salary_structure', jsonb_build_object(
      'id', v_struct, 'code', (select ss.code from public.salary_structures ss where ss.id = v_struct), 'name', v_res.structure_name,
      'source', v_res.source, 'ambiguous', coalesce(v_res.ambiguous, false), 'note', v_res.resolve_note,
      'gross', coalesce(v_res.gross_salary, 0)),
    'policy', jsonb_build_object('id', v_pol.id, 'code', v_pol.code, 'name', v_pol.policy_name, 'version_no', v_pol.version_no,
                                 'effective_from', v_pol.effective_from, 'effective_to', v_pol.effective_to,
                                 'working_days_method', v_pol.working_days_method, 'exit_date_payable', v_pol.exit_date_payable),
    'store_calendar', case when v_cal.id is not null then jsonb_build_object('id', v_cal.id, 'name', v_cal.name, 'working_days', v_working) else null end,
    'ot_late_basis', jsonb_build_object(
      'period_month', v_pstart, 'period_start', v_pstart, 'period_end', v_pend,
      'basic', v_basic, 'da', v_da, 'wage_base', b.wage_base,
      'calendar_days', b.calendar_days, 'std_hours_per_day', b.std_hours,
      'daily_rate', b.daily_rate, 'hourly_rate', b.hourly_rate,
      'ot_enabled', v_pol.ot_enabled, 'ot_minutes', v_ot_min, 'ot_hours', v_ot_min / 60.0, 'ot_amount', v_ot_amt,
      'ot_multiplier', null,
      'ot_multiplier_note', 'Payroll applies NO separate OT multiplier: payable OT minutes come from the Attendance OT Rule and are valued at 1x the hourly wage. Any premium must be expressed by that rule (slab).',
      'late_enabled', v_pol.late_deduction_enabled, 'late_minutes', v_late_min, 'late_hours', v_late_min / 60.0, 'late_amount', v_late_amt),
    'gross', v_g,
    'earnings', v_earn,
    'deductions', v_fin -> 'ordered',
    'employer_contributions', v_empc,
    'total_deductions', v_fin -> 'total_deductions',
    'net_salary', v_fin -> 'net',
    'cap', v_fin -> 'cap',
    'cap_reduction', v_fin -> 'cap_reduction',
    'negative_net_policy', v_fin -> 'negative_net_policy',
    'negative_flag', v_fin -> 'negative_flag',
    'priority_configured', v_fin -> 'priority_configured',
    'tds', coalesce(v_tds, jsonb_build_object('configured', false, 'reason', 'No active TDS policy.'))
  );
end;
$function$;

-- ---------------------------------------------------------------- data: hours/day for never-configured policies only
-- Only a policy whose hours/day was never set AND that no payroll result references. Configured or used policies are untouched.
update public.payroll_policies p
   set ot_std_hours_per_day = 10
 where p.ot_std_hours_per_day is null
   and not exists (select 1 from public.payroll_employee_results r where r.payroll_policy_id = p.id);
