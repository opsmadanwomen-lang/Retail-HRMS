-- ============================================================================
-- Retail HRMS — Phase 7: PAYROLL MASTER ENHANCEMENT & DEFERRED REQUIREMENTS
--   Employee exit date + exit-month proration · Grade / Category / Location
--   salary & policy assignment scopes · Store Calendar (working_days) · OT
--   standard-hours · per-component rounding + currency foundation · TDS engine
--   FOUNDATION (inert until the company supplies real tax rules).
-- Migration 0140
--
-- INSPECTION (2026-09-03): employees has NO leaving_date / grade / category
-- (only joining_date, confirmation_date, employment_type, status, store_id,
-- store_designation_id, store_department_id, store_team_id, employee_scope).
-- No employee_grades / employee_categories master. No payroll_policy_assignments
-- (leave_/advance_policy_assignments exist as the reference pattern). No
-- store_payroll_calendars (holidays + weekly_off_overrides + employee_weekly_
-- off_history exist). salary_structure_assignments scope_type =
-- employee/store_designation/store_department/store/employment_type/company.
-- salary_structure_components.rounding = none/nearest_rupee/round_2 only.
-- companies has no currency_code / currency_precision. No tds_* tables.
--
-- NOTHING INVENTED: every new rule ships NOT CONFIGURED / INACTIVE and reverts
-- to the exact Phase 6 behaviour when unset. No TDS rate, regime, slab, OT
-- rate, OT std-hours, proration divisor, weekly-off pattern, rounding mode or
-- statutory ceiling is assumed.
--
-- Reuses: current_user_*(), is_super_admin(), payroll_can_manage(),
-- write_audit_log(), set_updated_at(), payroll_eval_formula(),
-- salary_bifurcate(), salary_resolve_for_employee(), the Phase-4 advance
-- recovery bridge and the Phase-6 policy engine. No app_role change. Attendance
-- / Night Duty / Leave / Advance approval logic untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Multi-currency + rounding foundation (no FX — INR stays the default).
-- ----------------------------------------------------------------------------
alter table public.companies
  add column if not exists currency_code text not null default 'INR',
  add column if not exists currency_precision int not null default 2 check (currency_precision between 0 and 6);

-- shared rounding primitive — the ONLY place a rounding mode is interpreted.
create or replace function public.payroll_round(p_val numeric, p_mode text, p_precision int)
returns numeric
language sql
immutable
as $$
  select case
    when p_val is null then null
    when coalesce(p_mode, 'none') = 'none'    then p_val
    when p_mode = 'nearest' then round(p_val, coalesce(p_precision, 2))
    when p_mode = 'floor'   then floor(p_val * power(10, coalesce(p_precision, 2))) / power(10, coalesce(p_precision, 2))
    when p_mode = 'ceil'    then ceil (p_val * power(10, coalesce(p_precision, 2))) / power(10, coalesce(p_precision, 2))
    -- legacy Phase-5A tokens, mapped so an un-migrated component behaves as before
    when p_mode = 'round_2'       then round(p_val, 2)
    when p_mode = 'nearest_rupee' then round(p_val, 0)
    else p_val end;
$$;
grant execute on function public.payroll_round(numeric, text, int) to authenticated;

-- per-component rounding (optional; NULL => existing `rounding` column / structure default).
alter table public.salary_structure_components
  add column if not exists rounding_mode text check (rounding_mode is null or rounding_mode in ('none', 'nearest', 'floor', 'ceil')),
  add column if not exists rounding_precision int check (rounding_precision is null or rounding_precision between 0 and 6);
alter table public.payroll_salary_components
  add column if not exists rounding_mode text check (rounding_mode is null or rounding_mode in ('none', 'nearest', 'floor', 'ceil')),
  add column if not exists rounding_precision int check (rounding_precision is null or rounding_precision between 0 and 6);

-- ----------------------------------------------------------------------------
-- B. Grade / Category masters (company-scoped, minimal, NO seed values).
-- ----------------------------------------------------------------------------
create table if not exists public.employee_grades (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  display_order int not null default 100,
  is_active boolean not null default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create table if not exists public.employee_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  display_order int not null default 100,
  is_active boolean not null default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

-- ----------------------------------------------------------------------------
-- C. Employee exit + grade + category. leaving_date is the CANONICAL payroll
--    exit field (§4). exit_reason / exit_status are optional HR context.
-- ----------------------------------------------------------------------------
alter table public.employees
  add column if not exists leaving_date date,
  add column if not exists exit_reason text,
  add column if not exists exit_status text
    check (exit_status is null or exit_status in ('resigned', 'terminated', 'retired', 'absconded', 'contract_end', 'other')),
  add column if not exists grade_id uuid references public.employee_grades (id),
  add column if not exists category_id uuid references public.employee_categories (id);

alter table public.employees drop constraint if exists employees_leaving_after_joining;
alter table public.employees add constraint employees_leaving_after_joining
  check (leaving_date is null or joining_date is null or leaving_date >= joining_date);

create index if not exists idx_employees_grade on public.employees (grade_id) where grade_id is not null;
create index if not exists idx_employees_category on public.employees (category_id) where category_id is not null;
create index if not exists idx_employees_leaving on public.employees (company_id, leaving_date) where leaving_date is not null;

-- ----------------------------------------------------------------------------
-- D. Salary Structure assignment scopes — add grade / category / location.
--    (location == store: employees resolve to a store; no duplicate table.)
-- ----------------------------------------------------------------------------
alter table public.salary_structure_assignments
  add column if not exists grade_id uuid references public.employee_grades (id) on delete cascade,
  add column if not exists category_id uuid references public.employee_categories (id) on delete cascade;

alter table public.salary_structure_assignments drop constraint if exists salary_structure_assignments_scope_type_check;
alter table public.salary_structure_assignments add constraint salary_structure_assignments_scope_type_check
  check (scope_type in ('employee', 'grade', 'category', 'location', 'store_designation', 'store_department', 'store', 'employment_type', 'company'));

alter table public.salary_structure_assignments drop constraint if exists salary_structure_assignments_check;
alter table public.salary_structure_assignments drop constraint if exists salary_structure_assignments_check1;
alter table public.salary_structure_assignments add constraint salary_structure_assignments_scope_consistency check (
  (scope_type = 'employee' and employee_id is not null) or
  (scope_type = 'grade' and grade_id is not null) or
  (scope_type = 'category' and category_id is not null) or
  (scope_type in ('location', 'store') and store_id is not null) or
  (scope_type = 'store_designation' and store_designation_id is not null) or
  (scope_type = 'store_department' and store_department_id is not null) or
  (scope_type = 'employment_type' and employment_type is not null) or
  (scope_type = 'company')
);

-- ----------------------------------------------------------------------------
-- E. exit_date_payable — a Payroll Policy setting. NULL = UNRESOLVED (§12): the
--    business must confirm whether the leaving date itself is a paid day.
-- ----------------------------------------------------------------------------
alter table public.payroll_policies
  add column if not exists exit_date_payable boolean;   -- NULL = not confirmed

-- ----------------------------------------------------------------------------
-- F. Payroll Policy assignment scopes + change history (mirrors the
--    salary_structure_assignments pattern — NOT a new policy master).
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_policy_id uuid not null references public.payroll_policies (id) on delete cascade,
  scope_type text not null check (scope_type in ('employee', 'grade', 'category', 'location', 'store_designation', 'store_department', 'store', 'employment_type', 'company')),
  employee_id uuid references public.employees (id) on delete cascade,
  grade_id uuid references public.employee_grades (id) on delete cascade,
  category_id uuid references public.employee_categories (id) on delete cascade,
  store_designation_id uuid references public.store_designations (id) on delete cascade,
  store_department_id uuid references public.store_departments (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  employment_type text,
  effective_from date not null default current_date,
  effective_to date,
  priority int not null default 100,
  is_active boolean not null default true,
  remark text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'employee' and employee_id is not null) or
    (scope_type = 'grade' and grade_id is not null) or
    (scope_type = 'category' and category_id is not null) or
    (scope_type in ('location', 'store') and store_id is not null) or
    (scope_type = 'store_designation' and store_designation_id is not null) or
    (scope_type = 'store_department' and store_department_id is not null) or
    (scope_type = 'employment_type' and employment_type is not null) or
    (scope_type = 'company')
  ),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_payroll_policy_assignments_company on public.payroll_policy_assignments (company_id, scope_type, is_active);

create table if not exists public.payroll_policy_change_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  old_policy_id uuid references public.payroll_policies (id),
  new_policy_id uuid references public.payroll_policies (id),
  effective_from date not null,
  effective_to date,
  reason text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists idx_payroll_policy_change_history_emp on public.payroll_policy_change_history (employee_id, effective_from desc);

-- ----------------------------------------------------------------------------
-- G. Store Payroll Calendar — effective-dated weekly-off + holiday source for
--    working_days_method = 'store_calendar'. Reuses the existing `holidays`
--    master; does not touch Leave holiday behaviour.
-- ----------------------------------------------------------------------------
create table if not exists public.store_payroll_calendars (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,   -- null => company-wide default
  name text not null,
  effective_from date not null default current_date,
  effective_to date,
  weekly_off_days int[] not null default '{0}',                    -- 0=Sun .. 6=Sat (no pattern assumed beyond this)
  alternate_saturday_off boolean not null default false,
  alternate_saturday_reference date,                               -- an anchor Saturday that IS off (parity)
  holiday_source text not null default 'company_holidays' check (holiday_source in ('company_holidays', 'none')),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  remark text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (weekly_off_days <@ array[0,1,2,3,4,5,6])
);
create index if not exists idx_store_payroll_calendars_lookup on public.store_payroll_calendars (company_id, store_id, status, effective_from);

-- ----------------------------------------------------------------------------
-- H. TDS engine FOUNDATION. Every table ships empty; nothing computes until a
--    company supplies a regime + slabs + an annualization method (§37-45).
-- ----------------------------------------------------------------------------
create table if not exists public.tds_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  code text not null,
  version_no int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive', 'archived')),
  tax_regime text,                       -- NULL = not supplied (no 'old'/'new' assumed)
  financial_year_start date,
  financial_year_end date,
  annualization_method text check (annualization_method is null or annualization_method in ('project_current_x_remaining', 'flat_x12', 'ytd_plus_projected')),  -- NULL = UNRESOLVED
  standard_deduction numeric check (standard_deduction is null or standard_deduction >= 0),
  rebate_limit numeric check (rebate_limit is null or rebate_limit >= 0),
  rebate_amount numeric check (rebate_amount is null or rebate_amount >= 0),
  cess_pct numeric check (cess_pct is null or cess_pct >= 0),
  surcharge_config jsonb,
  effective_from date not null default current_date,
  effective_to date,
  previous_policy_id uuid references public.tds_policies (id),
  remark text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code, version_no),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_tds_policies_company on public.tds_policies (company_id, status, effective_from);

create table if not exists public.tds_slabs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  tds_policy_id uuid not null references public.tds_policies (id) on delete cascade,
  min_income numeric not null check (min_income >= 0),
  max_income numeric check (max_income is null or max_income >= min_income),
  rate numeric not null check (rate >= 0),
  fixed_component numeric not null default 0 check (fixed_component >= 0),
  label text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tds_slabs_policy on public.tds_slabs (tds_policy_id, min_income);

create table if not exists public.tds_employee_declarations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  tds_policy_id uuid references public.tds_policies (id),
  financial_year_start date not null,
  investment_declared numeric not null default 0 check (investment_declared >= 0),
  other_exemptions numeric not null default 0 check (other_exemptions >= 0),
  other_income numeric not null default 0,
  previous_employer_income numeric not null default 0 check (previous_employer_income >= 0),
  previous_employer_tds numeric not null default 0 check (previous_employer_tds >= 0),
  house_rent_paid numeric not null default 0 check (house_rent_paid >= 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'verified')),
  declared_by uuid, verified_by uuid,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, financial_year_start)
);

create table if not exists public.tds_calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_employee_result_id uuid not null references public.payroll_employee_results (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  tds_policy_id uuid references public.tds_policies (id),
  tds_policy_version int,
  tax_regime text,
  annual_projected_income numeric,
  taxable_income numeric,
  applicable_slab_id uuid references public.tds_slabs (id),
  slab_rate numeric,
  computed_tax numeric,
  rebate numeric,
  cess numeric,
  final_annual_tds numeric,
  monthly_tds numeric,
  snapshot jsonb,
  computed_at timestamptz not null default now(),
  unique (payroll_employee_result_id)
);

-- ----------------------------------------------------------------------------
-- I. Payroll result snapshot columns (auditability §30 / §44 / §64).
-- ----------------------------------------------------------------------------
alter table public.payroll_employee_results
  add column if not exists store_calendar_id uuid references public.store_payroll_calendars (id),
  add column if not exists store_calendar_snapshot jsonb,
  add column if not exists exit_proration_amount numeric not null default 0,
  add column if not exists eligible_days numeric,
  add column if not exists salary_structure_scope text,
  add column if not exists payroll_policy_scope text,
  add column if not exists leaving_date_snapshot date;

