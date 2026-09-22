-- ============================================================================
-- Retail HRMS — Duplicate Employee Prevention (Anuj Dwivedi incident, 2026-08-22)
-- Migration 0078: employees.auth_user_id must be unique
--
-- Root cause: Settings -> User Management -> Create User (supabase/functions/
-- user-account/index.ts) inserted a brand-new `employees` row to bridge
-- Operations Manager / Super Manager logins into the Night Duty approval
-- system, without first checking whether the person already had an employee
-- record. This let two `employees` rows point at (or be intended for) the
-- same login, which is never valid — one auth user is exactly one employee.
--
-- The Edge Function has been fixed to look up and reuse an existing employee
-- (by email, then by normalized full name + store) before ever inserting a
-- new one. This index is the database-layer backstop: even if application
-- code regresses, two employee rows can never again share the same
-- auth_user_id.
--
-- Safe to add: verified before creating this index that no two employees
-- currently share an auth_user_id.
-- ============================================================================

create unique index if not exists uidx_employees_auth_user_id
  on public.employees (auth_user_id)
  where auth_user_id is not null;
