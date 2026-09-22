-- ============================================================================
-- Retail HRMS — Complete the PF / ESIC / Incentive Manual & Excel Import
-- feature already begun in migrations 0143 (statutory PF/ESI manual +
-- import engine) and 0175 (generic 'manual' calculation_type on
-- salary_structure_components, e.g. Incentive).
-- Migration 0176
--
-- INSPECTED FIRST (this migration fixes exactly two gaps found by reading
-- 0143, 0175, payroll_calculate_run, payroll_apply_policy,
-- payroll_policy_compute_lines, and the dynamic permission system in 0161/0169
-- end to end — nothing else is touched):
--
-- GAP 1 — dead wiring. payroll_apply_policy() (0143) accepts a
-- `p_manual_components jsonb` parameter and threads it into
-- payroll_policy_compute_lines() so a PF/ESI/Gratuity/Other statutory rule
-- configured with calc_method = 'manual' can resolve its amount from
-- public.payroll_component_amounts. But payroll_calculate_run() — in BOTH its
-- 0175 "dynamic salary structure" build and its "legacy Basic+DA" build —
-- calls payroll_apply_policy() WITHOUT that argument, so it always defaulted
-- to '{}'::jsonb. Practically: a company that sets PF or ESI's Calculation
-- Method to "Manual / Excel Import" in Payroll Settings (Statutory Rules —
-- this option is real and already shown in PayrollSettingsPage.tsx's
-- STAT_METHOD_UI) got "PF: Manual / Excel amount not entered" on every
-- payslip forever, even after a correct Excel import — because the imported
-- amount was never read. Fix: payroll_calculate_run() now loads this
-- employee's payroll_component_amounts row-set for the period ONCE per
-- employee (one indexed lookup on idx_pca_period_emp, no N+1 join) and passes
-- it through, exactly the way the "Incentive via salary_structure_components"
-- path already worked. NOT a new calculation path — it completes the one
-- 0143 already built and 0175's own header assumed was already wired.
--
-- GAP 2 — the Manual/Excel Import RPCs (payroll_component_amount_set,
-- payroll_component_amounts_bulk_set, payroll_component_import_preview,
-- payroll_component_import_commit) authorise solely via payroll_can_manage()
-- (Super Admin OR active advance_finance_processors row). That is the
-- existing, UNCHANGED gate for every other payroll RPC and stays exactly as
-- it is everywhere else. But the task requires this specific new surface to
-- also go through the app's dynamic module/action permission system (0161 +
-- 0169) so a Super Admin can additionally restrict which dynamic
-- role/user may edit or import these amounts — never as the ONLY gate, never
-- replacing payroll_can_manage. has_dynamic_permission() fails OPEN when
-- nothing is configured (see 0161's own header), so this changes nothing for
-- any existing Finance Processor until a Super Admin explicitly configures a
-- restriction for module 'payroll', action 'EDIT' or 'UPLOAD'. Backend-only
-- (the RPC itself refuses); the frontend also consults the same
-- my_dynamic_permission()-backed hook (useHasPermission) already used by
-- other modules, for UI hiding — never the only line of defence.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. payroll_calculate_run — thread the employee's manual/imported component
--    amounts into BOTH payroll_apply_policy() call sites. Every other line is
--    reproduced VERBATIM from migration 0175 — nothing else changes.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_calculate_run(p_payroll_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
as $function$
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
                  v_leave, v_exit_pay, v_manual_components);
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
                v_leave, v_exit_pay, v_manual_components);
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

-- ----------------------------------------------------------------------------
-- B. Dynamic-permission gate ADDED on top of payroll_can_manage() (never
--    replacing it) for the four Manual/Excel-import RPCs. Module 'payroll'
--    already exists (0161 seed); actions 'EDIT' and 'UPLOAD' already exist
--    (0161 seed). Fails open (has_dynamic_permission defaults to true) until
--    a Super Admin explicitly restricts it for a dynamic role/user — zero
--    behaviour change for any current Finance Processor.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_component_amount_set(
  p_period_id uuid,
  p_employee_id uuid,
  p_component_code text,
  p_employee_amount numeric default null,
  p_employer_amount numeric default null,
  p_note text default null
)
returns public.payroll_component_amounts
language plpgsql
security definer
as $fn$
declare
  v_company uuid; v_pstatus text; v_emp_company uuid; v_code text := upper(btrim(p_component_code)); v_row public.payroll_component_amounts;
