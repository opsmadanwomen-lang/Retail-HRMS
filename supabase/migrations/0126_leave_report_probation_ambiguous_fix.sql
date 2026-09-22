-- ============================================================================
-- Retail HRMS — Leave Management: fix ambiguous column reference in
-- leave_report_probation()
-- Migration 0126
--
-- Bug (found by a live call to the Probation report):
--   ERROR 42702: column reference "post_probation_start_rule" is ambiguous
--   ... QUERY: select duration_value, duration_unit, post_probation_start_rule
--              from public.leave_probation_rules where policy_id = v_policy_id
--
-- In migration 0123's leave_report_probation() the SELECT ... INTO v_prob uses
-- unqualified column names (post_probation_start_rule, and implicitly policy_id)
-- that also exist as RETURNS TABLE output parameters of the function, so
-- PL/pgSQL cannot tell whether the name is the table column or the OUT
-- variable. Every other line already works because it is either table-aliased
-- (the employee loop) or an assignment target.
--
-- Fix: alias the probation-rules table and qualify its columns. Byte-identical
-- to 0123 otherwise — same body, same reuse of leave_resolve_eligibility() /
-- leave_resolve_policy_assignment(), same RLS gate, same output. No schema
-- change, no new object. Same "ambiguous_column_fix" pattern as migrations
-- 0117/0118/0119 for the FY-closing engine.
-- ============================================================================
create or replace function public.leave_report_probation(p_company_id uuid)
returns table (
  employee_id uuid,
  employee_name text,
  employee_code text,
  joining_date date,
  policy_id uuid,
  probation_duration_value int,
  probation_duration_unit text,
  post_probation_start_rule text,
  eligibility_start date,
  is_currently_in_probation boolean
)
language plpgsql
stable
security definer
as $$
declare
  v_emp record;
  v_policy_id uuid;
  v_prob record;
  v_elig record;
begin
  if not (is_super_admin() or (current_user_role() <> 'staff' and p_company_id = current_user_company_id())) then
    raise exception 'Only Admin/HR may view the Probation report.' using errcode = '42501';
  end if;

  for v_emp in select e.id, e.full_name, e.employee_code, e.joining_date from public.employees e where e.company_id = p_company_id and e.status = 'active' and e.joining_date is not null loop
    v_policy_id := public.leave_resolve_policy_assignment(p_company_id, v_emp.id, current_date);
    if v_policy_id is null then
      continue;
    end if;
    select r.duration_value, r.duration_unit, r.post_probation_start_rule
      into v_prob
      from public.leave_probation_rules r
      where r.policy_id = v_policy_id;
    if v_prob.duration_value is null then
      continue;
    end if;
    select * into v_elig from public.leave_resolve_eligibility(v_emp.id, v_policy_id, true);

    employee_id := v_emp.id; employee_name := v_emp.full_name; employee_code := v_emp.employee_code;
    joining_date := v_emp.joining_date; policy_id := v_policy_id;
    probation_duration_value := v_prob.duration_value; probation_duration_unit := v_prob.duration_unit;
    post_probation_start_rule := v_prob.post_probation_start_rule;
    eligibility_start := v_elig.eligibility_start;
    is_currently_in_probation := v_elig.eligibility_start is not null and current_date < v_elig.eligibility_start;
    return next;
  end loop;
end;
$$;

grant execute on function public.leave_report_probation(uuid) to authenticated;
