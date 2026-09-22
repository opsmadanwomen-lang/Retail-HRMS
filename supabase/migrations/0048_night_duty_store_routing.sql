-- ============================================================================
-- Retail HRMS — Route new Night Duty approvals to store_id, initial status
-- pending_om
-- Migration 0048
--
-- ensure_night_duty_approval() gains p_store_id (stored on the approval row
-- so attendance_night_duty_om_decide() (migration 0049) can check the
-- calling OM is actually assigned to that store) and now creates rows with
-- approval_status = 'pending_om' instead of the old 'pending'. The three
-- callers (attendance_punch_out, attendance_admin_punch, attendance_admin_
-- upsert) are otherwise byte-identical to migration 0045 — only the one
-- `perform` call site in each gains one extra store_id argument.
-- ============================================================================

create or replace function public.ensure_night_duty_approval(
  p_company_id uuid,
  p_employee_id uuid,
  p_attendance_record_id uuid,
  p_attendance_date date,
  p_shift_end_at timestamptz,
  p_actual_punch_out_at timestamptz,
  p_extra_duty_value numeric,
  p_night_ot_minutes int,
  p_store_id uuid
) returns void as $$
declare
  v_config public.attendance_night_duty_approval_config%rowtype;
  v_approval_required boolean := true;
begin
  if p_extra_duty_value is null or p_extra_duty_value <= 0 then
    return;
  end if;

  select * into v_config
  from public.attendance_night_duty_approval_config
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;

  if v_config.id is not null then
    v_approval_required := v_config.approval_required;
  end if;

  if not v_approval_required then
    return;
  end if;

  insert into public.attendance_night_duty_approvals (
    company_id, employee_id, attendance_record_id, attendance_date, shift_end_at,
    actual_punch_out_at, extra_duty_value, night_ot_minutes, approval_status, store_id
  ) values (
    p_company_id, p_employee_id, p_attendance_record_id, p_attendance_date, p_shift_end_at,
    p_actual_punch_out_at, p_extra_duty_value, p_night_ot_minutes, 'pending_om', p_store_id
  )
  on conflict (attendance_record_id) do nothing;
end;
$$ language plpgsql security definer;

create or replace function public.attendance_punch_out()
returns public.attendance_records as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
  v_record public.attendance_records%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_facts record;
  v_shift_end_at timestamptz;
  v_now timestamptz := now();
begin
  if v_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_record
  from public.attendance_records
  where employee_id = v_employee_id
    and attendance_date = current_date
  limit 1;

  if not found or v_record.punch_in_at is null then
    raise exception 'Please punch in before punching out.';
  end if;

  if v_record.punch_out_at is not null then
    raise exception 'You have already punched out for today.';
  end if;

  select * into v_shift from public.attendance_shifts where id = v_record.shift_id and is_active;
  if not found then
    raise exception 'Assigned shift is not available.';
  end if;

  select * into v_facts from public.compute_extended_attendance_facts(
    v_record.company_id, v_employee_id, v_shift.id, v_record.store_id, current_date,
    v_record.punch_in_at, v_now, v_record.used_information, null
  );

  update public.attendance_records
  set punch_out_at = v_now,
      working_minutes = v_facts.o_working_minutes,
      early_going_minutes = v_facts.o_early_going_minutes,
      early_going_rule_id = v_facts.o_early_going_rule_id,
      overtime_minutes = v_facts.o_overtime_minutes,
      overtime_rule_id = v_facts.o_overtime_rule_id,
      extra_duty_value = v_facts.o_extra_duty_value,
      night_ot_minutes = v_facts.o_night_ot_minutes,
      extended_duty_rule_id = v_facts.o_extended_duty_rule_id,
      half_day_reason = coalesce(v_facts.o_half_day_reason, v_record.half_day_reason),
      status = v_facts.o_status,
      source = 'web',
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_record.id
  returning * into v_record;

  v_shift_end_at := (current_date + v_shift.end_time) at time zone 'Asia/Kolkata';
  perform public.ensure_night_duty_approval(
    v_record.company_id, v_employee_id, v_record.id, current_date, v_shift_end_at, v_now,
    v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_record.store_id
  );

  return v_record;
end;
$$ language plpgsql security definer;