-- ----------------------------------------------------------------------------
-- RLS + triggers for every new table.
-- ----------------------------------------------------------------------------
do $rls$
declare t text;
begin
  for t in select unnest(array[
    'employee_grades','employee_categories','payroll_policy_assignments','store_payroll_calendars',
    'tds_policies','tds_employee_declarations']) loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('create trigger trg_%1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at();', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function public.write_audit_log();', t);
    execute format($f$create policy "%1$s_select" on public.%1$s for select
      using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$f$, t);
    execute format($f$create policy "%1$s_write"  on public.%1$s for insert with check (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_update" on public.%1$s for update using (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_delete" on public.%1$s for delete using (is_super_admin());$f$, t);
  end loop;
end $rls$;

alter table public.payroll_policy_change_history enable row level security;
create trigger trg_payroll_policy_change_history_audit after insert or update or delete on public.payroll_policy_change_history for each row execute function public.write_audit_log();
create policy "payroll_policy_change_history_select" on public.payroll_policy_change_history for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()) or employee_id = current_user_employee_id());
create policy "payroll_policy_change_history_write" on public.payroll_policy_change_history for insert with check (is_super_admin());

alter table public.tds_calculations enable row level security;
create trigger trg_tds_calculations_audit after insert or update or delete on public.tds_calculations for each row execute function public.write_audit_log();
create policy "tds_calculations_select" on public.tds_calculations for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()) or employee_id = current_user_employee_id());
create policy "tds_calculations_write" on public.tds_calculations for insert with check (is_super_admin());

-- tds_slabs is a child of tds_policies — same company-scoped policy
alter table public.tds_slabs enable row level security;
create trigger trg_tds_slabs_set_updated_at before update on public.tds_slabs for each row execute function public.set_updated_at();
create trigger trg_tds_slabs_audit after insert or update or delete on public.tds_slabs for each row execute function public.write_audit_log();
create policy "tds_slabs_select" on public.tds_slabs for select using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "tds_slabs_write"  on public.tds_slabs for insert with check (is_super_admin());
create policy "tds_slabs_update" on public.tds_slabs for update using (is_super_admin());
create policy "tds_slabs_delete" on public.tds_slabs for delete using (is_super_admin());

-- tds_employee_declarations additionally readable by the owning employee
create policy "tds_employee_declarations_own" on public.tds_employee_declarations for select using (employee_id = current_user_employee_id());


-- ============================================================================
-- J. Store Calendar â€” working-days engine (Â§24-30).
-- ============================================================================
create or replace function public.payroll_resolve_store_calendar(p_company_id uuid, p_store_id uuid, p_as_of date)
returns public.store_payroll_calendars
language plpgsql
stable
security definer
as $$
declare v_cal public.store_payroll_calendars;
begin
  -- store-specific active calendar covering the date, else company-wide (store_id null)
  select * into v_cal from public.store_payroll_calendars
  where company_id = p_company_id and status = 'active'
    and (store_id = p_store_id or store_id is null)
    and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by (store_id is not null) desc, effective_from desc limit 1;
  return v_cal;
end;
$$;
grant execute on function public.payroll_resolve_store_calendar(uuid, uuid, date) to authenticated;

create or replace function public.payroll_calendar_working_days(p_calendar_id uuid, p_start date, p_end date)
returns int
language plpgsql
stable
security definer
as $$
declare
  v_cal public.store_payroll_calendars;
  v_d date;
  v_count int := 0;
  v_dow int;
  v_is_off boolean;
begin
  select * into v_cal from public.store_payroll_calendars where id = p_calendar_id;
  if v_cal.id is null then return null; end if;

  v_d := p_start;
  while v_d <= p_end loop
    v_dow := extract(dow from v_d)::int;   -- 0=Sun .. 6=Sat
    v_is_off := v_dow = any(v_cal.weekly_off_days);

    if not v_is_off and v_cal.alternate_saturday_off and v_dow = 6 and v_cal.alternate_saturday_reference is not null then
      -- same fortnightly parity as the reference Saturday => that Saturday is off
      if (abs(v_d - v_cal.alternate_saturday_reference) / 7) % 2 = 0 then v_is_off := true; end if;
    end if;

    if not v_is_off and v_cal.holiday_source = 'company_holidays' then
      if exists (select 1 from public.holidays h
                 where h.company_id = v_cal.company_id
                   and (h.store_id = v_cal.store_id or h.store_id is null)
                   and h.holiday_date = v_d) then
        v_is_off := true;
      end if;
    end if;

    if not v_is_off then v_count := v_count + 1; end if;
    v_d := v_d + 1;
  end loop;
  return v_count;
end;
$$;
grant execute on function public.payroll_calendar_working_days(uuid, date, date) to authenticated;

-- ============================================================================
-- K. Salary Structure resolution â€” add grade / category / location tiers.
--    Tier order (documented, deterministic): employee > grade > category >
--    store_designation > store_department > location/store > employment_type >
--    company. Within a tier the LOWEST `priority` number wins; two rows tied at
--    the same tier+priority => STOP ("Multiple applicable salary structures
--    found.") (Â§19/Â§20).
-- ============================================================================
create or replace function public.salary_resolve_for_employee(p_employee_id uuid, p_as_of date)
returns table (gross_salary numeric, salary_structure_id uuid, structure_name text, source text, ambiguous boolean, resolve_note text)
language plpgsql
stable
security definer
as $$
declare
  v_emp record;
  v_asg record;
  v_gross numeric;
  v_struct uuid;
  v_src text := '';
  v_note text := '';
  v_ambig boolean := false;
  v_cnt int;
  v_basic numeric; v_da numeric;
  v_tier record;
begin
  select e.company_id, e.store_id, e.store_department_id, e.store_designation_id, e.grade_id, e.category_id,
         e.employment_type::text as employment_type
  into v_emp from public.employees e where e.id = p_employee_id;
  if v_emp.company_id is null then raise exception 'Employee not found.'; end if;

  select * into v_asg from public.employee_salary_assignments a
  where a.employee_id = p_employee_id and a.effective_from <= p_as_of and (a.effective_to is null or a.effective_to >= p_as_of)
  order by a.effective_from desc limit 1;

  if v_asg.id is not null then
    v_gross := v_asg.gross_salary; v_src := 'assignment';
    if v_asg.salary_structure_id is not null then v_struct := v_asg.salary_structure_id; v_src := v_src || '+explicit_structure'; end if;
  else
    select sc.basic_salary, sc.da into v_basic, v_da
    from public.employee_salary_components sc
    where sc.employee_id = p_employee_id and sc.effective_from <= p_as_of and (sc.effective_to is null or sc.effective_to >= p_as_of)
    order by sc.effective_from desc limit 1;
    if v_basic is not null then
      v_gross := coalesce(v_basic, 0) + coalesce(v_da, 0); v_src := 'legacy_raw';
      v_note := 'No dynamic salary assignment â€” legacy Basic+DA used as Gross. Assign a salary structure for dynamic bifurcation.';
    else
      v_gross := 0; v_src := 'none'; v_note := 'No salary assignment or legacy salary components for this employee.';
    end if;
  end if;

  if v_struct is null and v_gross > 0 then
    for v_tier in
      select ord, scope, ss, cnt from (
        select 1 ord, 'employee' scope, (array_agg(sa.salary_structure_id order by sa.priority))[1] ss, count(*) cnt, min(sa.priority) minp,
               count(*) filter (where sa.priority = (select min(x.priority) from public.salary_structure_assignments x
                 where x.company_id=v_emp.company_id and x.is_active and x.scope_type='employee' and x.employee_id=p_employee_id
                   and x.effective_from<=p_as_of and (x.effective_to is null or x.effective_to>=p_as_of))) tied
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='employee' and sa.employee_id=p_employee_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 2, 'grade', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0,
               count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='grade' and sa.grade_id=v_emp.grade_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 3, 'category', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='category' and sa.category_id=v_emp.category_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 4, 'store_designation', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_designation' and sa.store_designation_id=v_emp.store_designation_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 5, 'store_department', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_department' and sa.store_department_id=v_emp.store_department_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 6, 'location', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type in ('location','store') and sa.store_id=v_emp.store_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 7, 'employment_type', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='employment_type' and sa.employment_type=v_emp.employment_type
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 8, 'company', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='company'
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
      ) t
      where t.cnt >= 1
      order by t.ord
    loop
      if v_tier.cnt > 1 then
        v_ambig := true; v_note := format('Multiple applicable salary structures found (%s scope).', v_tier.scope); v_struct := null;
      else
        v_struct := v_tier.ss; v_src := v_src || '+assign_' || v_tier.scope;
      end if;
      exit;   -- first tier with a match decides
    end loop;

    if v_struct is null and not v_ambig then
      select count(*), (array_agg(sl.salary_structure_id))[1] into v_cnt, v_struct
      from public.salary_slab_rules sl join public.salary_structures s on s.id = sl.salary_structure_id and s.status = 'active'
      where sl.company_id = v_emp.company_id and sl.is_active
        and v_gross >= sl.min_gross and (sl.max_gross is null or v_gross <= sl.max_gross);
      if v_cnt > 1 then v_ambig := true; v_note := 'Multiple applicable salary slabs found.'; v_struct := null;
      elsif v_cnt = 1 then v_src := v_src || '+slab'; end if;
    end if;
  end if;

  gross_salary := v_gross;
  salary_structure_id := v_struct;
  structure_name := (select name from public.salary_structures where id = v_struct);
  source := nullif(v_src, '');
  ambiguous := v_ambig;
  resolve_note := nullif(v_note, '');
  return next;
end;
$$;
grant execute on function public.salary_resolve_for_employee(uuid, date) to authenticated;

-- ============================================================================
-- L. Payroll Policy resolution by scope (Â§21). Falls back to the company-wide
--    active policy (Phase 6 behaviour) when no scoped assignment matches.
-- ============================================================================
create or replace function public.payroll_resolve_policy_for_employee(p_company_id uuid, p_employee_id uuid, p_as_of date)
returns public.payroll_policies
language plpgsql
stable
security definer
as $$
declare
  v_emp record;
  v_tier record;
  v_pol_id uuid;
  v_pol public.payroll_policies;
begin
  select e.store_id, e.store_department_id, e.store_designation_id, e.grade_id, e.category_id, e.employment_type::text et
  into v_emp from public.employees e where e.id = p_employee_id;

  for v_tier in
    select ord, scope, pid, cnt from (
      select 1 ord, 'employee' scope, (array_agg(a.payroll_policy_id order by a.priority))[1] pid, count(*) cnt
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='employee' and a.employee_id=p_employee_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 2, 'grade', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='grade' and a.grade_id=v_emp.grade_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 3, 'category', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='category' and a.category_id=v_emp.category_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 4, 'store_designation', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='store_designation' and a.store_designation_id=v_emp.store_designation_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 5, 'store_department', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='store_department' and a.store_department_id=v_emp.store_department_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 6, 'location', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type in ('location','store') and a.store_id=v_emp.store_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 7, 'employment_type', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='employment_type' and a.employment_type=v_emp.et
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 8, 'company', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='company'
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
    ) t
    where t.cnt >= 1
    order by t.ord
  loop
    if v_tier.cnt = 1 then v_pol_id := v_tier.pid; end if;
    exit;
  end loop;

  if v_pol_id is not null then
    -- resolve the effective-dated ACTIVE version of the assigned policy's code chain
    select * into v_pol from public.payroll_policies base
    where base.id = v_pol_id;
    if v_pol.id is not null then
      select * into v_pol from public.payroll_policies q
      where q.company_id = p_company_id and q.code = v_pol.code and q.status = 'active'
        and q.effective_from <= p_as_of and (q.effective_to is null or q.effective_to >= p_as_of)
      order by q.effective_from desc limit 1;
      if v_pol.id is not null then return v_pol; end if;
      select * into v_pol from public.payroll_policies where id = v_pol_id; return v_pol;
    end if;
  end if;

  -- fall back to the company-wide resolver (unchanged Phase 6 path)
  return public.payroll_resolve_policy(p_company_id, p_as_of);
end;
$$;
grant execute on function public.payroll_resolve_policy_for_employee(uuid, uuid, date) to authenticated;

-- payroll_assign_policy â€” write an assignment + a change-history row (Â§22).
create or replace function public.payroll_assign_policy(
  p_employee_id uuid, p_payroll_policy_id uuid, p_effective_from date, p_reason text default null
)
returns public.payroll_policy_assignments
language plpgsql
security definer
as $$
declare v_company uuid; v_prev uuid; v_row public.payroll_policy_assignments;
begin
  select company_id into v_company from public.employees where id = p_employee_id;
  if v_company is null then raise exception 'Employee not found.'; end if;
  if not public.payroll_can_manage(v_company) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if not exists (select 1 from public.payroll_policies where id = p_payroll_policy_id and company_id = v_company) then
    raise exception 'Payroll policy not found for this company.'; end if;

  select payroll_policy_id into v_prev from public.payroll_policy_assignments
  where employee_id = p_employee_id and scope_type = 'employee' and is_active and effective_to is null
  order by effective_from desc limit 1;

  update public.payroll_policy_assignments
  set effective_to = p_effective_from - 1, updated_by = auth.uid()
  where employee_id = p_employee_id and scope_type = 'employee' and is_active and effective_to is null and effective_from < p_effective_from;

  insert into public.payroll_policy_assignments (company_id, payroll_policy_id, scope_type, employee_id, effective_from, priority, created_by, updated_by, remark)
  values (v_company, p_payroll_policy_id, 'employee', p_employee_id, p_effective_from, 1, auth.uid(), auth.uid(), p_reason)
  returning * into v_row;

  insert into public.payroll_policy_change_history (company_id, employee_id, old_policy_id, new_policy_id, effective_from, reason, changed_by)
  values (v_company, p_employee_id, v_prev, p_payroll_policy_id, p_effective_from, p_reason, auth.uid());

  return v_row;
end;
$$;
grant execute on function public.payroll_assign_policy(uuid, uuid, date, text) to authenticated;

-- ============================================================================
-- M. TDS engine FOUNDATION â€” resolve + compute. Returns {configured:false, ...}
--    with a reason whenever ANY required piece is missing. NEVER invents a value.
-- ============================================================================
create or replace function public.tds_resolve_policy(p_company_id uuid, p_as_of date)
returns public.tds_policies
language plpgsql
stable
security definer
as $$
declare v_p public.tds_policies;
begin
  select * into v_p from public.tds_policies
  where company_id = p_company_id and status = 'active'
    and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc, version_no desc limit 1;
  return v_p;
end;
$$;
grant execute on function public.tds_resolve_policy(uuid, date) to authenticated;

create or replace function public.tds_compute(p_policy_id uuid, p_annual_taxable numeric)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  p public.tds_policies;
  v_slab record;
  v_prev_max numeric := 0;
  v_tax numeric := 0;
  v_band numeric;
  v_applicable uuid;
  v_rate numeric;
  v_rebate numeric := 0;
  v_cess numeric := 0;
  v_final numeric;
begin
  select * into p from public.tds_policies where id = p_policy_id;
  if p.id is null then return jsonb_build_object('configured', false, 'reason', 'No TDS policy.'); end if;
  if p.status <> 'active' then return jsonb_build_object('configured', false, 'reason', 'TDS policy is not active.'); end if;
  if p.tax_regime is null then return jsonb_build_object('configured', false, 'reason', 'Tax regime not supplied.'); end if;
  if p.annualization_method is null then return jsonb_build_object('configured', false, 'reason', 'Annualization method not defined.'); end if;
  if not exists (select 1 from public.tds_slabs where tds_policy_id = p_policy_id) then
    return jsonb_build_object('configured', false, 'reason', 'No tax slabs configured.');
  end if;
  if p_annual_taxable is null then return jsonb_build_object('configured', false, 'reason', 'Taxable income unavailable.'); end if;

  for v_slab in
    select * from public.tds_slabs where tds_policy_id = p_policy_id order by min_income asc
  loop
    exit when p_annual_taxable <= v_slab.min_income;
    v_band := least(coalesce(v_slab.max_income, p_annual_taxable), p_annual_taxable) - v_slab.min_income;
    if v_band > 0 then
      v_tax := v_tax + v_band * v_slab.rate / 100.0 + v_slab.fixed_component;
    end if;
    if p_annual_taxable >= v_slab.min_income and (v_slab.max_income is null or p_annual_taxable <= v_slab.max_income) then
      v_applicable := v_slab.id; v_rate := v_slab.rate;
    end if;
  end loop;

  if p.rebate_limit is not null and p_annual_taxable <= p.rebate_limit then
    v_rebate := least(coalesce(p.rebate_amount, v_tax), v_tax);
  end if;
  v_tax := greatest(v_tax - v_rebate, 0);
  if p.cess_pct is not null then v_cess := round(v_tax * p.cess_pct / 100.0, 2); end if;
  v_final := round(v_tax + v_cess, 2);

  return jsonb_build_object(
    'configured', true,
    'tax_regime', p.tax_regime,
    'policy_version', p.version_no,
    'annual_taxable', p_annual_taxable,
    'applicable_slab_id', v_applicable,
    'slab_rate', v_rate,
    'computed_tax_before_rebate', round(v_tax + v_rebate, 2),
    'rebate', v_rebate,
    'cess', v_cess,
    'final_annual_tds', v_final,
    'monthly_tds', round(v_final / 12.0, 2)
  );
end;
$$;
grant execute on function public.tds_compute(uuid, numeric) to authenticated;


-- ============================================================================
-- N. payroll_policy_compute_lines â€” Phase 7: + exit-month proration, + OT
--    standard-hours guard, + real-TDS hand-off (p_tds jsonb from tds_compute).
--    Signature widened => drop + recreate (grants re-applied).
-- ============================================================================
drop function if exists public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[]);

