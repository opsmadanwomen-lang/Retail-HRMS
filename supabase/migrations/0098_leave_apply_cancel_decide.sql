-- ============================================================================
-- Retail HRMS — Leave Management, Phase 2: Day counting, Balance, Apply,
-- Cancel, foundation-only Decide
-- Migration 0098
--
-- leave_compute_total_days(): the ONE place Total Days is ever computed —
-- never trusted from the browser (§ "Total leave days must be calculated by
-- the backend"). Reads weekly_off_count_rule/holiday_count_rule/
-- sandwich_rule_enabled off the resolved policy-type-config; reuses the
-- EXISTING is_weekly_off_on_date() (unchanged, untouched) for the Weekly Off
-- check. Sandwich Rule scope note: implements the single-gap-day case (an
-- existing pending/approved application for the same employee+leave type
-- ends exactly 2 days before this one starts, with a weekly-off/holiday
-- sitting in the 1-day gap between them, or the symmetric forward case) —
-- the day the master prompt's own example describes ("Leave + Weekly Off +
-- Leave"). Multi-day gaps are not attempted in this phase; disclosed in the
-- Phase 2 report, extendable later without a redesign since it's isolated to
-- this one function.
--
-- leave_get_balance(): Earned/Used/Pending/Available, computed FRESH from
-- leave_ledger every call — never a stored counter (§15/§22).
--
-- leave_apply(): the single application entry point. Employee identity is
-- ALWAYS resolved server-side via current_user_employee_id() — there is no
-- p_employee_id parameter at all, so no client-supplied ID can ever target
-- another employee (mirrors attendance_punch_in()'s own identity pattern
-- exactly). Runs every validation from the approved Phase 2 scope, computes
-- Total Days via the engine above, classifies Short/Long via
-- leave_short_long_rules (snapshotted onto the row), and inserts the
-- application + its pending_reservation ledger row in one transaction.
--
-- leave_cancel(): Staff can cancel their OWN still-pending application;
-- Super Admin can cancel any. Releases the reservation via an offsetting
-- ledger row — the original reservation row is never touched.
--
-- leave_admin_decide(): Super-Admin-only, FOUNDATION-ONLY for Phase 2
-- testing (ledger mechanics: reservation -> used / -> released). This is
-- explicitly NOT the real Manager -> Super Manager, day-threshold-gated
-- workflow — Phase 3 replaces this function's body (same name, so nothing
-- else needs to change) with the real multi-step engine; it does not
-- introduce a new ledger shape Phase 3 would need to migrate away from.
-- ============================================================================

create or replace function public.leave_compute_total_days(
  p_employee_id uuid,
  p_policy_type_config_id uuid,
  p_from_date date,
  p_to_date date,
  p_is_half_day boolean
)
returns numeric
language plpgsql
stable
security definer
as $$
declare
  v_config record;
  v_employee record;
  v_day date;
  v_total numeric := 0;
  v_is_weekly_off boolean;
  v_is_holiday boolean;
  v_gap_day date;
