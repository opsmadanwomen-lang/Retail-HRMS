-- ============================================================================
-- Retail HRMS — Phase 1 Part 4 (KPI Management Engine)
-- Migration 0011: Core schema
--
-- This is the foundation for Performance, Promotion, Training, Appraisal,
-- Incentive, and a future AI Recommendation Engine — not just KPI tracking.
-- Chain: Company -> Store -> Employee -> Primary Designation -> Additional
-- Roles -> Role KPI -> Performance -> Overall Score -> Appraisal ->
-- Promotion -> Incentive. Only the KPI + Performance-summary layers are
-- implemented here; everything past "Overall Score" is schema-only
-- (future_performance_history) per spec.
--
-- No existing table is modified. Only new tables are added.
-- ============================================================================

create type public.kpi_calculation_type as enum ('manual', 'automatic', 'hybrid');
create type public.kpi_target_type as enum ('daily', 'weekly', 'monthly', 'quarterly', 'yearly');
create type public.kpi_measurement_unit as enum ('percentage', 'number', 'amount', 'hours', 'days', 'quantity', 'score', 'rating');
create type public.kpi_formula_type as enum (
  'greater_than_target', 'equal_to_target', 'less_than_target',
  'range_based', 'percentage_based', 'formula_based'
);
create type public.performance_cycle_type as enum ('monthly', 'quarterly', 'yearly', 'custom');
create type public.performance_cycle_status as enum ('draft', 'active', 'closed');
create type public.kpi_assignment_source as enum ('role', 'manual');

