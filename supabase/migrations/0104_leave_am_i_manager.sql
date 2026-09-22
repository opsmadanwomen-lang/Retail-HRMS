-- ============================================================================
-- Retail HRMS — Leave Management, Phase 3: "am I a Direct Manager" check
-- Migration 0104
--
-- The Leave Approvals UI needs to know whether to show the Manager tab at all
-- — independent of whether the caller currently has zero or several pending
-- applications waiting. Mirrors useAmISuperManager()'s existing role-probe
-- shape (a single boolean, SECURITY DEFINER, so it works for a plain 'staff'
-- caller regardless of employees' own RLS).
-- ============================================================================
create or replace function public.leave_am_i_a_manager()
returns boolean
language sql
stable
security definer
as $$
  select exists (select 1 from public.employees where reporting_manager_id = public.current_user_employee_id());
$$;

grant execute on function public.leave_am_i_a_manager() to authenticated;
