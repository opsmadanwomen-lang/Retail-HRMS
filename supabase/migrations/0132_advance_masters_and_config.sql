-- ============================================================================
-- Retail HRMS — Advance Management, Phase 1 (part 1 of 2):
--   MASTERS + POLICY + CONFIGURATION + ROSTERS + RESOLVERS
-- Migration 0132
--
-- Follows the Phase 0 audit: reuses employees / employees.reporting_manager_id
-- / employee_salary_components (read only) / current_user_*() / is_super_admin()
-- / set_updated_at() / write_audit_log() / the generic `notifications` table.
-- NOTHING in Leave / Night Duty / Attendance / Payroll / Employee is modified.
-- No value is hard-coded — every business rule is a column on
-- advance_policy_configs / advance_final_approvers.
-- Enum-style columns are `text` + CHECK, matching the recent Leave migrations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. advance_types — configurable Advance Type master (per company).
-- ----------------------------------------------------------------------------
create table if not exists public.advance_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  requires_document boolean not null default false,
  allows_multiple boolean not null default false,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists idx_advance_types_company on public.advance_types (company_id, is_active);

-- ----------------------------------------------------------------------------
-- B. advance_policies — versioned (same principle as leave_policies).
-- ----------------------------------------------------------------------------
create table if not exists public.advance_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  code text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  version_number int not null default 1,
  previous_version_id uuid references public.advance_policies (id),
  effective_from date not null,
  effective_to date,
  change_reason text,
  approved_by uuid,
  approved_at timestamptz,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_advance_policies_company on public.advance_policies (company_id);
-- at most one active version per policy code per company
create unique index if not exists uidx_advance_policies_one_active
  on public.advance_policies (company_id, code) where status = 'active';

-- ----------------------------------------------------------------------------
-- C. advance_policy_configs — one row per policy; every §7/§40 knob.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_policy_configs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  policy_id uuid not null references public.advance_policies (id) on delete cascade,
  max_amount numeric check (max_amount is null or max_amount >= 0),
  max_pct_of_salary numeric check (max_pct_of_salary is null or (max_pct_of_salary >= 0 and max_pct_of_salary <= 1000)),
  min_service_months int not null default 0 check (min_service_months >= 0),
  max_active_advances int not null default 1 check (max_active_advances >= 1),
  max_installments int not null default 12 check (max_installments >= 1),
  min_installment_amount numeric check (min_installment_amount is null or min_installment_amount >= 0),
  allow_multiple_advances boolean not null default false,
  allow_early_settlement boolean not null default true,
  allow_partial_payment boolean not null default false,
  allow_partial_recovery boolean not null default true,
  manager_approval_required boolean not null default true,
  boss_final_approval_required boolean not null default true,
  boss_can_modify_amount boolean not null default true,
  boss_can_increase_amount boolean not null default false,
  max_boss_approval_limit numeric check (max_boss_approval_limit is null or max_boss_approval_limit >= 0),
  modification_reason_mandatory boolean not null default true,
  recovery_start_rule text not null default 'next_payroll' check (recovery_start_rule in ('next_payroll', 'same_payroll', 'manual')),
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id)
);
create index if not exists idx_advance_policy_configs_company on public.advance_policy_configs (company_id);

-- ----------------------------------------------------------------------------
-- D. advance_policy_assignments — 6-tier, same shape as leave_policy_assignments.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  policy_id uuid not null references public.advance_policies (id) on delete cascade,
  scope_type text not null check (scope_type in ('employee', 'store', 'store_designation', 'store_department', 'employment_type', 'company')),
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
  check (effective_to is null or effective_to >= effective_from),
  check (
    (scope_type = 'employee' and employee_id is not null) or
    (scope_type = 'store' and store_id is not null) or
    (scope_type = 'store_designation' and store_designation_id is not null) or
    (scope_type = 'store_department' and store_department_id is not null) or
    (scope_type = 'employment_type' and employment_type is not null) or
    (scope_type = 'company')
  )
);
create index if not exists idx_advance_policy_assignments_company on public.advance_policy_assignments (company_id, scope_type, is_active);

