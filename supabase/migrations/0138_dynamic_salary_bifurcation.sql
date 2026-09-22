-- ============================================================================
-- Retail HRMS — Phase 5A: DYNAMIC SALARY BIFURCATION ENGINE
--   Salary Structure master + configurable components (6 calculation types) +
--   safe Formula engine + automatic dependency ordering + circular-dependency
--   detection + Remaining/Balance + Salary Slabs + 6-tier structure assignment
--   + effective-dated per-employee salary revision + Preview (same engine as
--   payroll) + Payroll Run integration + snapshot. NO hard-coded bifurcation.
-- Migration 0138
--
-- INSPECTION: Phase 5 (0137) already provides payroll_periods / _runs /
-- _employee_results / _lines / payslips / payroll_salary_components (a flat
-- component master) / payroll_policies, and payroll_calculate_run reads Basic +
-- DA directly from employee_salary_components. Phase 5A UPGRADES the
-- salary-calculation layer: a resolved structure is now bifurcated by the
-- dynamic engine; when NO structure resolves the legacy Basic+DA path is kept
-- unchanged (safe bridge — no data dropped, no history rewritten).
--
-- NOT invented (flagged UNRESOLVED; each has a config field / integration
-- point): PF / ESI / PT / TDS rates + ceilings, LWP divisor, salary proration
-- divisor, overtime rate, statutory deduction priority, deduction cap. Rate =
-- NULL => that line computes to ₹0 and the payroll result is flagged.
--
-- Reuses: current_user_*(), is_super_admin(), write_audit_log(),
-- set_updated_at(), payroll_can_manage(), advance_recovery_run_period().
-- btree_gist is already installed (used for slab / revision overlap guards).
-- Nothing in Attendance / Leave / Night Duty / Advance Phase 1-4 / existing
-- Payslips is modified. No app_role change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Additive extensions to the Phase 5 payroll tables.
-- ----------------------------------------------------------------------------
alter table public.payroll_lines drop constraint payroll_lines_line_type_check;
alter table public.payroll_lines add constraint payroll_lines_line_type_check
  check (line_type in ('earning', 'deduction', 'employer_contribution'));
alter table public.payroll_lines
  add column if not exists calc_type text,
  add column if not exists calc_base text,
  add column if not exists calc_rate numeric,
  add column if not exists calc_formula text;

alter table public.payroll_employee_results
  add column if not exists salary_structure_id uuid,
  add column if not exists gross_from_structure numeric,
  add column if not exists employer_contribution_total numeric not null default 0,
  add column if not exists structure_reconciled boolean;

-- ----------------------------------------------------------------------------
-- A. salary_structures — the structure master (versioned; one active per code).
-- ----------------------------------------------------------------------------
create table if not exists public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive', 'archived')),
  gross_balanced boolean not null default true,
  allow_negative_balance boolean not null default false,
  rounding text not null default 'round_2' check (rounding in ('none', 'nearest_rupee', 'round_2')),
  effective_from date not null default current_date,
  effective_to date,
  previous_version_id uuid references public.salary_structures (id),
  change_reason text,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_salary_structures_company on public.salary_structures (company_id, status);

-- ----------------------------------------------------------------------------
-- B. salary_structure_components — every configurable component. Six mandatory
--    calculation types + advance_recovery bridge.
-- ----------------------------------------------------------------------------
create table if not exists public.salary_structure_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  salary_structure_id uuid not null references public.salary_structures (id) on delete cascade,
  code text not null,
  name text not null,
  category text not null check (category in ('earning', 'employee_deduction', 'employer_contribution')),
  calculation_type text not null
    check (calculation_type in ('fixed', 'pct_of_gross', 'pct_of_basic', 'pct_of_component', 'formula', 'balance', 'advance_recovery')),
  fixed_amount numeric,
  percentage numeric check (percentage is null or percentage >= 0),
  base_component_code text,
  formula_expression text,
  is_basic boolean not null default false,
  included_in_gross boolean not null default true,
  included_in_ctc boolean not null default true,
  is_taxable boolean not null default false,
  is_statutory boolean not null default false,
  statutory_kind text check (statutory_kind is null or statutory_kind in ('pf', 'esi', 'pt', 'tds', 'gratuity', 'other')),
  statutory_base text check (statutory_base is null or statutory_base in ('basic', 'basic_da', 'gross', 'component', 'formula')),
  statutory_rate numeric check (statutory_rate is null or statutory_rate >= 0),      -- NULL = UNRESOLVED
  statutory_ceiling numeric check (statutory_ceiling is null or statutory_ceiling >= 0),
  rounding text check (rounding is null or rounding in ('none', 'nearest_rupee', 'round_2')),
  display_order int not null default 100,
  is_active boolean not null default true,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salary_structure_id, code)
);
create index if not exists idx_salary_structure_components_structure on public.salary_structure_components (salary_structure_id, display_order);

-- ----------------------------------------------------------------------------
-- C. salary_slab_rules — Gross-range -> structure routing. Overlapping active
--    ranges per company are rejected by the exclusion constraint (§20).
-- ----------------------------------------------------------------------------
create table if not exists public.salary_slab_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  salary_structure_id uuid not null references public.salary_structures (id) on delete cascade,
  min_gross numeric not null check (min_gross >= 0),
  max_gross numeric check (max_gross is null or max_gross >= min_gross),
  label text,
  priority int not null default 100,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  exclude using gist (
    company_id with =,
    numrange(min_gross, coalesce(max_gross, 'infinity'::numeric), '[]') with &&
  ) where (is_active)
);
create index if not exists idx_salary_slab_rules_company on public.salary_slab_rules (company_id, is_active);

