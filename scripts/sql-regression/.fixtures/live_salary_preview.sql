CREATE OR REPLACE FUNCTION public.salary_preview(p_structure_id uuid, p_gross numeric)
 RETURNS TABLE(code text, name text, category text, calculation_type text, calc_base text, calc_rate numeric, calc_formula text, amount numeric, included_in_gross boolean, included_in_ctc boolean, is_statutory boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare v_company uuid;
begin
  select company_id into v_company from public.salary_structures where id = p_structure_id;
  if v_company is null then raise exception 'Salary structure not found.'; end if;
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and v_company = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select b.code, b.name, b.category, b.calculation_type, b.calc_base, b.calc_rate, b.calc_formula,
         b.amount, b.included_in_gross, b.included_in_ctc, b.is_statutory
  from public.salary_bifurcate(p_structure_id, p_gross) b;
end;
$function$