-- ----------------------------------------------------------------------------
-- E. advance_final_approvers — the configurable "Boss" roster. NOT
--    attendance_super_managers (which is untouched).
-- ----------------------------------------------------------------------------
create table if not exists public.advance_final_approvers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  is_active boolean not null default true,
  max_approval_limit numeric check (max_approval_limit is null or max_approval_limit >= 0),
  can_modify_amount boolean not null default true,
  can_increase_amount boolean not null default false,
  backup_approver_employee_id uuid references public.employees (id) on delete set null,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id)
);
create index if not exists idx_advance_final_approvers_company on public.advance_final_approvers (company_id, is_active);

-- ----------------------------------------------------------------------------
-- F/G. advance_hr_processors / advance_finance_processors — designation
--      rosters (no change to the shared app_role enum). Processors only —
--      they are NOT approvers.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_hr_processors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  is_active boolean not null default true,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id)
);
create index if not exists idx_advance_hr_processors_company on public.advance_hr_processors (company_id, is_active);

create table if not exists public.advance_finance_processors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  is_active boolean not null default true,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id)
);
create index if not exists idx_advance_finance_processors_company on public.advance_finance_processors (company_id, is_active);

-- ----------------------------------------------------------------------------
-- H. advance_notification_settings — per-company per-event channel config
--    (same shape as leave_notification_settings). Only in-app is delivered
--    today; the other channels are stored for a future dispatcher.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_notification_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  event_type text not null,
  in_app_enabled boolean not null default true,
  push_enabled boolean not null default false,
  email_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, event_type)
);

