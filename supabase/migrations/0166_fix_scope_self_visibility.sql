-- ============================================================================
-- Retail HRMS — has_dynamic_scope_access() must always allow a caller to see
-- their OWN employee row, regardless of configured scope_type
-- Migration 0166
--
-- FOUND BY INSPECTION before live testing (this session): current_user_employee_id()
-- and dozens of existing RPCs across Advance/Attendance/Leave/Payroll resolve
-- "who am I" via `select ... from employees where auth_user_id = auth.uid()`.
-- Once ANY dynamic role has a non-'company' scope configured for the
-- 'employee' module (store/department/reporting), 0164's
-- has_dynamic_scope_access() would deny a user's OWN row for 'reporting'
-- scope (a user is not their own manager) and for 'department'/'store' only
-- coincidentally allow it (same store/department as themselves, which is
-- trivially true, so those two were actually safe — only 'reporting' was
-- broken) — but 'own' scope was correct only by definition. Rather than rely
-- on that per-branch coincidence, make self-visibility an explicit,
-- unconditional early return so it can never regress if scope types are
-- extended later. CREATE OR REPLACE, same signature.
-- ============================================================================
create or replace function public.has_dynamic_scope_access(p_user_id uuid, p_module_code text, p_target_employee_id uuid)
returns boolean
language plpgsql
stable
security definer
as $$
declare
  v_role text;
  v_scope record;
  v_caller_emp uuid;
  v_target record;
begin
  select role into v_role from public.profiles where id = p_user_id;
  if v_role = 'super_admin' then
    return true;
  end if;

  select e.id into v_caller_emp from public.employees e where e.auth_user_id = p_user_id limit 1;

  -- FIX (migration 0166): a caller can ALWAYS see their own employee row, regardless of scope —
  -- every existing "who am I" lookup across this app depends on this and must never be scoped
  -- away by a Store/Department/Reporting restriction.
  if v_caller_emp is not null and v_caller_emp = p_target_employee_id then
    return true;
  end if;

  select s.scope_type, s.store_ids into v_scope
  from public.user_dynamic_roles udr
  join public.dynamic_roles dr on dr.id = udr.dynamic_role_id and dr.is_active
  join public.role_module_scope s on s.dynamic_role_id = dr.id and s.module_code = p_module_code
  where udr.user_id = p_user_id;

  if v_scope.scope_type is null or v_scope.scope_type = 'company' then
    return true; -- fail-open / explicit company-wide: today's existing behavior, unchanged
  end if;

  select e.id, e.store_id, e.store_department_id, e.reporting_manager_id
  into v_target from public.employees e where e.id = p_target_employee_id;
  if v_target.id is null then
    return true; -- target not an employee row (defensive) — never the enforcement point for non-employee reads
  end if;

  if v_scope.scope_type = 'own' then
    return false; -- already handled above; reaching here means target is NOT the caller
  elsif v_scope.scope_type in ('store', 'multi_store') then
    return v_scope.store_ids is not null and v_target.store_id = any(v_scope.store_ids);
  elsif v_scope.scope_type = 'department' then
    return v_caller_emp is not null and exists (
      select 1 from public.employees c where c.id = v_caller_emp and c.store_department_id = v_target.store_department_id
    );
  elsif v_scope.scope_type = 'reporting' then
    return v_caller_emp is not null and v_target.reporting_manager_id = v_caller_emp;
  else
    -- 'team' / 'custom' — not yet enforced beyond company-wide (disclosed limitation).
    return true;
  end if;
end;
$$;
grant execute on function public.has_dynamic_scope_access(uuid, text, uuid) to authenticated;
