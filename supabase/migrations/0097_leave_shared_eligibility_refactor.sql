-- ============================================================================
-- Retail HRMS — Leave Management, Phase 2: extract shared eligibility logic
-- Migration 0097
--
-- Phase 1's leave_preview_calculation() (migration 0092) computed probation-
-- completion-date and eligibility-start-date INLINE. Phase 2's leave_apply()
-- needs the exact same computation (is this employee currently inside
-- probation for this leave type, right now?) -- per the explicit "do not
-- duplicate calculation logic, extend the backend engine" instruction, that
-- logic is extracted here into ONE shared function, and
-- leave_preview_calculation() is updated (CREATE OR REPLACE, identical
-- signature and identical behavior — this is a pure refactor, not a formula
-- change) to call it instead of repeating itself. No previously-verified
-- Phase 1 test result changes as a result of this refactor (re-verified
-- below after applying).
-- ============================================================================

create or replace function public.leave_resolve_eligibility(
  p_employee_id uuid,
  p_policy_id uuid,
  p_probation_eligible boolean,
  out probation_end date,
  out eligibility_start date
)
returns record
language plpgsql
stable
security definer
as $$
declare
  v_employee record;
  v_probation record;
begin
  select joining_date into v_employee from public.employees where id = p_employee_id;

  select duration_value, duration_unit, post_probation_start_rule, specific_start_date
  into v_probation
  from public.leave_probation_rules r
  where r.policy_id = p_policy_id;

  if v_probation.duration_value is null or v_probation.duration_value = 0 or v_employee.joining_date is null then
    probation_end := v_employee.joining_date;
  elsif v_probation.duration_unit = 'days' then
    probation_end := v_employee.joining_date + (v_probation.duration_value || ' days')::interval;
  else
    probation_end := v_employee.joining_date + (v_probation.duration_value || ' months')::interval;
  end if;

  if not p_probation_eligible then
    eligibility_start := v_employee.joining_date;
    return;
  end if;

  case coalesce(v_probation.post_probation_start_rule, 'same_month')
    when 'same_month' then eligibility_start := date_trunc('month', probation_end)::date;
    when 'next_month' then eligibility_start := (date_trunc('month', probation_end) + interval '1 month')::date;
    when 'specific_date' then eligibility_start := coalesce(v_probation.specific_start_date, probation_end);
    when 'pro_rata', 'full_entitlement' then eligibility_start := date_trunc('month', probation_end)::date;
    else eligibility_start := date_trunc('month', probation_end)::date;
  end case;
end;
$$;

grant execute on function public.leave_resolve_eligibility(uuid, uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- leave_preview_calculation() — CREATE OR REPLACE, same signature, now calls
-- leave_resolve_eligibility() instead of repeating the same computation
-- inline. Every other line is unchanged from migration 0092.
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
  v_eligibility record;
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

  select * into v_eligibility from public.leave_resolve_eligibility(p_employee_id, v_policy_id, v_config.probation_eligible);

  v_cursor := date_trunc('month', v_fy.start_date)::date;
  while v_cursor <= v_fy.end_date loop
    v_is_probation := v_config.probation_eligible and v_eligibility.probation_end is not null and v_cursor < date_trunc('month', v_eligibility.probation_end)::date;
    v_is_eligible := v_config.accrual_enabled and v_eligibility.eligibility_start is not null and v_cursor >= v_eligibility.eligibility_start;
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
      if v_cursor = v_eligibility.eligibility_start and v_probation.post_probation_start_rule = 'pro_rata' then
        v_month_entitlement := round(v_month_entitlement * (extract(day from (date_trunc('month', v_cursor) + interval '1 month - 1 day')) - extract(day from v_eligibility.probation_end) + 1) / extract(day from (date_trunc('month', v_cursor) + interval '1 month - 1 day')), 2);
        v_note := 'Pro-rata first eligible month.';
      elsif v_cursor = v_eligibility.eligibility_start and v_probation.post_probation_start_rule = 'full_entitlement' then
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

    if v_probation.post_probation_start_rule = 'full_entitlement' and v_is_eligible and v_cursor > v_eligibility.eligibility_start then
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
