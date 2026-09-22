-- ============================================================================
-- Retail HRMS — Shift Management
-- Migration 0032: Add remark to employee_shift_assignments (Part 4 requires
-- capturing a remark on every shift change, mirroring
-- employee_weekly_off_history.remark). Purely additive.
-- ============================================================================

ALTER TABLE public.employee_shift_assignments
  ADD COLUMN IF NOT EXISTS remark text;
