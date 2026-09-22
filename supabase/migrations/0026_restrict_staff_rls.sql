-- ============================================================================
-- Retail HRMS — Restrict the new 'staff' role at the RLS layer
-- Migration 0026
--
-- Migration 0020 added 'staff' to app_role. Every existing RLS policy on
-- employees/attendance_records was written when only super_admin/company_admin
-- existed, so it only scopes by company_id — any authenticated profile could
-- read every employee/attendance row in their company. That was fine when
-- every login was an admin; it is not fine now that ordinary Staff logins
-- exist ("Staff cannot: Access another employee", "View only their own
-- attendance").
--
-- These policies are REPLACED, not weakened: super_admin and company_admin
-- keep the exact same access they always had (still scoped to the whole
-- company). Only the new 'staff' role is now further restricted to its own
-- linked employee row / own attendance records. The punch RPCs are
-- SECURITY DEFINER and are unaffected by RLS either way.
-- ============================================================================

DROP POLICY IF EXISTS "employees_select_scoped" ON public.employees;
CREATE POLICY "employees_select_scoped"
  ON public.employees FOR SELECT
  USING (
    public.is_super_admin()
    OR (public.current_user_role() <> 'staff' AND company_id = public.current_user_company_id())
    OR (public.current_user_role() = 'staff' AND auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "attendance_records_select_scoped" ON public.attendance_records;
CREATE POLICY "attendance_records_select_scoped"
  ON public.attendance_records FOR SELECT
  USING (
    public.is_super_admin()
    OR (
      public.current_user_role() <> 'staff'
      AND company_id = public.current_user_company_id()
    )
    OR (
      public.current_user_role() = 'staff'
      AND employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid())
    )
  );
