CREATE OR REPLACE FUNCTION public.payroll_policy_finalize(p_policy_id uuid, p_gross numeric, p_deductions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  p public.payroll_policies;
  v_rows jsonb := '[]'::jsonb;
  e jsonb;
  v_code text; v_amt numeric; v_prot boolean; v_prio int;
  v_total numeric := 0;
  v_cap numeric;
  v_excess numeric;
  v_take numeric;
  v_cap_reduction numeric := 0;
  v_net numeric;
  v_neg_flag boolean := false;
  v_neg_blocked boolean := false;
  v_prio_configured boolean;
  i int;
  arr jsonb[];
begin
  select * into p from public.payroll_policies where id = p_policy_id;

  select count(*) > 0 into v_prio_configured from public.payroll_deduction_order
   where payroll_policy_id = p_policy_id and is_active;

  -- attach priority + protected flag
  for e in select * from jsonb_array_elements(coalesce(p_deductions, '[]'::jsonb)) loop
    v_code := e ->> 'code';
    v_amt := coalesce((e ->> 'amount')::numeric, 0);
    v_prot := coalesce((e ->> 'protected')::boolean, false) or v_code = 'ADVREC';
    v_prio := coalesce((select priority from public.payroll_deduction_order
                        where payroll_policy_id = p_policy_id and deduction_code = v_code and is_active), 999);
    v_rows := v_rows || jsonb_build_object('code', v_code, 'amount', v_amt, 'protected', v_prot, 'priority', v_prio);
    v_total := v_total + v_amt;
  end loop;

  -- sort rows by (priority, code) into arr — NEVER NULL, even with zero deductions
  select coalesce(array_agg(x order by (x ->> 'priority')::int, x ->> 'code'), '{}'::jsonb[])
    into arr from jsonb_array_elements(v_rows) x;

  -- ---- deduction cap ----
  v_cap := case coalesce(p.deduction_cap_mode, 'none')
    when 'none' then null
    when 'fixed' then p.deduction_cap_value
    when 'pct_of_gross' then round(p_gross * coalesce(p.deduction_cap_value, p.deduction_cap_pct) / 100.0, 2)
    when 'pct_of_net'   then round(p_gross * coalesce(p.deduction_cap_value, p.deduction_cap_pct) / 100.0, 2)
    when 'custom' then public.payroll_eval_formula(p.deduction_cap_formula, jsonb_build_object('GROSS', p_gross))
    else null end;

  if v_cap is not null and v_total > v_cap then
    v_excess := v_total - v_cap;
    for i in reverse array_length(arr, 1) .. 1 loop
      exit when v_excess <= 0;
      if not (arr[i] ->> 'protected')::boolean and (arr[i] ->> 'amount')::numeric > 0 then
        v_take := least((arr[i] ->> 'amount')::numeric, v_excess);
        arr[i] := jsonb_set(arr[i], '{amount}', to_jsonb((arr[i] ->> 'amount')::numeric - v_take));
        arr[i] := jsonb_set(arr[i], '{capped}', 'true'::jsonb);
        v_excess := v_excess - v_take;
        v_cap_reduction := v_cap_reduction + v_take;
      end if;
    end loop;
  end if;

  -- recompute total, net
  v_total := 0;
  for i in 1 .. coalesce(array_length(arr, 1), 0) loop v_total := v_total + (arr[i] ->> 'amount')::numeric; end loop;
  v_net := round(p_gross - v_total, 2);

  -- ---- negative-net policy ----
  if v_net < 0 then
    if coalesce(p.negative_net_policy, 'allow') = 'block' then
      v_excess := -v_net;
      for i in reverse array_length(arr, 1) .. 1 loop
        exit when v_excess <= 0;
        if not (arr[i] ->> 'protected')::boolean and (arr[i] ->> 'amount')::numeric > 0 then
          v_take := least((arr[i] ->> 'amount')::numeric, v_excess);
          arr[i] := jsonb_set(arr[i], '{amount}', to_jsonb((arr[i] ->> 'amount')::numeric - v_take));
          arr[i] := jsonb_set(arr[i], '{neg_blocked}', 'true'::jsonb);
          v_excess := v_excess - v_take;
        end if;
      end loop;
      v_total := 0;
      for i in 1 .. coalesce(array_length(arr, 1), 0) loop v_total := v_total + (arr[i] ->> 'amount')::numeric; end loop;
      v_net := round(p_gross - v_total, 2);
      v_neg_blocked := (v_net >= 0);
      v_neg_flag := (v_net < 0);
    else
      v_neg_flag := true;  -- allow / warn : keep the number, raise the flag
    end if;
  end if;

  return jsonb_build_object(
    'ordered', to_jsonb(arr),
    'total_deductions', v_total,
    'net', v_net,
    'cap', v_cap,
    'cap_reduction', v_cap_reduction,
    'negative_net_policy', coalesce(p.negative_net_policy, 'allow'),
    'negative_flag', v_neg_flag,
    'negative_blocked', v_neg_blocked,
    'priority_configured', v_prio_configured
  );
end;
$function$
