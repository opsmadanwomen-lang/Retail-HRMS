-- ============================================================================
-- Retail HRMS — Employee Scope (Store Specific / Company Wide) + Super Manager RLS
-- Migration 0061
--
-- PROBLEM: employees.store_id is NOT NULL, so a company-wide role (Super Manager) cannot be
-- represented as a single employee record — the only workaround was creating one employee record
-- per store, which is explicitly wrong (one person, one record).
--
-- FIX (minimum required, reuses existing architecture):
--   1. employees.store_id becomes NULLABLE.
--   2. New employees.employee_scope ('store_specific' | 'company_wide', default 'store_specific'
--      so all 39 existing employees are completely unaffected — they already have store_id set,
--      which is exactly what 'store_specific' requires).
--   3. A CHECK constraint enforces store_id IS NOT NULL <=> scope = 'store_specific' at the
--      database level (defense in depth, not just UI validation).
--   4. attendance_super_managers already has NO store_id column (migration 0047) — it was already
--      correctly company-wide by design. No change needed there; reused as-is.
--
-- RLS GAP FOUND AND FIXED (found during inspection, required for "Super Manager company-wide
-- access" to actually work end-to-end, not just in the frontend):
--   Operations Manager / Super Manager individual logins are provisioned with profiles.role =
--   'staff' (see supabase/functions/staff-account). The existing SELECT policies on `employees`,
--   `attendance_night_duty_approvals`, and `attendance_records` only ever let a 'staff' user see
--   their OWN row (employee_id = current_user_employee_id() / auth_user_id = auth.uid()) — there
--   was no path for an OM to see their assigned STORE's data, or a Super Manager to see their
--   COMPANY's data, despite attendance_operations_manager_assignments / attendance_super_managers
--   already existing to express exactly that scope. This migration ADDS (does not replace) two
--   more OR-branches to each of those three SELECT policies: an active OM sees rows whose
--   store_id matches one of their assigned stores; an active Super Manager sees rows whose
--   company_id matches their own company_id (== ALL stores of that company, dynamically — no
--   store ever needs a fresh Super Manager assignment). Company A's Super Manager can never see
--   Company B's rows because the match is always company_id = current_user_company_id(), which is
--   itself derived from the caller's own profile row.
--
--   Nothing about the existing is_super_admin() / non-staff / staff-own-row branches changes —
--   these are pure additions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema: nullable store_id + employee_scope + consistency check.
-- ---------------------------------------------------------------------------
alter table public.employees alter column store_id drop not null;

alter table public.employees
  add column if not exists employee_scope text not null default 'store_specific'
    check (employee_scope in ('store_specific', 'company_wide'));

alter table public.employees
  add constraint employees_scope_store_consistency
  check (
    (employee_scope = 'store_specific' and store_id is not null)
    or (employee_scope = 'company_wide' and store_id is null)
  );

comment on column public.employees.employee_scope is
  'store_specific (default): belongs to exactly one store (store_id required). company_wide: no individual store (store_id NULL) — used for company-wide roles like Super Manager, who gets access to all of company_id''s stores via attendance_super_managers, not via store_id.';

-- ---------------------------------------------------------------------------
-- 2. RLS: extend the three SELECT policies with OM (store-scoped) / Super Manager
--    (company-scoped) visibility, additive to the existing branches.
-- ---------------------------------------------------------------------------
drop policy if exists "employees_select_scoped" on public.employees;
create policy "employees_select_scoped" on public.employees for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and auth_user_id = auth.uid())
    or (current_user_role() = 'staff' and exists (
      select 1 from public.attendance_operations_manager_assignments oma
      where oma.employee_id = current_user_employee_id() and oma.is_active and oma.store_id = employees.store_id
    ))
    or (current_user_role() = 'staff' and exists (
      select 1 from public.attendance_super_managers sm
      where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = employees.company_id
    ))
  );

drop policy if exists "attendance_night_duty_approvals_select_scoped" on public.attendance_night_duty_approvals;
create policy "attendance_night_duty_approvals_select_scoped" on public.attendance_night_duty_approvals for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
    or (current_user_role() = 'staff' and exists (
      select 1 from public.attendance_operations_manager_assignments oma
      where oma.employee_id = current_user_employee_id() and oma.is_active and oma.store_id = attendance_night_duty_approvals.store_id
    ))
    or (current_user_role() = 'staff' and exists (
      select 1 from public.attendance_super_managers sm
      where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = attendance_night_duty_approvals.company_id
    ))
  );

drop policy if exists "attendance_records_select_scoped" on public.attendance_records;
create policy "attendance_records_select_scoped" on public.attendance_records for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = (select employees.id from public.employees where employees.auth_user_id = auth.uid()))
    or (current_user_role() = 'staff' and exists (
      select 1 from public.attendance_operations_manager_assignments oma
      where oma.employee_id = current_user_employee_id() and oma.is_active and oma.store_id = attendance_records.store_id
    ))
    or (current_user_role() = 'staff' and exists (
      select 1 from public.attendance_super_managers sm
      where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = attendance_records.company_id
    ))
  );
