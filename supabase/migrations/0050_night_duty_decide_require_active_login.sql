-- ============================================================================
-- Retail HRMS — Require an active login for Night Duty OM/Super Manager decisions
-- Migration 0050
--
-- WHY: attendance_night_duty_om_decide() and attendance_night_duty_super_manager_decide()
-- (migration 0049) authorize purely on attendance_operations_manager_assignments /
-- attendance_super_managers being is_active — they never re-check the caller's own
-- profiles.is_active. The client (AuthProvider) already refuses to resolve a session for a
-- disabled profile and force-signs it out, but that resolution only re-runs on page load /
-- auth state change / token refresh — a disabled manager holding a still-valid access token in an
-- already-open tab could in theory call the RPC directly before that next refresh. Per explicit
-- requirement ("Deactivating a manager must prevent further login/access" and "Role and
-- store-level authorization must be enforced server-side, not only by hiding UI elements"), both
-- RPCs now also require the caller's own profile to be active, independent of the client.
--
-- Scope: ONLY these two RPCs are touched. No other function, table, RLS policy, or calculation
-- logic changes — this is purely an additive authorization check for the OM/Super Manager
-- decision flow, matching this task's explicit boundary.
-- ============================================================================

create or replace function public.attendance_night_duty_om_decide(
  p_approval_id uuid,
  p_decision text,
  p_manager_payable_out_time timestamptz default null,
  p_remark text default null
)
returns public.attendance_night_duty_approvals as $$
declare
  v_caller_employee_id uuid := public.current_user_employee_id();
  v_approval public.attendance_night_duty_approvals%rowtype;
  v_record public.attendance_records%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_ext record;
  v_payable_working int;
  v_note text;
  v_updated_rows int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;

  if v_caller_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  if p_decision not in ('approved', 'disallowed', 'carry_forward') then
    raise exception 'Invalid decision: must be approved, disallowed, or carry_forward.';
  end if;

  select * into v_approval from public.attendance_night_duty_approvals where id = p_approval_id;
  if not found then
    raise exception 'Night Duty approval record was not found.';
  end if;

  if v_approval.approval_status <> 'pending_om' then
    raise exception 'This request is not pending with Operations Manager (current status: %).', v_approval.approval_status;
  end if;

  if v_approval.employee_id = v_caller_employee_id then
    raise exception 'You cannot act on your own Night Duty request.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.attendance_operations_manager_assignments
    where employee_id = v_caller_employee_id
      and store_id = v_approval.store_id
      and is_active
  ) then
    raise exception 'You are not an assigned Operations Manager for this store.'
      using errcode = '42501';
  end if;

  select * into v_record from public.attendance_records where id = v_approval.attendance_record_id;
  if not found then
    raise exception 'The underlying attendance record was not found.';
  end if;

  if p_decision = 'disallowed' then
    if p_manager_payable_out_time is null then
      raise exception 'Please confirm the payable Out Time before disallowing Night Duty.';
    end if;
    if p_manager_payable_out_time < v_record.punch_in_at or p_manager_payable_out_time > v_approval.actual_punch_out_at then
      raise exception 'Payable Out Time must be between Punch In and the actual Punch Out.';
    end if;
  end if;

  if p_decision = 'approved' then
    update public.attendance_night_duty_approvals
    set approval_status = 'om_approved',
        om_id = v_caller_employee_id,
        om_action = 'approved',
        om_acted_at = now(),
        om_remark = p_remark,
        approved_by = auth.uid(),
        approved_at = now(),
        manager_remark = p_remark,
        updated_at = now()
    where id = p_approval_id and approval_status = 'pending_om'
    returning * into v_approval;

    get diagnostics v_updated_rows = row_count;
    if v_updated_rows = 0 then
      raise exception 'This request has already been decided.';
    end if;

    update public.attendance_records
    set payable_working_minutes = working_minutes,
        payable_overtime_minutes = coalesce(overtime_minutes, 0) + coalesce(night_ot_minutes, 0),
        payable_extra_duty_value = extra_duty_value,
        night_duty_approval_id = coalesce(night_duty_approval_id, v_approval.id),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_record.id;

    v_note := 'Night Duty APPROVED by Operations Manager for ' || to_char(v_approval.attendance_date, 'DD Mon YYYY')
      || '. Actual Punch Out ' || to_char(v_approval.actual_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM') || ' is payable.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

  elsif p_decision = 'disallowed' then
    select * into v_shift from public.attendance_shifts where id = v_record.shift_id;

    select * into v_ext from public.calculate_extended_duty(
      v_record.extended_duty_rule_id, v_approval.attendance_date, v_approval.shift_end_at, p_manager_payable_out_time
    );
    v_payable_working := greatest(0, floor(extract(epoch from (p_manager_payable_out_time - v_record.punch_in_at)) / 60)::int - coalesce(v_shift.break_minutes, 0));

    update public.attendance_night_duty_approvals
    set approval_status = 'om_disallowed',
        om_id = v_caller_employee_id,
        om_action = 'disallowed',
        om_acted_at = now(),
        om_remark = p_remark,
        manager_confirmed_payable_out_at = p_manager_payable_out_time,
        approved_by = auth.uid(),
        approved_at = now(),
        manager_remark = p_remark,
        updated_at = now()
    where id = p_approval_id and approval_status = 'pending_om'
    returning * into v_approval;

    get diagnostics v_updated_rows = row_count;
    if v_updated_rows = 0 then
      raise exception 'This request has already been decided.';
    end if;

    update public.attendance_records
    set payable_working_minutes = v_payable_working,
        payable_overtime_minutes = v_ext.o_normal_ot_minutes + v_ext.o_night_ot_minutes,
        payable_extra_duty_value = v_ext.o_extra_duty_value,
        night_duty_approval_id = coalesce(night_duty_approval_id, v_approval.id),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_record.id;

    v_note := 'Night Duty DISALLOWED by Operations Manager for ' || to_char(v_approval.attendance_date, 'DD Mon YYYY')
      || '. Actual Punch Out ' || to_char(v_approval.actual_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
      || ', Confirmed Payable Out ' || to_char(p_manager_payable_out_time at time zone 'Asia/Kolkata', 'HH12:MI AM') || '.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

  else -- carry_forward
    update public.attendance_night_duty_approvals
    set approval_status = 'pending_super_manager',
        om_id = v_caller_employee_id,
        om_action = 'carried_forward',
        om_acted_at = now(),
        om_remark = p_remark,
        updated_at = now()
    where id = p_approval_id and approval_status = 'pending_om'
    returning * into v_approval;

    get diagnostics v_updated_rows = row_count;
    if v_updated_rows = 0 then
      raise exception 'This request has already been decided.';
    end if;

    v_note := 'Night Duty CARRIED FORWARD to Super Manager by Operations Manager for ' || to_char(v_approval.attendance_date, 'DD Mon YYYY') || '.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;
  end if;

  insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
  values (v_approval.company_id, v_approval.employee_id, v_approval.attendance_record_id, 'admin_correction', 'admin', auth.uid(), v_note);

  return v_approval;
end;
$$ language plpgsql security definer;

create or replace function public.attendance_night_duty_super_manager_decide(
  p_approval_id uuid,
  p_decision text,
  p_manager_payable_out_time timestamptz default null,
  p_remark text default null
)
returns public.attendance_night_duty_approvals as $$
declare
  v_caller_employee_id uuid := public.current_user_employee_id();
  v_approval public.attendance_night_duty_approvals%rowtype;
  v_record public.attendance_records%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_ext record;
  v_payable_working int;
  v_note text;
  v_updated_rows int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;

  if v_caller_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  if p_decision not in ('approved', 'disallowed') then
    raise exception 'Invalid decision: must be approved or disallowed.';
  end if;

  select * into v_approval from public.attendance_night_duty_approvals where id = p_approval_id;
  if not found then
    raise exception 'Night Duty approval record was not found.';
  end if;

  if v_approval.approval_status <> 'pending_super_manager' then
    raise exception 'This request is not pending with Super Manager (current status: %).', v_approval.approval_status;
  end if;

  if v_approval.employee_id = v_caller_employee_id then
    raise exception 'You cannot act on your own Night Duty request.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.attendance_super_managers
    where employee_id = v_caller_employee_id
      and is_active
  ) then
    raise exception 'You are not an assigned Super Manager.'
      using errcode = '42501';
  end if;

  select * into v_record from public.attendance_records where id = v_approval.attendance_record_id;
  if not found then
    raise exception 'The underlying attendance record was not found.';
  end if;

  if p_decision = 'disallowed' then
    if p_manager_payable_out_time is null then
      raise exception 'Please confirm the payable Out Time before disallowing Night Duty.';
    end if;
    if p_manager_payable_out_time < v_record.punch_in_at or p_manager_payable_out_time > v_approval.actual_punch_out_at then
      raise exception 'Payable Out Time must be between Punch In and the actual Punch Out.';
    end if;
  end if;

  if p_decision = 'approved' then
    update public.attendance_night_duty_approvals
    set approval_status = 'super_manager_approved',
        super_manager_id = v_caller_employee_id,
        super_manager_action = 'approved',
        super_manager_acted_at = now(),
        super_manager_remark = p_remark,
        approved_by = auth.uid(),
        approved_at = now(),
        manager_remark = p_remark,
        updated_at = now()
    where id = p_approval_id and approval_status = 'pending_super_manager'
    returning * into v_approval;

    get diagnostics v_updated_rows = row_count;
    if v_updated_rows = 0 then
      raise exception 'This request has already been finalized.';
    end if;

    update public.attendance_records
    set payable_working_minutes = working_minutes,
        payable_overtime_minutes = coalesce(overtime_minutes, 0) + coalesce(night_ot_minutes, 0),
        payable_extra_duty_value = extra_duty_value,
        night_duty_approval_id = coalesce(night_duty_approval_id, v_approval.id),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_record.id;

    v_note := 'Night Duty APPROVED by Super Manager for ' || to_char(v_approval.attendance_date, 'DD Mon YYYY')
      || '. Actual Punch Out ' || to_char(v_approval.actual_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM') || ' is payable.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

  else -- disallowed
    select * into v_shift from public.attendance_shifts where id = v_record.shift_id;

    select * into v_ext from public.calculate_extended_duty(
      v_record.extended_duty_rule_id, v_approval.attendance_date, v_approval.shift_end_at, p_manager_payable_out_time
    );
    v_payable_working := greatest(0, floor(extract(epoch from (p_manager_payable_out_time - v_record.punch_in_at)) / 60)::int - coalesce(v_shift.break_minutes, 0));

    update public.attendance_night_duty_approvals
    set approval_status = 'super_manager_disallowed',
        super_manager_id = v_caller_employee_id,
        super_manager_action = 'disallowed',
        super_manager_acted_at = now(),
        super_manager_remark = p_remark,
        manager_confirmed_payable_out_at = p_manager_payable_out_time,
        approved_by = auth.uid(),
        approved_at = now(),
        manager_remark = p_remark,
        updated_at = now()
    where id = p_approval_id and approval_status = 'pending_super_manager'
    returning * into v_approval;

    get diagnostics v_updated_rows = row_count;
    if v_updated_rows = 0 then
      raise exception 'This request has already been finalized.';
    end if;

    update public.attendance_records
    set payable_working_minutes = v_payable_working,
        payable_overtime_minutes = v_ext.o_normal_ot_minutes + v_ext.o_night_ot_minutes,
        payable_extra_duty_value = v_ext.o_extra_duty_value,
        night_duty_approval_id = coalesce(night_duty_approval_id, v_approval.id),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_record.id;

    v_note := 'Night Duty DISALLOWED by Super Manager for ' || to_char(v_approval.attendance_date, 'DD Mon YYYY')
      || '. Actual Punch Out ' || to_char(v_approval.actual_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
      || ', Confirmed Payable Out ' || to_char(p_manager_payable_out_time at time zone 'Asia/Kolkata', 'HH12:MI AM') || '.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;
  end if;

  insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
  values (v_approval.company_id, v_approval.employee_id, v_approval.attendance_record_id, 'admin_correction', 'admin', auth.uid(), v_note);

  return v_approval;
end;
$$ language plpgsql security definer;

revoke all on function public.attendance_night_duty_om_decide(uuid, text, timestamptz, text) from public;
grant execute on function public.attendance_night_duty_om_decide(uuid, text, timestamptz, text) to authenticated;

revoke all on function public.attendance_night_duty_super_manager_decide(uuid, text, timestamptz, text) from public;
grant execute on function public.attendance_night_duty_super_manager_decide(uuid, text, timestamptz, text) to authenticated;
