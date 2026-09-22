-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: leave_apply() — Prior Notice +
-- Notifications
-- Migration 0109
--
-- Adds, on top of the UNCHANGED Phase 3 body: (1) a Prior Notice check for
-- LONG leave only (reusing the SAME short_or_long classification computed
-- two lines below it — never a second classification), driven entirely by
-- leave_prior_notice_rules (policy-scoped, versioned like every other Leave
-- rule); (2) Leave Applied + Manager Approval Pending notifications on
-- success. Every other line is byte-identical to the Phase 3 body.
-- ============================================================================
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
  v_balance record;
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

  -- ---------------------------------------------------------------------
  -- Prior Notice — LONG leave only, entirely policy-driven. Reuses
  -- v_classification computed immediately above; never a second Short/Long
  -- algorithm.
  -- ---------------------------------------------------------------------
  if v_classification = 'long' then
    select required, notice_days, exception_behavior into v_prior_notice
    from public.leave_prior_notice_rules where policy_id = v_policy_id;

    if coalesce(v_prior_notice.required, false) then
      v_notice_days_actual := p_from_date - current_date;

      if v_notice_days_actual < v_prior_notice.notice_days then
        -- Was an exception already approved for exactly this employee/leave type/date range, and not
        -- yet consumed by an application? Use it and proceed — this is how the two-step
        -- request-then-reapply flow for approval-gated behaviors resolves.
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
          insert into public.leave_prior_notice_exceptions (company_id, employee_id, exception_behavior, reason, status, requested_by, decided_by, decided_at, from_date, to_date, leave_type_id)
          values (v_employee.company_id, v_employee_id, v_prior_notice.exception_behavior, p_prior_notice_reason, 'approved', auth.uid(), null, now(), p_from_date, p_to_date, p_leave_type_id)
          returning id into v_exception_id;
        else
          -- hr_approval_required / special_approval_required / emergency_exception: gated on a
          -- separate approval — the application is NOT created now.
          if p_prior_notice_reason is null or length(trim(p_prior_notice_reason)) = 0 then
            raise exception 'A reason is required to request a prior notice exception.';
          end if;
          insert into public.leave_prior_notice_exceptions (company_id, employee_id, exception_behavior, reason, status, requested_by, from_date, to_date, leave_type_id)
          values (v_employee.company_id, v_employee_id, v_prior_notice.exception_behavior, p_prior_notice_reason, 'pending', auth.uid(), p_from_date, p_to_date, p_leave_type_id)
          returning id into v_exception_id;

          perform public.leave_notify(v_employee.company_id, v_direct_manager_id, 'prior_notice_exception', 'Prior notice exception requested', format('An employee requested a prior-notice exception (Exception ID: %s).', v_exception_id), 'leave_prior_notice_exceptions', v_exception_id);

          raise exception 'Prior notice of % day(s) is required for this Leave Type. Your exception request has been submitted for approval (Exception ID: %). Please re-submit this application once it is approved.', v_prior_notice.notice_days, v_exception_id;
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

  insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
  values (v_employee.company_id, v_employee_id, p_leave_type_id, v_fy.id, 'pending_reservation', current_date, -v_total_days, 'leave_application', v_application.id, 'Reserved on application.', auth.uid());

  if p_document_storage_path is not null then
    insert into public.leave_application_documents (leave_application_id, storage_path, file_name, mime_type, file_size_bytes, created_by)
    values (v_application.id, p_document_storage_path, coalesce(p_document_file_name, 'document'), p_document_mime_type, p_document_file_size_bytes, auth.uid());
  end if;

  perform public.leave_notify(v_employee.company_id, v_employee_id, 'leave_applied', 'Leave application submitted', format('Your leave from %s to %s has been submitted.', p_from_date, p_to_date), 'leave_application', v_application.id);
  perform public.leave_notify(v_employee.company_id, v_direct_manager_id, 'manager_approval_pending', 'Leave approval required', format('A leave application requires your approval (%s to %s).', p_from_date, p_to_date), 'leave_application', v_application.id);

  return v_application;
end;
$$;

grant execute on function public.leave_apply(uuid, date, date, boolean, text, text, text, text, text, text, bigint, text) to authenticated;

-- Old 11-arg overload is now shadowed by the 12-arg one above but PostgREST/Postgres keep both
-- signatures resolvable; drop the old one explicitly so there is exactly one leave_apply() overload
-- and no ambiguity for callers.
drop function if exists public.leave_apply(uuid, date, date, boolean, text, text, text, text, text, text, bigint);
