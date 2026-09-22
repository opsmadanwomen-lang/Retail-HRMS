-- ============================================================================
-- Retail HRMS — Production-ready Role/Module/Action/Field/Scope Permission
-- Management: module-catalog completion, data-scope dimension, Super Admin
-- lockout protection, effective-permission summary, bulk role copy.
-- Migration 0164
--
-- ADDITIVE ONLY, on top of the EXISTING Dynamic Role & Permission System
-- (migration 0161) and its enforcement (0162). Nothing here replaces
-- has_dynamic_permission()/has_field_permission(), dynamic_roles,
-- role_permissions, user_permission_overrides, role_field_permissions or
-- user_field_permission_overrides — all reused as-is. No second permission
-- engine. Every new check fails OPEN exactly like the existing ones (a role
-- with no configured scope behaves exactly as today: company-wide), so
-- applying this changes nothing for any existing user until a Super Admin
-- explicitly configures a restriction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Module catalog completion — purely additive seed rows, same convention
--    0161 already used (on conflict do nothing). No existing module row is
--    touched.
-- ----------------------------------------------------------------------------
insert into public.permission_modules (code, label, category, display_order) values
  ('night_duty_approval', 'Night Duty Approval', 'Attendance', 55),
  ('leave_settlement', 'Leave Settlement', 'Leave', 75),
  ('leave_reports', 'Leave Reports', 'Leave', 76),
  ('settings', 'Settings', 'Settings', 200),
  ('user_management', 'User Management', 'Settings', 201),
  ('shift_management', 'Shift Management', 'Settings', 202),
  ('employee_schedule', 'Employee Schedule', 'Settings', 203),
  ('attendance_rules', 'Attendance Rules', 'Settings', 204),
  ('night_duty_manager_access', 'Night Duty Manager Access', 'Settings', 205),
  ('leave_settings', 'Leave Settings', 'Settings', 206),
  ('payroll_settings', 'Payroll Settings', 'Settings', 207),
  ('advance_settings', 'Advance Settings', 'Settings', 208),
  ('notification_settings', 'Notification Settings', 'Settings', 209),
  ('general_settings', 'General / System Settings', 'Settings', 210),
  ('permission_management', 'Permission Management', 'Settings', 211)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 2. role_module_scope — the data-scope dimension. One row per (dynamic_role,
--    module); absence of a row = 'company' (today's existing, unrestricted
--    behavior — fail-open). Same shape/RLS/audit convention as role_permissions
--    (migration 0161).
-- ----------------------------------------------------------------------------
create table if not exists public.role_module_scope (
  id uuid primary key default gen_random_uuid(),
  dynamic_role_id uuid not null references public.dynamic_roles (id) on delete cascade,
  module_code text not null references public.permission_modules (code) on delete cascade,
  scope_type text not null default 'company'
    check (scope_type in ('company', 'store', 'multi_store', 'department', 'own', 'reporting', 'team', 'custom')),
  store_ids uuid[],
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (dynamic_role_id, module_code)
);

create trigger trg_role_module_scope_set_updated_at before update on public.role_module_scope
  for each row execute function public.set_updated_at();
create trigger trg_role_module_scope_audit after insert or update or delete on public.role_module_scope
  for each row execute function public.write_audit_log();

alter table public.role_module_scope enable row level security;

create policy "role_module_scope_select" on public.role_module_scope for select
  using (is_super_admin() or exists (
    select 1 from public.dynamic_roles r where r.id = dynamic_role_id
      and current_user_role() <> 'staff' and r.company_id = current_user_company_id()
  ));
create policy "role_module_scope_write" on public.role_module_scope for all
  using (is_super_admin()) with check (is_super_admin());

-- ----------------------------------------------------------------------------
-- 3. has_dynamic_scope_access() — resolves the CALLING user's effective scope
--    for a module (via their assigned dynamic_role's role_module_scope row,
--    defaulting to 'company' when none configured) and checks the target
--    employee row against it, reusing the EXISTING employees columns
--    (store_id, store_department_id, reporting_manager_id) — no new
--    relationship data invented. 'team'/'custom' are accepted values but not
--    yet enforced beyond 'company' (disclosed limitation, not silently
--    claimed) — everything else is real.
-- ----------------------------------------------------------------------------
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

  select e.id into v_caller_emp from public.employees e where e.auth_user_id = p_user_id limit 1;

  if v_scope.scope_type = 'own' then
    return v_caller_emp is not null and v_caller_emp = v_target.id;
  elsif v_scope.scope_type in ('store', 'multi_store') then
    return v_scope.store_ids is not null and v_target.store_id = any(v_scope.store_ids);
  elsif v_scope.scope_type = 'department' then
    return v_caller_emp is not null and exists (
      select 1 from public.employees c where c.id = v_caller_emp and c.store_department_id = v_target.store_department_id
    );
  elsif v_scope.scope_type = 'reporting' then
    return v_caller_emp is not null and v_target.reporting_manager_id = v_caller_emp;
  else
    -- 'team' / 'custom' — not yet enforced beyond company-wide (see header note).
    return true;
  end if;
