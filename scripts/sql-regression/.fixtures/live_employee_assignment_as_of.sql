CREATE OR REPLACE FUNCTION public.employee_assignment_as_of(p_employee_id uuid, p_as_of date)
 RETURNS employee_assignment_history
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select * from public.employee_assignment_history
  where employee_id = p_employee_id and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc limit 1;
$function$
