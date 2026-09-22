-- ============================================================================
-- Retail HRMS — Testing support
-- Migration 0029: Remove the synthetic Punch In/Out record created while
-- verifying APARNA DUTT's test Staff login. This is data created moments ago
-- by this verification run — not any pre-existing real attendance.
-- ============================================================================

DELETE FROM public.attendance_records WHERE id = '451bd5ac-b391-4f2d-971d-c8e3eb6f49fa';
