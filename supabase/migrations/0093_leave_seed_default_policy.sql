-- ============================================================================
-- Retail HRMS — Leave Management, Phase 1: Seed the initial default policy
-- Migration 0093
--
-- Seeds §63 of the approved plan as ORDINARY, fully-editable ROWS (never
-- code) for the real company. Every value below is exactly what the master
-- prompt specified as the "current default configuration" -- nothing
-- invented beyond two genuinely unspecified placeholders, both flagged
-- below and in the Phase 1 final report:
--   1. Leave Type NAME/CODE for the 3/month-6/month-1/month accrual -- the
--      prompt describes the accrual numbers but never names which Leave
--      Type they apply to. Seeded as "Casual Leave" (CL) as the most common
--      real-world fit for this exact accrual shape -- trivially renamable
--      by HR afterward via ordinary data, not a code change.
--   2. Probation duration -- §63 says "Company-defined" without a number.
--      Seeded as 6 months (the duration used in every worked example
--      elsewhere in the same prompt, e.g. §12's "Joining Date 10-Jan-2026,
--      Probation = 6 Months") -- again ordinary, HR-editable data.
--   3. Carry Forward maximum -- §16 explicitly says "NOT finally confirmed
--      ... DO NOT hard-code a maximum". Seeded as carry_forward_allowed =
--      true with carry_forward_max_days = NULL (this schema's "no limit set
--      yet" value, not a silent "unlimited" business decision) -- HR must
--      set an explicit number (or deliberately choose unlimited) before
--      relying on it.
--
-- Idempotent: every insert is guarded so re-running this migration is safe.
-- ============================================================================

do $$
declare
  v_company_id uuid := '34818dc6-dea3-45c2-a6a7-38b288007902';
  v_fy_id uuid;
  v_leave_type_id uuid;
  v_policy_id uuid;
  v_config_id uuid;
begin
  -- Financial Year 2026-27, 01-Apr-2026 -> 31-Mar-2027, per §6/§63's confirmed default.
  select id into v_fy_id from public.leave_financial_years where company_id = v_company_id and label = 'FY 2026-27';
  if v_fy_id is null then
    insert into public.leave_financial_years (company_id, label, start_date, end_date, status, remark)
    values (v_company_id, 'FY 2026-27', '2026-04-01', '2027-03-31', 'active', 'Seeded default Financial Year — Phase 1, migration 0093.')
    returning id into v_fy_id;
  end if;

  -- Leave Type: Casual Leave (see header note 1).
  select id into v_leave_type_id from public.leave_types where company_id = v_company_id and code = 'CL';
  if v_leave_type_id is null then
    insert into public.leave_types (company_id, code, name, is_active, is_paid, half_day_allowed, quarter_day_allowed, minimum_unit, document_required, requires_reason, remark)
    values (v_company_id, 'CL', 'Casual Leave', true, true, true, false, 0.5, false, true, 'Seeded default Leave Type — Phase 1, migration 0093. Name/code freely editable by HR.')
    returning id into v_leave_type_id;
  end if;

  -- Leave Policy v1 for FY 2026-27.
  select id into v_policy_id from public.leave_policies where company_id = v_company_id and code = 'GENERAL-STAFF' and version_number = 1;
  if v_policy_id is null then
    insert into public.leave_policies (company_id, financial_year_id, name, code, description, status, version_number, remark)
    values (v_company_id, v_fy_id, 'General Staff Leave Policy', 'GENERAL-STAFF', 'Initial default Leave Policy seeded per the approved Phase 0/Phase 1 plan.', 'active', 1, 'Seeded default Policy — Phase 1, migration 0093.')
    returning id into v_policy_id;
  end if;

  -- Policy-Type Config for Casual Leave under this policy.
  select id into v_config_id from public.leave_policy_type_configs where policy_id = v_policy_id and leave_type_id = v_leave_type_id;
  if v_config_id is null then
    insert into public.leave_policy_type_configs (
      policy_id, leave_type_id, accrual_enabled, accrual_frequency, probation_eligible,
      carry_forward_allowed, carry_forward_max_days, carry_forward_expiry_type, carry_forward_expiry_months,
      encashment_allowed, lapse_allowed, negative_balance_allowed, remark
    ) values (
      v_policy_id, v_leave_type_id, true, 'monthly', true,
      true, null, 'fy_end', null,
      true, true, false, 'Seeded default policy-type config — Phase 1, migration 0093. Carry-forward maximum intentionally left unset (see header note 3) — HR must confirm.'
    )
    returning id into v_config_id;
  end if;

  -- Accrual Periods: Apr-Sep = 3/month, Oct-Mar = 1/month (§8/§63's confirmed default).
  if not exists (select 1 from public.leave_accrual_periods where policy_type_config_id = v_config_id and period_start_month = 4) then
    insert into public.leave_accrual_periods (policy_type_config_id, period_start_month, period_end_month, accrual_amount, sort_order, remark)
    values (v_config_id, 4, 9, 3, 1, 'Seeded default accrual period — Phase 1, migration 0093.');
  end if;
  if not exists (select 1 from public.leave_accrual_periods where policy_type_config_id = v_config_id and period_start_month = 10) then
    insert into public.leave_accrual_periods (policy_type_config_id, period_start_month, period_end_month, accrual_amount, sort_order, remark)
    values (v_config_id, 10, 3, 1, 2, 'Seeded default accrual period — Phase 1, migration 0093.');
  end if;

  -- Probation Rule (see header note 2 for the 6-month placeholder).
  if not exists (select 1 from public.leave_probation_rules where policy_id = v_policy_id) then
    insert into public.leave_probation_rules (
      policy_id, duration_value, duration_unit, extra_leave_during_probation,
      weekly_off_during_probation, post_probation_start_rule, remark
    ) values (
      v_policy_id, 6, 'months', 0,
      true, 'same_month', 'Seeded default probation rule — Phase 1, migration 0093. Duration (6 months) is a placeholder — HR must confirm.'
    );
  end if;

  -- Policy Assignment: company-wide default.
  if not exists (select 1 from public.leave_policy_assignments where company_id = v_company_id and policy_id = v_policy_id and scope_type = 'company') then
    insert into public.leave_policy_assignments (company_id, policy_id, scope_type, effective_from, is_active, remark)
    values (v_company_id, v_policy_id, 'company', '2026-04-01', true, 'Seeded default company-wide assignment — Phase 1, migration 0093.');
  end if;
end $$;
