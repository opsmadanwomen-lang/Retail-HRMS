-- ============================================================================
-- Retail HRMS — Leave Management, Phase 1: Policy Calculation Engine
-- Migration 0092
--
-- THE single authoritative engine (§57 of the approved plan): Policy
-- Assignment resolution, month-in-period matching, per-month entitlement
-- computation, and Policy Preview are ALL implemented here, ONCE. Phase 2's
-- real monthly-accrual-posting RPC (not built yet) will call
-- leave_compute_month_entitlement() -- the SAME function Preview calls below
-- -- never a second/parallel formula. Nothing here touches Attendance/Night
-- Duty/Payroll -- purely new, read-only-safe (Preview never writes) Leave
-- Policy Engine functions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- leave_month_in_period: does calendar month p_month fall inside
-- [p_start_month, p_end_month], where the range may wrap the calendar year
-- (e.g. Oct(10) -> Mar(3))? Pure calendar arithmetic, no business rule.
-- ----------------------------------------------------------------------------
create or replace function public.leave_month_in_period(p_start_month int, p_end_month int, p_month int)
returns boolean
language sql
immutable
as $$
  select case
    when p_start_month <= p_end_month then p_month between p_start_month and p_end_month
    else p_month >= p_start_month or p_month <= p_end_month
  end;
$$;

-- ----------------------------------------------------------------------------
-- leave_resolve_policy_assignment: the SAME deterministic-tier pattern
-- resolve_attendance_rule() already uses in this codebase (migration 0038/
-- 0063) -- walks Employee-specific -> Store -> Store Designation -> Store
-- Department -> Employment Type -> Company-wide default, first match wins.
-- Only ever resolves to a policy whose OWN status is 'active' -- an
-- assignment pointing at a draft/closed policy is never returned, even if
-- its own effective_from/effective_to window still covers p_date.
-- ----------------------------------------------------------------------------
create or replace function public.leave_resolve_policy_assignment(
  p_company_id uuid,
  p_employee_id uuid,
  p_date date
)
returns uuid
language plpgsql
stable
security definer
as $$
declare
  v_employee record;
  v_policy_id uuid;
begin
  select store_id, store_designation_id, store_department_id, employment_type
  into v_employee
  from public.employees
  where id = p_employee_id;

  -- Tier 1: employee-specific.
  select a.policy_id into v_policy_id
  from public.leave_policy_assignments a
  join public.leave_policies p on p.id = a.policy_id and p.status = 'active'
  where a.company_id = p_company_id and a.scope_type = 'employee' and a.employee_id = p_employee_id
    and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
  order by a.effective_from desc
  limit 1;
  if v_policy_id is not null then return v_policy_id; end if;

  -- Tier 2: store.
  if v_employee.store_id is not null then
    select a.policy_id into v_policy_id
    from public.leave_policy_assignments a
    join public.leave_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'store' and a.store_id = v_employee.store_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc
    limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 3: store designation.
  if v_employee.store_designation_id is not null then
    select a.policy_id into v_policy_id
    from public.leave_policy_assignments a
    join public.leave_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'store_designation' and a.store_designation_id = v_employee.store_designation_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc
    limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 4: store department.
  if v_employee.store_department_id is not null then
    select a.policy_id into v_policy_id
    from public.leave_policy_assignments a
    join public.leave_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'store_department' and a.store_department_id = v_employee.store_department_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc
    limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 5: employment type.
  if v_employee.employment_type is not null then
    select a.policy_id into v_policy_id
    from public.leave_policy_assignments a
    join public.leave_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'employment_type' and a.employment_type = v_employee.employment_type::text
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc
    limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 6: company-wide default.
  select a.policy_id into v_policy_id
  from public.leave_policy_assignments a
  join public.leave_policies p on p.id = a.policy_id and p.status = 'active'
  where a.company_id = p_company_id and a.scope_type = 'company'
    and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
  order by a.effective_from desc
  limit 1;

  return v_policy_id; -- null if nothing resolved at any tier
end;
$$;

