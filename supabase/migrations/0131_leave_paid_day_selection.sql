-- ============================================================================
-- Retail HRMS — Leave Management, FINAL process change:
--   LEAVE APPLICATION  and  PAID LEAVE SELECTION  become two separate steps.
-- Migration 0131
--
-- BEFORE: leave_apply() rejected on "Insufficient leave balance" and reserved
--   the whole duration in the ledger; final approval converted that reservation
--   into a 'used' debit for the whole duration.
-- AFTER:
--   • leave_apply() NEVER checks or blocks on paid-leave balance and writes NO
--     ledger row. An application is only a request for permission to be absent.
--   • Final approval (leave_manager_decide / leave_super_manager_decide) writes
--     NO 'used'/'reversal' ledger row. It still does everything else it did —
--     status transition, leave_approval_actions insert, notifications, and
--     leave_materialize_attendance_dates() — so the approval workflow, history
--     and Attendance calendar are unchanged.
--   • Paid leave is consumed ONLY when the employee explicitly marks approved
--     leave dates as Paid, via leave_set_paid_days(). That is the ONLY thing
--     that debits the paid-leave balance, and it is fully reversible (before
--     payroll lock).
--
-- Date-level allocation reuses the EXISTING leave_attendance_effects table
-- (one row per chargeable approved-leave date, migration 0121) — extended with
-- paid_status / paid_units / audit / payroll_locked columns. No new
-- application table, no duplicate approval record. leave_get_balance() is
-- UNCHANGED: Pending naturally becomes 0 (no reservations), Used now reflects
-- exactly the days the employee confirmed as Paid.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Date-level paid allocation on the existing effects table.
-- ---------------------------------------------------------------------------
alter table public.leave_attendance_effects
  add column if not exists paid_status text not null default 'unassigned'
    check (paid_status in ('unassigned', 'paid', 'unpaid')),
  add column if not exists paid_units numeric not null default 0 check (paid_units >= 0),
  add column if not exists paid_selected_by uuid,
  add column if not exists paid_selected_at timestamptz,
  add column if not exists payroll_locked boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. leave_apply(): identical to migration 0120 EXCEPT the two removed pieces
--    (the balance check at old lines 199-202, and the 'pending_reservation'
--    ledger insert at old lines 263-264).
-- ---------------------------------------------------------------------------
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
  p_document_file_size_bytes bigint default null,
  p_prior_notice_reason text default null
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
  v_short_long record;
  v_classification text;
  v_application public.leave_applications;
  v_prior_notice record;
  v_notice_days_actual int;
  v_existing_exception public.leave_prior_notice_exceptions;
  v_exception_id uuid;
