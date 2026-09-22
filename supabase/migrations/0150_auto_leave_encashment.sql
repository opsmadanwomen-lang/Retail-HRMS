-- ============================================================================
-- Retail HRMS — Phase 2C: Automatic leave-encashable-balance resolution at
--   exit, wired into F&F Core (0145/0146). NO new leave-balance engine:
--   this reuses leave_get_balance() (the ONE authoritative balance formula),
--   leave_resolve_policy_assignment(), leave_policy_type_configs and the
--   configurable leave_encashment_rules + leave_encashment_compute() (Phase 1)
--   exactly as the FY-closing engine (leave_compute_fy_closing) already does.
--
-- At EXIT (unlike a normal FY closing) no carry-forward is granted — the
-- employee is not continuing into the next year — so the entire ledger
-- "available" balance (opening+accrual+carry_forward, net of any amount
-- already encashed against a PRIOR, non-reversed F&F for this employee+leave
-- type+financial year) is what the configured encashment rule evaluates.
-- This is not an invented rule: it is the SAME leave_encashment_rules
-- (base/divisor/threshold) already used for normal-year encashment, applied
-- to the balance an exiting employee would otherwise simply lose.
--
-- fnf_calculate() auto-resolves this every time (idempotent, read-only —
-- posts nothing). fnf_approve() re-resolves it once more (in case the ledger
-- moved between calculate and approve, same reconciliation spirit as the
-- Advance Recovery preview -> approve step) and is the ONLY place a
-- leave_ledger 'adjustment' debit is posted, so an employee's leave can never
-- be encashed twice: a second F&F cannot even be created while one is active
-- (uidx_fnf_one_active_per_employee, Phase 1), and fnf_reverse() posts the
-- offsetting 'reversal' credit before a corrected F&F can re-encash it.
--
-- A manually supplied encashable_leave_days (fnf_create's existing parameter,
-- kept for backward compatibility) is used ONLY when NOTHING can be
-- auto-resolved (no policy, or no leave type configured for encashment under
-- it) — never to override a genuinely resolved outcome, even a ₹0/ineligible
-- one (e.g. salary above the configured threshold -> lapses, by design).
-- ============================================================================

alter table public.fnf_settlements add column if not exists leave_snapshot jsonb;

create or replace function public.leave_encashable_balance_at_exit(
  p_company_id uuid, p_employee_id uuid, p_leaving_date date,
  p_basic numeric, p_da numeric, p_gross numeric default null
)
returns table (
  leave_type_id uuid, leave_type_name text, financial_year_id uuid,
  opening numeric, accrued numeric, used numeric, pending numeric, available numeric,
  carry_forward_days numeric, lapsed_days numeric, already_encashed numeric,
  eligible_days numeric, daily_rate numeric, encashment_amount numeric,
  eligible boolean, unresolved boolean, note text
)
language plpgsql
stable
security definer
as $fn$
declare
  v_fy_id uuid; v_policy_id uuid; v_cfg record; v_bal record; v_enc record;
  v_already numeric; v_remaining numeric; v_found boolean := false;
