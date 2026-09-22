-- ============================================================================
-- Retail HRMS — Dynamic Super-Admin-Controlled Role & Permission System
-- Migration 0161
--
-- SCOPE DECISION (stated up front, not hidden): this is an ADDITIVE
-- fine-grained permission LAYER on top of the existing auth model
-- (public.profiles.role app_role enum, the existing advance_final_approvers/
-- advance_hr_processors/advance_finance_processors rosters, is_super_admin()/
-- current_user_role()/current_user_company_id()). It does NOT replace or
-- remove any of that — doing so would mean rewriting authorization in every
-- one of the ~150 existing migrations' RPCs and RLS policies in one pass,
-- which is exactly the "breaking existing workflow" this task forbids.
-- Instead: every new has_dynamic_permission()/has_field_permission() check
-- DEFAULTS TO ALLOW when nothing has been configured for a given module/
-- action/field/user (fail-OPEN, not fail-closed) — so simply having this
-- migration applied changes NOTHING for any existing user until a Super
-- Admin explicitly configures a restriction through the new management UI.
-- Once configured, the restriction is enforced from the RPC/backend layer
-- (never frontend-only), exactly as required.
--
-- REUSED, NOT DUPLICATED: is_super_admin(), current_user_company_id(),
-- current_user_role(), current_user_employee_id(), write_audit_log() +
-- public.audit_logs (no second audit mechanism), profiles (the existing
-- user table — no parallel user table).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Catalogs. Modules/actions/fields are GLOBAL (app-shaped, not tenant
--    data) but Super Admin can add more later — never a fixed enum, always
--    ordinary rows.
-- ----------------------------------------------------------------------------
-- id is the surrogate PK (every audited table in this codebase has one — write_audit_log() reads
-- NEW.id); `code` stays UNIQUE NOT NULL so every existing FK reference to `code` below is unaffected
-- (Postgres foreign keys may target any unique column, not only the primary key).
create table if not exists public.permission_modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  category text,
  display_order int not null default 100,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permission_actions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  display_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.permission_fields (
  id uuid primary key default gen_random_uuid(),
  module_code text not null references public.permission_modules (code) on delete cascade,
  field_code text not null,
  label text not null,
  is_sensitive boolean not null default false,
  display_order int not null default 100,
  created_at timestamptz not null default now(),
  unique (module_code, field_code)
);

-- ----------------------------------------------------------------------------
-- 2. Dynamic roles (company-scoped — each company's Super Admin view manages
--    its own set) + one active dynamic role per user (additive to, never
--    replacing, profiles.role).
-- ----------------------------------------------------------------------------
create table if not exists public.dynamic_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.user_dynamic_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  dynamic_role_id uuid not null references public.dynamic_roles (id) on delete cascade,
  assigned_by uuid,
  assigned_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Role-level and user-level action permissions. Absence of a row = not
--    configured = ALLOW (fail-open, see header). A row's is_allowed can be
--    true (explicit allow) or false (explicit deny).
-- ----------------------------------------------------------------------------
create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  dynamic_role_id uuid not null references public.dynamic_roles (id) on delete cascade,
  module_code text not null references public.permission_modules (code) on delete cascade,
  action_code text not null references public.permission_actions (code) on delete cascade,
  is_allowed boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (dynamic_role_id, module_code, action_code)
);

create table if not exists public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  module_code text not null references public.permission_modules (code) on delete cascade,
  action_code text not null references public.permission_actions (code) on delete cascade,
  is_allowed boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (user_id, module_code, action_code)
);

-- ----------------------------------------------------------------------------
-- 4. Field-level permissions — same shape/priority as action permissions.
-- ----------------------------------------------------------------------------
create table if not exists public.role_field_permissions (
  id uuid primary key default gen_random_uuid(),
  dynamic_role_id uuid not null references public.dynamic_roles (id) on delete cascade,
  module_code text not null,
  field_code text not null,
  is_allowed boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (dynamic_role_id, module_code, field_code),
  foreign key (module_code, field_code) references public.permission_fields (module_code, field_code) on delete cascade
);

