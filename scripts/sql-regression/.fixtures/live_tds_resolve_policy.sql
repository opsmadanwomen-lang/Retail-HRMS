CREATE OR REPLACE FUNCTION public.tds_resolve_policy(p_company_id uuid, p_as_of date)
 RETURNS tds_policies
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare v_p public.tds_policies;
begin
  select * into v_p from public.tds_policies
  where company_id = p_company_id and status = 'active'
    and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc, version_no desc limit 1;
  return v_p;
end;
$function$
