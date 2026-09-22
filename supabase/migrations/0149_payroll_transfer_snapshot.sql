-- ============================================================================
-- Retail HRMS — Phase 2: payroll_calculate_run consumes the effective-dated
--   Employee Transfer assignment (employee_assignment_history) for the
--   store/department/designation SNAPSHOT labels only. No earning/deduction
--   calculation changes — salary/policy resolution was already effective-dated
--   (salary_resolve_for_employee / payroll_resolve_policy_for_employee, as of
--   period end) before this phase and remains untouched. A company that never
--   uses Transfer has no employee_assignment_history rows, so
--   employee_assignment_as_of() returns NULL and every coalesce() below falls
--   straight back to the employee's live columns — byte-for-byte unchanged.
-- ============================================================================
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
  v_ot_min numeric; v_nd_val numeric;
  v_paid_leave numeric; v_lwp_days numeric; v_unassigned int;
  v_calendar int; v_working numeric; v_present numeric; v_paid_days numeric; v_unpaid_days numeric;
  v_gross numeric; v_ded numeric; v_advrec numeric; v_net numeric; v_empc numeric;
  v_qty numeric; v_rate numeric; v_amt numeric;
  v_review boolean; v_notes text; v_hasneg boolean;
  v_res_gross numeric; v_struct_id uuid; v_ambig boolean; v_resolve_note text; v_src text; v_ltype text; v_advrec_extra numeric;
  v_join date; v_leave date; v_exit_pay boolean; v_pol_j jsonb; v_gross_pre numeric;
  v_cal public.store_payroll_calendars; v_cal_wd numeric;
  v_elig_start date; v_elig_end date; v_eligible_days numeric; v_ss_scope text;
  v_manual_comp jsonb;
  v_assign public.employee_assignment_history;
  v_r_gross numeric := 0; v_r_ded numeric := 0; v_r_adv numeric := 0; v_r_net numeric := 0; v_cnt int := 0;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then
    raise exception 'You are not authorised to run payroll for this company.' using errcode = '42501';
  end if;
  if v_run.status not in ('draft', 'processing', 'calculated') then
    raise exception 'Payroll run is % - a finalized/locked/reversed run cannot be recalculated.', v_run.status;
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

    -- Employee Transfer (Phase 2): resolve the assignment EFFECTIVE for this payroll period
    -- (as of period end) from the additive history ledger. No history row for this employee
    -- (never transferred) -> v_assign is all-null -> every coalesce below falls back to the
    -- employee's live columns, so a company that never uses Transfer is byte-for-byte unchanged.
    v_assign := public.employee_assignment_as_of(v_emp.id, v_period.period_end_date);

    -- per-employee scoped Payroll Policy (falls back to the company-wide active policy)
    select * into v_pol from public.payroll_resolve_policy_for_employee(v_run.company_id, v_emp.id, v_period.period_end_date);
    v_exit_pay := v_pol.exit_date_payable;

    -- per-employee manual / imported PF/ESI amounts for THIS period (calc_method = 'manual')
    select coalesce(jsonb_object_agg(upper(pca.component_code),
             jsonb_build_object('employee_amount', pca.employee_amount, 'employer_amount', pca.employer_amount, 'source', pca.source)), '{}'::jsonb)
      into v_manual_comp
    from public.payroll_component_amounts pca
    where pca.payroll_period_id = v_period.id and pca.employee_id = v_emp.id;

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
      coalesce(sum(ar.payable_extra_duty_value), 0)
    into v_present_full, v_half, v_woff, v_holi, v_absent, v_att_leave, v_ot_min, v_nd_val
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

    -- Store Calendar working days (Â§28) - only when the policy asks for it
    v_cal := null; v_cal_wd := null;
    if v_pol.working_days_method = 'store_calendar' then
      v_cal := public.payroll_resolve_store_calendar(v_run.company_id, coalesce(v_assign.store_id, v_emp.store_id), v_period.period_end_date);
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
      (select sd.name from public.store_departments sd where sd.id = coalesce(v_assign.store_department_id, v_emp.store_department_id)),
      (select sg.title from public.store_designations sg where sg.id = coalesce(v_assign.store_designation_id, v_emp.store_designation_id)),
      (select s.name from public.stores s where s.id = coalesce(v_assign.store_id, v_emp.store_id)),
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
      set needs_review = true, review_notes = coalesce(v_resolve_note, 'Ambiguous salary structure - resolve the assignment.'),
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

      -- Overtime is NEVER emitted by the flat component master here — it is a system-calculated
      -- line owned solely by payroll_policy_compute_lines, sourced from the Attendance OT Rule
      -- Engine (payable_overtime_minutes). Night Duty stays as-is when its policy toggle is off.
      for v_comp in
        select * from public.payroll_salary_components
        where company_id = v_run.company_id and is_active and component_type = 'earning' and source = 'night_duty'
          and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
          and not v_pol.nd_earning_enabled
        order by sort_order, code
      loop
        v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate; v_amt := 0;
        if v_rate is null then
          if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
        insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
        values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, 'attendance_input', v_comp.sort_order);
        v_gross := v_gross + v_amt;
      end loop;

      v_gross_pre := v_gross;
      v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                  v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), v_struct_id,
                  v_leave, v_exit_pay, v_manual_comp);
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
    -- Overtime (source='overtime') is EXCLUDED here: it is a system-calculated line owned solely
    -- by payroll_policy_compute_lines, valued from the Attendance OT Rule's payable_overtime_minutes.
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'earning'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        and source <> 'overtime'
        and not (source = 'night_duty' and v_pol.nd_earning_enabled)
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.source = 'basic' then v_amt := round(v_basic, 2);
      elsif v_comp.source = 'da' then v_amt := round(v_da, 2);
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
          if coalesce(v_lwp_days, 0) > 0 then v_review := true; v_notes := v_notes || format('%s LWP day(s) - LWP salary divisor not configured. ', v_lwp_days); end if;
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
                v_leave, v_exit_pay, v_manual_comp);
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
grant execute on function public.payroll_calculate_run(uuid) to authenticated;

