-- ============================================================================
-- Retail HRMS — F&F — Phase 1 : RPCs (create / adjust / calculate / submit /
--   approve / reject / send-back / pay / reverse / read / register).
--
-- F&F reuses the EXISTING engines only:
--   * payroll_policy_compute_lines  — exit-month proration (PRORATE_EXIT),
--       joining-month proration, OT from Attendance payable minutes, Night Duty,
--       LWP, PF / ESI / PT / TDS (incl. calc_method = manual/fixed/%/formula).
--   * payroll_policy_finalize       — deduction priority, deduction cap
--       (Advance Recovery protected), negative-net policy, net.
--   * advance_recovery_run_period_full / advance_recovery_run_period
--       + advance_recovery_reverse_period — the Advance Recovery engine.
--   * leave_encashment_compute      — the configurable leave_encashment_rules.
--   * exit_notice_compute           — the configurable exit_notice_policies.
--   * salary_resolve_for_employee / salary_bifurcate / payroll_resolve_policy_for_employee.
--
-- Months already run through FINALIZED / LOCKED payroll are CONSUMED from the
-- immutable payroll snapshot, never recomputed. F&F computes only unpaid months
-- (normally just the exit month).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- fnf_create — open a draft settlement for an exiting employee.
-- ----------------------------------------------------------------------------
create or replace function public.fnf_create(
  p_company_id uuid,
  p_employee_id uuid,
  p_exit_type text,
  p_leaving_date date,
  p_notice_served_days numeric default 0,
  p_notice_waived boolean default false,
  p_encashable_leave_days numeric default 0,
  p_leave_policy_id uuid default null
)
returns public.fnf_settlements
language plpgsql
security definer
as $fn$
declare v_emp record; v_row public.fnf_settlements; v_notice public.exit_notice_policies; v_lp uuid;
begin
  if not public.payroll_can_manage(p_company_id) then
    raise exception 'You are not authorised to manage F&F for this company.' using errcode = '42501';
  end if;
  select id, company_id, joining_date, full_name, employee_code, status into v_emp
  from public.employees where id = p_employee_id for update;
  if v_emp.id is null then raise exception 'Employee not found.'; end if;
  if v_emp.company_id <> p_company_id then raise exception 'Employee does not belong to this company.' using errcode = '42501'; end if;
  if p_leaving_date is null then raise exception 'A leaving date is required.'; end if;
  if v_emp.joining_date is not null and p_leaving_date < v_emp.joining_date then
    raise exception 'Leaving date % is before the joining date %.', p_leaving_date, v_emp.joining_date;
  end if;
  if coalesce(btrim(p_exit_type), '') = '' then raise exception 'Exit type is required.'; end if;

  if exists (select 1 from public.fnf_settlements
             where employee_id = p_employee_id and status not in ('rejected', 'reversed')) then
    raise exception 'An active F&F settlement already exists for this employee.' using errcode = '23505';
  end if;

  v_notice := public.exit_notice_resolve(p_company_id, p_leaving_date);
  v_lp := coalesce(p_leave_policy_id, public.leave_resolve_policy_assignment(p_company_id, p_employee_id, p_leaving_date));

  insert into public.fnf_settlements (
    company_id, employee_id, exit_type, leaving_date, status,
    notice_required_days, notice_served_days, notice_shortfall_days, notice_waived,
    leave_policy_id, encashable_leave_days, created_by, updated_by
  ) values (
    p_company_id, p_employee_id, btrim(p_exit_type), p_leaving_date, 'draft',
    coalesce(v_notice.notice_days, 0), coalesce(p_notice_served_days, 0),
    case when p_notice_waived then 0 else greatest(coalesce(v_notice.notice_days, 0) - coalesce(p_notice_served_days, 0), 0) end,
    coalesce(p_notice_waived, false),
    v_lp, coalesce(p_encashable_leave_days, 0), auth.uid(), auth.uid()
  ) returning * into v_row;

  -- reflect the exit on the employee master (canonical payroll field), without a status change yet
  update public.employees
  set leaving_date = coalesce(leaving_date, p_leaving_date),
      exit_status = coalesce(exit_status,
        case lower(btrim(p_exit_type))
          when 'resignation' then 'resigned' when 'resigned' then 'resigned'
          when 'termination' then 'terminated' when 'terminated' then 'terminated'
          when 'retirement' then 'retired' when 'retired' then 'retired'
          when 'absconded' then 'absconded'
          when 'contract end' then 'contract_end' when 'contract_end' then 'contract_end'
          else 'other' end),
      updated_by = auth.uid()
  where id = p_employee_id;

  insert into public.fnf_events (fnf_settlement_id, company_id, event, to_status, actor, meta)
  values (v_row.id, p_company_id, 'created', 'draft', auth.uid(),
          jsonb_build_object('exit_type', p_exit_type, 'leaving_date', p_leaving_date));
  return v_row;
