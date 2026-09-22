CREATE OR REPLACE FUNCTION public.payroll_resolve_policy(p_company_id uuid, p_as_of date)
 RETURNS payroll_policies
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare v_pol public.payroll_policies;
begin
  -- 1. an active version whose range covers the date
  select * into v_pol from public.payroll_policies
  where company_id = p_company_id and status = 'active'
    and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc limit 1;
  if v_pol.id is not null then return v_pol; end if;

  -- 2. any non-draft version that historically covered the date (superseded/archived)
  select * into v_pol from public.payroll_policies
  where company_id = p_company_id and status <> 'draft'
    and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc, version_no desc limit 1;
  if v_pol.id is not null then return v_pol; end if;

  -- 3. newest active, else newest of any status
  select * into v_pol from public.payroll_policies
  where company_id = p_company_id and status = 'active'
  order by effective_from desc limit 1;
  if v_pol.id is not null then return v_pol; end if;

  select * into v_pol from public.payroll_policies where company_id = p_company_id
  order by effective_from desc, version_no desc limit 1;
  return v_pol;
end;
$function$
