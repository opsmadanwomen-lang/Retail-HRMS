-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: Salary Components, Encashment
-- Rules, Prior Notice Rules — schema
-- Migration 0105
--
-- SCOPE DECISION (confirmed with the user before writing this): this project
-- has ZERO payroll/salary infrastructure of any kind (no Basic/DA columns,
-- no payroll tables, no payroll pages — confirmed by a full-codebase audit
-- before this migration was written). Leave Encashment cannot compute a real
-- amount without SOME real salary data, so `employee_salary_components`
-- below is the deliberately MINIMAL structure for that purpose only — NOT a
-- payroll system. No payslips, no tax/PF/ESI, no gross-salary breakdown
-- beyond what Encashment's own configured formula needs (Basic + DA today;
-- the schema leaves room for more components later without a redesign).
--
-- employee_salary_components: VERSIONED, effective-dated (mirrors the same
-- "historical calculations must never change" principle leave_policies
-- itself uses via version chains) — a salary change takes effect from a
-- date, and an Encashment computed against an earlier date must resolve the
-- salary that was actually in force then, forever, even after later raises.
--
-- leave_encashment_rules / leave_prior_notice_rules: one row per Leave
-- Policy (mirrors leave_short_long_rules' own one-row-per-policy pattern
-- exactly) — so both are automatically versioned for free via the EXISTING
-- leave_policies version chain (a new policy version can carry a changed
-- divisor/threshold/notice-days without touching history, exactly like
-- leave_short_long_rules already does for the day threshold).
-- ============================================================================

create table if not exists public.employee_salary_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  basic_salary numeric not null check (basic_salary >= 0),
  da numeric not null default 0 check (da >= 0),
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_salary_components_date_order check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_employee_salary_components_employee on public.employee_salary_components (employee_id, effective_from);

-- No two rows for the same employee may have overlapping [effective_from, effective_to) ranges —
-- enforced at the database level (not just application logic), using a range-overlap exclusion
-- constraint via daterange with an open-ended upper bound treated as 'infinity'.
create extension if not exists btree_gist;
alter table public.employee_salary_components
  add constraint employee_salary_components_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  );

alter table public.employee_salary_components enable row level security;

-- Salary is sensitive: Staff may see only their OWN record; any non-staff role (company_admin,
-- super_admin's own is_super_admin() clause) sees company-wide. Deliberately NOT extended to
-- Manager/Super Manager — Leave-approval authority does not imply salary visibility.
create policy "employee_salary_components_select_scoped" on public.employee_salary_components for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
  );
create policy "employee_salary_components_write_scoped" on public.employee_salary_components for insert with check (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "employee_salary_components_update_scoped" on public.employee_salary_components for update using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));

create trigger trg_employee_salary_components_audit after insert or update or delete on public.employee_salary_components for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- leave_encashment_rules — the configured Encashment FORMULA for a policy.
-- salary_base_type / threshold_base_type both list every option the Admin UI
-- must offer (§7.2/§8); only 'basic' and 'basic_da' are computable today
-- since only Basic+DA exist as real columns — selecting 'gross'/'gross_da'/
-- 'custom' before that data exists is rejected by the resolving RPC with a
-- clear error, never silently computed as zero.
-- ----------------------------------------------------------------------------
create table if not exists public.leave_encashment_rules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.leave_policies (id) on delete cascade,
  enabled boolean not null default false,
  salary_base_type text not null default 'basic_da' check (salary_base_type in ('basic', 'basic_da', 'gross', 'gross_da', 'custom')),
  divisor_type text not null default '26' check (divisor_type in ('26', '30', 'calendar_days', 'custom')),
  divisor_custom_value numeric check (divisor_custom_value is null or divisor_custom_value > 0),
  threshold_base_type text not null default 'basic' check (threshold_base_type in ('basic', 'basic_da', 'gross', 'gross_da', 'custom')),
  salary_threshold numeric check (salary_threshold is null or salary_threshold >= 0),
  threshold_comparison text not null default 'lt' check (threshold_comparison in ('lt', 'lte', 'gt', 'gte')),
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id)
);

alter table public.leave_encashment_rules enable row level security;
create policy "leave_encashment_rules_select_scoped" on public.leave_encashment_rules for select
  using (exists (select 1 from public.leave_policies p where p.id = policy_id and (is_super_admin() or p.company_id = current_user_company_id())));
create policy "leave_encashment_rules_write_scoped" on public.leave_encashment_rules for insert with check (is_super_admin());
create policy "leave_encashment_rules_update_scoped" on public.leave_encashment_rules for update using (is_super_admin());

create trigger trg_leave_encashment_rules_audit after insert or update or delete on public.leave_encashment_rules for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- leave_prior_notice_rules — one row per policy, exactly like leave_short_long_rules.
-- The 7-day default lives here as ordinary configuration data (seeded in a later
-- migration alongside the rest of the default policy seed), never in code.
-- ----------------------------------------------------------------------------
create table if not exists public.leave_prior_notice_rules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.leave_policies (id) on delete cascade,
  required boolean not null default false,
  notice_days int not null default 0 check (notice_days >= 0),
  exception_behavior text not null default 'allow_with_reason' check (exception_behavior in ('reject', 'hr_approval_required', 'special_approval_required', 'emergency_exception', 'allow_with_reason', 'custom')),
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id)
);

alter table public.leave_prior_notice_rules enable row level security;
create policy "leave_prior_notice_rules_select_scoped" on public.leave_prior_notice_rules for select
  using (exists (select 1 from public.leave_policies p where p.id = policy_id and (is_super_admin() or p.company_id = current_user_company_id())));
create policy "leave_prior_notice_rules_write_scoped" on public.leave_prior_notice_rules for insert with check (is_super_admin());
create policy "leave_prior_notice_rules_update_scoped" on public.leave_prior_notice_rules for update using (is_super_admin());

create trigger trg_leave_prior_notice_rules_audit after insert or update or delete on public.leave_prior_notice_rules for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- leave_prior_notice_exceptions — one row per application that needed an
-- exception (whether auto-allowed-with-reason, or routed through an
-- approval gate). Append-only in spirit: a decision (approved_by/approved_at/
-- decision) is written once by the resolving RPC and never edited afterward.
-- ----------------------------------------------------------------------------
create table if not exists public.leave_prior_notice_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  leave_application_id uuid references public.leave_applications (id) on delete set null,
  exception_behavior text not null check (exception_behavior in ('hr_approval_required', 'special_approval_required', 'emergency_exception', 'allow_with_reason', 'custom')),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_remark text,
  from_date date not null,
  to_date date not null,
  leave_type_id uuid not null references public.leave_types (id)
);

create index if not exists idx_leave_prior_notice_exceptions_employee on public.leave_prior_notice_exceptions (employee_id);

alter table public.leave_prior_notice_exceptions enable row level security;
create policy "leave_prior_notice_exceptions_select_scoped" on public.leave_prior_notice_exceptions for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
  );
create policy "leave_prior_notice_exceptions_insert_scoped" on public.leave_prior_notice_exceptions for insert with check (is_super_admin());
create policy "leave_prior_notice_exceptions_update_scoped" on public.leave_prior_notice_exceptions for update using (is_super_admin());

create trigger trg_leave_prior_notice_exceptions_audit after insert or update on public.leave_prior_notice_exceptions for each row execute function public.write_audit_log();
