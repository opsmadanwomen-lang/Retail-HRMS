CREATE OR REPLACE FUNCTION public.payroll_component_import_eligible(p_company_id uuid, p_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
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
$function$
