CREATE OR REPLACE FUNCTION public.payroll_component_import_preview(p_company_id uuid, p_period_id uuid, p_component_codes text[], p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_pcompany uuid; v_pstatus text;
  v_codes text[];
  r jsonb; v_rn int; v_staff text; v_name text;
  v_emp_id uuid; v_emp_name text; v_emp_code text;
  v_out jsonb := '[]'::jsonb; v_row jsonb; v_amts jsonb; v_msgs text[]; v_state text;
  c text; v_raw text; v_val numeric; v_supplied boolean; v_comp_out jsonb;
  v_total int := 0; v_valid int := 0; v_warn int := 0; v_err int := 0;
  v_ea_total numeric := 0; v_er_total numeric := 0;
  v_seen text[] := '{}';
begin
  select company_id, status into v_pcompany, v_pstatus from public.payroll_periods where id = p_period_id;
  if v_pcompany is null then raise exception 'Payroll period not found.'; end if;
  if v_pcompany <> p_company_id then raise exception 'Period does not belong to this company.' using errcode = '42501'; end if;
  if not public.payroll_can_manage(p_company_id) then
    raise exception 'You are not authorised to import payroll amounts for this company.' using errcode = '42501';
  end if;
  if not public.has_dynamic_permission(auth.uid(), 'payroll', 'UPLOAD') then
    raise exception 'You do not have permission to import payroll component amounts.' using errcode = '42501';
  end if;

  -- normalise + validate the requested component scope (OT can never appear here)
  select array_agg(distinct upper(btrim(x))) into v_codes from unnest(coalesce(p_component_codes, array['PF','ESI'])) x;
  if v_codes is null or array_length(v_codes, 1) is null then v_codes := array['PF','ESI']; end if;
  if 'OT' = any(v_codes) then
    raise exception 'Overtime cannot be imported. OT comes only from Attendance -> Overtime / OT Rules.' using errcode = '22023';
  end if;
  foreach c in array v_codes loop
    if not public.payroll_component_import_eligible(p_company_id, c) then
      raise exception '% is not importable as a manual amount.', c using errcode = '22023';
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_total := v_total + 1;
    v_rn := coalesce((r ->> 'row_number')::int, v_total);
    v_staff := btrim(coalesce(r ->> 'staff_id', ''));
    v_name := btrim(coalesce(r ->> 'staff_name', ''));
    v_amts := coalesce(r -> 'amounts', '{}'::jsonb);
    v_msgs := '{}'; v_state := 'valid'; v_emp_id := null; v_emp_name := null; v_emp_code := null;

    if v_staff = '' then
      v_msgs := array_append(v_msgs, 'Staff ID is blank.'); v_state := 'error';
    else
      select e.id, e.full_name, e.employee_code into v_emp_id, v_emp_name, v_emp_code
      from public.employees e
      where e.company_id = p_company_id and upper(btrim(e.employee_code)) = upper(v_staff);

      if v_emp_id is null then
        v_msgs := array_append(v_msgs, format('No employee with Staff ID "%s" in this company.', v_staff));
        v_state := 'error';
      else
        if v_staff = any(v_seen) then
          v_msgs := array_append(v_msgs, format('Duplicate Staff ID "%s" in the file.', v_staff));
          v_state := 'error';
        end if;
        v_seen := array_append(v_seen, v_staff);
        if v_name <> '' and lower(v_name) <> lower(coalesce(v_emp_name, '')) then
          v_msgs := array_append(v_msgs, format('Name "%s" does not match "%s" (Staff ID wins).', v_name, v_emp_name));
          if v_state = 'valid' then v_state := 'warning'; end if;
        end if;
      end if;
    end if;

    -- per requested component: parse the amount (blank vs 0 vs number)
    v_comp_out := '{}'::jsonb;
    foreach c in array v_codes loop
      v_raw := v_amts ->> c;
      v_supplied := false; v_val := null;
      begin
        v_val := public._pca_parse_amount(v_raw);
        v_supplied := v_val is not null;
        if v_supplied and v_state <> 'error' and v_emp_id is not null then
          v_ea_total := v_ea_total + v_val;
        end if;
      exception when others then
        v_msgs := array_append(v_msgs, format('%s amount "%s" is not a valid number.', c, v_raw));
        v_state := 'error';
      end;
      v_comp_out := v_comp_out || jsonb_build_object(c, jsonb_build_object(
        'raw', v_raw,
        'value', v_val,
        'supplied', v_supplied,
        'zero', (v_supplied and v_val = 0)
      ));
    end loop;

    if v_state = 'error' then v_err := v_err + 1;
    elsif v_state = 'warning' then v_warn := v_warn + 1; v_valid := v_valid + 1;
    else v_valid := v_valid + 1;
    end if;

    v_row := jsonb_build_object(
      'row_number', v_rn,
      'staff_id', v_staff,
      'staff_name', v_name,
      'employee_id', v_emp_id,
      'matched_name', v_emp_name,
      'matched_code', v_emp_code,
      'state', v_state,
      'messages', to_jsonb(v_msgs),
      'components', v_comp_out
    );
    v_out := v_out || v_row;
  end loop;

  return jsonb_build_object(
    'period', jsonb_build_object('id', p_period_id, 'status', v_pstatus,
                                'editable', v_pstatus not in ('finalized', 'locked', 'reversed')),
    'component_codes', to_jsonb(v_codes),
    'summary', jsonb_build_object(
      'total_rows', v_total, 'valid', v_valid, 'warnings', v_warn, 'errors', v_err,
      'employee_amount_total', v_ea_total, 'employer_amount_total', v_er_total
    ),
    'rows', v_out
  );
end;
$function$
