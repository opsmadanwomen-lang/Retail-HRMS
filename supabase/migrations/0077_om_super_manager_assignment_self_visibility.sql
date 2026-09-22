-- ============================================================================
-- Retail HRMS — Fix: an Operations Manager / Super Manager could not see
-- their OWN assignment row, which silently defeated their visibility into
-- attendance_night_duty_approvals / employees / attendance_records
-- Migration 0077
--
-- ROOT CAUSE (found via a REAL end-to-end HTTP test with a genuine
-- Operations Manager login — not a mockup): migration 0061 added a "staff
-- who is an active OM for this row's store" / "staff who is an active Super
-- Manager for this row's company" OR-branch to the SELECT policies of
-- `employees`, `attendance_night_duty_approvals`, and `attendance_records`.
-- Each of those branches is an `EXISTS (SELECT 1 FROM attendance_operations_
-- manager_assignments/attendance_super_managers WHERE ...)` subquery.
--
-- In Postgres RLS, a subquery against another table is STILL subject to
-- THAT table's own RLS policies — it does not run with elevated privilege
-- just because it appears inside a different table's policy. migration
-- 0047's SELECT policy on attendance_operations_manager_assignments /
-- attendance_super_managers is `is_super_admin() OR (role <> 'staff' AND
-- same company)` — staff is explicitly EXCLUDED. So for any 'staff'-role
-- caller (which is exactly what every real Operations Manager / Super
-- Manager login is, per this app's own established design), the EXISTS
-- subquery silently evaluates to zero rows regardless of whether a real,
-- active assignment exists — because the caller isn't even allowed to
-- read their own assignment row to begin with. Confirmed live: a real
-- Operations Manager, correctly registered in attendance_operations_
-- manager_assignments (is_active = true, correct store_id), received an
-- EMPTY result from a direct authenticated REST SELECT against their own
-- assignment row, and consequently also saw zero rows in attendance_night_
-- duty_approvals for their store, despite a genuine pending_om request
-- existing there.
--
-- FIX (minimal, additive, matches migration 0061's own established pattern
-- exactly): add ONE more OR-branch to each of these two tables' SELECT
-- policy — a 'staff' caller may see rows where employee_id = their own
-- resolved employee id. This does not loosen anything for anyone else
-- (super_admin / non-staff-same-company visibility is unchanged, and no
-- staff user gains visibility into ANY OTHER employee's assignment row);
-- it only lets an OM/Super Manager see the one or few rows that are
-- already, unambiguously theirs — which is also exactly what the write
-- side already implicitly assumes is readable by the subqueries in the
-- three tables migration 0061 touched. No other policy, table, or RPC is
-- touched.
-- ============================================================================

drop policy if exists "attendance_operations_manager_assignments_select_scoped" on public.attendance_operations_manager_assignments;
create policy "attendance_operations_manager_assignments_select_scoped" on public.attendance_operations_manager_assignments for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
  );

drop policy if exists "attendance_super_managers_select_scoped" on public.attendance_super_managers;
create policy "attendance_super_managers_select_scoped" on public.attendance_super_managers for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
  );
