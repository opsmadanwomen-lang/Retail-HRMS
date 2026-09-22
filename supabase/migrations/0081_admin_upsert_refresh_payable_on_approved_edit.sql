-- ============================================================================
-- Retail HRMS — attendance_admin_upsert(): keep payable_* in sync when a
-- Punch Out is corrected on an ALREADY-APPROVED Night Duty record
-- Migration 0081
--
-- ROOT CAUSE (confirmed via read-only investigation + the generic audit_logs
-- before/after diff on the live 06-Aug-2026 test record):
--
--   attendance_admin_upsert() always fully RECOMPUTES and REPLACES
--   working_minutes / overtime_minutes / night_ot_minutes / extra_duty_value
--   from the submitted Punch In/Out via compute_extended_attendance_facts()
--   -> calculate_extended_duty() -- confirmed NOT accumulating: editing this
--   record's Punch Out from 08:30 AM to 08:59 AM correctly replaced
--   night_ot_minutes 30 -> 59 (not 30+59=89, not any other combination).
--   calculate_extended_duty() itself is untouched by this migration.
--
--   The actual bug: this RPC never touches payable_working_minutes /
--   payable_overtime_minutes / payable_extra_duty_value at all -- those are
--   only ever written by the OM/Super Manager decide RPCs (migrations
--   0047/0049), at the moment of approval. So once a record is already
--   Final Approved, a LATER Punch Out correction (this Manual Staff
--   Attendance edit flow) silently leaves the payable_* columns frozen at
--   their old approval-time snapshot while the underlying facts move on --
--   confirmed live: payable_overtime_minutes stayed 30 while night_ot_minutes
--   correctly became 59 and overtime_minutes became 210 (should be 240 payable).
--
-- FIX: after the existing upsert logic (completely unchanged, still the sole
-- place Total Working/Break Deduction/Final Working/Late/Half Day/Normal
-- OT/Night OT/Night Duty Days are calculated), if the record already has a
-- Night Duty approval that is FINAL APPROVED, refresh payable_working_minutes
-- /payable_overtime_minutes/payable_extra_duty_value from the just-
-- recalculated facts -- the EXACT SAME formula the approve RPC itself uses
-- (payable_overtime_minutes = overtime_minutes + night_ot_minutes,
-- payable_extra_duty_value = extra_duty_value). Pending and Disallowed
-- records are untouched -- approval controls payability, not the
-- calculation; this only keeps an ALREADY-approved record's payable snapshot
-- from going stale after a later correction, it never grants payability on
-- its own. Approval status/approver/timestamps and the OM/Super Manager
-- decide RPCs are not touched by this migration at all.
--
-- Every other line of this function is byte-for-byte identical to migration
-- 0074 (the currently-live definition) -- only the new block after the
-- insert/update is added.
-- ============================================================================

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

  -- FIX: only the exact-equal case is rejected now ("preserve existing behavior" for that one
  -- case, per spec). Punch Out < Punch In is a legitimate overnight shift, handled below by
  -- normalizing Punch Out onto the NEXT calendar day -- never rejected.
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
    -- Overnight normalization: a Punch Out clock-time strictly earlier than Punch In's means the
    -- employee punched out on the NEXT calendar day (e.g. In 10:30 AM, Out 02:30 AM -> 06:30
    -- next day). Same-day (Out > In) and no-Punch-In-given cases are unchanged.
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

  -- NEW (migration 0081): if this record already has a FINAL APPROVED Night Duty request, keep
  -- payable_* in sync with the facts just recalculated above -- the exact same formula the
  -- approve RPC itself uses. Pending/Disallowed records are deliberately excluded: approval
  -- controls payability, this step never grants it, only keeps an already-granted snapshot from
  -- going stale after a later Punch Out correction.
  if v_existing.night_duty_approval_id is not null then
    if exists (
      select 1 from public.attendance_night_duty_approvals
      where id = v_existing.night_duty_approval_id
        and approval_status in ('approved', 'om_approved', 'super_manager_approved')
    ) then
      update public.attendance_records
      set payable_working_minutes = working_minutes,
          payable_overtime_minutes = coalesce(overtime_minutes, 0) + coalesce(night_ot_minutes, 0),
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
