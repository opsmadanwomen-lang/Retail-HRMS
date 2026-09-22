-- ============================================================================
-- Retail HRMS — salary maintained from the Employee profile
-- Migration 0183  (additive, idempotent; requires 0178-0182)
--
-- Employee Salary moves out of Payroll Settings into Employees -> Add / Edit. Two server gaps had to be closed so the screen can
-- reuse the ONE existing engine instead of a second one:
--   1. Add Employee has no employee row yet, and the Salary Structure "Test" has no employee at all, but payroll_policy_preview (the
--      preview that runs salary_bifurcate + the common components + the eligibility rule) required an existing employee id.
--      It now also accepts "no employee": inputs {company_id, gross, [joining_date]} — a READ-ONLY what-if (the function is STABLE and
--      cannot write). The Gross -> slab -> structure lookup is the same code inside salary_resolve_core; it only learned to start from
--      a company when there is no employee row. Nothing about slab matching, salary_bifurcate or payroll_calculate_run changed.
--   2. salary_assign_employee checked payroll_can_manage only. Salary editing now also requires the existing dynamic permission
--      payroll / EDIT (fails open until a Super Admin configures it — exactly how the manual-amount RPCs already behave).
-- NOT changed: employees.grade_id (used by Advance / Payroll policy scoping, transfers, attendance — the payroll "Auto Grade" is
-- DERIVED from the resolved structure and never written), slab rows, structures, OT / LWP / Advance, closed-period guard, history.
-- No data is written by this migration.
-- ============================================================================

