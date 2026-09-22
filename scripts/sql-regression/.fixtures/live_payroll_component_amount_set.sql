CREATE OR REPLACE FUNCTION public.payroll_component_amount_set(p_period_id uuid, p_employee_id uuid, p_component_code text, p_employee_amount numeric DEFAULT NULL::numeric, p_employer_amount numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS payroll_component_amounts
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_company uuid; v_pstatus text; v_emp_company uuid; v_code text := upper(btrim(p_component_code)); v_row public.payroll_component_amounts;
begin
  select company_id, status into v_company, v_pstatus from public.payroll_periods where id = p_period_id;
  if v_company is null then raise exception 'Payroll period not found.'; end if;
  if not public.payroll_can_manage(v_company) then
    raise exception 'You are not authorised to manage payroll for this company.' using errcode = '42501';
  end if;
  if not public.has_dynamic_permission(auth.uid(), 'payroll', 'EDIT') then
    raise exception 'You do not have permission to edit payroll component amounts.' using errcode = '42501';
  end if;

  if v_code = 'OT' then
    raise exception 'Overtime cannot use a manual or imported amount. OT comes only from Attendance -> Overtime / OT Rules.'
      using errcode = '22023';
  end if;
  if not public.payroll_component_import_eligible(v_company, v_code) then
    raise exception '% is not a component that supports a manual / imported amount.', v_code using errcode = '22023';
  end if;

  select company_id into v_emp_company from public.employees where id = p_employee_id;
  if v_emp_company is null then raise exception 'Employee not found.'; end if;
  if v_emp_company <> v_company then
    raise exception 'Employee % does not belong to this company (cross-company blocked).', p_employee_id using errcode = '42501';
  end if;
  if p_employee_amount is null and p_employer_amount is null then
    raise exception 'Nothing to store — supply an employee and/or employer amount (or delete the row).';
  end if;
  if p_employee_amount is not null and p_employee_amount < 0 then raise exception 'Employee amount cannot be negative.'; end if;
  if p_employer_amount is not null and p_employer_amount < 0 then raise exception 'Employer amount cannot be negative.'; end if;
  -- period-editable is enforced by trg_pca_guard as well.
  if v_pstatus in ('finalized', 'locked', 'reversed') then
    raise exception 'Payroll period is % — PF/ESI manual amounts are immutable.', v_pstatus using errcode = '55000';
  end if;

  insert into public.payroll_component_amounts (company_id, payroll_period_id, employee_id, component_code,
    employee_amount, employer_amount, source, note, created_by, updated_by)
  values (v_company, p_period_id, p_employee_id, v_code, p_employee_amount, p_employer_amount, 'manual', p_note, auth.uid(), auth.uid())
  on conflict (payroll_period_id, employee_id, component_code) do update
    set employee_amount = excluded.employee_amount,
        employer_amount = excluded.employer_amount,
        source = 'manual',
        import_batch_id = null,
        note = excluded.note,
        updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end;
$function$
