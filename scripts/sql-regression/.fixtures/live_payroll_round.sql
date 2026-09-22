CREATE OR REPLACE FUNCTION public.payroll_round(p_val numeric, p_mode text, p_precision integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_val is null then null
    when coalesce(p_mode, 'none') = 'none'    then p_val
    when p_mode = 'nearest' then round(p_val, coalesce(p_precision, 2))
    when p_mode = 'floor'   then floor(p_val * power(10, coalesce(p_precision, 2))) / power(10, coalesce(p_precision, 2))
    when p_mode = 'ceil'    then ceil (p_val * power(10, coalesce(p_precision, 2))) / power(10, coalesce(p_precision, 2))
    -- legacy Phase-5A tokens, mapped so an un-migrated component behaves as before
    when p_mode = 'round_2'       then round(p_val, 2)
    when p_mode = 'nearest_rupee' then round(p_val, 0)
    else p_val end;
$function$
