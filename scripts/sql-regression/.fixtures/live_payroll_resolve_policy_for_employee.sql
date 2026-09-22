CREATE OR REPLACE FUNCTION public.payroll_resolve_policy_for_employee(p_company_id uuid, p_employee_id uuid, p_as_of date)
 RETURNS payroll_policies
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_emp record;
  v_tier record;
  v_pol_id uuid;
  v_pol public.payroll_policies;
  v_hist public.employee_assignment_history;
begin
  select e.store_id, e.store_department_id, e.store_designation_id, e.grade_id, e.category_id, e.employment_type::text et
  into v_emp from public.employees e where e.id = p_employee_id;

  -- Employee Transfer (Phase 2 correction): resolve scope fields as of p_as_of
  -- from the authoritative assignment history, same reasoning as
  -- salary_resolve_for_employee. No history -> unaffected (coalesce to live).
  v_hist := public.employee_assignment_as_of(p_employee_id, p_as_of);
  v_emp.store_id := coalesce(v_hist.store_id, v_emp.store_id);
  v_emp.store_department_id := coalesce(v_hist.store_department_id, v_emp.store_department_id);
  v_emp.store_designation_id := coalesce(v_hist.store_designation_id, v_emp.store_designation_id);
  v_emp.grade_id := coalesce(v_hist.grade_id, v_emp.grade_id);
  v_emp.category_id := coalesce(v_hist.category_id, v_emp.category_id);
  v_emp.et := coalesce(v_hist.employment_type, v_emp.et);

  for v_tier in
    select ord, scope, pid, cnt from (
      select 1 ord, 'employee' scope, (array_agg(a.payroll_policy_id order by a.priority))[1] pid, count(*) cnt
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='employee' and a.employee_id=p_employee_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 2, 'grade', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='grade' and a.grade_id=v_emp.grade_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 3, 'category', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='category' and a.category_id=v_emp.category_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 4, 'store_designation', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='store_designation' and a.store_designation_id=v_emp.store_designation_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 5, 'store_department', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='store_department' and a.store_department_id=v_emp.store_department_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 6, 'location', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type in ('location','store') and a.store_id=v_emp.store_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 7, 'employment_type', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='employment_type' and a.employment_type=v_emp.et
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 8, 'company', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='company'
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
    ) t
    where t.cnt >= 1
    order by t.ord
  loop
    if v_tier.cnt = 1 then v_pol_id := v_tier.pid; end if;
    exit;
  end loop;

  if v_pol_id is not null then
    -- resolve the effective-dated ACTIVE version of the assigned policy's code chain
    select * into v_pol from public.payroll_policies base
    where base.id = v_pol_id;
    if v_pol.id is not null then
      select * into v_pol from public.payroll_policies q
      where q.company_id = p_company_id and q.code = v_pol.code and q.status = 'active'
        and q.effective_from <= p_as_of and (q.effective_to is null or q.effective_to >= p_as_of)
      order by q.effective_from desc limit 1;
      if v_pol.id is not null then return v_pol; end if;
      select * into v_pol from public.payroll_policies where id = v_pol_id; return v_pol;
    end if;
  end if;

  -- fall back to the company-wide resolver (unchanged Phase 6 path)
  return public.payroll_resolve_policy(p_company_id, p_as_of);
end;
$function$