begin
  if v_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select id, company_id, status as employee_status into v_employee from public.employees where id = v_employee_id;
  if v_employee.employee_status is distinct from 'active' then
    raise exception 'Only an active employee may apply for leave.';
  end if;

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

  -- NOTE: paid-leave balance is deliberately NOT checked here. Applying for leave is a request
  -- for permission to be absent; whether (and which) approved days are Paid is chosen later via
  -- leave_set_paid_days(), and only that step is balance-controlled.

  select threshold_days, threshold_operator into v_short_long from public.leave_short_long_rules where policy_id = v_policy_id;
  if v_short_long.threshold_days is null then
    v_classification := case when v_total_days <= 3 then 'short' else 'long' end;
  elsif v_short_long.threshold_operator = 'short_lt' then
    v_classification := case when v_total_days < v_short_long.threshold_days then 'short' else 'long' end;
  else
    v_classification := case when v_total_days <= v_short_long.threshold_days then 'short' else 'long' end;
  end if;

  if v_classification = 'long' then
    select required, notice_days, exception_behavior into v_prior_notice
    from public.leave_prior_notice_rules where policy_id = v_policy_id;

    if coalesce(v_prior_notice.required, false) then
      v_notice_days_actual := p_from_date - current_date;

      if v_notice_days_actual < v_prior_notice.notice_days then
        select * into v_existing_exception
        from public.leave_prior_notice_exceptions
        where employee_id = v_employee_id and leave_type_id = p_leave_type_id
          and from_date = p_from_date and to_date = p_to_date
          and status = 'approved' and leave_application_id is null
        order by decided_at desc limit 1;

        if v_existing_exception.id is not null then
          v_exception_id := v_existing_exception.id;
        elsif v_prior_notice.exception_behavior = 'reject' then
          raise exception 'This Leave Type requires % day(s) prior notice for long leave. Only % day(s) notice was given.', v_prior_notice.notice_days, greatest(v_notice_days_actual, 0);
        elsif v_prior_notice.exception_behavior in ('allow_with_reason', 'custom') then
          if p_prior_notice_reason is null or length(trim(p_prior_notice_reason)) = 0 then
            raise exception 'A reason is required to apply for long leave without the required % day(s) prior notice.', v_prior_notice.notice_days;
          end if;
        else
          raise exception 'Prior notice of % day(s) is required for this Leave Type. Please submit a prior notice exception request first, then re-apply once it is approved.', v_prior_notice.notice_days;
        end if;
      end if;
    end if;
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

  if v_exception_id is not null then
    update public.leave_prior_notice_exceptions set leave_application_id = v_application.id where id = v_exception_id;
  end if;

  -- (removed: 'pending_reservation' ledger insert — a pending application no longer touches the balance)

  if p_document_storage_path is not null then
    insert into public.leave_application_documents (leave_application_id, storage_path, file_name, mime_type, file_size_bytes, created_by)
    values (v_application.id, p_document_storage_path, coalesce(p_document_file_name, 'document'), p_document_mime_type, p_document_file_size_bytes, auth.uid());
  end if;

  perform public.leave_notify(v_employee.company_id, v_employee_id, 'leave_applied', 'Leave application submitted', format('Your leave from %s to %s has been submitted.', p_from_date, p_to_date), 'leave_application', v_application.id);
  perform public.leave_notify(v_employee.company_id, v_direct_manager_id, 'manager_approval_pending', 'Leave approval required', format('A leave application requires your approval (%s to %s).', p_from_date, p_to_date), 'leave_application', v_application.id);
  if v_classification = 'long' then
    perform public.leave_notify(v_employee.company_id, v_employee_id, 'long_leave_applied', 'Long leave application submitted', format('Your long leave from %s to %s (%s day(s)) has been submitted and will require Super Manager approval if forwarded.', p_from_date, p_to_date, v_total_days), 'leave_application', v_application.id);
  end if;

  return v_application;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. leave_manager_decide(): identical to 0122 EXCEPT the removed