begin
  select company_id, status into v_company, v_pstatus from public.payroll_periods where id = p_period_id;
  if v_company is null then raise exception 'Payroll period not found.'; end if;
  if not public.payroll_can_manage(v_company) then
    raise exception 'You are not authorised to manage payroll for this company.' using errcode = '42501';
  end if;
  if not public.has_dynamic_permission(auth.uid(), 'payroll', 'EDIT') then
    raise exception 'You do not have permission to edit payroll component amounts.' using errcode = '42501';
  end if;

  if v_code = 'OT' then
    raise exception 'Overtime cannot use a manual or imported amount. OT comes only from Attendance -> Overtime / OT Rules.'
      using errcode = '22023';
  end if;
  if not public.payroll_component_import_eligible(v_company, v_code) then
    raise exception '% is not a component that supports a manual / imported amount.', v_code using errcode = '22023';
  end if;

  select company_id into v_emp_company from public.employees where id = p_employee_id;
  if v_emp_company is null then raise exception 'Employee not found.'; end if;
  if v_emp_company <> v_company then
    raise exception 'Employee % does not belong to this company (cross-company blocked).', p_employee_id using errcode = '42501';
  end if;
  if p_employee_amount is null and p_employer_amount is null then
    raise exception 'Nothing to store — supply an employee and/or employer amount (or delete the row).';
  end if;
  if p_employee_amount is not null and p_employee_amount < 0 then raise exception 'Employee amount cannot be negative.'; end if;
  if p_employer_amount is not null and p_employer_amount < 0 then raise exception 'Employer amount cannot be negative.'; end if;
  -- period-editable is enforced by trg_pca_guard as well.
  if v_pstatus in ('finalized', 'locked', 'reversed') then
    raise exception 'Payroll period is % — PF/ESI manual amounts are immutable.', v_pstatus using errcode = '55000';
  end if;

  insert into public.payroll_component_amounts (company_id, payroll_period_id, employee_id, component_code,
    employee_amount, employer_amount, source, note, created_by, updated_by)
  values (v_company, p_period_id, p_employee_id, v_code, p_employee_amount, p_employer_amount, 'manual', p_note, auth.uid(), auth.uid())
  on conflict (payroll_period_id, employee_id, component_code) do update
    set employee_amount = excluded.employee_amount,
        employer_amount = excluded.employer_amount,
        source = 'manual',
        import_batch_id = null,
        note = excluded.note,
        updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end;
$fn$;
grant execute on function public.payroll_component_amount_set(uuid, uuid, text, numeric, numeric, text) to authenticated;

