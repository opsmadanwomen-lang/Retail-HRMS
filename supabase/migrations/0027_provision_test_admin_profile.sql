-- ============================================================================
-- Retail HRMS — Testing support
-- Migration 0027: Provision the profile row for the test admin account the
-- user created directly via the Supabase Dashboard (mhdsf786@gmail.com).
-- Role: super_admin, so both Admin View and Staff View (the toggle) can be
-- verified. This touches no employee data and no other account.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '240ec641-26c6-48ad-8639-994ab9937746') THEN
    INSERT INTO public.profiles (id, company_id, full_name, email, role, is_active)
    VALUES (
      '240ec641-26c6-48ad-8639-994ab9937746',
      '34818dc6-dea3-45c2-a6a7-38b288007902',
      'Test Admin (Verification)',
      'mhdsf786@gmail.com',
      'super_admin',
      true
    );
  END IF;
END
$$;
