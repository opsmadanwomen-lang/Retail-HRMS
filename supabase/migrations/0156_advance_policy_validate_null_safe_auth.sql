-- ============================================================================
-- Retail HRMS — Fix NULL-unsafe authorization in migration 0155's new RPCs
-- Migration 0156
--
-- FOUND LIVE (post-deploy validation, real anonymous REST call against the
-- real "Standard Advance Policy" (ADV-STD)): advance_validate_policy()
-- returned the FULL checklist to an unauthenticated caller. Root cause: for
-- an anonymous/unauthenticated request, current_user_role() and
-- is_super_admin() both return SQL NULL (no profiles row for auth.uid()),
-- not false. `if not (is_super_admin() or (...))` then evaluates to
-- `if not (NULL or NULL)` = `if not NULL` = `if NULL`, and plpgsql treats a
-- NULL IF-condition as false — the guard's exception branch never runs.
-- The exact same pattern existed in advance_activate_policy()'s
-- `if not is_super_admin() then raise exception` guard.
--
-- FIX: wrap every such guard in coalesce(..., false) so an indeterminate
-- (anonymous) result is treated as "not authorized", never as "authorized".
-- No other logic in either function changes.
--
-- ADDITIONALLY hardened here (same audit, same session): migration 0154's
-- advance_ledger_rows() and advance_ledger_employee_advances() have the
-- IDENTICAL `if current_user_role() = 'staff' then raise` pattern, which is
-- likewise a no-op for an anonymous caller. Empirically confirmed this does
-- NOT currently leak data (both functions' final result always filters on
-- `company_id = current_user_company_id()`, which is NULL for an anonymous
-- caller and therefore excludes every row — verified live: both returned []
-- for a real employee id before this fix). Hardened anyway for defense in
-- depth, so the explicit rejection is never silently skipped regardless of
-- how the rest of either function might change in future. advance_ledger_
-- stores()'s guard is a WHERE-clause condition, not a plpgsql IF, and NULL
-- in a WHERE clause already correctly excludes rows — no change needed there.
-- ============================================================================

create or replace function public.advance_validate_policy(p_policy_id uuid)
returns table (check_key text, label text, passed boolean, detail text)
language plpgsql
stable
security definer
as $$
declare
  v_policy public.advance_policies;
  v_cfg public.advance_policy_configs;
  v_has_active_boss boolean;
  v_has_active_type boolean;
begin
  select * into v_policy from public.advance_policies where id = p_policy_id;
  if v_policy.id is null then
    raise exception 'Policy not found.';
  end if;
  if not coalesce(is_super_admin() or (current_user_role() <> 'staff' and v_policy.company_id = current_user_company_id()), false) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_cfg from public.advance_policy_configs where policy_id = p_policy_id;

  check_key := 'general'; label := 'General policy configured';
  passed := v_policy.name is not null and length(trim(v_policy.name)) > 0
        and v_policy.code is not null and length(trim(v_policy.code)) > 0
        and v_policy.effective_from is not null;
  detail := case when passed then 'Name, code and effective date are set.' else 'Name, code and effective date are required.' end;
  return next;

  check_key := 'eligibility'; label := 'Eligibility configured';
  passed := v_cfg.id is not null;
  detail := case when passed then 'Eligibility configuration exists.' else 'Open Configure and save the Eligibility section at least once.' end;
  return next;

  check_key := 'approval_workflow'; label := 'Approval workflow configured';
  passed := v_cfg.id is not null;
  detail := 'Reporting Manager requirement: ' || case when coalesce(v_cfg.manager_approval_required, true) then 'required' else 'not required' end || '.';
  return next;

  select exists (
    select 1 from public.advance_final_approvers fa where fa.company_id = v_policy.company_id and fa.is_active
  ) into v_has_active_boss;
  check_key := 'boss_authority'; label := 'Boss authority configured';
  passed := (not coalesce(v_cfg.boss_final_approval_required, true)) or v_has_active_boss;
  detail := case
    when not coalesce(v_cfg.boss_final_approval_required, true) then 'Boss final approval is not required by this policy.'
    when v_has_active_boss then 'An active Final Approver (Boss) is configured for this company.'
    else 'Boss final approval is required but no active Final Approver (Boss) is configured — see Final Approver (Boss) settings.'
  end;
  return next;

  check_key := 'payment_rules'; label := 'Payment rules configured';
  passed := v_cfg.id is not null;
  detail := 'Partial payment: ' || case when coalesce(v_cfg.allow_partial_payment, false) then 'allowed' else 'not allowed' end || '.';
  return next;

  check_key := 'recovery_rules'; label := 'Recovery rules configured';
  passed := (not coalesce(v_cfg.recovery_enabled, true))
    or (v_cfg.recovery_start_rule <> 'specific_date' and v_cfg.recovery_start_rule <> 'specific_month')
    or v_cfg.recovery_start_specific is not null;
  detail := case
    when not coalesce(v_cfg.recovery_enabled, true) then 'Recovery is disabled for this policy.'
    when passed then 'Recovery start rule "' || v_cfg.recovery_start_rule || '" is fully configured.'
    else 'Recovery Start Rule is "' || v_cfg.recovery_start_rule || '" but no Specific Start Date/Month is set.'
  end;
  return next;

  check_key := 'recovery_method'; label := 'Recovery method configured';
  passed := (not coalesce(v_cfg.recovery_enabled, true))
    or (v_cfg.recovery_method = 'fixed_installments' and coalesce(v_cfg.recovery_installment_count, v_cfg.max_installments, 12) >= 1)
    or (v_cfg.recovery_method = 'fixed_monthly' and v_cfg.recovery_monthly_amount is not null and v_cfg.recovery_monthly_amount > 0)
    or v_cfg.recovery_method in ('custom', 'full');
  detail := case
    when not coalesce(v_cfg.recovery_enabled, true) then 'Recovery is disabled for this policy.'
    when passed then 'Recovery method "' || v_cfg.recovery_method || '" is fully configured.'
    when v_cfg.recovery_method = 'fixed_monthly' then 'Recovery Method is "Fixed monthly deduction" but no Monthly Deduction amount is set.'
    else 'Recovery Method "' || coalesce(v_cfg.recovery_method, '—') || '" is incomplete.'
  end;
  return next;

  select exists (
    select 1 from public.advance_types t where t.company_id = v_policy.company_id and t.is_active
  ) into v_has_active_type;
  check_key := 'advance_type_assignment'; label := 'Advance Type assignment configured';
  passed := v_has_active_type;
  detail := case when passed then 'At least one active Advance Type exists for this company.' else 'No active Advance Type exists for this company — create one under Advance Types first.' end;
  return next;
