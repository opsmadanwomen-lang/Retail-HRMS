CREATE OR REPLACE FUNCTION public.salary_bifurcate(p_structure_id uuid, p_gross numeric)
 RETURNS TABLE(code text, name text, category text, calculation_type text, calc_base text, calc_rate numeric, calc_formula text, amount numeric, included_in_gross boolean, included_in_ctc boolean, is_statutory boolean, statutory_kind text, display_order integer, is_basic boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
#variable_conflict use_column
declare
  v_struct public.salary_structures;
  v_comp record;
  v_prec int;
  v_basic_code text;
  v_resolved jsonb := '{}'::jsonb;
  v_pending text[];
  v_deps jsonb := '{}'::jsonb;
  v_dep text;
  v_ids text[];
  v_progress boolean;
  v_i int;
  v_code text;
  v_val numeric;
  v_expr text;
  v_base numeric;
  v_sum_gross numeric := 0;
  v_balance_seen boolean := false;
begin
  select * into v_struct from public.salary_structures where id = p_structure_id;
  if v_struct.id is null then raise exception 'Salary structure not found.'; end if;
  if p_gross is null or p_gross < 0 then raise exception 'Gross salary must be zero or greater.'; end if;

  v_prec := case v_struct.rounding when 'round_2' then 2 when 'nearest_rupee' then 0 else 6 end;

  select sc.code into v_basic_code from public.salary_structure_components sc
  where sc.salary_structure_id = p_structure_id and sc.is_active and sc.is_basic limit 1;

  for v_comp in
    select code, calculation_type from public.salary_structure_components
    where salary_structure_id = p_structure_id and is_active
    order by display_order, code
  loop
    v_pending := array_append(v_pending, v_comp.code);
    if v_comp.calculation_type = 'balance' then
      if v_balance_seen then raise exception 'A salary structure may contain only one Remaining/Balance component.'; end if;
      v_balance_seen := true;
    end if;
  end loop;
  if v_pending is null then raise exception 'Salary structure "%" has no active components.', v_struct.code; end if;

  v_deps := '{}'::jsonb;
  for v_comp in
    select * from public.salary_structure_components
    where salary_structure_id = p_structure_id and is_active
    order by display_order, code
  loop
    if v_comp.calculation_type in ('fixed', 'pct_of_gross', 'advance_recovery') then
      v_deps := v_deps || jsonb_build_object(v_comp.code, '[]'::jsonb);
    elsif v_comp.calculation_type = 'pct_of_basic' then
      if v_basic_code is null then raise exception 'Component "%" uses "percentage of Basic" but no active component is marked as Basic.', v_comp.code; end if;
      v_deps := v_deps || jsonb_build_object(v_comp.code, jsonb_build_array(v_basic_code));
    elsif v_comp.calculation_type = 'pct_of_component' then
      if v_comp.base_component_code is null
         or not exists (select 1 from public.salary_structure_components b where b.salary_structure_id = p_structure_id and b.is_active and b.code = v_comp.base_component_code) then
        raise exception 'Component "%" references an unknown/inactive base component "%".', v_comp.code, coalesce(v_comp.base_component_code, '(none)');
      end if;
      v_deps := v_deps || jsonb_build_object(v_comp.code, jsonb_build_array(v_comp.base_component_code));
    elsif v_comp.calculation_type = 'balance' then
      v_deps := v_deps || jsonb_build_object(v_comp.code, (
        select coalesce(jsonb_agg(o.code), '[]'::jsonb)
        from public.salary_structure_components o
        where o.salary_structure_id = p_structure_id and o.is_active and o.code <> v_comp.code and o.category = 'earning' and o.included_in_gross
      ));
    elsif v_comp.calculation_type = 'formula' then
      if coalesce(trim(v_comp.formula_expression), '') = '' then raise exception 'Component "%" is a formula but has no expression.', v_comp.code; end if;
      v_ids := array(
        select distinct m[1]
        from regexp_matches(v_comp.formula_expression, '([A-Za-z_][A-Za-z0-9_]*)', 'g') m
        where upper(m[1]) not in ('ROUND','MIN','MAX','ABS','LEAST','GREATEST','FLOOR','CEIL','CEILING','GROSS')
      );
      foreach v_dep in array coalesce(v_ids, array[]::text[]) loop
        if not exists (select 1 from public.salary_structure_components b where b.salary_structure_id = p_structure_id and b.is_active and b.code = v_dep) then
          raise exception 'Formula for "%" references unknown/inactive component "%".', v_comp.code, v_dep;
        end if;
      end loop;
      v_deps := v_deps || jsonb_build_object(v_comp.code, to_jsonb(coalesce(v_ids, array[]::text[])));
    else
      v_deps := v_deps || jsonb_build_object(v_comp.code, '[]'::jsonb);
    end if;
  end loop;

  while array_length(v_pending, 1) is not null loop
    v_progress := false;
    v_i := 1;
    while v_i <= coalesce(array_length(v_pending, 1), 0) loop
      v_code := v_pending[v_i];
      if not exists (
        select 1 from jsonb_array_elements_text(coalesce(v_deps -> v_code, '[]'::jsonb)) d
        where not (v_resolved ? d.value)
      ) then
        select * into v_comp from public.salary_structure_components
        where salary_structure_id = p_structure_id and is_active and code = v_code;

        if v_comp.calculation_type = 'fixed' then
          v_val := coalesce(v_comp.fixed_amount, 0);
        elsif v_comp.calculation_type = 'pct_of_gross' then
          v_val := p_gross * coalesce(v_comp.percentage, 0) / 100.0;
        elsif v_comp.calculation_type = 'pct_of_basic' then
          v_val := (v_resolved ->> v_basic_code)::numeric * coalesce(v_comp.percentage, 0) / 100.0;
        elsif v_comp.calculation_type = 'pct_of_component' then
          v_val := (v_resolved ->> v_comp.base_component_code)::numeric * coalesce(v_comp.percentage, 0) / 100.0;
        elsif v_comp.calculation_type = 'formula' then
          v_expr := v_comp.formula_expression;
          v_expr := regexp_replace(v_expr, '\mGROSS\M', p_gross::text, 'gi');
          for v_dep in select jsonb_array_elements_text(coalesce(v_deps -> v_code, '[]'::jsonb)) loop
            v_expr := regexp_replace(v_expr, '\m' || v_dep || '\M', '(' || (v_resolved ->> v_dep) || ')', 'g');
          end loop;
          if regexp_replace(v_expr, '(round|min|max|abs|least|greatest|floor|ceil|ceiling)', '', 'gi') ~ '[A-Za-z]' then
            raise exception 'Formula for "%" could not be safely evaluated (unresolved token).', v_code;
          end if;
          if v_expr ~ '[;\\]' or v_expr ~* '(select|insert|update|delete|drop|;|--)' then
            raise exception 'Formula for "%" contains a disallowed token.', v_code;
          end if;
          execute format('select (%s)::numeric', v_expr) into v_val;
        elsif v_comp.calculation_type = 'balance' then
          select coalesce(sum((v_resolved ->> d.value)::numeric), 0) into v_base
          from jsonb_array_elements_text(coalesce(v_deps -> v_code, '[]'::jsonb)) d;
          v_val := p_gross - v_base;
          if v_val < 0 and not v_struct.allow_negative_balance then
            raise exception 'Salary structure "%" balance component "%" is negative (%). Adjust components or allow negative balance.', v_struct.code, v_code, v_val;
          end if;
        elsif v_comp.calculation_type = 'advance_recovery' then
          v_val := 0;
        else
          v_val := 0;
        end if;

        if v_comp.is_statutory and v_comp.calculation_type not in ('fixed', 'formula') then
          if v_comp.statutory_rate is null then
            v_val := 0;
          else
            v_base := case v_comp.statutory_base
                        when 'basic' then coalesce((v_resolved ->> v_basic_code)::numeric, 0)
                        when 'basic_da' then coalesce((v_resolved ->> v_basic_code)::numeric, 0)
                                            + coalesce((select (v_resolved ->> o.code)::numeric from public.salary_structure_components o
                                                        where o.salary_structure_id = p_structure_id and o.is_active and o.code = 'DA'), 0)
                        when 'gross' then p_gross
                        when 'component' then coalesce((v_resolved ->> v_comp.base_component_code)::numeric, 0)
                        else 0 end;
            if v_comp.statutory_ceiling is not null then v_base := least(v_base, v_comp.statutory_ceiling); end if;
            v_val := v_base * v_comp.statutory_rate / 100.0;
          end if;
        end if;

        -- Phase 7: per-component rounding (mode + precision); legacy `rounding` token still honoured.
        v_val := public.payroll_round(
          v_val,
          coalesce(v_comp.rounding_mode, 'nearest'),
          coalesce(v_comp.rounding_precision,
                   case coalesce(v_comp.rounding, v_struct.rounding)
                     when 'round_2' then 2 when 'nearest_rupee' then 0 else v_prec end));

        v_resolved := v_resolved || jsonb_build_object(v_code, v_val);
        v_pending := array_remove(v_pending, v_code);
        v_progress := true;
        v_i := 1;
        continue;
      end if;
      v_i := v_i + 1;
    end loop;

    if not v_progress then
      raise exception 'Circular salary component dependency detected among: %', array_to_string(v_pending, ', ');
    end if;
  end loop;

  if v_struct.gross_balanced and not v_balance_seen then
    select coalesce(sum((v_resolved ->> sc.code)::numeric), 0) into v_sum_gross
    from public.salary_structure_components sc
    where sc.salary_structure_id = p_structure_id and sc.is_active and sc.category = 'earning' and sc.included_in_gross;
    if round(v_sum_gross, greatest(v_prec, 2)) <> round(p_gross, greatest(v_prec, 2)) then
      raise exception 'Included earnings (%) do not reconcile with Gross (%). Add a Balance component or fix the percentages.', v_sum_gross, p_gross;
    end if;
  end if;

  return query
  select sc.code, sc.name, sc.category, sc.calculation_type,
         case sc.calculation_type
           when 'pct_of_gross' then 'GROSS'
           when 'pct_of_basic' then v_basic_code
           when 'pct_of_component' then sc.base_component_code
           when 'formula' then null
           else null end,
         case sc.calculation_type when 'formula' then null when 'fixed' then null else sc.percentage end,
         case sc.calculation_type when 'formula' then sc.formula_expression else null end,
         (v_resolved ->> sc.code)::numeric,
         sc.included_in_gross, sc.included_in_ctc, sc.is_statutory, sc.statutory_kind, sc.display_order, sc.is_basic
  from public.salary_structure_components sc
  where sc.salary_structure_id = p_structure_id and sc.is_active
  order by sc.display_order, sc.code;
end;
$function$
