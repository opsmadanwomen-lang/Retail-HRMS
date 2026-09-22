-- ============================================================================
-- Retail HRMS — "Pending with Manager" visibility for the unified HR Panel
-- Advance workflow (Approvals -> Advance). Migration 0170.
--
-- INSPECTED FIRST (nothing here duplicates what already exists):
--   - advance_hr_workflow_list() (migration 0168) ALREADY returns every
--     advance_requests row for the caller's company, status included — a
--     'manager_pending' row was ALREADY present in its result set. The ONLY
--     gap was that it didn't expose the employee's original `reason`, or who
--     the Reporting Manager is, which the HR Panel's new "Pending with
--     Manager" tab needs to display (spec section 3). This migration widens
--     that SAME read-only RPC with 3 more output columns — it does not
--     change its authorization, its row set, or add any write capability.
--   - advance_resolve_direct_manager(p_employee_id) (migration 0132) ALREADY
--     resolves the Reporting Manager — reused as-is, not reimplemented.
--   - Manager/Boss decision authority is UNCHANGED: advance_manager_decide/
--     advance_boss_decide (migration 0132/0133) still independently verify
--     the caller against advance_resolve_direct_manager()/advance_final_approvers
--     server-side on every call, regardless of what this read-only list shows.
--     HR seeing a row here never grants HR decide authority.
--   - permission_tabs (migration 0169) gains one more seed row for the
--     already-existing advance_management module — same catalog, not a new
--     permission mechanism.
--
-- Postgres cannot CREATE OR REPLACE a function whose return column list
-- changes, so the existing advance_hr_workflow_list() is dropped and
-- recreated with the identical body plus 3 additional trailing columns.
-- ============================================================================

drop function if exists public.advance_hr_workflow_list();

create function public.advance_hr_workflow_list()
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
  recovery_status text,
  reason text,
  reporting_manager_id uuid,
  reporting_manager_name text
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
    rp.total_recovered, rp.outstanding_amount, rp.status,
    a.reason,
    mgr.id, mgr.full_name
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  left join public.stores s on s.id = e.store_id
  join public.advance_types t on t.id = a.advance_type_id
  left join public.employees db on db.auth_user_id = a.decided_by
  left join public.advance_hr_processes hp on hp.advance_request_id = a.id
  left join public.advance_finance_payments fp on fp.advance_request_id = a.id
  left join public.advance_recovery_plans rp on rp.advance_request_id = a.id
  left join public.employees mgr on mgr.id = public.advance_resolve_direct_manager(a.employee_id)
  where a.company_id = v_company
  order by a.requested_at desc;
end;
$$;
grant execute on function public.advance_hr_workflow_list() to authenticated;

-- "Pending with Manager" sub-category/tab for the existing Advance Management
-- permission module (migration 0169's catalog) — slots between my_decisions
-- (10) and pending_boss (20); no existing row renumbered.
insert into public.permission_tabs (module_code, tab_code, label, display_order) values
  ('advance_management', 'pending_manager', 'Pending with Manager', 15)
on conflict (module_code, tab_code) do nothing;
