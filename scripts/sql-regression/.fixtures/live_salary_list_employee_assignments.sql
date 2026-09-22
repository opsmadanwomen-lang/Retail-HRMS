CREATE OR REPLACE FUNCTION public.salary_list_employee_assignments(p_employee_id uuid)
 RETURNS TABLE(id uuid, gross_salary numeric, salary_structure_id uuid, structure_name text, effective_from date, effective_to date, reason text, remark text, created_at timestamp with time zone, previous_gross numeric, previous_structure_name text, resolved_structure_id uuid, resolved_structure_name text, resolved_structure_code text, assigned_by_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
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
$function$
