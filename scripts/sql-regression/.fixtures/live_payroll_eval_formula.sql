CREATE OR REPLACE FUNCTION public.payroll_eval_formula(p_expr text, p_vars jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare v_expr text; k text; v_val numeric;
begin
  if p_expr is null or btrim(p_expr) = '' then return null; end if;
  v_expr := p_expr;
  for k in select jsonb_object_keys(p_vars) loop
    v_expr := regexp_replace(v_expr, '\m' || k || '\M', '(' || coalesce((p_vars ->> k), '0') || ')', 'gi');
  end loop;
  if regexp_replace(v_expr, '(round|min|max|abs|least|greatest|floor|ceil|ceiling)', '', 'gi') ~ '[A-Za-z]' then
    raise exception 'Payroll formula could not be safely evaluated (unresolved token): %', p_expr;
  end if;
  if v_expr ~ '[;\\]' or v_expr ~* '(select|insert|update|delete|drop|alter|;|--)' then
    raise exception 'Payroll formula contains a disallowed token: %', p_expr;
  end if;
  execute format('select (%s)::numeric', v_expr) into v_val;
  return v_val;
end;
$function$
