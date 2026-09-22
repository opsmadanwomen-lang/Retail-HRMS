-- ============================================================================
-- Retail HRMS — Sub-Category / Tab permission dimension for the Dynamic Role &
-- Permission System (migration 0161 + 0164-0167, all reused as-is).
-- Migration 0169
--
-- INSPECTED FIRST: profiles.role (app_role enum: super_admin, company_admin,
-- operations_manager, super_manager, store_manager, department_manager,
-- staff — the EXACT list supabase/functions/user-account/index.ts's own
-- APP_ROLES constant defines) is untouched by this migration. "HR"/"Boss"/
-- "Manager" are NOT — and were never — values of that enum; they are
-- business authorities held via the existing advance_hr_processors /
-- advance_final_approvers / employees.reporting_manager_id rosters, which
-- this migration does not touch either. dynamic_roles (0161) is the correct,
-- already-built, additive place for a Super Admin to configure "HR"/"Boss"
-- as PERMISSION roles — this migration only adds one more dimension
-- (Module -> Tab -> Action) underneath that existing mechanism.
--
-- WHAT'S NEW: permission_tabs (catalog) + role_tab_permissions +
-- user_tab_permission_overrides — two NEW sibling tables mirroring
-- role_permissions/user_permission_overrides exactly, rather than ALTERing
-- those already-live tables (zero risk to existing rows/constraints).
-- has_dynamic_tab_permission() falls back to the EXISTING
-- has_dynamic_permission() when nothing tab-specific is configured, so
-- every module without seeded tabs behaves EXACTLY as before this migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. permission_tabs — catalog, same shape/convention as permission_fields.
-- ----------------------------------------------------------------------------
create table if not exists public.permission_tabs (
  id uuid primary key default gen_random_uuid(),
  module_code text not null references public.permission_modules (code) on delete cascade,
  tab_code text not null,
  label text not null,
  display_order int not null default 100,
  created_at timestamptz not null default now(),
  unique (module_code, tab_code)
);
alter table public.permission_tabs enable row level security;
create policy "permission_tabs_select" on public.permission_tabs for select using (auth.uid() is not null);
create policy "permission_tabs_write" on public.permission_tabs for all using (is_super_admin()) with check (is_super_admin());
create trigger trg_permission_tabs_audit after insert or update or delete on public.permission_tabs
  for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- 2. role_tab_permissions / user_tab_permission_overrides — same shape/RLS/
--    audit convention as role_permissions/user_permission_overrides, one
--    dimension deeper (tab_code). Absence of a row = fall back to the
--    module-level decision (has_dynamic_permission), not a new default.
-- ----------------------------------------------------------------------------
create table if not exists public.role_tab_permissions (
  id uuid primary key default gen_random_uuid(),
  dynamic_role_id uuid not null references public.dynamic_roles (id) on delete cascade,
  module_code text not null,
  tab_code text not null,
  action_code text not null references public.permission_actions (code) on delete cascade,
  is_allowed boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (dynamic_role_id, module_code, tab_code, action_code),
  foreign key (module_code, tab_code) references public.permission_tabs (module_code, tab_code) on delete cascade
);
alter table public.role_tab_permissions enable row level security;
create trigger trg_role_tab_permissions_set_updated_at before update on public.role_tab_permissions
  for each row execute function public.set_updated_at();
create trigger trg_role_tab_permissions_audit after insert or update or delete on public.role_tab_permissions
  for each row execute function public.write_audit_log();
create policy "role_tab_permissions_select" on public.role_tab_permissions for select
  using (is_super_admin() or exists (
    select 1 from public.dynamic_roles r where r.id = dynamic_role_id
      and current_user_role() <> 'staff' and r.company_id = current_user_company_id()
  ));
create policy "role_tab_permissions_write" on public.role_tab_permissions for all using (is_super_admin()) with check (is_super_admin());

create table if not exists public.user_tab_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  module_code text not null,
  tab_code text not null,
  action_code text not null references public.permission_actions (code) on delete cascade,
  is_allowed boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (user_id, module_code, tab_code, action_code),
  foreign key (module_code, tab_code) references public.permission_tabs (module_code, tab_code) on delete cascade
);
alter table public.user_tab_permission_overrides enable row level security;
create trigger trg_user_tab_permission_overrides_set_updated_at before update on public.user_tab_permission_overrides
  for each row execute function public.set_updated_at();
create trigger trg_user_tab_permission_overrides_audit after insert or update or delete on public.user_tab_permission_overrides
  for each row execute function public.write_audit_log();
create policy "user_tab_permission_overrides_select" on public.user_tab_permission_overrides for select
  using (is_super_admin() or user_id = auth.uid());
create policy "user_tab_permission_overrides_write" on public.user_tab_permission_overrides for all using (is_super_admin()) with check (is_super_admin());

