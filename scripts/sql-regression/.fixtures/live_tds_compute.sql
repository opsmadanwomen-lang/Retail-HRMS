CREATE OR REPLACE FUNCTION public.tds_compute(p_policy_id uuid, p_annual_taxable numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  p public.tds_policies;
  v_slab record;
  v_prev_max numeric := 0;
  v_tax numeric := 0;
  v_band numeric;
  v_applicable uuid;
  v_rate numeric;
  v_rebate numeric := 0;
  v_cess numeric := 0;
  v_final numeric;
begin
  select * into p from public.tds_policies where id = p_policy_id;
  if p.id is null then return jsonb_build_object('configured', false, 'reason', 'No TDS policy.'); end if;
  if p.status <> 'active' then return jsonb_build_object('configured', false, 'reason', 'TDS policy is not active.'); end if;
  if p.tax_regime is null then return jsonb_build_object('configured', false, 'reason', 'Tax regime not supplied.'); end if;
  if p.annualization_method is null then return jsonb_build_object('configured', false, 'reason', 'Annualization method not defined.'); end if;
  if not exists (select 1 from public.tds_slabs where tds_policy_id = p_policy_id) then
    return jsonb_build_object('configured', false, 'reason', 'No tax slabs configured.');
  end if;
  if p_annual_taxable is null then return jsonb_build_object('configured', false, 'reason', 'Taxable income unavailable.'); end if;

  for v_slab in
    select * from public.tds_slabs where tds_policy_id = p_policy_id order by min_income asc
  loop
    exit when p_annual_taxable <= v_slab.min_income;
    v_band := least(coalesce(v_slab.max_income, p_annual_taxable), p_annual_taxable) - v_slab.min_income;
    if v_band > 0 then
      v_tax := v_tax + v_band * v_slab.rate / 100.0 + v_slab.fixed_component;
    end if;
    if p_annual_taxable >= v_slab.min_income and (v_slab.max_income is null or p_annual_taxable <= v_slab.max_income) then
      v_applicable := v_slab.id; v_rate := v_slab.rate;
    end if;
  end loop;

  if p.rebate_limit is not null and p_annual_taxable <= p.rebate_limit then
    v_rebate := least(coalesce(p.rebate_amount, v_tax), v_tax);
  end if;
  v_tax := greatest(v_tax - v_rebate, 0);
  if p.cess_pct is not null then v_cess := round(v_tax * p.cess_pct / 100.0, 2); end if;
  v_final := round(v_tax + v_cess, 2);

  return jsonb_build_object(
    'configured', true,
    'tax_regime', p.tax_regime,
    'policy_version', p.version_no,
    'annual_taxable', p_annual_taxable,
    'applicable_slab_id', v_applicable,
    'slab_rate', v_rate,
    'computed_tax_before_rebate', round(v_tax + v_rebate, 2),
    'rebate', v_rebate,
    'cess', v_cess,
    'final_annual_tds', v_final,
    'monthly_tds', round(v_final / 12.0, 2)
  );
end;
$function$
