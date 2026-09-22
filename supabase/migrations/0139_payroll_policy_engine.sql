-- ============================================================================
-- Retail HRMS — Phase 6: PAYROLL POLICY & CALCULATION RULE ENGINE
--   Versioned Payroll Policy + Salary Proration + LWP deduction + Overtime +
--   Night-Duty payroll earning + Statutory (PF / ESI / PT / TDS / Gratuity) +
--   Deduction Priority + Deduction Cap + Negative-Net policy + Policy Preview
--   (same engine as the run) + Policy snapshot + Audit.
-- Migration 0139
--
-- INSPECTION (2026-09-03): Phase 5 (0137) created payroll_policies as ONE
-- settings row per company with every business knob NULLable; Phase 5A (0138)
-- added the dynamic salary structure + advance-recovery bridge inside
-- payroll_calculate_run. Phase 6 UPGRADES payroll_policies into a versioned,
-- effective-dated master, adds the missing rule columns + 3 child tables
-- (statutory rules, PT slabs, deduction order), a pure calculation engine
-- (payroll_policy_compute_lines) shared by the Payroll Run and the Preview, and
-- a finalize step (ordering + cap + negative-net). Bifurcation (5A) and Advance
-- Recovery (Phase 4) are NOT touched — Phase 6 only adds policy-driven lines
-- AFTER them.
--
-- ZERO-REGRESSION CONTRACT: every new rule has an enable flag / rate that is
-- OFF / NULL by default. With the default (unconfigured) policy, the engine
-- emits no new lines and net = gross - Σ(existing deductions), i.e. byte-for-
-- byte identical to Phase 5A. Nothing invented — unconfigured rules stay
-- "Not Configured", produce ₹0 and raise the review flag.
--
-- Reuses: current_user_*(), is_super_admin(), payroll_can_manage(),
-- write_audit_log(), set_updated_at(). btree_gist already installed.
-- No app_role change. Attendance / Night Duty / Leave / Advance 1-4 / Payroll 5
-- / Salary 5A business logic unchanged.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Upgrade payroll_policies -> versioned, effective-dated master.
--    Phase 5 modelled it one-row-per-company; drop that unique so a company can
--    hold multiple effective-dated versions (only ONE may be 'active' per date —
--    enforced by the gist exclusion added below).
-- ----------------------------------------------------------------------------
alter table public.payroll_policies drop constraint if exists payroll_policies_company_id_key;

alter table public.payroll_policies
  add column if not exists policy_name text,
  add column if not exists code text,
  add column if not exists version_no int not null default 1,
  add column if not exists effective_from date not null default '2000-01-01',
  add column if not exists effective_to date,
  add column if not exists status text not null default 'active'
    check (status in ('draft', 'active', 'inactive', 'archived')),
  add column if not exists previous_policy_id uuid references public.payroll_policies (id),
  -- proration
  add column if not exists proration_basis text
    check (proration_basis is null or proration_basis in ('basic', 'basic_da', 'gross', 'custom')),
  add column if not exists proration_custom_divisor numeric check (proration_custom_divisor is null or proration_custom_divisor > 0),
  add column if not exists proration_custom_formula text,
  add column if not exists working_days_method text
    check (working_days_method is null or working_days_method in ('calendar_minus_offdays', 'store_calendar', 'custom')),
  add column if not exists currency_precision int not null default 2 check (currency_precision between 0 and 6),
  -- LWP
  add column if not exists lwp_enabled boolean not null default false,
  add column if not exists lwp_basis text check (lwp_basis is null or lwp_basis in ('basic', 'basic_da', 'gross', 'components', 'custom')),
  add column if not exists lwp_proration_method text
    check (lwp_proration_method is null or lwp_proration_method in ('calendar_days', 'working_days', 'fixed_26', 'fixed_30', 'custom')),
  add column if not exists lwp_half_day_supported boolean not null default true,
  add column if not exists lwp_rounding text check (lwp_rounding is null or lwp_rounding in ('none', 'nearest_rupee', 'round_2')),
  add column if not exists lwp_custom_formula text,
  -- overtime
  add column if not exists ot_enabled boolean not null default false,
  add column if not exists ot_rate_type text
    check (ot_rate_type is null or ot_rate_type in ('fixed_per_hour', 'pct_of_hourly', 'pct_of_basic', 'pct_of_basic_da', 'custom_formula')),
  add column if not exists ot_rate numeric check (ot_rate is null or ot_rate >= 0),
  add column if not exists ot_basis text check (ot_basis is null or ot_basis in ('basic', 'basic_da', 'gross')),
  add column if not exists ot_std_hours_per_day numeric check (ot_std_hours_per_day is null or ot_std_hours_per_day > 0),
  add column if not exists ot_min_hours numeric check (ot_min_hours is null or ot_min_hours >= 0),
  add column if not exists ot_max_hours numeric check (ot_max_hours is null or ot_max_hours >= 0),
  add column if not exists ot_rounding text check (ot_rounding is null or ot_rounding in ('none', 'nearest_rupee', 'round_2')),
  add column if not exists ot_approval_required boolean not null default true,
  add column if not exists ot_custom_formula text,
  -- night duty payroll earning
  add column if not exists nd_earning_enabled boolean not null default false,
  add column if not exists nd_rate_type text
    check (nd_rate_type is null or nd_rate_type in ('fixed', 'pct_of_basic', 'pct_of_basic_da', 'custom_formula')),
  add column if not exists nd_rate numeric check (nd_rate is null or nd_rate >= 0),
  add column if not exists nd_basis text check (nd_basis is null or nd_basis in ('basic', 'basic_da', 'gross')),
  add column if not exists nd_rounding text check (nd_rounding is null or nd_rounding in ('none', 'nearest_rupee', 'round_2')),
  add column if not exists nd_custom_formula text,
  -- deduction cap + negative net
  add column if not exists deduction_cap_mode text not null default 'none'
    check (deduction_cap_mode in ('none', 'fixed', 'pct_of_gross', 'pct_of_net', 'custom')),
  add column if not exists deduction_cap_value numeric check (deduction_cap_value is null or deduction_cap_value >= 0),
  add column if not exists deduction_cap_formula text,
  add column if not exists negative_net_policy text not null default 'allow'
    check (negative_net_policy in ('allow', 'block', 'warn'));

