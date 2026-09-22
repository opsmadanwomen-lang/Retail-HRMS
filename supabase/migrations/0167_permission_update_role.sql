-- ============================================================================
-- Retail HRMS — permission_update_role() (edit an existing dynamic role)
-- Migration 0167
--
-- FOUND missing during production-readiness inspection (this session):
-- migration 0161 shipped permission_create_role() and
-- permission_set_role_status() but no way to rename/re-describe a role
-- afterward — an explicit acceptance requirement ("Super Admin can edit
-- roles"). Additive-only, same convention as every other permission_* RPC.
-- ============================================================================
create or replace function public.permission_update_role(p_role_id uuid, p_name text, p_description text default null)
returns public.dynamic_roles language plpgsql security definer as $$
declare v_row public.dynamic_roles;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Role name is required.'; end if;
  update public.dynamic_roles
  set name = trim(p_name), description = p_description, updated_by = auth.uid()
  where id = p_role_id
  returning * into v_row;
  if v_row.id is null then raise exception 'Role not found.'; end if;
  return v_row;
end; $$;
grant execute on function public.permission_update_role(uuid, text, text) to authenticated;
