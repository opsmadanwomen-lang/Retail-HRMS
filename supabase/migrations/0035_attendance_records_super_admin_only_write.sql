-- ============================================================================
-- Retail HRMS — attendance_records direct writes: Super Admin only
-- Migration 0035
--
-- WHY: Migration 0034 tightened attendance_records INSERT/UPDATE/DELETE RLS to
-- exclude `staff` but still allowed any non-staff role (i.e. company_admin) to
-- write the table directly, matching the pattern used on sibling tables. The
-- explicit requirement for this table specifically is stricter: ONLY Super
-- Admin may touch attendance_records directly — Company Admin must go through
-- attendance viewing only, never direct writes, and has no manual-punch RPC
-- access either (attendance_admin_punch() already rejects non-super-admin
-- internally, unchanged by this migration).
--
-- This does NOT affect attendance_punch_in() / attendance_punch_out() /
-- attendance_admin_punch() — all three are SECURITY DEFINER, owned by a role
-- with rolbypassrls=true, so they have never been subject to these policies
-- and keep working unchanged for staff self-punch and Super Admin manual punch.
--
-- No existing row is touched — policy text change only.
-- ============================================================================

drop policy if exists "attendance_records_insert_scoped" on public.attendance_records;
create policy "attendance_records_insert_scoped"
  on public.attendance_records for insert
  with check (public.is_super_admin());

drop policy if exists "attendance_records_update_scoped" on public.attendance_records;
create policy "attendance_records_update_scoped"
  on public.attendance_records for update
  using (public.is_super_admin());

drop policy if exists "attendance_records_delete_scoped" on public.attendance_records;
create policy "attendance_records_delete_scoped"
  on public.attendance_records for delete
  using (public.is_super_admin());

-- SELECT is unchanged (super_admin sees all / non-staff sees own company / staff sees own row) —
-- Company Admin retains full attendance VIEW access, only direct writes are now Super-Admin-only.