-- ----------------------------------------------------------------------------
-- 3. Seed — Advance Management's real 7 tabs (matching AdvanceWorkflowPage.tsx
--    exactly: My Decisions / Pending with Boss / Boss Approved / Payment /
--    Paid & Receipt / Recovery / History). Every other module simply has zero
--    tab rows today (module-level permission continues to apply) —
--    extensible later via permission_upsert_tab(), never hard-coded shut.
-- ----------------------------------------------------------------------------
insert into public.permission_tabs (module_code, tab_code, label, display_order) values
  ('advance_management', 'my_decisions', 'My Decisions', 10),
  ('advance_management', 'pending_boss', 'Pending with Boss', 20),
  ('advance_management', 'boss_approved', 'Boss Approved', 30),
  ('advance_management', 'payment', 'Payment', 40),
  ('advance_management', 'paid_receipt', 'Paid / Receipt', 50),
  ('advance_management', 'recovery', 'Recovery', 60),
  ('advance_management', 'history', 'History', 70)
on conflict (module_code, tab_code) do nothing;

-- ----------------------------------------------------------------------------
-- 4. has_dynamic_tab_permission() — User Tab Override -> Role Tab Permission
--    -> falls back to the EXISTING has_dynamic_permission() (module-level:
--    User Module Override -> Role Module -> fail-open default). Reuses, never
--    replaces, has_dynamic_permission().
-- ----------------------------------------------------------------------------
create or replace function public.has_dynamic_tab_permission(p_user_id uuid, p_module_code text, p_tab_code text, p_action_code text)
returns boolean
language plpgsql
stable
security definer
as $$
declare
  v_role text;
  v_override boolean;
  v_role_perm boolean;
begin
  select role into v_role from public.profiles where id = p_user_id;
  if v_role = 'super_admin' then
    return true;
  end if;

  select is_allowed into v_override from public.user_tab_permission_overrides
  where user_id = p_user_id and module_code = p_module_code and tab_code = p_tab_code and action_code = p_action_code;
  if v_override is not null then
    return v_override;
  end if;

  select rtp.is_allowed into v_role_perm
  from public.user_dynamic_roles udr
  join public.dynamic_roles dr on dr.id = udr.dynamic_role_id and dr.is_active
  join public.role_tab_permissions rtp on rtp.dynamic_role_id = dr.id and rtp.module_code = p_module_code and rtp.tab_code = p_tab_code
  where udr.user_id = p_user_id and rtp.action_code = p_action_code;
  if v_role_perm is not null then
    return v_role_perm;
  end if;

  -- nothing tab-specific configured -> defer entirely to the existing module-level resolution.
  return public.has_dynamic_permission(p_user_id, p_module_code, p_action_code);
end;
$$;
grant execute on function public.has_dynamic_tab_permission(uuid, text, text, text) to authenticated;

create or replace function public.my_dynamic_tab_permission(p_module_code text, p_tab_code text, p_action_code text)
returns boolean language sql stable security definer as $$
  select public.has_dynamic_tab_permission(auth.uid(), p_module_code, p_tab_code, p_action_code);
