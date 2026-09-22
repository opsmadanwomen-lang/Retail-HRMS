-- ============================================================================
-- Retail HRMS — Phase 1 Part 3 (Role Management Engine)
-- Migration 0009: Core schema
--
-- This is a RESPONSIBILITY management system, not a permission system.
-- An employee's existing Primary Designation (employees.store_designation_id,
-- from Phase 1 Part 1) is untouched. This migration adds an independent,
-- unlimited set of Additional Roles an employee can hold at the same time
-- inside their store — each one intended to later carry its own KPI,
-- Performance, Tasks, and Workflow (foundation only in this phase).
--
-- No existing table is modified. Only new tables are added.
-- ============================================================================

create type public.role_type as enum ('frontend', 'backend', 'both');

-- ---------------------------------------------------------------------------
-- ROLE CATEGORIES
-- Database-driven, like master_teams/master_departments — never hardcoded
-- in the UI.
-- ---------------------------------------------------------------------------
create table public.role_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- ---------------------------------------------------------------------------
-- ROLE STATUS (lookup table, not a hardcoded enum, per project convention)
-- Values: Active, Inactive, Temporary, Permanent — seeded in 0010.
-- ---------------------------------------------------------------------------
create table public.role_status (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  display_order int not null default 0,
  is_active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- ROLES (the Role Master)
-- company_id null = a system-provided default role, available to every
-- company (seeded in 0010). company_id set = a custom role created by that
-- company. department_id is optional — many roles (e.g. Fire Safety
-- Incharge) intentionally span the whole store rather than one department.
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  role_name text not null,
  role_code text not null,
  category_id uuid references public.role_categories (id) on delete set null,
  description text,
  role_type public.role_type not null default 'both',
  department_id uuid references public.master_departments (id) on delete set null,
  is_system_role boolean not null default false,
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_roles_company on public.roles (company_id);
create index idx_roles_category on public.roles (category_id);
create index idx_roles_department on public.roles (department_id);
create index idx_roles_is_active on public.roles (is_active);

-- role_code is unique among system roles, and unique per company among
-- that company's own custom roles.
create unique index uidx_roles_system_code
  on public.roles (role_code) where company_id is null;
create unique index uidx_roles_company_code
  on public.roles (company_id, role_code) where company_id is not null;

-- ---------------------------------------------------------------------------
-- EMPLOYEE ROLES (Additional Roles assignment — current state)
-- The employee's Primary Designation is NOT stored here; it remains on
-- employees.store_designation_id. This table is purely additive
-- responsibilities layered on top.
-- ---------------------------------------------------------------------------
create table public.employee_roles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  status_id uuid not null references public.role_status (id),
  effective_date date not null default current_date,
  end_date date,
  remarks text,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  removed_by uuid references public.profiles (id) on delete set null,
  removed_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_employee_roles_employee on public.employee_roles (employee_id);
create index idx_employee_roles_role on public.employee_roles (role_id);
create index idx_employee_roles_store on public.employee_roles (store_id);
create index idx_employee_roles_company on public.employee_roles (company_id);
create index idx_employee_roles_status on public.employee_roles (status_id);

-- Prevents assigning the same role to the same employee twice while a
-- prior assignment is still open (not yet removed). This is the
-- "no duplicate active role" rule from the spec.
create unique index uidx_employee_roles_open_assignment
  on public.employee_roles (employee_id, role_id)
  where removed_at is null;

create trigger trg_employee_roles_set_updated_at
  before update on public.employee_roles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- EMPLOYEE ROLE HISTORY
-- Full audit trail of every assignment, removal, and status change —
-- populated automatically by trigger so no application code can forget to
-- log it.
-- ---------------------------------------------------------------------------
create table public.employee_role_history (
  id uuid primary key default gen_random_uuid(),
  employee_role_id uuid not null references public.employee_roles (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  action text not null check (action in ('assigned', 'removed', 'status_changed')),
  status_id uuid references public.role_status (id),
  assigned_by uuid,
  assigned_date date,
  removed_by uuid,
  removed_date date,
  reason text,
  created_at timestamptz not null default now()
);

create index idx_employee_role_history_employee_role on public.employee_role_history (employee_role_id);
create index idx_employee_role_history_employee on public.employee_role_history (employee_id);
create index idx_employee_role_history_role on public.employee_role_history (role_id);
create index idx_employee_role_history_company on public.employee_role_history (company_id);

create or replace function public.log_employee_role_history()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.employee_role_history
      (employee_role_id, employee_id, role_id, store_id, company_id, action, status_id, assigned_by, assigned_date)
    values
      (new.id, new.employee_id, new.role_id, new.store_id, new.company_id, 'assigned', new.status_id, new.assigned_by, new.effective_date);
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.removed_at is not null and old.removed_at is null) then
      insert into public.employee_role_history
        (employee_role_id, employee_id, role_id, store_id, company_id, action, status_id, removed_by, removed_date, reason)
      values
        (new.id, new.employee_id, new.role_id, new.store_id, new.company_id, 'removed', new.status_id, new.removed_by, new.end_date, new.reason);
    elsif (new.status_id is distinct from old.status_id) then
      insert into public.employee_role_history
        (employee_role_id, employee_id, role_id, store_id, company_id, action, status_id)
      values
        (new.id, new.employee_id, new.role_id, new.store_id, new.company_id, 'status_changed', new.status_id);
    end if;
    return new;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger trg_employee_roles_history
  after insert or update on public.employee_roles
  for each row execute function public.log_employee_role_history();

-- ---------------------------------------------------------------------------
-- ROLE NOTES — free-text notes on a Role Master record
-- ---------------------------------------------------------------------------
create table public.role_notes (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  note text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index idx_role_notes_role on public.role_notes (role_id);

-- ---------------------------------------------------------------------------
-- FUTURE-READY FOUNDATION TABLES (structure only — not implemented/used yet)
-- ---------------------------------------------------------------------------
create table public.role_permissions_placeholder (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_key text,
  permission_value jsonb,
  created_at timestamptz not null default now()
);

create index idx_role_permissions_placeholder_role on public.role_permissions_placeholder (role_id);

create table public.future_role_kpi_mapping (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id) on delete cascade,
  kpi_key text,
  kpi_target numeric,
  weight numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_future_role_kpi_mapping_role on public.future_role_kpi_mapping (role_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers for the new master tables
-- ---------------------------------------------------------------------------
create trigger trg_role_categories_set_updated_at
  before update on public.role_categories
  for each row execute function public.set_updated_at();

create trigger trg_roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- AUDIT LOGGING — reuses the generic write_audit_log() trigger from 0004.
-- Covers Create/Update/Delete Role and Assign/Remove Role (an update that
-- sets removed_at is captured as an 'update' audit_logs row; the more
-- detailed assign/remove semantics live in employee_role_history above).
-- ---------------------------------------------------------------------------
create trigger trg_roles_audit
  after insert or update or delete on public.roles
  for each row execute function public.write_audit_log();

create trigger trg_employee_roles_audit
  after insert or update or delete on public.employee_roles
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.role_categories enable row level security;
alter table public.role_status enable row level security;
alter table public.roles enable row level security;
alter table public.employee_roles enable row level security;
alter table public.employee_role_history enable row level security;
alter table public.role_notes enable row level security;
alter table public.role_permissions_placeholder enable row level security;
alter table public.future_role_kpi_mapping enable row level security;

-- Global lookup tables: readable by any authenticated user, writable only
-- by super_admin — same pattern as master_teams/master_departments.
create policy "role_categories_select_all" on public.role_categories for select using (auth.role() = 'authenticated');
create policy "role_categories_write_super_admin" on public.role_categories for insert with check (public.is_super_admin());
create policy "role_categories_update_super_admin" on public.role_categories for update using (public.is_super_admin());
create policy "role_categories_delete_super_admin" on public.role_categories for delete using (public.is_super_admin());

create policy "role_status_select_all" on public.role_status for select using (auth.role() = 'authenticated');
create policy "role_status_write_super_admin" on public.role_status for insert with check (public.is_super_admin());
create policy "role_status_update_super_admin" on public.role_status for update using (public.is_super_admin());

-- Roles: visible if it's a system default (company_id null), or belongs to
-- the caller's own company, or the caller is super_admin. Company Admins
-- may create/update/delete only their own company's custom roles;
-- super_admin manages system roles.
create policy "roles_select_scoped"
  on public.roles for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());

create policy "roles_insert_scoped"
  on public.roles for insert
  with check (
    public.is_super_admin()
    or (company_id = public.current_user_company_id() and is_system_role = false)
  );

create policy "roles_update_scoped"
  on public.roles for update
  using (
    public.is_super_admin()
    or (company_id = public.current_user_company_id() and is_system_role = false)
  );

create policy "roles_delete_scoped"
  on public.roles for delete
  using (
    public.is_super_admin()
    or (company_id = public.current_user_company_id() and is_system_role = false)
  );

-- Employee Roles: scoped to company, same pattern as employees.
create policy "employee_roles_select_scoped"
  on public.employee_roles for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_roles_insert_scoped"
  on public.employee_roles for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_roles_update_scoped"
  on public.employee_roles for update
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_role_history_select_scoped"
  on public.employee_role_history for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "role_notes_select_scoped"
  on public.role_notes for select
  using (public.is_super_admin() or company_id is null or company_id = public.current_user_company_id());
create policy "role_notes_insert_scoped"
  on public.role_notes for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "role_notes_delete_scoped"
  on public.role_notes for delete
  using (public.is_super_admin() or company_id = public.current_user_company_id());

-- Placeholder/foundation tables: readable by any authenticated user (they
-- carry no company-sensitive data yet), writable only by super_admin until
-- the future KPI/Permission engines land.
create policy "role_permissions_placeholder_select_all"
  on public.role_permissions_placeholder for select using (auth.role() = 'authenticated');
create policy "role_permissions_placeholder_write_super_admin"
  on public.role_permissions_placeholder for insert with check (public.is_super_admin());

create policy "future_role_kpi_mapping_select_all"
  on public.future_role_kpi_mapping for select using (auth.role() = 'authenticated');
create policy "future_role_kpi_mapping_write_super_admin"
  on public.future_role_kpi_mapping for insert with check (public.is_super_admin());
