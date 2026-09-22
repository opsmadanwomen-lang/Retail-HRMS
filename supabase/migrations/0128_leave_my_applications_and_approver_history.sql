-- ============================================================================
-- Retail HRMS — Leave Management: self-scoped "My Leave Requests" + per-approver
-- Approved / Rejected history for the Leave Approvals page
-- Migration 0128
--
-- PROBLEM 1 ("My Leave Requests" shows other employees' leave):
--   leaveService.listMyApplications() does `select * from leave_applications`
--   with NO employee filter, trusting RLS. But leave_applications' RLS (0100)
--   additionally grants a 'staff' caller visibility of their direct reports'
--   and — for a Super Manager — the whole company's applications. So a staff
--   user who is also a manager/super-manager saw EVERYONE's requests in their
--   own "My Leave Requests". Fixed at the source: leave_list_my_applications()
--   filters strictly on current_user_employee_id(), server-side.
--
-- PROBLEM 2 (Leave Approvals page loses a request once it is decided):
--   the page only ever queried the two *_pending queues. The decision history
--   ALREADY exists, immutably, in leave_approval_actions (migration 0100 —
--   one row per Manager/Super-Manager decision: application, step_order,
--   approver_role, approver_employee_id, action, remark, acted_at). This
--   migration adds ONE read RPC over that existing table so the page can show
--   "what I approved / what I rejected", scoped to the logged-in approver.
--   No new table, no new audit mechanism, no change to any decide RPC or to
--   the 1–3 / 4+ day approval workflow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- leave_list_my_applications(): the caller's OWN leave applications only.
-- Identity is current_user_employee_id() — there is no employee-id parameter,
-- so no client value can widen the result to another person.
-- ----------------------------------------------------------------------------
create or replace function public.leave_list_my_applications()
returns table (
  id uuid,
  company_id uuid,
  employee_id uuid,
  leave_type_id uuid,
  leave_type_name text,
  financial_year_id uuid,
  policy_id uuid,
  from_date date,
  to_date date,
  is_half_day boolean,
  half_day_session text,
  total_days numeric,
  reason text,
  remarks text,
  short_or_long text,
  status text,
  current_step int,
  applied_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_remark text,
  created_at timestamptz
)
language sql
stable
security definer
as $$
  select a.id, a.company_id, a.employee_id, a.leave_type_id, lt.name,
         a.financial_year_id, a.policy_id, a.from_date, a.to_date,
         a.is_half_day, a.half_day_session, a.total_days, a.reason, a.remarks,
         a.short_or_long, a.status, a.current_step, a.applied_at,
         a.decided_by, a.decided_at, a.decision_remark, a.created_at
  from public.leave_applications a
  join public.leave_types lt on lt.id = a.leave_type_id
  where a.employee_id = public.current_user_employee_id()
  order by a.applied_at desc;
$$;

grant execute on function public.leave_list_my_applications() to authenticated;

-- ----------------------------------------------------------------------------
-- leave_list_my_approval_history(p_action): every leave application the
-- LOGGED-IN approver has approved (p_action = 'approved') or rejected
-- (p_action = 'rejected'), at whichever step they acted — read straight from
-- the immutable leave_approval_actions log. `status` is the application's
-- CURRENT overall status; `acted_at` / `approver_role` / `step_order` /
-- `remark` are this approver's own action. Employee + leave-type names are
-- joined inside the SECURITY DEFINER body (a plain Direct Manager has no RLS
-- read on arbitrary employees rows), exactly like leave_list_manager_pending().
-- ----------------------------------------------------------------------------
create or replace function public.leave_list_my_approval_history(p_action text)
returns table (
  id uuid,
  leave_application_id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  leave_type_id uuid,
  leave_type_name text,
  from_date date,
  to_date date,
  total_days numeric,
  short_or_long text,
  status text,
  reason text,
  applied_at timestamptz,
  acted_at timestamptz,
  approver_role text,
  step_order int,
  approver_employee_id uuid,
  approver_name text,
  remark text
)
language sql
stable
security definer
as $$
  select
    la.id,
    a.id                as leave_application_id,
    a.employee_id,
    e.full_name         as employee_name,
    e.employee_code,
    a.leave_type_id,
    lt.name             as leave_type_name,
    a.from_date,
    a.to_date,
    a.total_days,
    a.short_or_long,
    a.status,
    a.reason,
    a.applied_at,
    la.acted_at,
    la.approver_role,
    la.step_order,
    la.approver_employee_id,
    ae.full_name        as approver_name,
    la.remark
  from public.leave_approval_actions la
  join public.leave_applications a on a.id = la.leave_application_id
  join public.employees e on e.id = a.employee_id
  join public.employees ae on ae.id = la.approver_employee_id
  join public.leave_types lt on lt.id = a.leave_type_id
  where la.approver_employee_id = public.current_user_employee_id()
    and la.action = p_action
  order by la.acted_at desc;
$$;

grant execute on function public.leave_list_my_approval_history(text) to authenticated;
