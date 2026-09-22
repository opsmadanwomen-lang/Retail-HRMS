-- ============================================================================
-- Retail HRMS — follow-up to 0178
--   (1) Payroll-policy VERSIONING now carries the common component rules forward
--   (2) Employee Gross can no longer be read through the raw salary resolver
--   (3) A salary revision cannot silently change a Finalized / Locked payroll period
-- Migration 0179  (additive; requires 0178)
--
-- INSPECTED FIRST (live DB, 2026-09-21):
--   (1) DEFECT CONFIRMED. The UI creates a policy version with a plain INSERT into payroll_policies
--       (previous_policy_id set). Nothing copied the child rows, so a new version had 0 statutory rules,
--       0 PT slabs and 0 deduction-order rows. payroll_policy_activate() closes the older version and the
--       resolver then picks the new one for later periods — PF / ESI / Medical Fund / PT would silently
--       disappear from payroll. Fix = an AFTER INSERT trigger (works for the existing UI path and any other
--       caller) that copies the previous version's rules / PT slabs / deduction order into a new version that
--       has none of that child type. The old version is only READ. The new version is an independent copy.
--       payroll_policy_assignments are NOT copied: they point at a policy CODE chain and the resolver already
--       finds the newest active version of that code.
--   (2) salary_resolve_for_employee(uuid,date) is SECURITY DEFINER with NO authorisation check and was
--       EXECUTE-able by anon/authenticated (PostgREST default) => any caller could read any employee's Gross.
--       Every internal caller (payroll_calculate_run, payroll_policy_preview, fnf_calculate,
--       _transfer_apply_history_and_engines, payroll_resolve_policy_for_employee) is itself SECURITY DEFINER
--       (verified on the live DB), so they keep working when API roles lose EXECUTE. The frontend does not
--       call the raw resolver. A guarded client entry point salary_resolve_secure() is added:
--       Super Admin / payroll manager / non-staff of the same company (the app's existing payroll read rule,
--       identical to payroll_list_run_results / payroll_get_employee_result) or the employee THEMSELVES.
--       Same hardening for the write-path helper payroll_apply_policy() (inserts payroll_lines for any result id
--       and was callable by anon; only payroll_calculate_run calls it) and the pure calculators
--       payroll_policy_compute_lines / payroll_policy_finalize (only called by SECURITY DEFINER functions).
--       Functions the UI does call keep authenticated access but lose PUBLIC/anon.
--   (3) payroll_calculate_run() already refuses to recalculate a finalized/locked run and
--       payroll_component_amounts_guard() already freezes manual amounts of a closed period. The remaining hole
--       was salary_assign_employee(): a revision whose effective range overlaps a closed period was accepted.
--       Now: normal users (incl. finance processors) are blocked; a Super Admin may proceed only with a
--       mandatory reason, and the closed periods are written into the revision remark (the row is also audited
--       by trg_employee_salary_assignments_audit). Payroll results are never touched. Open / future periods and
--       the periods after the next revision are unaffected.
--
-- NOT changed: salary_bifurcate, payroll_calculate_run, OT / LWP / Late / Advance engines, slabs, structures,
-- rounding, RLS of any table, any payroll result row. No company data is written by this migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Policy version inheritance
-- ----------------------------------------------------------------------------
create or replace function public.payroll_policy_inherit_children()
returns trigger
language plpgsql
security definer
as $fn$
declare
  v_t text;
  v_cols text;
  v_has boolean;
begin
  if new.previous_policy_id is null then return new; end if;
  foreach v_t in array array['payroll_statutory_rules', 'payroll_pt_slabs', 'payroll_deduction_order'] loop
    execute format('select exists (select 1 from public.%I where payroll_policy_id = $1)', v_t) into v_has using new.id;
    if v_has then continue; end if;                       -- caller already supplied its own rows: never overwrite
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = v_t
      and c.column_name not in ('id', 'payroll_policy_id', 'created_at', 'updated_at');
    execute format(
      'insert into public.%1$I (payroll_policy_id, %2$s) select $1, %2$s from public.%1$I where payroll_policy_id = $2',
      v_t, v_cols) using new.id, new.previous_policy_id;
  end loop;
  return new;
end;
$fn$;
revoke execute on function public.payroll_policy_inherit_children() from public, anon, authenticated;

drop trigger if exists trg_payroll_policies_inherit_children on public.payroll_policies;
create trigger trg_payroll_policies_inherit_children
  after insert on public.payroll_policies
  for each row when (new.previous_policy_id is not null)
  execute function public.payroll_policy_inherit_children();