end;
$fn$;
grant execute on function public.fnf_create(uuid, uuid, text, date, numeric, boolean, numeric, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_add_adjustment — an authorised, audited manual F&F line (reason required).
-- ----------------------------------------------------------------------------
create or replace function public.fnf_add_adjustment(
  p_fnf_id uuid, p_line_type text, p_code text, p_name text, p_amount numeric, p_reason text
)
returns public.fnf_adjustments
language plpgsql
security definer
as $fn$
declare s public.fnf_settlements; v_row public.fnf_adjustments;
begin
  select * into s from public.fnf_settlements where id = p_fnf_id for update;
  if s.id is null then raise exception 'F&F settlement not found.'; end if;
  if not public.payroll_can_manage(s.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if s.status not in ('draft', 'under_review', 'calculated', 'sent_back') then
    raise exception 'Adjustments cannot be added when the F&F is %.', s.status;
  end if;
  if p_line_type not in ('earning', 'deduction') then raise exception 'line_type must be earning or deduction.'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Adjustment amount cannot be negative.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required for a manual F&F adjustment.'; end if;
  if upper(btrim(p_code)) = 'OT' then
    raise exception 'Overtime cannot be added as an F&F adjustment — OT comes only from Attendance OT Rules.' using errcode = '22023';
  end if;

  insert into public.fnf_adjustments (fnf_settlement_id, company_id, line_type, code, name, amount, reason, created_by)
  values (p_fnf_id, s.company_id, p_line_type, upper(btrim(p_code)), btrim(p_name), coalesce(p_amount, 0), btrim(p_reason), auth.uid())
  returning * into v_row;

  insert into public.fnf_events (fnf_settlement_id, company_id, event, from_status, to_status, actor, reason, meta)
  values (p_fnf_id, s.company_id, 'adjustment_added', s.status, s.status, auth.uid(), btrim(p_reason),
          jsonb_build_object('line_type', p_line_type, 'code', upper(btrim(p_code)), 'amount', p_amount));
  return v_row;
end;
$fn$;
grant execute on function public.fnf_add_adjustment(uuid, text, text, text, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_calculate — the settlement calculation. Idempotent (re-runnable while the
-- F&F is still editable). Previews advance recovery; the real recovery runs at
-- approval.
-- ----------------------------------------------------------------------------
create or replace function public.fnf_calculate(p_fnf_id uuid)
returns jsonb
language plpgsql
security definer
as $fn$
declare
  s public.fnf_settlements;
  v_emp record;
  v_exit_month date; v_first_month date; v_m date; v_pe date; v_cut date;
  v_pol public.payroll_policies;
  v_res record; v_struct uuid; v_gross_res numeric; v_ambig boolean; v_note_res text;
  v_basic numeric := 0; v_da numeric := 0;
  v_bif record; l record;
  v_calendar int; v_working numeric;
  v_present numeric; v_half numeric; v_woff numeric; v_holi numeric; v_absent numeric; v_att_leave numeric;
  v_ot_min numeric; v_nd_val numeric; v_paid_leave numeric; v_lwp numeric;
  v_month_gross numeric; v_join_in_month date;
  v_manual jsonb; v_comp_amounts jsonb;
  v_period_id uuid;
  v_lines jsonb := '{}'::jsonb;        -- code -> {line_type,name,amount,quantity,rate,source,calc_type,calc_note,protected}
  v_key text; v_prev jsonb;
  v_months_computed jsonb := '[]'::jsonb;
  v_months_consumed jsonb := '[]'::jsonb;
  v_review boolean := false; v_notes text := '';
  v_lookback int := 3; v_looped int := 0;
  -- encashment / notice / advance
  v_enc record; v_notice record; v_notice_shortfall numeric;
  v_adv_outstanding numeric := 0; v_adv_recoverable numeric := 0;
  v_settings public.fnf_settings;
  -- finalize
  v_deds jsonb := '[]'::jsonb; v_gross numeric := 0; v_ded_total numeric := 0; v_empc numeric := 0; v_fin jsonb; o jsonb;
  v_net numeric;
begin
  select * into s from public.fnf_settlements where id = p_fnf_id for update;
  if s.id is null then raise exception 'F&F settlement not found.'; end if;
  if not public.payroll_can_manage(s.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if s.status not in ('draft', 'under_review', 'calculated', 'sent_back') then
    raise exception 'F&F cannot be recalculated when it is %.', s.status;
  end if;

  select id, company_id, joining_date, employee_code, full_name, store_id, store_department_id, store_designation_id
    into v_emp from public.employees where id = s.employee_id;

  select * into v_settings from public.fnf_settings where company_id = s.company_id;

  v_exit_month := date_trunc('month', s.leaving_date)::date;
  v_first_month := greatest(date_trunc('month', coalesce(v_emp.joining_date, s.leaving_date))::date,
                            (v_exit_month - (v_lookback || ' months')::interval)::date);

  v_m := v_first_month;
  while v_m <= v_exit_month loop
    v_looped := v_looped + 1;
    v_pe := (date_trunc('month', v_m) + interval '1 month - 1 day')::date;
    v_cut := least(v_pe, s.leaving_date);

    -- a month already settled by FINALIZED / LOCKED payroll is consumed, not recomputed
    if exists (
      select 1 from public.payroll_employee_results er
      join public.payroll_periods pp on pp.id = er.payroll_period_id
      where er.employee_id = s.employee_id and pp.company_id = s.company_id
        and pp.period_month = v_m and pp.status in ('finalized', 'locked')
    ) then
      select v_months_consumed || jsonb_build_object('month', v_m,
        'net', (select er.net_salary from public.payroll_employee_results er
                join public.payroll_periods pp on pp.id = er.payroll_period_id
                where er.employee_id = s.employee_id and pp.period_month = v_m and pp.status in ('finalized','locked')
                order by er.created_at desc limit 1))
      into v_months_consumed;
      v_m := (date_trunc('month', v_m) + interval '1 month')::date;
      continue;
    end if;

    -- ---- resolve context for this month ----
    v_pol := public.payroll_resolve_policy_for_employee(s.company_id, s.employee_id, v_pe);
    select r.gross_salary, r.salary_structure_id, r.ambiguous, r.resolve_note
      into v_gross_res, v_struct, v_ambig, v_note_res
    from public.salary_resolve_for_employee(s.employee_id, v_cut) r;
    if v_ambig then
      v_review := true; v_notes := v_notes || coalesce(v_note_res, 'Ambiguous salary structure. ') || ' ';
      v_m := (date_trunc('month', v_m) + interval '1 month')::date; continue;
    end if;

    v_calendar := (v_pe - v_m + 1);
    select
      coalesce(count(*) filter (where ar.status in ('present','work_from_home','on_duty')), 0),
      coalesce(count(*) filter (where ar.status = 'half_day'), 0) * 0.5,
      coalesce(count(*) filter (where ar.status = 'weekly_off'), 0),
      coalesce(count(*) filter (where ar.status = 'holiday'), 0),
      coalesce(count(*) filter (where ar.status = 'absent'), 0),
      coalesce(count(*) filter (where ar.status = 'leave'), 0),
      coalesce(sum(ar.payable_overtime_minutes), 0),
      coalesce(sum(ar.payable_extra_duty_value), 0)
    into v_present, v_half, v_woff, v_holi, v_absent, v_att_leave, v_ot_min, v_nd_val
    from public.attendance_records ar
    where ar.employee_id = s.employee_id and ar.attendance_date between v_m and v_cut;

    select
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'paid'), 0),
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'unpaid'), 0)
    into v_paid_leave, v_lwp
    from public.leave_attendance_effects lae
    where lae.employee_id = s.employee_id and lae.attendance_date between v_m and v_cut and lae.reversed_at is null;

    v_working := greatest(v_calendar - coalesce(v_woff, 0) - coalesce(v_holi, 0), 0);
    if v_pol.working_days_method = 'store_calendar' then
      declare v_cal public.store_payroll_calendars; v_wd numeric;
      begin
        v_cal := public.payroll_resolve_store_calendar(s.company_id, v_emp.store_id, v_pe);
        if v_cal.id is not null then
          v_wd := public.payroll_calendar_working_days(v_cal.id, v_m, v_pe);
          if v_wd is not null then v_working := v_wd; end if;
        end if;
      end;
    end if;

    -- ---- gross for the month (dynamic structure or legacy Basic+DA) ----
    v_month_gross := 0; v_basic := 0; v_da := 0;
    if v_struct is not null then
      for v_bif in select * from public.salary_bifurcate(v_struct, coalesce(v_gross_res, 0)) loop
        if v_bif.category = 'earning' then
          v_key := 'E:' || v_bif.code;
          v_prev := v_lines -> v_key;
          v_lines := v_lines || jsonb_build_object(v_key, jsonb_build_object(
            'line_type','earning','code',v_bif.code,'name',v_bif.name,
            'amount', coalesce((v_prev->>'amount')::numeric,0) + v_bif.amount,
            'source', v_bif.category, 'calc_type', v_bif.calculation_type, 'calc_base', v_bif.calc_base,
            'calc_note', trim(both ' |' from coalesce(v_prev->>'calc_note','') || ' | ' || to_char(v_m,'Mon YYYY')),
            'protected', false));
          v_month_gross := v_month_gross + v_bif.amount;
          if v_bif.is_basic then v_basic := v_bif.amount; end if;
          if v_bif.code = 'DA' then v_da := v_bif.amount; end if;
        elsif v_bif.category = 'employer_contribution' then
          v_key := 'C:' || v_bif.code;
          v_prev := v_lines -> v_key;
          v_lines := v_lines || jsonb_build_object(v_key, jsonb_build_object(
            'line_type','employer_contribution','code',v_bif.code,'name',v_bif.name,
            'amount', coalesce((v_prev->>'amount')::numeric,0) + v_bif.amount, 'calc_note','', 'protected', false));
        elsif v_bif.calculation_type <> 'advance_recovery' then
          v_key := 'D:' || v_bif.code;
          v_prev := v_lines -> v_key;
          v_lines := v_lines || jsonb_build_object(v_key, jsonb_build_object(
            'line_type','deduction','code',v_bif.code,'name',v_bif.name,
            'amount', coalesce((v_prev->>'amount')::numeric,0) + v_bif.amount,
            'calc_type', v_bif.calculation_type, 'calc_note','', 'protected', false));
        end if;
      end loop;
    else
      select sc.basic_salary, sc.da into v_basic, v_da
      from public.employee_salary_components sc
      where sc.employee_id = s.employee_id and sc.effective_from <= v_cut
        and (sc.effective_to is null or sc.effective_to >= v_m)
      order by sc.effective_from desc limit 1;
      v_basic := coalesce(v_basic, 0); v_da := coalesce(v_da, 0);
      v_month_gross := v_basic + v_da;
      v_key := 'E:BASIC'; v_prev := v_lines -> v_key;
      v_lines := v_lines || jsonb_build_object(v_key, jsonb_build_object('line_type','earning','code','BASIC','name','Basic',
        'amount', coalesce((v_prev->>'amount')::numeric,0) + v_basic, 'calc_note', to_char(v_m,'Mon YYYY'), 'protected', false));
      if v_da <> 0 then
        v_key := 'E:DA'; v_prev := v_lines -> v_key;
        v_lines := v_lines || jsonb_build_object(v_key, jsonb_build_object('line_type','earning','code','DA','name','DA',
          'amount', coalesce((v_prev->>'amount')::numeric,0) + v_da, 'calc_note', to_char(v_m,'Mon YYYY'), 'protected', false));
      end if;
    end if;

    -- manual PF/ESI + component amounts for this month (if a payroll period row exists)
    select coalesce(jsonb_object_agg(upper(pca.component_code),
             jsonb_build_object('employee_amount', pca.employee_amount, 'employer_amount', pca.employer_amount, 'source', pca.source)), '{}'::jsonb)
      into v_manual
    from public.payroll_component_amounts pca
    join public.payroll_periods pp on pp.id = pca.payroll_period_id
    where pp.company_id = s.company_id and pp.period_month = v_m and pca.employee_id = s.employee_id;

    select coalesce(jsonb_object_agg(x ->> 'code', (x ->> 'amount')::numeric), '{}'::jsonb) into v_comp_amounts
    from jsonb_array_elements(
      (select coalesce(jsonb_agg(jsonb_build_object('code', e.value->>'code', 'amount', e.value->>'amount')), '[]'::jsonb)
       from jsonb_each(v_lines) e where e.value->>'line_type' = 'earning')
    ) x;

    v_join_in_month := case when v_emp.joining_date is not null and date_trunc('month', v_emp.joining_date)::date = v_m
                            then v_emp.joining_date else null end;

    -- ---- policy-driven lines: PRORATE_EXIT, PRORATE (join), OT (attendance), ND, LWP, PF/ESI/PT/TDS ----
    for l in select * from public.payroll_policy_compute_lines(
               v_pol.id, v_m, v_pe, v_working, v_join_in_month, v_basic, v_da, v_month_gross,
               coalesce(v_lwp, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0),
               v_struct, (select coalesce(array_agg(e.value->>'code'), '{}') from jsonb_each(v_lines) e),
               s.leaving_date, coalesce(v_pol.exit_date_payable, true), null::jsonb, v_manual, v_comp_amounts)
    loop
      v_key := case l.line_type when 'earning' then 'E:' when 'employer_contribution' then 'C:' else 'D:' end || l.code;
      v_prev := v_lines -> v_key;
      v_lines := v_lines || jsonb_build_object(v_key, jsonb_build_object(
        'line_type', l.line_type, 'code', l.code, 'name', l.name,
        'amount', coalesce((v_prev->>'amount')::numeric, 0) + coalesce(l.amount, 0),
        'quantity', l.quantity, 'rate', l.rate, 'source', 'payroll_policy',
        'calc_type', l.calc_type, 'calc_base', l.calc_base,
        'calc_note', trim(both ' |' from coalesce(v_prev->>'calc_note','') || ' | ' || to_char(v_m,'Mon YYYY') || ': ' || coalesce(l.calc_note,'')),
        'protected', false));
      if l.unresolved then v_review := true; v_notes := v_notes || to_char(v_m,'Mon YYYY') || ': ' || coalesce(l.calc_note,'') || ' '; end if;
    end loop;

    v_months_computed := v_months_computed || jsonb_build_object('month', v_m, 'gross', v_month_gross, 'working_days', v_working,
      'ot_minutes', v_ot_min, 'nd_value', v_nd_val, 'lwp_days', v_lwp, 'paid_leave_days', v_paid_leave);
    v_m := (date_trunc('month', v_m) + interval '1 month')::date;
  end loop;

  if v_looped >= v_lookback + 1 and (select count(*) from jsonb_array_elements(v_months_computed)) >= v_lookback + 1 then
    v_review := true; v_notes := v_notes || format('F&F computed %s month(s) (lookback cap). Verify no month is missed. ', v_lookback + 1);
  end if;

  -- ---- Leave encashment (configurable leave_encashment_rules) ----
  if coalesce(s.encashable_leave_days, 0) > 0 then
    select * into v_enc from public.leave_encashment_compute(s.leave_policy_id, s.encashable_leave_days, v_basic, v_da, v_month_gross);
    v_lines := v_lines || jsonb_build_object('E:LENCASH', jsonb_build_object(
      'line_type','earning','code','LENCASH','name','Leave Encashment',
      'quantity', s.encashable_leave_days, 'rate', v_enc.daily_rate, 'amount', coalesce(v_enc.amount, 0),
      'source','leave_encashment','calc_type','leave_encashment','calc_note', v_enc.note, 'protected', false));
    if v_enc.unresolved then v_review := true; v_notes := v_notes || 'Leave encashment: ' || coalesce(v_enc.note,'') || ' '; end if;
  end if;

  -- ---- Notice pay recovery (configurable exit_notice_policies) ----
  v_notice_shortfall := case when s.notice_waived then 0 else s.notice_shortfall_days end;
  if coalesce(v_notice_shortfall, 0) > 0 then
    select * into v_notice from public.exit_notice_compute(s.company_id, s.leaving_date, v_notice_shortfall, v_basic, v_da, v_month_gross, null);
    v_lines := v_lines || jsonb_build_object('D:NOTICE', jsonb_build_object(
      'line_type','deduction','code','NOTICE','name','Notice Pay Recovery',
      'quantity', v_notice_shortfall, 'rate', v_notice.daily_rate, 'amount', coalesce(v_notice.amount, 0),
      'source','exit_notice','calc_type','notice_recovery','calc_note', v_notice.note, 'protected', false));
    if v_notice.unresolved then v_review := true; v_notes := v_notes || 'Notice pay: ' || coalesce(v_notice.note,'') || ' '; end if;
  end if;

  -- ---- manual F&F adjustments ----
  for l in select * from public.fnf_adjustments where fnf_settlement_id = p_fnf_id loop
    v_key := case l.line_type when 'earning' then 'E:ADJ_' else 'D:ADJ_' end || l.code;
    v_lines := v_lines || jsonb_build_object(v_key, jsonb_build_object(
      'line_type', l.line_type, 'code', l.code, 'name', l.name, 'amount', l.amount,
      'source','fnf_adjustment','calc_type','manual_adjustment','calc_note', 'Adjustment: ' || l.reason,
      'is_adjustment', true, 'protected', false));
  end loop;

  -- ---- Advance Recovery (PREVIEW here; the real recovery runs at approval) ----
  select coalesce(sum(outstanding_amount), 0) into v_adv_outstanding
  from public.advance_recovery_plans
  where company_id = s.company_id and employee_id = s.employee_id and status in ('recovery_pending', 'recovering');
  if v_adv_outstanding > 0 then
    if coalesce(v_settings.advance_recovery_mode, 'full') = 'full' then
      v_adv_recoverable := v_adv_outstanding;
    else
      select coalesce(sum(least(i.scheduled_amount - i.recovered_amount, p.outstanding_amount)), 0) into v_adv_recoverable
      from public.advance_recovery_plans p
      join public.advance_recovery_installments i on i.recovery_plan_id = p.id
      where p.company_id = s.company_id and p.employee_id = s.employee_id
        and p.status in ('recovery_pending', 'recovering') and i.status in ('scheduled', 'partially_processed');
      v_adv_recoverable := least(v_adv_recoverable, v_adv_outstanding);
    end if;
    v_lines := v_lines || jsonb_build_object('D:ADVREC', jsonb_build_object(
      'line_type','deduction','code','ADVREC','name','Advance Recovery',
      'amount', round(v_adv_recoverable, 2), 'source','advance_recovery','calc_type','advance_recovery',
      'calc_note', format('Outstanding %s ; recover %s (%s) ; remaining %s', v_adv_outstanding, round(v_adv_recoverable,2),
        coalesce(v_settings.advance_recovery_mode,'full'), round(v_adv_outstanding - v_adv_recoverable, 2)),
      'protected', true));
  end if;

  -- ---- consolidate + finalize (deduction priority / cap / negative-net / net) ----
  delete from public.fnf_lines where fnf_settlement_id = p_fnf_id;
  v_gross := 0; v_empc := 0; v_deds := '[]'::jsonb;
  for l in select e.value as v from jsonb_each(v_lines) e loop
    insert into public.fnf_lines (fnf_settlement_id, company_id, employee_id, line_type, code, name, quantity, rate, amount,
      source, calc_type, calc_note, is_adjustment, is_protected, sort_order)
    values (p_fnf_id, s.company_id, s.employee_id, l.v->>'line_type', l.v->>'code', l.v->>'name',
      nullif(l.v->>'quantity','')::numeric, nullif(l.v->>'rate','')::numeric, coalesce((l.v->>'amount')::numeric, 0),
      l.v->>'source', l.v->>'calc_type', l.v->>'calc_note', coalesce((l.v->>'is_adjustment')::boolean, false),
      coalesce((l.v->>'protected')::boolean, false),
      case l.v->>'line_type' when 'earning' then 100 when 'employer_contribution' then 400 else 300 end);
    if (l.v->>'line_type') = 'earning' then v_gross := v_gross + coalesce((l.v->>'amount')::numeric, 0);
    elsif (l.v->>'line_type') = 'employer_contribution' then v_empc := v_empc + coalesce((l.v->>'amount')::numeric, 0);
    else v_deds := v_deds || jsonb_build_object('code', l.v->>'code', 'amount', coalesce((l.v->>'amount')::numeric, 0),
                                                'protected', coalesce((l.v->>'protected')::boolean, false)); end if;
  end loop;

  v_fin := public.payroll_policy_finalize(coalesce(s.payroll_policy_id, (select id from public.payroll_policies
             where company_id = s.company_id and status = 'active' order by effective_from desc limit 1)), v_gross, v_deds);
  -- apply cap / negative-net trims back onto the stored lines
  for o in select * from jsonb_array_elements(coalesce(v_fin -> 'ordered', '[]'::jsonb)) loop
    if (o ? 'capped') or (o ? 'neg_blocked') then
      update public.fnf_lines set amount = (o->>'amount')::numeric,
        calc_note = coalesce(calc_note,'') || case when (o ? 'capped') then ' [reduced by deduction cap]' else '' end
                                            || case when (o ? 'neg_blocked') then ' [reduced to block negative net]' else '' end
      where fnf_settlement_id = p_fnf_id and line_type = 'deduction' and code = (o->>'code');
    end if;
  end loop;
  v_ded_total := (v_fin ->> 'total_deductions')::numeric;
  v_net := (v_fin ->> 'net')::numeric;
  if (v_fin ->> 'negative_flag')::boolean then v_review := true; v_notes := v_notes || 'Negative net F&F. '; end if;

  update public.fnf_settlements set
    payroll_policy_id = coalesce(payroll_policy_id, v_pol.id),
    salary_structure_id = v_struct, basic_snapshot = v_basic, da_snapshot = v_da,
    gross_earnings = v_gross, total_deductions = v_ded_total, employer_contribution_total = v_empc,
    advance_recovered = round(v_adv_recoverable, 2), advance_remaining = round(v_adv_outstanding - v_adv_recoverable, 2),
    net_settlement = v_net, has_negative_net = (v_net < 0),
    needs_review = v_review, review_notes = nullif(btrim(v_notes), ''),
    months_computed = v_months_computed, months_consumed = v_months_consumed,
    status = 'calculated', calculated_at = now(), updated_by = auth.uid()
  where id = p_fnf_id;

  insert into public.fnf_events (fnf_settlement_id, company_id, event, from_status, to_status, actor, meta)
  values (p_fnf_id, s.company_id, 'calculated', s.status, 'calculated', auth.uid(),
          jsonb_build_object('gross', v_gross, 'deductions', v_ded_total, 'net', v_net,
                             'advance_recoverable', round(v_adv_recoverable,2), 'months_computed', v_months_computed,
                             'months_consumed', v_months_consumed));
  return public.fnf_get(p_fnf_id);
