-- ============================================================================
-- Retail HRMS — Leave Management, Phase 5: Reporting RPCs
-- Migration 0123
--
-- Every RPC here reuses an EXISTING authoritative source — leave_applications
-- (already computed status/short_or_long/total_days), leave_get_balance()
-- (called per employee/type here, never reimplemented), leave_resolve_eligibility()
-- (same probation/eligibility resolver leave_apply() itself uses), and
-- audit_logs (the ONE existing generic audit table, already Super-Admin-only
-- via its own pre-existing RLS policy — reused as-is, no new audit
-- mechanism). Aggregation (by Store/Department/Month) happens in the
-- frontend from these same authoritative rows — grouping/summing already-
-- correct numbers is not a second calculation engine.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- leave_report_applications(): the one rich listing that powers Short Leave,
-- Long Leave, Pending, Approval/Rejection, Monthly, Store-wise, and
-- Department-wise reports — each is a different filter/group-by over this
-- SAME set of rows, never a different query per report.
-- ----------------------------------------------------------------------------
create or replace function public.leave_report_applications(p_from_date date default null, p_to_date date default null)
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  store_id uuid,
  store_name text,
  department_id uuid,
  department_name text,
  leave_type_id uuid,
  leave_type_name text,
  financial_year_id uuid,
  from_date date,
  to_date date,
  total_days numeric,
  is_half_day boolean,
  short_or_long text,
  status text,
  applied_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_remark text,
  pending_with text
)
language sql
stable
security definer
as $$
  select
    a.id, a.employee_id, e.full_name, e.employee_code,
    e.store_id, s.name, e.store_department_id, sd.name,
    a.leave_type_id, lt.name, a.financial_year_id,
    a.from_date, a.to_date, a.total_days, a.is_half_day, a.short_or_long, a.status, a.applied_at,
    a.decided_by, a.decided_at, a.decision_remark,
    case a.status
      when 'manager_pending' then 'Direct Manager'
      when 'super_manager_pending' then 'Super Manager'
      else null
    end as pending_with
  from public.leave_applications a
  join public.employees e on e.id = a.employee_id
  left join public.stores s on s.id = e.store_id
  left join public.store_departments sd on sd.id = e.store_department_id
  join public.leave_types lt on lt.id = a.leave_type_id
  where (p_from_date is null or a.from_date >= p_from_date)
    and (p_to_date is null or a.to_date <= p_to_date)
    and (
      is_super_admin()
      or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
      or (current_user_role() = 'staff' and a.employee_id = current_user_employee_id())
      or (current_user_role() = 'staff' and public.leave_resolve_direct_manager(a.employee_id) = current_user_employee_id())
      or (current_user_role() = 'staff' and exists (
        select 1 from public.attendance_super_managers sm where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = a.company_id
      ))
    )
  order by a.applied_at desc;
$$;

