-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: default configuration seed
-- Migration 0115
--
-- Ordinary editable data, exactly like Phase 1's own default-policy seed
-- (migration 0093) — every value below (₹15,000, 26, 7 days, basic_da) is
-- the CURRENT company requirement stated in the Phase 4 spec, stored as
-- config rows an Admin can change at any time without a code change. Applied
-- generically to every existing Leave Policy — never a specific hardcoded
-- policy ID.
-- ============================================================================

insert into public.leave_encashment_rules (policy_id, enabled, salary_base_type, divisor_type, threshold_base_type, salary_threshold, threshold_comparison, remark)
select p.id, true, 'basic_da', '26', 'basic', 15000, 'lt', 'Initial configuration: Basic Salary < ₹15,000 → Encashment (Basic+DA ÷ 26 per day); ≥ ₹15,000 → Lapse.'
from public.leave_policies p
where not exists (select 1 from public.leave_encashment_rules r where r.policy_id = p.id);

insert into public.leave_prior_notice_rules (policy_id, required, notice_days, exception_behavior, remark)
select p.id, true, 7, 'allow_with_reason', 'Initial configuration: 7 days prior notice required for long leave; exceptions allowed with a captured reason.'
from public.leave_policies p
where not exists (select 1 from public.leave_prior_notice_rules r where r.policy_id = p.id);

insert into public.leave_notification_settings (company_id, event_type, in_app_enabled, push_enabled, email_enabled, sms_enabled)
select c.id, evt.event_type, true, false, false, false
from public.companies c
cross join (values
  ('leave_applied'), ('manager_approval_pending'), ('super_manager_approval_pending'),
  ('leave_approved'), ('leave_rejected'), ('leave_cancelled'), ('leave_modified'),
  ('long_leave_applied'), ('prior_notice_exception'), ('balance_low'), ('leave_expiring'),
  ('encashment_generated'), ('lapse_generated'), ('financial_year_closed')
) as evt(event_type)
where not exists (
  select 1 from public.leave_notification_settings s where s.company_id = c.id and s.event_type = evt.event_type
);