--    'reversal'/'used' ledger inserts. Status, approval-action log,
--    notifications and leave_materialize_attendance_dates() are untouched.
-- ---------------------------------------------------------------------------
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
  v_super_manager record;
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
    perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_rejected', 'Leave application rejected', format('Your leave from %s to %s was rejected by your Direct Manager.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  elsif v_new_status = 'approved' then
    -- No ledger debit here — approval only grants permission to be absent. Paid days (if any) are
    -- chosen later via leave_set_paid_days().
    perform public.leave_materialize_attendance_dates(v_application.id);
    perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_approved', 'Leave application approved', format('Your leave from %s to %s has been approved. Open Manage Paid Leave to choose which days are paid.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  else
    for v_super_manager in select employee_id from public.attendance_super_managers where company_id = v_application.company_id and is_active loop
      perform public.leave_notify(v_application.company_id, v_super_manager.employee_id, 'super_manager_approval_pending', 'Leave approval required', format('A long leave application requires Super Manager approval (%s to %s).', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
    end loop;
  end if;

  return v_application;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. leave_super_manager_decide(): identical to 0122 EXCEPT the removed
--    'reversal'/'used' ledger inserts.
-- ---------------------------------------------------------------------------
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

  if p_decision = 'approved' then
    perform public.leave_materialize_attendance_dates(v_application.id);
    perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_approved', 'Leave application approved', format('Your leave from %s to %s has been approved. Open Manage Paid Leave to choose which days are paid.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  else
    perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_rejected', 'Leave application rejected', format('Your leave from %s to %s was rejected by the Super Manager.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  end if;

  return v_application;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. leave_cancel(): no reservation to release anymore. On cancelling an
--    APPROVED leave, any days already marked Paid are reversed (balance
--    restored) and the effects are marked 'reversed' — respecting payroll lock.
-- ---------------------------------------------------------------------------
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
  v_direct_manager_id uuid;
  v_was_approved boolean;
  v_eff record;
begin
  select * into v_application from public.leave_applications where id = p_application_id;
  if v_application.id is null then
    raise exception 'Leave application not found.';
  end if;
  if not public.is_super_admin() and v_application.employee_id <> v_employee_id then
    raise exception 'You may only cancel your own leave application.' using errcode = '42501';
  end if;
  if v_application.status not in ('manager_pending', 'super_manager_pending', 'approved') then
    raise exception 'Only a pending or approved application can be cancelled.';
  end if;

  v_was_approved := v_application.status = 'approved';

  if v_was_approved and exists (
    select 1 from public.leave_attendance_effects
    where leave_application_id = p_application_id and status = 'active' and payroll_locked
  ) then
    raise exception 'This leave has payroll-locked days and can no longer be cancelled.';
  end if;

  update public.leave_applications
  set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_remark = p_remark, updated_by = auth.uid()
  where id = p_application_id
  returning * into v_application;

  if v_was_approved then
    -- Restore any paid-leave that had been consumed for this application's dates.
    for v_eff in
      select * from public.leave_attendance_effects
      where leave_application_id = v_application.id and status = 'active' and paid_status = 'paid' and paid_units > 0
    loop
      insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
      values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'reversal', current_date, v_eff.paid_units, 'leave_paid_day', v_eff.id, format('Paid leave restored — approved application cancelled (%s).', v_eff.attendance_date), auth.uid());
    end loop;

    update public.leave_attendance_effects
    set status = 'reversed', reversed_at = now(), reversed_by = auth.uid()
    where leave_application_id = v_application.id and status = 'active';
  end if;

  perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_cancelled', 'Leave application cancelled', format('Your leave from %s to %s was cancelled.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  v_direct_manager_id := public.leave_resolve_direct_manager(v_application.employee_id);
  if v_direct_manager_id is not null then
    perform public.leave_notify(v_application.company_id, v_direct_manager_id, 'leave_cancelled', 'Leave application cancelled', format('A leave application (%s to %s) was cancelled by the employee.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  end if;

  return v_application;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. leave_get_paid_day_selection(): date-wise view of one APPROVED leave for
--    the Manage Paid Leave screen. Self-scoped (own application) or company
--    non-staff / super admin.
-- ---------------------------------------------------------------------------
create or replace function public.leave_get_paid_day_selection(p_application_id uuid)
returns table (
  effect_id uuid,
  attendance_date date,
  is_half_day boolean,
  half_day_session text,
  paid_status text,
  paid_units numeric,
  payroll_locked boolean
)
language sql
stable
security definer
as $$
  select e.id, e.attendance_date, e.is_half_day, e.half_day_session, e.paid_status, e.paid_units, e.payroll_locked
  from public.leave_attendance_effects e
  join public.leave_applications a on a.id = e.leave_application_id
  where e.leave_application_id = p_application_id
    and e.status = 'active'
    and (
      public.is_super_admin()
      or (public.current_user_role() <> 'staff' and a.company_id = public.current_user_company_id())
      or (public.current_user_role() = 'staff' and a.employee_id = public.current_user_employee_id())
    )
  order by e.attendance_date;
$$;

grant execute on function public.leave_get_paid_day_selection(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. leave_set_paid_days(): the ONLY thing that consumes paid leave. Employee
--    submits the FULL desired set of paid dates for one approved application;
--    the function reconciles against what is already allocated, writing only
--    the difference to the ledger ('used' for newly-paid days, 'reversal' for
--    de-selected days). Enforces  selected <= available  (never blocks the
--    approved leave itself). Half day / half-paid consumes 0.5. Idempotent
--    (re-running with the same set writes nothing). Payroll-locked days cannot
--    be changed. Strictly self-scoped: identity is current_user_employee_id().
-- ---------------------------------------------------------------------------
create or replace function public.leave_set_paid_days(
  p_application_id uuid,
  p_paid_full_dates date[] default '{}',
  p_paid_half_dates date[] default '{}'
)
returns table (
  approved_days numeric,
  paid_days numeric,
  unpaid_days numeric,
  available_paid_balance numeric
)
language plpgsql
security definer
as $$
declare
  v_caller_employee_id uuid := public.current_user_employee_id();
  v_app public.leave_applications%rowtype;
  v_bal record;
  v_current_app_paid numeric := 0;
  v_new_total numeric := 0;
  v_headroom numeric;
  v_eff record;
  v_desired_units numeric;
  v_desired_status text;
  v_current_units numeric;
  v_approved numeric := 0;
  v_paid numeric := 0;
begin
  if v_caller_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_app from public.leave_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'Leave application not found.';
  end if;
  if not public.is_super_admin() and v_app.employee_id <> v_caller_employee_id then
    raise exception 'You may only manage paid leave for your own leave application.' using errcode = '42501';
  end if;
  if v_app.status <> 'approved' then
    raise exception 'Paid Leave can only be selected on an approved leave application.';
  end if;
  if exists (
    select 1 from public.leave_attendance_effects
    where leave_application_id = p_application_id and status = 'active' and payroll_locked
  ) then
    raise exception 'Paid Leave selection is locked because payroll for this period has been processed.';
  end if;

  select * into v_bal from public.leave_get_balance(v_app.employee_id, v_app.leave_type_id, v_app.financial_year_id);

  select coalesce(sum(paid_units), 0) into v_current_app_paid
  from public.leave_attendance_effects
  where leave_application_id = p_application_id and status = 'active' and paid_status = 'paid';

  -- desired total for this application
  select coalesce(sum(
    case
      when e.attendance_date = any (p_paid_half_dates) then 0.5
      when e.attendance_date = any (p_paid_full_dates) then (case when e.is_half_day then 0.5 else 1 end)
      else 0
    end), 0)
  into v_new_total
  from public.leave_attendance_effects e
  where e.leave_application_id = p_application_id and e.status = 'active';

  v_headroom := coalesce(v_bal.available, 0) + v_current_app_paid;
  if v_new_total > v_headroom + 1e-9 then
    if v_headroom <= 0 then
      raise exception 'You have no remaining paid leave balance.';
    end if;
    raise exception 'Only % paid leave day(s) are available.', v_headroom;
  end if;

  -- reconcile per date (lock the rows for the transaction)
  for v_eff in
    select * from public.leave_attendance_effects
    where leave_application_id = p_application_id and status = 'active'
    order by attendance_date
    for update
  loop
    v_approved := v_approved + case when v_eff.is_half_day then 0.5 else 1 end;

    v_desired_units :=
      case
        when v_eff.attendance_date = any (p_paid_half_dates) then 0.5
        when v_eff.attendance_date = any (p_paid_full_dates) then (case when v_eff.is_half_day then 0.5 else 1 end)
        else 0
      end;
    v_desired_status := case when v_desired_units > 0 then 'paid' else 'unpaid' end;
    v_current_units := case when v_eff.paid_status = 'paid' then v_eff.paid_units else 0 end;

    if v_current_units <> v_desired_units then
      if v_current_units > 0 then
        insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
        values (v_app.company_id, v_app.employee_id, v_app.leave_type_id, v_app.financial_year_id, 'reversal', current_date, v_current_units, 'leave_paid_day', v_eff.id, format('Paid leave de-selected (%s).', v_eff.attendance_date), auth.uid());
      end if;
      if v_desired_units > 0 then
        insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
        values (v_app.company_id, v_app.employee_id, v_app.leave_type_id, v_app.financial_year_id, 'used', current_date, -v_desired_units, 'leave_paid_day', v_eff.id, format('Paid leave selected (%s).', v_eff.attendance_date), auth.uid());
      end if;
    end if;

    update public.leave_attendance_effects
    set paid_status = v_desired_status,
        paid_units = v_desired_units,
        paid_selected_by = auth.uid(),
        paid_selected_at = now()
    where id = v_eff.id;

    v_paid := v_paid + v_desired_units;
  end loop;

  select * into v_bal from public.leave_get_balance(v_app.employee_id, v_app.leave_type_id, v_app.financial_year_id);

  approved_days := v_approved;
  paid_days := v_paid;
  unpaid_days := v_approved - v_paid;
  available_paid_balance := coalesce(v_bal.available, 0);
  return next;
end;
$$;

grant execute on function public.leave_set_paid_days(uuid, date[], date[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Surface paid / unpaid day counts on the existing self / report listings.
--    (leave_list_my_applications, leave_list_my_leave_history, leave_report_applications)
-- ---------------------------------------------------------------------------
drop function if exists public.leave_list_my_applications();
create function public.leave_list_my_applications()
returns table (
  id uuid, company_id uuid, employee_id uuid, leave_type_id uuid, leave_type_name text,
  financial_year_id uuid, policy_id uuid, from_date date, to_date date,
  is_half_day boolean, half_day_session text, total_days numeric, reason text, remarks text,
  short_or_long text, status text, current_step int, applied_at timestamptz,
  decided_by uuid, decided_at timestamptz, decision_remark text, created_at timestamptz,
  approved_effect_days numeric, paid_days numeric, unpaid_days numeric
)
language sql
stable
security definer
as $$
  select a.id, a.company_id, a.employee_id, a.leave_type_id, lt.name,
         a.financial_year_id, a.policy_id, a.from_date, a.to_date,
         a.is_half_day, a.half_day_session, a.total_days, a.reason, a.remarks,
         a.short_or_long, a.status, a.current_step, a.applied_at,
         a.decided_by, a.decided_at, a.decision_remark, a.created_at,
         coalesce(eff.approved_days, 0), coalesce(eff.paid_days, 0),
         coalesce(eff.approved_days, 0) - coalesce(eff.paid_days, 0)
  from public.leave_applications a
  join public.leave_types lt on lt.id = a.leave_type_id
  left join lateral (
    select sum(case when e.is_half_day then 0.5 else 1 end) as approved_days,
           sum(case when e.paid_status = 'paid' then e.paid_units else 0 end) as paid_days
    from public.leave_attendance_effects e
    where e.leave_application_id = a.id and e.status = 'active'
  ) eff on true
  where a.employee_id = public.current_user_employee_id()
  order by a.applied_at desc;
$$;

drop function if exists public.leave_list_my_leave_history();
create function public.leave_list_my_leave_history()
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text,
  leave_type_id uuid, leave_type_name text, from_date date, to_date date, total_days numeric,
  is_half_day boolean, short_or_long text, reason text, status text, current_step int,
  applied_at timestamptz, decided_action text, decided_by_name text, decided_role text,
  decided_step int, decided_at timestamptz, decision_remark text,
  approved_effect_days numeric, paid_days numeric, unpaid_days numeric
)
language sql
stable
security definer
as $$
  select
    a.id, a.employee_id, e.full_name, e.employee_code,
    a.leave_type_id, lt.name, a.from_date, a.to_date, a.total_days,
    a.is_half_day, a.short_or_long, a.reason, a.status, a.current_step,
    a.applied_at, la.action, ae.full_name, la.approver_role, la.step_order, la.acted_at,
    coalesce(la.remark, a.decision_remark),
    coalesce(eff.approved_days, 0), coalesce(eff.paid_days, 0),
    coalesce(eff.approved_days, 0) - coalesce(eff.paid_days, 0)
  from public.leave_applications a
  join public.employees e   on e.id = a.employee_id
  join public.leave_types lt on lt.id = a.leave_type_id
  left join lateral (
    select l.action, l.approver_role, l.step_order, l.acted_at, l.remark, l.approver_employee_id
    from public.leave_approval_actions l
    where l.leave_application_id = a.id
    order by l.step_order desc, l.acted_at desc
    limit 1
  ) la on true
  left join public.employees ae on ae.id = la.approver_employee_id
  left join lateral (
    select sum(case when x.is_half_day then 0.5 else 1 end) as approved_days,
           sum(case when x.paid_status = 'paid' then x.paid_units else 0 end) as paid_days
    from public.leave_attendance_effects x
    where x.leave_application_id = a.id and x.status = 'active'
  ) eff on true
  where a.employee_id = public.current_user_employee_id()
  order by a.applied_at desc;
$$;

grant execute on function public.leave_list_my_applications() to authenticated;
grant execute on function public.leave_list_my_leave_history() to authenticated;

drop function if exists public.leave_report_applications(date, date);
create function public.leave_report_applications(p_from_date date default null, p_to_date date default null)
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text,
  store_id uuid, store_name text, department_id uuid, department_name text,
  leave_type_id uuid, leave_type_name text, financial_year_id uuid,
  from_date date, to_date date, total_days numeric, is_half_day boolean,
  short_or_long text, status text, applied_at timestamptz,
  decided_by uuid, decided_at timestamptz, decision_remark text, pending_with text,
  paid_days numeric, unpaid_days numeric
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
    end as pending_with,
    coalesce(eff.paid_days, 0) as paid_days,
    coalesce(eff.approved_days, 0) - coalesce(eff.paid_days, 0) as unpaid_days
  from public.leave_applications a
  join public.employees e on e.id = a.employee_id
  left join public.stores s on s.id = e.store_id
  left join public.store_departments sd on sd.id = e.store_department_id
  join public.leave_types lt on lt.id = a.leave_type_id
  left join lateral (
    select sum(case when x.is_half_day then 0.5 else 1 end) as approved_days,
           sum(case when x.paid_status = 'paid' then x.paid_units else 0 end) as paid_days
    from public.leave_attendance_effects x
    where x.leave_application_id = a.id and x.status = 'active'
  ) eff on true
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

-- ---------------------------------------------------------------------------
-- 9. leave_get_balance(): identical to migration 0101 EXCEPT it now IGNORES
--    the old application-level bookkeeping rows (reference_type =
--    'leave_application': pending_reservation / reversal / used). Under the new
--    model those rows must not consume balance — only the explicit
--    'leave_paid_day' 'used' rows written by leave_set_paid_days() do. No
--    historical row is edited or deleted; the resolver simply stops counting a
--    class of rows that the new model no longer produces. Earned, genuine HR
--    'adjustment' rows, and FY-closing rows are all still counted.
--    Pending naturally resolves to 0 (leave_apply no longer reserves).
-- ---------------------------------------------------------------------------
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
    coalesce((select sum(days) from public.leave_ledger
              where employee_id = p_employee_id and leave_type_id = p_leave_type_id and financial_year_id = p_financial_year_id
                and transaction_type in ('opening', 'accrual', 'carry_forward')), 0),
    coalesce((select -sum(days) from public.leave_ledger
              where employee_id = p_employee_id and leave_type_id = p_leave_type_id and financial_year_id = p_financial_year_id
                and transaction_type = 'used' and reference_type is distinct from 'leave_application'), 0),
    coalesce((
      select -sum(l.days) from public.leave_ledger l
      join public.leave_applications a on a.id = l.reference_id and l.reference_type = 'leave_application'
      where l.employee_id = p_employee_id and l.leave_type_id = p_leave_type_id and l.financial_year_id = p_financial_year_id
        and l.transaction_type = 'pending_reservation' and a.status in ('manager_pending', 'super_manager_pending')
    ), 0),
    coalesce((select sum(days) from public.leave_ledger
              where employee_id = p_employee_id and leave_type_id = p_leave_type_id and financial_year_id = p_financial_year_id
                and reference_type is distinct from 'leave_application'), 0);
$$;

grant execute on function public.leave_get_balance(uuid, uuid, uuid) to authenticated;