-- ----------------------------------------------------------------------------
-- Triggers (set_updated_at + write_audit_log) on every new table.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'advance_types', 'advance_policies', 'advance_policy_configs', 'advance_policy_assignments',
    'advance_final_approvers', 'advance_hr_processors', 'advance_finance_processors', 'advance_notification_settings'
  ]) loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('create trigger trg_%I_set_updated_at before update on public.%I for each row execute function public.set_updated_at();', t, t);
    execute format('create trigger trg_%I_audit after insert or update or delete on public.%I for each row execute function public.write_audit_log();', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- RLS. Config tables: Super Admin write; Super Admin + non-staff same-company
-- read. advance_types is additionally Staff-readable (own company) so the
-- Request Advance form can list types — mirrors leave_types (migration 0099).
-- ----------------------------------------------------------------------------
create policy "advance_types_select" on public.advance_types for select
  using (is_super_admin() or company_id = current_user_company_id());
create policy "advance_types_write" on public.advance_types for insert with check (is_super_admin());
create policy "advance_types_update" on public.advance_types for update using (is_super_admin());
create policy "advance_types_delete" on public.advance_types for delete using (is_super_admin());

do $$
declare t text;
begin
  for t in select unnest(array[
    'advance_policies', 'advance_policy_configs', 'advance_policy_assignments',
    'advance_final_approvers', 'advance_hr_processors', 'advance_finance_processors', 'advance_notification_settings'
  ]) loop
    execute format($f$create policy "%1$s_select" on public.%1$s for select
      using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$f$, t);
    execute format($f$create policy "%1$s_write"  on public.%1$s for insert with check (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_update" on public.%1$s for update using (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_delete" on public.%1$s for delete using (is_super_admin());$f$, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Resolvers & authority helpers (SECURITY DEFINER, own to the Advance module —
-- leave_resolve_direct_manager() is NOT touched).
-- ----------------------------------------------------------------------------

-- Reporting Manager = employees.reporting_manager_id, only when the manager is active.
create or replace function public.advance_resolve_direct_manager(p_employee_id uuid)
returns uuid
language sql
stable
security definer
as $$
  select m.id
  from public.employees e
  join public.employees m on m.id = e.reporting_manager_id
  where e.id = p_employee_id and m.status = 'active';
$$;
grant execute on function public.advance_resolve_direct_manager(uuid) to authenticated;

-- Is this employee currently anyone's Reporting Manager?
create or replace function public.advance_am_i_manager(p_employee_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (select 1 from public.employees e where e.reporting_manager_id = p_employee_id and e.status = 'active');
$$;
grant execute on function public.advance_am_i_manager(uuid) to authenticated;

-- Is this employee an active configured Boss (final approver) for their company?
create or replace function public.advance_am_i_boss(p_employee_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.advance_final_approvers fa
    join public.employees e on e.id = fa.employee_id
    where fa.employee_id = p_employee_id and fa.is_active and fa.company_id = e.company_id
  );
$$;
grant execute on function public.advance_am_i_boss(uuid) to authenticated;

create or replace function public.advance_am_i_hr(p_employee_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (select 1 from public.advance_hr_processors r where r.employee_id = p_employee_id and r.is_active);
$$;
grant execute on function public.advance_am_i_hr(uuid) to authenticated;

create or replace function public.advance_am_i_finance(p_employee_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (select 1 from public.advance_finance_processors r where r.employee_id = p_employee_id and r.is_active);
$$;
grant execute on function public.advance_am_i_finance(uuid) to authenticated;

-- Primary active Boss for a company (lowest created_at wins if several). Backup handled by the RPC.
create or replace function public.advance_resolve_final_approver(p_company_id uuid)
returns uuid
language sql
stable
security definer
as $$
  select fa.employee_id
  from public.advance_final_approvers fa
  join public.employees e on e.id = fa.employee_id and e.status = 'active'
  where fa.company_id = p_company_id and fa.is_active
  order by fa.created_at asc
  limit 1;
$$;
grant execute on function public.advance_resolve_final_approver(uuid) to authenticated;

-- 6-tier deterministic policy resolution (own implementation; mirrors the
-- structure of leave_resolve_policy_assignment but never calls it).
create or replace function public.advance_resolve_policy_assignment(
  p_company_id uuid,
  p_employee_id uuid,
  p_date date
)
returns uuid
language plpgsql
stable
security definer
as $$
declare
  v_emp record;
  v_policy_id uuid;
begin
  select store_id, store_designation_id, store_department_id, employment_type
  into v_emp from public.employees where id = p_employee_id;

  -- Tier 1: employee-specific
  select a.policy_id into v_policy_id
  from public.advance_policy_assignments a
  join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
  where a.company_id = p_company_id and a.scope_type = 'employee' and a.employee_id = p_employee_id
    and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
  order by a.effective_from desc limit 1;
  if v_policy_id is not null then return v_policy_id; end if;

  -- Tier 2: store
  if v_emp.store_id is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'store' and a.store_id = v_emp.store_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 3: store designation
  if v_emp.store_designation_id is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'store_designation' and a.store_designation_id = v_emp.store_designation_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 4: store department
  if v_emp.store_department_id is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'store_department' and a.store_department_id = v_emp.store_department_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 5: employment type
  if v_emp.employment_type is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'employment_type' and a.employment_type = v_emp.employment_type::text
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 6: company-wide default
  select a.policy_id into v_policy_id
  from public.advance_policy_assignments a
  join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
  where a.company_id = p_company_id and a.scope_type = 'company'
    and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
  order by a.effective_from desc limit 1;

  return v_policy_id;
end;
$$;
grant execute on function public.advance_resolve_policy_assignment(uuid, uuid, date) to authenticated;

-- Internal salary accessor — (Basic + DA) as of a date. NOT granted to
-- `authenticated`; only the other SECURITY DEFINER Advance functions (running
-- as the function owner) may call it. Raw salary is NEVER returned to a client
-- — the apply-context RPC returns only the COMPUTED maximum allowed amount.
create or replace function public.advance_resolve_salary_gross(p_employee_id uuid, p_as_of date)
returns numeric
language sql
stable
security definer
as $$
  select (coalesce(s.basic_salary, 0) + coalesce(s.da, 0))
  from public.employee_salary_components s
  where s.employee_id = p_employee_id
    and s.effective_from <= p_as_of
    and (s.effective_to is null or s.effective_to >= p_as_of)
  order by s.effective_from desc
  limit 1;
$$;
revoke execute on function public.advance_resolve_salary_gross(uuid, date) from public, authenticated;
