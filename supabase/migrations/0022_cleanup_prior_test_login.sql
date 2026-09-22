-- ============================================================================
-- Retail HRMS — Attendance testing support
-- Migration 0022: Remove the prior test login that was mistakenly created
-- against a real employee's real email address (gausiya107@gmail.com).
-- Superseded by a dummy-email test account (attendance.test.staff@demo.local).
-- Deleting from auth.users cascades to public.profiles (on delete cascade).
-- No real employee record is touched by this — GAUSIYA KHAN's employee row
-- and her real email remain completely untouched.
-- ============================================================================

DELETE FROM auth.users WHERE email = 'gausiya107@gmail.com';
