-- ============================================================================
-- Retail HRMS — FINAL business rule correction: 2-Day Night Duty suppresses
-- Normal OT for that attendance's payable Overtime
-- Migration 0082
--
-- ROOT CAUSE (investigated read-only before any change): every place that
-- computes payable_overtime_minutes on FINAL APPROVAL --
-- attendance_night_duty_om_decide(), attendance_night_duty_super_manager_
-- decide() (migration 0050), the migration-0081 payable-sync block inside
-- attendance_admin_upsert(), and the legacy Super-Admin emergency RPC
-- attendance_night_duty_decide() (migration 0045) -- unconditionally computed
-- payable_overtime_minutes = overtime_minutes + night_ot_minutes. That
-- addition is correct for the 0.5-Day and 1-Day Night Duty tiers, but the
-- FINAL approved rule is that once an attendance reaches the 2-Day (terminal)
-- tier, Normal OT is not separately payable at all -- only Night OT is.
--
-- Nothing about calculate_extended_duty() (the Night Duty ladder / Night OT
-- ladder) changes -- migration 0080's windows stay exactly as they are, and
-- attendance_records.overtime_minutes (the raw "Normal OT" fact) is still
-- computed and stored exactly as before, unedited by this migration. Only
-- the PAYABLE aggregation formula, applied at FINAL APPROVAL time, changes --
-- and only for records that reached the terminal Night Duty tier.
--
-- New helper (single authoritative check, used by every write-site below --
-- never duplicated): night_duty_normal_ot_suppressed(rule_id, extra_duty_value)
-- compares the record's own (already-computed) extra_duty_value against the
-- COMPANY-CONFIGURED second_day_extra_duty_value (default 2, but never a
-- hard-coded literal "2" in the write-sites) -- data-driven, matching every
-- other threshold in this ladder.
--
-- Scope, per explicit requirement: suppression applies ONLY on FINAL
-- APPROVAL. The Disallow branches of every RPC are untouched -- Disallow
-- already computes payable_overtime_minutes from a manager-recomputed,
-- confirmed-payable-out-time basis independent of this rule, and Pending
-- never has a payable_overtime_minutes at all. No approval status, approver,
-- timestamp, RLS policy, or unrelated formula is touched.
-- ============================================================================

create or replace function public.night_duty_normal_ot_suppressed(
  p_extended_duty_rule_id uuid,
  p_extra_duty_value numeric
) returns boolean as $$
declare
  v_second_day_value numeric;
begin
  if p_extra_duty_value is null or p_extended_duty_rule_id is null then
    return false;
  end if;

  select second_day_extra_duty_value into v_second_day_value
  from public.attendance_extended_duty_rules
  where id = p_extended_duty_rule_id;

  if v_second_day_value is null then
    return false; -- rule not found: legacy passthrough, never suppress
  end if;

  return p_extra_duty_value >= v_second_day_value;
end;
$$ language plpgsql stable;

-- ---------------------------------------------------------------------------
-- attendance_night_duty_om_decide() -- only the APPROVE branch's
-- payable_overtime_minutes formula changes.
-- ---------------------------------------------------------------------------
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
        payable_overtime_minutes = case
          when public.night_duty_normal_ot_suppressed(extended_duty_rule_id, extra_duty_value)
          then coalesce(night_ot_minutes, 0)
          else coalesce(overtime_minutes, 0) + coalesce(night_ot_minutes, 0)
        end,
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

-- ---------------------------------------------------------------------------
-- attendance_night_duty_super_manager_decide() -- same one-formula change,
-- only in the APPROVE branch.
-- ---------------------------------------------------------------------------
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
        payable_overtime_minutes = case
          when public.night_duty_normal_ot_suppressed(extended_duty_rule_id, extra_duty_value)
          then coalesce(night_ot_minutes, 0)
          else coalesce(overtime_minutes, 0) + coalesce(night_ot_minutes, 0)
        end,
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