-- backfill the single existing Phase-5 row as Version 1
update public.payroll_policies
set policy_name = coalesce(policy_name, 'Default Payroll Policy'),
    code = coalesce(code, 'DEFAULT'),
    negative_net_policy = case when allow_negative_net then 'allow' else 'block' end
where policy_name is null or code is null;

-- no two ACTIVE policy versions may cover the same company on the same date
alter table public.payroll_policies
  drop constraint if exists payroll_policies_active_no_overlap;
alter table public.payroll_policies
  add constraint payroll_policies_active_no_overlap
  exclude using gist (
    company_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  ) where (status = 'active');

create index if not exists idx_payroll_policies_company_status on public.payroll_policies (company_id, status, effective_from);

-- ----------------------------------------------------------------------------
-- B. Child tables (multi-row config).
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_statutory_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_policy_id uuid not null references public.payroll_policies (id) on delete cascade,
  kind text not null check (kind in ('pf', 'esi', 'pt', 'tds', 'gratuity', 'other')),
  enabled boolean not null default false,
  calc_base text check (calc_base is null or calc_base in ('basic', 'basic_da', 'gross', 'components', 'custom')),
  base_formula text,
  employee_rate numeric check (employee_rate is null or employee_rate >= 0),   -- % — NULL = UNRESOLVED
  employer_rate numeric check (employer_rate is null or employer_rate >= 0),   -- % — NULL = UNRESOLVED
  wage_ceiling numeric check (wage_ceiling is null or wage_ceiling >= 0),
  rounding text check (rounding is null or rounding in ('none', 'nearest_rupee', 'round_2')),
  effective_from date not null default current_date,
  effective_to date,
  remark text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_policy_id, kind, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.payroll_pt_slabs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_policy_id uuid not null references public.payroll_policies (id) on delete cascade,
  min_salary numeric not null check (min_salary >= 0),
  max_salary numeric check (max_salary is null or max_salary >= min_salary),
  amount numeric not null check (amount >= 0),
  label text,
  effective_from date not null default current_date,
  effective_to date,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.payroll_deduction_order (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_policy_id uuid not null references public.payroll_policies (id) on delete cascade,
  deduction_code text not null,
  priority int not null,
  is_active boolean not null default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_policy_id, deduction_code)
);

-- ----------------------------------------------------------------------------
-- C. Payroll result snapshot columns (auditability — §39).
-- ----------------------------------------------------------------------------
alter table public.payroll_employee_results
  add column if not exists payroll_policy_id uuid references public.payroll_policies (id),
  add column if not exists policy_snapshot jsonb,
  add column if not exists proration_factor numeric,
  add column if not exists lwp_deduction_amount numeric not null default 0,
  add column if not exists statutory_deduction_total numeric not null default 0;

-- ----------------------------------------------------------------------------
-- RLS + triggers.
-- ----------------------------------------------------------------------------
alter table public.payroll_statutory_rules enable row level security;
alter table public.payroll_pt_slabs enable row level security;
alter table public.payroll_deduction_order enable row level security;

