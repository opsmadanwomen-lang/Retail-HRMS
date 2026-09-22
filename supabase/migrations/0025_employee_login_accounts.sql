-- ============================================================================
-- Retail HRMS — Employee Code + Staff Login Accounts
-- Migration 0025
--
-- Adds the schema needed for:
--   1. Globally-unique, auto-generated Employee Codes (Store Code prefix).
--   2. A robust employee <-> Supabase Auth user link (employees.auth_user_id),
--      replacing fragile email-string matching for any NEW employee that gets
--      a login account. Existing employees are completely unaffected — this
--      column defaults to NULL and nothing back-fills it.
--   3. Forced password-change-on-first-login (profiles.must_change_password).
--
-- Purely additive: no column dropped/renamed, no existing row modified,
-- no existing Employee Code touched or regenerated.
-- ============================================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.employees.auth_user_id IS
  'Links this employee to their Supabase Auth login (Staff account), if one has been created. NULL for employees without a login.';

-- One employee can have at most one linked auth account, and one auth account
-- can only ever belong to one employee.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_employees_auth_user_id
  ON public.employees (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Employee Code must be GLOBALLY unique (not just per-company) per this
-- feature's requirements. The existing per-company partial index from
-- migration 0006 is left in place (it is implied by this one, and removing
-- it isn't necessary or safe to assume is risk-free).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_employees_employee_code_global
  ON public.employees (employee_code)
  WHERE employee_code IS NOT NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.must_change_password IS
  'True after a Staff account is created or its password is reset by an admin — forces a password change before the dashboard is reachable. Never true for pre-existing accounts.';
