CREATE OR REPLACE FUNCTION public.salary_assign_employee(p_employee_id uuid, p_gross_salary numeric, p_effective_from date, p_salary_structure_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_remark text DEFAULT NULL::text)
 RETURNS employee_salary_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  -- Salary is now maintained from the Employee profile: it goes through the SAME dynamic module permission as the other payroll edits.
  -- (has_dynamic_permission fails OPEN when nothing is configured, so nothing changes until a Super Admin restricts payroll / EDIT.)
  if not public.has_dynamic_permission(auth.uid(), 'payroll', 'EDIT') then
    raise exception 'You do not have permission to edit salary.' using errcode = '42501';
  end if;
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
$function$
