-- ============================================================================
-- Retail HRMS — Duplicate Employee Prevention (Anuj Dwivedi incident, 2026-08-22)
-- Migration 0079: one-time data cleanup for the specific duplicate
--
-- Background: Employee ANUJ DWIVEDI (MW STORE, Operations Team, Operations
-- Manager) already existed as employees.id f103d0ce-3e2c-47e2-82bd-03822420944a
-- (employee_code PR-A10970518, created 2026-07-21 via Employee Import/Add).
-- On 2026-08-18, Settings -> User Management -> Create User created an
-- Operations Manager login for the same person and, due to the bug fixed in
-- migration 0078 / supabase/functions/user-account/index.ts, inserted a
-- SECOND employees row (id 4d3b5aa1-bdb5-4996-8da3-9bba52538470, no employee
-- code) rather than reusing the original.
--
-- This migration is idempotent (every statement is scoped to these exact
-- rows and re-running it once already applied is a harmless no-op):
--   1. Move the login (auth_user_id, email) from the duplicate onto the
--      ORIGINAL/master employee record. All of the original's existing
--      history (documents, shift assignment, weekly-off history) is
--      untouched -- only auth_user_id/email/updated_by change.
--   2. Deactivate the duplicate's Operations Manager assignment row and
--      reactivate the original's, so there is exactly one active OM
--      assignment for MW Store, correctly tied to the master employee.
--   3. Deactivate the duplicate employee row (kept, not deleted, so no
--      history is destroyed) and clear its auth_user_id/email so the
--      unique index in migration 0078 has nothing to conflict with.
--   4. Leave a traceable note on both records via employee_notes.
-- ============================================================================

do $$
declare
  v_original_id uuid := 'f103d0ce-3e2c-47e2-82bd-03822420944a';
  v_duplicate_id uuid := '4d3b5aa1-bdb5-4996-8da3-9bba52538470';
  v_auth_user_id uuid := '78443f4a-0b67-43a5-a418-2c8db66a33e7';
  v_login_email text := 'madanwomen@gmail.com';
  v_dup_om_assignment_id uuid := 'f7fe23a6-8cbc-40c1-9fe2-c683ae13547d';
  v_orig_om_assignment_id uuid := 'c448a316-a8a8-47a3-a2fa-a508f8d494a8';
  v_company_id uuid := '34818dc6-dea3-45c2-a6a7-38b288007902';
  v_admin_id uuid := '46efc8c9-4269-4982-9464-8b260702c37b';
begin
  -- Only proceed if the duplicate still holds the login -- keeps this migration
  -- a safe no-op if it has already run (e.g. re-applied during a db reset).
  if exists (select 1 from public.employees where id = v_duplicate_id and auth_user_id = v_auth_user_id) then

    -- 1a. Clear the login link from the duplicate first -- both email (per
    --     company) and auth_user_id (migration 0078) are unique, so it must
    --     be released before the original can claim it.
    update public.employees
    set auth_user_id = null,
        email = null,
        status = 'inactive',
        updated_by = v_admin_id
    where id = v_duplicate_id;

    -- 1b. Relink login/email onto the original/master employee record.
    update public.employees
    set auth_user_id = v_auth_user_id,
        email = v_login_email,
        updated_by = v_admin_id
    where id = v_original_id;

    -- 2. Deactivate the duplicate's OM assignment row.
    update public.attendance_operations_manager_assignments
    set is_active = false,
        remark = 'Deactivated: employee row was a duplicate of PR-A10970518 (Anuj Dwivedi duplicate cleanup, 2026-08-22).',
        updated_by = v_admin_id
    where id = v_dup_om_assignment_id;

    -- 3. Reactivate the original employee's OM assignment.
    update public.attendance_operations_manager_assignments
    set is_active = true,
        updated_by = v_admin_id
    where id = v_orig_om_assignment_id;

    -- 4. Traceability notes on both records.
    insert into public.employee_notes (employee_id, company_id, note, created_by)
    values (
      v_duplicate_id,
      v_company_id,
      'Duplicate of employee PR-A10970518 (Anuj Dwivedi), created by a User Management Create User bug on 2026-08-18. Login (madanwomen@gmail.com) and Operations Manager assignment relinked to PR-A10970518 on 2026-08-22. This record deactivated and retained for audit purposes only -- it is not the master record.',
      v_admin_id
    );

    insert into public.employee_notes (employee_id, company_id, note, created_by)
    values (
      v_original_id,
      v_company_id,
      'Login (madanwomen@gmail.com) and Operations Manager assignment relinked onto this master record from a duplicate employee record accidentally created by User Management on 2026-08-18. Duplicate (previously auth_user_id 78443f4a-0b67-43a5-a418-2c8db66a33e7) deactivated and retained for audit purposes.',
      v_admin_id
    );
  end if;
end $$;
