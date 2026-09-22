-- ============================================================================
-- Retail HRMS — Phase 1 Part 1
-- Migration 0001: Core schema foundation
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'company_admin');
create type public.store_status as enum ('active', 'inactive', 'onboarding', 'closed');
create type public.team_category as enum ('frontend', 'backend');
create type public.audit_action as enum ('insert', 'update', 'delete');

-- ---------------------------------------------------------------------------
-- COMPANIES
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  registration_number text,
  gst_number text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  country text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_companies_name on public.companies (name);
create index idx_companies_is_active on public.companies (is_active);

-- ---------------------------------------------------------------------------
-- PROFILES (extends auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  full_name text not null,
  email text not null,
  role public.app_role not null default 'company_admin',
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_profiles_company_id on public.profiles (company_id);
create index idx_profiles_role on public.profiles (role);

-- ---------------------------------------------------------------------------
-- MASTER ORGANIZATION TEMPLATE
-- (single global template copied into every new store)
-- ---------------------------------------------------------------------------
create table public.master_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category public.team_category not null,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.master_departments (
  id uuid primary key default gen_random_uuid(),
  master_team_id uuid not null references public.master_teams (id) on delete cascade,
  name text not null,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (master_team_id, name)
);

create index idx_master_departments_team_id on public.master_departments (master_team_id);

create table public.master_designations (
  id uuid primary key default gen_random_uuid(),
  master_department_id uuid not null references public.master_departments (id) on delete cascade,
  title text not null,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (master_department_id, title)
);

create index idx_master_designations_department_id on public.master_designations (master_department_id);

-- ---------------------------------------------------------------------------
-- STORES
-- ---------------------------------------------------------------------------
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  code text not null,
  store_type text,
  address text,
  city text,
  state text,
  country text,
  gst_number text,
  phone text,
  email text,
  status public.store_status not null default 'onboarding',
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (company_id, code)
);

create index idx_stores_company_id on public.stores (company_id);
create index idx_stores_status on public.stores (status);
create index idx_stores_code on public.stores (code);

-- ---------------------------------------------------------------------------
-- STORE ORGANIZATION STRUCTURE
-- (auto-populated copies of the master template, scoped per store)
-- ---------------------------------------------------------------------------
create table public.store_teams (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  master_team_id uuid references public.master_teams (id) on delete set null,
  name text not null,
  category public.team_category not null,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (store_id, name)
);

create index idx_store_teams_store_id on public.store_teams (store_id);

create table public.store_departments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  store_team_id uuid not null references public.store_teams (id) on delete cascade,
  master_department_id uuid references public.master_departments (id) on delete set null,
  name text not null,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (store_team_id, name)
);

create index idx_store_departments_store_id on public.store_departments (store_id);
create index idx_store_departments_team_id on public.store_departments (store_team_id);

create table public.store_designations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  store_department_id uuid not null references public.store_departments (id) on delete cascade,
  master_designation_id uuid references public.master_designations (id) on delete set null,
  title text not null,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (store_department_id, title)
);

create index idx_store_designations_store_id on public.store_designations (store_id);
create index idx_store_designations_department_id on public.store_designations (store_department_id);

-- ---------------------------------------------------------------------------
-- EMPLOYEES
-- (structure only for Phase 1 Part 1 — import/CRUD arrives in Part 2)
-- ---------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  store_designation_id uuid references public.store_designations (id) on delete set null,
  employee_code text,
  full_name text not null,
  email text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (store_id, employee_code)
);

create index idx_employees_company_id on public.employees (company_id);
create index idx_employees_store_id on public.employees (store_id);
create index idx_employees_designation_id on public.employees (store_designation_id);

-- ---------------------------------------------------------------------------
-- AUDIT LOGS
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action public.audit_action not null,
  changed_data jsonb,
  performed_by uuid,
  performed_at timestamptz not null default now()
);

create index idx_audit_logs_table_record on public.audit_logs (table_name, record_id);
create index idx_audit_logs_performed_by on public.audit_logs (performed_by);
create index idx_audit_logs_performed_at on public.audit_logs (performed_at);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper (generic, reused by every table below)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'companies', 'profiles', 'master_teams', 'master_departments', 'master_designations',
      'stores', 'store_teams', 'store_departments', 'store_designations', 'employees'
    ])
  loop
    execute format(
      'create trigger trg_%I_set_updated_at before update on public.%I
       for each row execute function public.set_updated_at();', t, t
    );
  end loop;
end $$;
