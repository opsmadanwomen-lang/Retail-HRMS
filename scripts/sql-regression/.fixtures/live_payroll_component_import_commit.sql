CREATE OR REPLACE FUNCTION public.payroll_component_import_commit(p_company_id uuid, p_period_id uuid, p_component_codes text[], p_rows jsonb, p_file_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_prev jsonb; v_codes text[]; v_pstatus text; v_pcompany uuid;
  r jsonb; c text; v_batch uuid; v_emp uuid; v_val numeric;
  v_imported int := 0; v_updated int := 0; v_skipped int := 0;
  v_ea_total numeric := 0; v_er_total numeric := 0; v_existed boolean;
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
  if v_pstatus in ('finalized', 'locked', 'reversed') then
    raise exception 'Payroll period is % — PF/ESI amounts are immutable. Use the payroll reversal/correction process.', v_pstatus
      using errcode = '55000';
  end if;

  v_prev := public.payroll_component_import_preview(p_company_id, p_period_id, p_component_codes, p_rows);
  if (v_prev -> 'summary' ->> 'errors')::int > 0 then
    raise exception 'Import has % row error(s) — fix the file and preview again. Nothing was imported.',
      (v_prev -> 'summary' ->> 'errors')::int using errcode = '22023';
  end if;
  select array_agg(value::text) into v_codes from jsonb_array_elements_text(v_prev -> 'component_codes');

  insert into public.payroll_component_import_batches (company_id, payroll_period_id, component_codes, file_name, created_by)
  values (p_company_id, p_period_id, v_codes, p_file_name, auth.uid())
  returning id into v_batch;

  for r in select * from jsonb_array_elements(v_prev -> 'rows') loop
    v_emp := nullif(r ->> 'employee_id', '')::uuid;
    if v_emp is null then continue; end if;
    foreach c in array v_codes loop
      if coalesce((r -> 'components' -> c ->> 'supplied')::boolean, false) then
        v_val := (r -> 'components' -> c ->> 'value')::numeric;
        select exists (select 1 from public.payroll_component_amounts
                       where payroll_period_id = p_period_id and employee_id = v_emp and component_code = c) into v_existed;
        insert into public.payroll_component_amounts (company_id, payroll_period_id, employee_id, component_code,
          employee_amount, employer_amount, source, import_batch_id, note, created_by, updated_by)
        values (p_company_id, p_period_id, v_emp, c, v_val, null, 'excel_import', v_batch,
          nullif(p_file_name, ''), auth.uid(), auth.uid())
        on conflict (payroll_period_id, employee_id, component_code) do update
          set employee_amount = excluded.employee_amount,
              source = 'excel_import',
              import_batch_id = v_batch,
              note = excluded.note,
              updated_by = auth.uid();
        if v_existed then v_updated := v_updated + 1; else v_imported := v_imported + 1; end if;
        v_ea_total := v_ea_total + coalesce(v_val, 0);
      else
        v_skipped := v_skipped + 1;   -- blank: left untouched, NOT zeroed
      end if;
    end loop;
  end loop;

  update public.payroll_component_import_batches
  set row_count = jsonb_array_length(v_prev -> 'rows'),
      employee_amount_total = v_ea_total,
      employer_amount_total = v_er_total
  where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch,
    'imported', v_imported,
    'updated', v_updated,
    'skipped_blank', v_skipped,
    'employee_amount_total', v_ea_total,
    'component_codes', to_jsonb(v_codes),
    'note', 'PF/ESI amounts stored for this period. Re-run Payroll Calculate to fold them into the payslips.'
  );
end;
$function$