create or replace function public.payroll_component_amounts_bulk_set(p_period_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
as $fn$
declare r jsonb; v_n int := 0; v_del int := 0; v_ea numeric; v_er numeric; v_company uuid;
begin
  select company_id into v_company from public.payroll_periods where id = p_period_id;
  if v_company is null then raise exception 'Payroll period not found.'; end if;
  if not public.payroll_can_manage(v_company) then
    raise exception 'You are not authorised to manage payroll for this company.' using errcode = '42501';
  end if;
  if not public.has_dynamic_permission(auth.uid(), 'payroll', 'EDIT') then
    raise exception 'You do not have permission to edit payroll component amounts.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_ea := nullif(r ->> 'employee_amount', '')::numeric;
    v_er := nullif(r ->> 'employer_amount', '')::numeric;
    if v_ea is null and v_er is null then
      -- explicit clear
      delete from public.payroll_component_amounts
      where payroll_period_id = p_period_id
        and employee_id = (r ->> 'employee_id')::uuid
        and component_code = upper(btrim(r ->> 'component_code'));
      v_del := v_del + 1;
    else
      perform public.payroll_component_amount_set(p_period_id, (r ->> 'employee_id')::uuid, r ->> 'component_code',
        v_ea, v_er, r ->> 'note');
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('saved', v_n, 'cleared', v_del);
end;
$fn$;
grant execute on function public.payroll_component_amounts_bulk_set(uuid, jsonb) to authenticated;

create or replace function public.payroll_component_import_preview(
  p_company_id uuid,
  p_period_id uuid,
  p_component_codes text[],
  p_rows jsonb
)
returns jsonb
language plpgsql
stable
security definer
as $fn$
declare
  v_pcompany uuid; v_pstatus text;
  v_codes text[];
  r jsonb; v_rn int; v_staff text; v_name text;
  v_emp_id uuid; v_emp_name text; v_emp_code text;
  v_out jsonb := '[]'::jsonb; v_row jsonb; v_amts jsonb; v_msgs text[]; v_state text;
  c text; v_raw text; v_val numeric; v_supplied boolean; v_comp_out jsonb;
  v_total int := 0; v_valid int := 0; v_warn int := 0; v_err int := 0;
  v_ea_total numeric := 0; v_er_total numeric := 0;
  v_seen text[] := '{}';
begin
  select company_id, status into v_pcompany, v_pstatus from public.payroll_periods where id = p_period_id;
  if v_pcompany is null then raise exception 'Payroll period not found.'; end if;
  if v_pcompany <> p_company_id then raise exception 'Period does not belong to this company.' using errcode = '42501'; end if;
  if not public.payroll_can_manage(p_company_id) then
    raise exception 'You are not authorised to import payroll amounts for this company.' using errcode = '42501';
  end if;
  if not public.has_dynamic_permission(auth.uid(), 'payroll', 'UPLOAD') then
    raise exception 'You do not have permission to import payroll component amounts.' using errcode = '42501';
  end if;

  -- normalise + validate the requested component scope (OT can never appear here)
  select array_agg(distinct upper(btrim(x))) into v_codes from unnest(coalesce(p_component_codes, array['PF','ESI'])) x;
  if v_codes is null or array_length(v_codes, 1) is null then v_codes := array['PF','ESI']; end if;
  if 'OT' = any(v_codes) then
    raise exception 'Overtime cannot be imported. OT comes only from Attendance -> Overtime / OT Rules.' using errcode = '22023';
  end if;
  foreach c in array v_codes loop
    if not public.payroll_component_import_eligible(p_company_id, c) then
      raise exception '% is not importable as a manual amount.', c using errcode = '22023';
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_total := v_total + 1;
    v_rn := coalesce((r ->> 'row_number')::int, v_total);
    v_staff := btrim(coalesce(r ->> 'staff_id', ''));
    v_name := btrim(coalesce(r ->> 'staff_name', ''));
    v_amts := coalesce(r -> 'amounts', '{}'::jsonb);
    v_msgs := '{}'; v_state := 'valid'; v_emp_id := null; v_emp_name := null; v_emp_code := null;

    if v_staff = '' then
      v_msgs := array_append(v_msgs, 'Staff ID is blank.'); v_state := 'error';
    else
      select e.id, e.full_name, e.employee_code into v_emp_id, v_emp_name, v_emp_code
      from public.employees e
      where e.company_id = p_company_id and upper(btrim(e.employee_code)) = upper(v_staff);

      if v_emp_id is null then
        v_msgs := array_append(v_msgs, format('No employee with Staff ID "%s" in this company.', v_staff));
        v_state := 'error';
      else
        if v_staff = any(v_seen) then
          v_msgs := array_append(v_msgs, format('Duplicate Staff ID "%s" in the file.', v_staff));
          v_state := 'error';
        end if;
        v_seen := array_append(v_seen, v_staff);
        if v_name <> '' and lower(v_name) <> lower(coalesce(v_emp_name, '')) then
          v_msgs := array_append(v_msgs, format('Name "%s" does not match "%s" (Staff ID wins).', v_name, v_emp_name));
          if v_state = 'valid' then v_state := 'warning'; end if;
        end if;
      end if;
    end if;

    -- per requested component: parse the amount (blank vs 0 vs number)
    v_comp_out := '{}'::jsonb;
    foreach c in array v_codes loop
      v_raw := v_amts ->> c;
      v_supplied := false; v_val := null;
      begin
        v_val := public._pca_parse_amount(v_raw);
        v_supplied := v_val is not null;
        if v_supplied and v_state <> 'error' and v_emp_id is not null then
          v_ea_total := v_ea_total + v_val;
        end if;
      exception when others then
        v_msgs := array_append(v_msgs, format('%s amount "%s" is not a valid number.', c, v_raw));
        v_state := 'error';
      end;
      v_comp_out := v_comp_out || jsonb_build_object(c, jsonb_build_object(
        'raw', v_raw,
        'value', v_val,
        'supplied', v_supplied,
        'zero', (v_supplied and v_val = 0)
      ));
    end loop;

    if v_state = 'error' then v_err := v_err + 1;
    elsif v_state = 'warning' then v_warn := v_warn + 1; v_valid := v_valid + 1;
    else v_valid := v_valid + 1;
    end if;

    v_row := jsonb_build_object(
      'row_number', v_rn,
      'staff_id', v_staff,
      'staff_name', v_name,
      'employee_id', v_emp_id,
      'matched_name', v_emp_name,
      'matched_code', v_emp_code,
      'state', v_state,
      'messages', to_jsonb(v_msgs),
      'components', v_comp_out
    );
    v_out := v_out || v_row;
  end loop;

  return jsonb_build_object(
    'period', jsonb_build_object('id', p_period_id, 'status', v_pstatus,
                                'editable', v_pstatus not in ('finalized', 'locked', 'reversed')),
    'component_codes', to_jsonb(v_codes),
    'summary', jsonb_build_object(
      'total_rows', v_total, 'valid', v_valid, 'warnings', v_warn, 'errors', v_err,
      'employee_amount_total', v_ea_total, 'employer_amount_total', v_er_total
    ),
    'rows', v_out
  );
end;
$fn$;
grant execute on function public.payroll_component_import_preview(uuid, uuid, text[], jsonb) to authenticated;

create or replace function public.payroll_component_import_commit(
  p_company_id uuid,
  p_period_id uuid,
  p_component_codes text[],
  p_rows jsonb,
  p_file_name text default null
)
returns jsonb
language plpgsql
security definer
as $fn$
declare
  v_prev jsonb; v_codes text[]; v_pstatus text; v_pcompany uuid;
  r jsonb; c text; v_batch uuid; v_emp uuid; v_val numeric;
  v_imported int := 0; v_updated int := 0; v_skipped int := 0;
  v_ea_total numeric := 0; v_er_total numeric := 0; v_existed boolean;
begin
  select company_id, status into v_pcompany, v_pstatus from public.payroll_periods where id = p_period_id;
  if v_pcompany is null then raise exception 'Payroll period not found.'; end if;
  if v_pcompany <> p_company_id then raise exception 'Period does not belong to this company.' using errcode = '42501'; end if;
  if not public.payroll_can_manage(p_company_id) then
    raise exception 'You are not authorised to import payroll amounts for this company.' using errcode = '42501';
  end if;
  if not public.has_dynamic_permission(auth.uid(), 'payroll', 'UPLOAD') then
    raise exception 'You do not have permission to import payroll component amounts.' using errcode = '42501';
  end if;
  if v_pstatus in ('finalized', 'locked', 'reversed') then
    raise exception 'Payroll period is % — PF/ESI amounts are immutable. Use the payroll reversal/correction process.', v_pstatus
      using errcode = '55000';
  end if;

  v_prev := public.payroll_component_import_preview(p_company_id, p_period_id, p_component_codes, p_rows);
  if (v_prev -> 'summary' ->> 'errors')::int > 0 then
    raise exception 'Import has % row error(s) — fix the file and preview again. Nothing was imported.',
      (v_prev -> 'summary' ->> 'errors')::int using errcode = '22023';
  end if;
  select array_agg(value::text) into v_codes from jsonb_array_elements_text(v_prev -> 'component_codes');

  insert into public.payroll_component_import_batches (company_id, payroll_period_id, component_codes, file_name, created_by)
  values (p_company_id, p_period_id, v_codes, p_file_name, auth.uid())
  returning id into v_batch;

  for r in select * from jsonb_array_elements(v_prev -> 'rows') loop
    v_emp := nullif(r ->> 'employee_id', '')::uuid;
    if v_emp is null then continue; end if;
    foreach c in array v_codes loop
      if coalesce((r -> 'components' -> c ->> 'supplied')::boolean, false) then
        v_val := (r -> 'components' -> c ->> 'value')::numeric;
        select exists (select 1 from public.payroll_component_amounts
                       where payroll_period_id = p_period_id and employee_id = v_emp and component_code = c) into v_existed;
        insert into public.payroll_component_amounts (company_id, payroll_period_id, employee_id, component_code,
          employee_amount, employer_amount, source, import_batch_id, note, created_by, updated_by)
        values (p_company_id, p_period_id, v_emp, c, v_val, null, 'excel_import', v_batch,
          nullif(p_file_name, ''), auth.uid(), auth.uid())
        on conflict (payroll_period_id, employee_id, component_code) do update
          set employee_amount = excluded.employee_amount,
              source = 'excel_import',
              import_batch_id = v_batch,
              note = excluded.note,
              updated_by = auth.uid();
        if v_existed then v_updated := v_updated + 1; else v_imported := v_imported + 1; end if;
        v_ea_total := v_ea_total + coalesce(v_val, 0);
      else
        v_skipped := v_skipped + 1;   -- blank: left untouched, NOT zeroed
      end if;
    end loop;
  end loop;

  update public.payroll_component_import_batches
  set row_count = jsonb_array_length(v_prev -> 'rows'),
      employee_amount_total = v_ea_total,
      employer_amount_total = v_er_total
  where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch,
    'imported', v_imported,
    'updated', v_updated,
    'skipped_blank', v_skipped,
    'employee_amount_total', v_ea_total,
    'component_codes', to_jsonb(v_codes),
    'note', 'PF/ESI amounts stored for this period. Re-run Payroll Calculate to fold them into the payslips.'
  );
end;
$fn$;
grant execute on function public.payroll_component_import_commit(uuid, uuid, text[], jsonb, text) to authenticated;