end;
$fn$;
grant execute on function public.fnf_calculate(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_get — full settlement view (header + lines + payments + events).
-- ----------------------------------------------------------------------------
create or replace function public.fnf_get(p_fnf_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $fn$
declare s public.fnf_settlements; v_emp record;
begin
  select * into s from public.fnf_settlements where id = p_fnf_id;
  if s.id is null then raise exception 'F&F settlement not found.'; end if;
  if not (public.is_super_admin() or (public.current_user_role() <> 'staff' and s.company_id = public.current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select e.full_name, e.employee_code,
         (select name from public.stores st where st.id = e.store_id) as store,
         (select name from public.store_departments d where d.id = e.store_department_id) as department,
         (select title from public.store_designations g where g.id = e.store_designation_id) as designation,
         e.joining_date
    into v_emp from public.employees e where e.id = s.employee_id;

  return jsonb_build_object(
    'settlement', to_jsonb(s) || jsonb_build_object(
      'employee_name', v_emp.full_name, 'employee_code', v_emp.employee_code, 'store', v_emp.store,
      'department', v_emp.department, 'designation', v_emp.designation, 'joining_date', v_emp.joining_date),
    'lines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.line_type, l.sort_order, l.code), '[]'::jsonb)
              from public.fnf_lines l where l.fnf_settlement_id = p_fnf_id),
    'adjustments', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
                    from public.fnf_adjustments a where a.fnf_settlement_id = p_fnf_id),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p) order by p.payment_date, p.created_at), '[]'::jsonb)
                 from public.fnf_payments p where p.fnf_settlement_id = p_fnf_id),
    'events', (select coalesce(jsonb_agg(to_jsonb(ev) order by ev.created_at), '[]'::jsonb)
               from public.fnf_events ev where ev.fnf_settlement_id = p_fnf_id)
  );
