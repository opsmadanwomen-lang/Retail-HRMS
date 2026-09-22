-- ============================================================================
-- Retail HRMS — Leave Management, Phase 1: Policy, Versioning, Policy-Type
-- Config, Policy Assignment
-- Migration 0090
--
-- POLICY VERSIONING (§5/§40): leave_policies is an append-only version chain
-- via previous_version_id (self-FK) -- an "active" policy is never edited in
-- place; a change creates a brand-new row pointing back at the version it
-- supersedes. Nothing ever recalculates a past record against a newer
-- version -- the ledger (Phase 2) will always stamp the financial_year_id +
-- policy_id it was actually computed under.
--
-- POLICY-TYPE CONFIG SPLIT (§7 vs §8/§9/§16/§17): leave_types (0089) holds
-- the STABLE identity of a leave type. leave_policy_type_configs holds the
-- VERSIONED numeric/rule values for that leave type WITHIN one specific
-- policy version -- accrual enabled, carry-forward limit/expiry, encashment/
-- lapse eligibility, negative-balance, probation eligibility. This is what
-- changes FY-to-FY per the approved plan's own example (3/month -> 4/month);
-- putting it here (not on leave_types) is what makes "historical policy must
-- never change" hold structurally, not just by convention.
--
-- POLICY ASSIGNMENT (§9/§14): modeled directly on the EXISTING
-- attendance_rule_assignments precedence pattern (see migrations 0038/0063)
-- -- an assignment row targets ONE scope dimension, and the resolver RPC
-- (migration 0092) walks a fixed, deterministic tier order, exactly like
-- resolve_attendance_rule() already does. Phase 1 implements the 6 scope
-- tiers that map onto structures that already exist in this project
-- (Employee, Store, Store Designation, Store Department, Employment Type,
-- Company-wide default). "Tenure slab" and "Custom Employee Group" scope
-- types from §9/§15 are deliberately DEFERRED -- no employee-group/tenure-
-- slab master data structure exists anywhere in this codebase to assign
-- against yet, and inventing one was not requested for Phase 1. The
-- scope_type CHECK constraint below only allows the 6 implemented values;
-- extending it to 'tenure'/'group' is a forward-compatible ALTER, not a
-- rebuild, whenever that master data exists.
-- ============================================================================

create table if not exists public.leave_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  financial_year_id uuid not null references public.leave_financial_years (id) on delete cascade,
  name text not null,
  code text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'active', 'closed', 'archived')),
  version_number int not null default 1,
  previous_version_id uuid references public.leave_policies (id) on delete set null,
  change_reason text,
  approved_by uuid,
  approved_at timestamptz,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code, version_number)
);

create index if not exists idx_leave_policies_company on public.leave_policies (company_id);
create index if not exists idx_leave_policies_fy on public.leave_policies (financial_year_id);

-- Only one 'active' policy per (company, code) family at a time -- the resolver only ever wants
-- the single currently-active version of a given named policy.
create unique index if not exists uidx_leave_policies_one_active_per_code
  on public.leave_policies (company_id, code) where status = 'active';

create table if not exists public.leave_policy_type_configs (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.leave_policies (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  accrual_enabled boolean not null default true,
  accrual_frequency text not null default 'monthly'
    check (accrual_frequency in ('monthly', 'quarterly', 'half_yearly', 'yearly', 'custom')),
  probation_eligible boolean not null default false,
  carry_forward_allowed boolean not null default false,
  -- null = unlimited (only meaningful when carry_forward_allowed = true).
  carry_forward_max_days numeric,
  carry_forward_expiry_type text not null default 'fy_end'
    check (carry_forward_expiry_type in ('no_expiry', 'months', 'specific_date', 'fy_end', 'custom')),
  -- Meaning depends on carry_forward_expiry_type: number of months when 'months', unused otherwise
  -- (specific_date/custom are recorded via remark/future columns once that phase is built).
  carry_forward_expiry_months int,
  encashment_allowed boolean not null default false,
  lapse_allowed boolean not null default false,
  negative_balance_allowed boolean not null default false,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, leave_type_id)
);

