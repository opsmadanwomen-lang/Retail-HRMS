CREATE OR REPLACE FUNCTION public.payroll_component_amounts_bulk_set(p_period_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare r jsonb; v_n int := 0; v_del int := 0; v_ea numeric; v_er numeric; v_company uuid;
begin
  select company_id into v_company from public.payroll_periods where id = p_period_id;
  if v_company is null then raise exception 'Payroll period not found.'; end if;
  if not public.payroll_can_manage(v_company) then
    raise exception 'You are not authorised to manage payroll for this company.' using errcode = '42501';
  end if;
  if not public.has_dynamic_permission(auth.uid(), 'payroll', 'EDIT') then
    raise exception 'You do not have permission to edit payroll component amounts.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_ea := nullif(r ->> 'employee_amount', '')::numeric;
    v_er := nullif(r ->> 'employer_amount', '')::numeric;
    if v_ea is null and v_er is null then
      -- explicit clear
      delete from public.payroll_component_amounts
      where payroll_period_id = p_period_id
        and employee_id = (r ->> 'employee_id')::uuid
        and component_code = upper(btrim(r ->> 'component_code'));
      v_del := v_del + 1;
    else
      perform public.payroll_component_amount_set(p_period_id, (r ->> 'employee_id')::uuid, r ->> 'component_code',
        v_ea, v_er, r ->> 'note');
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('saved', v_n, 'cleared', v_del);
end;
$function$