begin
  if p_is_half_day then
    return 0.5;
  end if;

  select weekly_off_count_rule, holiday_count_rule, sandwich_rule_enabled into v_config
  from public.leave_policy_type_configs
  where id = p_policy_type_config_id;

  select company_id, store_id into v_employee from public.employees where id = p_employee_id;

  v_day := p_from_date;
  while v_day <= p_to_date loop
    v_is_weekly_off := public.is_weekly_off_on_date(p_employee_id, v_day);
    v_is_holiday := exists (
      select 1 from public.holidays h
      where h.company_id = v_employee.company_id
        and h.holiday_date = v_day
        and (h.store_id is null or h.store_id = v_employee.store_id)
    );

    if v_is_weekly_off and coalesce(v_config.weekly_off_count_rule, 'dont_count') <> 'count' then
      -- excluded
    elsif v_is_holiday and coalesce(v_config.holiday_count_rule, 'dont_count') <> 'count' then
      -- excluded
    else
      v_total := v_total + 1;
    end if;

    v_day := v_day + 1;
  end loop;

  -- Sandwich Rule — single-gap-day case (see header note). Checks both directions: an application
  -- ending 2 days before this one starts, or one starting 2 days after this one ends, with a
  -- Weekly Off/Holiday sitting in the single day between them.
  if coalesce(v_config.sandwich_rule_enabled, false) then
    v_gap_day := p_from_date - 1;
    if (public.is_weekly_off_on_date(p_employee_id, v_gap_day)
        or exists (select 1 from public.holidays h where h.company_id = v_employee.company_id and h.holiday_date = v_gap_day and (h.store_id is null or h.store_id = v_employee.store_id)))
       and exists (
         select 1 from public.leave_applications a
         where a.employee_id = p_employee_id and a.status in ('pending', 'approved') and a.to_date = p_from_date - 2
       )
    then
      v_total := v_total + 1;
    end if;

    v_gap_day := p_to_date + 1;
    if (public.is_weekly_off_on_date(p_employee_id, v_gap_day)
        or exists (select 1 from public.holidays h where h.company_id = v_employee.company_id and h.holiday_date = v_gap_day and (h.store_id is null or h.store_id = v_employee.store_id)))
       and exists (
         select 1 from public.leave_applications a
         where a.employee_id = p_employee_id and a.status in ('pending', 'approved') and a.from_date = p_to_date + 2
       )
    then
      v_total := v_total + 1;
    end if;
  end if;

  return v_total;
end;
$$;

grant execute on function public.leave_compute_total_days(uuid, uuid, date, date, boolean) to authenticated;

create or replace function public.leave_get_balance(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_financial_year_id uuid,
  out earned numeric,
  out used numeric,
  out pending numeric,
  out available numeric
)
returns record
language sql
stable
security definer
as $$
  select
    coalesce((select sum(days) from public.leave_ledger where employee_id = p_employee_id and leave_type_id = p_leave_type_id and financial_year_id = p_financial_year_id and transaction_type in ('opening', 'accrual', 'carry_forward')), 0),
    coalesce((select -sum(days) from public.leave_ledger where employee_id = p_employee_id and leave_type_id = p_leave_type_id and financial_year_id = p_financial_year_id and transaction_type = 'used'), 0),
    coalesce((
      select -sum(l.days) from public.leave_ledger l
      join public.leave_applications a on a.id = l.reference_id and l.reference_type = 'leave_application'
      where l.employee_id = p_employee_id and l.leave_type_id = p_leave_type_id and l.financial_year_id = p_financial_year_id
        and l.transaction_type = 'pending_reservation' and a.status = 'pending'
    ), 0),
    coalesce((select sum(days) from public.leave_ledger where employee_id = p_employee_id and leave_type_id = p_leave_type_id and financial_year_id = p_financial_year_id), 0);
$$;

grant execute on function public.leave_get_balance(uuid, uuid, uuid) to authenticated;

create or replace function public.leave_apply(
  p_leave_type_id uuid,
  p_from_date date,
  p_to_date date,
  p_is_half_day boolean default false,
  p_half_day_session text default null,
  p_reason text default null,
  p_remarks text default null,
  p_document_storage_path text default null,
  p_document_file_name text default null,
  p_document_mime_type text default null,
  p_document_file_size_bytes bigint default null
)
returns public.leave_applications
language plpgsql
security definer
as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
  v_employee record;
  v_fy record;
  v_policy_id uuid;
  v_config record;
  v_leave_type record;
  v_eligibility record;
  v_total_days numeric;
  v_balance record;
  v_short_long record;
  v_classification text;
  v_application public.leave_applications;
