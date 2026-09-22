CREATE OR REPLACE FUNCTION public.payroll_resolve_store_calendar(p_company_id uuid, p_store_id uuid, p_as_of date)
 RETURNS store_payroll_calendars
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare v_cal public.store_payroll_calendars;
begin
  -- store-specific active calendar covering the date, else company-wide (store_id null)
  select * into v_cal from public.store_payroll_calendars
  where company_id = p_company_id and status = 'active'
    and (store_id = p_store_id or store_id is null)
    and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by (store_id is not null) desc, effective_from desc limit 1;
  return v_cal;
end;
$function$
