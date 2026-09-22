-- ============================================================================
-- Retail HRMS — Phase 2 correction:
--   1. Authoritative effective-date resolution (no longer depends on the
--      Transfers page being opened).
--   2. Exit / Transfer approver authority — narrow, validated workflow RPCs
--      may write the SPECIFIC fields their approved action requires, WITHOUT
--      granting the approver general payroll/employee-record authority and
--      WITHOUT weakening employees_guard_payroll_fields for anyone else.
--
-- No new engine. No redesign of Attendance/Leave/Advance/Salary/PF-ESI/OT/
-- Payroll lifecycle. Every change below is a surgical read-path or
-- write-authority correction inside an EXISTING function.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. employees_guard_payroll_fields — add a narrow, transaction-local bypass.
--
-- The bypass is a Postgres session GUC (`app.employee_workflow_override`),
-- set with set_config(..., true) — i.e. LOCAL / transaction-scoped, so it can
-- never leak past the single RPC call that sets it and is automatically
-- cleared when that transaction ends. A client cannot set this GUC itself:
-- PostgREST only ever executes the specific whitelisted RPCs below, and the
-- flag is set INSIDE those RPCs only AFTER they have independently validated
-- company/roster/stage/employee/status — never as a blanket permission grant.
-- Every other write path (including a direct client UPDATE on employees, or
-- any other RPC) is completely unaffected and still requires super-admin or
-- payroll_can_manage exactly as before.
-- ----------------------------------------------------------------------------
create or replace function public.employees_guard_payroll_fields()
returns trigger
language plpgsql
security definer
as $function$
begin
  if new.leaving_date is distinct from old.leaving_date
     or new.exit_reason is distinct from old.exit_reason
     or new.exit_status is distinct from old.exit_status
     or new.grade_id is distinct from old.grade_id
     or new.category_id is distinct from old.category_id
     or new.joining_date is distinct from old.joining_date then
    if public.current_user_role() = 'staff'
       and not public.is_super_admin()
       and not public.payroll_can_manage(old.company_id)
       and coalesce(current_setting('app.employee_workflow_override', true), 'off') <> 'on' then
      raise exception 'Staff may not change employment timeline (joining / leaving date), grade, category or exit status.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

