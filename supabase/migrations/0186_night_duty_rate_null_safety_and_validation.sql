-- ============================================================================
-- 0186: Night Duty payroll rate — NULL-safe percentage rates + validation
--
-- WHY: payroll_policy_compute_lines() resolves the Night Duty earning's per-unit rate with a
-- CASE on nd_rate_type. The 'fixed' branch correctly does coalesce(p.nd_rate, p.night_duty_day_rate)
-- OUTSIDE any arithmetic, so a blank rate yields v_rate = NULL, which the very next check
-- ("if v_rate is null then ... unresolved := true; v_note := 'Night-duty payroll rate not
-- configured.'") correctly flags. The 'custom_formula' branch is likewise correct: payroll_eval_formula
-- returns NULL for a blank formula, so it too falls into the "not configured" branch. The
-- 'pct_of_basic' and 'pct_of_basic_da' branches instead wrote coalesce(p.nd_rate, 0) INSIDE the
-- percentage arithmetic, so a blank rate silently became a valid 0%, producing v_rate = 0 (not NULL).
-- That is NOT NULL, so it skips the "not configured" branch entirely and instead inserts a Night Duty
-- earning line with amount = 0 and unresolved = FALSE — a silently wrong Rs 0.00 line indistinguishable
-- (to the payroll preparer) from "correctly computed to zero", instead of the review-flagged Rs 0.00
-- every other unconfigured component in this same function produces (OT/Late hourly basis, LWP daily
-- rate, PF/ESI/PT/TDS, every common component). This is the exact reported symptom: Rate Type = "% of
-- Basic+DA", Rate left blank -> the payslip shows no error, just an absent/zero Night Duty amount.
--
-- WHAT (additive; CREATE OR REPLACE only, SAME signatures as 0185; no history rewritten; no other
-- payroll rule touched):
--   1. payroll_policy_compute_lines: the 'pct_of_basic' / 'pct_of_basic_da' branches now propagate NULL
--      when p.nd_rate is null (matching 'fixed' and 'custom_formula'), instead of coalescing to 0 inside
--      the arithmetic. An explicitly saved rate of 0 is still respected as a deliberate, resolved 0%
--      (coalesce is only removed from the arithmetic, not from the outer NULL check) — only a genuinely
--      BLANK rate now correctly produces the "Night-duty payroll rate not configured" review flag.
--      Every other line in this function (proration, the 0185 configurable OT/Late hourly basis via
--      payroll_ot_late_basis(), the 0184 Late deduction, LWP, PF/ESI/PT/TDS/common components) is
--      reproduced BYTE-FOR-BYTE from 0185's body — this migration touches only the Night Duty CASE.
--   2. payroll_policy_validate: adds an explicit, plain-English check (same style, same location
--      relative to the existing proration/LWP/deduction-cap/OT-Late-basis checks already in this
--      function) so saving a policy with Night Duty earning enabled but an incomplete rate
--      configuration for the selected Rate Type is caught by the Validate button, instead of only
--      surfacing as a silent zero at calculation time. Every other check in this function is
--      reproduced byte-for-byte from 0185's body.
--
-- NOT CHANGED: the Night Duty module itself (attendance_night_duty_approvals, attendance_night_duty_decide,
-- calculate_extended_duty, attendance_records.payable_extra_duty_value) — eligibility, ladder, cutoff and
-- approval remain entirely owned by Attendance/Night-Duty, exactly as documented in the Payroll Settings
-- UI. Payroll still only consumes the already-approved payable value (NDVALUE = the resolved p_nd_value
-- parameter, sourced by payroll_calculate_run from SUM(attendance_records.payable_extra_duty_value) for the
-- employee's attendance rows in the payroll period) and turns it into money at the configured rate. OT,
-- Late, LWP, PF, ESI, PT, TDS, every common component, and payroll_calculate_run itself are untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payroll_policy_compute_lines(p_policy_id uuid, p_period_start date, p_period_end date, p_working_days numeric, p_joining_date date, p_basic numeric, p_da numeric, p_gross numeric, p_lwp_days numeric, p_ot_minutes numeric, p_nd_value numeric, p_structure_id uuid DEFAULT NULL::uuid, p_existing_codes text[] DEFAULT '{}'::text[], p_leaving_date date DEFAULT NULL::date, p_exit_date_payable boolean DEFAULT NULL::boolean, p_tds jsonb DEFAULT NULL::jsonb, p_manual_components jsonb DEFAULT '{}'::jsonb, p_component_amounts jsonb DEFAULT '{}'::jsonb, p_late_minutes numeric DEFAULT 0)
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

  -- ---- Company OT / Late hourly basis (migration 0184, made CONFIGURABLE by 0185) ----
  -- wage basis and day divisor are now policy configuration (ot_late_basis / ot_late_divisor_method), not a
  -- hard-coded Basic+DA / calendar-days formula. It still never depends on the PRORATION method, the
  -- working-days METHOD SELECTION only matters if ot_late_divisor_method = 'working_days'. ONE function
  -- owns the formula: payroll_ot_late_basis(); Overtime and Late both use its wage base / divisor / std hours below.
  select * into b from public.payroll_ot_late_basis(p_policy_id, p_period_start, p_period_end, p_basic, p_da, p_gross, p_working_days, p_component_amounts);

  -- ---- 2. Overtime - SYSTEM-CALCULATED, sourced ONLY from the Attendance OT Rule Engine ----
  -- p_ot_minutes is attendance_records.payable_overtime_minutes: eligibility, minimum, slab, rounding and maximum have
  -- ALREADY been applied by the configured Attendance OT Rule. Payroll adds NO rate method, NO multiplier, NO fixed
  -- amount, NO %-of-salary, NO formula, NO Excel import and NO override - it only VALUES those payable minutes at the
  -- company hourly basis. Full precision is kept until the final amount, which is rounded once (currency precision).
  if p.ot_enabled and coalesce(p_ot_minutes, 0) > 0 and not ('OT' = any(p_existing_codes)) then
    v_hours := p_ot_minutes / 60.0;
    if b.hourly_rate is null then
      v_rate := null; v_amt := 0; unresolved := true;
      v_note := format('%s payable OT minute(s) from the Attendance OT Rule - cannot be valued: the configured hourly wage basis / divisor / standard hours (Payroll Rules -> Overtime) is incomplete.', p_ot_minutes);
    else
      v_rate := round(b.hourly_rate, 6);
      v_amt := round(p_ot_minutes * b.wage_base / (60.0 * b.divisor * b.std_hours), v_prec);
      unresolved := false;
      v_note := format('%s payable OT min (%s h) from the Attendance OT Rule x hourly wage %s = wage base %s (%s) / divisor %s (%s) / %s h', p_ot_minutes, round(v_hours, 4), v_rate, b.wage_base, b.basis_method, b.divisor, b.divisor_method, b.std_hours);
    end if;
    kind := 'earning_ot'; line_type := 'earning'; code := 'OT'; name := 'Overtime';
    quantity := round(v_hours, 4); rate := v_rate; amount := v_amt; calc_type := 'overtime_attendance'; calc_base := b.basis_method; calc_note := v_note;
    return next;
  end if;

  -- ---- 2b. Late deduction (migration 0184) - SAME configurable hourly basis as Overtime ----
  -- p_late_minutes is attendance_records.penalty_minutes: the chargeable late minutes AFTER the Attendance Late Rule
  -- (grace / minimum / rounding), the Information exemption and the Attendance Penalty Rule (fixed / multiplier / slab,
  -- applicability). Payroll re-implements none of that; it only values the minutes.
  if p.late_deduction_enabled and coalesce(p_late_minutes, 0) > 0 and not ('LATE' = any(p_existing_codes)) then
    v_hours := p_late_minutes / 60.0;
    if b.hourly_rate is null then
      v_rate := null; v_amt := 0; unresolved := true;
      v_note := format('%s payable late minute(s) from the Attendance Penalty Rule - cannot be valued: the configured hourly wage basis / divisor / standard hours (Payroll Rules -> Overtime) is incomplete.', p_late_minutes);
    else
      v_rate := round(b.hourly_rate, 6);
      v_amt := round(p_late_minutes * b.wage_base / (60.0 * b.divisor * b.std_hours), v_prec);
      unresolved := false;
      v_note := format('%s payable late min (%s h) from the Attendance Late/Penalty Rule x hourly wage %s = wage base %s (%s) / divisor %s (%s) / %s h', p_late_minutes, round(v_hours, 4), v_rate, b.wage_base, b.basis_method, b.divisor, b.divisor_method, b.std_hours);
    end if;
    kind := 'deduction_late'; line_type := 'deduction'; code := 'LATE'; name := 'Late Deduction';
    quantity := round(v_hours, 4); rate := v_rate; amount := v_amt; calc_type := 'late_attendance'; calc_base := b.basis_method; calc_note := v_note;
    return next;
  end if;

  -- ---- 3. Night-Duty payroll earning ----
  if p.nd_earning_enabled and coalesce(p_nd_value, 0) > 0 and not ('NDUTY' = any(p_existing_codes)) then
    v_note := null;
    v_rate := case p.nd_rate_type
      when 'fixed'           then coalesce(p.nd_rate, p.night_duty_day_rate)
      -- 0186: NULL must propagate (blank rate => not configured), not coalesce to a silent 0% inside the arithmetic.
      when 'pct_of_basic'    then case when v_div is null or p.nd_rate is null then null else round(p_basic / v_div * p.nd_rate / 100.0, 4) end
      when 'pct_of_basic_da' then case when v_div is null or p.nd_rate is null then null else round((p_basic + p_da) / v_div * p.nd_rate / 100.0, 4) end
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

    if coalesce(r.eligibility_type, 'always') = 'after_months' then
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
      if r.calc_method = 'pct_of_base' then
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
        v_mkey := v_ccode;
        v_emp_amt := null; v_er_amt := null; v_mnote := null; v_munres := false;

        if r.calc_method = 'manual' then
          v_man := coalesce(p_manual_components -> v_mkey, p_manual_components -> lower(v_mkey));
          if v_man is null or (v_man ->> 'employee_amount') is null then
            v_munres := true;
            v_mnote := format('%s: Manual / Excel amount not entered for this employee and payroll period.', v_mkey);
          else
            v_emp_amt := round((v_man ->> 'employee_amount')::numeric, v_prec);
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

        kind := (case when v_clt = 'earning' then 'earning_' else 'deduction_' end) || r.kind; line_type := v_clt;
        code := v_ccode; name := v_cname;
        quantity := null;
        rate := case when r.calc_method = 'pct_of_component' then r.employee_rate else null end;
        calc_type := v_cctype;
        calc_base := coalesce(r.calc_base, case when r.calc_method = 'pct_of_component' then r.ref_component_code else r.calc_method end);
        if v_munres then amount := 0; unresolved := true; calc_note := v_mnote;
        else amount := coalesce(v_emp_amt, 0); unresolved := false; calc_note := v_mnote; end if;
        return next;

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

-- ---- payroll_policy_validate: catch an incomplete Night Duty rate configuration at save/Validate time ----
-- (base body reproduced byte-for-byte from 0185; only the new Night Duty block is added)
CREATE OR REPLACE FUNCTION public.payroll_policy_validate(p_policy_id uuid)
 RETURNS TABLE(ok boolean, error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare p public.payroll_policies; v_overlap int; sr record;
begin
  select * into p from public.payroll_policies where id = p_policy_id;
  if p.id is null then ok := false; error := 'Policy not found.'; return next; return; end if;
  if p.effective_from is null then ok := false; error := 'Effective From is required.'; return next; return; end if;
  if p.effective_to is not null and p.effective_to < p.effective_from then ok := false; error := 'Effective To is before Effective From.'; return next; return; end if;

  select count(*) into v_overlap from public.payroll_policies q
  where q.company_id = p.company_id and q.id <> p.id and q.status = 'active'
    and q.effective_from >= p.effective_from
    and daterange(q.effective_from, coalesce(q.effective_to, 'infinity'::date), '[]')
        && daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[]');
  if v_overlap > 0 then ok := false; error := 'Another active policy version starts inside this date range.'; return next; return; end if;

  if p.proration_method = 'custom' and p.proration_custom_divisor is null and coalesce(btrim(p.proration_custom_formula), '') = '' then
    ok := false; error := 'Custom proration method needs a custom divisor or formula.'; return next; return; end if;
  if p.lwp_enabled and coalesce(p.lwp_basis, p.lwp_divisor_basis) is null then
    ok := false; error := 'LWP is enabled but no salary basis is configured.'; return next; return; end if;
  if p.deduction_cap_mode = 'custom' and coalesce(btrim(p.deduction_cap_formula), '') = '' then
    ok := false; error := 'Custom deduction cap needs a formula.'; return next; return; end if;
  if p.ot_late_basis = 'custom' and coalesce(btrim(p.ot_late_basis_formula), '') = '' then
    ok := false; error := 'OT/Late hourly wage basis is set to Custom Formula but none is configured.'; return next; return; end if;
  if p.ot_late_basis = 'component' and coalesce(btrim(p.ot_late_basis_component_code), '') = '' then
    ok := false; error := 'OT/Late hourly wage basis is set to Another Salary Component but no component code is set.'; return next; return; end if;
  if p.ot_late_divisor_method = 'custom' and p.ot_late_divisor_custom is null then
    ok := false; error := 'OT/Late day divisor is set to Custom Divisor but no value is configured.'; return next; return; end if;

  -- 0186: Night Duty earning enabled but the selected Rate Type has no usable rate — same "plain-English,
  -- catch it before calculation" pattern as the OT/Late basis checks above.
  if p.nd_earning_enabled then
    if coalesce(btrim(p.nd_rate_type), '') = '' then
      ok := false; error := 'Night-duty payroll earning is enabled but no Rate Type is selected.'; return next; return;
    elsif p.nd_rate_type = 'custom_formula' then
      if coalesce(btrim(p.nd_custom_formula), '') = '' then
        ok := false; error := 'Night Duty Rate Type is Custom Formula but no formula is configured.'; return next; return; end if;
    elsif p.nd_rate_type = 'fixed' then
      if p.nd_rate is null and p.night_duty_day_rate is null then
        ok := false; error := 'Night Duty Rate Type is Fixed per unit but no rate is configured.'; return next; return; end if;
    else
      if p.nd_rate is null then
        ok := false; error := format('Night Duty Rate Type is "%s" but no rate is configured.', p.nd_rate_type); return next; return; end if;
    end if;
  end if;

  for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and enabled loop
    if sr.calc_method = 'pct_of_component' and coalesce(btrim(sr.ref_component_code), '') = '' then
      ok := false; error := format('%s uses "%% of another component" but no reference component code is set.', coalesce(upper(sr.component_code), upper(sr.kind)));
      return next; return;
    end if;
    if sr.calc_method = 'formula' and coalesce(btrim(sr.base_formula), '') = '' then
      ok := false; error := format('%s uses a custom formula but none is configured.', coalesce(upper(sr.component_code), upper(sr.kind)));
      return next; return;
    end if;
  end loop;

  begin
    if coalesce(btrim(p.proration_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.proration_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1)); end if;
    if coalesce(btrim(p.nd_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.nd_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1, 'NDVALUE', 1, 'DIVISOR', 1)); end if;
    if coalesce(btrim(p.deduction_cap_formula), '') <> '' then perform public.payroll_eval_formula(p.deduction_cap_formula, jsonb_build_object('GROSS', 1)); end if;
    if coalesce(btrim(p.ot_late_basis_formula), '') <> '' then perform public.payroll_eval_formula(p.ot_late_basis_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1)); end if;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(base_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.base_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(employer_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.employer_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
  exception when others then ok := false; error := 'Invalid formula: ' || sqlerrm; return next; return; end;

  ok := true; error := null; return next;
end;
$function$;
