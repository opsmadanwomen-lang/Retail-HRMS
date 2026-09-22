-- ============================================================================
-- Retail HRMS — Phase 1 Part 6 (Performance Data Collection Engine)
-- Migration 0015: Core schema
--
-- This is a DATA COLLECTION layer only — it does not calculate performance.
-- Every future module (Attendance, Payroll, Leave, Performance Calculation,
-- Promotion, Training, Audit, Incentive, AI Analytics) reads from here.
--
-- Note on naming: `performance_cycles` (this migration) is a distinct table
-- from `performance_cycle` (singular, Phase 1 Part 4 / KPI engine). The KPI
-- engine's cycle drives performance_summary rollups; this engine's cycle
-- drives raw data-collection periods (Daily Entry, dashboards). They are
-- intentionally separate per this phase's explicit table list — see
-- DATABASE.md for the full distinction.
--
-- No existing table is modified. Only new tables are added.
-- ============================================================================

create type public.performance_cycle_grain as enum ('daily', 'weekly', 'monthly', 'quarterly', 'yearly');
create type public.metric_category as enum (
  'sales', 'billing', 'customer', 'operations', 'inventory', 'attendance',
  'task', 'checklist', 'audit', 'training', 'security', 'housekeeping',
  'maintenance', 'custom'
);
create type public.metric_calculation_type as enum ('manual', 'automatic', 'hybrid');
create type public.performance_entry_status as enum ('draft', 'submitted', 'approved', 'rejected', 'locked');
create type public.metric_approval_decision as enum ('approved', 'rejected');

-- ---------------------------------------------------------------------------
-- PERFORMANCE CYCLES (data-collection periods — Daily/Weekly/.../Yearly)
-- ---------------------------------------------------------------------------
create table public.performance_cycles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  name text not null,
  cycle_type public.performance_cycle_grain not null default 'daily',
  start_date date not null,
  end_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_performance_cycles_company on public.performance_cycles (company_id);

-- ---------------------------------------------------------------------------
-- PERFORMANCE DATA SOURCES — lookup table (Manual Entry, Bulk Entry, and the
-- future API/Billing/Attendance integrations), not hardcoded, same
-- convention as task_frequency / task_status / role_status.
-- ---------------------------------------------------------------------------
create table public.performance_data_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  is_automated boolean not null default false,
  display_order int not null default 0,
  is_active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- METRIC MASTER