$$;
grant execute on function public.my_dynamic_tab_permission(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. permission_effective_actions() — the exact "Effective / Source" data the
--    Users-tab UI needs, computed server-side (never re-implemented client
--    side) so the priority chain has one authoritative place. Super-Admin
--    only (exposes another user's configuration), same gate as
--    permission_effective_summary().
-- ----------------------------------------------------------------------------
create or replace function public.permission_effective_actions(p_user_id uuid, p_module_code text, p_tab_code text default null)
returns table (action_code text, label text, is_allowed boolean, source text)
language plpgsql
stable
security definer
as $$
declare
  v_role text;
begin
  if not coalesce(is_super_admin(), false) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = p_user_id;

  return query
  select
    a.code,
    a.label,
    case
      when v_role = 'super_admin' then true
      when p_tab_code is not null and uto.is_allowed is not null then uto.is_allowed
      when p_tab_code is not null and rtp.is_allowed is not null then rtp.is_allowed
      when uo.is_allowed is not null then uo.is_allowed
      when rp.is_allowed is not null then rp.is_allowed
      else true
    end,
    case
      when v_role = 'super_admin' then 'super_admin'
      when p_tab_code is not null and uto.is_allowed is not null then 'user_tab_override'
      when p_tab_code is not null and rtp.is_allowed is not null then 'role_tab'
      when uo.is_allowed is not null then 'user_module_override'
      when rp.is_allowed is not null then 'role_module'
      else 'default'
    end
  from public.permission_actions a
  left join public.user_permission_overrides uo
    on uo.user_id = p_user_id and uo.module_code = p_module_code and uo.action_code = a.code
  left join public.user_dynamic_roles udr on udr.user_id = p_user_id
  left join public.dynamic_roles dr on dr.id = udr.dynamic_role_id and dr.is_active
  left join public.role_permissions rp
    on rp.dynamic_role_id = dr.id and rp.module_code = p_module_code and rp.action_code = a.code
  left join public.user_tab_permission_overrides uto
    on p_tab_code is not null and uto.user_id = p_user_id and uto.module_code = p_module_code
   and uto.tab_code = p_tab_code and uto.action_code = a.code
  left join public.role_tab_permissions rtp
    on p_tab_code is not null and rtp.dynamic_role_id = dr.id and rtp.module_code = p_module_code
   and rtp.tab_code = p_tab_code and rtp.action_code = a.code
  order by a.display_order;
end;
$$;
grant execute on function public.permission_effective_actions(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Super-Admin management + read RPCs — mirror the existing module-level
--    ones 1:1 (permission_set_role_permission / _clear_role_permission /
--    permission_set_user_override / _clear_user_override / _list_*).
-- ----------------------------------------------------------------------------
create or replace function public.permission_upsert_tab(p_module_code text, p_tab_code text, p_label text, p_display_order int default 100)
returns public.permission_tabs language plpgsql security definer as $$
declare v_row public.permission_tabs;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.permission_tabs (module_code, tab_code, label, display_order)
  values (p_module_code, p_tab_code, p_label, p_display_order)
  on conflict (module_code, tab_code) do update set label = excluded.label, display_order = excluded.display_order
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_upsert_tab(text, text, text, int) to authenticated;

create or replace function public.permission_list_tabs(p_module_code text)
returns setof public.permission_tabs language sql stable security definer as $$
  select * from public.permission_tabs where module_code = p_module_code order by display_order, tab_code;
$$;
grant execute on function public.permission_list_tabs(text) to authenticated;

create or replace function public.permission_set_role_tab_permission(p_role_id uuid, p_module_code text, p_tab_code text, p_action_code text, p_is_allowed boolean)
returns public.role_tab_permissions language plpgsql security definer as $$
declare v_row public.role_tab_permissions;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.role_tab_permissions (dynamic_role_id, module_code, tab_code, action_code, is_allowed, updated_by)
  values (p_role_id, p_module_code, p_tab_code, p_action_code, p_is_allowed, auth.uid())
  on conflict (dynamic_role_id, module_code, tab_code, action_code) do update set is_allowed = excluded.is_allowed, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_set_role_tab_permission(uuid, text, text, text, boolean) to authenticated;

create or replace function public.permission_clear_role_tab_permission(p_role_id uuid, p_module_code text, p_tab_code text, p_action_code text)
returns void language plpgsql security definer as $$
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  delete from public.role_tab_permissions where dynamic_role_id = p_role_id and module_code = p_module_code and tab_code = p_tab_code and action_code = p_action_code;
end; $$;
grant execute on function public.permission_clear_role_tab_permission(uuid, text, text, text) to authenticated;

create or replace function public.permission_list_role_tab_permissions(p_role_id uuid)
returns setof public.role_tab_permissions language sql stable security definer as $$
  select * from public.role_tab_permissions where dynamic_role_id = p_role_id;
$$;
grant execute on function public.permission_list_role_tab_permissions(uuid) to authenticated;

create or replace function public.permission_set_user_tab_override(p_user_id uuid, p_module_code text, p_tab_code text, p_action_code text, p_is_allowed boolean)
returns public.user_tab_permission_overrides language plpgsql security definer as $$
declare v_row public.user_tab_permission_overrides;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.user_tab_permission_overrides (user_id, module_code, tab_code, action_code, is_allowed, updated_by)
  values (p_user_id, p_module_code, p_tab_code, p_action_code, p_is_allowed, auth.uid())
  on conflict (user_id, module_code, tab_code, action_code) do update set is_allowed = excluded.is_allowed, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_set_user_tab_override(uuid, text, text, text, boolean) to authenticated;

create or replace function public.permission_clear_user_tab_override(p_user_id uuid, p_module_code text, p_tab_code text, p_action_code text)
returns void language plpgsql security definer as $$
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  delete from public.user_tab_permission_overrides where user_id = p_user_id and module_code = p_module_code and tab_code = p_tab_code and action_code = p_action_code;
end; $$;
grant execute on function public.permission_clear_user_tab_override(uuid, text, text, text) to authenticated;

create or replace function public.permission_list_user_tab_overrides(p_user_id uuid)
returns setof public.user_tab_permission_overrides language sql stable security definer as $$
  select * from public.user_tab_permission_overrides where user_id = p_user_id;
$$;
grant execute on function public.permission_list_user_tab_overrides(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. permission_audit_history() gains the 3 new tables (same widening pattern
--    migration 0165 already used for role_module_scope).
-- ----------------------------------------------------------------------------
create or replace function public.permission_audit_history(p_limit int default 100)
returns table (id uuid, table_name text, record_id uuid, action public.audit_action, changed_data jsonb, performed_by_name text, performed_at timestamptz)
language sql stable security definer as $$
  select l.id, l.table_name, l.record_id, l.action, l.changed_data, e.full_name, l.performed_at
  from public.audit_logs l
  left join public.employees e on e.auth_user_id = l.performed_by
  where l.table_name in ('permission_modules','dynamic_roles','role_permissions','user_permission_overrides',
                          'role_field_permissions','user_field_permission_overrides','user_dynamic_roles',
                          'role_module_scope','permission_tabs','role_tab_permissions','user_tab_permission_overrides')
    and public.is_super_admin()
  order by l.performed_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;
grant execute on function public.permission_audit_history(int) to authenticated;