end;
$$;
grant execute on function public.has_dynamic_scope_access(uuid, text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Wire scope into employees RLS — one additional RESTRICTIVE select policy,
--    ANDed on top of the 0162 action-level restrictive policies and every
--    existing permissive policy. Only SELECT (row visibility); write actions
--    remain governed by the 0162 action-level policies only, per this pass's
--    disclosed scope.
-- ----------------------------------------------------------------------------
drop policy if exists "employees_dynamic_scope_select" on public.employees;
create policy "employees_dynamic_scope_select" on public.employees
  as restrictive for select
  using (public.has_dynamic_scope_access(auth.uid(), 'employee', employees.id));

-- ----------------------------------------------------------------------------
-- 5. Super Admin lockout protection — DB-level, so it protects every write
--    path (the user-account Edge Function AND any direct path), not just one
--    client. Only fires on the specific transition that would remove the
--    LAST active Super Admin.
-- ----------------------------------------------------------------------------
create or replace function public.prevent_last_super_admin_lockout()
returns trigger
language plpgsql
security definer
as $$
declare
  v_other_active_super_admins int;
begin
  if old.role = 'super_admin' and old.is_active
     and (new.role is distinct from 'super_admin' or new.is_active is distinct from true) then
    select count(*) into v_other_active_super_admins
    from public.profiles
    where role = 'super_admin' and is_active and id <> old.id;
    if v_other_active_super_admins = 0 then
      raise exception 'At least one active Super Admin must remain. This is the last active Super Admin and cannot be deactivated or have its role changed.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_last_super_admin_lockout on public.profiles;
create trigger trg_prevent_last_super_admin_lockout before update on public.profiles
  for each row execute function public.prevent_last_super_admin_lockout();

-- ----------------------------------------------------------------------------
-- 6. permission_effective_summary() — one call, per-module effective access +
--    scope + allowed/denied actions for an ARBITRARY target user (Super Admin
--    tool). Pure composition over has_dynamic_permission()/role_module_scope
--    — no new authorization concept.
-- ----------------------------------------------------------------------------
create or replace function public.permission_effective_summary(p_user_id uuid)
returns table (
  module_code text,
  module_label text,
  access boolean,
  scope_type text,
  allowed_actions text[],
  denied_actions text[]
)
language plpgsql
stable
security definer
as $$
begin
  if not coalesce(is_super_admin(), false) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select
    m.code,
    m.label,
    public.has_dynamic_permission(p_user_id, m.code, 'VIEW'),
    coalesce(
      (select s.scope_type from public.user_dynamic_roles udr
         join public.role_module_scope s on s.dynamic_role_id = udr.dynamic_role_id and s.module_code = m.code
       where udr.user_id = p_user_id),
      'company'
    ),
    (select coalesce(array_agg(a.code order by a.display_order), array[]::text[])
       from public.permission_actions a where public.has_dynamic_permission(p_user_id, m.code, a.code)),
    (select coalesce(array_agg(a.code order by a.display_order), array[]::text[])
       from public.permission_actions a where not public.has_dynamic_permission(p_user_id, m.code, a.code))
  from public.permission_modules m
  where m.is_active
  order by m.display_order;
end;
$$;
grant execute on function public.permission_effective_summary(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. permission_copy_role() — bulk copy one role's action/field/scope config
--    onto another (for "Copy from role" / "Clone Role"). Super-Admin gated,
--    additive-only (on conflict do update), never touches user-level
--    overrides.
-- ----------------------------------------------------------------------------
create or replace function public.permission_copy_role(p_source_role_id uuid, p_target_role_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if p_source_role_id = p_target_role_id then raise exception 'Source and target role must differ.'; end if;

  insert into public.role_permissions (dynamic_role_id, module_code, action_code, is_allowed, updated_by)
  select p_target_role_id, module_code, action_code, is_allowed, auth.uid()
  from public.role_permissions where dynamic_role_id = p_source_role_id
  on conflict (dynamic_role_id, module_code, action_code) do update set is_allowed = excluded.is_allowed, updated_by = auth.uid();

  insert into public.role_field_permissions (dynamic_role_id, module_code, field_code, is_allowed, updated_by)
  select p_target_role_id, module_code, field_code, is_allowed, auth.uid()
  from public.role_field_permissions where dynamic_role_id = p_source_role_id
  on conflict (dynamic_role_id, module_code, field_code) do update set is_allowed = excluded.is_allowed, updated_by = auth.uid();

  insert into public.role_module_scope (dynamic_role_id, module_code, scope_type, store_ids, updated_by)
  select p_target_role_id, module_code, scope_type, store_ids, auth.uid()
  from public.role_module_scope where dynamic_role_id = p_source_role_id
  on conflict (dynamic_role_id, module_code) do update set scope_type = excluded.scope_type, store_ids = excluded.store_ids, updated_by = auth.uid();
end;
$$;
grant execute on function public.permission_copy_role(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Scope CRUD RPCs (same convention as permission_set_role_permission).
-- ----------------------------------------------------------------------------
create or replace function public.permission_set_role_scope(p_role_id uuid, p_module_code text, p_scope_type text, p_store_ids uuid[] default null)
returns public.role_module_scope language plpgsql security definer as $$
declare v_row public.role_module_scope;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.role_module_scope (dynamic_role_id, module_code, scope_type, store_ids, updated_by)
  values (p_role_id, p_module_code, p_scope_type, p_store_ids, auth.uid())
  on conflict (dynamic_role_id, module_code) do update set scope_type = excluded.scope_type, store_ids = excluded.store_ids, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_set_role_scope(uuid, text, text, uuid[]) to authenticated;

create or replace function public.permission_list_role_scopes(p_role_id uuid)
returns setof public.role_module_scope language sql stable security definer as $$
  select * from public.role_module_scope where dynamic_role_id = p_role_id;
$$;
grant execute on function public.permission_list_role_scopes(uuid) to authenticated;
