-- ============================================================================
-- Retail HRMS — Attendance testing support
-- Migration 0023: Supabase Auth rejects the .local TLD as an invalid email
-- format. Switch the test mapping to the example.com domain (reserved for
-- documentation/testing per RFC 2606) instead.
-- ============================================================================

DO $$
BEGIN
  UPDATE public.employees
  SET email = 'attendance.test.staff@example.com'
  WHERE id = 'ebffe0af-de13-4d47-ac8a-128deb8ee9a4'
    AND email = 'attendance.test.staff@demo.local';
END
$$;