create or replace function public.attendance_admin_punch(
  p_employee_id uuid,
  p_type text,
  p_remark text default null
)
returns public.attendance_records as $$
declare
  v_employee record;
  v_shift public.attendance_shifts%rowtype;
  v_assignment record;
  v_now timestamptz := now();
  v_existing public.attendance_records%rowtype;
  v_facts record;
  v_shift_end_at timestamptz;
  v_note text;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can perform a manual attendance punch for another employee.'
      using errcode = '42501';
  end if;

  if p_type not in ('punch_in', 'punch_out') then
    raise exception 'Invalid punch type: must be punch_in or punch_out.';
  end if;

  select id, company_id, store_id, status into v_employee
  from public.employees e
  where e.id = p_employee_id
    and status = 'active'
  limit 1;

  if not found then
    raise exception 'Selected employee was not found or is not active.';
  end if;

  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = current_date
  limit 1;

  if p_type = 'punch_in' then
    if found and v_existing.punch_in_at is not null then
      raise exception 'This employee has already punched in for today.';
    end if;

    select * into v_assignment
    from public.employee_shift_assignments
    where employee_id = v_employee.id
      and is_active
      and effective_from <= current_date
      and (effective_to is null or effective_to >= current_date)
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
      raise exception 'No active shift is assigned to this employee.';
    end if;

    select * into v_facts from public.compute_late_and_penalty_facts(
      v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date, v_now, false
    );

    v_note := 'Punched in by Super Admin on behalf of employee.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

    if v_existing.id is not null then
      update public.attendance_records
      set punch_in_at = v_now,
          late_minutes = v_facts.o_late_minutes,
          late_rule_id = v_facts.o_late_rule_id,
          half_day_reason = case when v_facts.o_half_day_late_coming then 'late_coming' else null end,
          half_day_rule_id = v_facts.o_half_day_rule_id,
          penalty_minutes = v_facts.o_penalty_minutes,
          penalty_rule_id = v_facts.o_penalty_rule_id,
          status = case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end,
          source = 'admin',
          shift_id = v_shift.id,
          remarks = coalesce(p_remark, remarks),
          updated_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id
      returning * into v_existing;
    else
      insert into public.attendance_records (
        company_id, employee_id, store_id, attendance_date, shift_id,
        punch_in_at, late_minutes, late_rule_id, half_day_reason, half_day_rule_id,
        penalty_minutes, penalty_rule_id, status, source, remarks, created_by, updated_by
      ) values (
        v_employee.company_id, v_employee.id, v_employee.store_id, current_date, v_shift.id,
        v_now, v_facts.o_late_minutes, v_facts.o_late_rule_id,
        case when v_facts.o_half_day_late_coming then 'late_coming' else null end, v_facts.o_half_day_rule_id,
        v_facts.o_penalty_minutes, v_facts.o_penalty_rule_id,
        case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end, 'admin', p_remark, auth.uid(), auth.uid()
      ) returning * into v_existing;
    end if;

    insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
    values (v_employee.company_id, v_employee.id, v_existing.id, 'punch_in', 'admin', auth.uid(), v_note);

    return v_existing;

  else -- punch_out
    if not found or v_existing.punch_in_at is null then
      raise exception 'This employee has not punched in yet today.';
    end if;

    if v_existing.punch_out_at is not null then
      raise exception 'This employee has already punched out for today.';
    end if;

    select * into v_shift from public.attendance_shifts where id = v_existing.shift_id and is_active;
    if not found then
      raise exception 'Assigned shift is not available.';
    end if;

    select * into v_facts from public.compute_extended_attendance_facts(
      v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date,
      v_existing.punch_in_at, v_now, v_existing.used_information, null
    );

    v_note := 'Punched out by Super Admin on behalf of employee.'
      || case when p_remark is not null and length(trim(p_remark)) > 0 then ' Remark: ' || p_remark else '' end;

    update public.attendance_records
    set punch_out_at = v_now,
        working_minutes = v_facts.o_working_minutes,
        early_going_minutes = v_facts.o_early_going_minutes,
        early_going_rule_id = v_facts.o_early_going_rule_id,
        overtime_minutes = v_facts.o_overtime_minutes,
        overtime_rule_id = v_facts.o_overtime_rule_id,
        extra_duty_value = v_facts.o_extra_duty_value,
        night_ot_minutes = v_facts.o_night_ot_minutes,
        extended_duty_rule_id = v_facts.o_extended_duty_rule_id,
        half_day_reason = coalesce(v_facts.o_half_day_reason, v_existing.half_day_reason),
        status = v_facts.o_status,
        source = 'admin',
        remarks = coalesce(p_remark, remarks),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    v_shift_end_at := (current_date + v_shift.end_time) at time zone 'Asia/Kolkata';
    perform public.ensure_night_duty_approval(
      v_employee.company_id, v_employee.id, v_existing.id, current_date, v_shift_end_at, v_now,
      v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_employee.store_id
    );

    insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
    values (v_employee.company_id, v_employee.id, v_existing.id, 'punch_out', 'admin', auth.uid(), v_note);

    return v_existing;
  end if;
end;
$$ language plpgsql security definer;

create or replace function public.attendance_admin_upsert(
  p_employee_id uuid,
  p_attendance_date date,
  p_status text,
  p_punch_in_time time default null,
  p_punch_out_time time default null,
  p_remark text default null,
  p_use_information boolean default false
)
returns public.attendance_records as $$
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

  if p_punch_in_time is not null and p_punch_out_time is not null and p_punch_out_time <= p_punch_in_time then
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
    v_punch_out_at := (p_attendance_date + p_punch_out_time) at time zone 'Asia/Kolkata';
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
    v_punch_out_note := ', Punch Out ' || to_char(v_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM');
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
      punch_in_at, punch_out_at, working_minutes, late_minutes, late_rule_id,
      used_information, information_rule_id, half_day_reason, half_day_rule_id,
      penalty_minutes, penalty_rule_id, early_going_minutes, early_going_rule_id,
      overtime_minutes, overtime_rule_id, extra_duty_value, night_ot_minutes, extended_duty_rule_id,
      status, source, remarks, created_by, updated_by
    ) values (
      v_employee.company_id, v_employee.id, v_employee.store_id, p_attendance_date, v_shift.id,
      v_punch_in_at, v_punch_out_at, v_facts.o_working_minutes, v_facts.o_late_minutes, v_facts.o_late_rule_id,
      v_facts.o_used_information, v_facts.o_information_rule_id, v_facts.o_half_day_reason, v_facts.o_half_day_rule_id,
      v_facts.o_penalty_minutes, v_facts.o_penalty_rule_id, v_facts.o_early_going_minutes, v_facts.o_early_going_rule_id,
      v_facts.o_overtime_minutes, v_facts.o_overtime_rule_id, v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_facts.o_extended_duty_rule_id,
      v_final_status::public.attendance_status, 'admin', p_remark, auth.uid(), auth.uid()
    ) returning * into v_existing;
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
$$ language plpgsql security definer;