end;
$fn$;
grant execute on function public.fnf_get(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_submit — calculated / sent_back -> pending_approval.
-- ----------------------------------------------------------------------------
create or replace function public.fnf_submit(p_fnf_id uuid)
returns public.fnf_settlements
language plpgsql
security definer
as $fn$
declare s public.fnf_settlements;
begin
  select * into s from public.fnf_settlements where id = p_fnf_id for update;
  if s.id is null then raise exception 'F&F settlement not found.'; end if;
  if not public.payroll_can_manage(s.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if s.status not in ('calculated', 'sent_back') then raise exception 'Only a calculated F&F can be submitted (current: %).', s.status; end if;
  update public.fnf_settlements set status = 'pending_approval', submitted_at = now(), updated_by = auth.uid()
  where id = p_fnf_id returning * into s;
  insert into public.fnf_events (fnf_settlement_id, company_id, event, from_status, to_status, actor)
  values (p_fnf_id, s.company_id, 'submitted', 'calculated', 'pending_approval', auth.uid());
  return s;
end;
$fn$;
grant execute on function public.fnf_submit(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_approve — pending_approval -> approved. Runs the REAL advance recovery,
-- reconciles the ADVREC line + net, then FREEZES the immutable snapshot.
-- ----------------------------------------------------------------------------
create or replace function public.fnf_approve(p_fnf_id uuid, p_note text default null)
returns public.fnf_settlements
language plpgsql
security definer
as $fn$
declare
  s public.fnf_settlements; v_settings public.fnf_settings;
  v_adv_period uuid; v_recovered numeric := 0; v_advrec_target numeric := 0; r record;
  v_gross numeric; v_ded numeric; v_net numeric; v_deds jsonb := '[]'::jsonb; v_fin jsonb;
  v_snap jsonb; v_emp record;
begin
  select * into s from public.fnf_settlements where id = p_fnf_id for update;
  if s.id is null then raise exception 'F&F settlement not found.'; end if;
  if not public.fnf_can_approve(s.company_id) then
    raise exception 'You are not authorised to approve F&F for this company.' using errcode = '42501';
  end if;
  if s.status <> 'pending_approval' then raise exception 'Only a submitted F&F can be approved (current: %).', s.status; end if;

  select * into v_settings from public.fnf_settings where company_id = s.company_id;

  -- bridge an advance payroll period for the exit month and run the real recovery,
  -- capped at the ADVREC line amount that was calculated (per fnf_settings.advance_recovery_mode).
  select coalesce(amount, 0) into v_advrec_target from public.fnf_lines where fnf_settlement_id = p_fnf_id and code = 'ADVREC';
  if v_advrec_target > 0 then
    select id into v_adv_period from public.advance_payroll_periods
    where company_id = s.company_id and period_month = date_trunc('month', s.leaving_date)::date;
    if v_adv_period is null then
      insert into public.advance_payroll_periods (company_id, period_month, label, status, created_by, updated_by)
      values (s.company_id, date_trunc('month', s.leaving_date)::date, 'F&F ' || to_char(s.leaving_date, 'Mon YYYY'), 'draft', auth.uid(), auth.uid())
      returning id into v_adv_period;
    end if;

    for r in select * from public.advance_recovery_run_period_full(v_adv_period, s.employee_id, v_advrec_target) loop
      v_recovered := v_recovered + coalesce(r.deducted_amount, 0);
    end loop;

    update public.fnf_lines
    set amount = round(v_recovered, 2),
        calc_note = calc_note || format(' | recovered %s at approval', round(v_recovered, 2))
    where fnf_settlement_id = p_fnf_id and code = 'ADVREC';
  end if;

  -- re-finalize with the actual recovered amount
  select coalesce(sum(amount) filter (where line_type = 'earning'), 0) into v_gross from public.fnf_lines where fnf_settlement_id = p_fnf_id;
  for r in select code, amount, is_protected from public.fnf_lines where fnf_settlement_id = p_fnf_id and line_type = 'deduction' loop
    v_deds := v_deds || jsonb_build_object('code', r.code, 'amount', r.amount, 'protected', r.is_protected);
  end loop;
  v_fin := public.payroll_policy_finalize(s.payroll_policy_id, v_gross, v_deds);
  v_ded := (v_fin ->> 'total_deductions')::numeric;
  v_net := (v_fin ->> 'net')::numeric;

  select e.full_name, e.employee_code, e.joining_date,
         (select name from public.stores st where st.id = e.store_id) store,
         (select name from public.store_departments d where d.id = e.store_department_id) department,
         (select title from public.store_designations g where g.id = e.store_designation_id) designation
    into v_emp from public.employees e where e.id = s.employee_id;

  v_snap := jsonb_build_object(
    'frozen_at', now(), 'employee_id', s.employee_id, 'employee_code', v_emp.employee_code, 'employee_name', v_emp.full_name,
    'store', v_emp.store, 'department', v_emp.department, 'designation', v_emp.designation,
    'joining_date', v_emp.joining_date, 'leaving_date', s.leaving_date, 'exit_type', s.exit_type,
    'payroll_policy_id', s.payroll_policy_id, 'salary_structure_id', s.salary_structure_id,
    'basic', s.basic_snapshot, 'da', s.da_snapshot,
    'notice', jsonb_build_object('required', s.notice_required_days, 'served', s.notice_served_days,
                                 'shortfall', s.notice_shortfall_days, 'waived', s.notice_waived),
    'leave', jsonb_build_object('policy_id', s.leave_policy_id, 'encashable_days', s.encashable_leave_days),
    'months_computed', s.months_computed, 'months_consumed', s.months_consumed,
    'lines', (select jsonb_agg(to_jsonb(l) order by l.line_type, l.sort_order) from public.fnf_lines l where l.fnf_settlement_id = p_fnf_id),
    'gross_earnings', v_gross, 'total_deductions', v_ded, 'employer_contribution_total', s.employer_contribution_total,
    'advance_recovered', round(v_recovered, 2),
    'advance_remaining', (select coalesce(sum(outstanding_amount),0) from public.advance_recovery_plans
                          where company_id = s.company_id and employee_id = s.employee_id and status in ('recovery_pending','recovering')),
    'net_settlement', v_net, 'finalize', v_fin);

  update public.fnf_settlements set
    status = 'approved', approved_by = auth.uid(), approved_at = now(),
    gross_earnings = v_gross, total_deductions = v_ded, net_settlement = v_net, has_negative_net = (v_net < 0),
    advance_recovered = round(v_recovered, 2),
    advance_remaining = (select coalesce(sum(outstanding_amount),0) from public.advance_recovery_plans
                         where company_id = s.company_id and employee_id = s.employee_id and status in ('recovery_pending','recovering')),
    snapshot = v_snap, updated_by = auth.uid()
  where id = p_fnf_id returning * into s;

  insert into public.fnf_events (fnf_settlement_id, company_id, event, from_status, to_status, actor, reason, meta)
  values (p_fnf_id, s.company_id, 'approved', 'pending_approval', 'approved', auth.uid(), p_note,
          jsonb_build_object('net', v_net, 'advance_recovered', round(v_recovered, 2)));
  return s;
end;
$fn$;
grant execute on function public.fnf_approve(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_reject / fnf_send_back — reason required.
-- ----------------------------------------------------------------------------
create or replace function public.fnf_reject(p_fnf_id uuid, p_reason text)
returns public.fnf_settlements
language plpgsql
security definer
as $fn$
declare s public.fnf_settlements;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to reject an F&F.'; end if;
  select * into s from public.fnf_settlements where id = p_fnf_id for update;
  if s.id is null then raise exception 'F&F settlement not found.'; end if;
  if not public.fnf_can_approve(s.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if s.status not in ('pending_approval', 'calculated', 'sent_back') then
    raise exception 'F&F cannot be rejected from status %.', s.status;
  end if;
  update public.fnf_settlements set status = 'rejected', updated_by = auth.uid() where id = p_fnf_id returning * into s;
  insert into public.fnf_events (fnf_settlement_id, company_id, event, to_status, actor, reason)
  values (p_fnf_id, s.company_id, 'rejected', 'rejected', auth.uid(), btrim(p_reason));
  return s;
end;
$fn$;
grant execute on function public.fnf_reject(uuid, text) to authenticated;

create or replace function public.fnf_send_back(p_fnf_id uuid, p_reason text)
returns public.fnf_settlements
language plpgsql
security definer
as $fn$
declare s public.fnf_settlements;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to send an F&F back.'; end if;
  select * into s from public.fnf_settlements where id = p_fnf_id for update;
  if s.id is null then raise exception 'F&F settlement not found.'; end if;
  if not public.fnf_can_approve(s.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if s.status <> 'pending_approval' then raise exception 'Only a submitted F&F can be sent back (current: %).', s.status; end if;
  update public.fnf_settlements set status = 'sent_back', updated_by = auth.uid() where id = p_fnf_id returning * into s;
  insert into public.fnf_events (fnf_settlement_id, company_id, event, from_status, to_status, actor, reason)
  values (p_fnf_id, s.company_id, 'sent_back', 'pending_approval', 'sent_back', auth.uid(), btrim(p_reason));
  return s;
end;
$fn$;
grant execute on function public.fnf_send_back(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_pay — record a (possibly partial) payment. Never marks Paid unless the
-- full net settlement is covered. Closes + inactivates on full settlement.
-- ----------------------------------------------------------------------------
create or replace function public.fnf_pay(
  p_fnf_id uuid, p_amount numeric, p_payment_date date,
  p_payment_mode text default null, p_transaction_reference text default null,
  p_bank_details text default null, p_notes text default null
)
returns public.fnf_settlements
language plpgsql
security definer
as $fn$
declare s public.fnf_settlements; v_settings public.fnf_settings; v_paid numeric; v_new_status text;
begin
  select * into s from public.fnf_settlements where id = p_fnf_id for update;
  if s.id is null then raise exception 'F&F settlement not found.'; end if;
  if not public.payroll_can_manage(s.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if s.status not in ('approved', 'payment_pending', 'partially_paid') then
    raise exception 'F&F must be approved before payment (current: %).', s.status;
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if p_payment_date is null then raise exception 'A payment date is required.'; end if;
  if s.net_settlement <= 0 then raise exception 'Net F&F is % — nothing to pay.', s.net_settlement; end if;

  select coalesce(sum(amount), 0) into v_paid from public.fnf_payments where fnf_settlement_id = p_fnf_id;
  if v_paid + p_amount > s.net_settlement + 0.01 then
    raise exception 'Payment %.2f exceeds the outstanding F&F amount %.2f.', p_amount, s.net_settlement - v_paid;
  end if;

  insert into public.fnf_payments (fnf_settlement_id, company_id, employee_id, amount, payment_date,
    payment_mode, transaction_reference, bank_details, notes, created_by)
  values (p_fnf_id, s.company_id, s.employee_id, p_amount, p_payment_date,
    p_payment_mode, nullif(btrim(coalesce(p_transaction_reference, '')), ''), p_bank_details, p_notes, auth.uid());

  v_paid := v_paid + p_amount;
  select * into v_settings from public.fnf_settings where company_id = s.company_id;

  if v_paid + 0.01 >= s.net_settlement then
    if coalesce(v_settings.auto_inactivate_on_close, true) then
      v_new_status := 'closed';
      update public.employees set status = 'inactive', updated_by = auth.uid() where id = s.employee_id;
    else
      v_new_status := 'paid';
    end if;
  else
    v_new_status := 'partially_paid';
  end if;

  update public.fnf_settlements set status = v_new_status, amount_paid = v_paid,
    closed_at = case when v_new_status = 'closed' then now() else closed_at end, updated_by = auth.uid()
  where id = p_fnf_id returning * into s;

  insert into public.fnf_events (fnf_settlement_id, company_id, event, from_status, to_status, actor, meta)
  values (p_fnf_id, s.company_id, 'payment', 'approved', v_new_status, auth.uid(),
          jsonb_build_object('amount', p_amount, 'total_paid', v_paid, 'net', s.net_settlement, 'mode', p_payment_mode, 'ref', p_transaction_reference));
  return s;
end;
$fn$;
grant execute on function public.fnf_pay(uuid, numeric, date, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_reverse — the original stays immutable; unwind advance recovery; open a
-- fresh draft version.
-- ----------------------------------------------------------------------------
create or replace function public.fnf_reverse(p_fnf_id uuid, p_reason text)
returns public.fnf_settlements
language plpgsql
security definer
as $fn$
declare s public.fnf_settlements; v_new public.fnf_settlements; v_adv_period uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to reverse an F&F.'; end if;
  select * into s from public.fnf_settlements where id = p_fnf_id for update;
  if s.id is null then raise exception 'F&F settlement not found.'; end if;
  if not public.fnf_can_approve(s.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if s.status not in ('approved', 'payment_pending', 'partially_paid', 'paid', 'closed') then
    raise exception 'F&F cannot be reversed from status %.', s.status;
  end if;

  -- unwind the advance recovery that ran at approval (existing engine). This needs
  -- advance-recovery authority; a plain exit-approver must ask Finance / Super-Admin.
  select id into v_adv_period from public.advance_payroll_periods
  where company_id = s.company_id and period_month = date_trunc('month', s.leaving_date)::date;
  if v_adv_period is not null and exists (
    select 1 from public.advance_recovery_transactions x where x.payroll_period_id = v_adv_period and x.txn_type = 'deduction'
      and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id)
  ) then
    if not public.advance_recovery_can_manage(s.company_id) then
      raise exception 'This F&F recovered an advance — reversing it needs advance-recovery authority (Finance Processor / Super-Admin).' using errcode = '42501';
    end if;
    perform public.advance_recovery_reverse_period(v_adv_period, 'F&F reversed: ' || btrim(p_reason));
  end if;

  update public.fnf_settlements set status = 'reversed', updated_by = auth.uid() where id = p_fnf_id returning * into s;
  -- restore the employee to active if this F&F had inactivated them
  update public.employees set status = 'active', updated_by = auth.uid()
  where id = s.employee_id and status = 'inactive';

  insert into public.fnf_settlements (
    company_id, employee_id, version, reverses_settlement_id, exit_type, leaving_date, status,
    notice_required_days, notice_served_days, notice_shortfall_days, notice_waived,
    leave_policy_id, encashable_leave_days, created_by, updated_by
  ) values (
    s.company_id, s.employee_id, s.version + 1, s.id, s.exit_type, s.leaving_date, 'draft',
    s.notice_required_days, s.notice_served_days, s.notice_shortfall_days, s.notice_waived,
    s.leave_policy_id, s.encashable_leave_days, auth.uid(), auth.uid()
  ) returning * into v_new;

  insert into public.fnf_events (fnf_settlement_id, company_id, event, from_status, to_status, actor, reason, meta)
  values (p_fnf_id, s.company_id, 'reversed', s.status, 'reversed', auth.uid(), btrim(p_reason),
          jsonb_build_object('replacement_id', v_new.id));
  insert into public.fnf_events (fnf_settlement_id, company_id, event, to_status, actor, reason, meta)
  values (v_new.id, s.company_id, 'created', 'draft', auth.uid(), 'Correction of reversed F&F ' || p_fnf_id,
          jsonb_build_object('reverses', p_fnf_id));
  return v_new;
end;
$fn$;
grant execute on function public.fnf_reverse(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_list / fnf_register — operational list + the F&F Register report.
-- ----------------------------------------------------------------------------
create or replace function public.fnf_list(p_company_id uuid)
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text, store text,
  exit_type text, leaving_date date, status text, gross_earnings numeric, total_deductions numeric,
  advance_recovered numeric, net_settlement numeric, amount_paid numeric, version int,
  created_at timestamptz, calculated_at timestamptz, approved_at timestamptz
)
language sql
stable
security definer
as $fn$
  select s.id, s.employee_id, e.full_name, e.employee_code,
         (select name from public.stores st where st.id = e.store_id),
         s.exit_type, s.leaving_date, s.status, s.gross_earnings, s.total_deductions,
         s.advance_recovered, s.net_settlement, s.amount_paid, s.version,
         s.created_at, s.calculated_at, s.approved_at
  from public.fnf_settlements s
  join public.employees e on e.id = s.employee_id
  where s.company_id = p_company_id
    and (public.is_super_admin() or (public.current_user_role() <> 'staff' and s.company_id = public.current_user_company_id()))
  order by s.created_at desc;
$fn$;
grant execute on function public.fnf_list(uuid) to authenticated;

create or replace function public.fnf_register(p_company_id uuid, p_from date default null, p_to date default null)
returns table (
  employee_name text, staff_id text, store text, department text,
  joining_date date, leaving_date date, exit_type text,
  total_earnings numeric, total_deductions numeric, advance_recovery numeric, leave_encashment numeric,
  net_fnf numeric, status text, payment_date date
)
language sql
stable
security definer
as $fn$
  select e.full_name, e.employee_code,
         (select name from public.stores st where st.id = e.store_id),
         (select name from public.store_departments d where d.id = e.store_department_id),
         e.joining_date, s.leaving_date, s.exit_type,
         s.gross_earnings, s.total_deductions, s.advance_recovered,
         coalesce((select sum(l.amount) from public.fnf_lines l where l.fnf_settlement_id = s.id and l.code = 'LENCASH'), 0),
         s.net_settlement, s.status,
         (select max(p.payment_date) from public.fnf_payments p where p.fnf_settlement_id = s.id)
  from public.fnf_settlements s
  join public.employees e on e.id = s.employee_id
  where s.company_id = p_company_id
    and s.status not in ('rejected', 'reversed')
    and (p_from is null or s.leaving_date >= p_from)
    and (p_to is null or s.leaving_date <= p_to)
    and (public.is_super_admin() or (public.current_user_role() <> 'staff' and s.company_id = public.current_user_company_id()))
  order by s.leaving_date desc;
$fn$;
grant execute on function public.fnf_register(uuid, date, date) to authenticated;