begin
  select id into v_fy_id from public.leave_financial_years
  where company_id = p_company_id and start_date <= p_leaving_date and end_date >= p_leaving_date
  order by start_date desc limit 1;
  if v_fy_id is null then
    unresolved := true; note := 'No financial year is configured covering the leaving date.'; return next; return;
  end if;

  v_policy_id := public.leave_resolve_policy_assignment(p_company_id, p_employee_id, p_leaving_date);
  if v_policy_id is null then
    unresolved := true; note := 'No leave policy resolves for this employee as of the leaving date.'; return next; return;
  end if;

  for v_cfg in
    select c.leave_type_id, t.name as leave_type_name
    from public.leave_policy_type_configs c
    join public.leave_types t on t.id = c.leave_type_id
    where c.policy_id = v_policy_id and c.encashment_allowed
  loop
    v_found := true;
    leave_type_id := v_cfg.leave_type_id; leave_type_name := v_cfg.leave_type_name; financial_year_id := v_fy_id;

    select * into v_bal from public.leave_get_balance(p_employee_id, v_cfg.leave_type_id, v_fy_id);
    select coalesce(sum(ll.days), 0) into opening from public.leave_ledger ll
      where ll.employee_id = p_employee_id and ll.leave_type_id = v_cfg.leave_type_id and ll.financial_year_id = v_fy_id and ll.transaction_type = 'opening';
    select coalesce(sum(ll.days), 0) into accrued from public.leave_ledger ll
      where ll.employee_id = p_employee_id and ll.leave_type_id = v_cfg.leave_type_id and ll.financial_year_id = v_fy_id and ll.transaction_type = 'accrual';
    used := v_bal.used; pending := v_bal.pending; available := v_bal.available;

    -- net amount already encashed against a (non-reversed) F&F for this employee/leave-type/FY
    select coalesce(-sum(ll.days), 0) into v_already from public.leave_ledger ll
      where ll.employee_id = p_employee_id and ll.leave_type_id = v_cfg.leave_type_id and ll.financial_year_id = v_fy_id
        and ll.reference_type = 'fnf_settlement';
    already_encashed := greatest(v_already, 0);

    -- no carry-forward is granted at exit — the whole remaining balance is
    -- evaluated for encashment (or lapse) by the configured rule.
    carry_forward_days := 0;
    v_remaining := greatest(coalesce(available, 0) - already_encashed, 0);

    select * into v_enc from public.leave_encashment_compute(v_policy_id, v_remaining, p_basic, p_da, p_gross);
    unresolved := coalesce(v_enc.unresolved, false);
    eligible := coalesce(v_enc.eligible, false);
    daily_rate := v_enc.daily_rate;
    if unresolved then
      eligible_days := 0; lapsed_days := 0; encashment_amount := 0; note := v_enc.note;
    elsif eligible then
      eligible_days := v_remaining; lapsed_days := 0; encashment_amount := coalesce(v_enc.amount, 0); note := v_enc.note;
    else
      eligible_days := 0; lapsed_days := v_remaining; encashment_amount := 0; note := v_enc.note;
    end if;
    return next;
  end loop;

  if not v_found then
    unresolved := true; note := 'No leave type is configured for encashment under the applicable leave policy.'; return next;
  end if;
