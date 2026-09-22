-- ============================================================================
-- Retail HRMS — Shift Management & Weekly Off Management
-- Migration 0030
--
-- Builds on EXISTING infrastructure rather than duplicating it:
--   - attendance_shifts already IS the Shift Master (just extended here with
--     shift_code / break_minutes / description).
--   - employee_shift_assignments already IS the shift history table (it has
--     effective_from/effective_to and is already audited via the generic
--     write_audit_log() trigger) — no new shift-history table needed.
-- New tables only for what genuinely doesn't exist: store<->shift
-- availability, weekly-off history, and weekly-off date overrides.
--
-- Purely additive: no existing column dropped, no existing row touched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shift Master extensions
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_shifts
  ADD COLUMN IF NOT EXISTS shift_code text,
  ADD COLUMN IF NOT EXISTS break_minutes int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description text;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_attendance_shifts_company_code
  ON public.attendance_shifts (company_id, shift_code)
  WHERE shift_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Store-wise shift availability ("the same shift can be used by multiple
-- stores"). No rows for a shift = available company-wide (backward
-- compatible with every shift that already exists).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_shift_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.attendance_shifts (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_shift_stores_store ON public.attendance_shift_stores (store_id);

-- ---------------------------------------------------------------------------
-- Employee Weekly Off — history table, same shape/pattern as
-- employee_shift_assignments so changing a weekly off never overwrites the
-- record of what was in effect on a past date.
-- weekly_off_day: 0=Sunday .. 6=Saturday (JS Date.getDay() convention, used
-- consistently across the whole app's date utilities).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_weekly_off_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  weekly_off_day smallint NOT NULL CHECK (weekly_off_day BETWEEN 0 AND 6),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date NULL,
  is_active boolean NOT NULL DEFAULT true,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_weekly_off_history_employee ON public.employee_weekly_off_history (employee_id);

-- ---------------------------------------------------------------------------
-- Individual date override — a one-off swap (e.g. "work this Sunday, take
-- Tuesday off instead"), separate from the recurring weekly pattern.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.weekly_off_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  original_off_date date NOT NULL,
  new_off_date date NOT NULL,
  reason text,
  approved_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_off_overrides_employee ON public.weekly_off_overrides (employee_id);

-- ---------------------------------------------------------------------------
-- RLS — same company-scoped pattern as every other attendance table, PLUS
-- the same staff-can-only-see-their-own-row restriction migration 0026
-- already applied to employees/attendance_records (staff must be able to
-- view — never edit — their own shift and weekly-off, never anyone else's).
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_shift_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_weekly_off_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_off_overrides ENABLE ROW LEVEL SECURITY;

-- employee_shift_assignments (migration 0017) was written before the 'staff' role existed and is
-- still company-scoped only — same gap migration 0026 already closed for employees/attendance_records.
DROP POLICY IF EXISTS "employee_shift_assignments_select_scoped" ON public.employee_shift_assignments;
CREATE POLICY "employee_shift_assignments_select_scoped"
  ON public.employee_shift_assignments FOR SELECT
  USING (
    public.is_super_admin()
    OR (public.current_user_role() <> 'staff' AND company_id = public.current_user_company_id())
    OR (public.current_user_role() = 'staff' AND employee_id = public.current_user_employee_id())
  );

CREATE POLICY "attendance_shift_stores_select_scoped"
  ON public.attendance_shift_stores FOR SELECT
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.attendance_shifts s
      WHERE s.id = shift_id AND s.company_id = public.current_user_company_id()
    )
  );

CREATE POLICY "attendance_shift_stores_write_scoped"
  ON public.attendance_shift_stores FOR ALL
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.attendance_shifts s
      WHERE s.id = shift_id AND s.company_id = public.current_user_company_id()
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.attendance_shifts s
      WHERE s.id = shift_id AND s.company_id = public.current_user_company_id()
    )
  );

CREATE POLICY "employee_weekly_off_history_select_scoped"
  ON public.employee_weekly_off_history FOR SELECT
  USING (
    public.is_super_admin()
    OR (public.current_user_role() <> 'staff' AND company_id = public.current_user_company_id())
    OR (public.current_user_role() = 'staff' AND employee_id = public.current_user_employee_id())
  );

CREATE POLICY "employee_weekly_off_history_write_scoped"
  ON public.employee_weekly_off_history FOR INSERT
  WITH CHECK (public.is_super_admin() OR company_id = public.current_user_company_id());

CREATE POLICY "employee_weekly_off_history_update_scoped"
  ON public.employee_weekly_off_history FOR UPDATE
  USING (public.is_super_admin() OR company_id = public.current_user_company_id());

CREATE POLICY "employee_weekly_off_history_delete_scoped"
  ON public.employee_weekly_off_history FOR DELETE
  USING (public.is_super_admin() OR company_id = public.current_user_company_id());

CREATE POLICY "weekly_off_overrides_select_scoped"
  ON public.weekly_off_overrides FOR SELECT
  USING (
    public.is_super_admin()
    OR (public.current_user_role() <> 'staff' AND company_id = public.current_user_company_id())
    OR (public.current_user_role() = 'staff' AND employee_id = public.current_user_employee_id())
  );

CREATE POLICY "weekly_off_overrides_write_scoped"
  ON public.weekly_off_overrides FOR INSERT
  WITH CHECK (public.is_super_admin() OR company_id = public.current_user_company_id());

CREATE POLICY "weekly_off_overrides_delete_scoped"
  ON public.weekly_off_overrides FOR DELETE
  USING (public.is_super_admin() OR company_id = public.current_user_company_id());

-- ---------------------------------------------------------------------------
-- Triggers: updated_at + audit log, reusing the exact existing functions
-- (no new/duplicate audit system).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_employee_weekly_off_history_set_updated_at') THEN
    CREATE TRIGGER trg_employee_weekly_off_history_set_updated_at
      BEFORE UPDATE ON public.employee_weekly_off_history
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_employee_weekly_off_history_audit') THEN
    CREATE TRIGGER trg_employee_weekly_off_history_audit
      AFTER INSERT OR UPDATE OR DELETE ON public.employee_weekly_off_history
      FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_weekly_off_overrides_audit') THEN
    CREATE TRIGGER trg_weekly_off_overrides_audit
      AFTER INSERT OR UPDATE OR DELETE ON public.weekly_off_overrides
      FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_shift_stores_audit') THEN
    CREATE TRIGGER trg_attendance_shift_stores_audit
      AFTER INSERT OR UPDATE OR DELETE ON public.attendance_shift_stores
      FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
  END IF;
END
$$;
