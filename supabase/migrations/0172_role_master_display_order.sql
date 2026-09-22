-- ============================================================================
-- Retail HRMS — Centralized Dynamic Role Master: display_order + Create/Edit
-- Role from User Management
-- Migration 0172
--
-- INSPECTED FIRST: dynamic_roles (migration 0161) is ALREADY the centralized,
-- company-scoped Role Master this task asks for — id/code/name/description/
-- is_active/created_by/updated_by/created_at/updated_at, unique(company_id,
-- code), audited (trg_dynamic_roles_audit), RLS-protected, resolved
-- everywhere through has_dynamic_permission()/has_dynamic_tab_permission()
-- via user_dynamic_roles. permission_create_role/permission_update_role/
-- permission_set_role_status/permission_list_roles/permission_set_user_dynamic_role
-- already exist and are Super-Admin-gated. Nothing here duplicates any of
-- that — no roles_v2, no second role table, no second permission engine.
--
-- The ONE genuine gap: no `display_order` column (task section 1/30). Adding
-- it is a plain additive ALTER — every existing consumer of
-- `public.dynamic_roles`/`setof public.dynamic_roles` (permission_list_roles,
-- permission_create_role, permission_update_role, permission_set_role_status)
-- automatically reflects the new column with zero further change, since
-- Postgres composite/row types track the table definition; only
-- permission_create_role/permission_update_role need a new optional
-- parameter to actually SET it, and permission_list_roles needs its ORDER BY
-- widened. profiles.role / app_role (the System/login role, e.g.
-- super_admin/store_manager/department_manager/staff — see
-- src/types/userManagement.ts's own header comment) is NOT touched by this
-- migration — it remains the separate, protected technical authorization
-- role exactly as task section 4 requires.
-- ============================================================================

alter table public.dynamic_roles add column if not exists display_order int not null default 100;

create or replace function public.permission_create_role(
  p_company_id uuid, p_code text, p_name text, p_description text default null, p_display_order int default 100
)
returns public.dynamic_roles language plpgsql security definer as $$
declare v_row public.dynamic_roles;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if p_code is null or length(trim(p_code)) = 0 then raise exception 'Role code is required.'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Role name is required.'; end if;
  insert into public.dynamic_roles (company_id, code, name, description, display_order, created_by, updated_by)
  values (p_company_id, trim(p_code), trim(p_name), p_description, coalesce(p_display_order, 100), auth.uid(), auth.uid())
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_create_role(uuid, text, text, text, int) to authenticated;

create or replace function public.permission_update_role(
  p_role_id uuid, p_name text, p_description text default null, p_display_order int default null
)
returns public.dynamic_roles language plpgsql security definer as $$
declare v_row public.dynamic_roles;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Role name is required.'; end if;
  update public.dynamic_roles
  set name = trim(p_name), description = p_description,
      display_order = coalesce(p_display_order, display_order),
      updated_by = auth.uid()
  where id = p_role_id
  returning * into v_row;
  if v_row.id is null then raise exception 'Role not found.'; end if;
  return v_row;
end; $$;
grant execute on function public.permission_update_role(uuid, text, text, int) to authenticated;

create or replace function public.permission_list_roles(p_company_id uuid)
returns setof public.dynamic_roles language sql stable security definer as $$
  select * from public.dynamic_roles where company_id = p_company_id order by display_order, name;
$$;
grant execute on function public.permission_list_roles(uuid) to authenticated;
