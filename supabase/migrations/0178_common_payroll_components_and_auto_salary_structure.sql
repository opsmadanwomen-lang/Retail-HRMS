-- ============================================================================
-- Retail HRMS — Simple Payroll Salary Configuration
--   (1) Common Payroll Components — created ONCE, apply to every salary structure
--   (2) Salary is resolved from Gross (slab -> structure); Grade is a RESULT
--   (3) Preview of an UNSAVED Gross uses the SAME engine as Payroll
--   (4) Effective-dated salary revision now records previous/new Gross + structure
-- Migration 0178
--
-- INSPECTED FIRST (live DB + migrations 0138/0140/0143/0153/0175/0176/0177). Findings this migration acts on:
--   * payroll_statutory_rules already IS the common-component engine: one rule per policy, applies to every
--     salary structure, supports Fixed / % of Basic / % of Gross / % of Component / Formula / Manual-Excel,
--     reads manual amounts from payroll_component_amounts, and is what payroll_policy_preview uses. What it could
--     NOT do is hold a NAMED component (Medical Fund, Incentive, Other Deduction/Earning) — 'other' was a single
--     row whose line was hard-named "Statutory". -> rules gain component_code / component_name / component_type.
--     No new table, no new engine, no per-structure duplication (M1/M2/M3 all see the same rule).
--   * salary_resolve_for_employee could only resolve from the SAVED assignment, so a Gross being typed in the UI
--     could not be routed to its slab/structure. -> the existing body becomes salary_resolve_core(..., gross
--     override); salary_resolve_for_employee stays as a thin wrapper with the SAME signature/behaviour, so every
--     current caller (payroll, F&F, transfers, leave encashment) is untouched. The slab lookup exists exactly once.
--   * payroll_policy_preview (the Payroll preview) now resolves the structure from the typed Gross and returns the
--     resolved structure, so the UI never needs a second calculation path.
--   * employee_salary_assignments recorded only Gross + optional explicit structure. -> previous gross, previous /
--     resolved structure are now stored on every revision (created_by/created_at already existed).
--
-- NOT changed: salary_bifurcate, payroll_calculate_run, payroll_apply_policy, OT / LWP / Late / Advance recovery
-- engines, slab rows, structure rows, rounding config, RLS on any existing table, finalized/locked payroll.
-- No company data (slabs, rates, rounding) is written by this migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. payroll_statutory_rules -> can carry a named Common Payroll Component
-- ----------------------------------------------------------------------------
alter table public.payroll_statutory_rules
  add column if not exists component_code text,
  add column if not exists component_name text,
  add column if not exists component_type text;

alter table public.payroll_statutory_rules
  drop constraint if exists payroll_statutory_rules_component_type_check,
  drop constraint if exists payroll_statutory_rules_named_component_check;
alter table public.payroll_statutory_rules
  add constraint payroll_statutory_rules_component_type_check
    check (component_type is null or component_type in ('earning', 'deduction')),
  add constraint payroll_statutory_rules_named_component_check
    check (
      component_code is null
      or (
        kind = 'other'
        and component_code = upper(btrim(component_code))
        and component_code ~ '^[A-Z][A-Z0-9_]{1,19}$'
        and component_code !~ '_ER$'
        and component_code not in ('OT', 'NDUTY', 'LWP', 'ADVREC', 'LATE', 'PF', 'ESI', 'PT', 'TDS', 'GRATUITY',
                                   'PRORATE', 'PRORATE_EXIT', 'BASIC', 'DA', 'GROSS', 'NET')
        and coalesce(btrim(component_name), '') <> ''
        and component_type is not null
      )
    );

-- One rule per (policy, kind, effective_from) becomes one per (policy, kind, code, effective_from) so several
-- named components can coexist under kind='other'. Legacy rows (component_code null) keep the same uniqueness.
alter table public.payroll_statutory_rules drop constraint if exists payroll_statutory_rules_payroll_policy_id_kind_effective_fr_key;
create unique index if not exists uq_payroll_statutory_rules_policy_kind_code_from
  on public.payroll_statutory_rules (payroll_policy_id, kind, coalesce(component_code, ''), effective_from);