create index if not exists idx_leave_policy_type_configs_policy on public.leave_policy_type_configs (policy_id);
create index if not exists idx_leave_policy_type_configs_type on public.leave_policy_type_configs (leave_type_id);

create table if not exists public.leave_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  policy_id uuid not null references public.leave_policies (id) on delete cascade,
  scope_type text not null
    check (scope_type in ('employee', 'store', 'store_designation', 'store_department', 'employment_type', 'company')),
  -- Exactly one of these is populated, matching scope_type -- validated by the CHECK below rather
  -- than a single polymorphic column, so each still carries a real FK.
  employee_id uuid references public.employees (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  store_designation_id uuid references public.store_designations (id) on delete cascade,
  store_department_id uuid references public.store_departments (id) on delete cascade,
  employment_type text,
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'employee' and employee_id is not null and store_id is null and store_designation_id is null and store_department_id is null and employment_type is null)
    or (scope_type = 'store' and store_id is not null and employee_id is null and store_designation_id is null and store_department_id is null and employment_type is null)
    or (scope_type = 'store_designation' and store_designation_id is not null and employee_id is null and store_id is null and store_department_id is null and employment_type is null)
    or (scope_type = 'store_department' and store_department_id is not null and employee_id is null and store_id is null and store_designation_id is null and employment_type is null)
    or (scope_type = 'employment_type' and employment_type is not null and employee_id is null and store_id is null and store_designation_id is null and store_department_id is null)
    or (scope_type = 'company' and employee_id is null and store_id is null and store_designation_id is null and store_department_id is null and employment_type is null)
  )
);

create index if not exists idx_leave_policy_assignments_lookup
  on public.leave_policy_assignments (company_id, scope_type, effective_from, effective_to);
create index if not exists idx_leave_policy_assignments_employee on public.leave_policy_assignments (employee_id) where employee_id is not null;
create index if not exists idx_leave_policy_assignments_store on public.leave_policy_assignments (store_id) where store_id is not null;

alter table public.leave_policies enable row level security;
alter table public.leave_policy_type_configs enable row level security;
alter table public.leave_policy_assignments enable row level security;

create policy "leave_policies_select_scoped" on public.leave_policies for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "leave_policies_insert_scoped" on public.leave_policies for insert with check (is_super_admin());
create policy "leave_policies_update_scoped" on public.leave_policies for update using (is_super_admin());
create policy "leave_policies_delete_scoped" on public.leave_policies for delete using (is_super_admin());

create policy "leave_policy_type_configs_select_scoped" on public.leave_policy_type_configs for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and exists (
      select 1 from public.leave_policies p where p.id = policy_id and p.company_id = current_user_company_id()
    ))
  );
create policy "leave_policy_type_configs_insert_scoped" on public.leave_policy_type_configs for insert with check (is_super_admin());
create policy "leave_policy_type_configs_update_scoped" on public.leave_policy_type_configs for update using (is_super_admin());
create policy "leave_policy_type_configs_delete_scoped" on public.leave_policy_type_configs for delete using (is_super_admin());

create policy "leave_policy_assignments_select_scoped" on public.leave_policy_assignments for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "leave_policy_assignments_insert_scoped" on public.leave_policy_assignments for insert with check (is_super_admin());
create policy "leave_policy_assignments_update_scoped" on public.leave_policy_assignments for update using (is_super_admin());
create policy "leave_policy_assignments_delete_scoped" on public.leave_policy_assignments for delete using (is_super_admin());

create trigger trg_leave_policies_set_updated_at before update on public.leave_policies for each row execute function public.set_updated_at();
create trigger trg_leave_policies_audit after insert or update or delete on public.leave_policies for each row execute function public.write_audit_log();

create trigger trg_leave_policy_type_configs_set_updated_at before update on public.leave_policy_type_configs for each row execute function public.set_updated_at();
create trigger trg_leave_policy_type_configs_audit after insert or update or delete on public.leave_policy_type_configs for each row execute function public.write_audit_log();

create trigger trg_leave_policy_assignments_set_updated_at before update on public.leave_policy_assignments for each row execute function public.set_updated_at();
create trigger trg_leave_policy_assignments_audit after insert or update or delete on public.leave_policy_assignments for each row execute function public.write_audit_log();