-- ---------------------------------------------------------------------------
-- KPI CATEGORIES — database-driven, same pattern as role_categories.
-- ---------------------------------------------------------------------------
create table public.kpi_categories (
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
-- KPI MASTER
-- company_id null = system default KPI available to every company, same
-- convention as roles.company_id.
-- ---------------------------------------------------------------------------
create table public.kpi_master (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  kpi_code text not null,
  kpi_name text not null,
  category_id uuid references public.kpi_categories (id) on delete set null,
  description text,
  calculation_type public.kpi_calculation_type not null default 'manual',
  target_type public.kpi_target_type not null default 'monthly',
  measurement_unit public.kpi_measurement_unit not null default 'percentage',
  data_source text not null default 'Manual Entry',
  formula_type public.kpi_formula_type not null default 'percentage_based',
  is_system_kpi boolean not null default false,
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_kpi_master_company on public.kpi_master (company_id);
create index idx_kpi_master_category on public.kpi_master (category_id);
create index idx_kpi_master_is_active on public.kpi_master (is_active);

create unique index uidx_kpi_master_system_code on public.kpi_master (kpi_code) where company_id is null;
create unique index uidx_kpi_master_company_code on public.kpi_master (company_id, kpi_code) where company_id is not null;

-- ---------------------------------------------------------------------------
-- ROLE KPI MAPPING (many-to-many: one Role -> many KPI, one KPI -> many Roles)
-- company_id is denormalized from the role for simple, consistent RLS
-- across this whole module (same reasoning as employee_roles.company_id).
-- ---------------------------------------------------------------------------
create table public.role_kpi_mapping (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id) on delete cascade,
  kpi_id uuid not null references public.kpi_master (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_role_kpi_mapping_role on public.role_kpi_mapping (role_id);
create index idx_role_kpi_mapping_kpi on public.role_kpi_mapping (kpi_id);
create index idx_role_kpi_mapping_company on public.role_kpi_mapping (company_id);

-- Partial (not plain) unique index: once a mapping is soft-removed
-- (is_active = false), the same KPI can be re-added to the role later.
create unique index uidx_role_kpi_mapping_open on public.role_kpi_mapping (role_id, kpi_id) where is_active = true;

-- ---------------------------------------------------------------------------
-- KPI WEIGHTAGE
-- Versioned separately from role_kpi_mapping so weightage changes over
-- time are tracked without touching the mapping itself. The "current"
-- weightage for a mapping is its most recent is_active row.
-- ---------------------------------------------------------------------------
create table public.kpi_weightage (
  id uuid primary key default gen_random_uuid(),
  role_kpi_mapping_id uuid not null references public.role_kpi_mapping (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  weightage numeric(5, 2) not null check (weightage >= 0 and weightage <= 100),
  effective_date date not null default current_date,
  expiry_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index idx_kpi_weightage_mapping on public.kpi_weightage (role_kpi_mapping_id);
create index idx_kpi_weightage_company on public.kpi_weightage (company_id);

-- Only one open (is_active) weightage per mapping at a time.
create unique index uidx_kpi_weightage_open on public.kpi_weightage (role_kpi_mapping_id) where is_active = true;

-- ---------------------------------------------------------------------------
-- EMPLOYEE KPI ASSIGNMENT
-- Materializes "Employee -> Assigned Role -> Assigned KPI". source='role'
-- means it was derived from an employee_roles / role_kpi_mapping pairing;
-- source='manual' means an admin assigned or excepted it directly.
-- ---------------------------------------------------------------------------
create table public.employee_kpi_assignment (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  kpi_id uuid not null references public.kpi_master (id) on delete cascade,
  role_id uuid references public.roles (id) on delete set null,
  store_id uuid not null references public.stores (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  source public.kpi_assignment_source not null default 'role',
  is_active boolean not null default true,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_employee_kpi_assignment_employee on public.employee_kpi_assignment (employee_id);
create index idx_employee_kpi_assignment_kpi on public.employee_kpi_assignment (kpi_id);
create index idx_employee_kpi_assignment_role on public.employee_kpi_assignment (role_id);
create index idx_employee_kpi_assignment_company on public.employee_kpi_assignment (company_id);

-- Prevent duplicate active KPI assignment for the same employee.
create unique index uidx_employee_kpi_assignment_open
  on public.employee_kpi_assignment (employee_id, kpi_id) where is_active = true;

-- ---------------------------------------------------------------------------
-- KPI TARGET
-- Flexible granularity: a target can be set at store, department, role,
-- and/or employee level. The most specific matching, currently-effective
-- row wins (resolved in the application layer).
-- ---------------------------------------------------------------------------
create table public.kpi_target (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references public.kpi_master (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  department_id uuid references public.master_departments (id) on delete set null,
  role_id uuid references public.roles (id) on delete set null,
  employee_id uuid references public.employees (id) on delete cascade,
  target_value numeric not null,
  effective_date date not null default current_date,
  expiry_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_kpi_target_kpi on public.kpi_target (kpi_id);
create index idx_kpi_target_company on public.kpi_target (company_id);
create index idx_kpi_target_store on public.kpi_target (store_id);
create index idx_kpi_target_role on public.kpi_target (role_id);
create index idx_kpi_target_employee on public.kpi_target (employee_id);

-- ---------------------------------------------------------------------------
-- KPI ACTUAL
-- Manual entry today; data_source carries the future integration name
-- (billing, attendance, inventory, POS, etc.) so no schema change is
-- needed when those integrations land.
-- ---------------------------------------------------------------------------
create table public.kpi_actual (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references public.kpi_master (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  actual_value numeric not null,
  data_source text not null default 'manual',
  notes text,
  entered_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_kpi_actual_kpi on public.kpi_actual (kpi_id);
create index idx_kpi_actual_employee on public.kpi_actual (employee_id);
create index idx_kpi_actual_company on public.kpi_actual (company_id);
create index idx_kpi_actual_period on public.kpi_actual (period_start, period_end);

-- ---------------------------------------------------------------------------
-- KPI SCORING RULES (Scoring Engine Foundation)
-- Multiple banded rows per KPI (e.g. range_based: 0-50% -> score 1,
-- 50-80% -> score 3, 80%+ -> score 5). formula is a placeholder for a
-- future formula-based engine; not evaluated by this phase.
-- ---------------------------------------------------------------------------
create table public.kpi_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references public.kpi_master (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  rule_type public.kpi_formula_type not null,
  min_value numeric,
  max_value numeric,
  score_value numeric,
  formula text,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index idx_kpi_scoring_rules_kpi on public.kpi_scoring_rules (kpi_id);
create index idx_kpi_scoring_rules_company on public.kpi_scoring_rules (company_id);

-- ---------------------------------------------------------------------------
-- PERFORMANCE CYCLE
-- ---------------------------------------------------------------------------
create table public.performance_cycle (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  name text not null,
  cycle_type public.performance_cycle_type not null default 'monthly',
  start_date date not null,
  end_date date not null,
  status public.performance_cycle_status not null default 'draft',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_performance_cycle_company on public.performance_cycle (company_id);
create index idx_performance_cycle_status on public.performance_cycle (status);

-- ---------------------------------------------------------------------------
-- PERFORMANCE RATING — configurable score bands, database-driven.
-- ---------------------------------------------------------------------------
create table public.performance_rating (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  min_score numeric not null,
  max_score numeric not null,
  color text,
  display_order int not null default 0,
  is_active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- KPI RESULT
-- One computed row per employee/KPI/cycle — the join of target + actual +
-- weightage + scoring. Written by the scoring engine foundation service,
-- not by end users directly.
-- ---------------------------------------------------------------------------
create table public.kpi_result (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  kpi_id uuid not null references public.kpi_master (id) on delete cascade,
  role_id uuid references public.roles (id) on delete set null,
  company_id uuid not null references public.companies (id) on delete cascade,
  performance_cycle_id uuid references public.performance_cycle (id) on delete cascade,
  target_value numeric,
  actual_value numeric,
  achievement_percentage numeric,
  score numeric,
  weightage numeric,
  weighted_score numeric,
  calculated_at timestamptz not null default now(),
  calculated_by uuid,
  created_at timestamptz not null default now(),
  unique (employee_id, kpi_id, performance_cycle_id)
);

create index idx_kpi_result_employee on public.kpi_result (employee_id);
create index idx_kpi_result_kpi on public.kpi_result (kpi_id);
create index idx_kpi_result_company on public.kpi_result (company_id);
create index idx_kpi_result_cycle on public.kpi_result (performance_cycle_id);

-- ---------------------------------------------------------------------------
-- PERFORMANCE SUMMARY
-- role_wise_scores is a jsonb snapshot (role name, role score, KPI count)
-- computed at calculation time — a Role Performance Card can render
-- straight from it without re-joining kpi_result each time.
-- ---------------------------------------------------------------------------
create table public.performance_summary (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  performance_cycle_id uuid not null references public.performance_cycle (id) on delete cascade,
  overall_score numeric,
  overall_rating_id uuid references public.performance_rating (id) on delete set null,
  role_wise_scores jsonb,
  calculated_at timestamptz not null default now(),
  calculated_by uuid,
  created_at timestamptz not null default now(),
  unique (employee_id, performance_cycle_id)
);

create index idx_performance_summary_employee on public.performance_summary (employee_id);
create index idx_performance_summary_company on public.performance_summary (company_id);
create index idx_performance_summary_cycle on public.performance_summary (performance_cycle_id);

-- ---------------------------------------------------------------------------
-- FUTURE-READY FOUNDATION TABLE (structure only — not implemented/used yet)
-- One append-only event log that a future Promotion / Training / Incentive
-- / Appraisal / AI Recommendation engine can read from, without needing
-- any new tables of its own to get started.
-- ---------------------------------------------------------------------------
create table public.future_performance_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  performance_cycle_id uuid references public.performance_cycle (id) on delete set null,
  event_type text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index idx_future_performance_history_employee on public.future_performance_history (employee_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger trg_kpi_categories_set_updated_at before update on public.kpi_categories for each row execute function public.set_updated_at();
create trigger trg_kpi_master_set_updated_at before update on public.kpi_master for each row execute function public.set_updated_at();
create trigger trg_role_kpi_mapping_set_updated_at before update on public.role_kpi_mapping for each row execute function public.set_updated_at();
create trigger trg_employee_kpi_assignment_set_updated_at before update on public.employee_kpi_assignment for each row execute function public.set_updated_at();
create trigger trg_kpi_target_set_updated_at before update on public.kpi_target for each row execute function public.set_updated_at();
create trigger trg_performance_cycle_set_updated_at before update on public.performance_cycle for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- AUDIT LOGGING — reuses the generic write_audit_log() trigger from 0004.
-- Covers Create/Update/Delete KPI, Assign KPI, Update Target, Update
-- Weightage exactly as required.
-- ---------------------------------------------------------------------------
create trigger trg_kpi_master_audit after insert or update or delete on public.kpi_master for each row execute function public.write_audit_log();
create trigger trg_role_kpi_mapping_audit after insert or update or delete on public.role_kpi_mapping for each row execute function public.write_audit_log();
create trigger trg_employee_kpi_assignment_audit after insert or update or delete on public.employee_kpi_assignment for each row execute function public.write_audit_log();
create trigger trg_kpi_weightage_audit after insert or update or delete on public.kpi_weightage for each row execute function public.write_audit_log();
create trigger trg_kpi_target_audit after insert or update or delete on public.kpi_target for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.kpi_categories enable row level security;
alter table public.kpi_master enable row level security;
alter table public.role_kpi_mapping enable row level security;
alter table public.kpi_weightage enable row level security;
alter table public.employee_kpi_assignment enable row level security;
alter table public.kpi_target enable row level security;
alter table public.kpi_actual enable row level security;
alter table public.kpi_scoring_rules enable row level security;
alter table public.performance_cycle enable row level security;
alter table public.performance_rating enable row level security;
alter table public.kpi_result enable row level security;
alter table public.performance_summary enable row level security;
alter table public.future_performance_history enable row level security;

-- Global lookup tables
create policy "kpi_categories_select_all" on public.kpi_categories for select using (auth.role() = 'authenticated');
create policy "kpi_categories_write_super_admin" on public.kpi_categories for insert with check (public.is_super_admin());
create policy "kpi_categories_update_super_admin" on public.kpi_categories for update using (public.is_super_admin());

create policy "performance_rating_select_all" on public.performance_rating for select using (auth.role() = 'authenticated');
create policy "performance_rating_write_super_admin" on public.performance_rating for insert with check (public.is_super_admin());
create policy "performance_rating_update_super_admin" on public.performance_rating for update using (public.is_super_admin());

-- KPI Master: system defaults visible to all, custom KPIs scoped to owner company.
create policy "kpi_master_select_scoped" on public.kpi_master for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "kpi_master_insert_scoped" on public.kpi_master for insert
  with check (public.is_super_admin() or (company_id = public.current_user_company_id() and is_system_kpi = false));
create policy "kpi_master_update_scoped" on public.kpi_master for update
  using (public.is_super_admin() or (company_id = public.current_user_company_id() and is_system_kpi = false));
create policy "kpi_master_delete_scoped" on public.kpi_master for delete
  using (public.is_super_admin() or (company_id = public.current_user_company_id() and is_system_kpi = false));

-- Role KPI Mapping / Weightage / Scoring Rules: scoped via denormalized company_id
-- (null = applies to a system role/KPI pairing, visible to everyone).
create policy "role_kpi_mapping_select_scoped" on public.role_kpi_mapping for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "role_kpi_mapping_write_scoped" on public.role_kpi_mapping for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "kpi_weightage_select_scoped" on public.kpi_weightage for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "kpi_weightage_write_scoped" on public.kpi_weightage for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "kpi_scoring_rules_select_scoped" on public.kpi_scoring_rules for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "kpi_scoring_rules_write_scoped" on public.kpi_scoring_rules for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

-- Company-scoped operational tables
create policy "employee_kpi_assignment_select_scoped" on public.employee_kpi_assignment for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "employee_kpi_assignment_write_scoped" on public.employee_kpi_assignment for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "kpi_target_select_scoped" on public.kpi_target for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "kpi_target_write_scoped" on public.kpi_target for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "kpi_actual_select_scoped" on public.kpi_actual for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "kpi_actual_write_scoped" on public.kpi_actual for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "performance_cycle_select_scoped" on public.performance_cycle for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "performance_cycle_write_scoped" on public.performance_cycle for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "kpi_result_select_scoped" on public.kpi_result for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "kpi_result_write_scoped" on public.kpi_result for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "performance_summary_select_scoped" on public.performance_summary for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "performance_summary_write_scoped" on public.performance_summary for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "future_performance_history_select_scoped" on public.future_performance_history for select
  using (public.is_super_admin() or employee_id in (
    select id from public.employees where company_id = public.current_user_company_id()
  ));
