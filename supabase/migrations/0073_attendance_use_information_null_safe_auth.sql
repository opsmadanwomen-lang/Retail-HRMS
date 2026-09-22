-- ============================================================================
-- Retail HRMS — attendance_use_information() NULL-safe authorization check
-- (migration 0073)
--
-- BUG (found during mandatory testing): `if not public.is_super_admin() then
-- raise ...` is NOT NULL-safe. is_super_admin() returns
-- `current_user_role() = 'super_admin'`, and current_user_role() returns
-- NULL whenever auth.uid() has no matching profiles row (an unauthenticated
-- caller, or -- as this test proved -- any id with no profile at all). In
-- PL/pgSQL, `IF NULL THEN ... END IF` treats a NULL condition as FALSE, so
-- `if not is_super_admin()` with is_super_admin() = NULL evaluates `not NULL`
-- = NULL = "do not enter the branch" -- silently SKIPPING the permission
-- check instead of blocking. In real production use this callable is only
-- reachable by an authenticated Supabase session (grant execute ... to
-- authenticated, enforced by PostgREST before this function ever runs), and
-- every authenticated user in this app always has a matching profiles row,
-- so the gap was not exploitable end-to-end -- but the check itself was not
-- a reliable, self-contained guarantee, and this migration closes that gap
-- directly rather than relying on that external precondition.
--
-- FIX: `if is_super_admin() is not true then raise ...` -- true only when
-- is_super_admin() is the literal boolean true; both false and NULL now
-- correctly block. No other line changes from migration 0072.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.attendance_use_information(
  p_attendance_record_id uuid,
  p_remark text DEFAULT NULL
)
RETURNS public.attendance_records
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_record public.attendance_records%rowtype;
  v_info_rule_id uuid;
  v_monthly_limit int;
  v_month_start date;
  v_month_end date;
  v_used_count int;
  v_already_used boolean;
  v_facts record;
begin
  if public.is_super_admin() is not true then
    raise exception 'Only Super Admin can manually use Information/Intimation.' using errcode = '42501';
  end if;

  select * into v_record from public.attendance_records where id = p_attendance_record_id;
  if not found then
    raise exception 'Attendance record not found.';
  end if;

  if v_record.punch_in_at is null then
    raise exception 'This attendance record has no Punch In and cannot use Information.';
  end if;

  -- Serialize concurrent "Use Information" calls for this employee's month BEFORE any check below,
  -- so two concurrent requests for two different dates can never both pass the quota check and
  -- over-consume the monthly limit. Auto-released at transaction end.
  perform pg_advisory_xact_lock(hashtextextended(v_record.employee_id::text || '#' || to_char(v_record.attendance_date, 'YYYY-MM'), 0));

  -- Never consume twice for the same attendance date -- read directly from the existing usage
  -- history (the authoritative source), not from any independently-tracked flag.
  select exists(
    select 1 from public.employee_information_usage
    where employee_id = v_record.employee_id and attendance_date = v_record.attendance_date
  ) into v_already_used;
  if v_already_used then
    raise exception 'Information has already been used for this attendance date.' using errcode = '23505';
  end if;

  -- Same authoritative resolver every other rule kind uses -- never independently decided here.
  v_info_rule_id := public.resolve_attendance_rule(
    v_record.company_id, v_record.employee_id, v_record.shift_id, v_record.store_id, v_record.attendance_date, 'information'
  );
  if v_info_rule_id is null then
    raise exception 'No Information/Intimation Rule is assigned for this employee/store/date.';
  end if;

  select monthly_limit into v_monthly_limit
  from public.attendance_information_rules
  where id = v_info_rule_id and is_active;
  if v_monthly_limit is null then
    raise exception 'The resolved Information/Intimation Rule is not active.';
  end if;

  v_month_start := date_trunc('month', v_record.attendance_date)::date;
  v_month_end := (date_trunc('month', v_record.attendance_date) + interval '1 month - 1 day')::date;

  select count(*) into v_used_count
  from public.employee_information_usage
  where employee_id = v_record.employee_id
    and attendance_date >= v_month_start and attendance_date <= v_month_end;

  if v_used_count >= v_monthly_limit then
    raise exception 'Monthly Information limit reached (%/%).', v_used_count, v_monthly_limit;
  end if;

  -- THE authoritative chain -- this call's own internal compute_late_and_penalty_facts() is what
  -- actually inserts the employee_information_usage row (existing formula, byte-for-byte
  -- unchanged) and reapplies the Information noon-cutoff basis, with any downstream Penalty
  -- interaction the existing rules already define.
  select * into v_facts from public.compute_extended_attendance_facts(
    v_record.company_id, v_record.employee_id, v_record.shift_id, v_record.store_id, v_record.attendance_date,
    v_record.punch_in_at, v_record.punch_out_at, true, null
  );

  if not v_facts.o_used_information then
    -- Defensive: the compute engine itself declined to mark Information used (e.g. a legitimate
    -- edge case in its own quota logic) -- do not silently proceed as if it succeeded.
    raise exception 'Information could not be applied for this attendance record.';
  end if;

  update public.attendance_records set
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
    updated_by = auth.uid(),
    updated_at = now()
  where id = v_record.id
  returning * into v_record;

  -- Enrich the usage row's remark (the compute engine's own insert only sets used_by) -- additive,
  -- never touches which row exists or the quota logic that created it.
  if p_remark is not null and length(trim(p_remark)) > 0 then
    update public.employee_information_usage
    set remark = p_remark
    where employee_id = v_record.employee_id and attendance_date = v_record.attendance_date;
  end if;

  insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
  values (
    v_record.company_id, v_record.employee_id, v_record.id, 'admin_correction', 'admin', auth.uid(),
    format(
      'Information Used (manual): rule %s, monthly usage %s/%s -> %s/%s.%s',
      v_info_rule_id, v_used_count, v_monthly_limit, v_used_count + 1, v_monthly_limit,
      case when p_remark is not null and length(trim(p_remark)) > 0 then ' Reason: ' || p_remark else '' end
    )
  );

  return v_record;
end;
$function$;
