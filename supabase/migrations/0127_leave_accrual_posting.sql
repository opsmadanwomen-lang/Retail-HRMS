-- ============================================================================
-- Retail HRMS — Leave Management: production monthly-accrual posting
-- Migration 0127
--
-- CONTEXT: the Leave Policy Engine (migrations 0091/0092) computes monthly
-- entitlement from leave_accrual_periods via leave_compute_month_entitlement()
-- and projects it month-by-month via leave_preview_calculation() (which also
-- applies probation, joining date, eligibility-start rule, pro-rata and
-- full-entitlement). Nothing has ever WRITTEN that entitlement into
-- leave_ledger, so leave_get_balance() always returns 0 and a real
-- leave_apply() fails on "Insufficient leave balance".
--
-- This migration adds the missing posting step. It does NOT introduce a new
-- calculation: leave_accrual_run() calls the EXISTING
-- leave_preview_calculation() and simply materialises each month's
-- `monthly_entitlement` as a `transaction_type = 'accrual'` row in the
-- authoritative leave_ledger (the value leave_get_balance() already counts
-- toward Earned — see migration 0101). No parallel balance table. No new
-- audit mechanism (leave_ledger's existing write_audit_log() trigger fires on
-- every inserted row). Additive only — no existing function or table
-- structure is changed.
--
-- IDEMPOTENCY: a partial unique index makes at most ONE accrual row exist per
-- (employee, leave type, financial year, month). The run uses
-- `on conflict do nothing`, so re-running the same period is a safe no-op —
-- enforced at the database level, not just by the caller.
-- ============================================================================

-- One accrual posting per employee/type/FY/month. `transaction_date` is always
-- the first day of the accrual month. Safe to add: nothing has ever written a
-- 'accrual' row (verified — the only references to that transaction_type are
-- the balance-sum SELECTs in leave_get_balance()).
create unique index if not exists idx_leave_ledger_one_accrual_per_month
  on public.leave_ledger (employee_id, leave_type_id, financial_year_id, transaction_date)
  where transaction_type = 'accrual';

-- ----------------------------------------------------------------------------
-- leave_accrual_run(): dry-run (preview) or commit. One row per employee whose
-- resolved policy for this Financial Year is p_policy_id.
--   p_up_to_month : accrue every FY month from FY start up to and including the
--                   month this date falls in. NULL = the current month
--                   (clamped to the FY window).
--   p_dry_run     : true  -> compute only, write nothing (powers the preview)
--                   false -> insert the accrual ledger rows
-- Reuses leave_preview_calculation() verbatim for eligibility + amount; never
-- re-derives probation / pro-rata / accrual-period logic here.
-- ----------------------------------------------------------------------------
create or replace function public.leave_accrual_run(
  p_financial_year_id uuid,
  p_policy_id uuid,
  p_leave_type_id uuid,
  p_up_to_month date default null,
  p_dry_run boolean default true
)
returns table (
  employee_id uuid,
  employee_name text,
  employee_code text,
  eligible boolean,
  entitlement_days numeric,
  already_posted_days numeric,
  to_post_days numeric,
  to_post_months int,
  posted boolean
)
language plpgsql
security definer
as $$
-- This function's RETURNS TABLE output params (employee_id, ...) share names with
-- leave_ledger columns; prefer the column in any ambiguous SQL reference.
#variable_conflict use_column
declare
  v_fy record;
  v_policy record;
  v_type record;
  v_up_to date;
  v_emp record;
  v_row record;
  v_month date;
  v_entitlement numeric;
  v_already numeric;
  v_to_post numeric;
  v_to_post_months int;
  v_any_eligible boolean;
  v_existing numeric;
