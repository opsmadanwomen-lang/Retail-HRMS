-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: notifications on
-- cancel/manager-decide/super-manager-decide
-- Migration 0110
--
-- Every line below is byte-identical to the Phase 3 body (0101) except the
-- `perform public.leave_notify(...)` calls added at each real state
-- transition. No authorization/ledger/status logic changes.
-- ============================================================================

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

  perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_cancelled', 'Leave application cancelled', format('Your leave from %s to %s was cancelled.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  v_direct_manager_id := public.leave_resolve_direct_manager(v_application.employee_id);
  if v_direct_manager_id is not null then
    perform public.leave_notify(v_application.company_id, v_direct_manager_id, 'leave_cancelled', 'Leave application cancelled', format('A leave application (%s to %s) was cancelled by the employee.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  end if;

  return v_application;
end;
$$;

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
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'reversal', current_date, v_application.total_days, 'leave_application', v_application.id, 'Reservation released — rejected by Direct Manager.', auth.uid());
    perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_rejected', 'Leave application rejected', format('Your leave from %s to %s was rejected by your Direct Manager.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  elsif v_new_status = 'approved' then
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'reversal', current_date, v_application.total_days, 'leave_application', v_application.id, 'Reservation released — converted to Used (approved by Direct Manager).', auth.uid());
    insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
    values (v_application.company_id, v_application.employee_id, v_application.leave_type_id, v_application.financial_year_id, 'used', current_date, -v_application.total_days, 'leave_application', v_application.id, 'Leave used — approved by Direct Manager.', auth.uid());
    perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_approved', 'Leave application approved', format('Your leave from %s to %s has been approved.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  else
    -- forwarded — every active Super Manager for the company is notified (no single pre-assigned
    -- target, same first-come-first-served authorization model this whole workflow already uses).
    for v_super_manager in select employee_id from public.attendance_super_managers where company_id = v_application.company_id and is_active loop
      perform public.leave_notify(v_application.company_id, v_super_manager.employee_id, 'super_manager_approval_pending', 'Leave approval required', format('A long leave application requires Super Manager approval (%s to %s).', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
    end loop;
  end if;

  return v_application;
end;
$$;

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
    perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_approved', 'Leave application approved', format('Your leave from %s to %s has been approved.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  else
    perform public.leave_notify(v_application.company_id, v_application.employee_id, 'leave_rejected', 'Leave application rejected', format('Your leave from %s to %s was rejected by the Super Manager.', v_application.from_date, v_application.to_date), 'leave_application', v_application.id);
  end if;

  return v_application;
end;
$$;
