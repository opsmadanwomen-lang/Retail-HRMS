CREATE OR REPLACE FUNCTION public.payroll_component_amounts_audit_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.payroll_component_amount_audit (company_id, payroll_period_id, employee_id, component_code, action,
      old_employee_amount, new_employee_amount, old_employer_amount, new_employer_amount, source, import_batch_id, changed_by)
    values (new.company_id, new.payroll_period_id, new.employee_id, new.component_code, 'insert',
      null, new.employee_amount, null, new.employer_amount, new.source, new.import_batch_id, coalesce(new.updated_by, new.created_by, auth.uid()));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.payroll_component_amount_audit (company_id, payroll_period_id, employee_id, component_code, action,
      old_employee_amount, new_employee_amount, old_employer_amount, new_employer_amount, source, import_batch_id, changed_by)
    values (new.company_id, new.payroll_period_id, new.employee_id, new.component_code, 'update',
      old.employee_amount, new.employee_amount, old.employer_amount, new.employer_amount, new.source, new.import_batch_id, coalesce(new.updated_by, auth.uid()));
    return new;
  else
    insert into public.payroll_component_amount_audit (company_id, payroll_period_id, employee_id, component_code, action,
      old_employee_amount, new_employee_amount, old_employer_amount, new_employer_amount, source, import_batch_id, changed_by)
    values (old.company_id, old.payroll_period_id, old.employee_id, old.component_code, 'delete',
      old.employee_amount, null, old.employer_amount, null, old.source, old.import_batch_id, auth.uid());
    return old;
  end if;
end;
$function$