grant execute on function public.leave_report_applications(date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- leave_report_balances(): batches leave_get_balance() across every
-- employee/leave-type combination for a Financial Year — never a second
-- balance formula, just the SAME function called once per row.
-- ----------------------------------------------------------------------------
create or replace function public.leave_report_balances(p_financial_year_id uuid)
returns table (
  employee_id uuid,
  employee_name text,
  employee_code text,
  leave_type_id uuid,
  leave_type_name text,
  earned numeric,
  used numeric,
  pending numeric,
  available numeric
)
language plpgsql
stable
security definer
as $$
declare
  v_fy record;
  v_emp record;
  v_lt record;
  v_bal record;
begin
  if not (is_super_admin() or current_user_role() <> 'staff') then
    raise exception 'Only Admin/HR may view company-wide Leave Balance reports.' using errcode = '42501';
  end if;

  select company_id into v_fy from public.leave_financial_years where id = p_financial_year_id;
  if v_fy.company_id is null then
    raise exception 'Financial Year not found.';
  end if;
  if not is_super_admin() and v_fy.company_id <> current_user_company_id() then
    raise exception 'This Financial Year belongs to a different company.' using errcode = '42501';
  end if;

  for v_emp in select e.id, e.full_name, e.employee_code from public.employees e where e.company_id = v_fy.company_id and e.status = 'active' loop
    for v_lt in select lt.id, lt.name from public.leave_types lt where lt.company_id = v_fy.company_id and lt.is_active loop
      select * into v_bal from public.leave_get_balance(v_emp.id, v_lt.id, p_financial_year_id);
      if v_bal.earned <> 0 or v_bal.used <> 0 or v_bal.pending <> 0 or v_bal.available <> 0 then
        employee_id := v_emp.id; employee_name := v_emp.full_name; employee_code := v_emp.employee_code;
        leave_type_id := v_lt.id; leave_type_name := v_lt.name;
        earned := v_bal.earned; used := v_bal.used; pending := v_bal.pending; available := v_bal.available;
        return next;
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.leave_report_balances(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- leave_report_probation(): reuses leave_resolve_eligibility() — the EXACT
-- same resolver leave_apply() itself calls — never a second probation
-- calculation.
-- ----------------------------------------------------------------------------
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
    select duration_value, duration_unit, post_probation_start_rule into v_prob from public.leave_probation_rules where policy_id = v_policy_id;
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

-- ----------------------------------------------------------------------------
-- leave_list_fy_closing_batches_for_company(): every batch (any status) for
-- the Encashment/Lapse/FY-Closing reports to pick from — reuses the SAME
-- leave_fy_closing_batches table Phase 4 built, never a new one.
-- ----------------------------------------------------------------------------
create or replace function public.leave_list_fy_closing_batches_for_company(p_company_id uuid)
returns setof public.leave_fy_closing_batches
language sql
stable
security definer
as $$
  select * from public.leave_fy_closing_batches
  where company_id = p_company_id and (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()))
  order by initiated_at desc;
$$;

grant execute on function public.leave_list_fy_closing_batches_for_company(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Policy Change / Leave Audit reports — reuse the ONE existing generic
-- audit_logs table verbatim. Its own pre-existing RLS ("audit_logs_select_super_admin")
-- already restricts SELECT to Super Admin only — these RPCs re-enforce the
-- same gate explicitly rather than relying solely on the base table's RLS,
-- since SECURITY DEFINER functions execute with elevated privilege and
-- bypass RLS internally.
-- ----------------------------------------------------------------------------
create or replace function public.leave_report_policy_changes(p_company_id uuid)
returns table (
  policy_id uuid,
  policy_name text,
  version_number int,
  previous_version_id uuid,
  status text,
  change_reason text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz,
  audit_action text,
  audit_changed_data jsonb,
  audit_performed_by uuid,
  audit_performed_at timestamptz
)
language sql
stable
security definer
as $$
  select p.id, p.name, p.version_number, p.previous_version_id, p.status, p.change_reason, p.approved_by, p.approved_at, p.created_at,
    al.action::text, al.changed_data, al.performed_by, al.performed_at
  from public.leave_policies p
  left join public.audit_logs al on al.table_name = 'leave_policies' and al.record_id = p.id
  where p.company_id = p_company_id and is_super_admin()
  order by p.created_at desc, al.performed_at desc;
$$;

create or replace function public.leave_report_audit(p_company_id uuid, p_from_date timestamptz default null, p_to_date timestamptz default null)
returns table (
  id uuid,
  table_name text,
  record_id uuid,
  action text,
  changed_data jsonb,
  performed_by uuid,
  performed_at timestamptz
)
language sql
stable
security definer
as $$
  select al.id, al.table_name, al.record_id, al.action::text, al.changed_data, al.performed_by, al.performed_at
  from public.audit_logs al
  where is_super_admin()
    and al.table_name like 'leave\_%' escape '\'
    and (p_from_date is null or al.performed_at >= p_from_date)
    and (p_to_date is null or al.performed_at <= p_to_date)
  order by al.performed_at desc
  limit 2000;
$$;

grant execute on function public.leave_report_policy_changes(uuid) to authenticated;
grant execute on function public.leave_report_audit(uuid, timestamptz, timestamptz) to authenticated;
