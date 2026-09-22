-- ============================================================================
-- Retail HRMS — Attendance testing support
-- Migration 0024: Provision two isolated TEST login accounts directly via SQL
-- (Supabase's hosted signup email quota was exhausted, so the normal
-- supabase.auth.signUp() flow is unavailable right now).
--
-- Both accounts use dummy example.com addresses — no real person's email or
-- credentials are touched:
--   - attendance.test.staff@example.com / TestStaff#2026Aa1  (role: staff)
--     linked to APARNA DUTT (TR-A11041125), a real employee who had no email
--     on file — see migrations 0021/0023.
--   - attendance.test.admin@example.com / TestAdmin#2026Bb2  (role: super_admin)
--     a standalone test admin account, not linked to any employee record.
--
-- This creates rows only in auth.users / auth.identities / public.profiles.
-- No existing account, employee, or attendance data is modified or deleted.
-- ============================================================================

DO $$
DECLARE
  v_staff_id uuid := gen_random_uuid();
  v_admin_id uuid := gen_random_uuid();
  v_company_id uuid := '34818dc6-dea3-45c2-a6a7-38b288007902';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'attendance.test.staff@example.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_staff_id, 'authenticated', 'authenticated',
      'attendance.test.staff@example.com', crypt('TestStaff#2026Aa1', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (
      v_staff_id, v_staff_id::text,
      jsonb_build_object('sub', v_staff_id::text, 'email', 'attendance.test.staff@example.com', 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );

    INSERT INTO public.profiles (id, company_id, full_name, email, role, is_active)
    VALUES (v_staff_id, v_company_id, 'Attendance Test Staff', 'attendance.test.staff@example.com', 'staff', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'attendance.test.admin@example.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_admin_id, 'authenticated', 'authenticated',
      'attendance.test.admin@example.com', crypt('TestAdmin#2026Bb2', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (
      v_admin_id, v_admin_id::text,
      jsonb_build_object('sub', v_admin_id::text, 'email', 'attendance.test.admin@example.com', 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );

    INSERT INTO public.profiles (id, company_id, full_name, email, role, is_active)
    VALUES (v_admin_id, v_company_id, 'Attendance Test Admin', 'attendance.test.admin@example.com', 'super_admin', true);
  END IF;
END
$$;