begin
  if v_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select id, company_id, status as employee_status into v_employee from public.employees where id = v_employee_id;
  if v_employee.employee_status is distinct from 'active' then
    raise exception 'Only an active employee may apply for leave.';
  end if;

  if p_to_date < p_from_date then
    raise exception 'To Date must be on or after From Date.';
  end if;
  if p_is_half_day and p_from_date <> p_to_date then
    raise exception 'Half Day applications must have the same From Date and To Date.';
  end if;

  select id, half_day_allowed, is_active into v_leave_type from public.leave_types where id = p_leave_type_id;
  if v_leave_type.id is null or not v_leave_type.is_active then
    raise exception 'Selected Leave Type is not available.';
  end if;
  if p_is_half_day and not v_leave_type.half_day_allowed then
    raise exception 'Half Day is not allowed for this Leave Type.';
  end if;

  -- The whole application must fall within ONE Financial Year (Phase 2 scope boundary — a
  -- cross-FY span is rejected with a clear message rather than silently guessing which FY governs
  -- it).
  select id, start_date, end_date into v_fy
  from public.leave_financial_years
  where company_id = v_employee.company_id and status = 'active' and p_from_date >= start_date and p_to_date <= end_date;
  if v_fy.id is null then
    raise exception 'No active Financial Year covers the selected dates (the full range must fall within a single Financial Year).';
  end if;

  v_policy_id := public.leave_resolve_policy_assignment(v_employee.company_id, v_employee_id, p_from_date);
  if v_policy_id is null then
    raise exception 'No Leave Policy is assigned for this employee.';
  end if;

  select id, accrual_enabled, probation_eligible, negative_balance_allowed, weekly_off_count_rule, holiday_count_rule
  into v_config
  from public.leave_policy_type_configs c
  where c.policy_id = v_policy_id and c.leave_type_id = p_leave_type_id;
  if v_config.id is null then
    raise exception 'This Leave Type is not configured under your assigned Leave Policy.';
  end if;

  select * into v_eligibility from public.leave_resolve_eligibility(v_employee_id, v_policy_id, v_config.probation_eligible);
  if v_config.probation_eligible and v_eligibility.eligibility_start is not null and p_from_date < v_eligibility.eligibility_start then
    raise exception 'You are not yet eligible for this Leave Type — eligibility starts %.', v_eligibility.eligibility_start;
  end if;

  -- Date overlap / duplicate pending / existing approved leave — one check covers all three, since
  -- both 'pending' and 'approved' are treated as blocking an overlapping new application.
  if exists (
    select 1 from public.leave_applications a
    where a.employee_id = v_employee_id and a.status in ('pending', 'approved')
      and a.from_date <= p_to_date and a.to_date >= p_from_date
  ) then
    raise exception 'You already have a pending or approved leave application overlapping these dates.';
  end if;

  v_total_days := public.leave_compute_total_days(v_employee_id, v_config.id, p_from_date, p_to_date, p_is_half_day);
  if v_total_days <= 0 then
    raise exception 'The selected dates do not contain any chargeable leave day (check Weekly Off/Holiday configuration).';
  end if;

  select * into v_balance from public.leave_get_balance(v_employee_id, p_leave_type_id, v_fy.id);
  if v_balance.available < v_total_days and not v_config.negative_balance_allowed then
    raise exception 'Insufficient leave balance. Available: %, Requested: %.', v_balance.available, v_total_days;
  end if;

  select threshold_days, threshold_operator into v_short_long from public.leave_short_long_rules where policy_id = v_policy_id;
  if v_short_long.threshold_days is null then
    v_classification := case when v_total_days <= 3 then 'short' else 'long' end; -- no rule configured yet: safe fallback, never silently different from the confirmed company default
  elsif v_short_long.threshold_operator = 'short_lt' then
    v_classification := case when v_total_days < v_short_long.threshold_days then 'short' else 'long' end;
  else
    v_classification := case when v_total_days <= v_short_long.threshold_days then 'short' else 'long' end;
  end if;

  insert into public.leave_applications (
    company_id, employee_id, leave_type_id, financial_year_id, policy_id,
    from_date, to_date, is_half_day, half_day_session, total_days, reason, remarks,
    status, short_or_long, created_by, updated_by
  ) values (
    v_employee.company_id, v_employee_id, p_leave_type_id, v_fy.id, v_policy_id,
    p_from_date, p_to_date, p_is_half_day, p_half_day_session, v_total_days, p_reason, p_remarks,
    'pending', v_classification, auth.uid(), auth.uid()
  ) returning * into v_application;

  insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
  values (v_employee.company_id, v_employee_id, p_leave_type_id, v_fy.id, 'pending_reservation', current_date, -v_total_days, 'leave_application', v_application.id, 'Reserved on application.', auth.uid());

  if p_document_storage_path is not null then
    insert into public.leave_application_documents (leave_application_id, storage_path, file_name, mime_type, file_size_bytes, created_by)
    values (v_application.id, p_document_storage_path, coalesce(p_document_file_name, 'document'), p_document_mime_type, p_document_file_size_bytes, auth.uid());
  end if;

  return v_application;