-- A named component may not reuse a code that a salary-structure component already uses in this company
-- (the payroll engine would silently skip the common line for that structure).
create or replace function public.payroll_statutory_rules_component_guard()
returns trigger language plpgsql as $g$
begin
  if new.component_code is not null then
    new.component_code := upper(btrim(new.component_code));
    if exists (
      select 1 from public.salary_structure_components c
      join public.salary_structures s on s.id = c.salary_structure_id
      where s.company_id = new.company_id and upper(c.code) = new.component_code
    ) then
      raise exception 'Code "%" is already used by a salary-structure component. Choose a different code for this common component.', new.component_code;
    end if;
    if exists (
      select 1 from public.payroll_salary_components c
      where c.company_id = new.company_id and c.is_active and upper(c.code) = new.component_code
        and coalesce(c.source, '') in ('basic', 'da', 'overtime', 'night_duty', 'lwp', 'advance_recovery', 'statutory')
    ) then
      raise exception 'Code "%" is reserved by a system payroll component.', new.component_code;
    end if;
  end if;
  return new;
end;
$g$;
drop trigger if exists trg_payroll_statutory_rules_component_guard on public.payroll_statutory_rules;
create trigger trg_payroll_statutory_rules_component_guard
  before insert or update on public.payroll_statutory_rules
  for each row execute function public.payroll_statutory_rules_component_guard();

