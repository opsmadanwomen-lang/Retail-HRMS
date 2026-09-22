-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: fix "record not assigned" bug in
-- leave_compute_fy_closing()
-- Migration 0118
--
-- BUG FOUND DURING LIVE TESTING: v_salary was declared `record` and only
-- ever assigned INSIDE the encashment-eligibility branch. For any
-- employee/leave-type where encashment isn't even attempted (encashment_allowed
-- = false, or available/remaining = 0), v_salary was accessed at the bottom
-- of the loop (basic_salary_snapshot := v_salary.basic_salary) while still
-- completely unassigned — PL/pgSQL raises "record is not assigned yet" the
-- instant that happens, since an unassigned record's shape is indeterminate.
-- Fixed by using two plain `numeric` locals (naturally NULL until assigned)
-- instead of a record. No calculation logic changed.
-- ============================================================================
create or replace function public.leave_compute_fy_closing(p_financial_year_id uuid)
returns table (
  employee_id uuid,
  leave_type_id uuid,
  policy_id uuid,
  policy_version int,
  opening numeric,
  earned numeric,
  used numeric,
  pending numeric,
  available numeric,
  carry_forward_days numeric,
  encashment_days numeric,
  lapse_days numeric,
  basic_salary_snapshot numeric,
  da_snapshot numeric,
  salary_base_snapshot numeric,
  divisor_snapshot numeric,
  daily_rate numeric,
  encashment_amount numeric,
  final_status text
)
language plpgsql
stable
security definer
as $$
declare
  v_fy record;
  v_emp record;
  v_policy_id uuid;
  v_policy_version int;
  v_cfg record;
  v_bal record;
  v_encash record;
  v_basic_salary numeric;
  v_da numeric;
  v_carry_forward numeric;
  v_remaining numeric;
  v_encash_days numeric;
  v_lapse_days numeric;
  v_salary_base numeric;
  v_divisor numeric;
  v_daily_rate numeric;
  v_encash_amount numeric;
  v_threshold_value numeric;
  v_encashment_eligible boolean;
  v_final_status text;
  v_days_in_month int;
  v_opening numeric;
