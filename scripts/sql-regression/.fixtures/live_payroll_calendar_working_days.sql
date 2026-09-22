CREATE OR REPLACE FUNCTION public.payroll_calendar_working_days(p_calendar_id uuid, p_start date, p_end date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_cal public.store_payroll_calendars;
  v_d date;
  v_count int := 0;
  v_dow int;
  v_is_off boolean;
begin
  select * into v_cal from public.store_payroll_calendars where id = p_calendar_id;
  if v_cal.id is null then return null; end if;

  v_d := p_start;
  while v_d <= p_end loop
    v_dow := extract(dow from v_d)::int;   -- 0=Sun .. 6=Sat
    v_is_off := v_dow = any(v_cal.weekly_off_days);

    if not v_is_off and v_cal.alternate_saturday_off and v_dow = 6 and v_cal.alternate_saturday_reference is not null then
      -- same fortnightly parity as the reference Saturday => that Saturday is off
      if (abs(v_d - v_cal.alternate_saturday_reference) / 7) % 2 = 0 then v_is_off := true; end if;
    end if;

    if not v_is_off and v_cal.holiday_source = 'company_holidays' then
      if exists (select 1 from public.holidays h
                 where h.company_id = v_cal.company_id
                   and (h.store_id = v_cal.store_id or h.store_id is null)
                   and h.holiday_date = v_d) then
        v_is_off := true;
      end if;
    end if;

    if not v_is_off then v_count := v_count + 1; end if;
    v_d := v_d + 1;
  end loop;
  return v_count;
end;
$function$