-- ----------------------------------------------------------------------------
-- D. salary_structure_assignments — 6-tier deterministic assignment.
--    Grade / Category / Location scopes are NOT offered (no matching column on
--    the employee master — flagged in the Phase 5A report).
-- ----------------------------------------------------------------------------
create table if not exists public.salary_structure_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  salary_structure_id uuid not null references public.salary_structures (id) on delete cascade,
  scope_type text not null check (scope_type in ('employee', 'store_designation', 'store_department', 'store', 'employment_type', 'company')),
  employee_id uuid references public.employees (id) on delete cascade,
  store_designation_id uuid references public.store_designations (id) on delete cascade,
  store_department_id uuid references public.store_departments (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  employment_type text,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  priority int not null default 100,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'employee' and employee_id is not null) or
    (scope_type = 'store_designation' and store_designation_id is not null) or
    (scope_type = 'store_department' and store_department_id is not null) or
    (scope_type = 'store' and store_id is not null) or
    (scope_type = 'employment_type' and employment_type is not null) or
    (scope_type = 'company')
  ),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_salary_structure_assignments_company on public.salary_structure_assignments (company_id, scope_type, is_active);

-- ----------------------------------------------------------------------------
-- E. employee_salary_assignments — per-employee salary revision history. The
--    dynamic-era salary source (Gross + optional explicit structure). The
--    legacy employee_salary_components table is KEPT and used as fallback.
--    Overlapping salary periods per employee are impossible (exclusion
--    constraint); no DELETE policy -> history is permanent (§23).
-- ----------------------------------------------------------------------------
create table if not exists public.employee_salary_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  salary_structure_id uuid references public.salary_structures (id) on delete set null,
  gross_salary numeric not null check (gross_salary > 0),
  effective_from date not null,
  effective_to date,
  previous_assignment_id uuid references public.employee_salary_assignments (id),
  assigned_by uuid,
  reason text,
  remark text,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  exclude using gist (
    company_id with =,
    employee_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
);
create index if not exists idx_employee_salary_assignments_emp on public.employee_salary_assignments (employee_id, effective_from);

alter table public.salary_structures enable row level security;
alter table public.salary_structure_components enable row level security;
alter table public.salary_slab_rules enable row level security;
alter table public.salary_structure_assignments enable row level security;
alter table public.employee_salary_assignments enable row level security;