begin
  select id, company_id, start_date, end_date into v_fy from public.leave_financial_years where id = p_financial_year_id;
  if v_fy.id is null then
    raise exception 'Financial Year not found.';
  end if;

  for v_emp in select e.id from public.employees e where e.company_id = v_fy.company_id and e.status = 'active' loop
    v_policy_id := public.leave_resolve_policy_assignment(v_fy.company_id, v_emp.id, v_fy.end_date);
    if v_policy_id is null then
      continue;
    end if;
    select p.version_number into v_policy_version from public.leave_policies p where p.id = v_policy_id;

    for v_cfg in select c.* from public.leave_policy_type_configs c where c.policy_id = v_policy_id loop
      select * into v_bal from public.leave_get_balance(v_emp.id, v_cfg.leave_type_id, p_financial_year_id);

      select coalesce(sum(l.days), 0) into v_opening
      from public.leave_ledger l
      where l.employee_id = v_emp.id and l.leave_type_id = v_cfg.leave_type_id and l.financial_year_id = p_financial_year_id and l.transaction_type = 'opening';

      v_carry_forward := 0;
      v_encash_days := 0;
      v_lapse_days := 0;
      v_salary_base := null;
      v_divisor := null;
      v_daily_rate := null;
      v_encash_amount := null;
      v_basic_salary := null;
      v_da := null;

      if v_bal.available > 0 then
        if v_cfg.carry_forward_allowed then
          v_carry_forward := v_bal.available;
          if v_cfg.carry_forward_max_days is not null then
            v_carry_forward := least(v_carry_forward, v_cfg.carry_forward_max_days);
          end if;
        end if;

        v_remaining := v_bal.available - v_carry_forward;

        if v_remaining > 0 then
          v_encashment_eligible := false;

          if v_cfg.encashment_allowed then
            select r.* into v_encash from public.leave_encashment_rules r where r.policy_id = v_policy_id;

            if v_encash.id is not null and v_encash.enabled then
              select basic_salary, da into v_basic_salary, v_da from public.leave_resolve_salary_components(v_emp.id, v_fy.end_date);

              if v_basic_salary is not null then
                if v_encash.threshold_base_type = 'basic' then
                  v_threshold_value := v_basic_salary;
                elsif v_encash.threshold_base_type = 'basic_da' then
                  v_threshold_value := v_basic_salary + coalesce(v_da, 0);
                else
                  v_threshold_value := null;
                end if;

                if v_threshold_value is not null and v_encash.salary_threshold is not null then
                  v_encashment_eligible := case v_encash.threshold_comparison
                    when 'lt' then v_threshold_value < v_encash.salary_threshold
                    when 'lte' then v_threshold_value <= v_encash.salary_threshold
                    when 'gt' then v_threshold_value > v_encash.salary_threshold
                    when 'gte' then v_threshold_value >= v_encash.salary_threshold
                    else false
                  end;
                end if;

                if v_encashment_eligible then
                  if v_encash.salary_base_type = 'basic' then
                    v_salary_base := v_basic_salary;
                  elsif v_encash.salary_base_type = 'basic_da' then
                    v_salary_base := v_basic_salary + coalesce(v_da, 0);
                  else
                    v_salary_base := null;
                  end if;

                  if v_salary_base is not null then
                    if v_encash.divisor_type = '26' then
                      v_divisor := 26;
                    elsif v_encash.divisor_type = '30' then
                      v_divisor := 30;
                    elsif v_encash.divisor_type = 'calendar_days' then
                      select extract(day from (date_trunc('month', v_fy.end_date) + interval '1 month - 1 day'))::int into v_days_in_month;
                      v_divisor := v_days_in_month;
                    else
                      v_divisor := v_encash.divisor_custom_value;
                    end if;

                    if v_divisor is not null and v_divisor > 0 then
                      v_encash_days := v_remaining;
                      v_daily_rate := round(v_salary_base / v_divisor, 2);
                      v_encash_amount := round(v_encash_days * v_daily_rate, 2);
                    else
                      v_encashment_eligible := false;
                    end if;
                  else
                    v_encashment_eligible := false;
                  end if;
                end if;
              end if;
            end if;
          end if;

          if not v_encashment_eligible and v_cfg.lapse_allowed then
            v_lapse_days := v_remaining;
          end if;
        end if;
      end if;

      v_final_status := case
        when v_carry_forward > 0 and v_encash_days = 0 and v_lapse_days = 0 then 'carry_forward_only'
        when v_encash_days > 0 and v_lapse_days = 0 and v_carry_forward = 0 then 'encashed'
        when v_lapse_days > 0 and v_encash_days = 0 and v_carry_forward = 0 then 'lapsed'
        when (
          (case when v_carry_forward > 0 then 1 else 0 end) +
          (case when v_encash_days > 0 then 1 else 0 end) +
          (case when v_lapse_days > 0 then 1 else 0 end)
        ) > 1 then 'mixed'
        else 'no_action'
      end;

      employee_id := v_emp.id;
      leave_type_id := v_cfg.leave_type_id;
      policy_id := v_policy_id;
      policy_version := v_policy_version;
      opening := v_opening;
      earned := v_bal.earned;
      used := v_bal.used;
      pending := v_bal.pending;
      available := v_bal.available;
      carry_forward_days := v_carry_forward;
      encashment_days := v_encash_days;
      lapse_days := v_lapse_days;
      basic_salary_snapshot := v_basic_salary;
      da_snapshot := v_da;
      salary_base_snapshot := v_salary_base;
      divisor_snapshot := v_divisor;
      daily_rate := v_daily_rate;
      encashment_amount := v_encash_amount;
      final_status := v_final_status;
      return next;
    end loop;
  end loop;
end;
$$;