end;
$$;
grant execute on function public.advance_validate_policy(uuid) to authenticated;

create or replace function public.advance_activate_policy(p_policy_id uuid, p_change_reason text default null)
returns public.advance_policies
language plpgsql
security definer
as $$
declare
  v_policy public.advance_policies;
  v_failed text;
  v_row record;
begin
  if not coalesce(is_super_admin(), false) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_policy from public.advance_policies where id = p_policy_id for update;
  if v_policy.id is null then
    raise exception 'Policy not found.';
  end if;
  if v_policy.status = 'active' then
    return v_policy;
  end if;

  for v_row in select * from public.advance_validate_policy(p_policy_id) where not passed loop
    v_failed := coalesce(v_failed || '; ', '') || v_row.label || ' — ' || v_row.detail;
  end loop;
  if v_failed is not null then
    raise exception 'Policy cannot be activated: %', v_failed;
  end if;

  update public.advance_policies
  set status = 'archived', updated_by = auth.uid()
  where company_id = v_policy.company_id and code = v_policy.code and status = 'active' and id <> v_policy.id;

  update public.advance_policies
  set status = 'active',
      approved_by = auth.uid(),
      approved_at = now(),
      change_reason = coalesce(p_change_reason, change_reason),
      updated_by = auth.uid()
  where id = p_policy_id
  returning * into v_policy;

  return v_policy;
