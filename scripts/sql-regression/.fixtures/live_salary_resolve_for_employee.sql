CREATE OR REPLACE FUNCTION public.salary_resolve_for_employee(p_employee_id uuid, p_as_of date)
 RETURNS TABLE(gross_salary numeric, salary_structure_id uuid, structure_name text, source text, ambiguous boolean, resolve_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
begin
  return query
  select r.gross_salary, r.salary_structure_id, r.structure_name, r.source, r.ambiguous, r.resolve_note
  from public.salary_resolve_core(p_employee_id, p_as_of, null) r;
end;
$function$
