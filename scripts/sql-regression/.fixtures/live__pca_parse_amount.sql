CREATE OR REPLACE FUNCTION public._pca_parse_amount(p_raw text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare v text; v_num numeric;
begin
  if p_raw is null then return null; end if;
  v := btrim(p_raw);
  v := replace(replace(replace(v, ',', ''), '₹', ''), ' ', '');
  if v = '' then return null; end if;
  if v !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'not a valid amount: "%"', p_raw;
  end if;
  v_num := v::numeric;
  if v_num < 0 then raise exception 'amount cannot be negative: "%"', p_raw; end if;
  return v_num;
end;
$function$
