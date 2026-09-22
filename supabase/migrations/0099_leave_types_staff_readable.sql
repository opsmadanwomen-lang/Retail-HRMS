-- ============================================================================
-- Retail HRMS — Leave Management, Phase 2: Leave Types become Staff-readable
-- Migration 0099
--
-- Phase 1's leave_types RLS deliberately excluded Staff from SELECT (see
-- migration 0089's header note: "deferred to Phase 2, when it's actually
-- needed for Apply Leave"). Phase 2's Apply Leave form needs to populate a
-- Leave Type dropdown — confirmed as a genuine, real gap by a live RLS test
-- (a real `authenticated`-role query for a staff account returned zero
-- Leave Types, which would break the real Apply Leave UI, not just a test
-- artifact). This is the anticipated relaxation, nothing broader: Staff can
-- now SELECT (read only) the company's Leave Types, exactly the same
-- visibility they already have for Shift/Weekly-Off/Attendance Rule
-- configuration on the existing Attendance Information card. Write access
-- remains Super-Admin-only, unchanged.
-- ============================================================================

drop policy if exists "leave_types_select_scoped" on public.leave_types;
create policy "leave_types_select_scoped" on public.leave_types for select
  using (is_super_admin() or company_id = current_user_company_id());
