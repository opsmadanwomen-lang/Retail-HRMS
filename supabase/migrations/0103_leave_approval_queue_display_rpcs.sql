-- ============================================================================
-- Retail HRMS — Leave Management, Phase 3: approval-queue display RPCs
-- Migration 0103
--
-- FIX: the employees table's OWN RLS policy (untouched, pre-existing) only
-- lets a 'staff'-role caller read their own employee row, or rows at a store
-- they are an Operations Manager for, or (company-wide) rows if they are a
-- Super Manager — there is NO clause granting a plain Direct Manager read
-- access to their direct reports' employees rows. That means a client-side
-- second query (the existing employeeService.getByIds() pattern used for
-- Night Duty's admin-only OM/Super Manager management screens) would return
-- ZERO rows for a genuine Direct-Manager-only account and silently blank out
-- the Employee column.
--
-- Rather than widen employees' own RLS (out of scope — "do not modify
-- existing Attendance" extends to not touching shared infrastructure's
-- behaviour for unrelated features), leave_list_manager_pending() /
-- leave_list_super_manager_pending() are redefined here to return the
-- display fields (employee name/code, leave type name) directly — computed
-- inside the SECURITY DEFINER function body, which already legitimately
-- bypasses RLS for its own internal reads exactly like every other RPC in
-- this codebase. The Manager/Super Manager UI never needs a second query
-- against employees at all.
-- ============================================================================

drop function if exists public.leave_list_manager_pending();
create or replace function public.leave_list_manager_pending()
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
  short_or_long text,
  status text,
  reason text,
  applied_at timestamptz
)
language sql
stable
security definer
as $$
  select a.id, a.employee_id, e.full_name, e.employee_code,
         a.leave_type_id, lt.name,
         a.from_date, a.to_date, a.total_days, a.short_or_long,
         a.status, a.reason, a.applied_at
  from public.leave_applications a
  join public.employees e on e.id = a.employee_id
  join public.leave_types lt on lt.id = a.leave_type_id
  where a.status = 'manager_pending'
    and e.reporting_manager_id = public.current_user_employee_id()
  order by a.applied_at asc;
$$;

drop function if exists public.leave_list_super_manager_pending();
create or replace function public.leave_list_super_manager_pending()
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
  short_or_long text,
  status text,
  reason text,
  applied_at timestamptz
)
language sql
stable
security definer
as $$
  select a.id, a.employee_id, e.full_name, e.employee_code,
         a.leave_type_id, lt.name,
         a.from_date, a.to_date, a.total_days, a.short_or_long,
         a.status, a.reason, a.applied_at
  from public.leave_applications a
  join public.employees e on e.id = a.employee_id
  join public.leave_types lt on lt.id = a.leave_type_id
  where a.status = 'super_manager_pending'
    and exists (
      select 1 from public.attendance_super_managers sm
      where sm.employee_id = public.current_user_employee_id() and sm.is_active and sm.company_id = a.company_id
    )
  order by a.applied_at asc;
$$;

grant execute on function public.leave_list_manager_pending() to authenticated;
grant execute on function public.leave_list_super_manager_pending() to authenticated;

-- ----------------------------------------------------------------------------
-- leave_list_approval_history(): the full immutable Step 1 -> Step 2 audit
-- trail for one application, joined with the approver's display name — used
-- by both the Staff "My Leave Requests" detail view and the Manager/Super
-- Manager queue's history panel. RLS on leave_approval_actions itself already
-- restricts which application_ids may be queried this way; this RPC adds
-- name display on top, same reasoning as the two functions above.
-- ----------------------------------------------------------------------------
create or replace function public.leave_list_approval_history(p_application_id uuid)
returns table (
  step_order int,
  approver_role text,
  approver_employee_id uuid,
  approver_name text,
  action text,
  remark text,
  acted_at timestamptz
)
language sql
stable
security definer
as $$
  select la.step_order, la.approver_role, la.approver_employee_id, e.full_name, la.action, la.remark, la.acted_at
  from public.leave_approval_actions la
  join public.employees e on e.id = la.approver_employee_id
  where la.leave_application_id = p_application_id
    -- Defense in depth: only return history for an application the caller can already see under
    -- leave_applications' own RLS — mirrors that policy's visibility rules exactly rather than
    -- introducing a second, potentially divergent, authorization check.
    and exists (
      select 1 from public.leave_applications a
      where a.id = p_application_id
        and (
          is_super_admin()
          or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or (current_user_role() = 'staff' and a.employee_id = current_user_employee_id())
          or (current_user_role() = 'staff' and public.leave_resolve_direct_manager(a.employee_id) = current_user_employee_id())
          or (current_user_role() = 'staff' and exists (
            select 1 from public.attendance_super_managers sm where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = a.company_id
          ))
        )
    )
  order by la.step_order asc;
$$;

grant execute on function public.leave_list_approval_history(uuid) to authenticated;