begin
  -- Same authorisation gate as leave_confirm_fy_closing() (migration 0113).
  if not (public.is_super_admin() or public.current_user_role() <> 'staff') then
    raise exception 'Only Admin/HR may post Leave accrual.' using errcode = '42501';
  end if;

  select id, company_id, start_date, end_date, status into v_fy
  from public.leave_financial_years where id = p_financial_year_id;
  if v_fy.id is null then
    raise exception 'Financial Year not found.';
  end if;
  if not public.is_super_admin() and v_fy.company_id <> public.current_user_company_id() then
    raise exception 'This Financial Year belongs to a different company.' using errcode = '42501';
  end if;

  select id, company_id, status into v_policy from public.leave_policies where id = p_policy_id;
  if v_policy.id is null or v_policy.company_id <> v_fy.company_id then
    raise exception 'Leave Policy not found for this company.';
  end if;

  select id, company_id, is_active into v_type from public.leave_types where id = p_leave_type_id;
  if v_type.id is null or v_type.company_id <> v_fy.company_id then
    raise exception 'Leave Type not found for this company.';
  end if;

  -- Resolve the "post up to" month and clamp it to the FY window.
  v_up_to := date_trunc('month', coalesce(p_up_to_month, current_date))::date;
  if v_up_to < date_trunc('month', v_fy.start_date)::date then
    v_up_to := date_trunc('month', v_fy.start_date)::date;
  end if;
  if v_up_to > date_trunc('month', v_fy.end_date)::date then
    v_up_to := date_trunc('month', v_fy.end_date)::date;
  end if;

  for v_emp in
    select e.id, e.full_name, e.employee_code
    from public.employees e
    where e.company_id = v_fy.company_id
      and e.status = 'active'
      and public.leave_resolve_policy_assignment(v_fy.company_id, e.id, v_fy.start_date) = p_policy_id
    order by e.full_name
  loop
    v_entitlement := 0;
    v_already := 0;
    v_to_post := 0;
    v_to_post_months := 0;
    v_any_eligible := false;

    for v_row in
      select month_start, is_eligible, monthly_entitlement
      from public.leave_preview_calculation(v_emp.id, p_leave_type_id, p_financial_year_id)
      where month_start <= v_up_to
    loop
      if v_row.is_eligible then
        v_any_eligible := true;
      end if;
      if coalesce(v_row.monthly_entitlement, 0) > 0 then
        v_month := date_trunc('month', v_row.month_start)::date;
        v_entitlement := v_entitlement + v_row.monthly_entitlement;

        -- Table aliased + columns qualified: the RETURNS TABLE output params
        -- (employee_id, ...) would otherwise be ambiguous against the table columns.
        select l.days into v_existing
        from public.leave_ledger l
        where l.employee_id = v_emp.id and l.leave_type_id = p_leave_type_id
          and l.financial_year_id = p_financial_year_id
          and l.transaction_type = 'accrual' and l.transaction_date = v_month;

        if v_existing is not null then
          v_already := v_already + v_existing;
        else
          v_to_post := v_to_post + v_row.monthly_entitlement;
          v_to_post_months := v_to_post_months + 1;

          if not p_dry_run then
            -- The existence check above already prevents an in-run duplicate; the
            -- partial unique index idx_leave_ledger_one_accrual_per_month is the
            -- hard, database-level guarantee (a concurrent double-run raises 23505
            -- and this whole single-transaction call rolls back — no partial post).
            insert into public.leave_ledger (
              company_id, employee_id, leave_type_id, financial_year_id,
              transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by
            ) values (
              v_fy.company_id, v_emp.id, p_leave_type_id, p_financial_year_id,
              'accrual', v_month, v_row.monthly_entitlement, 'leave_accrual_run', p_financial_year_id,
              format('Monthly accrual — %s %s', to_char(v_month, 'Mon'), to_char(v_month, 'YYYY')),
              auth.uid()
            );
          end if;
        end if;
      end if;
    end loop;

    employee_id := v_emp.id;
    employee_name := v_emp.full_name;
    employee_code := v_emp.employee_code;
    eligible := v_any_eligible;
    entitlement_days := v_entitlement;
    already_posted_days := v_already;
    to_post_days := v_to_post;
    to_post_months := v_to_post_months;
    posted := (not p_dry_run) and v_to_post_months > 0;
    return next;
  end loop;
end;
$$;

grant execute on function public.leave_accrual_run(uuid, uuid, uuid, date, boolean) to authenticated;