-- ---------------------------------------------------------------------------
-- Legacy Super-Admin emergency-access RPC (migration 0045) -- kept in place
-- per prior explicit decision, but must not remain a 4th inconsistent
-- formula. Only its APPROVE (else) branch's payable_overtime_minutes
-- changes; the disallow branch and everything else is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.attendance_night_duty_decide(
  p_approval_id uuid,
  p_decision text,
  p_manager_payable_out_time timestamptz default null,
  p_remark text default null
)
returns public.attendance_night_duty_approvals as $$
declare
  v_approval public.attendance_night_duty_approvals%rowtype;
  v_record public.attendance_records%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_ext record;
  v_payable_working int;
  v_note text;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can approve or disallow Night Duty.'
      using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'disallowed') then
    raise exception 'Invalid decision: must be approved or disallowed.';
  end if;

  select * into v_approval from public.attendance_night_duty_approvals where id = p_approval_id;
  if not found then
    raise exception 'Night Duty approval record was not found.';
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

    select * into v_shift from public.attendance_shifts where id = v_record.shift_id;

    select * into v_ext from public.calculate_extended_duty(
      v_record.extended_duty_rule_id, v_approval.attendance_date, v_approval.shift_end_at, p_manager_payable_out_time
    );

    v_payable_working := greatest(0, floor(extract(epoch from (p_manager_payable_out_time - v_record.punch_in_at)) / 60)::int - coalesce(v_shift.break_minutes, 0));

    update public.attendance_records
    set payable_working_minutes = v_payable_working,
        payable_overtime_minutes = v_ext.o_normal_ot_minutes + v_ext.o_night_ot_minutes,
        payable_extra_duty_value = v_ext.o_extra_duty_value,
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_record.id;

    v_note := 'Night Duty DISALLOWED for ' || to_char(v_approval.attendance_date, 'DD Mon YYYY')
      || '. Actual Punch Out ' || to_char(v_approval.actual_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
      || ', Manager Confirmed Payable Out ' || to_char(p_manager_payable_out_time at time zone 'Asia/Kolkata', 'HH12:MI AM') || '.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;
  else
    update public.attendance_records
    set payable_working_minutes = working_minutes,
        payable_overtime_minutes = case
          when public.night_duty_normal_ot_suppressed(extended_duty_rule_id, extra_duty_value)
          then coalesce(night_ot_minutes, 0)
          else coalesce(overtime_minutes, 0) + coalesce(night_ot_minutes, 0)
        end,
        payable_extra_duty_value = extra_duty_value,
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_record.id;

    v_note := 'Night Duty APPROVED for ' || to_char(v_approval.attendance_date, 'DD Mon YYYY')
      || '. Actual Punch Out ' || to_char(v_approval.actual_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM') || ' is payable.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;
  end if;

  update public.attendance_records set night_duty_approval_id = v_approval.id where id = v_record.id and night_duty_approval_id is null;

  update public.attendance_night_duty_approvals
  set approval_status = p_decision,
      manager_confirmed_payable_out_at = case when p_decision = 'disallowed' then p_manager_payable_out_time else null end,
      manager_remark = p_remark,
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  where id = p_approval_id
  returning * into v_approval;

  insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
  values (v_approval.company_id, v_approval.employee_id, v_approval.attendance_record_id, 'admin_correction', 'admin', auth.uid(), v_note);

  return v_approval;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- attendance_admin_upsert() -- only the migration-0081 payable-sync block's
-- payable_overtime_minutes formula changes. Every other line stays byte-for-
-- byte identical to migration 0081.
-- ---------------------------------------------------------------------------
create or replace function public.attendance_admin_upsert(
  p_employee_id uuid,
  p_attendance_date date,
  p_status text,
  p_punch_in_time time without time zone default null,
  p_punch_out_time time without time zone default null,
  p_remark text default null,
  p_use_information boolean default false
)
returns attendance_records
language plpgsql
security definer
as $function$
declare
  v_employee record;
  v_shift public.attendance_shifts%rowtype;
  v_assignment record;
  v_existing public.attendance_records%rowtype;
  v_punch_in_at timestamptz;
  v_punch_out_at timestamptz;
  v_facts record;
  v_day_type_override text;
  v_final_status text;
  v_shift_end_at timestamptz;
  v_note text;
  v_prev_status text;
  v_punch_in_note text := '';
  v_punch_out_note text := '';
  v_remark_note text := '';
  v_valid_statuses text[] := array['present','absent','half_day','leave','weekly_off','holiday','work_from_home','on_duty'];
  v_is_overnight boolean := false;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can create or edit attendance for another employee.'
      using errcode = '42501';
  end if;

  if p_attendance_date > current_date then
    raise exception 'Cannot create or edit attendance for a future date (%). Only dates up to today are allowed.', p_attendance_date
      using errcode = '22007';
  end if;

  if p_status is null or not (p_status = any(v_valid_statuses)) then
    raise exception 'Invalid attendance status: %', coalesce(p_status, '<null>');
  end if;

  if p_punch_in_time is not null and p_punch_out_time is not null and p_punch_out_time = p_punch_in_time then
    raise exception 'Punch Out must be after Punch In.';
  end if;

  select id, company_id, store_id into v_employee
  from public.employees
  where id = p_employee_id
  limit 1;

  if not found then
    raise exception 'Selected employee was not found.';
  end if;

  select * into v_assignment
  from public.employee_shift_assignments
  where employee_id = v_employee.id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;

  if found then
    select * into v_shift from public.attendance_shifts where id = v_assignment.shift_id and is_active;
  end if;

  if v_shift.id is null then
    select * into v_shift
    from public.attendance_shifts
    where company_id = v_employee.company_id
      and is_active
    order by name
    limit 1;
  end if;

  if v_shift.id is null then
    raise exception 'No active shift is assigned to this employee for %.', p_attendance_date;
  end if;

  if p_punch_in_time is not null then
    v_punch_in_at := (p_attendance_date + p_punch_in_time) at time zone 'Asia/Kolkata';
  end if;
  if p_punch_out_time is not null then
    v_is_overnight := p_punch_in_time is not null and p_punch_out_time < p_punch_in_time;
    if v_is_overnight then
      v_punch_out_at := (p_attendance_date + 1 + p_punch_out_time) at time zone 'Asia/Kolkata';
    else
      v_punch_out_at := (p_attendance_date + p_punch_out_time) at time zone 'Asia/Kolkata';
    end if;
  end if;

  v_day_type_override := case when p_status in ('leave', 'holiday') then p_status else null end;

  select * into v_facts from public.compute_extended_attendance_facts(
    v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, p_attendance_date,
    v_punch_in_at, v_punch_out_at, coalesce(p_use_information, false), v_day_type_override
  );

  v_final_status := p_status;

  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = p_attendance_date
  limit 1;

  v_prev_status := coalesce(v_existing.status::text, 'none (new record)');
  if v_punch_in_at is not null then
    v_punch_in_note := ' Punch In ' || to_char(v_punch_in_at at time zone 'Asia/Kolkata', 'HH12:MI AM');
  end if;
  if v_punch_out_at is not null then
    v_punch_out_note := ', Punch Out ' || to_char(v_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
      || (case when v_is_overnight then ' (next day)' else '' end);
  end if;
  if p_remark is not null and length(trim(p_remark)) > 0 then
    v_remark_note := ' Reason: ' || p_remark;
  end if;

  v_note := 'Super Admin ' || (case when v_existing.id is null then 'created' else 'edited' end)
    || ' attendance for ' || to_char(p_attendance_date, 'DD Mon YYYY')
    || ': ' || v_prev_status || ' -> ' || v_final_status || '.'
    || v_punch_in_note || v_punch_out_note || v_remark_note;

  if v_existing.id is not null then
    update public.attendance_records
    set status = v_final_status::public.attendance_status,
        shift_id = v_shift.id,
        punch_in_at = v_punch_in_at,
        punch_out_at = v_punch_out_at,
        total_working_minutes = v_facts.o_total_working_minutes,
        break_deduction_minutes = v_facts.o_break_deduction_minutes,
        working_minutes = v_facts.o_working_minutes,
        late_minutes = v_facts.o_late_minutes,
        late_rule_id = v_facts.o_late_rule_id,
        used_information = v_facts.o_used_information,
        information_rule_id = v_facts.o_information_rule_id,
        half_day_reason = v_facts.o_half_day_reason,
        half_day_rule_id = v_facts.o_half_day_rule_id,
        penalty_minutes = v_facts.o_penalty_minutes,
        penalty_rule_id = v_facts.o_penalty_rule_id,
        early_going_minutes = v_facts.o_early_going_minutes,
        early_going_rule_id = v_facts.o_early_going_rule_id,
        overtime_minutes = v_facts.o_overtime_minutes,
        overtime_rule_id = v_facts.o_overtime_rule_id,
        extra_duty_value = v_facts.o_extra_duty_value,
        night_ot_minutes = v_facts.o_night_ot_minutes,
        extended_duty_rule_id = v_facts.o_extended_duty_rule_id,
        source = 'admin',
        remarks = coalesce(p_remark, remarks),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;
  else
    insert into public.attendance_records (
      company_id, employee_id, store_id, attendance_date, shift_id,
      punch_in_at, punch_out_at, total_working_minutes, break_deduction_minutes, working_minutes, late_minutes, late_rule_id,
      used_information, information_rule_id, half_day_reason, half_day_rule_id,
      penalty_minutes, penalty_rule_id, early_going_minutes, early_going_rule_id,
      overtime_minutes, overtime_rule_id, extra_duty_value, night_ot_minutes, extended_duty_rule_id,
      status, source, remarks, created_by, updated_by
    ) values (
      v_employee.company_id, v_employee.id, v_employee.store_id, p_attendance_date, v_shift.id,
      v_punch_in_at, v_punch_out_at, v_facts.o_total_working_minutes, v_facts.o_break_deduction_minutes, v_facts.o_working_minutes, v_facts.o_late_minutes, v_facts.o_late_rule_id,
      v_facts.o_used_information, v_facts.o_information_rule_id, v_facts.o_half_day_reason, v_facts.o_half_day_rule_id,
      v_facts.o_penalty_minutes, v_facts.o_penalty_rule_id, v_facts.o_early_going_minutes, v_facts.o_early_going_rule_id,
      v_facts.o_overtime_minutes, v_facts.o_overtime_rule_id, v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_facts.o_extended_duty_rule_id,
      v_final_status::public.attendance_status, 'admin', p_remark, auth.uid(), auth.uid()
    ) returning * into v_existing;
  end if;

  -- If this record already has a FINAL APPROVED Night Duty request, keep payable_* in sync with
  -- the facts just recalculated above -- same formula the approve RPCs above use, including the
  -- 2-Day-suppresses-Normal-OT rule (migration 0082). Pending/Disallowed records are untouched.
  if v_existing.night_duty_approval_id is not null then
    if exists (
      select 1 from public.attendance_night_duty_approvals
      where id = v_existing.night_duty_approval_id
        and approval_status in ('approved', 'om_approved', 'super_manager_approved')
    ) then
      update public.attendance_records
      set payable_working_minutes = working_minutes,
          payable_overtime_minutes = case
            when public.night_duty_normal_ot_suppressed(extended_duty_rule_id, extra_duty_value)
            then coalesce(night_ot_minutes, 0)
            else coalesce(overtime_minutes, 0) + coalesce(night_ot_minutes, 0)
          end,
          payable_extra_duty_value = extra_duty_value,
          updated_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id
      returning * into v_existing;
    end if;
  end if;

  if v_punch_out_at is not null then
    v_shift_end_at := (p_attendance_date + v_shift.end_time) at time zone 'Asia/Kolkata';
    perform public.ensure_night_duty_approval(
      v_employee.company_id, v_employee.id, v_existing.id, p_attendance_date, v_shift_end_at, v_punch_out_at,
      v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_employee.store_id
    );
  end if;

  insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
  values (v_employee.company_id, v_employee.id, v_existing.id, 'admin_correction', 'admin', auth.uid(), v_note);

  return v_existing;
end;
$function$;
