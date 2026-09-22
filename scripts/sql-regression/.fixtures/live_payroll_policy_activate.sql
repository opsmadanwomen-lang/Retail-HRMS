CREATE OR REPLACE FUNCTION public.payroll_policy_activate(p_policy_id uuid)
 RETURNS payroll_policies
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare p public.payroll_policies; v_ok boolean; v_err text;
begin
  select * into p from public.payroll_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  if not public.payroll_can_manage(p.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;

  -- close (NOT archive) any OLDER active version that would overlap — it stays
  -- 'active' for its own historical date range so past payroll still resolves it
  update public.payroll_policies
  set effective_to = p.effective_from - 1, updated_by = auth.uid()
  where company_id = p.company_id and id <> p_policy_id and status = 'active'
    and effective_from <= p.effective_from
    and (effective_to is null or effective_to >= p.effective_from);

  select v.ok, v.error into v_ok, v_err from public.payroll_policy_validate(p_policy_id) v limit 1;
  if not v_ok then raise exception 'Policy cannot be activated — %', v_err; end if;

  update public.payroll_policies set status = 'active', updated_by = auth.uid() where id = p_policy_id returning * into p;
  return p;
end;
$function$
