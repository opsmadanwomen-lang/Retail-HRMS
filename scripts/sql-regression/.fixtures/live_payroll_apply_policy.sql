CREATE OR REPLACE FUNCTION public.payroll_apply_policy(p_result_id uuid, p_policy_id uuid, p_period_start date, p_period_end date, p_working_days numeric, p_joining_date date, p_basic numeric, p_da numeric, p_gross numeric, p_lwp_days numeric, p_ot_minutes numeric, p_nd_value numeric, p_structure_id uuid, p_leaving_date date DEFAULT NULL::date, p_exit_date_payable boolean DEFAULT NULL::boolean, p_manual_components jsonb DEFAULT '{}'::jsonb)
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
             p_leaving_date, p_exit_date_payable, v_tds, coalesce(p_manual_components, '{}'::jsonb), v_comp_amounts)
  loop
    insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id,
      line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, calc_formula, sort_order)
    values (v_company, v_run, p_result_id, v_emp, l.line_type, l.code, l.name, l.quantity, l.rate, l.amount,
      'payroll_policy', l.calc_type, l.calc_base, l.calc_note,
      case l.kind
        when 'earning_ot' then 60 when 'earning_nd' then 65 when 'earning_prorate' then 70 when 'earning_prorate_exit' then 72
        when 'deduction_pf' then 300 when 'deduction_esi' then 310 when 'deduction_pt' then 320
        when 'deduction_tds' then 330 when 'deduction_lwp' then 350
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
$function$