drop function if exists public.salary_resolve_core(uuid, date, numeric);
CREATE OR REPLACE FUNCTION public.salary_resolve_core(p_employee_id uuid, p_as_of date, p_gross_override numeric, p_company_id uuid DEFAULT NULL)
 RETURNS TABLE(gross_salary numeric, salary_structure_id uuid, structure_name text, source text, ambiguous boolean, resolve_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_emp record;
  v_asg record;
  v_gross numeric;
  v_struct uuid;
  v_src text := '';
  v_note text := '';
  v_ambig boolean := false;
  v_cnt int;
  v_basic numeric; v_da numeric;
  v_tier record;
  v_hist public.employee_assignment_history;
begin
  select e.company_id, e.store_id, e.store_department_id, e.store_designation_id, e.grade_id, e.category_id,
         e.employment_type::text as employment_type
  into v_emp from public.employees e where e.id = p_employee_id;
  -- "Virtual employee" (Add Employee screen / Salary Structure Test): no employee row exists yet. Only a company and the Gross being
  -- tried are known, so only the company-level slab / company-scope rules can match — the slab lookup below is the SAME code.
  if v_emp.company_id is null and p_employee_id is null and p_company_id is not null and p_gross_override is not null then
    v_emp.company_id := p_company_id;
  end if;
  if v_emp.company_id is null then raise exception 'Employee not found.'; end if;

  -- Employee Transfer (Phase 2 correction): scope-based structure resolution
  -- must use the assignment EFFECTIVE as of p_as_of, not whatever the employee's
  -- live row happens to hold right now (which may lag until a transfer's
  -- effective date is swept) — resolve from the authoritative history ledger.
  -- No history for this employee -> v_hist is all-null -> every coalesce below
  -- falls back to the live columns, so an employee never transferred is
  -- completely unaffected.
  v_hist := public.employee_assignment_as_of(p_employee_id, p_as_of);
  v_emp.store_id := coalesce(v_hist.store_id, v_emp.store_id);
  v_emp.store_department_id := coalesce(v_hist.store_department_id, v_emp.store_department_id);
  v_emp.store_designation_id := coalesce(v_hist.store_designation_id, v_emp.store_designation_id);
  v_emp.grade_id := coalesce(v_hist.grade_id, v_emp.grade_id);
  v_emp.category_id := coalesce(v_hist.category_id, v_emp.category_id);
  v_emp.employment_type := coalesce(v_hist.employment_type, v_emp.employment_type);

  select * into v_asg from public.employee_salary_assignments a
  where a.employee_id = p_employee_id and a.effective_from <= p_as_of and (a.effective_to is null or a.effective_to >= p_as_of)
  order by a.effective_from desc limit 1;

  if p_gross_override is not null then
    -- Preview / revision-save path: the Gross being typed is the input. The structure is NOT taken from the
    -- saved assignment (a new revision carries no explicit structure); scope tiers + slab decide, exactly as payroll.
    v_gross := p_gross_override; v_src := 'entered_gross';
  elsif v_asg.id is not null then
    v_gross := v_asg.gross_salary; v_src := 'assignment';
    if v_asg.salary_structure_id is not null then v_struct := v_asg.salary_structure_id; v_src := v_src || '+explicit_structure'; end if;
  else
    select sc.basic_salary, sc.da into v_basic, v_da
    from public.employee_salary_components sc
    where sc.employee_id = p_employee_id and sc.effective_from <= p_as_of and (sc.effective_to is null or sc.effective_to >= p_as_of)
    order by sc.effective_from desc limit 1;
    if v_basic is not null then
      v_gross := coalesce(v_basic, 0) + coalesce(v_da, 0); v_src := 'legacy_raw';
      v_note := 'No dynamic salary assignment — legacy Basic+DA used as Gross. Assign a salary structure for dynamic bifurcation.';
    else
      v_gross := 0; v_src := 'none'; v_note := 'No salary assignment or legacy salary components for this employee.';
    end if;
  end if;

  if v_struct is null and v_gross > 0 then
    for v_tier in
      select ord, scope, ss, cnt from (
        select 1 ord, 'employee' scope, (array_agg(sa.salary_structure_id order by sa.priority))[1] ss, count(*) cnt, min(sa.priority) minp,
               count(*) filter (where sa.priority = (select min(x.priority) from public.salary_structure_assignments x
                 where x.company_id=v_emp.company_id and x.is_active and x.scope_type='employee' and x.employee_id=p_employee_id
                   and x.effective_from<=p_as_of and (x.effective_to is null or x.effective_to>=p_as_of))) tied
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='employee' and sa.employee_id=p_employee_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 2, 'grade', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0,
               count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='grade' and sa.grade_id=v_emp.grade_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 3, 'category', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='category' and sa.category_id=v_emp.category_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 4, 'store_designation', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_designation' and sa.store_designation_id=v_emp.store_designation_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 5, 'store_department', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_department' and sa.store_department_id=v_emp.store_department_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 6, 'location', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type in ('location','store') and sa.store_id=v_emp.store_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 7, 'employment_type', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='employment_type' and sa.employment_type=v_emp.employment_type
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 8, 'company', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='company'
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
      ) t
      where t.cnt >= 1
      order by t.ord
    loop
      if v_tier.cnt > 1 then
        v_ambig := true; v_note := format('Multiple applicable salary structures found (%s scope).', v_tier.scope); v_struct := null;
      else
        v_struct := v_tier.ss; v_src := v_src || '+assign_' || v_tier.scope;
      end if;
      exit;   -- first tier with a match decides
    end loop;

    if v_struct is null and not v_ambig then
      select count(*), (array_agg(sl.salary_structure_id))[1] into v_cnt, v_struct
      from public.salary_slab_rules sl join public.salary_structures s on s.id = sl.salary_structure_id and s.status = 'active'
      where sl.company_id = v_emp.company_id and sl.is_active
        and v_gross >= sl.min_gross and (sl.max_gross is null or v_gross <= sl.max_gross);
      if v_cnt > 1 then v_ambig := true; v_note := 'Multiple applicable salary slabs found.'; v_struct := null;
      elsif v_cnt = 1 then v_src := v_src || '+slab'; end if;
    end if;
  end if;

  gross_salary := v_gross;
  salary_structure_id := v_struct;
  structure_name := (select name from public.salary_structures where id = v_struct);
  source := nullif(v_src, '');
  ambiguous := v_ambig;
  resolve_note := nullif(v_note, '');
  return next;
end;
$function$;

revoke execute on function public.salary_resolve_core(uuid, date, numeric, uuid) from public, anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.salary_assign_employee(p_employee_id uuid, p_gross_salary numeric, p_effective_from date, p_salary_structure_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_remark text DEFAULT NULL::text)
 RETURNS employee_salary_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_company uuid;
  v_prev uuid;
  v_prev_any record;
  v_prev_struct uuid;
  v_next_from date;
  v_bound date;
  v_closed text;
  v_remark text := p_remark;
  v_res record;
  v_resolved uuid;
  v_row public.employee_salary_assignments;
begin
  select company_id into v_company from public.employees where id = p_employee_id;
  if v_company is null then raise exception 'Employee not found.'; end if;
  if not public.payroll_can_manage(v_company) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  -- Salary is now maintained from the Employee profile: it goes through the SAME dynamic module permission as the other payroll edits.
  -- (has_dynamic_permission fails OPEN when nothing is configured, so nothing changes until a Super Admin restricts payroll / EDIT.)
  if not public.has_dynamic_permission(auth.uid(), 'payroll', 'EDIT') then
    raise exception 'You do not have permission to edit salary.' using errcode = '42501';
  end if;
  if p_gross_salary is null or p_gross_salary <= 0 then raise exception 'Gross salary must be greater than zero.'; end if;
  if p_effective_from is null then raise exception 'Effective From is required.'; end if;
  if p_salary_structure_id is not null and not exists (
    select 1 from public.salary_structures where id = p_salary_structure_id and company_id = v_company and status = 'active'
  ) then
    raise exception 'The chosen salary structure is not an active structure of this company.';
  end if;

  -- this revision applies from p_effective_from until the day before the next revision (if any)
  select min(effective_from) into v_next_from
  from public.employee_salary_assignments
  where employee_id = p_employee_id and effective_from > p_effective_from;
  v_bound := case when v_next_from is not null then v_next_from - 1 else 'infinity'::date end;

  -- Closed payroll protection: any Finalized / Locked period inside [effective_from, bound] would be changed by this revision.
  select string_agg(to_char(pp.period_month, 'Mon YYYY'), ', ' order by pp.period_month) into v_closed
  from public.payroll_periods pp
  left join public.payroll_runs pr on pr.payroll_period_id = pp.id and pr.is_current
  where pp.company_id = v_company
    and (pp.status in ('finalized', 'locked') or pr.status in ('finalized', 'locked'))
    and pp.period_end_date >= p_effective_from
    and pp.period_start_date <= v_bound;
  if v_closed is not null then
    if not public.is_super_admin() then
      raise exception 'Cannot save: payroll for % is already finalized/locked and this salary would change it. Only a Super Admin can record a back-dated revision into a closed period.', v_closed
        using errcode = '55000';
    end if;
    if length(btrim(coalesce(p_reason, ''))) < 5 then
      raise exception 'A reason (at least 5 characters) is mandatory for a revision back-dated into closed payroll (%).', v_closed
        using errcode = '22023';
    end if;
    v_remark := btrim(coalesce(p_remark, '') || ' [Back-dated into closed payroll: ' || v_closed || '; recorded by Super Admin. Payroll results already finalized are NOT changed.]');
  end if;

  -- The structure the system will use for this Gross on the Effective From date (slab / scope rules — same resolver as payroll).
  select r.salary_structure_id, r.ambiguous, r.resolve_note into v_res
  from public.salary_resolve_core(p_employee_id, p_effective_from, p_gross_salary) r;
  v_resolved := coalesce(p_salary_structure_id, v_res.salary_structure_id);
  if p_salary_structure_id is null then
    if coalesce(v_res.ambiguous, false) then
      raise exception 'Cannot save: %', coalesce(v_res.resolve_note, 'more than one salary structure/slab matches this Gross.');
    end if;
    if v_resolved is null then
      raise exception 'Cannot save: no active salary slab covers a Gross of %. Add or correct a salary slab first.', p_gross_salary;
    end if;
  end if;
  -- Refuse a Gross the structure cannot balance (e.g. a negative Balance component) instead of failing later in payroll.
  begin
    perform 1 from public.salary_bifurcate(v_resolved, p_gross_salary);
  exception when others then
    raise exception 'Cannot save: the salary structure cannot split a Gross of % — %', p_gross_salary, sqlerrm;
  end;

  -- previous revision (for the history record) = latest revision starting before this one
  select a.id, a.gross_salary, a.effective_from, coalesce(a.resolved_structure_id, a.salary_structure_id) as struct_id
    into v_prev_any
  from public.employee_salary_assignments a
  where a.employee_id = p_employee_id and a.effective_from < p_effective_from
  order by a.effective_from desc limit 1;
  v_prev_struct := v_prev_any.struct_id;
  if v_prev_any.id is not null and v_prev_struct is null then
    select r.salary_structure_id into v_prev_struct
    from public.salary_resolve_core(p_employee_id, v_prev_any.effective_from, v_prev_any.gross_salary) r;
  end if;

  -- close the prior open revision that starts before the new one
  update public.employee_salary_assignments
  set effective_to = p_effective_from - 1
  where employee_id = p_employee_id and effective_to is null and effective_from < p_effective_from
  returning id into v_prev;

  insert into public.employee_salary_assignments
    (company_id, employee_id, salary_structure_id, gross_salary, effective_from, effective_to, previous_assignment_id,
     assigned_by, reason, remark, previous_gross, previous_structure_id, resolved_structure_id)
  values (v_company, p_employee_id, p_salary_structure_id, p_gross_salary, p_effective_from,
          case when v_next_from is not null then v_next_from - 1 else null end, v_prev, auth.uid(), p_reason, v_remark,
          v_prev_any.gross_salary, v_prev_struct, v_resolved)
  returning * into v_row;
  return v_row;
end;
$function$;
