-- ============================================================================
-- Retail HRMS — Phase 2 Attendance Demo Flag
-- Add a demo marker to attendance_records for temporary demo/test data.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'attendance_records'
      AND column_name = 'is_demo'
  ) THEN
    ALTER TABLE public.attendance_records
    ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relname = 'attendance_records'
      AND a.attname = 'is_demo'
  ) THEN
    -- no-op
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_attendance_records_is_demo ON public.attendance_records (is_demo);