create function public.payroll_policy_compute_lines(
  p_policy_id uuid,
  p_period_start date,
  p_period_end date,
  p_working_days numeric,
  p_joining_date date,
  p_basic numeric,
  p_da numeric,
  p_gross numeric,
  p_lwp_days numeric,
  p_ot_minutes numeric,
  p_nd_value numeric,
  p_structure_id uuid default null,
  p_existing_codes text[] default '{}',
  p_leaving_date date default null,
  p_exit_date_payable boolean default null,
  p_tds jsonb default null
)
returns table (
  kind text, line_type text, code text, name text,
  quantity numeric, rate numeric, amount numeric,
  calc_type text, calc_base text, calc_note text, unresolved boolean
)
language plpgsql
stable
security definer
as $$
declare
  p public.payroll_policies;
  v_days int := (p_period_end - p_period_start + 1);
  v_prec int;
  v_div numeric;
  v_base numeric;
  v_daily numeric;
  v_lost numeric;
  v_lost_join numeric := 0;
  v_hours numeric;
  v_stdh numeric;
  v_rate numeric;
  v_amt numeric;
  v_note text;
  r record;
  v_sbase numeric;
  v_has_struct_stat boolean;
  v_last_payable date;
begin
  select * into p from public.payroll_policies where id = p_policy_id;
  if p.id is null then return; end if;
  v_prec := coalesce(p.currency_precision, 2);
  v_stdh := nullif(coalesce(p.ot_std_hours_per_day, 0), 0);

  v_div := case p.proration_method
    when 'calendar_days' then v_days
    when 'working_days'  then nullif(p_working_days, 0)
    when 'fixed_26'      then 26
    when 'fixed_30'      then 30
    when 'custom'        then p.proration_custom_divisor
    else null end;
  v_base := case p.proration_basis
    when 'basic'    then p_basic
    when 'basic_da' then p_basic + p_da
    when 'gross'    then p_gross
    when 'custom'   then public.payroll_eval_formula(p.proration_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross))
    else null end;

  -- ---- 1. Joining-month proration ----
  if p_joining_date is not null and p_joining_date > p_period_start then
    v_lost_join := (p_joining_date - p_period_start);
    if v_div is not null then v_lost_join := least(v_lost_join, v_div); end if;
    if v_lost_join > 0 then
      if p.proration_method is null or v_div is null or v_div = 0 or v_base is null then
        kind := 'earning_prorate'; line_type := 'earning'; code := 'PRORATE'; name := 'Joining-month proration';
        quantity := v_lost_join; rate := null; amount := 0; calc_type := 'proration'; calc_base := p.proration_basis;
        calc_note := format('Joined %s â€” %s day(s) not worked. Proration method/basis/divisor not configured.', p_joining_date, v_lost_join);
        unresolved := true; return next;
      else
        v_daily := round(v_base / v_div, 6);
        kind := 'earning_prorate'; line_type := 'earning'; code := 'PRORATE'; name := 'Joining-month proration';
        quantity := v_lost_join; rate := v_daily; amount := - round(v_daily * v_lost_join, v_prec); calc_type := 'proration';
        calc_base := p.proration_basis;
        calc_note := format('Joined %s â€” %s day(s) Ã— daily %s (%s Ã· %s, %s)', p_joining_date, v_lost_join, v_daily, v_base, v_div, p.proration_method);
        unresolved := false; return next;
      end if;
    end if;
  end if;

  -- ---- 1b. Exit-month proration (SAME engine, SAME policy) ----
  if p_leaving_date is not null and p_leaving_date < p_period_end then
    if p_exit_date_payable is null then
      kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
      quantity := (p_period_end - p_leaving_date); rate := null; amount := 0; calc_type := 'proration_exit'; calc_base := p.proration_basis;
      calc_note := format('Left %s â€” exit_date_payable not confirmed (business decision). No exit proration applied.', p_leaving_date);
      unresolved := true; return next;
    else
      v_last_payable := case when p_exit_date_payable then p_leaving_date else p_leaving_date - 1 end;
      v_lost := greatest(p_period_end - v_last_payable, 0);
      if v_div is not null then v_lost := least(v_lost, greatest(v_div - v_lost_join, 0)); end if;
      if v_lost > 0 then
        if p.proration_method is null or v_div is null or v_div = 0 or v_base is null then
          kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
          quantity := v_lost; rate := null; amount := 0; calc_type := 'proration_exit'; calc_base := p.proration_basis;
          calc_note := format('Left %s â€” %s day(s) after last payable day. Proration method/basis/divisor not configured.', p_leaving_date, v_lost);
          unresolved := true; return next;
        else
          v_daily := round(v_base / v_div, 6);
          kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
          quantity := v_lost; rate := v_daily; amount := - round(v_daily * v_lost, v_prec); calc_type := 'proration_exit';
          calc_base := p.proration_basis;
          calc_note := format('Left %s (last payable %s) â€” %s day(s) Ã— daily %s (%s Ã· %s, %s)', p_leaving_date, v_last_payable, v_lost, v_daily, v_base, v_div, p.proration_method);
          unresolved := false; return next;
        end if;
      end if;
    end if;
  end if;

  -- ---- 2. Overtime ----
  if p.ot_enabled and coalesce(p_ot_minutes, 0) > 0 and not ('OT' = any(p_existing_codes)) then
    v_hours := round(p_ot_minutes / 60.0, 2);
    if p.ot_min_hours is not null and v_hours < p.ot_min_hours then v_hours := 0; end if;
    if p.ot_max_hours is not null and v_hours > p.ot_max_hours then v_hours := p.ot_max_hours; end if;
    v_note := null;
    v_rate := case p.ot_rate_type
      when 'fixed_per_hour'  then coalesce(p.ot_rate, p.overtime_hourly_rate)
      when 'pct_of_basic'    then case when v_div is null or v_stdh is null then null
                                  else round(p_basic / v_div / v_stdh * coalesce(p.ot_rate, 0) / 100.0, 4) end
      when 'pct_of_basic_da' then case when v_div is null or v_stdh is null then null
                                  else round((p_basic + p_da) / v_div / v_stdh * coalesce(p.ot_rate, 0) / 100.0, 4) end
      when 'pct_of_hourly'   then case when v_div is null or v_stdh is null then null
                                  else round((case coalesce(p.ot_basis,'basic_da') when 'basic' then p_basic when 'gross' then p_gross else p_basic + p_da end)
                                             / v_div / v_stdh * coalesce(p.ot_rate, 0) / 100.0, 4) end
      when 'custom_formula'  then public.payroll_eval_formula(p.ot_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross, 'HOURS', v_hours, 'DIVISOR', coalesce(v_div, 0), 'STD_HOURS', coalesce(v_stdh, 0)))
      else null end;
    if v_rate is null then
      v_amt := 0; unresolved := true;
      v_note := case when p.ot_rate_type in ('pct_of_basic', 'pct_of_basic_da', 'pct_of_hourly') and v_stdh is null
                     then 'Overtime %-based rate needs ot_std_hours_per_day (Not Configured).'
                     else 'Overtime rate not configured.' end;
    else
      v_amt := round(v_hours * v_rate, case coalesce(p.ot_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
      unresolved := false;
      v_note := format('%s h Ã— %s (%s%s)', v_hours, v_rate, coalesce(p.ot_rate_type, 'fixed_per_hour'), case when v_stdh is not null then format(', std %s h/day', v_stdh) else '' end);
    end if;
    kind := 'earning_ot'; line_type := 'earning'; code := 'OT'; name := 'Overtime';
    quantity := v_hours; rate := v_rate; amount := v_amt; calc_type := 'overtime'; calc_base := p.ot_basis; calc_note := v_note;
    return next;
  end if;

  -- ---- 3. Night-Duty payroll earning ----
  if p.nd_earning_enabled and coalesce(p_nd_value, 0) > 0 and not ('NDUTY' = any(p_existing_codes)) then
    v_note := null;
    v_rate := case p.nd_rate_type
      when 'fixed'           then coalesce(p.nd_rate, p.night_duty_day_rate)
      when 'pct_of_basic'    then case when v_div is null then null else round(p_basic / v_div * coalesce(p.nd_rate, 0) / 100.0, 4) end
      when 'pct_of_basic_da' then case when v_div is null then null else round((p_basic + p_da) / v_div * coalesce(p.nd_rate, 0) / 100.0, 4) end
      when 'custom_formula'  then public.payroll_eval_formula(p.nd_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross, 'NDVALUE', p_nd_value, 'DIVISOR', coalesce(v_div, 0)))
      else null end;
    if v_rate is null then
      v_amt := 0; unresolved := true; v_note := 'Night-duty payroll rate not configured.';
    else
      v_amt := round(coalesce(p_nd_value, 0) * v_rate, case coalesce(p.nd_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
      unresolved := false; v_note := format('%s unit(s) Ã— %s (%s)', p_nd_value, v_rate, coalesce(p.nd_rate_type, 'fixed'));
    end if;
    kind := 'earning_nd'; line_type := 'earning'; code := 'NDUTY'; name := 'Night Duty';
    quantity := p_nd_value; rate := v_rate; amount := v_amt; calc_type := 'night_duty'; calc_base := p.nd_basis; calc_note := v_note;
    return next;
  end if;

  -- ---- 4. LWP deduction ----
  if p.lwp_enabled and coalesce(p_lwp_days, 0) > 0 and not ('LWP' = any(p_existing_codes)) then
    declare
      v_ld numeric := case coalesce(p.lwp_proration_method, p.proration_method)
        when 'calendar_days' then v_days
        when 'working_days'  then nullif(p_working_days, 0)
        when 'fixed_26'      then 26
        when 'fixed_30'      then 30
        when 'custom'        then coalesce(p.proration_custom_divisor, p.lwp_divisor)
        else p.lwp_divisor end;
      v_lb numeric := case coalesce(p.lwp_basis, p.lwp_divisor_basis)
        when 'basic'    then p_basic
        when 'basic_da' then p_basic + p_da
        when 'gross'    then p_gross
        when 'custom'   then public.payroll_eval_formula(p.lwp_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross))
        else null end;
    begin
      if v_ld is null or v_ld = 0 or v_lb is null then
        kind := 'deduction_lwp'; line_type := 'deduction'; code := 'LWP'; name := 'Loss of Pay';
        quantity := p_lwp_days; rate := null; amount := 0; calc_type := 'lwp'; calc_base := coalesce(p.lwp_basis, p.lwp_divisor_basis);
        calc_note := format('%s LWP day(s) â€” LWP daily-rate needs a configured basis + divisor/method.', p_lwp_days);
        unresolved := true; return next;
      else
        v_daily := round(v_lb / v_ld, 6);
        kind := 'deduction_lwp'; line_type := 'deduction'; code := 'LWP'; name := 'Loss of Pay';
        quantity := p_lwp_days; rate := v_daily;
        amount := round(v_daily * p_lwp_days, case coalesce(p.lwp_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
        calc_type := 'lwp'; calc_base := coalesce(p.lwp_basis, p.lwp_divisor_basis);
        calc_note := format('%s day(s) Ã— daily %s (%s Ã· %s)', p_lwp_days, v_daily, v_lb, v_ld);
        unresolved := false; return next;
      end if;
    end;
  end if;

  -- ---- 5. Statutory (PF / ESI / PT / TDS / Gratuity / Other) ----
  for r in
    select * from public.payroll_statutory_rules sr
    where sr.payroll_policy_id = p_policy_id and sr.enabled
      and sr.effective_from <= p_period_end and (sr.effective_to is null or sr.effective_to >= p_period_start)
    order by array_position(array['pf','esi','pt','tds','gratuity','other'], sr.kind)
  loop
    v_has_struct_stat := p_structure_id is not null and exists (
      select 1 from public.salary_structure_components c
      where c.salary_structure_id = p_structure_id and c.is_active and c.statutory_kind = r.kind);
    if v_has_struct_stat or (upper(r.kind) = any(p_existing_codes)) then continue; end if;

    v_sbase := case r.calc_base
      when 'basic'    then p_basic
      when 'basic_da' then p_basic + p_da
      when 'gross'    then p_gross
      when 'custom'   then public.payroll_eval_formula(r.base_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross))
      else null end;
    if r.wage_ceiling is not null and v_sbase is not null then v_sbase := least(v_sbase, r.wage_ceiling); end if;
    v_prec := case coalesce(r.rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else coalesce(p.currency_precision, 2) end;

    if r.kind = 'pt' then
      select s.amount into v_amt from public.payroll_pt_slabs s
      where s.payroll_policy_id = p_policy_id
        and s.effective_from <= p_period_end and (s.effective_to is null or s.effective_to >= p_period_start)
        and coalesce(v_sbase, p_gross) >= s.min_salary and (s.max_salary is null or coalesce(v_sbase, p_gross) <= s.max_salary)
      order by s.min_salary desc limit 1;
      kind := 'deduction_pt'; line_type := 'deduction'; code := 'PT'; name := 'Professional Tax';
      quantity := null; rate := null; calc_type := 'statutory_pt'; calc_base := coalesce(r.calc_base, 'gross');
      if v_amt is null then amount := 0; unresolved := true; calc_note := 'PT slabs not configured for this salary.';
      else amount := round(v_amt, 0); unresolved := false; calc_note := format('PT slab @ %s', coalesce(v_sbase, p_gross)); end if;
      return next;

    elsif r.kind = 'tds' then
      kind := 'deduction_tds'; line_type := 'deduction'; code := 'TDS'; name := 'TDS';
      quantity := null; rate := null; calc_type := 'statutory_tds'; calc_base := r.calc_base;
      if p_tds is not null and coalesce((p_tds ->> 'configured')::boolean, false) then
        amount := round(coalesce((p_tds ->> 'monthly_tds')::numeric, 0), v_prec); unresolved := false;
        calc_note := format('TDS %s regime â€” annual %s Ã· 12 (slab %s%%)', p_tds ->> 'tax_regime', p_tds ->> 'final_annual_tds', coalesce(p_tds ->> 'slab_rate', '?'));
      elsif p_tds is not null then
        amount := 0; unresolved := true; calc_note := 'TDS Not Configured â€” ' || coalesce(p_tds ->> 'reason', 'incomplete TDS policy.');
      elsif coalesce(btrim(r.base_formula), '') <> '' then
        amount := round(coalesce(public.payroll_eval_formula(r.base_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec);
        unresolved := false; calc_note := 'TDS via configured formula.';
      else
        amount := 0; unresolved := true; calc_note := 'TDS Not Configured â€” no tax engine / policy supplied.';
      end if;
      return next;

    else
      if r.kind = 'esi' and r.wage_ceiling is not null and p_gross > r.wage_ceiling then
        kind := 'deduction_esi'; line_type := 'deduction'; code := 'ESI'; name := 'ESI';
        quantity := null; rate := 0; amount := 0; calc_type := 'statutory_esi'; calc_base := coalesce(r.calc_base, 'gross');
        calc_note := format('ESI not applicable â€” gross %s above ceiling %s.', p_gross, r.wage_ceiling); unresolved := false;
        return next;
      else
        kind := 'deduction_' || r.kind; line_type := 'deduction';
        code := upper(r.kind); name := (case r.kind when 'pf' then 'Provident Fund' when 'esi' then 'ESI' when 'gratuity' then 'Gratuity (employee)' else 'Statutory' end);
        quantity := null; calc_type := 'statutory_' || r.kind; calc_base := r.calc_base;
        if r.employee_rate is null then
          rate := null; amount := 0; unresolved := true; calc_note := format('%s employee rate not configured.', upper(r.kind));
        elsif v_sbase is null then
          rate := r.employee_rate; amount := 0; unresolved := true; calc_note := format('%s calculation base not configured.', upper(r.kind));
        else
          rate := r.employee_rate; amount := round(v_sbase * r.employee_rate / 100.0, v_prec); unresolved := false;
          calc_note := format('%s%% of %s (%s)%s', r.employee_rate, coalesce(r.calc_base, 'base'), v_sbase,
                              case when r.wage_ceiling is not null then format(' capped @ %s', r.wage_ceiling) else '' end);
        end if;
        return next;
      end if;

      if r.employer_rate is not null and v_sbase is not null then
        kind := 'employer_' || r.kind; line_type := 'employer_contribution';
        code := upper(r.kind) || '_ER'; name := 'Employer ' || upper(r.kind);
        quantity := null; rate := r.employer_rate; amount := round(v_sbase * r.employer_rate / 100.0, v_prec);
        calc_type := 'employer_' || r.kind; calc_base := r.calc_base;
        calc_note := format('%s%% of %s (%s) â€” employer', r.employer_rate, coalesce(r.calc_base, 'base'), v_sbase); unresolved := false;
        return next;
      end if;
    end if;
  end loop;

  return;
end;
$$;
revoke execute on function public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[], date, boolean, jsonb) from public;
grant execute on function public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[], date, boolean, jsonb) to authenticated;


-- ============================================================================
-- O. payroll_apply_policy â€” Phase 7: + exit-month proration inputs, + real-TDS
--    resolution/snapshot. Signature widened => drop + recreate.
-- ============================================================================
drop function if exists public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid);

create function public.payroll_apply_policy(
  p_result_id uuid, p_policy_id uuid, p_period_start date, p_period_end date, p_working_days numeric,
  p_joining_date date, p_basic numeric, p_da numeric, p_gross numeric, p_lwp_days numeric,
  p_ot_minutes numeric, p_nd_value numeric, p_structure_id uuid,
  p_leaving_date date default null, p_exit_date_payable boolean default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_run uuid; v_company uuid; v_emp uuid;
  v_existing text[];
  l record;
  v_gross numeric := p_gross;
  v_empc numeric := 0;
  v_lwp numeric := 0;
  v_stat_total numeric := 0;
  v_prorate numeric := 0;
  v_prorate_exit numeric := 0;
  v_deds jsonb := '[]'::jsonb;
  v_fin jsonb;
  o jsonb;
  v_note text := '';
  v_unresolved boolean := false;
  p public.payroll_policies;
  v_tds_pol public.tds_policies;
  v_tds jsonb := null;
  v_annual numeric;
  v_decl record;
  v_fy_start date;
begin
  select payroll_run_id, company_id, employee_id into v_run, v_company, v_emp
  from public.payroll_employee_results where id = p_result_id;
  select * into p from public.payroll_policies where id = p_policy_id;

  select coalesce(array_agg(code), '{}') into v_existing
  from public.payroll_lines where payroll_employee_result_id = p_result_id;

  -- ---- real TDS resolution (inert unless fully configured) ----
  v_tds_pol := public.tds_resolve_policy(v_company, p_period_end);
  if v_tds_pol.id is not null then
    if v_tds_pol.annualization_method = 'flat_x12' then
      v_fy_start := coalesce(v_tds_pol.financial_year_start, make_date(extract(year from p_period_end)::int, 4, 1));
      select * into v_decl from public.tds_employee_declarations
      where employee_id = v_emp and financial_year_start = v_fy_start;
      v_annual := greatest(
        p_gross * 12
        + coalesce(v_decl.previous_employer_income, 0)
        + coalesce(v_decl.other_income, 0)
        - coalesce(v_tds_pol.standard_deduction, 0)
        - coalesce(v_decl.investment_declared, 0)
        - coalesce(v_decl.other_exemptions, 0), 0);
      v_tds := public.tds_compute(v_tds_pol.id, v_annual);
    else
      v_tds := jsonb_build_object('configured', false,
        'reason', format('Annualization method "%s" needs year-to-date income (not available in a single run).', coalesce(v_tds_pol.annualization_method, 'not defined')));
    end if;
  end if;

  -- 1. policy-driven lines
  for l in select * from public.payroll_policy_compute_lines(
             p_policy_id, p_period_start, p_period_end, p_working_days, p_joining_date,
             p_basic, p_da, p_gross, p_lwp_days, p_ot_minutes, p_nd_value, p_structure_id, v_existing,
             p_leaving_date, p_exit_date_payable, v_tds)
  loop
    insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id,
      line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, calc_formula, sort_order)
    values (v_company, v_run, p_result_id, v_emp, l.line_type, l.code, l.name, l.quantity, l.rate, l.amount,
      'payroll_policy', l.calc_type, l.calc_base, l.calc_note,
      case l.kind
        when 'earning_ot' then 60 when 'earning_nd' then 65 when 'earning_prorate' then 70 when 'earning_prorate_exit' then 72
        when 'deduction_pf' then 300 when 'deduction_esi' then 310 when 'deduction_pt' then 320
        when 'deduction_tds' then 330 when 'deduction_lwp' then 350
        when 'employer_pf' then 400 when 'employer_esi' then 410 when 'employer_gratuity' then 420
        else 360 end);

    if l.line_type = 'earning' then v_gross := v_gross + l.amount;
    elsif l.line_type = 'employer_contribution' then v_empc := v_empc + l.amount;
    end if;
    if l.kind = 'deduction_lwp' then v_lwp := l.amount; end if;
    if l.kind = 'earning_prorate' then v_prorate := l.amount; end if;
    if l.kind = 'earning_prorate_exit' then v_prorate_exit := l.amount; end if;
    if l.calc_type like 'statutory_%' then v_stat_total := v_stat_total + l.amount; end if;
    if l.unresolved then v_unresolved := true; v_note := v_note || coalesce(l.calc_note, '') || ' '; end if;
  end loop;

  -- 2. collect ALL employee-deduction lines for finalize
  for l in select code, amount from public.payroll_lines
           where payroll_employee_result_id = p_result_id and line_type = 'deduction'
  loop
    v_deds := v_deds || jsonb_build_object('code', l.code, 'amount', l.amount, 'protected', l.code = 'ADVREC');
  end loop;

  v_fin := public.payroll_policy_finalize(p_policy_id, v_gross, v_deds);

  for o in select * from jsonb_array_elements(v_fin -> 'ordered') loop
    if (o ? 'capped') or (o ? 'neg_blocked') then
      update public.payroll_lines
      set amount = (o ->> 'amount')::numeric,
          calc_formula = coalesce(calc_formula, '') ||
            case when (o ? 'capped') then ' [reduced by deduction cap]' else '' end ||
            case when (o ? 'neg_blocked') then ' [reduced to block negative net]' else '' end
      where payroll_employee_result_id = p_result_id and line_type = 'deduction' and code = (o ->> 'code');
    end if;
  end loop;

  if (v_fin ->> 'cap_reduction')::numeric > 0 then v_note := v_note || format('Deduction cap trimmed %s. ', v_fin ->> 'cap_reduction'); end if;
  if (v_fin ->> 'negative_flag')::boolean then v_note := v_note || format('Negative net (%s policy). ', v_fin ->> 'negative_net_policy'); end if;
  if not (v_fin ->> 'priority_configured')::boolean
     and exists (select 1 from public.payroll_lines where payroll_employee_result_id = p_result_id and line_type = 'deduction') then
    v_note := v_note || 'Deduction priority not configured. ';
  end if;

  -- ---- TDS calculation snapshot (only when it actually computed) ----
  if v_tds is not null and coalesce((v_tds ->> 'configured')::boolean, false) then
    insert into public.tds_calculations (company_id, payroll_employee_result_id, employee_id, tds_policy_id, tds_policy_version,
      tax_regime, annual_projected_income, taxable_income, applicable_slab_id, slab_rate, computed_tax, rebate, cess, final_annual_tds, monthly_tds, snapshot)
    values (v_company, p_result_id, v_emp, v_tds_pol.id, (v_tds ->> 'policy_version')::int,
      v_tds ->> 'tax_regime', v_annual, (v_tds ->> 'annual_taxable')::numeric,
      nullif(v_tds ->> 'applicable_slab_id', '')::uuid, (v_tds ->> 'slab_rate')::numeric,
      (v_tds ->> 'computed_tax_before_rebate')::numeric, (v_tds ->> 'rebate')::numeric, (v_tds ->> 'cess')::numeric,
      (v_tds ->> 'final_annual_tds')::numeric, (v_tds ->> 'monthly_tds')::numeric, v_tds)
    on conflict (payroll_employee_result_id) do update set
      snapshot = excluded.snapshot, monthly_tds = excluded.monthly_tds, final_annual_tds = excluded.final_annual_tds,
      taxable_income = excluded.taxable_income, annual_projected_income = excluded.annual_projected_income, computed_at = now();
  end if;

  return jsonb_build_object(
    'gross', v_gross,
    'total_deductions', (v_fin ->> 'total_deductions')::numeric,
    'net', (v_fin ->> 'net')::numeric,
    'employer_contribution_extra', v_empc,
    'lwp_amount', v_lwp,
    'prorate_amount', v_prorate,
    'prorate_exit_amount', v_prorate_exit,
    'statutory_total', v_stat_total,
    'needs_review', v_unresolved or (v_fin ->> 'negative_flag')::boolean,
    'review_note', nullif(btrim(v_note), ''),
    'snapshot', jsonb_build_object(
      'policy_id', p_policy_id, 'policy_code', p.code, 'policy_name', p.policy_name, 'version_no', p.version_no,
      'effective_from', p.effective_from, 'effective_to', p.effective_to,
      'proration_method', p.proration_method, 'proration_basis', p.proration_basis, 'exit_date_payable', p.exit_date_payable,
      'lwp', jsonb_build_object('enabled', p.lwp_enabled, 'basis', coalesce(p.lwp_basis, p.lwp_divisor_basis), 'method', coalesce(p.lwp_proration_method, p.proration_method), 'divisor', p.lwp_divisor),
      'overtime', jsonb_build_object('enabled', p.ot_enabled, 'rate_type', p.ot_rate_type, 'rate', p.ot_rate, 'std_hours_per_day', p.ot_std_hours_per_day),
      'night_duty', jsonb_build_object('enabled', p.nd_earning_enabled, 'rate_type', p.nd_rate_type, 'rate', p.nd_rate),
      'statutory', (select coalesce(jsonb_agg(jsonb_build_object('kind', sr.kind, 'enabled', sr.enabled, 'base', sr.calc_base, 'employee_rate', sr.employee_rate, 'employer_rate', sr.employer_rate, 'ceiling', sr.wage_ceiling)), '[]'::jsonb)
                    from public.payroll_statutory_rules sr where sr.payroll_policy_id = p_policy_id),
      'tds', coalesce(v_tds, jsonb_build_object('configured', false, 'reason', 'No active TDS policy for this company/period.')),
      'deduction_cap', jsonb_build_object('mode', p.deduction_cap_mode, 'value', p.deduction_cap_value),
      'negative_net_policy', p.negative_net_policy,
      'deduction_order', (select coalesce(jsonb_agg(jsonb_build_object('code', d.deduction_code, 'priority', d.priority) order by d.priority), '[]'::jsonb)
                          from public.payroll_deduction_order d where d.payroll_policy_id = p_policy_id and d.is_active)
    )
  );
end;
$$;
revoke execute on function public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, date, boolean) from public;
grant execute on function public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, date, boolean) to authenticated;


-- ============================================================================
-- P. payroll_calculate_run â€” Phase 7 wiring: per-employee scoped policy
--    resolution, exit-month eligibility + proration, store-calendar working
--    days, grade/category-aware salary resolution, calendar + exit snapshot.
--    Default (nothing configured) => identical to Phase 6.
-- ============================================================================
create or replace function public.payroll_calculate_run(p_payroll_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
as $function$
declare
  v_run public.payroll_runs;
  v_period public.payroll_periods;
  v_pol public.payroll_policies;
  v_emp record;
  v_sal record;
  v_comp record;
  v_rec record;
  v_bif record;
  v_adv_period_id uuid;
  v_result_id uuid;
  v_basic numeric; v_da numeric;
  v_present_full numeric; v_half numeric; v_woff numeric; v_holi numeric; v_absent numeric; v_att_leave numeric;
  v_ot_min numeric; v_nd_val numeric;
  v_paid_leave numeric; v_lwp_days numeric; v_unassigned int;
  v_calendar int; v_working numeric; v_present numeric; v_paid_days numeric; v_unpaid_days numeric;
  v_gross numeric; v_ded numeric; v_advrec numeric; v_net numeric; v_empc numeric;
  v_qty numeric; v_rate numeric; v_amt numeric;
  v_review boolean; v_notes text; v_hasneg boolean;
  v_res_gross numeric; v_struct_id uuid; v_ambig boolean; v_resolve_note text; v_src text; v_ltype text; v_advrec_extra numeric;
  v_join date; v_leave date; v_exit_pay boolean; v_pol_j jsonb; v_gross_pre numeric;
  v_cal public.store_payroll_calendars; v_cal_wd numeric;
  v_elig_start date; v_elig_end date; v_eligible_days numeric; v_ss_scope text;
  v_r_gross numeric := 0; v_r_ded numeric := 0; v_r_adv numeric := 0; v_r_net numeric := 0; v_cnt int := 0;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then
    raise exception 'You are not authorised to run payroll for this company.' using errcode = '42501';
  end if;
  if v_run.status not in ('draft', 'processing', 'calculated') then
    raise exception 'Payroll run is % â€” a finalized/locked/reversed run cannot be recalculated.', v_run.status;
  end if;
  if not v_run.is_current then raise exception 'This is not the current run for its period.'; end if;

  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id;
  v_calendar := (v_period.period_end_date - v_period.period_start_date + 1);

  update public.payroll_runs set status = 'processing', started_at = coalesce(started_at, now()), processed_by = auth.uid() where id = v_run.id;
  delete from public.payroll_lines where payroll_run_id = v_run.id;
  delete from public.payroll_employee_results where payroll_run_id = v_run.id;

  select id into v_adv_period_id from public.advance_payroll_periods
  where company_id = v_run.company_id and period_month = v_period.period_month;
  if v_adv_period_id is null then
    insert into public.advance_payroll_periods (company_id, period_month, label, status, payroll_run_id, created_by, updated_by)
    values (v_run.company_id, v_period.period_month, coalesce(v_period.label, to_char(v_period.period_month, 'Mon YYYY')), 'draft', v_run.id, auth.uid(), auth.uid())
    returning id into v_adv_period_id;
  else
    update public.advance_payroll_periods set payroll_run_id = v_run.id, updated_by = auth.uid()
    where id = v_adv_period_id and status = 'draft';
  end if;

  for v_emp in
    select e.id, e.full_name, e.employee_code, e.store_id, e.store_department_id, e.store_designation_id,
           e.joining_date, e.leaving_date
    from public.employees e
    where e.company_id = v_run.company_id
      and (e.status in ('active', 'on_leave', 'notice_period')
           or (e.status in ('resigned', 'terminated', 'transferred') and e.leaving_date is not null and e.leaving_date >= v_period.period_start_date))
      and (e.joining_date is null or e.joining_date <= v_period.period_end_date)
      and (e.leaving_date is null or e.leaving_date >= v_period.period_start_date)
    order by e.full_name
  loop
    v_review := false; v_notes := ''; v_basic := 0; v_da := 0; v_empc := 0; v_advrec := 0; v_gross := 0; v_ded := 0;
    v_join := v_emp.joining_date; v_leave := v_emp.leaving_date;

    -- per-employee scoped Payroll Policy (falls back to the company-wide active policy)
    select * into v_pol from public.payroll_resolve_policy_for_employee(v_run.company_id, v_emp.id, v_period.period_end_date);
    v_exit_pay := v_pol.exit_date_payable;

    select sc.basic_salary, sc.da, sc.effective_from into v_sal
    from public.employee_salary_components sc
    where sc.employee_id = v_emp.id
      and sc.effective_from <= v_period.period_end_date
      and (sc.effective_to is null or sc.effective_to >= v_period.period_start_date)
    order by sc.effective_from desc limit 1;

    select
      coalesce(count(*) filter (where ar.status in ('present', 'work_from_home', 'on_duty')), 0),
      coalesce(count(*) filter (where ar.status = 'half_day'), 0) * 0.5,
      coalesce(count(*) filter (where ar.status = 'weekly_off'), 0),
      coalesce(count(*) filter (where ar.status = 'holiday'), 0),
      coalesce(count(*) filter (where ar.status = 'absent'), 0),
      coalesce(count(*) filter (where ar.status = 'leave'), 0),
      coalesce(sum(ar.payable_overtime_minutes), 0),
      coalesce(sum(ar.payable_extra_duty_value), 0)
    into v_present_full, v_half, v_woff, v_holi, v_absent, v_att_leave, v_ot_min, v_nd_val
    from public.attendance_records ar
    where ar.employee_id = v_emp.id and ar.attendance_date between v_period.period_start_date and v_period.period_end_date;

    select
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'paid'), 0),
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'unpaid'), 0),
      coalesce(count(*) filter (where lae.paid_status is null or lae.paid_status = 'unassigned'), 0)
    into v_paid_leave, v_lwp_days, v_unassigned
    from public.leave_attendance_effects lae
    where lae.employee_id = v_emp.id
      and lae.attendance_date between v_period.period_start_date and v_period.period_end_date
      and lae.reversed_at is null;
    if v_unassigned > 0 then
      v_review := true;
      v_notes := v_notes || format('%s approved leave day(s) not yet allocated as Paid Leave / LWP. ', v_unassigned);
    end if;

    v_present := coalesce(v_present_full, 0) + coalesce(v_half, 0);
    v_working := greatest(v_calendar - coalesce(v_woff, 0) - coalesce(v_holi, 0), 0);
    v_paid_days := v_present + coalesce(v_paid_leave, 0) + coalesce(v_woff, 0) + coalesce(v_holi, 0);
    v_unpaid_days := coalesce(v_lwp_days, 0) + coalesce(v_absent, 0);

    -- Store Calendar working days (Â§28) â€” only when the policy asks for it
    v_cal := null; v_cal_wd := null;
    if v_pol.working_days_method = 'store_calendar' then
      v_cal := public.payroll_resolve_store_calendar(v_run.company_id, v_emp.store_id, v_period.period_end_date);
      if v_cal.id is not null then
        v_cal_wd := public.payroll_calendar_working_days(v_cal.id, v_period.period_start_date, v_period.period_end_date);
        if v_cal_wd is not null then v_working := v_cal_wd; end if;
      else
        v_review := true; v_notes := v_notes || 'Store calendar working-days method selected but no active calendar resolves. ';
      end if;
    end if;

    -- Eligible days (joining / leaving inside the period)
    v_elig_start := greatest(v_period.period_start_date, coalesce(v_join, v_period.period_start_date));
    v_elig_end := case
      when v_leave is null then v_period.period_end_date
      when v_exit_pay is true then least(v_leave, v_period.period_end_date)
      when v_exit_pay is false then least(v_leave - 1, v_period.period_end_date)
      else v_period.period_end_date end;
    v_eligible_days := greatest((v_elig_end - v_elig_start) + 1, 0);

    insert into public.payroll_employee_results (
      company_id, payroll_run_id, payroll_period_id, employee_id,
      employee_code_snapshot, employee_name_snapshot, department_snapshot, designation_snapshot, store_snapshot,
      salary_effective_from, basic_snapshot, da_snapshot,
      calendar_days, working_days, present_days, paid_leave_days, lwp_days, weekly_off_days, holiday_days, absent_days, paid_days, unpaid_days,
      payroll_policy_id, store_calendar_id, store_calendar_snapshot, leaving_date_snapshot, eligible_days, status
    ) values (
      v_run.company_id, v_run.id, v_period.id, v_emp.id,
      v_emp.employee_code, v_emp.full_name,
      (select sd.name from public.store_departments sd where sd.id = v_emp.store_department_id),
      (select sg.title from public.store_designations sg where sg.id = v_emp.store_designation_id),
      (select s.name from public.stores s where s.id = v_emp.store_id),
      v_sal.effective_from, coalesce(v_sal.basic_salary, 0), coalesce(v_sal.da, 0),
      v_calendar, v_working, v_present, coalesce(v_paid_leave, 0), coalesce(v_lwp_days, 0), coalesce(v_woff, 0), coalesce(v_holi, 0), coalesce(v_absent, 0), v_paid_days, v_unpaid_days,
      v_pol.id, v_cal.id,
      case when v_cal.id is not null then jsonb_build_object('calendar_id', v_cal.id, 'name', v_cal.name, 'effective_from', v_cal.effective_from, 'effective_to', v_cal.effective_to,
        'weekly_off_days', to_jsonb(v_cal.weekly_off_days), 'alternate_saturday_off', v_cal.alternate_saturday_off, 'holiday_source', v_cal.holiday_source, 'working_days', v_cal_wd) else null end,
      v_leave, v_eligible_days, 'calculated'
    ) returning id into v_result_id;

    -- ================= PHASE 5A: dynamic salary structure path =================
    select r.gross_salary, r.salary_structure_id, r.ambiguous, r.resolve_note, r.source
      into v_res_gross, v_struct_id, v_ambig, v_resolve_note, v_src
    from public.salary_resolve_for_employee(v_emp.id, v_period.period_end_date) r;
    v_ss_scope := (regexp_match(coalesce(v_src, ''), 'assign_([a-z_]+)'))[1];

    if v_ambig then
      update public.payroll_employee_results
      set needs_review = true, review_notes = coalesce(v_resolve_note, 'Ambiguous salary structure â€” resolve the assignment.'),
          gross_earnings = 0, total_deductions = 0, net_salary = 0, salary_structure_scope = v_ss_scope
      where id = v_result_id;
      v_cnt := v_cnt + 1;
      continue;
    end if;

    if v_struct_id is not null then
      begin
        for v_bif in select * from public.salary_bifurcate(v_struct_id, v_res_gross) loop
          if v_bif.calculation_type = 'advance_recovery' then
            if exists (select 1 from public.advance_recovery_transactions x
                       where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
              select coalesce(sum(x.amount), 0) into v_advrec
              from public.advance_recovery_transactions x
              where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
                and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
            else
              v_advrec := 0;
              for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
                v_advrec := v_advrec + coalesce(v_rec.deducted_amount, 0);
              end loop;
            end if;
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, amount, source, calc_type, calculation_ref, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, 'deduction', v_bif.code, v_bif.name, round(v_advrec, 2), 'advance_recovery', 'advance_recovery',
                    'advance_payroll_period:' || v_adv_period_id::text, v_bif.display_order);
            v_ded := v_ded + round(v_advrec, 2);
          else
            v_ltype := case v_bif.category when 'earning' then 'earning' when 'employer_contribution' then 'employer_contribution' else 'deduction' end;
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, calc_formula, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_ltype, v_bif.code, v_bif.name, null, v_bif.calc_rate, v_bif.amount, v_bif.category, v_bif.calculation_type, v_bif.calc_base, v_bif.calc_formula, v_bif.display_order);
            if v_ltype = 'earning' then v_gross := v_gross + v_bif.amount;
            elsif v_ltype = 'employer_contribution' then v_empc := v_empc + v_bif.amount;
            else v_ded := v_ded + v_bif.amount; end if;
            if v_bif.is_basic then v_basic := v_bif.amount; end if;
            if v_bif.code = 'DA' then v_da := v_bif.amount; end if;
          end if;
        end loop;

        if not exists (select 1 from public.payroll_lines where payroll_employee_result_id = v_result_id and calc_type = 'advance_recovery') then
          if exists (select 1 from public.advance_recovery_transactions x
                     where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
            select coalesce(sum(x.amount), 0) into v_advrec_extra
            from public.advance_recovery_transactions x
            where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
              and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
          else
            v_advrec_extra := 0;
            for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
              v_advrec_extra := v_advrec_extra + coalesce(v_rec.deducted_amount, 0);
            end loop;
          end if;
          if coalesce(v_advrec_extra, 0) > 0 or exists (select 1 from public.advance_recovery_plans p where p.employee_id = v_emp.id and p.status in ('recovering', 'recovery_pending')) then
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, amount, source, calc_type, calculation_ref, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, 'deduction', 'ADVREC', 'Advance Recovery', round(coalesce(v_advrec_extra, 0), 2), 'advance_recovery', 'advance_recovery',
                    'advance_payroll_period:' || v_adv_period_id::text, 95);
            v_ded := v_ded + round(coalesce(v_advrec_extra, 0), 2);
            v_advrec := coalesce(v_advrec_extra, 0);
          end if;
        end if;
      exception when others then
        delete from public.payroll_lines where payroll_employee_result_id = v_result_id;
        v_gross := 0; v_ded := 0; v_empc := 0; v_advrec := 0;
        v_review := true; v_notes := v_notes || 'Salary structure calculation failed: ' || sqlerrm || '. ';
      end;

      for v_comp in
        select * from public.payroll_salary_components
        where company_id = v_run.company_id and is_active and component_type = 'earning' and source in ('overtime', 'night_duty')
          and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
          and not (source = 'overtime' and v_pol.ot_enabled)
          and not (source = 'night_duty' and v_pol.nd_earning_enabled)
        order by sort_order, code
      loop
        v_qty := null; v_rate := null; v_amt := 0;
        if v_comp.source = 'overtime' then
          v_qty := round(v_ot_min / 60.0, 2); v_rate := v_pol.overtime_hourly_rate;
          if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Overtime hourly rate not configured. '; end if;
          else v_amt := round(v_qty * v_rate, 2); end if;
        else
          v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate;
          if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
          else v_amt := round(v_qty * v_rate, 2); end if;
        end if;
        insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
        values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, 'attendance_input', v_comp.sort_order);
        v_gross := v_gross + v_amt;
      end loop;

      v_gross_pre := v_gross;
      v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                  v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), v_struct_id,
                  v_leave, v_exit_pay);
      v_gross := (v_pol_j ->> 'gross')::numeric;
      v_ded := (v_pol_j ->> 'total_deductions')::numeric;
      v_net := (v_pol_j ->> 'net')::numeric;
      v_empc := v_empc + (v_pol_j ->> 'employer_contribution_extra')::numeric;
      if (v_pol_j ->> 'needs_review')::boolean then v_review := true; end if;
      if coalesce(v_pol_j ->> 'review_note', '') <> '' then v_notes := v_notes || (v_pol_j ->> 'review_note') || ' '; end if;
      v_hasneg := v_net < 0;

      update public.payroll_employee_results
      set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2),
          employer_contribution_total = v_empc, net_salary = v_net,
          salary_structure_id = v_struct_id, gross_from_structure = v_res_gross, structure_reconciled = true,
          basic_snapshot = v_basic, da_snapshot = v_da,
          policy_snapshot = v_pol_j -> 'snapshot',
          proration_factor = case when v_gross_pre = 0 then null else round(v_gross / nullif(v_gross_pre, 0), 6) end,
          lwp_deduction_amount = coalesce((v_pol_j ->> 'lwp_amount')::numeric, 0),
          statutory_deduction_total = coalesce((v_pol_j ->> 'statutory_total')::numeric, 0),
          exit_proration_amount = coalesce((v_pol_j ->> 'prorate_exit_amount')::numeric, 0),
          salary_structure_scope = v_ss_scope,
          has_negative_net = v_hasneg, needs_review = v_review, review_notes = nullif(v_notes, '')
      where id = v_result_id;

      v_r_gross := v_r_gross + v_gross; v_r_ded := v_r_ded + v_ded; v_r_adv := v_r_adv + round(v_advrec, 2); v_r_net := v_r_net + v_net; v_cnt := v_cnt + 1;
      continue;
    end if;
    -- ================= LEGACY Basic+DA path =================

    v_basic := coalesce(v_sal.basic_salary, 0);
    v_da := coalesce(v_sal.da, 0);
    if v_sal.effective_from is null then v_review := true; v_notes := v_notes || 'No effective salary structure for this period. '; end if;

    v_gross := 0;
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'earning'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        and not (source = 'overtime' and v_pol.ot_enabled)
        and not (source = 'night_duty' and v_pol.nd_earning_enabled)
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.source = 'basic' then v_amt := round(v_basic, 2);
      elsif v_comp.source = 'da' then v_amt := round(v_da, 2);
      elsif v_comp.source = 'overtime' then
        v_qty := round(v_ot_min / 60.0, 2); v_rate := v_pol.overtime_hourly_rate;
        if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Overtime hourly rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
      elsif v_comp.source = 'night_duty' then
        v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate;
        if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
      else v_amt := 0; end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, v_comp.calculation_method, v_comp.sort_order);
      v_gross := v_gross + v_amt;
    end loop;

    v_ded := 0; v_advrec := 0;
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'deduction'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        and not (calculation_method = 'lwp' and v_pol.lwp_enabled)
        and not (source = 'statutory' and exists (
                   select 1 from public.payroll_statutory_rules sr
                   where sr.payroll_policy_id = v_pol.id and sr.enabled and upper(sr.kind) = payroll_salary_components.code))
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.calculation_method = 'not_configured' then v_amt := 0;
      elsif v_comp.calculation_method = 'lwp' then
        if v_pol.lwp_divisor is not null and coalesce(v_lwp_days, 0) > 0 then
          v_rate := round((case v_pol.lwp_divisor_basis when 'basic' then v_basic when 'gross' then v_gross else v_basic + v_da end) / v_pol.lwp_divisor, 4);
          v_qty := v_lwp_days; v_amt := round(v_rate * v_lwp_days, 2);
        else
          v_amt := 0;
          if coalesce(v_lwp_days, 0) > 0 then v_review := true; v_notes := v_notes || format('%s LWP day(s) â€” LWP salary divisor not configured. ', v_lwp_days); end if;
        end if;
      elsif v_comp.calculation_method = 'advance_recovery' then
        if exists (select 1 from public.advance_recovery_transactions x
                   where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
          select coalesce(sum(x.amount), 0) into v_advrec
          from public.advance_recovery_transactions x
          where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
            and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
        else
          v_advrec := 0;
          for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
            v_advrec := v_advrec + coalesce(v_rec.deducted_amount, 0);
          end loop;
        end if;
        v_amt := round(v_advrec, 2);
      else v_amt := 0; end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, calculation_ref, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'deduction', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, v_comp.calculation_method,
              case when v_comp.calculation_method = 'advance_recovery' then 'advance_payroll_period:' || v_adv_period_id::text else null end, v_comp.sort_order);
      v_ded := v_ded + v_amt;
    end loop;

    v_gross_pre := v_gross;
    v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), null,
                v_leave, v_exit_pay);
    v_gross := (v_pol_j ->> 'gross')::numeric;
    v_ded := (v_pol_j ->> 'total_deductions')::numeric;
    v_net := (v_pol_j ->> 'net')::numeric;
    v_empc := (v_pol_j ->> 'employer_contribution_extra')::numeric;
    if (v_pol_j ->> 'needs_review')::boolean then v_review := true; end if;
    if coalesce(v_pol_j ->> 'review_note', '') <> '' then v_notes := v_notes || (v_pol_j ->> 'review_note') || ' '; end if;
    v_hasneg := v_net < 0;

    update public.payroll_employee_results
    set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2), net_salary = v_net,
        employer_contribution_total = coalesce(v_empc, 0),
        policy_snapshot = v_pol_j -> 'snapshot',
        proration_factor = case when v_gross_pre = 0 then null else round(v_gross / nullif(v_gross_pre, 0), 6) end,
        lwp_deduction_amount = coalesce((v_pol_j ->> 'lwp_amount')::numeric, 0),
        statutory_deduction_total = coalesce((v_pol_j ->> 'statutory_total')::numeric, 0),
        exit_proration_amount = coalesce((v_pol_j ->> 'prorate_exit_amount')::numeric, 0),
        salary_structure_scope = v_ss_scope,
        has_negative_net = v_hasneg, needs_review = v_review, review_notes = nullif(v_notes, '')
    where id = v_result_id;

    v_r_gross := v_r_gross + v_gross; v_r_ded := v_r_ded + v_ded; v_r_adv := v_r_adv + round(v_advrec, 2); v_r_net := v_r_net + v_net; v_cnt := v_cnt + 1;
  end loop;

  update public.payroll_runs
  set status = 'calculated', completed_at = now(),
      employee_count = v_cnt, gross_total = v_r_gross, deduction_total = v_r_ded, advance_recovery_total = v_r_adv, net_total = v_r_net
  where id = v_run.id
  returning * into v_run;
  update public.payroll_periods set status = 'calculated', updated_by = auth.uid() where id = v_period.id;
  return v_run;
