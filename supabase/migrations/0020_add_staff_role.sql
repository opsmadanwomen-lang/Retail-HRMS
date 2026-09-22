-- ============================================================================
-- Retail HRMS — Attendance: enable a real Staff login
-- Migration 0020: Add 'staff' to the app_role enum.
--
-- WHY: public.app_role currently only allows ('super_admin', 'company_admin').
-- Every login in the system is therefore unavoidably an admin — there is no
-- way for an ordinary employee to have a restricted, self-service-only login
-- that lands on the Attendance module's "Today's Attendance" Punch In/Out
-- screen (src/modules/attendance/pages/AttendancePage.tsx already branches
-- on `role !== company_admin && role !== super_admin` for exactly this case
-- — it has simply never been reachable because no such role value existed).
--
-- This migration ONLY adds a new enum value. It does not alter any table,
-- does not touch existing rows, and does not change the behavior of any
-- existing super_admin/company_admin account.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'staff'
      AND enumtypid = 'public.app_role'::regtype
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'staff';
  END IF;
END
$$;
