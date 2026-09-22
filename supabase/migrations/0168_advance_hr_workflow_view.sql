-- ============================================================================
-- Retail HRMS — HR Panel Advance Workflow consolidation: one read-only RPC
-- Migration 0168
--
-- INSPECTED FIRST (nothing here duplicates what already exists):
--   - advance_list_boss_pending() is Boss/backup-only — HR gets zero rows, no
--     way to VIEW (not decide) Boss-pending requests today.
--   - advance_list_finance_pending() RAISES for a non-Finance, non-admin
--     caller — an HR-only user cannot even check "is this in Payment stage".
--   - advance_get_finance_payment()/advance_get_hr_process()/
--     advance_get_recovery_detail() ALREADY include advance_am_i_hr(...) in
--     their visibility — reused AS-IS for the new unified detail view, no
--     changes needed there.
--   - Every decide/process/pay/adjust/recovery RPC is UNCHANGED and remains
--     the only way to mutate anything — this migration adds ONE read-only
--     RPC and nothing else.
--
-- advance_hr_workflow_list() — one row per advance_requests for the caller's
-- company, view-only, for the new consolidated "Approvals -> Advance" HR
-- Panel screen. Grants no decide/process/pay authority whatsoever.
-- ============================================================================
create or replace function public.advance_hr_workflow_list()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  store_name text,
  advance_type_name text,
  status text,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  requested_installment_count int,
  manager_recommended_installment_count int,
  boss_final_installment_count int,
  requested_at timestamptz,
  decided_at timestamptz,
  decided_by_name text,
  hr_processed_at timestamptz,
  hr_hold_reason text,
  hr_send_back_reason text,
  payment_amount numeric,
  payment_date date,
  payment_mode_label text,
  finance_hold_reason text,
  receipt_status text,
  total_recovered numeric,
  outstanding_amount numeric,
  recovery_status text
)
language plpgsql
stable
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_company uuid;
  v_authorized boolean;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if v_caller is null then raise exception 'No employee record is linked to the current user.'; end if;

  if public.is_super_admin() then
    v_company := public.current_user_company_id();
  else
    select e.company_id into v_company from public.employees e where e.id = v_caller;
  end if;

  v_authorized := public.is_super_admin()
    or public.advance_am_i_hr(v_caller)
    or public.advance_am_i_finance(v_caller)
    or public.advance_am_i_manager(v_caller)
    or public.advance_am_i_boss(v_caller);
  if not v_authorized then
    raise exception 'You are not authorized to view the Advance workflow.' using errcode = '42501';
  end if;

  return query
  select
    a.id, a.employee_id, e.full_name, e.employee_code, s.name,
    t.name, a.status,
    a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
    a.requested_installment_count, a.manager_recommended_installment_count, a.boss_final_installment_count,
    a.requested_at, a.decided_at, db.full_name,
    hp.processed_at, hp.hold_reason, hp.send_back_reason,
    fp.payment_amount, fp.payment_date, fp.payment_mode_label, fp.hold_reason,
    case
      when fp.id is null then 'not_applicable'
      when exists (select 1 from public.advance_payment_receipts r where r.finance_payment_id = fp.id and r.status = 'active') then 'uploaded'
      else 'pending'
    end,
    rp.total_recovered, rp.outstanding_amount, rp.status
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  left join public.stores s on s.id = e.store_id
  join public.advance_types t on t.id = a.advance_type_id
  left join public.employees db on db.auth_user_id = a.decided_by
  left join public.advance_hr_processes hp on hp.advance_request_id = a.id
  left join public.advance_finance_payments fp on fp.advance_request_id = a.id
  left join public.advance_recovery_plans rp on rp.advance_request_id = a.id
  where a.company_id = v_company
  order by a.requested_at desc;
end;
$$;
grant execute on function public.advance_hr_workflow_list() to authenticated;