end;
$function$;
grant execute on function public.payroll_calculate_run(uuid) to authenticated;


-- ============================================================================
-- Q. salary_bifurcate â€” Phase 7: per-component rounding_mode / rounding_precision
--    (none / nearest / floor / ceil). The legacy `rounding` token is still
--    honoured so an un-migrated component behaves EXACTLY as before.
-- ============================================================================
create or replace function public.salary_bifurcate(p_structure_id uuid, p_gross numeric)
returns table (
  code text, name text, category text, calculation_type text, calc_base text, calc_rate numeric, calc_formula text,
  amount numeric, included_in_gross boolean, included_in_ctc boolean, is_statutory boolean, statutory_kind text,
  display_order integer, is_basic boolean
)
language plpgsql
stable
security definer
as $function$
#variable_conflict use_column
declare
  v_struct public.salary_structures;
  v_comp record;
  v_prec int;
  v_basic_code text;
  v_resolved jsonb := '{}'::jsonb;
  v_pending text[];
  v_deps jsonb := '{}'::jsonb;
  v_dep text;
  v_ids text[];
  v_progress boolean;
  v_i int;
  v_code text;
  v_val numeric;
  v_expr text;
  v_base numeric;
  v_sum_gross numeric := 0;
  v_balance_seen boolean := false;
