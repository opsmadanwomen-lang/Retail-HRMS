CREATE OR REPLACE FUNCTION public.payroll_policy_validate(p_policy_id uuid)
 RETURNS TABLE(ok boolean, error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare p public.payroll_policies; v_overlap int; sr record;
begin
  select * into p from public.payroll_policies where id = p_policy_id;
  if p.id is null then ok := false; error := 'Policy not found.'; return next; return; end if;
  if p.effective_from is null then ok := false; error := 'Effective From is required.'; return next; return; end if;
  if p.effective_to is not null and p.effective_to < p.effective_from then ok := false; error := 'Effective To is before Effective From.'; return next; return; end if;

  select count(*) into v_overlap from public.payroll_policies q
  where q.company_id = p.company_id and q.id <> p.id and q.status = 'active'
    and q.effective_from >= p.effective_from
    and daterange(q.effective_from, coalesce(q.effective_to, 'infinity'::date), '[]')
        && daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[]');
  if v_overlap > 0 then ok := false; error := 'Another active policy version starts inside this date range.'; return next; return; end if;

  if p.proration_method = 'custom' and p.proration_custom_divisor is null and coalesce(btrim(p.proration_custom_formula), '') = '' then
    ok := false; error := 'Custom proration method needs a custom divisor or formula.'; return next; return; end if;
  if p.lwp_enabled and coalesce(p.lwp_basis, p.lwp_divisor_basis) is null then
    ok := false; error := 'LWP is enabled but no salary basis is configured.'; return next; return; end if;
  if p.deduction_cap_mode = 'custom' and coalesce(btrim(p.deduction_cap_formula), '') = '' then
    ok := false; error := 'Custom deduction cap needs a formula.'; return next; return; end if;

  for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and enabled loop
    if sr.calc_method = 'pct_of_component' and coalesce(btrim(sr.ref_component_code), '') = '' then
      ok := false; error := format('%s uses "%% of another component" but no reference component code is set.', coalesce(upper(sr.component_code), upper(sr.kind)));
      return next; return;
    end if;
    if sr.calc_method = 'formula' and coalesce(btrim(sr.base_formula), '') = '' then
      ok := false; error := format('%s uses a custom formula but none is configured.', coalesce(upper(sr.component_code), upper(sr.kind)));
      return next; return;
    end if;
  end loop;

  begin
    if coalesce(btrim(p.proration_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.proration_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1)); end if;
    if coalesce(btrim(p.nd_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.nd_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1, 'NDVALUE', 1, 'DIVISOR', 1)); end if;
    if coalesce(btrim(p.deduction_cap_formula), '') <> '' then perform public.payroll_eval_formula(p.deduction_cap_formula, jsonb_build_object('GROSS', 1)); end if;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(base_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.base_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(employer_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.employer_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
  exception when others then ok := false; error := 'Invalid formula: ' || sqlerrm; return next; return; end;

  ok := true; error := null; return next;
end;
$function$
