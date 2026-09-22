CREATE OR REPLACE FUNCTION public.payroll_component_import_codes(p_company_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
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
$function$