grant execute on function public.leave_resolve_policy_assignment(uuid, uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- leave_compute_month_entitlement: the ONE place a leave type's per-month
-- accrual amount is ever computed, from leave_accrual_periods -- Preview and
-- (in Phase 2) the real accrual-posting RPC both call this, never duplicate
-- the formula. Returns 0 if no configured period matches or accrual is
-- disabled -- never guesses.
-- ----------------------------------------------------------------------------
create or replace function public.leave_compute_month_entitlement(
  p_policy_type_config_id uuid,
  p_month int
)
returns numeric
language sql
stable
security definer
as $$
  select coalesce(
    (
      select ap.accrual_amount
      from public.leave_accrual_periods ap
      join public.leave_policy_type_configs c on c.id = ap.policy_type_config_id and c.accrual_enabled
      where ap.policy_type_config_id = p_policy_type_config_id
        and public.leave_month_in_period(ap.period_start_month, ap.period_end_month, p_month)
      order by ap.sort_order
      limit 1
    ),
    0
  );
$$;

grant execute on function public.leave_compute_month_entitlement(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- leave_preview_calculation: HR's "Preview Calculation" screen (§43/§46). The
-- SAME engine as above -- calls leave_resolve_policy_assignment() and
-- leave_compute_month_entitlement() exactly once each per month, applies the
-- probation rule, and returns a month-by-month projection. Used/Pending are
-- always 0 here -- there is no Ledger yet (Phase 2), so Closing = cumulative
-- Earned. This function NEVER writes anything -- pure read/compute, safe to
-- call as many times as HR wants while designing a policy.
-- ----------------------------------------------------------------------------
create or replace function public.leave_preview_calculation(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_financial_year_id uuid
)
returns table (
  month_start date,
  policy_id uuid,
  is_probation boolean,
  is_eligible boolean,
  monthly_entitlement numeric,
  cumulative_earned numeric,
  used numeric,
  pending numeric,
  closing_balance numeric,
  note text
)
language plpgsql
stable
security definer
as $$
declare
  v_employee record;
  v_fy record;
  v_policy_id uuid;
  v_config record;
  v_probation record;
  v_probation_end date;
  v_eligibility_start date;
  v_cursor date;
  v_cumulative numeric := 0;
  v_month_entitlement numeric;
  v_is_probation boolean;
  v_is_eligible boolean;
  v_note text;
begin
  select id, company_id, joining_date into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then
    raise exception 'Employee not found.';
  end if;

  select id, start_date, end_date into v_fy from public.leave_financial_years where id = p_financial_year_id;
  if v_fy.id is null then
    raise exception 'Financial Year not found.';
  end if;

  -- Resolve once, using the FY's own start date -- see migration header note: a Phase 1
  -- simplification, the assignment governing a whole FY is treated as stable across it.
  v_policy_id := public.leave_resolve_policy_assignment(v_employee.company_id, p_employee_id, v_fy.start_date);
  if v_policy_id is null then
    return query select v_fy.start_date, null::uuid, null::boolean, false, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      'No Leave Policy is assigned for this employee.';
    return;
  end if;

  select id, probation_eligible, accrual_enabled into v_config
  from public.leave_policy_type_configs c
  where c.policy_id = v_policy_id and c.leave_type_id = p_leave_type_id;

  if v_config.id is null then
    return query select v_fy.start_date, v_policy_id, null::boolean, false, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      'This Leave Type is not configured under the resolved policy.';
    return;
  end if;

  select duration_value, duration_unit, extra_leave_during_probation, post_probation_start_rule, specific_start_date
  into v_probation
  from public.leave_probation_rules r
  where r.policy_id = v_policy_id;

  -- Probation completion date -- 0 duration means "no probation gate at all".
  if v_probation.duration_value is null or v_probation.duration_value = 0 or v_employee.joining_date is null then
    v_probation_end := v_employee.joining_date;
  elsif v_probation.duration_unit = 'days' then
    v_probation_end := v_employee.joining_date + (v_probation.duration_value || ' days')::interval;
  else
    v_probation_end := v_employee.joining_date + (v_probation.duration_value || ' months')::interval;
  end if;

  -- Eligibility start date, per the configured post-probation-start rule -- this is the ONE place
  -- that rule is interpreted; Phase 2 accrual posting must call this same function, never
  -- re-derive it.
  if not v_config.probation_eligible then
    -- This leave type ignores the probation gate entirely.
    v_eligibility_start := v_employee.joining_date;
  else
    case coalesce(v_probation.post_probation_start_rule, 'same_month')
      when 'same_month' then
        v_eligibility_start := date_trunc('month', v_probation_end)::date;
      when 'next_month' then
        v_eligibility_start := (date_trunc('month', v_probation_end) + interval '1 month')::date;
      when 'specific_date' then
        v_eligibility_start := coalesce(v_probation.specific_start_date, v_probation_end);
      when 'pro_rata', 'full_entitlement' then
        -- Entitlement still begins the month probation completes; the AMOUNT for that first month
        -- is adjusted below (pro_rata) or the full remaining-FY total is credited at that month
        -- (full_entitlement) -- the START month itself is the same as 'same_month' either way.
        v_eligibility_start := date_trunc('month', v_probation_end)::date;
      else
        v_eligibility_start := date_trunc('month', v_probation_end)::date;
    end case;
  end if;

  v_cursor := date_trunc('month', v_fy.start_date)::date;
  while v_cursor <= v_fy.end_date loop
    v_is_probation := v_config.probation_eligible and v_probation_end is not null and v_cursor < date_trunc('month', v_probation_end)::date;
    v_is_eligible := v_config.accrual_enabled and v_eligibility_start is not null and v_cursor >= v_eligibility_start;
    v_note := null;

    if not v_config.accrual_enabled then
      v_month_entitlement := 0;
      v_note := 'Accrual disabled for this Leave Type.';
    elsif v_is_probation then
      v_month_entitlement := coalesce(v_probation.extra_leave_during_probation, 0);
      v_note := 'On probation.';
    elsif not v_is_eligible then
      v_month_entitlement := 0;
      v_note := 'Before eligibility start date.';
    else
      v_month_entitlement := public.leave_compute_month_entitlement(v_config.id, extract(month from v_cursor)::int);
      if v_cursor = v_eligibility_start and v_probation.post_probation_start_rule = 'pro_rata' then
        v_month_entitlement := round(v_month_entitlement * (extract(day from (date_trunc('month', v_cursor) + interval '1 month - 1 day')) - extract(day from v_probation_end) + 1) / extract(day from (date_trunc('month', v_cursor) + interval '1 month - 1 day')), 2);
        v_note := 'Pro-rata first eligible month.';
      elsif v_cursor = v_eligibility_start and v_probation.post_probation_start_rule = 'full_entitlement' then
        -- Full remaining-FY entitlement credited in one lump sum at the eligibility month.
        declare
          v_remaining_total numeric := 0;
          v_scan date := v_cursor;
        begin
          while v_scan <= v_fy.end_date loop
            v_remaining_total := v_remaining_total + public.leave_compute_month_entitlement(v_config.id, extract(month from v_scan)::int);
            v_scan := v_scan + interval '1 month';
          end loop;
          v_month_entitlement := v_remaining_total;
          v_note := 'Full remaining-year entitlement credited this month.';
        end;
      end if;
    end if;

    -- full_entitlement rule already front-loaded everything into the eligibility month; every
    -- month after that gets 0 so the total is never double-counted.
    if v_probation.post_probation_start_rule = 'full_entitlement' and v_is_eligible and v_cursor > v_eligibility_start then
      v_month_entitlement := 0;
    end if;

    v_cumulative := v_cumulative + v_month_entitlement;

    month_start := v_cursor;
    policy_id := v_policy_id;
    is_probation := v_is_probation;
    is_eligible := v_is_eligible;
    monthly_entitlement := v_month_entitlement;
    cumulative_earned := v_cumulative;
    used := 0;
    pending := 0;
    closing_balance := v_cumulative;
    note := v_note;
    return next;

    v_cursor := v_cursor + interval '1 month';
  end loop;
end;
$$;

grant execute on function public.leave_preview_calculation(uuid, uuid, uuid) to authenticated;
