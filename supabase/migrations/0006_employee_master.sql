-- ============================================================================
-- Retail HRMS — Phase 1 Part 2 (Employee Management Foundation)
-- Migration 0006: Extend `employees` with full HR fields
--
-- This ALTERs the existing `employees` table created in 0001_init_schema.sql.
-- No existing column is dropped or renamed, so every Phase 1 Part 1 query
-- (dashboard stats, organization tree employee counts) keeps working
-- unmodified. `is_active` is kept and is now auto-synced from the richer
-- `status` enum via trigger, purely for backward compatibility.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
create type public.employee_status as enum (
  'active', 'inactive', 'on_leave', 'notice_period', 'resigned', 'terminated', 'transferred'
);

create type public.employment_type as enum (
  'full_time', 'part_time', 'contract', 'intern', 'consultant'
);

create type public.salary_type as enum (
  'monthly', 'daily', 'hourly', 'piece_rate'
);

create type public.gender_type as enum (
  'male', 'female', 'other', 'prefer_not_to_say'
);

-- ---------------------------------------------------------------------------
-- ALTER employees — add HR fields
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists first_name text,
  add column if not exists middle_name text,
  add column if not exists last_name text,
  add column if not exists gender public.gender_type,
  add column if not exists date_of_birth date,
  add column if not exists blood_group text,
  add column if not exists mobile text,
  add column if not exists alternate_mobile text,
  add column if not exists photo_url text,
  add column if not exists store_team_id uuid references public.store_teams (id) on delete set null,
  add column if not exists store_department_id uuid references public.store_departments (id) on delete set null,
  add column if not exists reporting_manager_id uuid references public.employees (id) on delete set null,
  add column if not exists joining_date date,
  add column if not exists confirmation_date date,
  add column if not exists employment_type public.employment_type,
  add column if not exists salary_type public.salary_type,
  add column if not exists status public.employee_status not null default 'active';

comment on column public.employees.store_team_id is
  'Denormalized from store_designation_id via trg_employees_sync_org_hierarchy — never set directly by clients.';
comment on column public.employees.store_department_id is
  'Denormalized from store_designation_id via trg_employees_sync_org_hierarchy — never set directly by clients.';

create index if not exists idx_employees_store_team on public.employees (store_team_id);
create index if not exists idx_employees_store_department on public.employees (store_department_id);
create index if not exists idx_employees_reporting_manager on public.employees (reporting_manager_id);
create index if not exists idx_employees_status on public.employees (status);
create index if not exists idx_employees_joining_date on public.employees (joining_date);
create index if not exists idx_employees_full_name on public.employees using gin (to_tsvector('simple', full_name));

-- ---------------------------------------------------------------------------
-- Uniqueness — Employee Code and Email, scoped per company
-- ---------------------------------------------------------------------------
create unique index if not exists uidx_employees_company_code
  on public.employees (company_id, employee_code)
  where employee_code is not null;

create unique index if not exists uidx_employees_company_email
  on public.employees (company_id, lower(email))
  where email is not null;

-- ---------------------------------------------------------------------------
-- AUTO MAPPING
-- Whenever store_designation_id is set (directly, or via import), derive
-- store_department_id and store_team_id automatically from the existing
-- store organization structure. This is what lets Employee Import silently
-- auto-assign Store/Department/Designation without asking the user, per
-- spec — as long as the designation already exists in that store.
-- ---------------------------------------------------------------------------
create or replace function public.sync_employee_org_hierarchy()
returns trigger as $$
declare
  v_department_id uuid;
  v_team_id uuid;
begin
  if new.store_designation_id is not null then
    select sd.store_department_id, sdept.store_team_id
      into v_department_id, v_team_id
    from public.store_designations sd
    join public.store_departments sdept on sdept.id = sd.store_department_id
    where sd.id = new.store_designation_id;

    new.store_department_id := v_department_id;
    new.store_team_id := v_team_id;
  else
    new.store_department_id := null;
    new.store_team_id := null;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_employees_sync_org_hierarchy on public.employees;
create trigger trg_employees_sync_org_hierarchy
before insert or update of store_designation_id on public.employees
for each row execute function public.sync_employee_org_hierarchy();

-- ---------------------------------------------------------------------------
-- Keep legacy `is_active` boolean in sync with the new `status` enum so
-- Phase 1 Part 1 dashboard/org-tree queries (`.eq('is_active', true)`)
-- continue to return correct results without any code changes.
-- ---------------------------------------------------------------------------
create or replace function public.sync_employee_is_active()
returns trigger as $$
begin
  new.is_active := new.status in ('active', 'on_leave', 'notice_period');
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_employees_sync_is_active on public.employees;
create trigger trg_employees_sync_is_active
before insert or update of status on public.employees
for each row execute function public.sync_employee_is_active();