end;
$$;
grant execute on function public.advance_activate_policy(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Defense-in-depth hardening of migration 0154's two plpgsql role guards
-- (see header note). Every other line is byte-for-byte identical to 0154.
-- ----------------------------------------------------------------------------
create or replace function public.advance_ledger_rows(
  p_store_id uuid default null,
  p_department_id uuid default null,
  p_designation_id uuid default null,
  p_employee_id uuid default null,
  p_status text default null,
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_show_all boolean default false
)
returns table (
  employee_id uuid,
  employee_code text,
  full_name text,
  mobile text,
  email text,
  store_id uuid,
  store_name text,
  department_name text,
  designation_title text,
  advance_count int,
  total_approved numeric,
  total_paid numeric,
  total_recovered numeric,
  total_outstanding numeric,
  derived_status text
)
language plpgsql
stable
security definer
as $$
declare
  v_company_id uuid := public.current_user_company_id();
  v_store_scope uuid := public.current_user_store_id();
  v_effective_store uuid;
begin
  if coalesce(public.current_user_role() = 'staff', true) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if v_store_scope is not null then
    if p_store_id is not null and p_store_id <> v_store_scope then
      raise exception 'Not authorized for the selected store.' using errcode = '42501';
    end if;
    v_effective_store := v_store_scope;
  else
    v_effective_store := p_store_id;
  end if;

  return query
  with agg as (
    select
      ar.employee_id as emp_id,
      count(*)::int as advance_count,
      sum(coalesce(ar.boss_approved_amount, 0)) as total_approved,
      sum(coalesce(fp.payment_amount, 0)) filter (where fp.status = 'paid') as total_paid,
      sum(coalesce(rp.total_recovered, 0) + coalesce(rp.total_settled, 0)) as total_recovered,
      sum(
        case
          when rp.id is not null then rp.outstanding_amount
          when fp.status = 'paid' then coalesce(fp.payment_amount, 0)
          else 0
        end
      ) as total_outstanding,
      bool_or(ar.status in (
        'manager_pending', 'boss_pending', 'hr_pending', 'hr_on_hold', 'hr_sent_back',
        'finance_pending', 'finance_processing', 'finance_on_hold'
      )) as has_pending,
      bool_and(ar.status = 'closed') as all_closed
    from public.advance_requests ar
    left join public.advance_finance_payments fp on fp.advance_request_id = ar.id
    left join public.advance_recovery_plans rp on rp.advance_request_id = ar.id
    where ar.company_id = v_company_id
    group by ar.employee_id
  )
  select
    e.id,
    e.employee_code,
    e.full_name,
    e.mobile,
    e.email,
    e.store_id,
    st.name,
    sd.name,
    sdz.title,
    coalesce(a.advance_count, 0),
    coalesce(a.total_approved, 0),
    coalesce(a.total_paid, 0),
    coalesce(a.total_recovered, 0),
    coalesce(a.total_outstanding, 0),
    case
      when a.emp_id is null then 'no_advance'
      when a.has_pending then 'pending'
      when coalesce(a.total_paid, 0) = 0 then 'closed'
      when coalesce(a.total_outstanding, 0) = 0 then (case when a.all_closed then 'closed' else 'fully_recovered' end)
      when coalesce(a.total_recovered, 0) = 0 then 'active'
      else 'partially_recovered'
    end
  from public.employees e
  left join agg a on a.emp_id = e.id
  left join public.stores st on st.id = e.store_id
  left join public.store_departments sd on sd.id = e.store_department_id
  left join public.store_designations sdz on sdz.id = e.store_designation_id
  where e.company_id = v_company_id
    and (v_effective_store is null or e.store_id = v_effective_store)
    and (p_department_id is null or e.store_department_id = p_department_id)
    and (p_designation_id is null or e.store_designation_id = p_designation_id)
    and (p_employee_id is null or e.id = p_employee_id)
    and (p_show_all or a.emp_id is not null)
    and (
      p_search is null or p_search = '' or
      e.full_name ilike '%' || p_search || '%' or
      e.employee_code ilike '%' || p_search || '%' or
      e.mobile ilike '%' || p_search || '%' or
      e.email ilike '%' || p_search || '%'
    )
    and (
      p_status is null or exists (
        select 1 from public.advance_requests ar2
        where ar2.employee_id = e.id and ar2.company_id = v_company_id and ar2.status = p_status
      )
    )
    and (
      (p_date_from is null and p_date_to is null) or exists (
        select 1 from public.advance_requests ar3
        where ar3.employee_id = e.id and ar3.company_id = v_company_id
          and (p_date_from is null or ar3.requested_at::date >= p_date_from)
          and (p_date_to is null or ar3.requested_at::date <= p_date_to)
      )
    );
end;
$$;
revoke execute on function public.advance_ledger_rows(uuid, uuid, uuid, uuid, text, text, date, date, boolean) from public, authenticated;

create or replace function public.advance_ledger_employee_advances(p_employee_id uuid)
returns table (
  advance_request_id uuid,
  advance_type_name text,
  request_date timestamptz,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  actual_paid_amount numeric,
  payment_date date,
  recovery_start_date date,
  total_recovered numeric,
  outstanding_amount numeric,
  status text
)
language plpgsql
stable
security definer
as $$
declare
  v_company_id uuid := public.current_user_company_id();
  v_store_scope uuid := public.current_user_store_id();
  v_emp record;
begin
  if coalesce(public.current_user_role() = 'staff', true) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select id, company_id, store_id into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null or coalesce(v_emp.company_id <> v_company_id, true) then
    raise exception 'Employee not found.';
  end if;
  if v_store_scope is not null and (v_emp.store_id is null or v_emp.store_id <> v_store_scope) then
    raise exception 'Not authorized for this employee''s store.' using errcode = '42501';
  end if;

  return query
  select
    ar.id,
    att.name,
    ar.requested_at,
    ar.requested_amount,
    ar.manager_recommended_amount,
    ar.boss_approved_amount,
    fp.payment_amount,
    fp.payment_date,
    rp.recovery_start_date,
    coalesce(rp.total_recovered, 0) + coalesce(rp.total_settled, 0),
    case
      when rp.id is not null then rp.outstanding_amount
      when fp.status = 'paid' then coalesce(fp.payment_amount, 0)
      else 0
    end,
    ar.status
  from public.advance_requests ar
  join public.advance_types att on att.id = ar.advance_type_id
  left join public.advance_finance_payments fp on fp.advance_request_id = ar.id
  left join public.advance_recovery_plans rp on rp.advance_request_id = ar.id
  where ar.employee_id = p_employee_id and ar.company_id = v_company_id
  order by ar.requested_at desc;
end;
$$;
grant execute on function public.advance_ledger_employee_advances(uuid) to authenticated;