-- ---------------------------------------------------------------------------
create table public.metric_master (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  metric_code text not null,
  metric_name text not null,
  category public.metric_category not null default 'custom',
  measurement_unit text not null default 'number',
  calculation_type public.metric_calculation_type not null default 'manual',
  is_system_metric boolean not null default false,
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_metric_master_company on public.metric_master (company_id);
create index idx_metric_master_category on public.metric_master (category);
create index idx_metric_master_is_active on public.metric_master (is_active);
create unique index uidx_metric_master_system_code on public.metric_master (metric_code) where company_id is null;
create unique index uidx_metric_master_company_code on public.metric_master (company_id, metric_code) where company_id is not null;

-- ---------------------------------------------------------------------------
-- METRIC MAPPING — Metric -> Role -> Department -> Store -> Employee(optional)
-- At least one of role/department/store/employee must be set; a mapping is
-- how a metric becomes "assignable" for a given scope.
-- ---------------------------------------------------------------------------
create table public.metric_mapping (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references public.metric_master (id) on delete cascade,
  role_id uuid references public.roles (id) on delete cascade,
  department_id uuid references public.master_departments (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  employee_id uuid references public.employees (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint chk_metric_mapping_has_scope check (
    role_id is not null or department_id is not null or store_id is not null or employee_id is not null
  )
);

create index idx_metric_mapping_metric on public.metric_mapping (metric_id);
create index idx_metric_mapping_role on public.metric_mapping (role_id);
create index idx_metric_mapping_department on public.metric_mapping (department_id);
create index idx_metric_mapping_store on public.metric_mapping (store_id);
create index idx_metric_mapping_employee on public.metric_mapping (employee_id);
create index idx_metric_mapping_company on public.metric_mapping (company_id);

-- ---------------------------------------------------------------------------
-- PERFORMANCE ENTRIES — the Daily Entry data itself.
-- ---------------------------------------------------------------------------
create table public.performance_entries (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references public.metric_master (id) on delete cascade,
  employee_id uuid references public.employees (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  department_id uuid references public.master_departments (id) on delete set null,
  role_id uuid references public.roles (id) on delete set null,
  company_id uuid not null references public.companies (id) on delete cascade,
  performance_cycle_id uuid references public.performance_cycles (id) on delete set null,
  source_id uuid references public.performance_data_sources (id) on delete set null,
  entry_date date not null,
  entry_value numeric not null,
  remarks text,
  status public.performance_entry_status not null default 'submitted',
  is_locked boolean not null default false,
  entered_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_performance_entries_metric on public.performance_entries (metric_id);
create index idx_performance_entries_employee on public.performance_entries (employee_id);
create index idx_performance_entries_store on public.performance_entries (store_id);
create index idx_performance_entries_department on public.performance_entries (department_id);
create index idx_performance_entries_role on public.performance_entries (role_id);
create index idx_performance_entries_company on public.performance_entries (company_id);
create index idx_performance_entries_cycle on public.performance_entries (performance_cycle_id);
create index idx_performance_entries_date on public.performance_entries (entry_date);
create index idx_performance_entries_status on public.performance_entries (status);

-- "No duplicate entry for same employee, metric and date." Store-level
-- entries (employee_id null) are not constrained the same way since a store
-- can legitimately have one store-wide value per metric per date instead —
-- covered by the second partial index below.
create unique index uidx_performance_entries_employee_unique
  on public.performance_entries (employee_id, metric_id, entry_date)
  where employee_id is not null;

create unique index uidx_performance_entries_store_unique
  on public.performance_entries (store_id, metric_id, entry_date)
  where employee_id is null;

-- ---------------------------------------------------------------------------
-- METRIC APPROVAL — Entry -> Verifier -> Approved -> Locked (foundation only).
-- ---------------------------------------------------------------------------
create table public.metric_approval (
  id uuid primary key default gen_random_uuid(),
  performance_entry_id uuid not null references public.performance_entries (id) on delete cascade,
  verifier_id uuid references public.profiles (id) on delete set null,
  decision public.metric_approval_decision not null,
  remarks text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_metric_approval_entry on public.metric_approval (performance_entry_id);

-- ---------------------------------------------------------------------------
-- METRIC COMMENTS
-- ---------------------------------------------------------------------------
create table public.metric_comments (
  id uuid primary key default gen_random_uuid(),
  performance_entry_id uuid not null references public.performance_entries (id) on delete cascade,
  comment text not null,
  commented_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_metric_comments_entry on public.metric_comments (performance_entry_id);

-- ---------------------------------------------------------------------------
-- METRIC HISTORY — full audit trail of entry edits, auto-populated by
-- trigger so "editing with audit history" always has a record, independent
-- of the generic audit_logs table.
-- ---------------------------------------------------------------------------
create table public.metric_history (
  id uuid primary key default gen_random_uuid(),
  performance_entry_id uuid not null references public.performance_entries (id) on delete cascade,
  action text not null check (action in ('created', 'updated', 'approved', 'rejected', 'locked')),
  old_value numeric,
  new_value numeric,
  performed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_metric_history_entry on public.metric_history (performance_entry_id);

create or replace function public.log_performance_entry_history()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.metric_history (performance_entry_id, action, new_value, performed_by)
    values (new.id, 'created', new.entry_value, new.entered_by);
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.entry_value is distinct from old.entry_value) then
      insert into public.metric_history (performance_entry_id, action, old_value, new_value, performed_by)
      values (new.id, 'updated', old.entry_value, new.entry_value, new.updated_by);
    end if;
    if (new.status = 'approved' and old.status is distinct from 'approved') then
      insert into public.metric_history (performance_entry_id, action, new_value, performed_by)
      values (new.id, 'approved', new.entry_value, new.updated_by);
    elsif (new.status = 'rejected' and old.status is distinct from 'rejected') then
      insert into public.metric_history (performance_entry_id, action, new_value, performed_by)
      values (new.id, 'rejected', new.entry_value, new.updated_by);
    end if;
    if (new.is_locked and not old.is_locked) then
      insert into public.metric_history (performance_entry_id, action, new_value, performed_by)
      values (new.id, 'locked', new.entry_value, new.updated_by);
    end if;
    return new;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger trg_performance_entries_history
  after insert or update on public.performance_entries
  for each row execute function public.log_performance_entry_history();

-- ---------------------------------------------------------------------------
-- METRIC TARGET / METRIC ACTUAL — flexible-grain foundation tables, mirroring
-- kpi_target / kpi_actual from Phase 1 Part 4 but generalized to any metric.
-- Schema only in this phase, per "Do NOT calculate performance."
-- ---------------------------------------------------------------------------
create table public.metric_target (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references public.metric_master (id) on delete cascade,
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

create index idx_metric_target_metric on public.metric_target (metric_id);
create index idx_metric_target_company on public.metric_target (company_id);
create index idx_metric_target_store on public.metric_target (store_id);
create index idx_metric_target_employee on public.metric_target (employee_id);

create table public.metric_actual (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references public.metric_master (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  department_id uuid references public.master_departments (id) on delete set null,
  role_id uuid references public.roles (id) on delete set null,
  employee_id uuid references public.employees (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  actual_value numeric not null,
  source_id uuid references public.performance_data_sources (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_metric_actual_metric on public.metric_actual (metric_id);
create index idx_metric_actual_company on public.metric_actual (company_id);
create index idx_metric_actual_period on public.metric_actual (period_start, period_end);

-- ---------------------------------------------------------------------------
-- ROLLUP / SUMMARY FOUNDATION TABLES — structure only, not populated by this
-- phase's application code (no "Performance Calculation" module here). A
-- future calculation engine writes to these; this phase only guarantees the
-- shape exists and is queryable.
-- ---------------------------------------------------------------------------
create table public.performance_daily_summary (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  metric_id uuid not null references public.metric_master (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  department_id uuid references public.master_departments (id) on delete set null,
  role_id uuid references public.roles (id) on delete set null,
  summary_date date not null,
  total_value numeric,
  entry_count integer not null default 0,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_performance_daily_summary_company on public.performance_daily_summary (company_id);
create index idx_performance_daily_summary_metric on public.performance_daily_summary (metric_id);
create index idx_performance_daily_summary_date on public.performance_daily_summary (summary_date);

create table public.performance_monthly_summary (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  metric_id uuid not null references public.metric_master (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  department_id uuid references public.master_departments (id) on delete set null,
  role_id uuid references public.roles (id) on delete set null,
  summary_month date not null,
  total_value numeric,
  entry_count integer not null default 0,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_performance_monthly_summary_company on public.performance_monthly_summary (company_id);
create index idx_performance_monthly_summary_metric on public.performance_monthly_summary (metric_id);
create index idx_performance_monthly_summary_month on public.performance_monthly_summary (summary_month);

create table public.employee_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  metric_id uuid not null references public.metric_master (id) on delete cascade,
  entry_date date not null,
  value numeric,
  created_at timestamptz not null default now(),
  unique (employee_id, metric_id, entry_date)
);

create index idx_employee_daily_metrics_employee on public.employee_daily_metrics (employee_id);
create index idx_employee_daily_metrics_metric on public.employee_daily_metrics (metric_id);

create table public.employee_role_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  metric_id uuid not null references public.metric_master (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  total_value numeric,
  entry_count integer not null default 0,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_employee_role_metrics_employee on public.employee_role_metrics (employee_id);
create index idx_employee_role_metrics_role on public.employee_role_metrics (role_id);

create table public.store_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  metric_id uuid not null references public.metric_master (id) on delete cascade,
  entry_date date not null,
  value numeric,
  created_at timestamptz not null default now(),
  unique (store_id, metric_id, entry_date)
);

create index idx_store_daily_metrics_store on public.store_daily_metrics (store_id);

create table public.department_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  department_id uuid not null references public.master_departments (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  metric_id uuid not null references public.metric_master (id) on delete cascade,
  entry_date date not null,
  value numeric,
  created_at timestamptz not null default now(),
  unique (department_id, store_id, metric_id, entry_date)
);

create index idx_department_daily_metrics_department on public.department_daily_metrics (department_id);

-- ---------------------------------------------------------------------------
-- FUTURE-READY FOUNDATION TABLE (structure only)
-- ---------------------------------------------------------------------------
create table public.future_ai_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  employee_id uuid references public.employees (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  metric_id uuid references public.metric_master (id) on delete cascade,
  event_type text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index idx_future_ai_metrics_employee on public.future_ai_metrics (employee_id);
create index idx_future_ai_metrics_company on public.future_ai_metrics (company_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger trg_performance_cycles_set_updated_at before update on public.performance_cycles for each row execute function public.set_updated_at();
create trigger trg_metric_master_set_updated_at before update on public.metric_master for each row execute function public.set_updated_at();
create trigger trg_metric_mapping_set_updated_at before update on public.metric_mapping for each row execute function public.set_updated_at();
create trigger trg_performance_entries_set_updated_at before update on public.performance_entries for each row execute function public.set_updated_at();
create trigger trg_metric_target_set_updated_at before update on public.metric_target for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- AUDIT LOGGING — reuses the generic write_audit_log() trigger from 0004.
-- Covers Create/Update/Delete Entry, Approve/Reject Entry.
-- ---------------------------------------------------------------------------
create trigger trg_metric_master_audit after insert or update or delete on public.metric_master for each row execute function public.write_audit_log();
create trigger trg_metric_mapping_audit after insert or update or delete on public.metric_mapping for each row execute function public.write_audit_log();
create trigger trg_performance_entries_audit after insert or update or delete on public.performance_entries for each row execute function public.write_audit_log();
create trigger trg_metric_approval_audit after insert on public.metric_approval for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.performance_cycles enable row level security;
alter table public.performance_data_sources enable row level security;
alter table public.metric_master enable row level security;
alter table public.metric_mapping enable row level security;
alter table public.performance_entries enable row level security;
alter table public.metric_approval enable row level security;
alter table public.metric_comments enable row level security;
alter table public.metric_history enable row level security;
alter table public.metric_target enable row level security;
alter table public.metric_actual enable row level security;
alter table public.performance_daily_summary enable row level security;
alter table public.performance_monthly_summary enable row level security;
alter table public.employee_daily_metrics enable row level security;
alter table public.employee_role_metrics enable row level security;
alter table public.store_daily_metrics enable row level security;
alter table public.department_daily_metrics enable row level security;
alter table public.future_ai_metrics enable row level security;

-- Global lookup tables
create policy "performance_cycles_select_scoped" on public.performance_cycles for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "performance_cycles_write_scoped" on public.performance_cycles for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "performance_data_sources_select_all" on public.performance_data_sources for select using (auth.role() = 'authenticated');
create policy "performance_data_sources_write_super_admin" on public.performance_data_sources for insert with check (public.is_super_admin());

-- Metric Master: system defaults visible to all, custom scoped to owner company.
create policy "metric_master_select_scoped" on public.metric_master for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "metric_master_write_scoped" on public.metric_master for all
  using (public.is_super_admin() or (company_id = public.current_user_company_id() and is_system_metric = false))
  with check (public.is_super_admin() or (company_id = public.current_user_company_id() and is_system_metric = false));

-- Company-scoped operational tables
create policy "metric_mapping_select_scoped" on public.metric_mapping for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "metric_mapping_write_scoped" on public.metric_mapping for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "performance_entries_select_scoped" on public.performance_entries for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "performance_entries_write_scoped" on public.performance_entries for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "metric_approval_select_scoped" on public.metric_approval for select
  using (
    public.is_super_admin() or performance_entry_id in (
      select id from public.performance_entries where company_id = public.current_user_company_id()
    )
  );
create policy "metric_approval_write_scoped" on public.metric_approval for insert
  with check (
    public.is_super_admin() or performance_entry_id in (
      select id from public.performance_entries where company_id = public.current_user_company_id()
    )
  );

create policy "metric_comments_select_scoped" on public.metric_comments for select
  using (
    public.is_super_admin() or performance_entry_id in (
      select id from public.performance_entries where company_id = public.current_user_company_id()
    )
  );
create policy "metric_comments_write_scoped" on public.metric_comments for insert
  with check (
    public.is_super_admin() or performance_entry_id in (
      select id from public.performance_entries where company_id = public.current_user_company_id()
    )
  );

create policy "metric_history_select_scoped" on public.metric_history for select
  using (
    public.is_super_admin() or performance_entry_id in (
      select id from public.performance_entries where company_id = public.current_user_company_id()
    )
  );

create policy "metric_target_select_scoped" on public.metric_target for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "metric_target_write_scoped" on public.metric_target for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "metric_actual_select_scoped" on public.metric_actual for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "metric_actual_write_scoped" on public.metric_actual for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "performance_daily_summary_select_scoped" on public.performance_daily_summary for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "performance_monthly_summary_select_scoped" on public.performance_monthly_summary for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "employee_daily_metrics_select_scoped" on public.employee_daily_metrics for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "employee_role_metrics_select_scoped" on public.employee_role_metrics for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "store_daily_metrics_select_scoped" on public.store_daily_metrics for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "department_daily_metrics_select_scoped" on public.department_daily_metrics for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "future_ai_metrics_select_scoped" on public.future_ai_metrics for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
