-- ============================================================================
-- Retail HRMS — Leave Management, Phase 3: fix Direct Manager RLS visibility
-- Migration 0102
--
-- BUG FOUND DURING LIVE RLS TESTING (via the corrected SET ROLE authenticated
-- methodology — never the postgres superuser connection): the Manager clause
-- added in migration 0100 checked
--   EXISTS (select 1 from public.employees e where e.id = ... and
--            e.reporting_manager_id = current_user_employee_id())
-- but employees_select_scoped's OWN RLS policy only lets a 'staff'-role
-- caller read their own employees row (or rows they administer as an
-- Operations Manager / Super Manager) — NOT rows where they are merely the
-- reporting_manager_id. So this nested SELECT against employees silently
-- returned zero rows for a genuine Direct Manager, and the whole OR-clause
-- was always false: a Manager could act via the RPCs (which are SECURITY
-- DEFINER and never hit this policy) but could never actually SEE the
-- application by direct table SELECT, and Manager-facing UI reads (which do
-- go through PostgREST/RLS, not the RPC path) would show nothing.
--
-- FIX: resolve the Direct Manager via the EXISTING leave_resolve_direct_manager()
-- helper (already SECURITY DEFINER, added in 0100) instead of an inline query
-- against employees — exactly the same reason current_user_employee_id() and
-- current_user_role() are themselves SECURITY DEFINER wrapper functions
-- throughout this codebase: it lets policy logic reach across a table's own
-- RLS instead of being silently blocked by it. This changes NOTHING about
-- the employees table's own RLS (left completely untouched, per "do not
-- modify existing Attendance/Night Duty" — this bug and fix are entirely
-- inside Leave's own policies).
-- ============================================================================

drop policy if exists "leave_applications_select_scoped" on public.leave_applications;
create policy "leave_applications_select_scoped" on public.leave_applications for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
    or (current_user_role() = 'staff' and public.leave_resolve_direct_manager(leave_applications.employee_id) = current_user_employee_id())
    or (current_user_role() = 'staff' and exists (
      select 1 from public.attendance_super_managers sm where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = leave_applications.company_id
    ))
  );

drop policy if exists "leave_application_documents_select_scoped" on public.leave_application_documents;
create policy "leave_application_documents_select_scoped" on public.leave_application_documents for select
  using (
    is_super_admin()
    or exists (
      select 1 from public.leave_applications a
      where a.id = leave_application_id
        and (
          (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or (current_user_role() = 'staff' and a.employee_id = current_user_employee_id())
          or (current_user_role() = 'staff' and public.leave_resolve_direct_manager(a.employee_id) = current_user_employee_id())
          or (current_user_role() = 'staff' and exists (
            select 1 from public.attendance_super_managers sm where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = a.company_id
          ))
        )
    )
  );

drop policy if exists "leave_approval_actions_select_scoped" on public.leave_approval_actions;
create policy "leave_approval_actions_select_scoped" on public.leave_approval_actions for select
  using (
    exists (
      select 1 from public.leave_applications a
      where a.id = leave_application_id
        and (
          public.is_super_admin()
          or (public.current_user_role() <> 'staff' and a.company_id = public.current_user_company_id())
          or (public.current_user_role() = 'staff' and a.employee_id = public.current_user_employee_id())
          or (public.current_user_role() = 'staff' and public.leave_resolve_direct_manager(a.employee_id) = public.current_user_employee_id())
          or (public.current_user_role() = 'staff' and exists (
            select 1 from public.attendance_super_managers sm where sm.employee_id = public.current_user_employee_id() and sm.is_active and sm.company_id = a.company_id
          ))
        )
    )
  );