begin
  select * into v_struct from public.salary_structures where id = p_structure_id;
  if v_struct.id is null then raise exception 'Salary structure not found.'; end if;
  if p_gross is null or p_gross < 0 then raise exception 'Gross salary must be zero or greater.'; end if;

  v_prec := case v_struct.rounding when 'round_2' then 2 when 'nearest_rupee' then 0 else 6 end;

  select sc.code into v_basic_code from public.salary_structure_components sc
  where sc.salary_structure_id = p_structure_id and sc.is_active and sc.is_basic limit 1;

  for v_comp in
    select code, calculation_type from public.salary_structure_components
    where salary_structure_id = p_structure_id and is_active
    order by display_order, code
  loop
    v_pending := array_append(v_pending, v_comp.code);
    if v_comp.calculation_type = 'balance' then
      if v_balance_seen then raise exception 'A salary structure may contain only one Remaining/Balance component.'; end if;
      v_balance_seen := true;
    end if;
  end loop;
  if v_pending is null then raise exception 'Salary structure "%" has no active components.', v_struct.code; end if;

  v_deps := '{}'::jsonb;
  for v_comp in
    select * from public.salary_structure_components
    where salary_structure_id = p_structure_id and is_active
    order by display_order, code
  loop
    if v_comp.calculation_type in ('fixed', 'pct_of_gross', 'advance_recovery') then
      v_deps := v_deps || jsonb_build_object(v_comp.code, '[]'::jsonb);
    elsif v_comp.calculation_type = 'pct_of_basic' then
      if v_basic_code is null then raise exception 'Component "%" uses "percentage of Basic" but no active component is marked as Basic.', v_comp.code; end if;
      v_deps := v_deps || jsonb_build_object(v_comp.code, jsonb_build_array(v_basic_code));
    elsif v_comp.calculation_type = 'pct_of_component' then
      if v_comp.base_component_code is null
         or not exists (select 1 from public.salary_structure_components b where b.salary_structure_id = p_structure_id and b.is_active and b.code = v_comp.base_component_code) then
        raise exception 'Component "%" references an unknown/inactive base component "%".', v_comp.code, coalesce(v_comp.base_component_code, '(none)');
      end if;
      v_deps := v_deps || jsonb_build_object(v_comp.code, jsonb_build_array(v_comp.base_component_code));
    elsif v_comp.calculation_type = 'balance' then
      v_deps := v_deps || jsonb_build_object(v_comp.code, (
        select coalesce(jsonb_agg(o.code), '[]'::jsonb)
        from public.salary_structure_components o
        where o.salary_structure_id = p_structure_id and o.is_active and o.code <> v_comp.code and o.category = 'earning' and o.included_in_gross
      ));
    elsif v_comp.calculation_type = 'formula' then
      if coalesce(trim(v_comp.formula_expression), '') = '' then raise exception 'Component "%" is a formula but has no expression.', v_comp.code; end if;
      v_ids := array(
        select distinct m[1]
        from regexp_matches(v_comp.formula_expression, '([A-Za-z_][A-Za-z0-9_]*)', 'g') m
        where upper(m[1]) not in ('ROUND','MIN','MAX','ABS','LEAST','GREATEST','FLOOR','CEIL','CEILING','GROSS')
      );
      foreach v_dep in array coalesce(v_ids, array[]::text[]) loop
        if not exists (select 1 from public.salary_structure_components b where b.salary_structure_id = p_structure_id and b.is_active and b.code = v_dep) then
          raise exception 'Formula for "%" references unknown/inactive component "%".', v_comp.code, v_dep;
        end if;
      end loop;
      v_deps := v_deps || jsonb_build_object(v_comp.code, to_jsonb(coalesce(v_ids, array[]::text[])));
    else
      v_deps := v_deps || jsonb_build_object(v_comp.code, '[]'::jsonb);
    end if;
  end loop;

  while array_length(v_pending, 1) is not null loop
    v_progress := false;
    v_i := 1;
    while v_i <= coalesce(array_length(v_pending, 1), 0) loop
      v_code := v_pending[v_i];
      if not exists (
        select 1 from jsonb_array_elements_text(coalesce(v_deps -> v_code, '[]'::jsonb)) d
        where not (v_resolved ? d.value)
      ) then
        select * into v_comp from public.salary_structure_components
        where salary_structure_id = p_structure_id and is_active and code = v_code;

        if v_comp.calculation_type = 'fixed' then
          v_val := coalesce(v_comp.fixed_amount, 0);
        elsif v_comp.calculation_type = 'pct_of_gross' then
          v_val := p_gross * coalesce(v_comp.percentage, 0) / 100.0;
        elsif v_comp.calculation_type = 'pct_of_basic' then
          v_val := (v_resolved ->> v_basic_code)::numeric * coalesce(v_comp.percentage, 0) / 100.0;
        elsif v_comp.calculation_type = 'pct_of_component' then
          v_val := (v_resolved ->> v_comp.base_component_code)::numeric * coalesce(v_comp.percentage, 0) / 100.0;
        elsif v_comp.calculation_type = 'formula' then
          v_expr := v_comp.formula_expression;
          v_expr := regexp_replace(v_expr, '\mGROSS\M', p_gross::text, 'gi');
          for v_dep in select jsonb_array_elements_text(coalesce(v_deps -> v_code, '[]'::jsonb)) loop
            v_expr := regexp_replace(v_expr, '\m' || v_dep || '\M', '(' || (v_resolved ->> v_dep) || ')', 'g');
          end loop;
          if regexp_replace(v_expr, '(round|min|max|abs|least|greatest|floor|ceil|ceiling)', '', 'gi') ~ '[A-Za-z]' then
            raise exception 'Formula for "%" could not be safely evaluated (unresolved token).', v_code;
          end if;
          if v_expr ~ '[;\\]' or v_expr ~* '(select|insert|update|delete|drop|;|--)' then
            raise exception 'Formula for "%" contains a disallowed token.', v_code;
          end if;
          execute format('select (%s)::numeric', v_expr) into v_val;
        elsif v_comp.calculation_type = 'balance' then
          select coalesce(sum((v_resolved ->> d.value)::numeric), 0) into v_base
          from jsonb_array_elements_text(coalesce(v_deps -> v_code, '[]'::jsonb)) d;
          v_val := p_gross - v_base;
          if v_val < 0 and not v_struct.allow_negative_balance then
            raise exception 'Salary structure "%" balance component "%" is negative (%). Adjust components or allow negative balance.', v_struct.code, v_code, v_val;
          end if;
        elsif v_comp.calculation_type = 'advance_recovery' then
          v_val := 0;
        else
          v_val := 0;
        end if;

        if v_comp.is_statutory and v_comp.calculation_type not in ('fixed', 'formula') then
          if v_comp.statutory_rate is null then
            v_val := 0;
          else
            v_base := case v_comp.statutory_base
                        when 'basic' then coalesce((v_resolved ->> v_basic_code)::numeric, 0)
                        when 'basic_da' then coalesce((v_resolved ->> v_basic_code)::numeric, 0)
                                            + coalesce((select (v_resolved ->> o.code)::numeric from public.salary_structure_components o
                                                        where o.salary_structure_id = p_structure_id and o.is_active and o.code = 'DA'), 0)
                        when 'gross' then p_gross
                        when 'component' then coalesce((v_resolved ->> v_comp.base_component_code)::numeric, 0)
                        else 0 end;
            if v_comp.statutory_ceiling is not null then v_base := least(v_base, v_comp.statutory_ceiling); end if;
            v_val := v_base * v_comp.statutory_rate / 100.0;
          end if;
        end if;

        -- Phase 7: per-component rounding (mode + precision); legacy `rounding` token still honoured.
        v_val := public.payroll_round(
          v_val,
          coalesce(v_comp.rounding_mode, 'nearest'),
          coalesce(v_comp.rounding_precision,
                   case coalesce(v_comp.rounding, v_struct.rounding)
                     when 'round_2' then 2 when 'nearest_rupee' then 0 else v_prec end));

        v_resolved := v_resolved || jsonb_build_object(v_code, v_val);
        v_pending := array_remove(v_pending, v_code);
        v_progress := true;
        v_i := 1;
        continue;
      end if;
      v_i := v_i + 1;
    end loop;

    if not v_progress then
      raise exception 'Circular salary component dependency detected among: %', array_to_string(v_pending, ', ');
    end if;
  end loop;

  if v_struct.gross_balanced and not v_balance_seen then
    select coalesce(sum((v_resolved ->> sc.code)::numeric), 0) into v_sum_gross
    from public.salary_structure_components sc
    where sc.salary_structure_id = p_structure_id and sc.is_active and sc.category = 'earning' and sc.included_in_gross;
    if round(v_sum_gross, greatest(v_prec, 2)) <> round(p_gross, greatest(v_prec, 2)) then
      raise exception 'Included earnings (%) do not reconcile with Gross (%). Add a Balance component or fix the percentages.', v_sum_gross, p_gross;
    end if;
  end if;

  return query
  select sc.code, sc.name, sc.category, sc.calculation_type,
         case sc.calculation_type
           when 'pct_of_gross' then 'GROSS'
           when 'pct_of_basic' then v_basic_code
           when 'pct_of_component' then sc.base_component_code
           when 'formula' then null
           else null end,
         case sc.calculation_type when 'formula' then null when 'fixed' then null else sc.percentage end,
         case sc.calculation_type when 'formula' then sc.formula_expression else null end,
         (v_resolved ->> sc.code)::numeric,
         sc.included_in_gross, sc.included_in_ctc, sc.is_statutory, sc.statutory_kind, sc.display_order, sc.is_basic
  from public.salary_structure_components sc
  where sc.salary_structure_id = p_structure_id and sc.is_active
  order by sc.display_order, sc.code;