-- ----------------------------------------------------------------------------
-- B. Resolver. salary_resolve_core = the existing (0153) body + an optional Gross override.
--    salary_resolve_for_employee = same signature/behaviour as before (override = NULL).
--    The core is NOT exposed to API roles; it is only reachable through SECURITY DEFINER callers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salary_resolve_core(p_employee_id uuid, p_as_of date, p_gross_override numeric)
 RETURNS TABLE(gross_salary numeric, salary_structure_id uuid, structure_name text, source text, ambiguous boolean, resolve_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
  v_hist public.employee_assignment_history;
begin
  select e.company_id, e.store_id, e.store_department_id, e.store_designation_id, e.grade_id, e.category_id,
         e.employment_type::text as employment_type
  into v_emp from public.employees e where e.id = p_employee_id;
  if v_emp.company_id is null then raise exception 'Employee not found.'; end if;

  -- Employee Transfer (Phase 2 correction): scope-based structure resolution
  -- must use the assignment EFFECTIVE as of p_as_of, not whatever the employee's
  -- live row happens to hold right now (which may lag until a transfer's
  -- effective date is swept) — resolve from the authoritative history ledger.
  -- No history for this employee -> v_hist is all-null -> every coalesce below
  -- falls back to the live columns, so an employee never transferred is
  -- completely unaffected.
  v_hist := public.employee_assignment_as_of(p_employee_id, p_as_of);
  v_emp.store_id := coalesce(v_hist.store_id, v_emp.store_id);
  v_emp.store_department_id := coalesce(v_hist.store_department_id, v_emp.store_department_id);
  v_emp.store_designation_id := coalesce(v_hist.store_designation_id, v_emp.store_designation_id);
  v_emp.grade_id := coalesce(v_hist.grade_id, v_emp.grade_id);
  v_emp.category_id := coalesce(v_hist.category_id, v_emp.category_id);
  v_emp.employment_type := coalesce(v_hist.employment_type, v_emp.employment_type);

  select * into v_asg from public.employee_salary_assignments a
  where a.employee_id = p_employee_id and a.effective_from <= p_as_of and (a.effective_to is null or a.effective_to >= p_as_of)
  order by a.effective_from desc limit 1;

  if p_gross_override is not null then
    -- Preview / revision-save path: the Gross being typed is the input. The structure is NOT taken from the
    -- saved assignment (a new revision carries no explicit structure); scope tiers + slab decide, exactly as payroll.
    v_gross := p_gross_override; v_src := 'entered_gross';
  elsif v_asg.id is not null then
    v_gross := v_asg.gross_salary; v_src := 'assignment';
    if v_asg.salary_structure_id is not null then v_struct := v_asg.salary_structure_id; v_src := v_src || '+explicit_structure'; end if;
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
$function$;

revoke execute on function public.salary_resolve_core(uuid, date, numeric) from public, anon, authenticated;

create or replace function public.salary_resolve_for_employee(p_employee_id uuid, p_as_of date)
returns table (gross_salary numeric, salary_structure_id uuid, structure_name text, source text, ambiguous boolean, resolve_note text)
language plpgsql
stable
security definer
as $w$
begin
  return query
  select r.gross_salary, r.salary_structure_id, r.structure_name, r.source, r.ambiguous, r.resolve_note
  from public.salary_resolve_core(p_employee_id, p_as_of, null) r;
end;
$w$;
grant execute on function public.salary_resolve_for_employee(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- C. Common components in the payroll line engine (rules with component_code). PF/ESI/PT/TDS/Gratuity and legacy
--    'other' rows are reproduced verbatim (v_ccode/v_cname/v_clt/v_cctype collapse to the old literals for them).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_policy_compute_lines(p_policy_id uuid, p_period_start date, p_period_end date, p_working_days numeric, p_joining_date date, p_basic numeric, p_da numeric, p_gross numeric, p_lwp_days numeric, p_ot_minutes numeric, p_nd_value numeric, p_structure_id uuid DEFAULT NULL::uuid, p_existing_codes text[] DEFAULT '{}'::text[], p_leaving_date date DEFAULT NULL::date, p_exit_date_payable boolean DEFAULT NULL::boolean, p_tds jsonb DEFAULT NULL::jsonb, p_manual_components jsonb DEFAULT '{}'::jsonb, p_component_amounts jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(kind text, line_type text, code text, name text, quantity numeric, rate numeric, amount numeric, calc_type text, calc_base text, calc_note text, unresolved boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
  v_custom boolean;
  v_ccode text;
  v_cname text;
  v_clt text;
  v_cctype text;
  v_last_payable date;
  v_mkey text;
  v_man jsonb;
  v_emp_amt numeric;
  v_er_amt numeric;
  v_mnote text;
  v_munres boolean;
  v_refamt numeric;
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
        calc_note := format('Joined %s - %s day(s) not worked. Proration method/basis/divisor not configured.', p_joining_date, v_lost_join);
        unresolved := true; return next;
      else
        v_daily := round(v_base / v_div, 6);
        kind := 'earning_prorate'; line_type := 'earning'; code := 'PRORATE'; name := 'Joining-month proration';
        quantity := v_lost_join; rate := v_daily; amount := - round(v_daily * v_lost_join, v_prec); calc_type := 'proration';
        calc_base := p.proration_basis;
        calc_note := format('Joined %s - %s day(s) x daily %s (%s / %s, %s)', p_joining_date, v_lost_join, v_daily, v_base, v_div, p.proration_method);
        unresolved := false; return next;
      end if;
    end if;
  end if;

  -- ---- 1b. Exit-month proration (SAME engine, SAME policy) ----
  if p_leaving_date is not null and p_leaving_date < p_period_end then
    if p_exit_date_payable is null then
      kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
      quantity := (p_period_end - p_leaving_date); rate := null; amount := 0; calc_type := 'proration_exit'; calc_base := p.proration_basis;
      calc_note := format('Left %s - exit_date_payable not confirmed (business decision). No exit proration applied.', p_leaving_date);
      unresolved := true; return next;
    else
      v_last_payable := case when p_exit_date_payable then p_leaving_date else p_leaving_date - 1 end;
      v_lost := greatest(p_period_end - v_last_payable, 0);
      if v_div is not null then v_lost := least(v_lost, greatest(v_div - v_lost_join, 0)); end if;
      if v_lost > 0 then
        if p.proration_method is null or v_div is null or v_div = 0 or v_base is null then
          kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
          quantity := v_lost; rate := null; amount := 0; calc_type := 'proration_exit'; calc_base := p.proration_basis;
          calc_note := format('Left %s - %s day(s) after last payable day. Proration method/basis/divisor not configured.', p_leaving_date, v_lost);
          unresolved := true; return next;
        else
          v_daily := round(v_base / v_div, 6);
          kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
          quantity := v_lost; rate := v_daily; amount := - round(v_daily * v_lost, v_prec); calc_type := 'proration_exit';
          calc_base := p.proration_basis;
          calc_note := format('Left %s (last payable %s) - %s day(s) x daily %s (%s / %s, %s)', p_leaving_date, v_last_payable, v_lost, v_daily, v_base, v_div, p.proration_method);
          unresolved := false; return next;
        end if;
      end if;
    end if;
  end if;

  -- ---- 2. Overtime â€” SYSTEM-CALCULATED, sourced ONLY from the Attendance OT Rule Engine ----
  -- p_ot_minutes is attendance_records.payable_overtime_minutes: eligibility, minimum, slab,
  -- rounding and maximum have ALREADY been applied by the configured Attendance OT Rule
  -- (calculate_overtime_minutes). Payroll adds NO rate method, NO fixed amount, NO %-of-salary,
  -- NO formula, NO Excel import and NO override. It only VALUES those payable minutes at the
  -- employee's ordinary hourly wage (Basic+DA over the standard monthly hours). The OT premium
  -- (1.5x / 2x / slab) is entirely inside p_ot_minutes.
  if p.ot_enabled and coalesce(p_ot_minutes, 0) > 0 and not ('OT' = any(p_existing_codes)) then
    v_hours := round(p_ot_minutes / 60.0, 2);
    if v_div is null or v_stdh is null then
      v_rate := null; v_amt := 0; unresolved := true;
      v_note := format('%s payable OT minute(s) from the Attendance OT Rule â€” cannot be valued: standard hours/day and/or a proration divisor are not configured.', p_ot_minutes);
    else
      v_rate := round((p_basic + p_da) / v_div / v_stdh, 4);   -- ordinary per-hour wage (Basic+DA / divisor / std hours)
      v_amt := round(v_hours * v_rate, v_prec);
      unresolved := false;
      v_note := format('%s payable OT min from the Attendance OT Rule (premium already applied) Ã— ordinary hourly wage %s (Basic+DA Ã· %s Ã· %s h/day)', p_ot_minutes, v_rate, v_div, v_stdh);
    end if;
    kind := 'earning_ot'; line_type := 'earning'; code := 'OT'; name := 'Overtime';
    quantity := v_hours; rate := v_rate; amount := v_amt; calc_type := 'overtime_attendance'; calc_base := 'basic_da'; calc_note := v_note;
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
      unresolved := false; v_note := format('%s unit(s) x %s (%s)', p_nd_value, v_rate, coalesce(p.nd_rate_type, 'fixed'));
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
        calc_note := format('%s LWP day(s) - LWP daily-rate needs a configured basis + divisor/method.', p_lwp_days);
        unresolved := true; return next;
      else
        v_daily := round(v_lb / v_ld, 6);
        kind := 'deduction_lwp'; line_type := 'deduction'; code := 'LWP'; name := 'Loss of Pay';
        quantity := p_lwp_days; rate := v_daily;
        amount := round(v_daily * p_lwp_days, case coalesce(p.lwp_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
        calc_type := 'lwp'; calc_base := coalesce(p.lwp_basis, p.lwp_divisor_basis);
        calc_note := format('%s day(s) x daily %s (%s / %s)', p_lwp_days, v_daily, v_lb, v_ld);
        unresolved := false; return next;
      end if;
    end;
  end if;

  -- ---- 5. Statutory (PF / ESI / PT / TDS / Gratuity / Other) ----
  for r in
    select * from public.payroll_statutory_rules sr
    where sr.payroll_policy_id = p_policy_id and sr.enabled
      and sr.effective_from <= p_period_end and (sr.effective_to is null or sr.effective_to >= p_period_start)
    order by array_position(array['pf','esi','pt','tds','gratuity','other'], sr.kind), sr.component_code nulls first, sr.created_at
  loop
    -- Common Payroll Component (0178): a kind='other' rule that carries its own component_code/name/type is a
    -- named, reusable component (Medical Fund, Incentive, ...). It is NOT tied to any salary structure. Every other
    -- rule (PF/ESI/PT/TDS/Gratuity/legacy Other) keeps the original code/name/line-type exactly.
    v_custom := (r.kind = 'other' and coalesce(btrim(r.component_code), '') <> '');
    v_ccode := case when v_custom then upper(btrim(r.component_code)) else upper(r.kind) end;
    v_cname := case when v_custom then coalesce(nullif(btrim(r.component_name), ''), v_ccode)
                    else (case r.kind when 'pf' then 'Provident Fund' when 'esi' then 'ESI' when 'gratuity' then 'Gratuity (employee)' else 'Statutory' end) end;
    v_clt := case when v_custom and r.component_type = 'earning' then 'earning' else 'deduction' end;
    v_cctype := case when v_custom then 'common_component' else 'statutory_' || r.kind end;
    v_has_struct_stat := not v_custom and p_structure_id is not null and exists (
      select 1 from public.salary_structure_components c
      where c.salary_structure_id = p_structure_id and c.is_active and c.statutory_kind = r.kind);
    if v_has_struct_stat or (v_ccode = any(p_existing_codes)) then continue; end if;

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
        calc_note := format('TDS %s regime - annual %s / 12 (slab %s%%)', p_tds ->> 'tax_regime', p_tds ->> 'final_annual_tds', coalesce(p_tds ->> 'slab_rate', '?'));
      elsif p_tds is not null then
        amount := 0; unresolved := true; calc_note := 'TDS Not Configured - ' || coalesce(p_tds ->> 'reason', 'incomplete TDS policy.');
      elsif coalesce(btrim(r.base_formula), '') <> '' then
        amount := round(coalesce(public.payroll_eval_formula(r.base_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec);
        unresolved := false; calc_note := 'TDS via configured formula.';
      else
        amount := 0; unresolved := true; calc_note := 'TDS Not Configured - no tax engine / policy supplied.';
      end if;
      return next;

    else
      -- ============ PF / ESI / Gratuity / Other ============
      if r.calc_method = 'pct_of_base' then
        -- ----- original behaviour, unchanged -----
        if r.kind = 'esi' and r.wage_ceiling is not null and p_gross > r.wage_ceiling then
          kind := 'deduction_esi'; line_type := 'deduction'; code := 'ESI'; name := 'ESI';
          quantity := null; rate := 0; amount := 0; calc_type := 'statutory_esi'; calc_base := coalesce(r.calc_base, 'gross');
          calc_note := format('ESI not applicable - gross %s above ceiling %s.', p_gross, r.wage_ceiling); unresolved := false;
          return next;
        else
          kind := (case when v_clt = 'earning' then 'earning_' else 'deduction_' end) || r.kind; line_type := v_clt;
          code := v_ccode; name := v_cname;
          quantity := null; calc_type := v_cctype; calc_base := r.calc_base;
          if r.employee_rate is null then
            rate := null; amount := 0; unresolved := true; calc_note := format('%s employee rate not configured.', v_ccode);
          elsif v_sbase is null then
            rate := r.employee_rate; amount := 0; unresolved := true; calc_note := format('%s calculation base not configured.', v_ccode);
          else
            rate := r.employee_rate; amount := round(v_sbase * r.employee_rate / 100.0, v_prec); unresolved := false;
            calc_note := format('%s%% of %s (%s)%s', r.employee_rate, coalesce(r.calc_base, 'base'), v_sbase,
                                case when r.wage_ceiling is not null then format(' capped @ %s', r.wage_ceiling) else '' end);
          end if;
          return next;
        end if;

        if r.employer_rate is not null and v_sbase is not null then
          kind := 'employer_' || r.kind; line_type := 'employer_contribution';
          code := v_ccode || '_ER'; name := 'Employer ' || (case when v_custom then v_cname else upper(r.kind) end);
          quantity := null; rate := r.employer_rate; amount := round(v_sbase * r.employer_rate / 100.0, v_prec);
          calc_type := 'employer_' || r.kind; calc_base := r.calc_base;
          calc_note := format('%s%% of %s (%s) - employer', r.employer_rate, coalesce(r.calc_base, 'base'), v_sbase); unresolved := false;
          return next;
        end if;

      else
        -- ----- fixed_amount / pct_of_component / formula / manual -----
        v_mkey := v_ccode;
        v_emp_amt := null; v_er_amt := null; v_mnote := null; v_munres := false;

        if r.calc_method = 'manual' then
          v_man := coalesce(p_manual_components -> v_mkey, p_manual_components -> lower(v_mkey));
          if v_man is null or (v_man ->> 'employee_amount') is null then
            v_munres := true;
            v_mnote := format('%s: Manual / Excel amount not entered for this employee and payroll period.', v_mkey);
          else
            v_emp_amt := round((v_man ->> 'employee_amount')::numeric, v_prec);   -- explicit 0 is respected
            v_er_amt := case when (v_man ->> 'employer_amount') is not null
                             then round((v_man ->> 'employer_amount')::numeric, v_prec) else null end;
            v_mnote := format('%s: manual/imported amount for this payroll period (%s).', v_mkey, coalesce(v_man ->> 'source', 'manual'));
          end if;

        elsif r.calc_method = 'fixed_amount' then
          if r.employee_amount is null then
            v_munres := true; v_mnote := format('%s: fixed amount not configured.', v_mkey);
          else
            v_emp_amt := round(r.employee_amount, v_prec);
            v_er_amt := case when r.employer_amount is not null then round(r.employer_amount, v_prec) else null end;
            v_mnote := format('%s: fixed amount %s.', v_mkey, v_emp_amt);
          end if;

        elsif r.calc_method = 'pct_of_component' then
          v_refamt := (p_component_amounts ->> coalesce(r.ref_component_code, ''))::numeric;
          if coalesce(btrim(r.ref_component_code), '') = '' or v_refamt is null then
            v_munres := true;
            v_mnote := format('%s: %% of component "%s" - the referenced component is not present in this payslip.', v_mkey, coalesce(r.ref_component_code, '?'));
          elsif r.employee_rate is null then
            v_munres := true; v_mnote := format('%s: %% of component rate not configured.', v_mkey);
          else
            if r.wage_ceiling is not null then v_refamt := least(v_refamt, r.wage_ceiling); end if;
            v_emp_amt := round(v_refamt * r.employee_rate / 100.0, v_prec);
            v_er_amt := case when r.employer_rate is not null then round(v_refamt * r.employer_rate / 100.0, v_prec) else null end;
            v_mnote := format('%s: %s%% of %s (%s).', v_mkey, r.employee_rate, r.ref_component_code, v_refamt);
          end if;

        elsif r.calc_method = 'formula' then
          if coalesce(btrim(r.base_formula), '') = '' then
            v_munres := true; v_mnote := format('%s: custom formula not configured.', v_mkey);
          else
            v_emp_amt := round(coalesce(public.payroll_eval_formula(r.base_formula,
                          jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec);
            v_er_amt := case when coalesce(btrim(r.employer_formula), '') <> ''
                             then round(coalesce(public.payroll_eval_formula(r.employer_formula,
                                   jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec)
                             else null end;
            v_mnote := format('%s: custom formula.', v_mkey);
          end if;
        end if;

        -- employee deduction line
        kind := (case when v_clt = 'earning' then 'earning_' else 'deduction_' end) || r.kind; line_type := v_clt;
        code := v_ccode; name := v_cname;
        quantity := null;
        rate := case when r.calc_method = 'pct_of_component' then r.employee_rate else null end;
        calc_type := v_cctype;
        calc_base := coalesce(r.calc_base, case when r.calc_method = 'pct_of_component' then r.ref_component_code else r.calc_method end);
        if v_munres then amount := 0; unresolved := true; calc_note := v_mnote;
        else amount := coalesce(v_emp_amt, 0); unresolved := false; calc_note := v_mnote; end if;
        return next;

        -- employer contribution line (only when the method produced one)
        if v_er_amt is not null then
          kind := 'employer_' || r.kind; line_type := 'employer_contribution';
          code := v_ccode || '_ER'; name := 'Employer ' || (case when v_custom then v_cname else upper(r.kind) end);
          quantity := null;
          rate := case when r.calc_method = 'pct_of_component' then r.employer_rate else null end;
          amount := v_er_amt; calc_type := 'employer_' || r.kind; calc_base := r.calc_base;
          calc_note := format('%s employer contribution (%s).', v_ccode, r.calc_method); unresolved := false;
          return next;
        end if;
      end if;
    end if;
  end loop;

  return;
end;
$function$;

-- ----------------------------------------------------------------------------
-- D. Preview: resolve the structure from the typed Gross and return it. Everything else is the live body.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_policy_preview(p_employee_id uuid, p_period_month date, p_inputs jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
  v_manual_comp jsonb; v_comp_amounts jsonb := '{}'::jsonb;
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

  select r.gross_salary, r.salary_structure_id, r.structure_name, r.source, r.ambiguous, r.resolve_note into v_res
  from public.salary_resolve_core(p_employee_id, v_pend, nullif(p_inputs ->> 'gross', '')::numeric) r;
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

  -- manual / imported PF/ESI amounts: explicit override in p_inputs, else this period's stored values
  v_manual_comp := coalesce(p_inputs -> 'manual_components', '{}'::jsonb);
  if v_manual_comp = '{}'::jsonb then
    select coalesce(jsonb_object_agg(upper(pca.component_code),
             jsonb_build_object('employee_amount', pca.employee_amount, 'employer_amount', pca.employer_amount, 'source', pca.source)), '{}'::jsonb)
      into v_manual_comp
    from public.payroll_component_amounts pca
    join public.payroll_periods pp on pp.id = pca.payroll_period_id
    where pp.company_id = v_company and pp.period_month = v_pstart and pca.employee_id = p_employee_id;
  end if;
  select coalesce(jsonb_object_agg(x ->> 'code', (x ->> 'amount')::numeric), '{}'::jsonb) into v_comp_amounts
  from jsonb_array_elements(v_earn) x;

  for l in select * from public.payroll_policy_compute_lines(
             v_pol.id, v_pstart, v_pend, v_working, v_join, v_basic, v_da, v_g,
             coalesce((p_inputs ->> 'lwp_days')::numeric, 0),
             coalesce((p_inputs ->> 'ot_minutes')::numeric, 0),
             coalesce((p_inputs ->> 'nd_value')::numeric, 0),
             v_struct, (select coalesce(array_agg(x->>'code'), '{}') from jsonb_array_elements(v_earn || v_ded) x),
             v_leave, v_exit_pay, v_tds, v_manual_comp, v_comp_amounts)
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
    'salary_structure', jsonb_build_object(
      'id', v_struct, 'code', (select ss.code from public.salary_structures ss where ss.id = v_struct), 'name', v_res.structure_name,
      'source', v_res.source, 'ambiguous', coalesce(v_res.ambiguous, false), 'note', v_res.resolve_note,
      'gross', coalesce(v_res.gross_salary, 0)),
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

-- ----------------------------------------------------------------------------
-- E. Validation messages name the common component instead of "OTHER".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_policy_validate(p_policy_id uuid)
 RETURNS TABLE(ok boolean, error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
  if p.deduction_cap_mode = 'custom' and coalesce(btrim(p.deduction_cap_formula), '') = '' then
    ok := false; error := 'Custom deduction cap needs a formula.'; return next; return; end if;

  for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and enabled loop
    if sr.calc_method = 'pct_of_component' and coalesce(btrim(sr.ref_component_code), '') = '' then
      ok := false; error := format('%s uses "%% of another component" but no reference component code is set.', coalesce(upper(sr.component_code), upper(sr.kind)));
      return next; return;
    end if;
    if sr.calc_method = 'formula' and coalesce(btrim(sr.base_formula), '') = '' then
      ok := false; error := format('%s uses a custom formula but none is configured.', coalesce(upper(sr.component_code), upper(sr.kind)));
      return next; return;
    end if;
  end loop;

  begin
    if coalesce(btrim(p.proration_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.proration_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1)); end if;
    if coalesce(btrim(p.nd_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.nd_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1, 'NDVALUE', 1, 'DIVISOR', 1)); end if;
    if coalesce(btrim(p.deduction_cap_formula), '') <> '' then perform public.payroll_eval_formula(p.deduction_cap_formula, jsonb_build_object('GROSS', 1)); end if;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(base_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.base_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(employer_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.employer_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
  exception when others then ok := false; error := 'Invalid formula: ' || sqlerrm; return next; return; end;

  ok := true; error := null; return next;
end;
$function$;

-- ----------------------------------------------------------------------------
-- F. Manual / Excel import: a common component whose rule is 'manual' is import-eligible (OT still never is).
-- ----------------------------------------------------------------------------
create or replace function public.payroll_component_import_eligible(p_company_id uuid, p_code text)
returns boolean
language sql
stable
security definer
as $fn$
  select case
    when p_code is null or upper(btrim(p_code)) = 'OT' then false
    when upper(btrim(p_code)) in ('PF', 'ESI') then true
    when exists (
      select 1 from public.payroll_salary_components c
      where c.company_id = p_company_id
        and upper(c.code) = upper(btrim(p_code))
        and c.is_active
        and coalesce(c.source, '') <> 'overtime'
        and c.calculation_method = 'manual'
    ) then true
    when exists (
      select 1 from public.salary_structure_components sc
      join public.salary_structures ss on ss.id = sc.salary_structure_id
      where ss.company_id = p_company_id
        and ss.status = 'active'
        and upper(sc.code) = upper(btrim(p_code))
        and sc.is_active
        and sc.calculation_type = 'manual'
    ) then true
    when exists (
      select 1 from public.payroll_statutory_rules sr
      join public.payroll_policies pp on pp.id = sr.payroll_policy_id
      where sr.company_id = p_company_id
        and sr.kind = 'other' and sr.enabled and sr.calc_method = 'manual'
        and sr.component_code is not null and upper(sr.component_code) = upper(btrim(p_code))
        and pp.status <> 'archived'
    ) then true
    else false
  end;
$fn$;
grant execute on function public.payroll_component_import_eligible(uuid, text) to authenticated;

create or replace function public.payroll_component_import_codes(p_company_id uuid)
returns text[]
language sql
stable
security definer
as $fn$
  select coalesce(array_agg(distinct code order by code), array['PF', 'ESI'])
  from (
    select 'PF' as code
    union all select 'ESI'
    union all
    select upper(c.code) from public.payroll_salary_components c
    where c.company_id = p_company_id and c.is_active and coalesce(c.source, '') <> 'overtime' and c.calculation_method = 'manual'
    union all
    select upper(sc.code) from public.salary_structure_components sc
    join public.salary_structures ss on ss.id = sc.salary_structure_id
    where ss.company_id = p_company_id and ss.status = 'active' and sc.is_active and sc.calculation_type = 'manual'
    union all
    select upper(sr.component_code) from public.payroll_statutory_rules sr
    join public.payroll_policies pp on pp.id = sr.payroll_policy_id
    where sr.company_id = p_company_id and sr.kind = 'other' and sr.enabled and sr.calc_method = 'manual'
      and sr.component_code is not null and pp.status <> 'archived'
  ) x;
$fn$;
grant execute on function public.payroll_component_import_codes(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- G. Effective-dated salary revision: previous Gross + previous / resolved structure recorded on every revision.
--    (employee, effective_from, gross, assigned_by, created_at, previous_assignment_id already existed.)
-- ----------------------------------------------------------------------------
alter table public.employee_salary_assignments
  add column if not exists previous_gross numeric,
  add column if not exists previous_structure_id uuid references public.salary_structures (id) on delete set null,
  add column if not exists resolved_structure_id uuid references public.salary_structures (id) on delete set null;

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
as $fn$
declare
  v_company uuid;
  v_prev uuid;
  v_prev_any record;
  v_prev_struct uuid;
  v_next_from date;
  v_res record;
  v_resolved uuid;
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

  -- The structure the system will use for this Gross on the Effective From date (slab / scope rules — same resolver as payroll).
  select r.salary_structure_id, r.ambiguous, r.resolve_note into v_res
  from public.salary_resolve_core(p_employee_id, p_effective_from, p_gross_salary) r;
  v_resolved := coalesce(p_salary_structure_id, v_res.salary_structure_id);
  if p_salary_structure_id is null then
    if coalesce(v_res.ambiguous, false) then
      raise exception 'Cannot save: %', coalesce(v_res.resolve_note, 'more than one salary structure/slab matches this Gross.');
    end if;
    if v_resolved is null then
      raise exception 'Cannot save: no active salary slab covers a Gross of %. Add or correct a salary slab first.', p_gross_salary;
    end if;
  end if;
  -- Refuse a Gross the structure cannot balance (e.g. a negative Balance component) instead of failing later in payroll.
  begin
    perform 1 from public.salary_bifurcate(v_resolved, p_gross_salary);
  exception when others then
    raise exception 'Cannot save: the salary structure cannot split a Gross of % — %', p_gross_salary, sqlerrm;
  end;

  -- previous revision (for the history record) = latest revision starting before this one
  select a.id, a.gross_salary, a.effective_from, coalesce(a.resolved_structure_id, a.salary_structure_id) as struct_id
    into v_prev_any
  from public.employee_salary_assignments a
  where a.employee_id = p_employee_id and a.effective_from < p_effective_from
  order by a.effective_from desc limit 1;
  v_prev_struct := v_prev_any.struct_id;
  if v_prev_any.id is not null and v_prev_struct is null then
    select r.salary_structure_id into v_prev_struct
    from public.salary_resolve_core(p_employee_id, v_prev_any.effective_from, v_prev_any.gross_salary) r;
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

  insert into public.employee_salary_assignments
    (company_id, employee_id, salary_structure_id, gross_salary, effective_from, effective_to, previous_assignment_id,
     assigned_by, reason, remark, previous_gross, previous_structure_id, resolved_structure_id)
  values (v_company, p_employee_id, p_salary_structure_id, p_gross_salary, p_effective_from,
          case when v_next_from is not null then v_next_from - 1 else null end, v_prev, auth.uid(), p_reason, p_remark,
          v_prev_any.gross_salary, v_prev_struct, v_resolved)
  returning * into v_row;
  return v_row;
end;
$fn$;
grant execute on function public.salary_assign_employee(uuid, numeric, date, uuid, text, text) to authenticated;

-- List RPC gains the new columns (OUT signature changes -> drop + create; same access rule as before).
drop function if exists public.salary_list_employee_assignments(uuid);
create function public.salary_list_employee_assignments(p_employee_id uuid)
returns table (
  id uuid, gross_salary numeric, salary_structure_id uuid, structure_name text,
  effective_from date, effective_to date, reason text, remark text, created_at timestamptz,
  previous_gross numeric, previous_structure_name text, resolved_structure_id uuid, resolved_structure_name text,
  resolved_structure_code text, assigned_by_name text
)
language sql stable security definer
as $fn$
  select a.id, a.gross_salary, a.salary_structure_id, s.name, a.effective_from, a.effective_to, a.reason, a.remark, a.created_at,
         a.previous_gross, ps.code || ' - ' || ps.name, coalesce(a.resolved_structure_id, a.salary_structure_id),
         coalesce(rs.name, s.name), coalesce(rs.code, s.code), pr.full_name
  from public.employee_salary_assignments a
  left join public.salary_structures s on s.id = a.salary_structure_id
  left join public.salary_structures rs on rs.id = a.resolved_structure_id
  left join public.salary_structures ps on ps.id = a.previous_structure_id
  left join public.profiles pr on pr.id = a.assigned_by
  where a.employee_id = p_employee_id
    and (is_super_admin()
         or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
         or a.employee_id = current_user_employee_id())
  order by a.effective_from desc;
$fn$;
revoke execute on function public.salary_list_employee_assignments(uuid) from public, anon;
grant execute on function public.salary_list_employee_assignments(uuid) to authenticated;
