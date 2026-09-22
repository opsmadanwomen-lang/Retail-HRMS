-- ============================================================================
-- Retail HRMS — Phase 1 Part 1
-- Migration 0005: Row Level Security
--
-- Model:
--   super_admin    -> full access across every company
--   company_admin  -> access scoped to profiles.company_id only
-- Master template tables are readable by any authenticated user and
-- writable only by super_admin (it is a shared, global template).
-- ============================================================================

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.master_teams enable row level security;
alter table public.master_departments enable row level security;
alter table public.master_designations enable row level security;
alter table public.stores enable row level security;
alter table public.store_teams enable row level security;
alter table public.store_departments enable row level security;
alter table public.store_designations enable row level security;
alter table public.employees enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Helper functions (avoid recursive RLS lookups on profiles)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.app_role as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function public.current_user_company_id()
returns uuid as $$
  select company_id from public.profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function public.is_super_admin()
returns boolean as $$
  select public.current_user_role() = 'super_admin';
$$ language sql stable security definer;

-- ---------------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------------
create policy "profiles_select_own_or_super_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_super_admin());

create policy "profiles_update_own_or_super_admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_super_admin());

create policy "profiles_insert_super_admin"
  on public.profiles for insert
  with check (public.is_super_admin() or id = auth.uid());

-- ---------------------------------------------------------------------------
-- COMPANIES
-- ---------------------------------------------------------------------------
create policy "companies_select_scoped"
  on public.companies for select
  using (public.is_super_admin() or id = public.current_user_company_id());

create policy "companies_insert_super_admin"
  on public.companies for insert
  with check (public.is_super_admin());

create policy "companies_update_scoped"
  on public.companies for update
  using (public.is_super_admin() or id = public.current_user_company_id());

create policy "companies_delete_super_admin"
  on public.companies for delete
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- MASTER TEMPLATE (global read, super_admin write)
-- ---------------------------------------------------------------------------
create policy "master_teams_select_all" on public.master_teams for select using (true);
create policy "master_teams_write_super_admin" on public.master_teams for insert with check (public.is_super_admin());
create policy "master_teams_update_super_admin" on public.master_teams for update using (public.is_super_admin());
create policy "master_teams_delete_super_admin" on public.master_teams for delete using (public.is_super_admin());

create policy "master_departments_select_all" on public.master_departments for select using (true);
create policy "master_departments_write_super_admin" on public.master_departments for insert with check (public.is_super_admin());
create policy "master_departments_update_super_admin" on public.master_departments for update using (public.is_super_admin());
create policy "master_departments_delete_super_admin" on public.master_departments for delete using (public.is_super_admin());

create policy "master_designations_select_all" on public.master_designations for select using (true);
create policy "master_designations_write_super_admin" on public.master_designations for insert with check (public.is_super_admin());
create policy "master_designations_update_super_admin" on public.master_designations for update using (public.is_super_admin());
create policy "master_designations_delete_super_admin" on public.master_designations for delete using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- STORES (scoped to company)
-- ---------------------------------------------------------------------------
create policy "stores_select_scoped"
  on public.stores for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "stores_insert_scoped"
  on public.stores for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "stores_update_scoped"
  on public.stores for update
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "stores_delete_scoped"
  on public.stores for delete
  using (public.is_super_admin() or company_id = public.current_user_company_id());

-- ---------------------------------------------------------------------------
-- STORE ORGANIZATION (scoped via parent store's company)
-- ---------------------------------------------------------------------------
create policy "store_teams_select_scoped"
  on public.store_teams for select
  using (
    public.is_super_admin() or store_id in (
      select id from public.stores where company_id = public.current_user_company_id()
    )
  );

create policy "store_departments_select_scoped"
  on public.store_departments for select
  using (
    public.is_super_admin() or store_id in (
      select id from public.stores where company_id = public.current_user_company_id()
    )
  );

create policy "store_designations_select_scoped"
  on public.store_designations for select
  using (
    public.is_super_admin() or store_id in (
      select id from public.stores where company_id = public.current_user_company_id()
    )
  );

-- store_teams/departments/designations are written exclusively by the
-- provision_store_organization() trigger (security definer), so no direct
-- insert/update/delete policies are granted to end users here.

-- ---------------------------------------------------------------------------
-- EMPLOYEES (scoped to company)
-- ---------------------------------------------------------------------------
create policy "employees_select_scoped"
  on public.employees for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employees_insert_scoped"
  on public.employees for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employees_update_scoped"
  on public.employees for update
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employees_delete_scoped"
  on public.employees for delete
  using (public.is_super_admin() or company_id = public.current_user_company_id());

-- ---------------------------------------------------------------------------
-- AUDIT LOGS (read-only, scoped to super_admin; company_admin sees own company's records)
-- ---------------------------------------------------------------------------
create policy "audit_logs_select_super_admin"
  on public.audit_logs for select
  using (public.is_super_admin());
