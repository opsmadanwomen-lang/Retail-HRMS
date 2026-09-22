-- ============================================================================
-- Retail HRMS — attendance_explain_rules() must NEVER call the compute engine
-- with p_use_information=true (migration 0070)
--
-- BUG (found during mandatory testing): compute_late_and_penalty_facts()'s
-- exhaustion check is MONTHLY-COUNT-based ("how many usage rows exist this
-- month" >= limit), not per-date -- so even the migration-0069 guard ("only
-- pass true when a usage row for THIS EXACT DATE already exists") still
-- raises "No Information/Intimation remaining" whenever that date's own
-- usage row happens to be the one that fills the monthly quota (trivially
-- true whenever monthlyLimit=1, and possible at any limit). A read-only
-- "explain" endpoint must never be able to raise attendance_admin_upsert()'s
-- own validation exception just from being viewed.
--
-- FIX: attendance_explain_rules() now NEVER passes p_use_information=true to
-- compute_extended_attendance_facts() -- it is always called with false,
-- which is unconditionally safe (no exception, no insert, ever). Whether
-- Information was actually used on this historical day is instead read
-- directly from employee_information_usage (a plain, pure SELECT -- exactly
-- the same check compute_late_and_penalty_facts() itself does internally,
-- reused for introspection, not reimplemented as a formula). p_use_
-- information stays in the signature for interface stability but no longer
-- has any effect.
--
-- CONSEQUENCE (disclosed, not hidden): on a historical day that genuinely
-- used the Information Rule's noon-cutoff basis, this function cannot safely
-- replay that exact Late figure live (doing so would require either risking
-- the exception above, or duplicating the noon-cutoff formula here, both
-- explicitly disallowed). The 'late' kind's row instead shows result_value
-- = null with an explicit note pointing at the Information Rule section and
-- the record's own stored Late value, rather than silently showing a
-- possibly-wrong shift-start-based number.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.attendance_explain_rules(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_punch_in_at timestamptz,
  p_punch_out_at timestamptz,
  p_use_information boolean default false
)
RETURNS TABLE (
  kind text,
  rule_id uuid,
  is_assigned boolean,
  triggered boolean,
  scope_source text,
  resolved_store_id uuid,
  resolved_employee_id uuid,
  effective_from date,
  effective_to date,
  config jsonb,
  result_value numeric,
  result_note text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_facts record;
  v_is_weekly_off boolean;
  v_information_already_used boolean;
  v_kinds text[] := array['late','weekly_off_late','information','penalty','half_day','early_going','overtime','extended_duty'];
  v_kind text;
  v_column text;
  v_rule_id uuid;
  v_scope_source text;
  v_row_store_id uuid;
  v_row_employee_id uuid;
  v_row_effective_from date;
  v_row_effective_to date;
  v_config jsonb;
  v_result numeric;
  v_note text;
  v_triggered boolean;
  v_month_start date;
  v_month_end date;
  v_used_count int;
begin
  select exists(
    select 1 from public.employee_information_usage
    where employee_id = p_employee_id and attendance_date = p_attendance_date
  ) into v_information_already_used;

  -- Always false: this is a read-only explain endpoint and must never be able to trigger
  -- compute_late_and_penalty_facts()'s own quota-exhaustion exception or its usage INSERT, no
  -- matter what p_use_information was passed. See migration notes above.
  select * into v_facts from public.compute_extended_attendance_facts(
    p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date,
    p_punch_in_at, p_punch_out_at, false, null
  );
  v_is_weekly_off := public.is_weekly_off_on_date(p_employee_id, p_attendance_date);

  foreach v_kind in array v_kinds loop
    v_column := case v_kind
      when 'late' then 'late_rule_id'
      when 'overtime' then 'overtime_rule_id'
      when 'information' then 'information_rule_id'
      when 'penalty' then 'penalty_rule_id'
      when 'half_day' then 'half_day_rule_id'
      when 'early_going' then 'early_going_rule_id'
      when 'extended_duty' then 'extended_duty_rule_id'
      when 'weekly_off_late' then 'weekly_off_late_rule_id'
    end;

    v_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, v_kind);
    v_scope_source := null;
    v_row_store_id := null;
    v_row_employee_id := null;
    v_row_effective_from := null;
    v_row_effective_to := null;

    if v_rule_id is not null then
      execute format(
        'select store_id, employee_id, effective_from, effective_to
           from public.attendance_rule_assignments
           where company_id = $1 and scope_type = ''store_employee'' and employee_id = $2
             and (store_id is null or store_id = $3) and is_active and %I = $4
             and effective_from <= $5 and (effective_to is null or effective_to >= $5)
           order by (store_id is not null) desc, effective_from desc
           limit 1', v_column
      ) into v_row_store_id, v_row_employee_id, v_row_effective_from, v_row_effective_to
        using p_company_id, p_employee_id, p_store_id, v_rule_id, p_attendance_date;
      if found then
        v_scope_source := 'employee_store';
      end if;

      if v_scope_source is null and p_store_id is not null then
        execute format(
          'select store_id, employee_id, effective_from, effective_to
             from public.attendance_rule_assignments
             where company_id = $1 and scope_type = ''store_employee'' and store_id = $2 and employee_id is null
               and is_active and %I = $3
               and effective_from <= $4 and (effective_to is null or effective_to >= $4)
             order by effective_from desc
             limit 1', v_column
        ) into v_row_store_id, v_row_employee_id, v_row_effective_from, v_row_effective_to
          using p_company_id, p_store_id, v_rule_id, p_attendance_date;
        if found then
          v_scope_source := 'store_all_employees';
        end if;
      end if;

      if v_scope_source is null then
        execute format(
          'select store_id, employee_id, effective_from, effective_to
             from public.attendance_rule_assignments
             where company_id = $1 and scope_type = ''store_employee'' and store_id is null and employee_id is null
               and is_active and %I = $2
               and effective_from <= $3 and (effective_to is null or effective_to >= $3)
             order by effective_from desc
             limit 1', v_column
        ) into v_row_store_id, v_row_employee_id, v_row_effective_from, v_row_effective_to
          using p_company_id, v_rule_id, p_attendance_date;
        if found then
          v_scope_source := 'all_stores_all_employees';
        end if;
      end if;

      if v_scope_source is null then
        -- Legacy Employee/Shift/Store/Company ladder -- only ever populated for late/overtime.
        execute format(
          'select null::uuid, null::uuid, effective_from, effective_to
             from public.attendance_rule_assignments
             where company_id = $1 and %I = $2
               and effective_from <= $3 and (effective_to is null or effective_to >= $3)
             order by effective_from desc
             limit 1', v_column
        ) into v_row_store_id, v_row_employee_id, v_row_effective_from, v_row_effective_to
          using p_company_id, v_rule_id, p_attendance_date;
        if found then
          v_scope_source := 'legacy';
        end if;
      end if;
    end if;

    v_config := null;
    v_result := null;
    v_triggered := false;
    v_note := null;

    if v_kind = 'late' then
      if v_rule_id is not null then
        select jsonb_build_object('graceMinutes', minimum_late_minutes, 'calculationMethod', calculation_method, 'roundingMethod', rounding_method, 'maximumLateMinutes', maximum_late_minutes)
          into v_config from public.attendance_late_rules where id = v_rule_id;
      end if;
      if v_is_weekly_off then
        v_note := 'Not applicable -- Weekly Off Late Rule governed this day instead';
      elsif v_information_already_used then
        v_note := 'Historical Information/Intimation Day -- see the Information Rule section and this record''s stored Late value; not safely re-derivable live here.';
      else
        v_result := v_facts.o_late_minutes;
        v_triggered := coalesce(v_facts.o_late_minutes, 0) > 0;
      end if;

    elsif v_kind = 'weekly_off_late' then
      if v_rule_id is not null then
        select jsonb_build_object('cutoffTime', cutoff_time) into v_config from public.attendance_weekly_off_late_rules where id = v_rule_id;
      end if;
      if not v_is_weekly_off then
        v_note := 'Not applicable -- this is not a Weekly Off day';
      else
        v_result := v_facts.o_late_minutes;
        v_triggered := coalesce(v_facts.o_late_minutes, 0) > 0;
      end if;

    elsif v_kind = 'information' then
      if v_rule_id is not null then
        select jsonb_build_object('cutoffTime', cutoff_time, 'monthlyLimit', monthly_limit, 'applicableOnWeeklyOff', applicable_on_weekly_off)
          into v_config from public.attendance_information_rules where id = v_rule_id;
        v_month_start := date_trunc('month', p_attendance_date)::date;
        v_month_end := (date_trunc('month', p_attendance_date) + interval '1 month - 1 day')::date;
        select count(*) into v_used_count from public.employee_information_usage
          where employee_id = p_employee_id and attendance_date >= v_month_start and attendance_date <= v_month_end;
        v_config := v_config || jsonb_build_object('monthlyUsage', v_used_count);
      end if;
      -- Read directly from history (never from a live p_use_information=true call -- see above).
      v_triggered := v_information_already_used;
      v_note := case when v_triggered then 'Triggered' else 'Not Triggered' end;

    elsif v_kind = 'penalty' then
      if v_rule_id is not null then
        select jsonb_build_object('method', method, 'fixedMinutes', fixed_minutes, 'multiplier', multiplier, 'applicability', applicability, 'applyOnWeeklyOff', apply_on_weekly_off, 'applyOnInformationDay', apply_on_information_day)
          into v_config from public.attendance_penalty_rules where id = v_rule_id;
      end if;
      v_result := v_facts.o_penalty_minutes;
      v_triggered := coalesce(v_facts.o_penalty_minutes, 0) > 0;

    elsif v_kind = 'half_day' then
      if v_rule_id is not null then
        select jsonb_build_object('lateArrivalCutoffTime', late_arrival_cutoff_time, 'earlyGoingCutoffTime', early_going_cutoff_time)
          into v_config from public.attendance_half_day_rules where id = v_rule_id;
      end if;
      v_triggered := v_facts.o_half_day_reason is not null;
      v_note := coalesce(v_facts.o_half_day_reason, 'Not Triggered');

    elsif v_kind = 'early_going' then
      if v_rule_id is not null then
        select jsonb_build_object('graceMinutes', grace_minutes, 'calculationMethod', calculation_method, 'roundingMethod', rounding_method)
          into v_config from public.attendance_early_going_rules where id = v_rule_id;
      end if;
      v_result := v_facts.o_early_going_minutes;
      v_triggered := coalesce(v_facts.o_early_going_minutes, 0) > 0;

    elsif v_kind = 'overtime' then
      if v_rule_id is not null then
        select jsonb_build_object('minimumOvertimeMinutes', minimum_overtime_minutes, 'maximumOvertimeMinutes', maximum_overtime_minutes, 'calculationMethod', calculation_method, 'roundingMethod', rounding_method, 'weeklyOffOvertimeAllowed', weekly_off_overtime_allowed, 'holidayOvertimeAllowed', holiday_overtime_allowed)
          into v_config from public.attendance_overtime_rules where id = v_rule_id;
      end if;
      v_result := v_facts.o_overtime_minutes;
      v_triggered := coalesce(v_facts.o_overtime_minutes, 0) > 0;

    elsif v_kind = 'extended_duty' then
      if v_rule_id is not null then
        select jsonb_build_object('midnightThresholdTime', midnight_threshold_time, 'midnightExtraDutyValue', midnight_extra_duty_value, 'firstDaySalaryThresholdTime', first_day_salary_threshold_time, 'firstDayExtraDutyValue', first_day_extra_duty_value, 'secondDaySalaryThresholdTime', second_day_salary_threshold_time, 'secondDayExtraDutyValue', second_day_extra_duty_value)
          into v_config from public.attendance_extended_duty_rules where id = v_rule_id;
      end if;
      v_result := coalesce(v_facts.o_extra_duty_value, 0);
      v_triggered := coalesce(v_facts.o_extra_duty_value, 0) > 0 or coalesce(v_facts.o_night_ot_minutes, 0) > 0;
      if v_triggered then
        v_note := format('Extra Duty %s, Night OT %s min', coalesce(v_facts.o_extra_duty_value, 0), coalesce(v_facts.o_night_ot_minutes, 0));
      end if;
    end if;

    kind := v_kind;
    rule_id := v_rule_id;
    is_assigned := v_rule_id is not null;
    triggered := v_triggered;
    scope_source := v_scope_source;
    resolved_store_id := v_row_store_id;
    resolved_employee_id := v_row_employee_id;
    effective_from := v_row_effective_from;
    effective_to := v_row_effective_to;
    config := v_config;
    result_value := v_result;
    result_note := v_note;
    return next;
  end loop;
end;
$function$;
