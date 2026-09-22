-- ============================================================================
-- Retail HRMS — Inactive Role Security Fix: deactivating a Business Role must
-- never silently fall through to the fail-open default
-- Migration 0173
--
-- INSPECTED FIRST, exact root cause: has_dynamic_permission() (migration
-- 0161) resolves the caller's assigned role via
--   join public.dynamic_roles dr on dr.id = udr.dynamic_role_id and dr.is_active
-- When the assigned role is deactivated, this INNER JOIN predicate fails, so
-- the whole "consult role_permissions" step is skipped as if NO role were
-- assigned at all -- and the function falls through to `return true`
-- (fail-open). That fail-open default exists for the genuinely different
-- case of "nothing has ever been configured" (migration 0161's own stated
-- goal: applying the Dynamic Permission System changes nothing until a Super
-- Admin explicitly configures something). Silently reusing that same
-- fail-open path for "this user WAS explicitly assigned a role, and that
-- role WAS explicitly configured, but the role has since been deactivated"
-- is a real security gap: deactivating a restrictive role could accidentally
-- GRANT broader access to everyone who held it -- the opposite of what
-- "deactivate" should ever do.
--
-- FIX (has_dynamic_permission only -- see below for why nothing else needs
-- to change): resolve the caller's assigned role ONCE, unconditionally (not
-- gated by is_active). If a role IS assigned and it is INACTIVE, return
-- false immediately (after the User Override check, which still wins
-- regardless -- priority is otherwise UNCHANGED: User Override -> Role ->
-- Module fallback). If a role IS assigned and ACTIVE, resolve
-- role_permissions exactly as before. If NO role is assigned at all, fall
-- through to the SAME fail-open default as before -- that case is genuinely
-- unaffected by this fix.
--
-- has_dynamic_tab_permission() (migration 0169) needs NO change: its own
-- final line already reads
--   return public.has_dynamic_permission(p_user_id, p_module_code, p_action_code);
-- whenever no tab-specific role_tab_permissions row is found (which is
-- exactly what happens for an inactive role, since its own role_tab_permissions
-- join is also gated by dr.is_active) -- so it automatically inherits this
-- fix through its own pre-existing fallback design. A User Tab Override is
-- still checked FIRST, before any role is consulted, so it is completely
-- unaffected either way.
--
-- permission_effective_summary() (migration 0164) also needs NO change: it
-- calls has_dynamic_permission() for every action check, so it inherits the
-- fix automatically.
--
-- permission_effective_actions() (migration 0169) DOES need updating: its
-- CASE expression independently joins role_permissions/role_tab_permissions
-- gated by dr.is_active, and would otherwise mislabel an inactive role's
-- denied action as source='default' (System Default) -- actively misleading
-- for the one screen whose entire purpose is showing WHY a permission is
-- what it is. Fixed with the same resolve-once-then-branch approach, adding
-- one new, honest source value: 'role_inactive'.
--
-- role_module_scope (WHERE) resolution is INTENTIONALLY NOT touched here --
-- scope is a separate concern from permission (WHAT), and this migration
-- does not redesign or touch it, per explicit instruction.
-- ============================================================================

create or replace function public.has_dynamic_permission(p_user_id uuid, p_module_code text, p_action_code text)
returns boolean
language plpgsql
stable
security definer
as $$
declare
  v_role text;
  v_override boolean;
  v_role_perm boolean;
  v_assigned_role_id uuid;
  v_assigned_role_active boolean;
begin
  select role into v_role from public.profiles where id = p_user_id;
  if v_role = 'super_admin' then
    return true;
  end if;

  select is_allowed into v_override from public.user_permission_overrides
  where user_id = p_user_id and module_code = p_module_code and action_code = p_action_code;
  if v_override is not null then
    return v_override; -- User Override always wins, regardless of role status.
  end if;

  select dr.id, dr.is_active into v_assigned_role_id, v_assigned_role_active
  from public.user_dynamic_roles udr
  join public.dynamic_roles dr on dr.id = udr.dynamic_role_id
  where udr.user_id = p_user_id;

  if v_assigned_role_id is not null and not v_assigned_role_active then
    -- The assigned role has been deactivated. It no longer confers ANY access on its own --
    -- never silently fall through to the fail-open default meant for "nothing configured".
    return false;
  end if;

  if v_assigned_role_id is not null then
    select rp.is_allowed into v_role_perm from public.role_permissions rp
    where rp.dynamic_role_id = v_assigned_role_id and rp.module_code = p_module_code and rp.action_code = p_action_code;
    if v_role_perm is not null then
      return v_role_perm;
    end if;
  end if;

  return true; -- fail-open: no role assigned at all, or an ACTIVE role that never configured this action.
end;
$$;
grant execute on function public.has_dynamic_permission(uuid, text, text) to authenticated;

create or replace function public.permission_effective_actions(p_user_id uuid, p_module_code text, p_tab_code text default null)
returns table (action_code text, label text, is_allowed boolean, source text)
language plpgsql
stable
security definer
as $$
declare
  v_role text;
  v_assigned_role_id uuid;
  v_assigned_role_active boolean;
begin
  if not coalesce(is_super_admin(), false) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = p_user_id;

  select dr.id, dr.is_active into v_assigned_role_id, v_assigned_role_active
  from public.user_dynamic_roles udr
  join public.dynamic_roles dr on dr.id = udr.dynamic_role_id
  where udr.user_id = p_user_id;

  return query
  select
    a.code,
    a.label,
    case
      when v_role = 'super_admin' then true
      when p_tab_code is not null and uto.is_allowed is not null then uto.is_allowed
      when p_tab_code is not null and v_assigned_role_id is not null and v_assigned_role_active and rtp.is_allowed is not null then rtp.is_allowed
      when uo.is_allowed is not null then uo.is_allowed
      when v_assigned_role_id is not null and not v_assigned_role_active then false
      when v_assigned_role_id is not null and v_assigned_role_active and rp.is_allowed is not null then rp.is_allowed
      else true
    end,
    case
      when v_role = 'super_admin' then 'super_admin'
      when p_tab_code is not null and uto.is_allowed is not null then 'user_tab_override'
      when p_tab_code is not null and v_assigned_role_id is not null and v_assigned_role_active and rtp.is_allowed is not null then 'role_tab'
      when uo.is_allowed is not null then 'user_module_override'
      when v_assigned_role_id is not null and not v_assigned_role_active then 'role_inactive'
      when v_assigned_role_id is not null and v_assigned_role_active and rp.is_allowed is not null then 'role_module'
      else 'default'
    end
  from public.permission_actions a
  left join public.user_permission_overrides uo
    on uo.user_id = p_user_id and uo.module_code = p_module_code and uo.action_code = a.code
  left join public.role_permissions rp
    on rp.dynamic_role_id = v_assigned_role_id and rp.module_code = p_module_code and rp.action_code = a.code
  left join public.user_tab_permission_overrides uto
    on p_tab_code is not null and uto.user_id = p_user_id and uto.module_code = p_module_code
   and uto.tab_code = p_tab_code and uto.action_code = a.code
  left join public.role_tab_permissions rtp
    on p_tab_code is not null and rtp.dynamic_role_id = v_assigned_role_id and rtp.module_code = p_module_code
   and rtp.tab_code = p_tab_code and rtp.action_code = a.code
  order by a.display_order;
end;
$$;
grant execute on function public.permission_effective_actions(uuid, text, text) to authenticated;
