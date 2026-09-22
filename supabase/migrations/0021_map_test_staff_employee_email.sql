-- ============================================================================
-- Retail HRMS — Attendance testing support
-- Migration 0021: Map one real, currently emailless employee to a dummy test
-- login address so the Staff Punch In/Out flow can be verified end-to-end
-- without creating a fake employee or touching any real employee's existing
-- contact email.
--
-- APARNA DUTT (TR-A11041125) has no email on file today — this only ADDS a
-- value to a previously-null column, it does not overwrite any real data.
-- This can be reverted at any time with:
--   UPDATE public.employees SET email = NULL WHERE id = 'ebffe0af-de13-4d47-ac8a-128deb8ee9a4';
-- ============================================================================

DO $$
BEGIN
  UPDATE public.employees
  SET email = 'attendance.test.staff@demo.local'
  WHERE id = 'ebffe0af-de13-4d47-ac8a-128deb8ee9a4'
    AND email IS NULL;
END
$$;