-- ----------------------------------------------------------------------------
-- 2. Guarded client entry point for the resolver
-- ----------------------------------------------------------------------------
create or replace function public.salary_resolve_secure(p_employee_id uuid, p_as_of date)
returns table (gross_salary numeric, salary_structure_id uuid, structure_name text, source text, ambiguous boolean, resolve_note text)
language plpgsql
stable
security definer
as $fn$
declare v_company uuid;
begin
  select e.company_id into v_company from public.employees e where e.id = p_employee_id;
  if v_company is null then raise exception 'Employee not found.'; end if;
  -- NULL-safe: an unauthenticated / unmapped caller yields NULLs, and "not (false or NULL)" would be NULL (= pass).
  if not coalesce(
       coalesce(public.is_super_admin(), false)
    or coalesce(public.payroll_can_manage(v_company), false)
    or coalesce(public.current_user_role() <> 'staff' and v_company = public.current_user_company_id(), false)
    or coalesce(p_employee_id = public.current_user_employee_id(), false)
  , false) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select r.gross_salary, r.salary_structure_id, r.structure_name, r.source, r.ambiguous, r.resolve_note
  from public.salary_resolve_for_employee(p_employee_id, p_as_of) r;
end;
$fn$;
revoke execute on function public.salary_resolve_secure(uuid, date) from public, anon;
grant execute on function public.salary_resolve_secure(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Grant hardening (internal-only functions lose ALL API-role access; UI-called ones lose PUBLIC/anon)
-- ----------------------------------------------------------------------------
revoke execute on function public.salary_resolve_for_employee(uuid, date) from public, anon, authenticated;
revoke execute on function public.payroll_apply_policy(uuid, uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, date, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.payroll_policy_compute_lines(uuid, date, date, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text[], date, boolean, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.payroll_policy_finalize(uuid, numeric, jsonb) from public, anon, authenticated;

revoke execute on function public.salary_bifurcate(uuid, numeric) from public, anon;
revoke execute on function public.salary_preview(uuid, numeric) from public, anon;
revoke execute on function public.salary_assign_employee(uuid, numeric, date, uuid, text, text) from public, anon;
revoke execute on function public.payroll_policy_preview(uuid, date, jsonb) from public, anon;
revoke execute on function public.salary_list_employee_assignments(uuid) from public, anon;
grant execute on function public.salary_bifurcate(uuid, numeric) to authenticated;
grant execute on function public.salary_preview(uuid, numeric) to authenticated;
grant execute on function public.salary_assign_employee(uuid, numeric, date, uuid, text, text) to authenticated;
grant execute on function public.payroll_policy_preview(uuid, date, jsonb) to authenticated;
grant execute on function public.salary_list_employee_assignments(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. salary_assign_employee: closed (Finalized / Locked) payroll protection.
--    Body = migration 0178 + the closed-period block. Signature/return unchanged.
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
as $fn$
declare
  v_company uuid;
  v_prev uuid;
  v_prev_any record;
  v_prev_struct uuid;
  v_next_from date;
  v_bound date;
  v_closed text;
  v_remark text := p_remark;
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

  -- this revision applies from p_effective_from until the day before the next revision (if any)
  select min(effective_from) into v_next_from
  from public.employee_salary_assignments
  where employee_id = p_employee_id and effective_from > p_effective_from;
  v_bound := case when v_next_from is not null then v_next_from - 1 else 'infinity'::date end;

  -- Closed payroll protection: any Finalized / Locked period inside [effective_from, bound] would be changed by this revision.
  select string_agg(to_char(pp.period_month, 'Mon YYYY'), ', ' order by pp.period_month) into v_closed
  from public.payroll_periods pp
  left join public.payroll_runs pr on pr.payroll_period_id = pp.id and pr.is_current
  where pp.company_id = v_company
    and (pp.status in ('finalized', 'locked') or pr.status in ('finalized', 'locked'))
    and pp.period_end_date >= p_effective_from
    and pp.period_start_date <= v_bound;
  if v_closed is not null then
    if not public.is_super_admin() then
      raise exception 'Cannot save: payroll for % is already finalized/locked and this salary would change it. Only a Super Admin can record a back-dated revision into a closed period.', v_closed
        using errcode = '55000';
    end if;
    if length(btrim(coalesce(p_reason, ''))) < 5 then
      raise exception 'A reason (at least 5 characters) is mandatory for a revision back-dated into closed payroll (%).', v_closed
        using errcode = '22023';
    end if;
    v_remark := btrim(coalesce(p_remark, '') || ' [Back-dated into closed payroll: ' || v_closed || '; recorded by Super Admin. Payroll results already finalized are NOT changed.]');
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

  insert into public.employee_salary_assignments
    (company_id, employee_id, salary_structure_id, gross_salary, effective_from, effective_to, previous_assignment_id,
     assigned_by, reason, remark, previous_gross, previous_structure_id, resolved_structure_id)
  values (v_company, p_employee_id, p_salary_structure_id, p_gross_salary, p_effective_from,
          case when v_next_from is not null then v_next_from - 1 else null end, v_prev, auth.uid(), p_reason, v_remark,
          v_prev_any.gross_salary, v_prev_struct, v_resolved)
  returning * into v_row;
  return v_row;
end;
$fn$;
grant execute on function public.salary_assign_employee(uuid, numeric, date, uuid, text, text) to authenticated;
