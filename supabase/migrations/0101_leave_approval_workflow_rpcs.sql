-- ============================================================================
-- Retail HRMS — Leave Management, Phase 3: Approval workflow RPCs
-- Migration 0101
--
-- Replaces Phase 2's single-step 'pending' status with the FINAL approved
-- hierarchy:
--   1-3 days (short):  Staff -> Direct Manager -> FINAL (Manager decides)
--   4+ days  (long):   Staff -> Direct Manager (forward only, cannot finalize)
--                              -> Super Manager -> FINAL
--   Reject at either step -> REJECTED immediately (final).
--
-- The day threshold itself is NEVER hardcoded here — every branch below reads
-- v_application.short_or_long, which was classified once, at apply time, by
-- the EXISTING Phase 2 policy-driven leave_short_long_rules resolution
-- (leave_apply(), unchanged in this migration) and snapshotted onto the row.
-- Changing the threshold in leave_short_long_rules changes classification for
-- every NEW application immediately, with zero code change here.
--
-- leave_manager_decide() / leave_super_manager_decide() mirror the inspected
-- Night Duty decide RPCs' shape exactly (active-login check, server-resolved
-- identity, decision whitelist, fetch + expected-status guard, self-action
-- prevention, EXISTS-based authorization resolved from a real relationship,
-- atomic status-guarded UPDATE + GET DIAGNOSTICS race guard) — but write to
-- Leave's OWN leave_approval_actions table and leave_applications row, never
-- touching any Night Duty table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- leave_compute_total_days(): only the status list used by the Sandwich Rule's
-- "is there a bordering application" checks changes (was hard-tied to the old
-- single 'pending' status). The counting logic itself is untouched.
-- ----------------------------------------------------------------------------
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

  if coalesce(v_config.sandwich_rule_enabled, false) then
    v_gap_day := p_from_date - 1;
    if (public.is_weekly_off_on_date(p_employee_id, v_gap_day)
        or exists (select 1 from public.holidays h where h.company_id = v_employee.company_id and h.holiday_date = v_gap_day and (h.store_id is null or h.store_id = v_employee.store_id)))
       and exists (
         select 1 from public.leave_applications a
         where a.employee_id = p_employee_id and a.status in ('manager_pending', 'super_manager_pending', 'approved') and a.to_date = p_from_date - 2
       )
    then
      v_total := v_total + 1;
    end if;

    v_gap_day := p_to_date + 1;
    if (public.is_weekly_off_on_date(p_employee_id, v_gap_day)
        or exists (select 1 from public.holidays h where h.company_id = v_employee.company_id and h.holiday_date = v_gap_day and (h.store_id is null or h.store_id = v_employee.store_id)))
       and exists (
         select 1 from public.leave_applications a
         where a.employee_id = p_employee_id and a.status in ('manager_pending', 'super_manager_pending', 'approved') and a.from_date = p_to_date + 2
       )
    then
      v_total := v_total + 1;
    end if;
  end if;

  return v_total;
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_get_balance(): Pending bucket now spans BOTH awaiting-Manager and
-- awaiting-Super-Manager applications — an application reserved days from the
-- moment it is applied, and those days stay reserved for the entire time it
-- is anywhere in the approval chain, not just its first step.
-- ----------------------------------------------------------------------------
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
        and l.transaction_type = 'pending_reservation' and a.status in ('manager_pending', 'super_manager_pending')
    ), 0),
    coalesce((select sum(days) from public.leave_ledger where employee_id = p_employee_id and leave_type_id = p_leave_type_id and financial_year_id = p_financial_year_id), 0);
$$;

