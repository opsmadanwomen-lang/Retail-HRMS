-- ============================================================================
-- Retail HRMS — Leave Management: Staff-side "my leave approval history"
-- Migration 0129
--
-- The Leave Approvals page previously showed a normal Staff user (not a
-- Direct Manager, not a Super Manager) only a "No approval access" message.
-- The page is dual-purpose: for approvers it is the decide inbox + their
-- approval history; for a normal employee it must show the status / approval
-- history of THAT EMPLOYEE'S OWN leave applications, and keep showing them
-- after they are approved or rejected.
--
-- This RPC is that self-scoped source. It reuses the EXISTING tables only —
-- leave_applications (the request) + leave_approval_actions (the immutable
-- Step 1 -> Step 2 decision log, migration 0100). No new table, no duplicate
-- record. Strictly scoped to current_user_employee_id(); there is no
-- employee-id parameter, so no client value can widen the result to another
-- employee's leave. The terminal decision (who finally approved / who
-- rejected, at which step, when, with what remark) is taken from the most
-- recent leave_approval_actions row for the application.
-- ============================================================================
create or replace function public.leave_list_my_leave_history()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  leave_type_id uuid,
  leave_type_name text,
  from_date date,
  to_date date,
  total_days numeric,
  is_half_day boolean,
  short_or_long text,
  reason text,
  status text,
  current_step int,
  applied_at timestamptz,
  decided_action text,
  decided_by_name text,
  decided_role text,
  decided_step int,
  decided_at timestamptz,
  decision_remark text
)
language sql
stable
security definer
as $$
  select
    a.id,
    a.employee_id,
    e.full_name        as employee_name,
    e.employee_code,
    a.leave_type_id,
    lt.name            as leave_type_name,
    a.from_date,
    a.to_date,
    a.total_days,
    a.is_half_day,
    a.short_or_long,
    a.reason,
    a.status,
    a.current_step,
    a.applied_at,
    la.action          as decided_action,
    ae.full_name       as decided_by_name,
    la.approver_role   as decided_role,
    la.step_order      as decided_step,
    la.acted_at        as decided_at,
    coalesce(la.remark, a.decision_remark) as decision_remark
  from public.leave_applications a
  join public.employees e   on e.id = a.employee_id
  join public.leave_types lt on lt.id = a.leave_type_id
  left join lateral (
    select l.action, l.approver_role, l.step_order, l.acted_at, l.remark, l.approver_employee_id
    from public.leave_approval_actions l
    where l.leave_application_id = a.id
    order by l.step_order desc, l.acted_at desc
    limit 1
  ) la on true
  left join public.employees ae on ae.id = la.approver_employee_id
  where a.employee_id = public.current_user_employee_id()
  order by a.applied_at desc;
$$;

grant execute on function public.leave_list_my_leave_history() to authenticated;