create table if not exists public.user_field_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  module_code text not null,
  field_code text not null,
  is_allowed boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (user_id, module_code, field_code),
  foreign key (module_code, field_code) references public.permission_fields (module_code, field_code) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 5. Triggers: updated_at + the EXISTING generic audit trigger (captures
--    who/what/when/old/new automatically — §22's exact requirement, no new
--    audit mechanism).
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'permission_modules', 'dynamic_roles', 'role_permissions', 'user_permission_overrides',
    'role_field_permissions', 'user_field_permission_overrides'
  ]) loop
    execute format('create trigger trg_%I_set_updated_at before update on public.%I for each row execute function public.set_updated_at();', t, t);
    execute format('create trigger trg_%I_audit after insert or update or delete on public.%I for each row execute function public.write_audit_log();', t, t);
  end loop;
  -- these three have no updated_at column (append-only / label rows) — audit only.
  for t in select unnest(array['permission_actions', 'permission_fields', 'user_dynamic_roles']) loop
    execute format('create trigger trg_%I_audit after insert or update or delete on public.%I for each row execute function public.write_audit_log();', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 6. RLS. Catalogs (modules/actions/fields) are readable by any authenticated
--    non-staff user (needed to render the management UI and to evaluate
--    permissions), Super-Admin-write. Role/override tables: Super Admin sees
--    and writes everything; a non-staff same-company user may READ their own
--    company's dynamic_roles/role_permissions (to render menus/actions) and
--    their OWN user_permission_overrides row set (never another user's).
-- ----------------------------------------------------------------------------
alter table public.permission_modules enable row level security;
alter table public.permission_actions enable row level security;
alter table public.permission_fields enable row level security;
alter table public.dynamic_roles enable row level security;
alter table public.user_dynamic_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.role_field_permissions enable row level security;
alter table public.user_field_permission_overrides enable row level security;

create policy "permission_modules_select" on public.permission_modules for select using (auth.uid() is not null);
create policy "permission_modules_write" on public.permission_modules for all using (is_super_admin()) with check (is_super_admin());
create policy "permission_actions_select" on public.permission_actions for select using (auth.uid() is not null);
create policy "permission_actions_write" on public.permission_actions for all using (is_super_admin()) with check (is_super_admin());
create policy "permission_fields_select" on public.permission_fields for select using (auth.uid() is not null);
create policy "permission_fields_write" on public.permission_fields for all using (is_super_admin()) with check (is_super_admin());

create policy "dynamic_roles_select" on public.dynamic_roles for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "dynamic_roles_write" on public.dynamic_roles for all using (is_super_admin()) with check (is_super_admin());

create policy "role_permissions_select" on public.role_permissions for select
  using (is_super_admin() or exists (
    select 1 from public.dynamic_roles r where r.id = dynamic_role_id
      and current_user_role() <> 'staff' and r.company_id = current_user_company_id()
  ));
create policy "role_permissions_write" on public.role_permissions for all using (is_super_admin()) with check (is_super_admin());

create policy "user_dynamic_roles_select" on public.user_dynamic_roles for select
  using (is_super_admin() or user_id = auth.uid());
create policy "user_dynamic_roles_write" on public.user_dynamic_roles for all using (is_super_admin()) with check (is_super_admin());

create policy "user_permission_overrides_select" on public.user_permission_overrides for select
  using (is_super_admin() or user_id = auth.uid());
create policy "user_permission_overrides_write" on public.user_permission_overrides for all using (is_super_admin()) with check (is_super_admin());

create policy "role_field_permissions_select" on public.role_field_permissions for select
  using (is_super_admin() or exists (
    select 1 from public.dynamic_roles r where r.id = dynamic_role_id
      and current_user_role() <> 'staff' and r.company_id = current_user_company_id()
  ));
create policy "role_field_permissions_write" on public.role_field_permissions for all using (is_super_admin()) with check (is_super_admin());

create policy "user_field_permission_overrides_select" on public.user_field_permission_overrides for select
  using (is_super_admin() or user_id = auth.uid());
create policy "user_field_permission_overrides_write" on public.user_field_permission_overrides for all using (is_super_admin()) with check (is_super_admin());

-- ----------------------------------------------------------------------------
-- 7. Seed catalogs — real modules matching this app's actual pages/routes and
--    the action verbs this task lists. Purely data; Super Admin can add more
--    via permission_upsert_module()/permission_upsert_action() below.
-- ----------------------------------------------------------------------------
insert into public.permission_actions (code, label, display_order) values
  ('VIEW','View',10), ('ADD','Add',20), ('CREATE','Create',30), ('EDIT','Edit',40), ('DELETE','Delete',50),
  ('APPROVE','Approve',60), ('REJECT','Reject',70), ('RECOMMEND','Recommend',80), ('PROCESS','Process',90),
  ('SEND_BACK','Send Back',100), ('HOLD','Hold',110), ('EXPORT','Export',120), ('DOWNLOAD','Download',130),
  ('UPLOAD','Upload',140), ('PRINT','Print',150), ('VIEW_HISTORY','View History',160),
  ('VIEW_SENSITIVE_DATA','View Sensitive Data',170), ('CHANGE','Change',180), ('SUBMIT','Submit',190),
  ('CANCEL','Cancel',200)
on conflict (code) do nothing;

insert into public.permission_modules (code, label, category, display_order) values
  ('employee', 'Employee', 'Employees', 10),
  ('employee_documents', 'Employee Documents', 'Employees', 20),
  ('exit_request', 'Exit Request', 'Employees', 30),
  ('employee_transfer', 'Employee Transfer', 'Employees', 40),
  ('attendance', 'Attendance', 'Attendance', 50),
  ('leave', 'Leave', 'Leave', 60),
  ('leave_approval', 'Leave Approval', 'Leave', 70),
  ('advance', 'Advance (Staff)', 'Advance', 80),
  ('advance_approval', 'Advance Approval', 'Advance', 90),
  ('hr_advance_processing', 'HR Advance Processing', 'Advance', 100),
  ('finance_advance_payment', 'Finance Advance Payment', 'Advance', 110),
  ('advance_recovery', 'Advance Recovery', 'Advance', 120),
  ('advance_management', 'Advance Management (Ledger)', 'Advance', 130),
  ('payroll', 'Payroll', 'Payroll', 140),
  ('reports', 'Reports', 'Reports', 150)
on conflict (code) do nothing;

insert into public.permission_fields (module_code, field_code, label, is_sensitive, display_order) values
  ('employee', 'full_name', 'Employee Name', false, 10),
  ('employee', 'mobile', 'Mobile', false, 20),
  ('employee', 'email', 'Email', false, 30),
  ('employee', 'joining_date', 'Joining Date', false, 40),
  ('employee', 'documents', 'Documents', false, 50),
  ('employee', 'salary', 'Salary', true, 60),
  ('employee', 'bank_account', 'Bank Account', true, 70),
  ('employee', 'pan', 'PAN', true, 80),
  ('employee', 'aadhaar', 'Aadhaar', true, 90)
on conflict (module_code, field_code) do nothing;

-- ----------------------------------------------------------------------------
-- 8. Effective-permission functions — the SINGLE source of truth every
--    consumer (frontend hook, future backend check) must call. Priority
--    (§17): Super Admin -> always allow. User override -> wins over role.
--    Role permission (via the user's assigned dynamic role) -> wins over
--    default. No configuration at all -> ALLOW (fail-open; see header).
-- ----------------------------------------------------------------------------
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
begin
  select role into v_role from public.profiles where id = p_user_id;
  if v_role = 'super_admin' then
    return true;
  end if;

  select is_allowed into v_override from public.user_permission_overrides
  where user_id = p_user_id and module_code = p_module_code and action_code = p_action_code;
  if v_override is not null then
    return v_override;
  end if;

  select rp.is_allowed into v_role_perm
  from public.user_dynamic_roles udr
  join public.dynamic_roles dr on dr.id = udr.dynamic_role_id and dr.is_active
  join public.role_permissions rp on rp.dynamic_role_id = dr.id
  where udr.user_id = p_user_id and rp.module_code = p_module_code and rp.action_code = p_action_code;
  if v_role_perm is not null then
    return v_role_perm;
  end if;

  return true; -- fail-open: nothing configured for this module/action/user
end;
$$;
grant execute on function public.has_dynamic_permission(uuid, text, text) to authenticated;

create or replace function public.has_field_permission(p_user_id uuid, p_module_code text, p_field_code text)
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

  select is_allowed into v_override from public.user_field_permission_overrides
  where user_id = p_user_id and module_code = p_module_code and field_code = p_field_code;
  if v_override is not null then
    return v_override;
  end if;

  select rfp.is_allowed into v_role_perm
  from public.user_dynamic_roles udr
  join public.dynamic_roles dr on dr.id = udr.dynamic_role_id and dr.is_active
  join public.role_field_permissions rfp on rfp.dynamic_role_id = dr.id
  where udr.user_id = p_user_id and rfp.module_code = p_module_code and rfp.field_code = p_field_code;
  if v_role_perm is not null then
    return v_role_perm;
  end if;

  return true;
end;
$$;
grant execute on function public.has_field_permission(uuid, text, text) to authenticated;

-- Convenience wrappers for the CURRENT caller (what the frontend actually calls).
create or replace function public.my_dynamic_permission(p_module_code text, p_action_code text)
returns boolean language sql stable security definer as $$
  select public.has_dynamic_permission(auth.uid(), p_module_code, p_action_code);
$$;
grant execute on function public.my_dynamic_permission(text, text) to authenticated;

create or replace function public.my_field_permission(p_module_code text, p_field_code text)
returns boolean language sql stable security definer as $$
  select public.has_field_permission(auth.uid(), p_module_code, p_field_code);
$$;
grant execute on function public.my_field_permission(text, text) to authenticated;

-- Bulk variant so the frontend can fetch every permission it needs in ONE call
-- (avoids N+1 round-trips when a page needs many action checks at once).
create or replace function public.my_permissions_bulk(p_module_codes text[] default null)
returns table (module_code text, action_code text, is_allowed boolean)
language plpgsql
stable
security definer
as $$
declare
  v_uid uuid := auth.uid();
begin
  return query
  select m.code, a.code, public.has_dynamic_permission(v_uid, m.code, a.code)
  from public.permission_modules m
  cross join public.permission_actions a
  where m.is_active and (p_module_codes is null or m.code = any(p_module_codes));
end;
$$;
grant execute on function public.my_permissions_bulk(text[]) to authenticated;

create or replace function public.my_field_permissions_bulk(p_module_code text)
returns table (field_code text, is_allowed boolean)
language plpgsql
stable
security definer
as $$
declare
  v_uid uuid := auth.uid();
begin
  return query
  select f.field_code, public.has_field_permission(v_uid, p_module_code, f.field_code)
  from public.permission_fields f
  where f.module_code = p_module_code;
end;
$$;
grant execute on function public.my_field_permissions_bulk(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Super-Admin management RPCs (all explicitly self-check is_super_admin()
--    — SECURITY DEFINER bypasses RLS, so this check is the real gate).
-- ----------------------------------------------------------------------------
create or replace function public.permission_upsert_module(p_code text, p_label text, p_category text default null, p_display_order int default 100)
returns public.permission_modules language plpgsql security definer as $$
declare v_row public.permission_modules;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.permission_modules (code, label, category, display_order, created_by, updated_by)
  values (p_code, p_label, p_category, p_display_order, auth.uid(), auth.uid())
  on conflict (code) do update set label = excluded.label, category = excluded.category, display_order = excluded.display_order, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_upsert_module(text, text, text, int) to authenticated;

create or replace function public.permission_create_role(p_company_id uuid, p_code text, p_name text, p_description text default null)
returns public.dynamic_roles language plpgsql security definer as $$
declare v_row public.dynamic_roles;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.dynamic_roles (company_id, code, name, description, created_by, updated_by)
  values (p_company_id, p_code, p_name, p_description, auth.uid(), auth.uid())
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_create_role(uuid, text, text, text) to authenticated;

create or replace function public.permission_set_role_status(p_role_id uuid, p_is_active boolean)
returns public.dynamic_roles language plpgsql security definer as $$
declare v_row public.dynamic_roles;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  update public.dynamic_roles set is_active = p_is_active, updated_by = auth.uid() where id = p_role_id returning * into v_row;
  if v_row.id is null then raise exception 'Role not found.'; end if;
  return v_row;
end; $$;
grant execute on function public.permission_set_role_status(uuid, boolean) to authenticated;

create or replace function public.permission_set_role_permission(p_role_id uuid, p_module_code text, p_action_code text, p_is_allowed boolean)
returns public.role_permissions language plpgsql security definer as $$
declare v_row public.role_permissions;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.role_permissions (dynamic_role_id, module_code, action_code, is_allowed, updated_by)
  values (p_role_id, p_module_code, p_action_code, p_is_allowed, auth.uid())
  on conflict (dynamic_role_id, module_code, action_code) do update set is_allowed = excluded.is_allowed, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_set_role_permission(uuid, text, text, boolean) to authenticated;

create or replace function public.permission_clear_role_permission(p_role_id uuid, p_module_code text, p_action_code text)
returns void language plpgsql security definer as $$
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  delete from public.role_permissions where dynamic_role_id = p_role_id and module_code = p_module_code and action_code = p_action_code;
end; $$;
grant execute on function public.permission_clear_role_permission(uuid, text, text) to authenticated;

create or replace function public.permission_set_role_field_permission(p_role_id uuid, p_module_code text, p_field_code text, p_is_allowed boolean)
returns public.role_field_permissions language plpgsql security definer as $$
declare v_row public.role_field_permissions;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.role_field_permissions (dynamic_role_id, module_code, field_code, is_allowed, updated_by)
  values (p_role_id, p_module_code, p_field_code, p_is_allowed, auth.uid())
  on conflict (dynamic_role_id, module_code, field_code) do update set is_allowed = excluded.is_allowed, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_set_role_field_permission(uuid, text, text, boolean) to authenticated;

create or replace function public.permission_set_user_dynamic_role(p_user_id uuid, p_role_id uuid)
returns public.user_dynamic_roles language plpgsql security definer as $$
declare v_row public.user_dynamic_roles;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if p_role_id is null then
    delete from public.user_dynamic_roles where user_id = p_user_id;
    return null;
  end if;
  insert into public.user_dynamic_roles (user_id, dynamic_role_id, assigned_by)
  values (p_user_id, p_role_id, auth.uid())
  on conflict (user_id) do update set dynamic_role_id = excluded.dynamic_role_id, assigned_by = auth.uid(), assigned_at = now()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_set_user_dynamic_role(uuid, uuid) to authenticated;

create or replace function public.permission_set_user_override(p_user_id uuid, p_module_code text, p_action_code text, p_is_allowed boolean)
returns public.user_permission_overrides language plpgsql security definer as $$
declare v_row public.user_permission_overrides;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.user_permission_overrides (user_id, module_code, action_code, is_allowed, updated_by)
  values (p_user_id, p_module_code, p_action_code, p_is_allowed, auth.uid())
  on conflict (user_id, module_code, action_code) do update set is_allowed = excluded.is_allowed, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_set_user_override(uuid, text, text, boolean) to authenticated;

create or replace function public.permission_clear_user_override(p_user_id uuid, p_module_code text, p_action_code text)
returns void language plpgsql security definer as $$
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  delete from public.user_permission_overrides where user_id = p_user_id and module_code = p_module_code and action_code = p_action_code;
end; $$;
grant execute on function public.permission_clear_user_override(uuid, text, text) to authenticated;

create or replace function public.permission_set_user_field_override(p_user_id uuid, p_module_code text, p_field_code text, p_is_allowed boolean)
returns public.user_field_permission_overrides language plpgsql security definer as $$
declare v_row public.user_field_permission_overrides;
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  insert into public.user_field_permission_overrides (user_id, module_code, field_code, is_allowed, updated_by)
  values (p_user_id, p_module_code, p_field_code, p_is_allowed, auth.uid())
  on conflict (user_id, module_code, field_code) do update set is_allowed = excluded.is_allowed, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.permission_set_user_field_override(uuid, text, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Read RPCs for the management UI.
-- ----------------------------------------------------------------------------
create or replace function public.permission_list_modules()
returns setof public.permission_modules language sql stable security definer as $$
  select * from public.permission_modules order by display_order, code;
$$;
grant execute on function public.permission_list_modules() to authenticated;

create or replace function public.permission_list_actions()
returns setof public.permission_actions language sql stable security definer as $$
  select * from public.permission_actions order by display_order, code;
$$;
grant execute on function public.permission_list_actions() to authenticated;

create or replace function public.permission_list_fields(p_module_code text)
returns setof public.permission_fields language sql stable security definer as $$
  select * from public.permission_fields where module_code = p_module_code order by display_order, field_code;
$$;
grant execute on function public.permission_list_fields(text) to authenticated;

create or replace function public.permission_list_roles(p_company_id uuid)
returns setof public.dynamic_roles language sql stable security definer as $$
  select * from public.dynamic_roles where company_id = p_company_id order by name;
$$;
grant execute on function public.permission_list_roles(uuid) to authenticated;

create or replace function public.permission_list_role_permissions(p_role_id uuid)
returns setof public.role_permissions language sql stable security definer as $$
  select * from public.role_permissions where dynamic_role_id = p_role_id;
$$;
grant execute on function public.permission_list_role_permissions(uuid) to authenticated;

create or replace function public.permission_list_role_field_permissions(p_role_id uuid)
returns setof public.role_field_permissions language sql stable security definer as $$
  select * from public.role_field_permissions where dynamic_role_id = p_role_id;
$$;
grant execute on function public.permission_list_role_field_permissions(uuid) to authenticated;

create or replace function public.permission_list_user_overrides(p_user_id uuid)
returns setof public.user_permission_overrides language sql stable security definer as $$
  select * from public.user_permission_overrides where user_id = p_user_id;
$$;
grant execute on function public.permission_list_user_overrides(uuid) to authenticated;

create or replace function public.permission_get_user_role(p_user_id uuid)
returns table (dynamic_role_id uuid, role_name text) language sql stable security definer as $$
  select dr.id, dr.name from public.user_dynamic_roles udr join public.dynamic_roles dr on dr.id = udr.dynamic_role_id where udr.user_id = p_user_id;
$$;
grant execute on function public.permission_get_user_role(uuid) to authenticated;

-- Permission Audit History (§22) — reuses the EXISTING generic audit_logs
-- table, no second audit mechanism.
create or replace function public.permission_audit_history(p_limit int default 100)
returns table (id uuid, table_name text, record_id uuid, action public.audit_action, changed_data jsonb, performed_by_name text, performed_at timestamptz)
language sql stable security definer as $$
  select l.id, l.table_name, l.record_id, l.action, l.changed_data, e.full_name, l.performed_at
  from public.audit_logs l
  left join public.employees e on e.auth_user_id = l.performed_by
  where l.table_name in ('permission_modules','dynamic_roles','role_permissions','user_permission_overrides',
                          'role_field_permissions','user_field_permission_overrides','user_dynamic_roles')
    and public.is_super_admin()
  order by l.performed_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;
grant execute on function public.permission_audit_history(int) to authenticated;