end;
$function$;
revoke execute on function public.salary_bifurcate(uuid, numeric) from public;
grant execute on function public.salary_bifurcate(uuid, numeric) to authenticated;

-- ============================================================================
-- R. payroll_policy_preview â€” Phase 7: scoped policy resolution + leaving-date /
--    exit-month proration + real-TDS + store-calendar working days. SAME engine.
-- ============================================================================
create or replace function public.payroll_policy_preview(p_employee_id uuid, p_period_month date, p_inputs jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
as $function$
declare
  v_company uuid; v_store uuid; v_pstart date; v_pend date; v_working numeric;
  v_pol public.payroll_policies;
  v_res record; v_struct uuid; v_gross numeric; v_basic numeric; v_da numeric;
  v_bif record;
  v_earn jsonb := '[]'::jsonb; v_ded jsonb := '[]'::jsonb; v_empc jsonb := '[]'::jsonb;
  l record; v_fin jsonb; o jsonb;
  v_g numeric := 0; v_join date; v_leave date; v_exit_pay boolean; v_adv numeric;
  v_lines_deds jsonb := '[]'::jsonb;
  v_cal public.store_payroll_calendars;
  v_tds_pol public.tds_policies; v_tds jsonb := null; v_annual numeric; v_decl record; v_fy date;
begin
  select company_id, store_id, joining_date, leaving_date into v_company, v_store, v_join, v_leave from public.employees where id = p_employee_id;
  if v_company is null then raise exception 'Employee not found.'; end if;
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and v_company = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  v_pstart := date_trunc('month', p_period_month)::date;
  v_pend := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  v_working := (v_pend - v_pstart + 1);
  v_pol := public.payroll_resolve_policy_for_employee(v_company, p_employee_id, v_pend);
  v_join := coalesce((p_inputs ->> 'joining_date')::date, v_join);
  v_leave := coalesce((p_inputs ->> 'leaving_date')::date, v_leave);
  v_exit_pay := v_pol.exit_date_payable;

  if v_pol.working_days_method = 'store_calendar' then
    v_cal := public.payroll_resolve_store_calendar(v_company, v_store, v_pend);
    if v_cal.id is not null then v_working := coalesce(public.payroll_calendar_working_days(v_cal.id, v_pstart, v_pend), v_working); end if;
  end if;

  select r.gross_salary, r.salary_structure_id into v_res from public.salary_resolve_for_employee(p_employee_id, v_pend) r;
  v_gross := coalesce((p_inputs ->> 'gross')::numeric, v_res.gross_salary, 0);
  v_struct := v_res.salary_structure_id;
  v_basic := coalesce((p_inputs ->> 'basic')::numeric, 0);
  v_da := coalesce((p_inputs ->> 'da')::numeric, 0);

  if v_struct is not null then
    for v_bif in select * from public.salary_bifurcate(v_struct, v_gross) loop
      if v_bif.calculation_type = 'advance_recovery' then continue;
      elsif v_bif.category = 'earning' then
        v_earn := v_earn || jsonb_build_object('code', v_bif.code, 'name', v_bif.name, 'amount', v_bif.amount, 'calc_type', v_bif.calculation_type, 'calc_base', v_bif.calc_base);
        v_g := v_g + v_bif.amount;
        if v_bif.is_basic then v_basic := v_bif.amount; end if;
        if v_bif.code = 'DA' then v_da := v_bif.amount; end if;
      elsif v_bif.category = 'employer_contribution' then
        v_empc := v_empc || jsonb_build_object('code', v_bif.code, 'name', v_bif.name, 'amount', v_bif.amount);
      else
        v_ded := v_ded || jsonb_build_object('code', v_bif.code, 'name', v_bif.name, 'amount', v_bif.amount, 'calc_type', v_bif.calculation_type);
        v_lines_deds := v_lines_deds || jsonb_build_object('code', v_bif.code, 'amount', v_bif.amount);
      end if;
    end loop;
  else
    v_g := v_gross;
    v_earn := jsonb_build_array(jsonb_build_object('code', 'GROSS', 'name', 'Gross (flat)', 'amount', v_gross, 'calc_type', 'flat'));
  end if;

  v_adv := coalesce((p_inputs ->> 'advance_recovery')::numeric, 0);
  if v_adv > 0 then
    v_ded := v_ded || jsonb_build_object('code', 'ADVREC', 'name', 'Advance Recovery', 'amount', v_adv, 'calc_type', 'advance_recovery');
    v_lines_deds := v_lines_deds || jsonb_build_object('code', 'ADVREC', 'amount', v_adv, 'protected', true);
  end if;
  for o in select * from jsonb_array_elements(coalesce(p_inputs -> 'other_deductions', '[]'::jsonb)) loop
    v_ded := v_ded || (o || jsonb_build_object('calc_type', 'other'));
    v_lines_deds := v_lines_deds || jsonb_build_object('code', o ->> 'code', 'amount', (o ->> 'amount')::numeric);
  end loop;

  -- real TDS (inert unless fully configured)
  v_tds_pol := public.tds_resolve_policy(v_company, v_pend);
  if v_tds_pol.id is not null then
    if v_tds_pol.annualization_method = 'flat_x12' then
      v_fy := coalesce(v_tds_pol.financial_year_start, make_date(extract(year from v_pend)::int, 4, 1));
      select * into v_decl from public.tds_employee_declarations where employee_id = p_employee_id and financial_year_start = v_fy;
      v_annual := greatest(v_g * 12 + coalesce(v_decl.previous_employer_income, 0) + coalesce(v_decl.other_income, 0)
        - coalesce(v_tds_pol.standard_deduction, 0) - coalesce(v_decl.investment_declared, 0) - coalesce(v_decl.other_exemptions, 0), 0);
      v_tds := public.tds_compute(v_tds_pol.id, v_annual);
    else
      v_tds := jsonb_build_object('configured', false, 'reason', format('Annualization method "%s" needs year-to-date income.', coalesce(v_tds_pol.annualization_method, 'not defined')));
    end if;
  end if;

  for l in select * from public.payroll_policy_compute_lines(
             v_pol.id, v_pstart, v_pend, v_working, v_join, v_basic, v_da, v_g,
             coalesce((p_inputs ->> 'lwp_days')::numeric, 0),
             coalesce((p_inputs ->> 'ot_minutes')::numeric, 0),
             coalesce((p_inputs ->> 'nd_value')::numeric, 0),
             v_struct, (select coalesce(array_agg(x->>'code'), '{}') from jsonb_array_elements(v_earn || v_ded) x),
             v_leave, v_exit_pay, v_tds)
  loop
    if l.line_type = 'earning' then
      v_earn := v_earn || jsonb_build_object('code', l.code, 'name', l.name, 'amount', l.amount, 'calc_type', l.calc_type, 'note', l.calc_note, 'unresolved', l.unresolved);
      v_g := v_g + l.amount;
    elsif l.line_type = 'employer_contribution' then
      v_empc := v_empc || jsonb_build_object('code', l.code, 'name', l.name, 'amount', l.amount, 'note', l.calc_note);
    else
      v_ded := v_ded || jsonb_build_object('code', l.code, 'name', l.name, 'amount', l.amount, 'calc_type', l.calc_type, 'note', l.calc_note, 'unresolved', l.unresolved);
      v_lines_deds := v_lines_deds || jsonb_build_object('code', l.code, 'amount', l.amount);
    end if;
  end loop;

  v_fin := public.payroll_policy_finalize(v_pol.id, v_g, v_lines_deds);

  return jsonb_build_object(
    'policy', jsonb_build_object('id', v_pol.id, 'code', v_pol.code, 'name', v_pol.policy_name, 'version_no', v_pol.version_no,
                                 'effective_from', v_pol.effective_from, 'effective_to', v_pol.effective_to,
                                 'working_days_method', v_pol.working_days_method, 'exit_date_payable', v_pol.exit_date_payable),
    'store_calendar', case when v_cal.id is not null then jsonb_build_object('id', v_cal.id, 'name', v_cal.name, 'working_days', v_working) else null end,
    'gross', v_g,
    'earnings', v_earn,
    'deductions', v_fin -> 'ordered',
    'employer_contributions', v_empc,
    'total_deductions', v_fin -> 'total_deductions',
    'net_salary', v_fin -> 'net',
    'cap', v_fin -> 'cap',
    'cap_reduction', v_fin -> 'cap_reduction',
    'negative_net_policy', v_fin -> 'negative_net_policy',
    'negative_flag', v_fin -> 'negative_flag',
    'priority_configured', v_fin -> 'priority_configured',
    'tds', coalesce(v_tds, jsonb_build_object('configured', false, 'reason', 'No active TDS policy.'))
  );
end;
$function$;
grant execute on function public.payroll_policy_preview(uuid, date, jsonb) to authenticated;

-- ============================================================================
-- S. List / helper RPCs for the UI.
-- ============================================================================
create or replace function public.employee_grades_list(p_company_id uuid)
returns setof public.employee_grades language sql stable security definer as $$
  select * from public.employee_grades g
  where g.company_id = p_company_id and (is_super_admin() or (current_user_role() <> 'staff' and p_company_id = current_user_company_id()))
  order by g.display_order, g.code;
$$;
grant execute on function public.employee_grades_list(uuid) to authenticated;

create or replace function public.employee_categories_list(p_company_id uuid)
returns setof public.employee_categories language sql stable security definer as $$
  select * from public.employee_categories c
  where c.company_id = p_company_id and (is_super_admin() or (current_user_role() <> 'staff' and p_company_id = current_user_company_id()))
  order by c.display_order, c.code;
$$;
grant execute on function public.employee_categories_list(uuid) to authenticated;

create or replace function public.payroll_policy_assignments_list(p_company_id uuid)
returns setof public.payroll_policy_assignments language sql stable security definer as $$
  select * from public.payroll_policy_assignments a
  where a.company_id = p_company_id and (is_super_admin() or (current_user_role() <> 'staff' and p_company_id = current_user_company_id()))
  order by a.scope_type, a.effective_from desc;
$$;
grant execute on function public.payroll_policy_assignments_list(uuid) to authenticated;

create or replace function public.store_payroll_calendars_list(p_company_id uuid)
returns setof public.store_payroll_calendars language sql stable security definer as $$
  select * from public.store_payroll_calendars c
  where c.company_id = p_company_id and (is_super_admin() or (current_user_role() <> 'staff' and p_company_id = current_user_company_id()))
  order by c.store_id nulls first, c.effective_from desc;
$$;
grant execute on function public.store_payroll_calendars_list(uuid) to authenticated;

create or replace function public.store_calendar_preview(p_calendar_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer as $$
declare v_cal public.store_payroll_calendars; v_wd int;
begin
  select * into v_cal from public.store_payroll_calendars where id = p_calendar_id;
  if v_cal.id is null then raise exception 'Calendar not found.'; end if;
  if not (is_super_admin() or (current_user_role() <> 'staff' and v_cal.company_id = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  v_wd := public.payroll_calendar_working_days(p_calendar_id, p_start, p_end);
  return jsonb_build_object('period_days', (p_end - p_start + 1), 'working_days', v_wd,
    'weekly_off_days', to_jsonb(v_cal.weekly_off_days), 'alternate_saturday_off', v_cal.alternate_saturday_off,
    'holiday_source', v_cal.holiday_source);
end;
$$;
grant execute on function public.store_calendar_preview(uuid, date, date) to authenticated;

create or replace function public.tds_policies_list(p_company_id uuid)
returns setof public.tds_policies language sql stable security definer as $$
  select * from public.tds_policies p
  where p.company_id = p_company_id and (is_super_admin() or (current_user_role() <> 'staff' and p_company_id = current_user_company_id()))
  order by p.effective_from desc, p.version_no desc;
$$;
grant execute on function public.tds_policies_list(uuid) to authenticated;

create or replace function public.tds_slabs_list(p_policy_id uuid)
returns setof public.tds_slabs language sql stable security definer as $$
  select s.* from public.tds_slabs s join public.tds_policies p on p.id = s.tds_policy_id
  where s.tds_policy_id = p_policy_id and (is_super_admin() or (current_user_role() <> 'staff' and p.company_id = current_user_company_id()))
  order by s.min_income;
$$;
grant execute on function public.tds_slabs_list(uuid) to authenticated;

create or replace function public.payroll_policy_change_history_list(p_employee_id uuid)
returns setof public.payroll_policy_change_history language sql stable security definer as $$
  select h.* from public.payroll_policy_change_history h
  where h.employee_id = p_employee_id
    and (is_super_admin() or (current_user_role() <> 'staff' and h.company_id = current_user_company_id()) or h.employee_id = current_user_employee_id())
  order by h.effective_from desc;
$$;
grant execute on function public.payroll_policy_change_history_list(uuid) to authenticated;


-- ============================================================================
-- T. Guard: only Super-Admin / Payroll manager may change an employee's
--    payroll-critical fields (Â§5 / Â§55 / Â§77). Staff can never edit their own
--    leaving date / grade / category / exit status / joining date.
-- ============================================================================
create or replace function public.employees_guard_payroll_fields()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.leaving_date is distinct from old.leaving_date
     or new.exit_reason is distinct from old.exit_reason
     or new.exit_status is distinct from old.exit_status
     or new.grade_id is distinct from old.grade_id
     or new.category_id is distinct from old.category_id
     or new.joining_date is distinct from old.joining_date then
    if public.current_user_role() = 'staff' and not public.is_super_admin() then
      raise exception 'Staff may not change employment timeline (joining / leaving date), grade, category or exit status.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employees_guard_payroll_fields on public.employees;
create trigger trg_employees_guard_payroll_fields
  before update on public.employees
  for each row execute function public.employees_guard_payroll_fields();

-- ============================================================================
-- U. payroll_get_employee_result â€” expose the Phase 7 snapshot fields.
-- ============================================================================
drop function if exists public.payroll_get_employee_result(uuid);
create function public.payroll_get_employee_result(p_result_id uuid)
returns table (
  result_id uuid, payroll_run_id uuid, run_status text, period_month date,
  employee_id uuid, employee_code text, employee_name text, department text, designation text, store text,
  salary_effective_from date, basic numeric, da numeric,
  calendar_days int, working_days numeric, present_days numeric, paid_leave_days numeric, lwp_days numeric,
  weekly_off_days numeric, holiday_days numeric, absent_days numeric, paid_days numeric, unpaid_days numeric,
  gross_earnings numeric, total_deductions numeric, advance_recovery_amount numeric, net_salary numeric,
  employer_contribution_total numeric, salary_structure_id uuid, structure_name text, gross_from_structure numeric, structure_reconciled boolean,
  payroll_policy_id uuid, policy_snapshot jsonb, proration_factor numeric, lwp_deduction_amount numeric, statutory_deduction_total numeric,
  store_calendar_id uuid, store_calendar_snapshot jsonb, exit_proration_amount numeric, eligible_days numeric,
  salary_structure_scope text, payroll_policy_scope text, leaving_date_snapshot date,
  has_negative_net boolean, needs_review boolean, review_notes text, status text
)
language plpgsql
stable
security definer
as $$
begin
  return query
  select r.id, r.payroll_run_id, pr.status, pp.period_month,
         r.employee_id, r.employee_code_snapshot, r.employee_name_snapshot, r.department_snapshot, r.designation_snapshot, r.store_snapshot,
         r.salary_effective_from, r.basic_snapshot, r.da_snapshot,
         r.calendar_days, r.working_days, r.present_days, r.paid_leave_days, r.lwp_days,
         r.weekly_off_days, r.holiday_days, r.absent_days, r.paid_days, r.unpaid_days,
         r.gross_earnings, r.total_deductions, r.advance_recovery_amount, r.net_salary,
         r.employer_contribution_total, r.salary_structure_id, ss.name, r.gross_from_structure, r.structure_reconciled,
         r.payroll_policy_id, r.policy_snapshot, r.proration_factor, r.lwp_deduction_amount, r.statutory_deduction_total,
         r.store_calendar_id, r.store_calendar_snapshot, r.exit_proration_amount, r.eligible_days,
         r.salary_structure_scope, r.payroll_policy_scope, r.leaving_date_snapshot,
         r.has_negative_net, r.needs_review, r.review_notes, r.status
  from public.payroll_employee_results r
  join public.payroll_runs pr on pr.id = r.payroll_run_id
  join public.payroll_periods pp on pp.id = r.payroll_period_id
  left join public.salary_structures ss on ss.id = r.salary_structure_id
  where r.id = p_result_id
    and (public.is_super_admin()
         or (current_user_role() <> 'staff' and r.company_id = current_user_company_id())
         or r.employee_id = current_user_employee_id());
end;
$$;
grant execute on function public.payroll_get_employee_result(uuid) to authenticated;


-- ============================================================================
-- Phase 7 fix patch (applied 2026-09-03): the payroll-field guard lets an
-- elevated user (Super-Admin / active Payroll manager) set exit dates / grade /
-- category; only a plain staff user is blocked.
-- ============================================================================
-- Phase 7 fix: the payroll-field guard must let an elevated user (Super-Admin
-- or an active Payroll manager) set exit dates / grade / category. Only a plain
-- staff user (no elevated context) is blocked (Â§5 / Â§77).
create or replace function public.employees_guard_payroll_fields()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.leaving_date is distinct from old.leaving_date
     or new.exit_reason is distinct from old.exit_reason
     or new.exit_status is distinct from old.exit_status
     or new.grade_id is distinct from old.grade_id
     or new.category_id is distinct from old.category_id
     or new.joining_date is distinct from old.joining_date then
    if public.current_user_role() = 'staff'
       and not public.is_super_admin()
       and not public.payroll_can_manage(old.company_id) then
      raise exception 'Staff may not change employment timeline (joining / leaving date), grade, category or exit status.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