do $trg$
declare t text;
begin
  for t in select unnest(array['salary_structures','salary_structure_components','salary_slab_rules','salary_structure_assignments']) loop
    execute format('create trigger trg_%1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at();', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function public.write_audit_log();', t);
  end loop;
  execute 'create trigger trg_employee_salary_assignments_audit after insert or update or delete on public.employee_salary_assignments for each row execute function public.write_audit_log();';
end $trg$;

-- ----------------------------------------------------------------------------
-- RLS. Structure config: Super-Admin write, admin (non-staff same company)
-- read. employee_salary_assignments additionally readable by the owning
-- employee. No DELETE anywhere on employee_salary_assignments.
-- ----------------------------------------------------------------------------
do $rls$
declare t text;
begin
  for t in select unnest(array['salary_structures','salary_structure_components','salary_slab_rules','salary_structure_assignments']) loop
    execute format($f$create policy "%1$s_select" on public.%1$s for select
      using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$f$, t);
    execute format($f$create policy "%1$s_write"  on public.%1$s for insert with check (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_update" on public.%1$s for update using (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_delete" on public.%1$s for delete using (is_super_admin());$f$, t);
  end loop;
end $rls$;
create policy "employee_salary_assignments_select" on public.employee_salary_assignments for select
  using (is_super_admin()
         or (current_user_role() <> 'staff' and company_id = current_user_company_id())
         or employee_id = current_user_employee_id());
create policy "employee_salary_assignments_write"  on public.employee_salary_assignments for insert with check (is_super_admin());
create policy "employee_salary_assignments_update" on public.employee_salary_assignments for update using (is_super_admin());
-- no DELETE policy -> immutable revision history.

-- ============================================================================
-- THE ENGINE. salary_bifurcate() is the SINGLE calculation function used by
-- BOTH Preview and the Payroll Run (§27). Deterministic, NUMERIC-only, safe
-- formula evaluation (no eval / no arbitrary SQL).
-- ============================================================================
create or replace function public.salary_bifurcate(p_structure_id uuid, p_gross numeric)
returns table (
  code text, name text, category text, calculation_type text,
  calc_base text, calc_rate numeric, calc_formula text, amount numeric,
  included_in_gross boolean, included_in_ctc boolean, is_statutory boolean,
  statutory_kind text, display_order int, is_basic boolean
)
language plpgsql
stable
security definer
as $$
#variable_conflict use_column
declare
  v_struct public.salary_structures;
  v_comp record;
  v_prec int;
  v_basic_code text;
  v_resolved jsonb := '{}'::jsonb;     -- code -> numeric value
  v_pending text[];                    -- codes not yet resolved
  v_deps jsonb := '{}'::jsonb;         -- code -> [dep codes]
  v_dep text;
  v_ids text[];
  v_progress boolean;
  v_i int;
  v_round_prec int;
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

  -- ---- pending list + single-balance guard ----
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

  -- ---- dependency map for every component ----
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
      -- extract identifier tokens, drop whitelisted functions + GROSS keyword
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

  -- ---- resolve in dependency order; detect cycles ----
  while array_length(v_pending, 1) is not null loop
    v_progress := false;
    v_i := 1;
    while v_i <= coalesce(array_length(v_pending, 1), 0) loop
      v_code := v_pending[v_i];
      -- all deps resolved?
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
          -- safety: after substitution nothing but numbers / operators / whitelisted fns may remain
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
          v_val := 0;   -- injected by payroll from Phase 4; preview shows 0
        else
          v_val := 0;
        end if;

        -- statutory override (rate NULL => UNRESOLVED => 0)
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

        -- rounding
        v_round_prec := case coalesce(v_comp.rounding, v_struct.rounding)
                          when 'round_2' then 2 when 'nearest_rupee' then 0 else v_prec end;
        v_val := round(v_val, v_round_prec);

        v_resolved := v_resolved || jsonb_build_object(v_code, v_val);
        v_pending := array_remove(v_pending, v_code);
        v_progress := true;
        -- restart inner scan (array shrank)
        v_i := 1;
        continue;
      end if;
      v_i := v_i + 1;
    end loop;

    if not v_progress then
      raise exception 'Circular salary component dependency detected among: %', array_to_string(v_pending, ', ');
    end if;
  end loop;

  -- ---- gross reconciliation (only when no balance component absorbs the diff) ----
  if v_struct.gross_balanced and not v_balance_seen then
    select coalesce(sum((v_resolved ->> sc.code)::numeric), 0) into v_sum_gross
    from public.salary_structure_components sc
    where sc.salary_structure_id = p_structure_id and sc.is_active and sc.category = 'earning' and sc.included_in_gross;
    if round(v_sum_gross, greatest(v_prec, 2)) <> round(p_gross, greatest(v_prec, 2)) then
      raise exception 'Included earnings (%) do not reconcile with Gross (%). Add a Balance component or fix the percentages.', v_sum_gross, p_gross;
    end if;
  end if;

  -- ---- emit ----
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
$$;
revoke execute on function public.salary_bifurcate(uuid, numeric) from public, authenticated;
grant execute on function public.salary_bifurcate(uuid, numeric) to authenticated;   -- read-only; used by preview + payroll

-- ----------------------------------------------------------------------------
-- salary_preview() — UI wrapper (auth: payroll admin). Same engine.
-- ----------------------------------------------------------------------------
create or replace function public.salary_preview(p_structure_id uuid, p_gross numeric)
returns table (
  code text, name text, category text, calculation_type text, calc_base text, calc_rate numeric,
  calc_formula text, amount numeric, included_in_gross boolean, included_in_ctc boolean, is_statutory boolean
)
language plpgsql
stable
security definer
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.salary_structures where id = p_structure_id;
  if v_company is null then raise exception 'Salary structure not found.'; end if;
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and v_company = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select b.code, b.name, b.category, b.calculation_type, b.calc_base, b.calc_rate, b.calc_formula,
         b.amount, b.included_in_gross, b.included_in_ctc, b.is_statutory
  from public.salary_bifurcate(p_structure_id, p_gross) b;
end;
$$;
grant execute on function public.salary_preview(uuid, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- salary_structure_validate() — dependency / formula / balance / reconciliation
-- check at several sample gross values. Returns (ok, error).
-- ----------------------------------------------------------------------------
create or replace function public.salary_structure_validate(p_structure_id uuid)
returns table (ok boolean, error text)
language plpgsql
stable
security definer
as $$
declare v_g numeric; v_dummy numeric;
begin
  foreach v_g in array array[10000, 18000, 25000, 50000, 100000]::numeric[] loop
    begin
      perform 1 from public.salary_bifurcate(p_structure_id, v_g);
    exception when others then
      ok := false; error := format('At Gross %s: %s', v_g, sqlerrm); return next; return;
    end;
  end loop;
  ok := true; error := null; return next;
end;
$$;
grant execute on function public.salary_structure_validate(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- salary_structure_activate() — validate, then archive the prior same-code
-- active structure and activate this one.
-- ----------------------------------------------------------------------------
create or replace function public.salary_structure_activate(p_structure_id uuid)
returns public.salary_structures
language plpgsql
security definer
as $$
declare v_s public.salary_structures; v_ok boolean; v_err text;
begin
  select * into v_s from public.salary_structures where id = p_structure_id for update;
  if v_s.id is null then raise exception 'Salary structure not found.'; end if;
  if not public.payroll_can_manage(v_s.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;

  select v.ok, v.error into v_ok, v_err from public.salary_structure_validate(p_structure_id) v limit 1;
  if not v_ok then raise exception 'Structure cannot be activated — %', v_err; end if;

  update public.salary_structures set status = 'archived', updated_by = auth.uid()
  where company_id = v_s.company_id and code = v_s.code and status = 'active' and id <> p_structure_id;

  update public.salary_structures set status = 'active', updated_by = auth.uid() where id = p_structure_id returning * into v_s;
  return v_s;
end;
$$;
grant execute on function public.salary_structure_activate(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- salary_structure_clone() — deep copy structure + components into a new draft.
-- ----------------------------------------------------------------------------
create or replace function public.salary_structure_clone(p_structure_id uuid, p_new_code text, p_new_name text)
returns public.salary_structures
language plpgsql
security definer
as $$
declare v_src public.salary_structures; v_new public.salary_structures;
begin
  select * into v_src from public.salary_structures where id = p_structure_id;
  if v_src.id is null then raise exception 'Salary structure not found.'; end if;
  if not public.payroll_can_manage(v_src.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;

  insert into public.salary_structures (company_id, code, name, description, status, gross_balanced, allow_negative_balance, rounding, effective_from, previous_version_id, change_reason, created_by, updated_by)
  values (v_src.company_id, p_new_code, p_new_name, v_src.description, 'draft', v_src.gross_balanced, v_src.allow_negative_balance, v_src.rounding, current_date, v_src.id, 'Cloned from ' || v_src.code, auth.uid(), auth.uid())
  returning * into v_new;

  insert into public.salary_structure_components (company_id, salary_structure_id, code, name, category, calculation_type, fixed_amount, percentage, base_component_code, formula_expression, is_basic, included_in_gross, included_in_ctc, is_taxable, is_statutory, statutory_kind, statutory_base, statutory_rate, statutory_ceiling, rounding, display_order, is_active, remark, created_by, updated_by)
  select company_id, v_new.id, code, name, category, calculation_type, fixed_amount, percentage, base_component_code, formula_expression, is_basic, included_in_gross, included_in_ctc, is_taxable, is_statutory, statutory_kind, statutory_base, statutory_rate, statutory_ceiling, rounding, display_order, is_active, remark, auth.uid(), auth.uid()
  from public.salary_structure_components where salary_structure_id = p_structure_id;

  return v_new;
end;
$$;
grant execute on function public.salary_structure_clone(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- salary_assign_employee() — create an effective-dated salary revision.
-- Closes the prior open revision; links the chain; never overwrites history.
-- ----------------------------------------------------------------------------
create or replace function public.salary_assign_employee(
  p_employee_id uuid,
  p_gross_salary numeric,
  p_effective_from date,
  p_salary_structure_id uuid default null,
  p_reason text default null,
  p_remark text default null
)
returns public.employee_salary_assignments
language plpgsql
security definer
as $$
declare
  v_company uuid;
  v_prev uuid;
  v_next_from date;
  v_row public.employee_salary_assignments;
begin
  select company_id into v_company from public.employees where id = p_employee_id;
  if v_company is null then raise exception 'Employee not found.'; end if;
  if not public.payroll_can_manage(v_company) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if p_gross_salary is null or p_gross_salary <= 0 then raise exception 'Gross salary must be greater than zero.'; end if;
  if p_effective_from is null then raise exception 'Effective From is required.'; end if;
  if p_salary_structure_id is not null and not exists (
    select 1 from public.salary_structures where id = p_salary_structure_id and company_id = v_company and status = 'active'
  ) then
    raise exception 'The chosen salary structure is not an active structure of this company.';
  end if;

  -- close the prior open revision that starts before the new one
  update public.employee_salary_assignments
  set effective_to = p_effective_from - 1
  where employee_id = p_employee_id and effective_to is null and effective_from < p_effective_from
  returning id into v_prev;

  -- bound against any future revision
  select min(effective_from) into v_next_from
  from public.employee_salary_assignments
  where employee_id = p_employee_id and effective_from > p_effective_from;

  insert into public.employee_salary_assignments (company_id, employee_id, salary_structure_id, gross_salary, effective_from, effective_to, previous_assignment_id, assigned_by, reason, remark)
  values (v_company, p_employee_id, p_salary_structure_id, p_gross_salary, p_effective_from,
          case when v_next_from is not null then v_next_from - 1 else null end, v_prev, auth.uid(), p_reason, p_remark)
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.salary_assign_employee(uuid, numeric, date, uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- salary_resolve_for_employee() — the deterministic "which Gross + which
-- structure applies on this date" resolver. Used by Payroll and by the UI.
-- ----------------------------------------------------------------------------
create or replace function public.salary_resolve_for_employee(p_employee_id uuid, p_as_of date)
returns table (
  gross_salary numeric, salary_structure_id uuid, structure_name text,
  source text, ambiguous boolean, resolve_note text
)
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
begin
  select e.company_id, e.store_id, e.store_department_id, e.store_designation_id, e.employment_type::text as employment_type
  into v_emp from public.employees e where e.id = p_employee_id;
  if v_emp.company_id is null then raise exception 'Employee not found.'; end if;

  select * into v_asg from public.employee_salary_assignments a
  where a.employee_id = p_employee_id and a.effective_from <= p_as_of and (a.effective_to is null or a.effective_to >= p_as_of)
  order by a.effective_from desc limit 1;

  if v_asg.id is not null then
    v_gross := v_asg.gross_salary; v_src := 'assignment';
    if v_asg.salary_structure_id is not null then
      v_struct := v_asg.salary_structure_id; v_src := v_src || '+explicit_structure';
    end if;
  else
    select sc.basic_salary, sc.da into v_basic, v_da
    from public.employee_salary_components sc
    where sc.employee_id = p_employee_id and sc.effective_from <= p_as_of and (sc.effective_to is null or sc.effective_to >= p_as_of)
    order by sc.effective_from desc limit 1;
    if v_basic is not null then
      v_gross := coalesce(v_basic, 0) + coalesce(v_da, 0); v_src := 'legacy_raw';
      v_note := 'No dynamic salary assignment — legacy Basic+DA used as Gross. Assign a salary structure for dynamic bifurcation.';
    else
      v_gross := 0; v_src := 'none'; v_note := 'No salary assignment or legacy salary components for this employee.';
    end if;
  end if;

  -- resolve structure via 6-tier assignment (only if not explicitly set)
  if v_struct is null and v_gross > 0 then
    -- employee tier
    select count(*), (array_agg(sa.salary_structure_id))[1] into v_cnt, v_struct
    from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status = 'active'
    where sa.company_id = v_emp.company_id and sa.is_active and sa.scope_type = 'employee' and sa.employee_id = p_employee_id
      and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of);
    if v_cnt > 1 then v_ambig := true; v_note := 'Multiple applicable salary structures found (employee scope).'; v_struct := null;
    elsif v_cnt = 1 then v_src := v_src || '+assign_employee';
    else
      v_struct := null;
      -- designation, department, store, employment_type, company (first non-ambiguous match wins)
      for v_asg in
        select scope, ss, cnt from (
          select 1 ord, 'store_designation' scope, (array_agg(sa.salary_structure_id))[1] ss, count(*) cnt
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_designation' and sa.store_designation_id = v_emp.store_designation_id
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
          union all
          select 2, 'store_department', (array_agg(sa.salary_structure_id))[1], count(*)
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_department' and sa.store_department_id = v_emp.store_department_id
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
          union all
          select 3, 'store', (array_agg(sa.salary_structure_id))[1], count(*)
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store' and sa.store_id = v_emp.store_id
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
          union all
          select 4, 'employment_type', (array_agg(sa.salary_structure_id))[1], count(*)
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='employment_type' and sa.employment_type = v_emp.employment_type
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
          union all
          select 5, 'company', (array_agg(sa.salary_structure_id))[1], count(*)
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='company'
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
        ) t
        where t.cnt >= 1
        order by t.ord
      loop
        if v_asg.cnt > 1 then v_ambig := true; v_note := format('Multiple applicable salary structures found (%s scope).', v_asg.scope); v_struct := null;
        else v_struct := v_asg.ss; v_src := v_src || '+assign_' || v_asg.scope; end if;
        exit;  -- first tier with a match decides
      end loop;
    end if;

    -- slab fallback
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

-- ----------------------------------------------------------------------------
-- List / get RPCs for the UI.
-- ----------------------------------------------------------------------------
create or replace function public.salary_list_structures(p_company_id uuid)
returns setof public.salary_structures
language sql stable security definer
as $$
  select * from public.salary_structures s
  where s.company_id = p_company_id
    and (is_super_admin() or (current_user_role() <> 'staff' and p_company_id = current_user_company_id()))
  order by s.code, s.effective_from desc;
$$;
grant execute on function public.salary_list_structures(uuid) to authenticated;

create or replace function public.salary_list_structure_components(p_structure_id uuid)
returns setof public.salary_structure_components
language sql stable security definer
as $$
  select c.* from public.salary_structure_components c
  join public.salary_structures s on s.id = c.salary_structure_id
  where c.salary_structure_id = p_structure_id
    and (is_super_admin() or (current_user_role() <> 'staff' and s.company_id = current_user_company_id()))
  order by c.display_order, c.code;
$$;
grant execute on function public.salary_list_structure_components(uuid) to authenticated;

create or replace function public.salary_list_employee_assignments(p_employee_id uuid)
returns table (
  id uuid, gross_salary numeric, salary_structure_id uuid, structure_name text,
  effective_from date, effective_to date, reason text, remark text, created_at timestamptz
)
language sql stable security definer
as $$
  select a.id, a.gross_salary, a.salary_structure_id, s.name, a.effective_from, a.effective_to, a.reason, a.remark, a.created_at
  from public.employee_salary_assignments a
  left join public.salary_structures s on s.id = a.salary_structure_id
  where a.employee_id = p_employee_id
    and (is_super_admin()
         or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
         or a.employee_id = current_user_employee_id())
  order by a.effective_from desc;
$$;
grant execute on function public.salary_list_employee_assignments(uuid) to authenticated;

-- ============================================================================
-- SEED: one editable SAMPLE draft structure per company. Config rows only —
-- percentages live in the DB, never in source. status='draft' => not applied
-- until an admin activates + assigns it.
-- ============================================================================
do $seed$
declare c record; v_id uuid;
begin
  for c in select id from public.companies loop
    if not exists (select 1 from public.salary_structures where company_id = c.id and code = 'STDGROSS') then
      insert into public.salary_structures (company_id, code, name, description, status, gross_balanced, rounding, remark)
      values (c.id, 'STDGROSS', 'Standard Gross Structure (sample)', 'Editable sample matching the approved example: Basic = 50% of Gross, DA = 85% of Basic, Special Allowance = Balance. Add HRA / other components and adjust freely.', 'draft', true, 'round_2', 'Sample seed — fully editable, not hard-coded.')
      returning id into v_id;

      insert into public.salary_structure_components
        (company_id, salary_structure_id, code, name, category, calculation_type, percentage, base_component_code, is_basic, included_in_gross, included_in_ctc, is_taxable, is_statutory, statutory_kind, statutory_base, display_order)
      values
        (c.id, v_id, 'BASIC',   'Basic',             'earning',              'pct_of_gross',     50, null,    true,  true,  true,  true,  false, null,  null,       10),
        (c.id, v_id, 'DA',      'DA',                'earning',              'pct_of_basic',     85, null,    false, true,  true,  true,  false, null,  null,       20),
        (c.id, v_id, 'SPECIAL', 'Special Allowance', 'earning',              'balance',          null, null,  false, true,  true,  true,  false, null,  null,       30),
        (c.id, v_id, 'PF',      'PF',                'employee_deduction',   'pct_of_component', null, 'BASIC', false, false, true, false, true,  'pf',  'basic_da', 50),
        (c.id, v_id, 'ESI',     'ESI',               'employee_deduction',   'pct_of_gross',     null, null,   false, false, true, false, true,  'esi', 'gross',    60),
        (c.id, v_id, 'PT',      'Professional Tax',  'employee_deduction',   'fixed',            null, null,   false, false, true, false, true,  'pt',  null,       70),
        (c.id, v_id, 'TDS',     'TDS',               'employee_deduction',   'fixed',            null, null,   false, false, true, false, true,  'tds', null,       80),
        (c.id, v_id, 'ADVREC',  'Advance Recovery',  'employee_deduction',   'advance_recovery', null, null,   false, false, false, false, false, null,  null,      90),
        (c.id, v_id, 'EPF',     'Employer PF',       'employer_contribution','pct_of_component', null, 'BASIC', false, false, true, false, true,  'pf',  'basic_da', 100);

      -- PF/ESI/EPF: statutory_rate is NULL (UNRESOLVED) => those lines compute to 0 until an
      -- admin supplies the rate. PT/TDS: fixed_amount NULL => 0. None of these are hard-coded.
    end if;
  end loop;
end $seed$;


-- ============================================================================
-- Phase 5A INTEGRATION PATCH (applied 2026-09-02 via controlled db query): the
-- payroll engine now resolves + bifurcates a dynamic salary structure, with the
-- legacy Basic+DA path kept unchanged when no structure resolves; payslip
-- snapshot gains employer_contributions + per-line calc metadata.
-- ============================================================================

-- Phase 5A payroll integration: payroll_calculate_run now resolves + bifurcates
-- a dynamic salary structure (falling back to the unchanged legacy Basic+DA
-- path when none resolves); payroll_finalize_run's payslip snapshot gains an
-- employer_contributions array + the per-line calc metadata.

create or replace function public.payroll_calculate_run(p_payroll_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
as $$
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
  v_res_gross numeric; v_struct_id uuid; v_ambig boolean; v_resolve_note text; v_ltype text; v_advrec_extra numeric;
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
  select * into v_pol from public.payroll_policies where company_id = v_run.company_id;
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
    select e.id, e.full_name, e.employee_code, e.store_id, e.store_department_id, e.store_designation_id
    from public.employees e
    where e.company_id = v_run.company_id
      and e.status in ('active', 'on_leave', 'notice_period')
      and (e.joining_date is null or e.joining_date <= v_period.period_end_date)
    order by e.full_name
  loop
    v_review := false; v_notes := ''; v_basic := 0; v_da := 0; v_empc := 0; v_advrec := 0; v_gross := 0; v_ded := 0;

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

    insert into public.payroll_employee_results (
      company_id, payroll_run_id, payroll_period_id, employee_id,
      employee_code_snapshot, employee_name_snapshot, department_snapshot, designation_snapshot, store_snapshot,
      salary_effective_from, basic_snapshot, da_snapshot,
      calendar_days, working_days, present_days, paid_leave_days, lwp_days, weekly_off_days, holiday_days, absent_days, paid_days, unpaid_days,
      status
    ) values (
      v_run.company_id, v_run.id, v_period.id, v_emp.id,
      v_emp.employee_code, v_emp.full_name,
      (select sd.name from public.store_departments sd where sd.id = v_emp.store_department_id),
      (select sg.title from public.store_designations sg where sg.id = v_emp.store_designation_id),
      (select s.name from public.stores s where s.id = v_emp.store_id),
      v_sal.effective_from, coalesce(v_sal.basic_salary, 0), coalesce(v_sal.da, 0),
      v_calendar, v_working, v_present, coalesce(v_paid_leave, 0), coalesce(v_lwp_days, 0), coalesce(v_woff, 0), coalesce(v_holi, 0), coalesce(v_absent, 0), v_paid_days, v_unpaid_days,
      'calculated'
    ) returning id into v_result_id;

    -- ================= PHASE 5A: dynamic salary structure path =================
    select r.gross_salary, r.salary_structure_id, r.ambiguous, r.resolve_note
      into v_res_gross, v_struct_id, v_ambig, v_resolve_note
    from public.salary_resolve_for_employee(v_emp.id, v_period.period_end_date) r;

    if v_ambig then
      update public.payroll_employee_results
      set needs_review = true, review_notes = coalesce(v_resolve_note, 'Ambiguous salary structure â€” resolve the assignment.'),
          gross_earnings = 0, total_deductions = 0, net_salary = 0
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

        -- structure had NO advance_recovery component -> still run recovery + add a line
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

      -- period-variable earnings (Overtime / Night Duty) still come from payroll_salary_components
      for v_comp in
        select * from public.payroll_salary_components
        where company_id = v_run.company_id and is_active and component_type = 'earning' and source in ('overtime', 'night_duty')
          and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        order by sort_order, code
      loop
        v_qty := null; v_rate := null; v_amt := 0;
        if v_comp.source = 'overtime' then
          v_qty := round(v_ot_min / 60.0, 2); v_rate := v_pol.overtime_hourly_rate;
          if v_rate is null then v_amt := 0;
            if v_qty > 0 then v_review := true; v_notes := v_notes || 'Overtime hourly rate not configured. '; end if;
          else v_amt := round(v_qty * v_rate, 2); end if;
        else
          v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate;
          if v_rate is null then v_amt := 0;
            if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
          else v_amt := round(v_qty * v_rate, 2); end if;
        end if;
        insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
        values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, 'attendance_input', v_comp.sort_order);
        v_gross := v_gross + v_amt;
      end loop;

      v_net := round(v_gross - v_ded, 2);
      v_hasneg := v_net < 0;
      if v_hasneg then v_review := true; v_notes := v_notes || 'Total deductions exceed gross â€” negative net pay (no cap; policy not defined). '; end if;

      update public.payroll_employee_results
      set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2),
          employer_contribution_total = v_empc, net_salary = v_net,
          salary_structure_id = v_struct_id, gross_from_structure = v_res_gross, structure_reconciled = true,
          basic_snapshot = v_basic, da_snapshot = v_da,
          has_negative_net = v_hasneg, needs_review = v_review, review_notes = nullif(v_notes, '')
      where id = v_result_id;

      v_r_gross := v_r_gross + v_gross; v_r_ded := v_r_ded + v_ded; v_r_adv := v_r_adv + round(v_advrec, 2); v_r_net := v_r_net + v_net; v_cnt := v_cnt + 1;
      continue;   -- next employee; skip legacy path
    end if;
    -- ================= end Phase 5A path â€” LEGACY Basic+DA path below =================

    v_basic := coalesce(v_sal.basic_salary, 0);
    v_da := coalesce(v_sal.da, 0);
    if v_sal.effective_from is null then v_review := true; v_notes := v_notes || 'No effective salary structure for this period. '; end if;

    v_gross := 0;
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'earning'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
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

    v_net := round(v_gross - v_ded, 2);
    v_hasneg := v_net < 0;
    if v_hasneg then v_review := true; v_notes := v_notes || 'Total deductions exceed gross â€” negative net pay (no cap applied; policy not defined). '; end if;

    update public.payroll_employee_results
    set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2), net_salary = v_net,
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
$$;
grant execute on function public.payroll_calculate_run(uuid) to authenticated;


-- Phase 5A: payroll_finalize_run payslip snapshot gains an employer_contributions
-- array + per-line calc metadata (calc_type/calc_base/calc_rate/calc_formula) and
-- the resolved structure + employer contribution total.

create or replace function public.payroll_finalize_run(p_payroll_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
as $$
declare
  v_run public.payroll_runs;
  v_period public.payroll_periods;
  v_company public.companies;
  v_res record;
  v_sum_g numeric; v_sum_d numeric; v_sum_n numeric; v_dupes int;
  v_adv_period_id uuid;
  v_snapshot jsonb;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if v_run.status <> 'calculated' then
    raise exception 'Only a calculated run can be finalized (current: %).', v_run.status;
  end if;

  select count(*) - count(distinct employee_id) into v_dupes from public.payroll_employee_results where payroll_run_id = v_run.id;
  if v_dupes <> 0 then raise exception 'Duplicate employee results detected â€” recalculate.'; end if;

  select coalesce(sum(gross_earnings), 0), coalesce(sum(total_deductions), 0), coalesce(sum(net_salary), 0)
  into v_sum_g, v_sum_d, v_sum_n from public.payroll_employee_results where payroll_run_id = v_run.id;
  if round(v_sum_g, 2) <> round(v_run.gross_total, 2) or round(v_sum_d, 2) <> round(v_run.deduction_total, 2) or round(v_sum_n, 2) <> round(v_run.net_total, 2) then
    raise exception 'Payroll totals do not reconcile (Î£gross=%, run=%; Î£ded=%, run=%; Î£net=%, run=%).', v_sum_g, v_run.gross_total, v_sum_d, v_run.deduction_total, v_sum_n, v_run.net_total;
  end if;

  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id;
  select * into v_company from public.companies where id = v_run.company_id;

  update public.payroll_runs set status = 'finalized', finalized_at = now() where id = v_run.id returning * into v_run;
  update public.payroll_periods set status = 'finalized', finalized_by = auth.uid(), finalized_at = now(), updated_by = auth.uid() where id = v_period.id;

  for v_res in select * from public.payroll_employee_results where payroll_run_id = v_run.id loop
    v_snapshot := jsonb_build_object(
      'company', jsonb_build_object('name', v_company.name, 'city', v_company.city, 'state', v_company.state),
      'employee', jsonb_build_object('code', v_res.employee_code_snapshot, 'name', v_res.employee_name_snapshot,
                                     'department', v_res.department_snapshot, 'designation', v_res.designation_snapshot, 'store', v_res.store_snapshot),
      'period', jsonb_build_object('month', to_char(v_period.period_month, 'Mon YYYY'),
                                   'start', v_period.period_start_date, 'end', v_period.period_end_date),
      'days', jsonb_build_object('calendar', v_res.calendar_days, 'working', v_res.working_days, 'paid', v_res.paid_days,
                                 'unpaid', v_res.unpaid_days, 'paid_leave', v_res.paid_leave_days, 'lwp', v_res.lwp_days),
      'salary_structure_id', v_res.salary_structure_id,
      'gross_from_structure', v_res.gross_from_structure,
      'structure_reconciled', v_res.structure_reconciled,
      'earnings', (select coalesce(jsonb_agg(jsonb_build_object(
                     'code', code, 'name', name, 'qty', quantity, 'rate', rate, 'amount', amount,
                     'calc_type', calc_type, 'calc_base', calc_base, 'calc_rate', calc_rate, 'calc_formula', calc_formula) order by sort_order), '[]'::jsonb)
                   from public.payroll_lines where payroll_employee_result_id = v_res.id and line_type = 'earning'),
      'deductions', (select coalesce(jsonb_agg(jsonb_build_object(
                       'code', code, 'name', name, 'qty', quantity, 'rate', rate, 'amount', amount,
                       'calc_type', calc_type, 'calc_base', calc_base, 'calc_rate', calc_rate, 'calc_formula', calc_formula) order by sort_order), '[]'::jsonb)
                     from public.payroll_lines where payroll_employee_result_id = v_res.id and line_type = 'deduction'),
      'employer_contributions', (select coalesce(jsonb_agg(jsonb_build_object(
                       'code', code, 'name', name, 'qty', quantity, 'rate', rate, 'amount', amount,
                       'calc_type', calc_type, 'calc_base', calc_base, 'calc_rate', calc_rate, 'calc_formula', calc_formula) order by sort_order), '[]'::jsonb)
                     from public.payroll_lines where payroll_employee_result_id = v_res.id and line_type = 'employer_contribution'),
      'gross_earnings', v_res.gross_earnings,
      'total_deductions', v_res.total_deductions,
      'employer_contribution_total', v_res.employer_contribution_total,
      'advance_recovery', v_res.advance_recovery_amount,
      'net_salary', v_res.net_salary
    );
    insert into public.payslips (company_id, payroll_run_id, payroll_employee_result_id, employee_id, payslip_number, period_month, snapshot, generated_by)
    values (v_run.company_id, v_run.id, v_res.id, v_res.employee_id,
            to_char(v_period.period_month, 'YYYYMM') || '-' || coalesce(v_res.employee_code_snapshot, left(v_res.employee_id::text, 8)),
            v_period.period_month, v_snapshot, auth.uid())
    on conflict (payroll_employee_result_id) do nothing;

    update public.payroll_employee_results set status = 'finalized' where id = v_res.id;

    perform public.advance_notify(v_run.company_id, v_res.employee_id, 'payroll_finalized', 'Payroll finalized',
      format('Your %s payroll has been finalized. Net salary: %s.', to_char(v_period.period_month, 'Mon YYYY'), v_res.net_salary), v_run.id);
    perform public.advance_notify(v_run.company_id, v_res.employee_id, 'payslip_available', 'Payslip available',
      format('Your %s payslip is now available.', to_char(v_period.period_month, 'Mon YYYY')), v_run.id);
    if v_res.advance_recovery_amount > 0 then
      perform public.advance_notify(v_run.company_id, v_res.employee_id, 'advance_recovery_deducted', 'Advance recovery deducted',
        format('%s Advance Recovery was deducted from your %s salary.', v_res.advance_recovery_amount, to_char(v_period.period_month, 'Mon YYYY')), v_run.id);
    end if;
  end loop;

  select id into v_adv_period_id from public.advance_payroll_periods where payroll_run_id = v_run.id and status = 'draft';
  if v_adv_period_id is not null then
    perform public.advance_recovery_finalize_period(v_adv_period_id);
  end if;

  return v_run;
end;
$$;
grant execute on function public.payroll_finalize_run(uuid) to authenticated;


-- Phase 5A fix patch (applied 2026-09-02): max(uuid) is not a PostgreSQL
-- aggregate; salary_resolve_for_employee now uses (array_agg(<uuid>))[1].

-- Phase 5A fix: max(uuid) does not exist in PostgreSQL. Replace every
-- max(<uuid col>) in salary_resolve_for_employee with (array_agg(<uuid col>))[1]
-- (count() still drives ambiguity; the picked id is only used when count = 1).

create or replace function public.salary_resolve_for_employee(p_employee_id uuid, p_as_of date)
returns table (
  gross_salary numeric, salary_structure_id uuid, structure_name text,
  source text, ambiguous boolean, resolve_note text
)
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
begin
  select e.company_id, e.store_id, e.store_department_id, e.store_designation_id, e.employment_type::text as employment_type
  into v_emp from public.employees e where e.id = p_employee_id;
  if v_emp.company_id is null then raise exception 'Employee not found.'; end if;

  select * into v_asg from public.employee_salary_assignments a
  where a.employee_id = p_employee_id and a.effective_from <= p_as_of and (a.effective_to is null or a.effective_to >= p_as_of)
  order by a.effective_from desc limit 1;

  if v_asg.id is not null then
    v_gross := v_asg.gross_salary; v_src := 'assignment';
    if v_asg.salary_structure_id is not null then
      v_struct := v_asg.salary_structure_id; v_src := v_src || '+explicit_structure';
    end if;
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
    select count(*), (array_agg(sa.salary_structure_id))[1] into v_cnt, v_struct
    from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status = 'active'
    where sa.company_id = v_emp.company_id and sa.is_active and sa.scope_type = 'employee' and sa.employee_id = p_employee_id
      and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of);
    if v_cnt > 1 then v_ambig := true; v_note := 'Multiple applicable salary structures found (employee scope).'; v_struct := null;
    elsif v_cnt = 1 then v_src := v_src || '+assign_employee';
    else
      v_struct := null;
      for v_asg in
        select scope, ss, cnt from (
          select 1 ord, 'store_designation' scope, (array_agg(sa.salary_structure_id))[1] ss, count(*) cnt
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_designation' and sa.store_designation_id = v_emp.store_designation_id
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
          union all
          select 2, 'store_department', (array_agg(sa.salary_structure_id))[1], count(*)
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_department' and sa.store_department_id = v_emp.store_department_id
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
          union all
          select 3, 'store', (array_agg(sa.salary_structure_id))[1], count(*)
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store' and sa.store_id = v_emp.store_id
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
          union all
          select 4, 'employment_type', (array_agg(sa.salary_structure_id))[1], count(*)
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='employment_type' and sa.employment_type = v_emp.employment_type
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
          union all
          select 5, 'company', (array_agg(sa.salary_structure_id))[1], count(*)
          from public.salary_structure_assignments sa join public.salary_structures s on s.id = sa.salary_structure_id and s.status='active'
          where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='company'
            and sa.effective_from <= p_as_of and (sa.effective_to is null or sa.effective_to >= p_as_of)
        ) t
        where t.cnt >= 1
        order by t.ord
      loop
        if v_asg.cnt > 1 then v_ambig := true; v_note := format('Multiple applicable salary structures found (%s scope).', v_asg.scope); v_struct := null;
        else v_struct := v_asg.ss; v_src := v_src || '+assign_' || v_asg.scope; end if;
        exit;
      end loop;
    end if;

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


-- Phase 5A read-model addendum (applied 2026-09-03): dynamic-structure snapshot
-- + per-line calc metadata surfaced through the Phase 5 read RPCs.

-- Phase 5A: surface the dynamic-structure snapshot + per-line calc metadata
-- through the Phase 5 read RPCs (additive columns only). Return type widened =>
-- drop + recreate (grants re-applied below).

drop function if exists public.payroll_list_run_results(uuid);
drop function if exists public.payroll_get_employee_result(uuid);
drop function if exists public.payroll_list_employee_result_lines(uuid);

create or replace function public.payroll_list_run_results(p_payroll_run_id uuid)
returns table (
  id uuid, employee_id uuid, employee_code text, employee_name text, department text, designation text, store text,
  basic numeric, da numeric, paid_days numeric, unpaid_days numeric, lwp_days numeric,
  gross_earnings numeric, total_deductions numeric, advance_recovery_amount numeric, net_salary numeric,
  employer_contribution_total numeric, salary_structure_id uuid, gross_from_structure numeric, structure_reconciled boolean,
  has_negative_net boolean, needs_review boolean, review_notes text, status text
)
language plpgsql
stable
security definer
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.payroll_runs where id = p_payroll_run_id;
  if v_company is null then raise exception 'Payroll run not found.'; end if;
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and v_company = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select r.id, r.employee_id, r.employee_code_snapshot, r.employee_name_snapshot, r.department_snapshot, r.designation_snapshot, r.store_snapshot,
         r.basic_snapshot, r.da_snapshot, r.paid_days, r.unpaid_days, r.lwp_days,
         r.gross_earnings, r.total_deductions, r.advance_recovery_amount, r.net_salary,
         r.employer_contribution_total, r.salary_structure_id, r.gross_from_structure, r.structure_reconciled,
         r.has_negative_net, r.needs_review, r.review_notes, r.status
  from public.payroll_employee_results r
  where r.payroll_run_id = p_payroll_run_id
  order by r.employee_name_snapshot;
end;
$$;
grant execute on function public.payroll_list_run_results(uuid) to authenticated;

create or replace function public.payroll_get_employee_result(p_result_id uuid)
returns table (
  result_id uuid, payroll_run_id uuid, run_status text, period_month date,
  employee_id uuid, employee_code text, employee_name text, department text, designation text, store text,
  salary_effective_from date, basic numeric, da numeric,
  calendar_days int, working_days numeric, present_days numeric, paid_leave_days numeric, lwp_days numeric,
  weekly_off_days numeric, holiday_days numeric, absent_days numeric, paid_days numeric, unpaid_days numeric,
  gross_earnings numeric, total_deductions numeric, advance_recovery_amount numeric, net_salary numeric,
  employer_contribution_total numeric, salary_structure_id uuid, structure_name text, gross_from_structure numeric, structure_reconciled boolean,
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

create or replace function public.payroll_list_employee_result_lines(p_result_id uuid)
returns table (
  line_type text, code text, name text, quantity numeric, rate numeric, amount numeric, source text,
  calc_type text, calc_base text, calc_rate numeric, calc_formula text,
  calculation_ref text, is_reversal boolean, sort_order int
)
language sql
stable
security definer
as $$
  select l.line_type, l.code, l.name, l.quantity, l.rate, l.amount, l.source,
         l.calc_type, l.calc_base, l.calc_rate, l.calc_formula,
         l.calculation_ref, l.is_reversal, l.sort_order
  from public.payroll_lines l
  where l.payroll_employee_result_id = p_result_id
    and exists (
      select 1 from public.payroll_employee_results r
      where r.id = p_result_id
        and (is_super_admin()
             or (current_user_role() <> 'staff' and r.company_id = current_user_company_id())
             or r.employee_id = current_user_employee_id())
    )
  order by
    case l.line_type when 'earning' then 1 when 'deduction' then 2 when 'employer_contribution' then 3 else 4 end,
    l.is_reversal, l.sort_order, l.code;
$$;
grant execute on function public.payroll_list_employee_result_lines(uuid) to authenticated;
