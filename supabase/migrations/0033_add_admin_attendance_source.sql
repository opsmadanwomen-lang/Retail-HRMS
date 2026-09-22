-- ============================================================================
-- Retail HRMS — Add 'admin' attendance source value
-- Migration 0033
--
-- WHY: Migration 0034 adds a Super-Admin-only manual Punch In/Out RPC. Those
-- records must be clearly distinguishable from self-service punches ('web'),
-- bulk-import / demo-data generation ('backend'), and mobile punches — so an
-- admin-initiated punch is never confused with an employee's own action or
-- with synthetic/import data. Purely additive: no existing row or value is
-- touched, and this must be its own migration/transaction because a newly
-- added enum value cannot be used by DML in the same transaction that adds it.
-- ============================================================================

ALTER TYPE public.attendance_source ADD VALUE IF NOT EXISTS 'admin';
