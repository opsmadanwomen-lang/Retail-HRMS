-- ============================================================================
-- Retail HRMS — Leave Management: Financial Year becomes Staff-readable +
-- Staff Apply-Leave helper RPCs
-- Migration 0125
--
-- ROOT CAUSE (Staff Panel -> /leave shows "No active Financial Year" and no
-- Apply Leave form): migration 0088's leave_financial_years RLS SELECT policy
-- is `is_super_admin() or (current_user_role() <> 'staff' and company_id =
-- current_user_company_id())` — Staff are EXCLUDED. StaffLeavePage.tsx gates
-- the entire Apply Leave form on a client-side read of leave_financial_years
-- (useLeaveFinancialYears -> select * from leave_financial_years), which RLS
-- returns as an empty set for every Staff user, so `activeFy` is always
-- undefined and the warning always shows — regardless of whether an active
-- Financial Year actually exists. The Leave Policy Engine itself is fine:
-- leave_apply() is SECURITY DEFINER and resolves the active FY internally, so
-- the backend was never the blocker.
--
-- This is the SAME class of gap migration 0099 fixed for leave_types ("Phase
-- 1 deliberately excluded Staff from SELECT ... Apply Leave needs it") — the
-- Financial Year table was simply overlooked. Fix mirrors 0099 exactly:
-- widen SELECT to any authenticated user in the same company (read only),
-- write policies untouched (Super-Admin only). A Financial Year row is a
-- label + date range + status — nothing sensitive; Staff already see the
-- equivalent Shift / Weekly-Off / Attendance-Rule configuration.
--
-- Purely additive: no table touched, no column changed, no data inserted, no
-- existing function replaced with different behaviour. Three new SECURITY
-- DEFINER helper functions (get-active-FY, preview-total-days, activate-FY)
-- reuse the EXISTING engine (current_user_employee_id,
-- leave_resolve_policy_assignment, leave_compute_total_days, is_super_admin) —
-- no business rule is re-implemented here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Staff-readable Financial Year (own company only). Mirrors 0099.
-- ----------------------------------------------------------------------------
drop policy if exists "leave_financial_years_select_scoped" on public.leave_financial_years;
create policy "leave_financial_years_select_scoped" on public.leave_financial_years for select
  using (is_super_admin() or company_id = current_user_company_id());

-- ----------------------------------------------------------------------------
-- 2. leave_get_active_financial_year(): the ONE authoritative active FY for
--    the caller's company — the same row leave_apply() resolves internally
--    (company_id + status='active'; the unique index
--    uidx_leave_financial_years_one_active guarantees at most one). Returned
--    to the Staff UI so it can show "Current Financial Year: <label>" and
--    stop gating the form on a table read. SECURITY DEFINER so it is
--    unaffected by table RLS, but it only ever exposes the caller's own
--    company's row.
-- ----------------------------------------------------------------------------
create or replace function public.leave_get_active_financial_year()
returns public.leave_financial_years
language plpgsql
stable
security definer
as $$
declare
  v_company_id uuid := public.current_user_company_id();
  v_fy public.leave_financial_years%rowtype;
begin
  if v_company_id is null then
    return null;
  end if;
  select * into v_fy
  from public.leave_financial_years
  where company_id = v_company_id and status = 'active'
  limit 1;
  return v_fy; -- NULL row when no active FY is configured
end;
$$;

grant execute on function public.leave_get_active_financial_year() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. leave_preview_total_days(): the "Leave Duration [automatically
--    calculated]" value for the Apply Leave form. Resolves the caller's
--    employee -> assigned policy -> policy_type_config EXACTLY as leave_apply()
--    does, then returns leave_compute_total_days() verbatim. No day-count,
--    weekly-off/holiday, half-day, or sandwich rule is re-implemented here —
--    it is the same authoritative function leave_apply() calls. Returns NULL
--    when the type/policy is not resolvable (the UI then shows nothing rather
--    than a misleading 0). Read-only.
-- ----------------------------------------------------------------------------
create or replace function public.leave_preview_total_days(
  p_leave_type_id uuid,
  p_from_date date,
  p_to_date date,
  p_is_half_day boolean default false
)
returns numeric
language plpgsql
stable
security definer
as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
  v_employee record;
  v_policy_id uuid;
  v_config_id uuid;
begin
  if v_employee_id is null or p_leave_type_id is null or p_from_date is null or p_to_date is null then
    return null;
  end if;
  if p_to_date < p_from_date then
    return null;
  end if;

  select id, company_id into v_employee from public.employees where id = v_employee_id;
  if v_employee.id is null then
    return null;
  end if;

  v_policy_id := public.leave_resolve_policy_assignment(v_employee.company_id, v_employee_id, p_from_date);
  if v_policy_id is null then
    return null;
  end if;

  select c.id into v_config_id
  from public.leave_policy_type_configs c
  where c.policy_id = v_policy_id and c.leave_type_id = p_leave_type_id;
  if v_config_id is null then
    return null;
  end if;

  return public.leave_compute_total_days(v_employee_id, v_config_id, p_from_date, p_to_date, coalesce(p_is_half_day, false));
end;
$$;

grant execute on function public.leave_preview_total_days(uuid, date, date, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. leave_activate_financial_year(): the missing Admin "Activate" action.
--    The Financial Years tab could only set status at CREATE time; an existing
--    'draft' FY had no way to become 'active' from the UI, and a raw
--    `update status='active'` collides with uidx_leave_financial_years_one_active
--    when another FY is already active. This atomically demotes the company's
--    current active FY (if any) to 'draft' and promotes the target — the same
--    "activating one deactivates the other" behaviour the Leave *Policy*
--    version tab already has. Super-Admin only (matches
--    leave_financial_years_update_scoped). No new FY is ever created.
-- ----------------------------------------------------------------------------
create or replace function public.leave_activate_financial_year(p_financial_year_id uuid)
returns public.leave_financial_years
language plpgsql
security definer
as $$
declare
  v_target public.leave_financial_years%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin may activate a Financial Year.' using errcode = '42501';
  end if;

  select * into v_target from public.leave_financial_years where id = p_financial_year_id;
  if v_target.id is null then
    raise exception 'Financial Year not found.';
  end if;

  update public.leave_financial_years
    set status = 'draft', updated_by = auth.uid()
    where company_id = v_target.company_id and status = 'active' and id <> p_financial_year_id;

  update public.leave_financial_years
    set status = 'active', updated_by = auth.uid()
    where id = p_financial_year_id
    returning * into v_target;

  return v_target;
end;
$$;

grant execute on function public.leave_activate_financial_year(uuid) to authenticated;