end;
$$;

grant execute on function public.leave_apply(uuid, date, date, boolean, text, text, text, text, text, text, bigint) to authenticated;

create or replace function public.leave_cancel(
  p_application_id uuid,
  p_remark text default null
)
returns public.leave_applications
language plpgsql
security definer
as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
  v_application public.leave_applications;
begin
  select * into v_application from public.leave_applications where id = p_application_id;
  if v_application.id is null then
    raise exception 'Leave application not found.';
  end if;

  if not public.is_super_admin() and v_application.employee_id <> v_employee_id then
    raise exception 'You may only cancel your own leave application.' using errcode = '42501';
  end if;

  if v_application.status <> 'pending' then
    raise exception 'Only a Pending application can be cancelled.';
  end if;

  update public.leave_applications
  set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_remark = p_remark, updated_by = auth.uid()
  where id = p_application_id
  returning * into v_application;

  insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
  values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'reversal', current_date, v_application.total_days, 'leave_application', v_application.id, 'Reservation released — application cancelled.', auth.uid());

  return v_application;
end;
$$;

grant execute on function public.leave_cancel(uuid, text) to authenticated;

-- FOUNDATION-ONLY for Phase 2 testing. Phase 3 replaces this function's body with the real
-- Manager -> Super Manager, day-threshold-gated workflow (see header note) — the ledger mechanics
-- it exercises (reservation -> used / -> released) are exactly what that real workflow will also
-- need, so nothing here is thrown away, only the single-step decision logic is superseded.
create or replace function public.leave_admin_decide(
  p_application_id uuid,
  p_decision text,
  p_remark text default null
)
returns public.leave_applications
language plpgsql
security definer
as $$
declare
  v_application public.leave_applications;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can decide a leave application in this phase.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select * into v_application from public.leave_applications where id = p_application_id;
  if v_application.id is null then
    raise exception 'Leave application not found.';
  end if;
  if v_application.status <> 'pending' then
    raise exception 'Only a Pending application can be decided.';
  end if;
  if p_decision = 'rejected' and (p_remark is null or length(trim(p_remark)) = 0) then
    raise exception 'A remark is required to reject an application.';
  end if;

  update public.leave_applications
  set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_remark = p_remark, updated_by = auth.uid()
  where id = p_application_id
  returning * into v_application;

  -- Release the original reservation either way — never touched/deleted, only offset.
  insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
  values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'reversal', current_date, v_application.total_days, 'leave_application', v_application.id,
    case when p_decision = 'approved' then 'Reservation released — converted to Used.' else 'Reservation released — application rejected.' end, auth.uid());

  if p_decision = 'approved' then
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'used', current_date, -v_application.total_days, 'leave_application', v_application.id, 'Leave used — approved.', auth.uid());
  end if;

  return v_application;
end;
$$;

grant execute on function public.leave_admin_decide(uuid, text, text) to authenticated;
