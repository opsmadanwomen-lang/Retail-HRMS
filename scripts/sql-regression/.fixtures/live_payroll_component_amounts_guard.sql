CREATE OR REPLACE FUNCTION public.payroll_component_amounts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare v_status text; v_period uuid;
begin
  v_period := coalesce(new.payroll_period_id, old.payroll_period_id);
  select status into v_status from public.payroll_periods where id = v_period;
  if v_status in ('finalized', 'locked', 'reversed') then
    raise exception 'Payroll period is % — PF/ESI manual amounts are immutable. Use the payroll reversal/correction process.', v_status
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$function$