-- ----------------------------------------------------------------------------
-- leave_apply(): adds the Direct Manager pre-check (fail fast, before any row
-- is written, per "If an approver cannot be resolved: DO NOT silently
-- approve") and starts every new application at 'manager_pending' — the
-- Direct Manager is always step one, whether the leave later turns out to be
-- short or long is irrelevant to who reviews it first. Everything else
-- (day-counting, eligibility, balance, short/long snapshot) is untouched from
-- Phase 2.
-- ----------------------------------------------------------------------------
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
  v_direct_manager_id uuid;
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

  -- Approval workflow must be resolvable BEFORE the application is created — never accept an
  -- application that would have nobody able to act on it.
  v_direct_manager_id := public.leave_resolve_direct_manager(v_employee_id);
  if v_direct_manager_id is null then
    raise exception 'Leave approval workflow is not configured for this employee.';
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

  if exists (
    select 1 from public.leave_applications a
    where a.employee_id = v_employee_id and a.status in ('manager_pending', 'super_manager_pending', 'approved')
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
    v_classification := case when v_total_days <= 3 then 'short' else 'long' end;
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
    'manager_pending', v_classification, auth.uid(), auth.uid()
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

-- ----------------------------------------------------------------------------
-- leave_cancel(): a pending application now means "not yet finalized" — i.e.
-- sitting at either manager_pending or super_manager_pending — rather than
-- just the single old 'pending' state.
-- ----------------------------------------------------------------------------
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

  if v_application.status not in ('manager_pending', 'super_manager_pending') then
    raise exception 'Only an application still awaiting approval can be cancelled.';
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

-- ----------------------------------------------------------------------------
-- leave_admin_decide(): kept as a genuine Super-Admin EMERGENCY OVERRIDE
-- (exactly the same role Night Duty's own legacy super-admin decide RPC
-- plays alongside its OM/Super Manager hierarchy) — updated only so it
-- recognises both new pending states as decidable. It still finalizes
-- directly to approved/rejected in one step, bypassing the two-step chain —
-- that is the intended emergency-override behaviour, not a bug.
-- ----------------------------------------------------------------------------
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
    raise exception 'Only Super Admin can use this emergency override.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select * into v_application from public.leave_applications where id = p_application_id;
  if v_application.id is null then
    raise exception 'Leave application not found.';
  end if;
  if v_application.status not in ('manager_pending', 'super_manager_pending') then
    raise exception 'Only an application still awaiting approval can be decided.';
  end if;
  if p_decision = 'rejected' and (p_remark is null or length(trim(p_remark)) = 0) then
    raise exception 'A remark is required to reject an application.';
  end if;

  update public.leave_applications
  set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_remark = p_remark, updated_by = auth.uid()
  where id = p_application_id
  returning * into v_application;

  insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
  values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'reversal', current_date, v_application.total_days, 'leave_application', v_application.id,
    case when p_decision = 'approved' then 'Reservation released — converted to Used (Super Admin override).' else 'Reservation released — application rejected (Super Admin override).' end, auth.uid());

  if p_decision = 'approved' then
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'used', current_date, -v_application.total_days, 'leave_application', v_application.id, 'Leave used — approved (Super Admin override).', auth.uid());
  end if;

  return v_application;
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_manager_decide(): Step 1. Only the RESOLVED Direct Manager
-- (employees.reporting_manager_id, never a client-supplied ID) of the
-- applicant may act, and only while status = 'manager_pending' (enforced
-- atomically below — never trusts the frontend about which step is live).
--
--   Reject         -> REJECTED (final), reservation released, remark required.
--   Approve, short  -> APPROVED (final), reservation released + Used booked.
--   Approve, long   -> SUPER_MANAGER_PENDING (forward only — Manager is
--                      structurally incapable of finalizing long leave: the
--                      only two branches below for 'approved' are 'approved'
--                      itself, gated on short_or_long = 'short', or
--                      'super_manager_pending' otherwise. There is no code
--                      path that lets a long-leave approval reach 'approved'
--                      through this function).
-- ----------------------------------------------------------------------------
create or replace function public.leave_manager_decide(
  p_application_id uuid,
  p_decision text,
  p_remark text default null
)
returns public.leave_applications
language plpgsql
security definer
as $$
declare
  v_caller_employee_id uuid := public.current_user_employee_id();
  v_application public.leave_applications;
  v_resolved_manager_id uuid;
  v_new_status text;
  v_updated_rows int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;

  if v_caller_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision: must be approved or rejected.';
  end if;

  select * into v_application from public.leave_applications where id = p_application_id;
  if not found then
    raise exception 'Leave application not found.';
  end if;

  if v_application.status <> 'manager_pending' then
    raise exception 'This application is not pending with Direct Manager (current status: %).', v_application.status;
  end if;

  if v_application.employee_id = v_caller_employee_id then
    raise exception 'You cannot act on your own leave application.' using errcode = '42501';
  end if;

  -- Authorization resolved live from the employee's actual reporting relationship — never from a
  -- value supplied by the caller.
  v_resolved_manager_id := public.leave_resolve_direct_manager(v_application.employee_id);
  if v_resolved_manager_id is null or v_resolved_manager_id <> v_caller_employee_id then
    raise exception 'You are not the assigned Direct Manager for this employee.' using errcode = '42501';
  end if;

  if p_decision = 'rejected' and (p_remark is null or length(trim(p_remark)) = 0) then
    raise exception 'A remark is required to reject an application.';
  end if;

  if p_decision = 'rejected' then
    v_new_status := 'rejected';
  elsif v_application.short_or_long = 'short' then
    v_new_status := 'approved';
  else
    -- Long leave: Manager may only forward. Verify a Super Manager actually exists to receive it —
    -- never forward an application into a dead end with nobody authorized to finalize it.
    if not public.leave_active_super_manager_exists(v_application.company_id) then
      raise exception 'No active Super Manager is configured to finalize this leave application.';
    end if;
    v_new_status := 'super_manager_pending';
  end if;

  update public.leave_applications
  set status = v_new_status,
      updated_by = auth.uid(),
      decided_by = case when v_new_status in ('approved', 'rejected') then auth.uid() else decided_by end,
      decided_at = case when v_new_status in ('approved', 'rejected') then now() else decided_at end,
      decision_remark = coalesce(p_remark, decision_remark)
  where id = p_application_id and status = 'manager_pending'
  returning * into v_application;

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows = 0 then
    raise exception 'This application has already been decided or is no longer pending with Direct Manager.';
  end if;

  insert into public.leave_approval_actions (leave_application_id, step_order, approver_role, approver_employee_id, action, remark, acted_at)
  values (v_application.id, 1, 'direct_manager', v_caller_employee_id, p_decision, p_remark, now());

  if v_new_status = 'rejected' then
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'reversal', current_date, v_application.total_days, 'leave_application', v_application.id, 'Reservation released — rejected by Direct Manager.', auth.uid());
  elsif v_new_status = 'approved' then
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'reversal', current_date, v_application.total_days, 'leave_application', v_application.id, 'Reservation released — converted to Used (approved by Direct Manager).', auth.uid());
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'used', current_date, -v_application.total_days, 'leave_application', v_application.id, 'Leave used — approved by Direct Manager.', auth.uid());
  end if;
  -- v_new_status = 'super_manager_pending': no ledger action — the original reservation stands untouched.

  return v_application;
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_super_manager_decide(): Step 2, long leave only. ANY active Super
-- Manager for the applicant's company may act (first-come-first-served,
-- mirroring attendance_super_managers' exact existing authorization model —
-- no pre-assigned target). Always final: approved -> APPROVED, rejected ->
-- REJECTED.
-- ----------------------------------------------------------------------------
create or replace function public.leave_super_manager_decide(
  p_application_id uuid,
  p_decision text,
  p_remark text default null
)
returns public.leave_applications
language plpgsql
security definer
as $$
declare
  v_caller_employee_id uuid := public.current_user_employee_id();
  v_application public.leave_applications;
  v_updated_rows int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;

  if v_caller_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision: must be approved or rejected.';
  end if;

  select * into v_application from public.leave_applications where id = p_application_id;
  if not found then
    raise exception 'Leave application not found.';
  end if;

  if v_application.status <> 'super_manager_pending' then
    raise exception 'This application is not pending with Super Manager (current status: %).', v_application.status;
  end if;

  if v_application.employee_id = v_caller_employee_id then
    raise exception 'You cannot act on your own leave application.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.attendance_super_managers
    where employee_id = v_caller_employee_id and is_active and company_id = v_application.company_id
  ) then
    raise exception 'You are not an assigned Super Manager.' using errcode = '42501';
  end if;

  if p_decision = 'rejected' and (p_remark is null or length(trim(p_remark)) = 0) then
    raise exception 'A remark is required to reject an application.';
  end if;

  update public.leave_applications
  set status = p_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_remark = coalesce(p_remark, decision_remark),
      updated_by = auth.uid()
  where id = p_application_id and status = 'super_manager_pending'
  returning * into v_application;

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows = 0 then
    raise exception 'This application has already been decided or is no longer pending with Super Manager.';
  end if;

  insert into public.leave_approval_actions (leave_application_id, step_order, approver_role, approver_employee_id, action, remark, acted_at)
  values (v_application.id, 2, 'super_manager', v_caller_employee_id, p_decision, p_remark, now());

  insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
  values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'reversal', current_date, v_application.total_days, 'leave_application', v_application.id,
    case when p_decision = 'approved' then 'Reservation released — converted to Used (approved by Super Manager).' else 'Reservation released — rejected by Super Manager.' end, auth.uid());

  if p_decision = 'approved' then
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'used', current_date, -v_application.total_days, 'leave_application', v_application.id, 'Leave used — approved by Super Manager.', auth.uid());
  end if;

  return v_application;
