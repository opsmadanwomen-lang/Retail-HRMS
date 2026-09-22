-- ============================================================================
-- Retail HRMS — reusable ELIGIBILITY condition on Common Payroll Components (first use: Medical Fund, 12 months' service)
-- Migration 0181  (additive; requires 0178-0180)
--
-- INSPECTED FIRST: a component rule (payroll_statutory_rules) already has effective_from / effective_to and an
-- enabled flag, and payroll already passes the employee's joining_date and the period end date into
-- payroll_policy_compute_lines (from payroll_calculate_run: v_join := employees.joining_date; period_end_date).
-- What it did NOT have is any tenure / employee-attribute eligibility. So the existing rule is extended minimally:
--   eligibility_type    'always' (default — every existing rule keeps behaving exactly as before) | 'after_months'
--   eligibility_months  N (stored as DATA on the rule, 0..600; nothing is hard-coded in code)
-- Eligibility is evaluated INSIDE the existing rule engine (payroll_policy_compute_lines), so Payroll, Preview and F&F
-- all use the same code; it is separate from the amount formula (Medical Fund keeps its Gross-band formula unchanged).
-- Date rule: joining_date + N calendar months <= PAYROLL PERIOD END DATE (the date payroll already uses for salary,
-- policy and employment status). The employee's own joining_date is read from the employee row on the server; the
-- browser never supplies it. Missing joining date => Rs 0 + review flag (never a guessed amount).
--
-- payroll_policy_preview also returns line_notes (code -> explanation) so the screen can say "Not applicable ...".
-- NOT changed: salary slab resolver, structure routing, salary_bifurcate, payroll_calculate_run, OT / LWP / Advance
-- engines, any payroll result. No company data is written by this migration.
-- ============================================================================

alter table public.payroll_statutory_rules
  add column if not exists eligibility_type text not null default 'always',
  add column if not exists eligibility_months integer;

alter table public.payroll_statutory_rules
  drop constraint if exists payroll_statutory_rules_eligibility_type_check,
  drop constraint if exists payroll_statutory_rules_eligibility_months_check;
alter table public.payroll_statutory_rules
  add constraint payroll_statutory_rules_eligibility_type_check check (eligibility_type in ('always', 'after_months')),
  add constraint payroll_statutory_rules_eligibility_months_check check (
    (eligibility_type = 'always' and (eligibility_months is null or eligibility_months between 0 and 600))
    or (eligibility_type = 'after_months' and eligibility_months is not null and eligibility_months between 0 and 600)
  );

-- compute_lines (live body + eligibility)
CREATE OR REPLACE FUNCTION public.payroll_policy_compute_lines(p_policy_id uuid, p_period_start date, p_period_end date, p_working_days numeric, p_joining_date date, p_basic numeric, p_da numeric, p_gross numeric, p_lwp_days numeric, p_ot_minutes numeric, p_nd_value numeric, p_structure_id uuid DEFAULT NULL::uuid, p_existing_codes text[] DEFAULT '{}'::text[], p_leaving_date date DEFAULT NULL::date, p_exit_date_payable boolean DEFAULT NULL::boolean, p_tds jsonb DEFAULT NULL::jsonb, p_manual_components jsonb DEFAULT '{}'::jsonb, p_component_amounts jsonb DEFAULT '{}'::jsonb)
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
  v_stdh numeric;
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
  v_edate date;
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
  v_stdh := nullif(coalesce(p.ot_std_hours_per_day, 0), 0);

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

  -- ---- 2. Overtime â€” SYSTEM-CALCULATED, sourced ONLY from the Attendance OT Rule Engine ----
  -- p_ot_minutes is attendance_records.payable_overtime_minutes: eligibility, minimum, slab,
  -- rounding and maximum have ALREADY been applied by the configured Attendance OT Rule
  -- (calculate_overtime_minutes). Payroll adds NO rate method, NO fixed amount, NO %-of-salary,
  -- NO formula, NO Excel import and NO override. It only VALUES those payable minutes at the
  -- employee's ordinary hourly wage (Basic+DA over the standard monthly hours). The OT premium
  -- (1.5x / 2x / slab) is entirely inside p_ot_minutes.
  if p.ot_enabled and coalesce(p_ot_minutes, 0) > 0 and not ('OT' = any(p_existing_codes)) then
    v_hours := round(p_ot_minutes / 60.0, 2);
    if v_div is null or v_stdh is null then
      v_rate := null; v_amt := 0; unresolved := true;
      v_note := format('%s payable OT minute(s) from the Attendance OT Rule â€” cannot be valued: standard hours/day and/or a proration divisor are not configured.', p_ot_minutes);
    else
      v_rate := round((p_basic + p_da) / v_div / v_stdh, 4);   -- ordinary per-hour wage (Basic+DA / divisor / std hours)
      v_amt := round(v_hours * v_rate, v_prec);
      unresolved := false;
      v_note := format('%s payable OT min from the Attendance OT Rule (premium already applied) Ã— ordinary hourly wage %s (Basic+DA Ã· %s Ã· %s h/day)', p_ot_minutes, v_rate, v_div, v_stdh);
    end if;
    kind := 'earning_ot'; line_type := 'earning'; code := 'OT'; name := 'Overtime';
    quantity := v_hours; rate := v_rate; amount := v_amt; calc_type := 'overtime_attendance'; calc_base := 'basic_da'; calc_note := v_note;
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
      v_edate := null;
      if p_joining_date is not null then
        v_edate := (p_joining_date + make_interval(months => coalesce(r.eligibility_months, 0)))::date;
      end if;
      if v_edate is null or v_edate > p_period_end then
        kind := (case when v_clt = 'earning' then 'earning_' else 'deduction_' end) || r.kind; line_type := v_clt;
        code := v_ccode; name := v_cname; quantity := null; rate := null; amount := 0;
        calc_type := v_cctype; calc_base := 'eligibility';
        if v_edate is null then
          calc_note := format('%s: joining date is missing - the %s-month service condition cannot be checked, so no amount is applied.', v_ccode, r.eligibility_months);
          unresolved := true;
        else
          calc_note := format('Not applicable - %s months of service complete on %s.', r.eligibility_months, to_char(v_edate, 'DD Mon YYYY'));
          unresolved := false;
        end if;
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

-- preview (live body + line_notes)
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
begin
  select company_id, store_id, joining_date, leaving_date into v_company, v_store, v_join, v_leave from public.employees where id = p_employee_id;
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
  from public.salary_resolve_core(p_employee_id, v_pend, nullif(p_inputs ->> 'gross', '')::numeric) r;
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
             coalesce((p_inputs ->> 'ot_minutes')::numeric, 0),
             coalesce((p_inputs ->> 'nd_value')::numeric, 0),
             v_struct, (select coalesce(array_agg(x->>'code'), '{}') from jsonb_array_elements(v_earn || v_ded) x),
             v_leave, v_exit_pay, v_tds, v_manual_comp, v_comp_amounts)
  loop
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