end;
$fn$;
grant execute on function public.leave_encashable_balance_at_exit(uuid, uuid, date, numeric, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- fnf_calculate — auto-resolves leave encashment (see header).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fnf_calculate(p_fnf_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  v_leave_row record; v_leave_snapshot jsonb; v_any_resolved boolean; v_total_days numeric; v_lencash_n int;
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

  -- ---- Leave encashment: AUTOMATIC resolution from the existing Leave Ledger
  --      (leave_get_balance + leave_encashment_rules), via
  --      leave_encashable_balance_at_exit(). A manually supplied
  --      encashable_leave_days is used ONLY when nothing can be auto-resolved
  --      at all (no policy / no leave type configured for encashment) — never
  --      to override a genuinely resolved outcome, even a ₹0/lapsed one.
  v_leave_snapshot := '[]'::jsonb; v_any_resolved := false; v_total_days := 0; v_lencash_n := 0;
  for v_leave_row in select * from public.leave_encashable_balance_at_exit(s.company_id, s.employee_id, s.leaving_date, v_basic, v_da, v_month_gross) loop
    v_leave_snapshot := v_leave_snapshot || to_jsonb(v_leave_row);
    if not v_leave_row.unresolved then
      v_any_resolved := true;
      if coalesce(v_leave_row.eligible_days, 0) > 0 then
        v_total_days := v_total_days + v_leave_row.eligible_days;
        v_key := case when v_lencash_n = 0 then 'E:LENCASH' else 'E:LENCASH_' || v_lencash_n end;
        v_lines := v_lines || jsonb_build_object(v_key, jsonb_build_object(
          'line_type','earning', 'code', case when v_lencash_n = 0 then 'LENCASH' else 'LENCASH' || v_lencash_n end,
          'name', 'Leave Encashment' || coalesce(' — ' || v_leave_row.leave_type_name, ''),
          'quantity', v_leave_row.eligible_days, 'rate', v_leave_row.daily_rate, 'amount', coalesce(v_leave_row.encashment_amount, 0),
          'source','leave_encashment','calc_type','leave_encashment','calc_note', v_leave_row.note, 'protected', false));
        v_lencash_n := v_lencash_n + 1;
      end if;
    end if;
  end loop;

  if not v_any_resolved and coalesce(s.encashable_leave_days, 0) > 0 then
    select * into v_enc from public.leave_encashment_compute(s.leave_policy_id, s.encashable_leave_days, v_basic, v_da, v_month_gross);
    v_lines := v_lines || jsonb_build_object('E:LENCASH', jsonb_build_object(
      'line_type','earning','code','LENCASH','name','Leave Encashment',
      'quantity', s.encashable_leave_days, 'rate', v_enc.daily_rate, 'amount', coalesce(v_enc.amount, 0),
      'source','leave_encashment','calc_type','leave_encashment',
      'calc_note', coalesce(v_enc.note, '') || ' (manual override — no auto-resolvable leave configuration found)', 'protected', false));
    v_total_days := s.encashable_leave_days;
    v_leave_snapshot := v_leave_snapshot || jsonb_build_object('mode', 'manual_fallback', 'days', s.encashable_leave_days, 'amount', v_enc.amount, 'unresolved', v_enc.unresolved);
    if v_enc.unresolved then v_review := true; v_notes := v_notes || 'Leave encashment: ' || coalesce(v_enc.note,'') || ' '; end if;
  elsif not v_any_resolved then
    v_review := true; v_notes := v_notes || 'Leave encashment could not be auto-resolved (no leave policy / no encashable leave type configured) and no manual figure was supplied. ';
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
    encashable_leave_days = v_total_days, leave_snapshot = v_leave_snapshot,
    status = 'calculated', calculated_at = now(), updated_by = auth.uid()
  where id = p_fnf_id;

  insert into public.fnf_events (fnf_settlement_id, company_id, event, from_status, to_status, actor, meta)
  values (p_fnf_id, s.company_id, 'calculated', s.status, 'calculated', auth.uid(),
          jsonb_build_object('gross', v_gross, 'deductions', v_ded_total, 'net', v_net,
                             'advance_recoverable', round(v_adv_recoverable,2), 'months_computed', v_months_computed,
                             'months_consumed', v_months_consumed));
  return public.fnf_get(p_fnf_id);
end;
$function$;
grant execute on function public.fnf_calculate(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- fnf_approve — re-resolves leave at approval and posts the ONE ledger debit.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fnf_approve(p_fnf_id uuid, p_note text DEFAULT NULL::text)
 RETURNS fnf_settlements
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  s public.fnf_settlements; v_settings public.fnf_settings;
  v_adv_period uuid; v_recovered numeric := 0; v_advrec_target numeric := 0; r record;
  v_gross numeric; v_ded numeric; v_net numeric; v_deds jsonb := '[]'::jsonb; v_fin jsonb;
  v_snap jsonb; v_emp record;
  v_leave_row record; v_leave_final jsonb := '[]'::jsonb; v_lencash_n int := 0; v_enc record; v_leave_any_resolved boolean := false;
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

  -- Leave encashment: re-resolve from the LIVE ledger (it may have moved since
  -- calculate) and post the ONE authoritative debit at approval — this is the
  -- only place a leave_ledger 'adjustment' row for this F&F is written, so the
  -- balance can never be encashed twice (fnf_reverse posts the offsetting
  -- credit before a corrected F&F can re-encash it).
  for v_leave_row in select * from public.leave_encashable_balance_at_exit(s.company_id, s.employee_id, s.leaving_date, s.basic_snapshot, s.da_snapshot, null) loop
    v_leave_final := v_leave_final || to_jsonb(v_leave_row);
    if not v_leave_row.unresolved then v_leave_any_resolved := true; end if;
  end loop;

  if v_leave_any_resolved then
    -- auto-resolved (possibly ₹0/lapsed, which is a valid resolved outcome) — this is
    -- authoritative; replace whatever calculate() staged and post the ONE ledger debit.
    delete from public.fnf_lines where fnf_settlement_id = p_fnf_id and (code = 'LENCASH' or code like 'LENCASH%');
    v_lencash_n := 0;
    for v_leave_row in select * from public.leave_encashable_balance_at_exit(s.company_id, s.employee_id, s.leaving_date, s.basic_snapshot, s.da_snapshot, null) loop
      if not v_leave_row.unresolved and coalesce(v_leave_row.eligible_days, 0) > 0 then
        insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type,
          transaction_date, days, reference_type, reference_id, remark, created_by)
        values (s.company_id, s.employee_id, v_leave_row.leave_type_id, v_leave_row.financial_year_id, 'adjustment',
          s.leaving_date, -v_leave_row.eligible_days, 'fnf_settlement', p_fnf_id,
          format('Leave encashed at F&F approval (%s day(s))', v_leave_row.eligible_days), auth.uid());

        insert into public.fnf_lines (fnf_settlement_id, company_id, employee_id, line_type, code, name, quantity, rate, amount, source, calc_type, calc_note, sort_order)
        values (p_fnf_id, s.company_id, s.employee_id, 'earning',
          case when v_lencash_n = 0 then 'LENCASH' else 'LENCASH' || v_lencash_n end,
          'Leave Encashment' || coalesce(' — ' || v_leave_row.leave_type_name, ''),
          v_leave_row.eligible_days, v_leave_row.daily_rate, v_leave_row.encashment_amount,
          'leave_encashment', 'leave_encashment', v_leave_row.note || ' [debited to leave ledger at approval]', 100);
        v_lencash_n := v_lencash_n + 1;
      end if;
    end loop;
  end if;
  -- else: nothing auto-resolvable — keep whatever manual-fallback LENCASH line calculate()
  -- already staged in fnf_lines as-is; there is no ledger entry to debit for a figure that
  -- isn't sourced from the ledger.

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
    'leave', jsonb_build_object('policy_id', s.leave_policy_id, 'encashable_days', s.encashable_leave_days, 'breakdown', v_leave_final),
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
    leave_snapshot = case when v_leave_any_resolved then v_leave_final else leave_snapshot end,
    snapshot = v_snap, updated_by = auth.uid()
  where id = p_fnf_id returning * into s;

  insert into public.fnf_events (fnf_settlement_id, company_id, event, from_status, to_status, actor, reason, meta)
  values (p_fnf_id, s.company_id, 'approved', 'pending_approval', 'approved', auth.uid(), p_note,
          jsonb_build_object('net', v_net, 'advance_recovered', round(v_recovered, 2)));
  return s;
end;
$function$;
grant execute on function public.fnf_approve(uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- fnf_reverse — unwinds any leave encashed at approval (offsetting ledger credit).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fnf_reverse(p_fnf_id uuid, p_reason text)
 RETURNS fnf_settlements
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare s public.fnf_settlements; v_new public.fnf_settlements; v_adv_period uuid; v_ll record;
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

  -- unwind any leave encashed at approval (existing ledger's own "never delete,
  -- add an offsetting row" convention — same pattern as the advance reversal above).
  for v_ll in select * from public.leave_ledger
              where reference_type = 'fnf_settlement' and reference_id = p_fnf_id and transaction_type = 'adjustment'
  loop
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type,
      transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_ll.company_id, v_ll.employee_id, v_ll.leave_type_id, v_ll.financial_year_id, 'reversal',
      current_date, -v_ll.days, 'fnf_settlement', p_fnf_id, 'F&F reversed: ' || btrim(p_reason), auth.uid());
  end loop;

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
$function$;
grant execute on function public.fnf_reverse(uuid, text) to authenticated;