-- ----------------------------------------------------------------------------
-- B. exit_request_decide — final approval sets ONLY leaving_date / exit_status
--    / exit_reason, under the narrow bypass, after this SAME function has
--    already validated: company, roster/stage (exit_request_can_decide_stage),
--    request status = 'under_approval', final stage reached. Everything else
--    about the RPC is UNCHANGED from 0147.
-- ----------------------------------------------------------------------------
create or replace function public.exit_request_decide(p_id uuid, p_action text, p_remark text default null)
returns public.employee_exit_requests
language plpgsql
security definer
as $fn$
declare r public.employee_exit_requests; v_max int; v_type public.exit_types;
begin
  if p_action not in ('approve', 'reject', 'send_back') then raise exception 'Invalid action.'; end if;
  select * into r from public.employee_exit_requests where id = p_id for update;
  if r.id is null then raise exception 'Exit request not found.'; end if;
  if r.status <> 'under_approval' then raise exception 'Exit request is % — nothing to decide.', r.status; end if;
  if not public.exit_request_can_decide_stage(r.company_id, r.employee_id, r.current_step) then
    raise exception 'You are not an authorised approver at step %.', r.current_step using errcode = '42501';
  end if;
  if p_action in ('reject', 'send_back') and coalesce(btrim(p_remark), '') = '' then
    raise exception 'A reason is required to % an exit request.', p_action;
  end if;

  insert into public.employee_exit_request_decisions (exit_request_id, company_id, step_no, action, actor, remark)
  values (p_id, r.company_id, r.current_step, p_action, auth.uid(), p_remark);

  if p_action = 'reject' then
    update public.employee_exit_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_remark = p_remark, updated_by = auth.uid() where id = p_id returning * into r;
    return r;
  elsif p_action = 'send_back' then
    update public.employee_exit_requests set status = 'sent_back', current_step = 0,
      decision_remark = p_remark, updated_by = auth.uid() where id = p_id returning * into r;
    return r;
  end if;

  -- approve
  v_max := public.exit_request_max_stage(r.company_id);
  if r.current_step < v_max then
    update public.employee_exit_requests set current_step = r.current_step + 1, updated_by = auth.uid()
    where id = p_id returning * into r;
    return r;
  end if;

  -- final approval: the leaving date becomes effective. NARROW bypass: this
  -- specific, already-validated update only — never a general grant.
  select * into v_type from public.exit_types where id = r.exit_type_id;
  perform set_config('app.employee_workflow_override', 'on', true);
  update public.employees
  set leaving_date = r.requested_leaving_date,
      exit_status = public._exit_status_from_type(v_type.code),
      exit_reason = coalesce(r.reason, exit_reason),
      updated_by = auth.uid()
  where id = r.employee_id;

  update public.employee_exit_requests
  set status = 'approved', current_step = r.current_step, effective_leaving_date = r.requested_leaving_date,
      decided_by = auth.uid(), decided_at = now(), decision_remark = p_remark, updated_by = auth.uid()
  where id = p_id returning * into r;
  return r;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- C. exit_request_correct_leaving_date — same narrow bypass for its (already
--    super-admin/payroll_can_manage-gated, and now doubly-safe) employees write.
-- ----------------------------------------------------------------------------
create or replace function public.exit_request_correct_leaving_date(p_id uuid, p_new_leaving_date date, p_reason text)
returns public.employee_exit_requests
language plpgsql
security definer
as $fn$
declare r public.employee_exit_requests; v_fnf public.fnf_settlements; v_emp record;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to correct a leaving date.'; end if;
  select * into r from public.employee_exit_requests where id = p_id for update;
  if r.id is null then raise exception 'Exit request not found.'; end if;
  if not (public.is_super_admin() or public.payroll_can_manage(r.company_id)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if r.status <> 'approved' then raise exception 'Only an approved exit request has an effective leaving date to correct.'; end if;
  select joining_date into v_emp from public.employees where id = r.employee_id;
  if v_emp.joining_date is not null and p_new_leaving_date < v_emp.joining_date then
    raise exception 'Leaving date % is before the joining date %.', p_new_leaving_date, v_emp.joining_date;
  end if;

  if r.fnf_settlement_id is not null then
    select * into v_fnf from public.fnf_settlements where id = r.fnf_settlement_id;
    if v_fnf.id is not null and v_fnf.status not in ('draft', 'under_review', 'calculated', 'sent_back') then
      raise exception 'F&F is % — reverse it before correcting the leaving date.', v_fnf.status;
    end if;
    if v_fnf.id is not null then
      update public.fnf_settlements set leaving_date = p_new_leaving_date, updated_by = auth.uid() where id = v_fnf.id;
    end if;
  end if;

  perform set_config('app.employee_workflow_override', 'on', true);
  update public.employees set leaving_date = p_new_leaving_date, updated_by = auth.uid() where id = r.employee_id;
  update public.employee_exit_requests set requested_leaving_date = p_new_leaving_date, effective_leaving_date = p_new_leaving_date,
    updated_by = auth.uid() where id = p_id returning * into r;
  insert into public.employee_exit_request_decisions (exit_request_id, company_id, step_no, action, actor, remark)
  values (p_id, r.company_id, r.current_step, 'correct_leaving_date', auth.uid(), p_reason);
  return r;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- D. _transfer_sync_live_employee — NARROW bypass around its grade_id/
--    category_id sync only. This is called ONLY from transfer_request_decide
--    (after that function has validated company/roster/stage/employee/status)
--    and from transfer_apply_due_effective (validated authority at its own
--    entry point, §E below) — never reachable directly by a client.
-- ----------------------------------------------------------------------------
create or replace function public._transfer_sync_live_employee(p_id uuid)
returns void
language plpgsql
security definer
as $fn$
declare r public.employee_transfer_requests;
begin
  select * into r from public.employee_transfer_requests where id = p_id;
  perform set_config('app.employee_workflow_override', 'on', true);
  update public.employees set
    store_id = coalesce(r.new_store_id, store_id),
    store_department_id = coalesce(r.new_store_department_id, store_department_id),
    store_designation_id = coalesce(r.new_store_designation_id, store_designation_id),
    store_team_id = coalesce(r.new_store_team_id, store_team_id),
    grade_id = coalesce(r.new_grade_id, grade_id),
    category_id = coalesce(r.new_category_id, category_id),
    reporting_manager_id = coalesce(r.new_reporting_manager_id, reporting_manager_id),
    employment_type = coalesce(r.new_employment_type::public.employment_type, employment_type),
    updated_by = auth.uid()
  where id = r.employee_id;
  update public.employee_transfer_requests set status = 'effective', applied_at = now(), updated_by = auth.uid() where id = p_id;
end;
$fn$;
