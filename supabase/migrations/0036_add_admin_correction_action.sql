-- ============================================================================
-- Retail HRMS — Add 'admin_correction' attendance action value
-- Migration 0036
--
-- WHY: Migration 0037 adds attendance_admin_upsert() — Super Admin creating or
-- editing an employee's attendance for any date <= today (status, punch times,
-- remark), distinct from a live "punch now" (attendance_admin_punch, action
-- punch_in/punch_out) and distinct from the existing correction REQUEST/APPROVE
-- workflow (attendance_corrections / correction_requested / correction_approved
-- / correction_rejected, which implies a pending approval step this feature does
-- not use — Super Admin edits directly). A precise action value keeps
-- attendance_audit_logs accurate instead of overloading 'correction_approved'
-- for something that was never "requested". Purely additive, own transaction —
-- required because a newly added enum value cannot be used by DML in the same
-- transaction that adds it.
-- ============================================================================

ALTER TYPE public.attendance_action ADD VALUE IF NOT EXISTS 'admin_correction';