end;
$$;

grant execute on function public.leave_manager_decide(uuid, text, text) to authenticated;
grant execute on function public.leave_super_manager_decide(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Manager/Super Manager "my queue" listing RPCs — used by the Approvals UI.
-- Deliberately server-side filtered (not "select * and filter in the
-- browser") so a Manager/Super Manager can never even fetch rows outside
-- their authority; RLS on leave_applications backs this up as defense in
-- depth regardless.
-- ----------------------------------------------------------------------------
create or replace function public.leave_list_manager_pending()
returns setof public.leave_applications
language sql
stable
security definer
as $$
  select a.*
  from public.leave_applications a
  where a.status = 'manager_pending'
    and a.employee_id in (
      select e.id from public.employees e where e.reporting_manager_id = public.current_user_employee_id()
    )
  order by a.created_at asc;
$$;

create or replace function public.leave_list_super_manager_pending()
returns setof public.leave_applications
language sql
stable
security definer
as $$
  select a.*
  from public.leave_applications a
  where a.status = 'super_manager_pending'
    and exists (
      select 1 from public.attendance_super_managers sm
      where sm.employee_id = public.current_user_employee_id() and sm.is_active and sm.company_id = a.company_id
    )
  order by a.created_at asc;
$$;

grant execute on function public.leave_list_manager_pending() to authenticated;
grant execute on function public.leave_list_super_manager_pending() to authenticated;