do $trg$
declare t text;
begin
  for t in select unnest(array['payroll_statutory_rules','payroll_pt_slabs','payroll_deduction_order']) loop
    execute format('create trigger trg_%1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at();', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function public.write_audit_log();', t);
    execute format($f$create policy "%1$s_select" on public.%1$s for select
      using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$f$, t);
    execute format($f$create policy "%1$s_write"  on public.%1$s for insert with check (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_update" on public.%1$s for update using (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_delete" on public.%1$s for delete using (is_super_admin());$f$, t);
  end loop;
end $trg$;

-- payroll_policies already had RLS + audit from 0137; widen nothing.

-- ============================================================================
-- D. Safe formula evaluator (shared: OT / ND / proration / statutory bases /
--    deduction cap). Same allow-list discipline as salary_bifurcate (§34 — the
--    salary component formula engine is NOT duplicated; this evaluates flat
--    payroll-level expressions over a fixed variable set).
-- ============================================================================
create or replace function public.payroll_eval_formula(p_expr text, p_vars jsonb)
returns numeric
language plpgsql
immutable
as $$
declare v_expr text; k text; v_val numeric;
begin
  if p_expr is null or btrim(p_expr) = '' then return null; end if;
  v_expr := p_expr;
  for k in select jsonb_object_keys(p_vars) loop
    v_expr := regexp_replace(v_expr, '\m' || k || '\M', '(' || coalesce((p_vars ->> k), '0') || ')', 'gi');
  end loop;
  if regexp_replace(v_expr, '(round|min|max|abs|least|greatest|floor|ceil|ceiling)', '', 'gi') ~ '[A-Za-z]' then
    raise exception 'Payroll formula could not be safely evaluated (unresolved token): %', p_expr;
  end if;
  if v_expr ~ '[;\\]' or v_expr ~* '(select|insert|update|delete|drop|alter|;|--)' then
    raise exception 'Payroll formula contains a disallowed token: %', p_expr;
  end if;
  execute format('select (%s)::numeric', v_expr) into v_val;
  return v_val;
end;
$$;
revoke execute on function public.payroll_eval_formula(text, jsonb) from public;
grant execute on function public.payroll_eval_formula(text, jsonb) to authenticated;

-- ============================================================================
-- E. Policy resolver — the ONE place that maps (company, date) -> policy row.
--    Resolution key = Payroll Period END date (§37).
-- ============================================================================
create or replace function public.payroll_resolve_policy(p_company_id uuid, p_as_of date)
returns public.payroll_policies
language plpgsql
stable
security definer
as $$
declare v_pol public.payroll_policies;
begin
  select * into v_pol from public.payroll_policies
  where company_id = p_company_id and status = 'active'
    and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc limit 1;
  if v_pol.id is null then
    select * into v_pol from public.payroll_policies
    where company_id = p_company_id and status = 'active'
    order by effective_from desc limit 1;
  end if;
  if v_pol.id is null then
    select * into v_pol from public.payroll_policies where company_id = p_company_id
    order by effective_from desc limit 1;
  end if;
  return v_pol;
end;
$$;
grant execute on function public.payroll_resolve_policy(uuid, date) to authenticated;

-- ============================================================================
-- F. THE ENGINE — payroll_policy_compute_lines().
--    Pure, deterministic, NUMERIC-only. Emits the policy-driven lines
--    (Proration, Overtime, Night-Duty, LWP, PF, ESI, PT, TDS + employer
--    statutory contributions). Called by BOTH the Payroll Run and the Preview
--    (§36 same engine). Unconfigured rule => amount 0 + unresolved = true.
-- ============================================================================
create or replace function public.payroll_policy_compute_lines(
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
  p_existing_codes text[] default '{}'
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
  v_hours numeric;
  v_rate numeric;
  v_amt numeric;
  v_note text;
  r record;
  v_sbase numeric;
  v_has_struct_stat boolean;
begin
  select * into p from public.payroll_policies where id = p_policy_id;
  if p.id is null then return; end if;
  v_prec := coalesce(p.currency_precision, 2);

  -- proration divisor + base (per configured method / basis)
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

  -- ---- 1. Joining-month proration (negative earning) ----
  if p_joining_date is not null and p_joining_date > p_period_start then
    v_lost := (p_joining_date - p_period_start);
    if v_div is not null then v_lost := least(v_lost, v_div); end if;
    if v_lost > 0 then
      if p.proration_method is null or v_div is null or v_div = 0 or v_base is null then
        kind := 'earning_prorate'; line_type := 'earning'; code := 'PRORATE'; name := 'Joining-month proration';
        quantity := v_lost; rate := null; amount := 0; calc_type := 'proration'; calc_base := p.proration_basis;
        calc_note := format('Joined %s — %s day(s) not worked. Proration method/basis/divisor not configured.', p_joining_date, v_lost);
        unresolved := true; return next;
      else
        v_daily := round(v_base / v_div, 6);
        kind := 'earning_prorate'; line_type := 'earning'; code := 'PRORATE'; name := 'Joining-month proration';
        quantity := v_lost; rate := v_daily; amount := - round(v_daily * v_lost, v_prec); calc_type := 'proration';
        calc_base := p.proration_basis;
        calc_note := format('Joined %s — %s day(s) × daily %s (%s ÷ %s, %s)', p_joining_date, v_lost, v_daily, v_base, v_div, p.proration_method);
        unresolved := false; return next;
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
      when 'pct_of_basic'    then case when v_div is null or p.ot_std_hours_per_day is null then null
                                  else round(p_basic / v_div / p.ot_std_hours_per_day * coalesce(p.ot_rate, 0) / 100.0, 4) end
      when 'pct_of_basic_da' then case when v_div is null or p.ot_std_hours_per_day is null then null
                                  else round((p_basic + p_da) / v_div / p.ot_std_hours_per_day * coalesce(p.ot_rate, 0) / 100.0, 4) end
      when 'pct_of_hourly'   then case when v_div is null or p.ot_std_hours_per_day is null then null
                                  else round((case coalesce(p.ot_basis,'basic_da') when 'basic' then p_basic when 'gross' then p_gross else p_basic + p_da end)
                                             / v_div / p.ot_std_hours_per_day * coalesce(p.ot_rate, 0) / 100.0, 4) end
      when 'custom_formula'  then public.payroll_eval_formula(p.ot_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross, 'HOURS', v_hours, 'DIVISOR', coalesce(v_div, 0)))
      else null end;
    if v_rate is null then
      v_amt := 0; unresolved := true;
      v_note := 'Overtime rate not configured (needs rate / standard hours-per-day + proration divisor).';
    else
      v_amt := round(v_hours * v_rate, case coalesce(p.ot_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
      unresolved := false;
      v_note := format('%s h × %s (%s)', v_hours, v_rate, coalesce(p.ot_rate_type, 'fixed_per_hour'));
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
      unresolved := false; v_note := format('%s unit(s) × %s (%s)', p_nd_value, v_rate, coalesce(p.nd_rate_type, 'fixed'));
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
        calc_note := format('%s LWP day(s) — LWP daily-rate needs a configured basis + divisor/method.', p_lwp_days);
        unresolved := true; return next;
      else
        v_daily := round(v_lb / v_ld, 6);
        kind := 'deduction_lwp'; line_type := 'deduction'; code := 'LWP'; name := 'Loss of Pay';
        quantity := p_lwp_days; rate := v_daily;
        amount := round(v_daily * p_lwp_days, case coalesce(p.lwp_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
        calc_type := 'lwp'; calc_base := coalesce(p.lwp_basis, p.lwp_divisor_basis);
        calc_note := format('%s day(s) × daily %s (%s ÷ %s)', p_lwp_days, v_daily, v_lb, v_ld);
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
    -- skip a kind already owned by the dynamic salary structure or already emitted
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
    v_prec := coalesce(r.rounding, p.currency_precision::text, '2')::text::int;
    v_prec := case coalesce(r.rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else coalesce(p.currency_precision, 2) end;

    if r.kind = 'pt' then
      -- slab lookup on gross (or configured base)
      select s.amount into v_amt from public.payroll_pt_slabs s
      where s.payroll_policy_id = p_policy_id
        and s.effective_from <= p_period_end and (s.effective_to is null or s.effective_to >= p_period_start)
        and coalesce(v_sbase, p_gross) >= s.min_salary and (s.max_salary is null or coalesce(v_sbase, p_gross) <= s.max_salary)
      order by s.min_salary desc limit 1;
      kind := 'deduction_pt'; line_type := 'deduction'; code := 'PT'; name := 'Professional Tax';
      quantity := null; rate := null; calc_type := 'statutory_pt'; calc_base := coalesce(r.calc_base, 'gross');
      if v_amt is null then
        amount := 0; unresolved := true; calc_note := 'PT slabs not configured for this salary.';
      else
        amount := round(v_amt, 0); unresolved := false; calc_note := format('PT slab @ %s', coalesce(v_sbase, p_gross));
      end if;
      return next;

    elsif r.kind = 'tds' then
      kind := 'deduction_tds'; line_type := 'deduction'; code := 'TDS'; name := 'TDS';
      quantity := null; rate := null; calc_type := 'statutory_tds'; calc_base := r.calc_base;
      if coalesce(btrim(r.base_formula), '') = '' then
        amount := 0; unresolved := true; calc_note := 'TDS not configured — no tax engine supplied.';
      else
        amount := round(coalesce(public.payroll_eval_formula(r.base_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec);
        unresolved := false; calc_note := 'TDS via configured formula.';
      end if;
      return next;

    else
      -- pf / esi / gratuity / other : rate-based, employee + optional employer
      if r.kind = 'esi' and r.wage_ceiling is not null and p_gross > r.wage_ceiling then
        kind := 'deduction_esi'; line_type := 'deduction'; code := 'ESI'; name := 'ESI';
        quantity := null; rate := 0; amount := 0; calc_type := 'statutory_esi'; calc_base := coalesce(r.calc_base, 'gross');
        calc_note := format('ESI not applicable — gross %s above ceiling %s.', p_gross, r.wage_ceiling); unresolved := false;
        return next;
      else
        -- employee side
        kind := 'deduction_' || r.kind; line_type := 'deduction';
        code := upper(r.kind); name := (case r.kind when 'pf' then 'Provident Fund' when 'esi' then 'ESI' when 'gratuity' then 'Gratuity (employee)' else 'Statutory' end);
        quantity := null; calc_type := 'statutory_' || r.kind; calc_base := r.calc_base;
        if r.employee_rate is null then
          rate := null; amount := 0; unresolved := true;
          calc_note := format('%s employee rate not configured.', upper(r.kind));
        elsif v_sbase is null then
          rate := r.employee_rate; amount := 0; unresolved := true;
          calc_note := format('%s calculation base not configured.', upper(r.kind));
        else
          rate := r.employee_rate; amount := round(v_sbase * r.employee_rate / 100.0, v_prec); unresolved := false;
          calc_note := format('%s%% of %s (%s)%s', r.employee_rate, coalesce(r.calc_base, 'base'), v_sbase,
                              case when r.wage_ceiling is not null then format(' capped @ %s', r.wage_ceiling) else '' end);
        end if;
        return next;
      end if;

      -- employer contribution (separate; never reduces net) — only when a rate is set
      if r.employer_rate is not null and v_sbase is not null then
        kind := 'employer_' || r.kind; line_type := 'employer_contribution';
        code := upper(r.kind) || '_ER'; name := 'Employer ' || upper(r.kind);
        quantity := null; rate := r.employer_rate; amount := round(v_sbase * r.employer_rate / 100.0, v_prec);
        calc_type := 'employer_' || r.kind; calc_base := r.calc_base;
        calc_note := format('%s%% of %s (%s) — employer', r.employer_rate, coalesce(r.calc_base, 'base'), v_sbase); unresolved := false;
        return next;
      end if;
    end if;
  end loop;

  return;
end;
$$;
revoke execute on function public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[]) from public;
grant execute on function public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[]) to authenticated;

-- ============================================================================
-- G. Finalize — deduction ordering + cap + negative-net policy (§28/§30/§31).
--    Input p_deductions: jsonb array of {code, amount, protected}. ADVREC is
--    always protected (never trimmed — bounded only by its own Outstanding).
-- ============================================================================
create or replace function public.payroll_policy_finalize(
  p_policy_id uuid,
  p_gross numeric,
  p_deductions jsonb
)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  p public.payroll_policies;
  v_rows jsonb := '[]'::jsonb;
  e jsonb;
  v_code text; v_amt numeric; v_prot boolean; v_prio int;
  v_total numeric := 0;
  v_cap numeric;
  v_excess numeric;
  v_take numeric;
  v_cap_reduction numeric := 0;
  v_net numeric;
  v_neg_flag boolean := false;
  v_neg_blocked boolean := false;
  v_prio_configured boolean;
  i int;
  arr jsonb[];
begin
  select * into p from public.payroll_policies where id = p_policy_id;

  select count(*) > 0 into v_prio_configured from public.payroll_deduction_order
   where payroll_policy_id = p_policy_id and is_active;

  -- attach priority + protected flag
  for e in select * from jsonb_array_elements(coalesce(p_deductions, '[]'::jsonb)) loop
    v_code := e ->> 'code';
    v_amt := coalesce((e ->> 'amount')::numeric, 0);
    v_prot := coalesce((e ->> 'protected')::boolean, false) or v_code = 'ADVREC';
    v_prio := coalesce((select priority from public.payroll_deduction_order
                        where payroll_policy_id = p_policy_id and deduction_code = v_code and is_active), 999);
    v_rows := v_rows || jsonb_build_object('code', v_code, 'amount', v_amt, 'protected', v_prot, 'priority', v_prio);
    v_total := v_total + v_amt;
  end loop;

  -- sort rows by (priority, code) into arr
  select array_agg(x order by (x ->> 'priority')::int, x ->> 'code')
    into arr from jsonb_array_elements(v_rows) x;

  -- ---- deduction cap ----
  v_cap := case coalesce(p.deduction_cap_mode, 'none')
    when 'none' then null
    when 'fixed' then p.deduction_cap_value
    when 'pct_of_gross' then round(p_gross * coalesce(p.deduction_cap_value, p.deduction_cap_pct) / 100.0, 2)
    when 'pct_of_net'   then round(p_gross * coalesce(p.deduction_cap_value, p.deduction_cap_pct) / 100.0, 2)
    when 'custom' then public.payroll_eval_formula(p.deduction_cap_formula, jsonb_build_object('GROSS', p_gross))
    else null end;

  if v_cap is not null and v_total > v_cap then
    v_excess := v_total - v_cap;
    for i in reverse array_length(arr, 1) .. 1 loop
      exit when v_excess <= 0;
      if not (arr[i] ->> 'protected')::boolean and (arr[i] ->> 'amount')::numeric > 0 then
        v_take := least((arr[i] ->> 'amount')::numeric, v_excess);
        arr[i] := jsonb_set(arr[i], '{amount}', to_jsonb((arr[i] ->> 'amount')::numeric - v_take));
        arr[i] := jsonb_set(arr[i], '{capped}', 'true'::jsonb);
        v_excess := v_excess - v_take;
        v_cap_reduction := v_cap_reduction + v_take;
      end if;
    end loop;
  end if;

  -- recompute total, net
  v_total := 0;
  for i in 1 .. coalesce(array_length(arr, 1), 0) loop v_total := v_total + (arr[i] ->> 'amount')::numeric; end loop;
  v_net := round(p_gross - v_total, 2);

  -- ---- negative-net policy ----
  if v_net < 0 then
    if coalesce(p.negative_net_policy, 'allow') = 'block' then
      v_excess := -v_net;
      for i in reverse array_length(arr, 1) .. 1 loop
        exit when v_excess <= 0;
        if not (arr[i] ->> 'protected')::boolean and (arr[i] ->> 'amount')::numeric > 0 then
          v_take := least((arr[i] ->> 'amount')::numeric, v_excess);
          arr[i] := jsonb_set(arr[i], '{amount}', to_jsonb((arr[i] ->> 'amount')::numeric - v_take));
          arr[i] := jsonb_set(arr[i], '{neg_blocked}', 'true'::jsonb);
          v_excess := v_excess - v_take;
        end if;
      end loop;
      v_total := 0;
      for i in 1 .. coalesce(array_length(arr, 1), 0) loop v_total := v_total + (arr[i] ->> 'amount')::numeric; end loop;
      v_net := round(p_gross - v_total, 2);
      v_neg_blocked := (v_net >= 0);
      v_neg_flag := (v_net < 0);
    else
      v_neg_flag := true;  -- allow / warn : keep the number, raise the flag
    end if;
  end if;

  return jsonb_build_object(
    'ordered', to_jsonb(arr),
    'total_deductions', v_total,
    'net', v_net,
    'cap', v_cap,
    'cap_reduction', v_cap_reduction,
    'negative_net_policy', coalesce(p.negative_net_policy, 'allow'),
    'negative_flag', v_neg_flag,
    'negative_blocked', v_neg_blocked,
    'priority_configured', v_prio_configured
  );
end;
$$;
revoke execute on function public.payroll_policy_finalize(uuid, numeric, jsonb) from public;
grant execute on function public.payroll_policy_finalize(uuid, numeric, jsonb) to authenticated;

-- ============================================================================
-- H. payroll_apply_policy() — the bridge the Payroll Run calls per employee
--    AFTER bifurcation + advance recovery. Inserts the policy lines, applies
--    finalize, rewrites trimmed amounts, returns the reconciled totals +
--    snapshot. A default (unconfigured) policy => no lines, net = gross - Σded.
-- ============================================================================
create or replace function public.payroll_apply_policy(
  p_result_id uuid,
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
  p_structure_id uuid
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
  v_deds jsonb := '[]'::jsonb;
  v_fin jsonb;
  o jsonb;
  v_note text := '';
  v_unresolved boolean := false;
  p public.payroll_policies;
begin
  select payroll_run_id, company_id, employee_id into v_run, v_company, v_emp
  from public.payroll_employee_results where id = p_result_id;
  select * into p from public.payroll_policies where id = p_policy_id;

  select coalesce(array_agg(code), '{}') into v_existing
  from public.payroll_lines where payroll_employee_result_id = p_result_id;

  -- 1. policy-driven lines
  for l in select * from public.payroll_policy_compute_lines(
             p_policy_id, p_period_start, p_period_end, p_working_days, p_joining_date,
             p_basic, p_da, p_gross, p_lwp_days, p_ot_minutes, p_nd_value, p_structure_id, v_existing)
  loop
    insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id,
      line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, calc_formula, sort_order)
    values (v_company, v_run, p_result_id, v_emp, l.line_type, l.code, l.name, l.quantity, l.rate, l.amount,
      'payroll_policy', l.calc_type, l.calc_base, l.calc_note,
      case l.kind
        when 'earning_prorate' then 70 when 'earning_ot' then 60 when 'earning_nd' then 65
        when 'deduction_pf' then 300 when 'deduction_esi' then 310 when 'deduction_pt' then 320
        when 'deduction_tds' then 330 when 'deduction_lwp' then 350
        when 'employer_pf' then 400 when 'employer_esi' then 410 when 'employer_gratuity' then 420
        else 360 end);

    if l.line_type = 'earning' then v_gross := v_gross + l.amount;
    elsif l.line_type = 'employer_contribution' then v_empc := v_empc + l.amount;
    end if;
    if l.kind = 'deduction_lwp' then v_lwp := l.amount; end if;
    if l.kind = 'earning_prorate' then v_prorate := l.amount; end if;
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

  -- 3. write back any trimmed (capped / negative-blocked) deduction amounts
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

  if (v_fin ->> 'cap_reduction')::numeric > 0 then
    v_note := v_note || format('Deduction cap trimmed %s. ', v_fin ->> 'cap_reduction');
  end if;
  if (v_fin ->> 'negative_flag')::boolean then
    v_note := v_note || format('Negative net (%s policy). ', v_fin ->> 'negative_net_policy');
  end if;
  if not (v_fin ->> 'priority_configured')::boolean
     and exists (select 1 from public.payroll_lines where payroll_employee_result_id = p_result_id and line_type = 'deduction') then
    v_note := v_note || 'Deduction priority not configured. ';
  end if;

  return jsonb_build_object(
    'gross', v_gross,
    'total_deductions', (v_fin ->> 'total_deductions')::numeric,
    'net', (v_fin ->> 'net')::numeric,
    'employer_contribution_extra', v_empc,
    'lwp_amount', v_lwp,
    'prorate_amount', v_prorate,
    'statutory_total', v_stat_total,
    'needs_review', v_unresolved or (v_fin ->> 'negative_flag')::boolean,
    'review_note', nullif(btrim(v_note), ''),
    'snapshot', jsonb_build_object(
      'policy_id', p_policy_id, 'policy_code', p.code, 'policy_name', p.policy_name, 'version_no', p.version_no,
      'effective_from', p.effective_from, 'effective_to', p.effective_to,
      'proration_method', p.proration_method, 'proration_basis', p.proration_basis,
      'lwp', jsonb_build_object('enabled', p.lwp_enabled, 'basis', coalesce(p.lwp_basis, p.lwp_divisor_basis), 'method', coalesce(p.lwp_proration_method, p.proration_method), 'divisor', p.lwp_divisor),
      'overtime', jsonb_build_object('enabled', p.ot_enabled, 'rate_type', p.ot_rate_type, 'rate', p.ot_rate),
      'night_duty', jsonb_build_object('enabled', p.nd_earning_enabled, 'rate_type', p.nd_rate_type, 'rate', p.nd_rate),
      'statutory', (select coalesce(jsonb_agg(jsonb_build_object('kind', sr.kind, 'enabled', sr.enabled, 'base', sr.calc_base, 'employee_rate', sr.employee_rate, 'employer_rate', sr.employer_rate, 'ceiling', sr.wage_ceiling)), '[]'::jsonb)
                    from public.payroll_statutory_rules sr where sr.payroll_policy_id = p_policy_id),
      'deduction_cap', jsonb_build_object('mode', p.deduction_cap_mode, 'value', p.deduction_cap_value),
      'negative_net_policy', p.negative_net_policy,
      'deduction_order', (select coalesce(jsonb_agg(jsonb_build_object('code', d.deduction_code, 'priority', d.priority) order by d.priority), '[]'::jsonb)
                          from public.payroll_deduction_order d where d.payroll_policy_id = p_policy_id and d.is_active)
    )
  );
end;
$$;
revoke execute on function public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid) from public;
grant execute on function public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid) to authenticated;


-- ============================================================================
-- I. Policy lifecycle â€” validate / activate / preview / list.
-- ============================================================================
create or replace function public.payroll_policy_validate(p_policy_id uuid)
returns table (ok boolean, error text)
language plpgsql
stable
security definer
as $$
declare p public.payroll_policies; v_overlap int; sr record;
begin
  select * into p from public.payroll_policies where id = p_policy_id;
  if p.id is null then ok := false; error := 'Policy not found.'; return next; return; end if;
  if p.effective_from is null then ok := false; error := 'Effective From is required.'; return next; return; end if;
  if p.effective_to is not null and p.effective_to < p.effective_from then ok := false; error := 'Effective To is before Effective From.'; return next; return; end if;

  select count(*) into v_overlap from public.payroll_policies q
  where q.company_id = p.company_id and q.id <> p.id and q.status = 'active'
    and daterange(q.effective_from, coalesce(q.effective_to, 'infinity'::date), '[]')
        && daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[]');
  if v_overlap > 0 then ok := false; error := 'Another active policy version overlaps this date range.'; return next; return; end if;

  if p.proration_method = 'custom' and p.proration_custom_divisor is null and coalesce(btrim(p.proration_custom_formula), '') = '' then
    ok := false; error := 'Custom proration method needs a custom divisor or formula.'; return next; return; end if;
  if p.lwp_enabled and coalesce(p.lwp_basis, p.lwp_divisor_basis) is null then
    ok := false; error := 'LWP is enabled but no salary basis is configured.'; return next; return; end if;
  if p.ot_enabled and p.ot_rate_type is null then
    ok := false; error := 'Overtime is enabled but no rate type is configured.'; return next; return; end if;
  if p.deduction_cap_mode = 'custom' and coalesce(btrim(p.deduction_cap_formula), '') = '' then
    ok := false; error := 'Custom deduction cap needs a formula.'; return next; return; end if;

  -- formula safety
  begin
    if coalesce(btrim(p.proration_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.proration_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1)); end if;
    if coalesce(btrim(p.ot_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.ot_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1, 'HOURS', 1, 'DIVISOR', 1)); end if;
    if coalesce(btrim(p.nd_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.nd_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1, 'NDVALUE', 1, 'DIVISOR', 1)); end if;
    if coalesce(btrim(p.deduction_cap_formula), '') <> '' then perform public.payroll_eval_formula(p.deduction_cap_formula, jsonb_build_object('GROSS', 1)); end if;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(base_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.base_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
  exception when others then ok := false; error := 'Invalid formula: ' || sqlerrm; return next; return; end;

  ok := true; error := null; return next;
end;
$$;
grant execute on function public.payroll_policy_validate(uuid) to authenticated;

create or replace function public.payroll_policy_activate(p_policy_id uuid)
returns public.payroll_policies
language plpgsql
security definer
as $$
declare p public.payroll_policies; v_ok boolean; v_err text;
begin
  select * into p from public.payroll_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  if not public.payroll_can_manage(p.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;

  select v.ok, v.error into v_ok, v_err from public.payroll_policy_validate(p_policy_id) v limit 1;
  if not v_ok then raise exception 'Policy cannot be activated â€” %', v_err; end if;

  -- close / archive any active policy that would overlap
  update public.payroll_policies
  set status = 'archived',
      effective_to = case when effective_to is null or effective_to >= p.effective_from then p.effective_from - 1 else effective_to end,
      updated_by = auth.uid()
  where company_id = p.company_id and id <> p_policy_id and status = 'active'
    and daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]')
        && daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[]');

  update public.payroll_policies set status = 'active', updated_by = auth.uid() where id = p_policy_id returning * into p;
  return p;
end;
$$;
grant execute on function public.payroll_policy_activate(uuid) to authenticated;

create or replace function public.payroll_policy_list(p_company_id uuid)
returns setof public.payroll_policies
language sql stable security definer
as $$
  select * from public.payroll_policies
  where company_id = p_company_id
    and (is_super_admin() or (current_user_role() <> 'staff' and p_company_id = current_user_company_id()))
  order by effective_from desc, version_no desc;
$$;
grant execute on function public.payroll_policy_list(uuid) to authenticated;

-- ============================================================================
-- J. Policy Preview â€” SAME engine as the run (Â§36). No DB writes.
--    p_inputs jsonb: { gross, basic, da, lwp_days, ot_minutes, nd_value,
--                      advance_recovery, joining_date, other_deductions:[{code,amount}] }
-- ============================================================================
create or replace function public.payroll_policy_preview(
  p_employee_id uuid,
  p_period_month date,
  p_inputs jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_company uuid; v_pstart date; v_pend date; v_working numeric;
  v_pol public.payroll_policies;
  v_res record; v_struct uuid; v_gross numeric; v_basic numeric; v_da numeric;
  v_bif record;
  v_earn jsonb := '[]'::jsonb; v_ded jsonb := '[]'::jsonb; v_empc jsonb := '[]'::jsonb;
  l record; v_fin jsonb; o jsonb;
  v_g numeric := 0; v_join date; v_adv numeric;
  v_lines_deds jsonb := '[]'::jsonb;
begin
  select company_id, joining_date into v_company, v_join from public.employees where id = p_employee_id;
  if v_company is null then raise exception 'Employee not found.'; end if;
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and v_company = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  v_pstart := date_trunc('month', p_period_month)::date;
  v_pend := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  v_working := (v_pend - v_pstart + 1);   -- preview: no attendance calendar; caller may pass override
  v_pol := public.payroll_resolve_policy(v_company, v_pend);
  v_join := coalesce((p_inputs ->> 'joining_date')::date, v_join);

  -- salary source (Phase 5A) â€” overridable
  select r.gross_salary, r.salary_structure_id into v_res from public.salary_resolve_for_employee(p_employee_id, v_pend) r;
  v_gross := coalesce((p_inputs ->> 'gross')::numeric, v_res.gross_salary, 0);
  v_struct := v_res.salary_structure_id;
  v_basic := coalesce((p_inputs ->> 'basic')::numeric, 0);
  v_da := coalesce((p_inputs ->> 'da')::numeric, 0);

  if v_struct is not null then
    for v_bif in select * from public.salary_bifurcate(v_struct, v_gross) loop
      if v_bif.calculation_type = 'advance_recovery' then
        continue;
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

  -- policy-driven lines (same engine)
  for l in select * from public.payroll_policy_compute_lines(
             v_pol.id, v_pstart, v_pend, v_working, v_join, v_basic, v_da, v_g,
             coalesce((p_inputs ->> 'lwp_days')::numeric, 0),
             coalesce((p_inputs ->> 'ot_minutes')::numeric, 0),
             coalesce((p_inputs ->> 'nd_value')::numeric, 0),
             v_struct, (select coalesce(array_agg(x->>'code'), '{}') from jsonb_array_elements(v_earn || v_ded) x))
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
                                 'effective_from', v_pol.effective_from, 'effective_to', v_pol.effective_to),
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
    'priority_configured', v_fin -> 'priority_configured'
  );
end;
$$;
grant execute on function public.payroll_policy_preview(uuid, date, jsonb) to authenticated;


-- ============================================================================
-- K. payroll_calculate_run â€” Phase 6 wiring. Surgical: resolve the versioned
--    policy for the period end; the legacy component loops stop emitting a
--    concept the policy now OWNS (enabled OT / ND / LWP / statutory); after
--    bifurcation + advance recovery, payroll_apply_policy() adds the policy
--    lines and reconciles ordering + cap + negative-net. Default policy =>
--    no new lines, identical result to Phase 5A.
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
  v_res_gross numeric; v_struct_id uuid; v_ambig boolean; v_resolve_note text; v_ltype text; v_advrec_extra numeric;
  v_join date; v_pol_j jsonb; v_gross_pre numeric;
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
  select * into v_pol from public.payroll_resolve_policy(v_run.company_id, v_period.period_end_date);
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
    select e.id, e.full_name, e.employee_code, e.store_id, e.store_department_id, e.store_designation_id, e.joining_date
    from public.employees e
    where e.company_id = v_run.company_id
      and e.status in ('active', 'on_leave', 'notice_period')
      and (e.joining_date is null or e.joining_date <= v_period.period_end_date)
    order by e.full_name
  loop
    v_review := false; v_notes := ''; v_basic := 0; v_da := 0; v_empc := 0; v_advrec := 0; v_gross := 0; v_ded := 0;
    v_join := v_emp.joining_date;

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
      payroll_policy_id, status
    ) values (
      v_run.company_id, v_run.id, v_period.id, v_emp.id,
      v_emp.employee_code, v_emp.full_name,
      (select sd.name from public.store_departments sd where sd.id = v_emp.store_department_id),
      (select sg.title from public.store_designations sg where sg.id = v_emp.store_designation_id),
      (select s.name from public.stores s where s.id = v_emp.store_id),
      v_sal.effective_from, coalesce(v_sal.basic_salary, 0), coalesce(v_sal.da, 0),
      v_calendar, v_working, v_present, coalesce(v_paid_leave, 0), coalesce(v_lwp_days, 0), coalesce(v_woff, 0), coalesce(v_holi, 0), coalesce(v_absent, 0), v_paid_days, v_unpaid_days,
      v_pol.id, 'calculated'
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

      -- period-variable earnings still from payroll_salary_components UNLESS the policy owns them
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

      -- ------- Phase 6 policy engine -------
      v_gross_pre := v_gross;
      v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                  v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), v_struct_id);
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
          proration_factor = case when v_gross_pre = 0 then null else round(v_gross / nullif(v_gross_pre + coalesce((v_pol_j ->> 'prorate_amount')::numeric, 0) - coalesce((v_pol_j ->> 'prorate_amount')::numeric, 0), 0), 6) end,
          lwp_deduction_amount = coalesce((v_pol_j ->> 'lwp_amount')::numeric, 0),
          statutory_deduction_total = coalesce((v_pol_j ->> 'statutory_total')::numeric, 0),
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

    -- ------- Phase 6 policy engine -------
    v_gross_pre := v_gross;
    v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), null);
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
-- L. payroll_finalize_run â€” payslip snapshot gains the Payroll Policy block +
--    a human calculation explanation (Â§46/Â§47). Earning / deduction /
--    employer-contribution arrays already absorb the new policy lines.
-- ============================================================================
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
      'payroll_policy', v_res.policy_snapshot,
      'proration_factor', v_res.proration_factor,
      'lwp_deduction', v_res.lwp_deduction_amount,
      'statutory_deduction_total', v_res.statutory_deduction_total,
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
      'explanation', (select coalesce(jsonb_agg(
                       format('%s: %s%s', name, amount::text,
                              case when coalesce(calc_formula, calc_base, calc_type) is not null
                                   then ' â€” ' || coalesce(calc_formula, (calc_rate::text || '% of ' || calc_base), calc_type) else '' end)
                       order by line_type desc, sort_order), '[]'::jsonb)
                     from public.payroll_lines where payroll_employee_result_id = v_res.id),
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

-- ============================================================================
-- M. payroll_get_employee_result â€” expose the policy snapshot for the review UI.
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
-- Phase 6 fix patches (applied 2026-09-03): validate() ignores older overlaps
-- that activate() will close; a superseded version stays 'active' but
-- date-bounded so historical payroll still resolves it; resolver falls back to
-- a bounded historical version.
-- ============================================================================
-- Phase 6 fix: validate must not treat an OLDER active policy as a fatal
-- overlap â€” activate() closes it. Only a policy that starts on/after this one
-- is an unresolvable clash. activate() closes older actives BEFORE validating
-- (all inside one function => atomic rollback on failure).

create or replace function public.payroll_policy_validate(p_policy_id uuid)
returns table (ok boolean, error text)
language plpgsql
stable
security definer
as $$
declare p public.payroll_policies; v_overlap int; sr record;
begin
  select * into p from public.payroll_policies where id = p_policy_id;
  if p.id is null then ok := false; error := 'Policy not found.'; return next; return; end if;
  if p.effective_from is null then ok := false; error := 'Effective From is required.'; return next; return; end if;
  if p.effective_to is not null and p.effective_to < p.effective_from then ok := false; error := 'Effective To is before Effective From.'; return next; return; end if;

  select count(*) into v_overlap from public.payroll_policies q
  where q.company_id = p.company_id and q.id <> p.id and q.status = 'active'
    and q.effective_from >= p.effective_from
    and daterange(q.effective_from, coalesce(q.effective_to, 'infinity'::date), '[]')
        && daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[]');
  if v_overlap > 0 then ok := false; error := 'Another active policy version starts inside this date range.'; return next; return; end if;

  if p.proration_method = 'custom' and p.proration_custom_divisor is null and coalesce(btrim(p.proration_custom_formula), '') = '' then
    ok := false; error := 'Custom proration method needs a custom divisor or formula.'; return next; return; end if;
  if p.lwp_enabled and coalesce(p.lwp_basis, p.lwp_divisor_basis) is null then
    ok := false; error := 'LWP is enabled but no salary basis is configured.'; return next; return; end if;
  if p.ot_enabled and p.ot_rate_type is null then
    ok := false; error := 'Overtime is enabled but no rate type is configured.'; return next; return; end if;
  if p.deduction_cap_mode = 'custom' and coalesce(btrim(p.deduction_cap_formula), '') = '' then
    ok := false; error := 'Custom deduction cap needs a formula.'; return next; return; end if;

  begin
    if coalesce(btrim(p.proration_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.proration_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1)); end if;
    if coalesce(btrim(p.ot_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.ot_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1, 'HOURS', 1, 'DIVISOR', 1)); end if;
    if coalesce(btrim(p.nd_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.nd_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1, 'NDVALUE', 1, 'DIVISOR', 1)); end if;
    if coalesce(btrim(p.deduction_cap_formula), '') <> '' then perform public.payroll_eval_formula(p.deduction_cap_formula, jsonb_build_object('GROSS', 1)); end if;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(base_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.base_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
  exception when others then ok := false; error := 'Invalid formula: ' || sqlerrm; return next; return; end;

  ok := true; error := null; return next;
end;
$$;
grant execute on function public.payroll_policy_validate(uuid) to authenticated;

create or replace function public.payroll_policy_activate(p_policy_id uuid)
returns public.payroll_policies
language plpgsql
security definer
as $$
declare p public.payroll_policies; v_ok boolean; v_err text;
begin
  select * into p from public.payroll_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  if not public.payroll_can_manage(p.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;

  -- close / archive any OLDER active policy that would overlap (atomic â€” a later
  -- validation failure rolls this back with the rest of the function)
  update public.payroll_policies
  set status = 'archived',
      effective_to = case when effective_to is null or effective_to >= p.effective_from then p.effective_from - 1 else effective_to end,
      updated_by = auth.uid()
  where company_id = p.company_id and id <> p_policy_id and status = 'active'
    and effective_from <= p.effective_from
    and daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]')
        && daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[]');

  select v.ok, v.error into v_ok, v_err from public.payroll_policy_validate(p_policy_id) v limit 1;
  if not v_ok then raise exception 'Policy cannot be activated â€” %', v_err; end if;

  update public.payroll_policies set status = 'active', updated_by = auth.uid() where id = p_policy_id returning * into p;
  return p;
end;
$$;
grant execute on function public.payroll_policy_activate(uuid) to authenticated;


-- Phase 6 fix: a superseded policy version stays 'active' (just date-bounded) so
-- historical periods still resolve to it; resolver also falls back to a bounded
-- historical version. Exclusion constraint still holds (ranges no longer &&).

create or replace function public.payroll_resolve_policy(p_company_id uuid, p_as_of date)
returns public.payroll_policies
language plpgsql
stable
security definer
as $$
declare v_pol public.payroll_policies;
begin
  -- 1. an active version whose range covers the date
  select * into v_pol from public.payroll_policies
  where company_id = p_company_id and status = 'active'
    and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc limit 1;
  if v_pol.id is not null then return v_pol; end if;

  -- 2. any non-draft version that historically covered the date (superseded/archived)
  select * into v_pol from public.payroll_policies
  where company_id = p_company_id and status <> 'draft'
    and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc, version_no desc limit 1;
  if v_pol.id is not null then return v_pol; end if;

  -- 3. newest active, else newest of any status
  select * into v_pol from public.payroll_policies
  where company_id = p_company_id and status = 'active'
  order by effective_from desc limit 1;
  if v_pol.id is not null then return v_pol; end if;

  select * into v_pol from public.payroll_policies where company_id = p_company_id
  order by effective_from desc, version_no desc limit 1;
  return v_pol;
end;
$$;
grant execute on function public.payroll_resolve_policy(uuid, date) to authenticated;

create or replace function public.payroll_policy_activate(p_policy_id uuid)
returns public.payroll_policies
language plpgsql
security definer
as $$
declare p public.payroll_policies; v_ok boolean; v_err text;
begin
  select * into p from public.payroll_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  if not public.payroll_can_manage(p.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;

  -- close (NOT archive) any OLDER active version that would overlap â€” it stays
  -- 'active' for its own historical date range so past payroll still resolves it
  update public.payroll_policies
  set effective_to = p.effective_from - 1, updated_by = auth.uid()
  where company_id = p.company_id and id <> p_policy_id and status = 'active'
    and effective_from <= p.effective_from
    and (effective_to is null or effective_to >= p.effective_from);

  select v.ok, v.error into v_ok, v_err from public.payroll_policy_validate(p_policy_id) v limit 1;
  if not v_ok then raise exception 'Policy cannot be activated â€” %', v_err; end if;

  update public.payroll_policies set status = 'active', updated_by = auth.uid() where id = p_policy_id returning * into p;
  return p;
end;
$$;
grant execute on function public.payroll_policy_activate(uuid) to authenticated;
