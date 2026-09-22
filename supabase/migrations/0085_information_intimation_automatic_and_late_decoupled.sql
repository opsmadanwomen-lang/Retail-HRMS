-- ============================================================================
-- Retail HRMS — Late Information / Intimation Rule: automatic determination,
-- Actual Late decoupled from Information, cutoff-time properly gates
-- eligibility, no accumulation on recompute (migration 0085)
--
-- ROOT CAUSE (confirmed by inspecting the live compute_late_and_penalty_facts()
-- definition, per explicit user investigation, and confirmed decision: Information
-- must be fully automatic, not employee/admin opt-in):
--
--   1. Information/Intimation was a MANUAL, opt-in-only feature (a "Use an
--      Information/Intimation for today" checkbox at Punch In, or an explicit
--      p_use_information=true passed by Admin) -- migration 0042's own comment
--      calls it "the self-service 'use Information' path". It was never decided
--      automatically from remaining monthly balance. Confirmed via the intended
--      business rule (every example/test describes automatic consumption on the
--      Nth applicable late arrival, with no employee action) that this must
--      change to fully automatic.
--
--   2. WHEN Information was used (old design), the Late-minutes calculation
--      itself switched its base time from Shift Start to the Information Rule's
--      own cutoff_time ("noon rule") -- i.e. using Information didn't just waive
--      the Penalty, it also silently RECOMPUTED (usually zeroed) Actual Late.
--      This directly contradicts the confirmed rule: "Actual Late and
--      Information/Intimation are separate ... Actual Late must remain [the
--      shift-start-based value] ... Penalty must remain a separate value."
--
--   3. The Information Rule's cutoff_time (12:00 PM) was therefore being used
--      as an alternate LATE BASE TIME, not as an ELIGIBILITY GATE on how late an
--      arrival can be and still qualify for Information -- the correct, intended
--      meaning per the user's own framing ("Is Information applicable only when
--      Punch In is before/after 12:00 PM?").
--
-- FIX (smallest change that preserves the single authoritative calculation
-- engine -- no second/duplicate formula anywhere):
--
--   - Actual Late (o_late_minutes) is now ALWAYS computed from Shift Start (or
--     the independent Weekly Off Late Rule's own cutoff on Weekly Off days,
--     and the Half Day Rule's own late-arrival cutoff on Half Day days) --
--     Information never changes this. The "noon rule" late-base-time branch is
--     removed entirely.
--
--   - Information/Intimation usage is now decided AUTOMATICALLY, inside
--     compute_late_and_penalty_facts() itself (the one authoritative engine
--     every caller already shares -- attendance_punch_in() directly,
--     attendance_admin_upsert()/attendance_punch_out() via
--     compute_extended_attendance_facts(), and attendance_explain_rules() via
--     the same wrapper in a new read-only mode -- see below): eligible only
--     when a rule is configured, this attendance_date has an actual late
--     arrival (o_late_minutes > 0), it is not a Half Day late-coming case
--     (Penalty never applies there regardless, so consuming a scarce monthly
--     allowance there would be pure waste), the punch-in falls at/before the
--     Information Rule's own cutoff_time, and -- only on a Weekly Off day --
--     the Information Rule's own applicable_on_weekly_off toggle allows it.
--     If eligible and this month's used-count is still under monthly_limit,
--     Information is consumed (usage row inserted, o_used_information := true)
--     -- otherwise it is not, and Penalty applies per the configured Penalty
--     Rule, exactly as before. The manual p_use_information parameter is kept
--     in every signature for call-compatibility but is no longer read.
--
--   - NO ACCUMULATION: every commit-mode call now DELETEs any existing
--     employee_information_usage row for this exact (employee_id,
--     attendance_date) before recomputing this month's used-count and
--     re-deciding eligibility. This makes each Punch In / Punch Out / Manual
--     Attendance Edit recompute fully idempotent from a clean slate for its
--     own date -- a stale usage row from a prior calculation of this exact day
--     can never linger (e.g. after an edit makes the day no longer an
--     applicable late) or inflate this month's count on a genuine recompute.
--
--   - READ-ONLY SAFETY (preserves the migration-0070 invariant): a new
--     p_read_only parameter (default false) is threaded through
--     compute_late_and_penalty_facts() and compute_extended_attendance_facts().
--     attendance_explain_rules() -- a pure introspection/preview endpoint used
--     merely by opening the Super Admin Edit Attendance dialog -- now passes
--     p_read_only=true, so it can preview what WOULD happen (same eligibility
--     formula, plain non-deleting count) without ever deleting or inserting a
--     usage row purely from being viewed. attendance_punch_in(),
--     attendance_admin_upsert() and attendance_punch_out() all keep the
--     default (false = commit mode), unchanged.
--
-- NOT CHANGED: Weekly Off Late's own cutoff-based calculation, the Half Day
-- Rule's own late-arrival override, the Penalty Rule's applicability switch
-- (only the internal variable it reads was renamed from v_uses_noon_rule to
-- o_used_information -- identical structure/semantics, now automatically
-- decided instead of manually flagged), the monthly count's
-- employee+month scoping (already correct), Night Duty / Night OT / Overtime /
-- Break Deduction / Final Working -- none of these are touched by this
-- migration.
-- ============================================================================

drop function if exists public.compute_late_and_penalty_facts(uuid, uuid, uuid, uuid, date, timestamptz, boolean, text);

create or replace function public.compute_late_and_penalty_facts(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_punch_in_at timestamptz,
  p_use_information boolean,
  p_day_type_override text default null,
  p_read_only boolean default false,
  out o_late_minutes integer,
  out o_late_rule_id uuid,
  out o_used_information boolean,
  out o_information_rule_id uuid,
  out o_is_weekly_off boolean,
  out o_half_day_late_coming boolean,
  out o_half_day_rule_id uuid,
  out o_penalty_minutes integer,
  out o_penalty_rule_id uuid
)
returns record
language plpgsql
security definer
as $function$
declare
  v_shift public.attendance_shifts%rowtype;
  v_info_rule public.attendance_information_rules%rowtype;
  v_wo_rule public.attendance_weekly_off_late_rules%rowtype;
  v_half_day_rule public.attendance_half_day_rules%rowtype;
  v_penalty_rule public.attendance_penalty_rules%rowtype;
  v_punch_in_ist_time time;
  v_info_eligible boolean := false;
  v_late_base_time time;
  v_raw_late int;
  v_month_start date;
  v_month_end date;
  v_used_count int := 0;
  v_penalty_applicable boolean := false;
  v_day_type text;
  v_resolved_id uuid;
  v_uses_weekly_off_rule boolean := false;
begin
  o_late_minutes := 0;
  o_late_rule_id := null;
  o_used_information := false;
  o_information_rule_id := null;
  o_is_weekly_off := false;
  o_half_day_late_coming := false;
  o_half_day_rule_id := null;
  o_penalty_minutes := 0;
  o_penalty_rule_id := null;

  if p_punch_in_at is null then
    return;
  end if;

  select * into v_shift from public.attendance_shifts where id = p_shift_id;
  v_punch_in_ist_time := (p_punch_in_at at time zone 'Asia/Kolkata')::time;

  o_is_weekly_off := public.is_weekly_off_on_date(p_employee_id, p_attendance_date);
  v_day_type := coalesce(p_day_type_override, case when o_is_weekly_off then 'weekly_off' else 'normal' end);

  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'information');
  if v_resolved_id is not null then
    select * into v_info_rule from public.attendance_information_rules where id = v_resolved_id and is_active;
  end if;
  if v_info_rule.id is null then
    select * into v_info_rule
    from public.attendance_information_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
  o_information_rule_id := v_info_rule.id;

  if v_info_rule.id is not null then
    if not p_read_only then
      -- No accumulation: always start THIS date's own Information-usage contribution from a clean
      -- slate before recomputing. Critical for Manual Attendance Edit / re-punch scenarios -- a
      -- stale usage row from a prior calculation of this exact (employee, date) must never linger
      -- after an edit makes the day no longer an applicable late, and must never inflate this
      -- month's count on a genuine recompute of the same day.
      delete from public.employee_information_usage
      where employee_id = p_employee_id
        and attendance_date = p_attendance_date;
    end if;

    v_month_start := date_trunc('month', p_attendance_date)::date;
    v_month_end := (date_trunc('month', p_attendance_date) + interval '1 month - 1 day')::date;

    select count(*) into v_used_count
    from public.employee_information_usage
    where employee_id = p_employee_id
      and attendance_date >= v_month_start
      and attendance_date <= v_month_end;
  end if;

  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'weekly_off_late');
  if v_resolved_id is not null then
    select * into v_wo_rule from public.attendance_weekly_off_late_rules where id = v_resolved_id and is_active;
  end if;
  if v_wo_rule.id is null then
    select * into v_wo_rule
    from public.attendance_weekly_off_late_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;

  -- Actual Late is now ALWAYS computed from Shift Start (or the Weekly Off Late Rule's own cutoff
  -- on Weekly Off days) -- Information/Intimation never changes this base time. The old "noon rule"
  -- branch (switching the late base to the Information Rule's cutoff_time whenever Information was
  -- used) is removed: Actual Late and Information must remain fully independent values.
  if o_is_weekly_off and v_wo_rule.id is not null then
    v_uses_weekly_off_rule := true;
    v_late_base_time := v_wo_rule.cutoff_time;
    if v_punch_in_ist_time <= v_late_base_time then
      v_raw_late := 0;
    else
      v_raw_late := floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int;
    end if;
  else
    v_late_base_time := v_shift.start_time;
    v_raw_late := greatest(0, floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int);
  end if;

  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'half_day');
  if v_resolved_id is not null then
    select * into v_half_day_rule from public.attendance_half_day_rules where id = v_resolved_id and is_active;
  end if;
  if v_half_day_rule.id is null then
    select * into v_half_day_rule
    from public.attendance_half_day_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
  o_half_day_rule_id := v_half_day_rule.id;

  if v_half_day_rule.id is not null and v_punch_in_ist_time >= v_half_day_rule.late_arrival_cutoff_time then
    o_half_day_late_coming := true;
    v_raw_late := greatest(0, floor(extract(epoch from (v_punch_in_ist_time - v_half_day_rule.late_arrival_cutoff_time)) / 60)::int);
    v_uses_weekly_off_rule := false;
  end if;

  o_late_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'late');

  if v_uses_weekly_off_rule then
    o_late_minutes := v_raw_late;
  else
    o_late_minutes := public.calculate_late_minutes(o_late_rule_id, v_raw_late);
  end if;

  -- AUTOMATIC Information/Intimation determination. No longer gated by the manual p_use_information
  -- flag (kept in the signature only for call-compatibility -- no longer read). Eligible only when:
  -- a rule is configured, there IS an actual late arrival, this is not a Half Day late-coming case
  -- (Penalty never applies there regardless -- see below -- so consuming a scarce monthly allowance
  -- there would be pure waste), the punch-in falls at/before the Information Rule's own configured
  -- cutoff_time (severe lateness past the cutoff is never covered), and -- only on a Weekly Off day
  -- -- the Information Rule's own applicable_on_weekly_off toggle allows it.
  if v_info_rule.id is not null then
    v_info_eligible := o_late_minutes > 0
      and not o_half_day_late_coming
      and v_punch_in_ist_time <= v_info_rule.cutoff_time
      and (not o_is_weekly_off or coalesce(v_info_rule.applicable_on_weekly_off, true));

    if v_info_eligible and v_used_count < v_info_rule.monthly_limit then
      if not p_read_only then
        insert into public.employee_information_usage (company_id, employee_id, attendance_date, used_by)
        values (p_company_id, p_employee_id, p_attendance_date, auth.uid())
        on conflict (employee_id, attendance_date) do nothing;
      end if;
      o_used_information := true;
    end if;
  end if;

  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'penalty');
  if v_resolved_id is not null then
    select * into v_penalty_rule from public.attendance_penalty_rules where id = v_resolved_id and is_active;
  end if;
  if v_penalty_rule.id is null then
    select * into v_penalty_rule
    from public.attendance_penalty_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
  o_penalty_rule_id := v_penalty_rule.id;

  if v_penalty_rule.id is not null and o_late_minutes > 0 then
    if o_half_day_late_coming then
      v_penalty_applicable := false;
    elsif o_is_weekly_off then
      v_penalty_applicable := coalesce(v_penalty_rule.apply_on_weekly_off, false);
    elsif o_used_information then
      v_penalty_applicable := coalesce(v_penalty_rule.apply_on_information_day, false);
    else
      v_penalty_applicable := case v_penalty_rule.applicability
        when 'every_late' then true
        when 'after_information_exhausted' then not o_used_information
        when 'normal_day_only' then not o_used_information and not o_is_weekly_off
        when 'information_day_after_cutoff' then o_used_information
        when 'weekly_off' then o_is_weekly_off
        when 'half_day' then o_half_day_late_coming
        else true
      end;
    end if;

    if v_penalty_applicable then
      o_penalty_minutes := public.calculate_penalty_minutes(o_penalty_rule_id, o_late_minutes);
    end if;
  end if;

  if not coalesce(v_shift.late_eligible, true) or v_day_type = 'holiday' then
    o_late_minutes := 0;
    o_half_day_late_coming := false;
    o_penalty_minutes := 0;
  end if;
end;
$function$;

grant execute on function public.compute_late_and_penalty_facts(uuid, uuid, uuid, uuid, date, timestamptz, boolean, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- compute_extended_attendance_facts() — thread the new p_read_only flag through
-- to compute_late_and_penalty_facts(). Default false (commit mode, unchanged
-- behavior) for attendance_admin_upsert() and attendance_punch_out(), which do
-- not pass it. Every other line of this function is byte-for-byte unchanged.
-- ----------------------------------------------------------------------------

drop function if exists public.compute_extended_attendance_facts(uuid, uuid, uuid, uuid, date, timestamptz, timestamptz, boolean, text);

create or replace function public.compute_extended_attendance_facts(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_punch_in_at timestamptz,
  p_punch_out_at timestamptz,
  p_use_information boolean,
  p_day_type_override text,
  p_read_only boolean default false,
  out o_status text,
  out o_late_minutes integer,
  out o_late_rule_id uuid,
  out o_used_information boolean,
  out o_information_rule_id uuid,
  out o_half_day_reason text,
  out o_half_day_rule_id uuid,
  out o_penalty_minutes integer,
  out o_penalty_rule_id uuid,
  out o_total_working_minutes integer,
  out o_break_deduction_minutes integer,
  out o_working_minutes integer,
  out o_early_going_minutes integer,
  out o_early_going_rule_id uuid,
  out o_overtime_minutes integer,
  out o_overtime_rule_id uuid,
  out o_extra_duty_value numeric,
  out o_night_ot_minutes integer,
  out o_extended_duty_rule_id uuid
)
returns record
language plpgsql
security definer
as $function$
declare
  v_shift public.attendance_shifts%rowtype;
  v_late_facts record;
  v_half_day_rule public.attendance_half_day_rules%rowtype;
  v_early_going_rule public.attendance_early_going_rules%rowtype;
  v_extended_duty_rule_id uuid;
  v_punch_out_ist_time time;
  v_punch_out_ist_date date;
  v_shift_end_at timestamptz;
  v_raw_overtime int;
  v_ext record;
  v_early_going_base_time time;
  v_raw_early_going int;
  v_is_half_day_early boolean := false;
  v_day_type text;
  v_resolved_id uuid;
begin
  select * into v_shift from public.attendance_shifts where id = p_shift_id;

  select * into v_late_facts from public.compute_late_and_penalty_facts(
    p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, p_punch_in_at, p_use_information, p_day_type_override, p_read_only
  );

  o_late_minutes := v_late_facts.o_late_minutes;
  o_late_rule_id := v_late_facts.o_late_rule_id;
  o_used_information := v_late_facts.o_used_information;
  o_information_rule_id := v_late_facts.o_information_rule_id;
  o_half_day_rule_id := v_late_facts.o_half_day_rule_id;
  o_penalty_minutes := v_late_facts.o_penalty_minutes;
  o_penalty_rule_id := v_late_facts.o_penalty_rule_id;

  o_half_day_reason := case when v_late_facts.o_half_day_late_coming then 'late_coming' else null end;
  o_status := case when o_half_day_reason is not null then 'half_day' else 'present' end;

  o_total_working_minutes := null;
  o_break_deduction_minutes := null;
  o_working_minutes := null;
  o_early_going_minutes := null;
  o_early_going_rule_id := null;
  o_overtime_minutes := null;
  o_overtime_rule_id := null;
  o_extra_duty_value := null;
  o_night_ot_minutes := null;
  o_extended_duty_rule_id := null;

  if p_punch_in_at is null or p_punch_out_at is null then
    return;
  end if;

  v_punch_out_ist_time := (p_punch_out_at at time zone 'Asia/Kolkata')::time;
  v_punch_out_ist_date := (p_punch_out_at at time zone 'Asia/Kolkata')::date;

  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'half_day');
  if v_resolved_id is not null then
    select * into v_half_day_rule from public.attendance_half_day_rules where id = v_resolved_id and is_active;
  end if;
  if v_half_day_rule.id is null then
    select * into v_half_day_rule
    from public.attendance_half_day_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;

  if v_half_day_rule.id is not null and v_punch_out_ist_date = p_attendance_date and v_punch_out_ist_time <= v_half_day_rule.early_going_cutoff_time then
    v_is_half_day_early := true;
    if o_half_day_reason is null then
      o_half_day_reason := 'early_going';
    end if;
    o_status := 'half_day';
  end if;

  o_total_working_minutes := greatest(0, floor(extract(epoch from (p_punch_out_at - p_punch_in_at)) / 60)::int);
  o_break_deduction_minutes := coalesce(v_shift.break_minutes, 0);
  o_working_minutes := greatest(0, o_total_working_minutes - o_break_deduction_minutes);

  v_resolved_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'early_going');
  if v_resolved_id is not null then
    select * into v_early_going_rule from public.attendance_early_going_rules where id = v_resolved_id and is_active;
  end if;
  if v_early_going_rule.id is null then
    select * into v_early_going_rule
    from public.attendance_early_going_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
  o_early_going_rule_id := v_early_going_rule.id;

  if v_early_going_rule.id is not null then
    if v_is_half_day_early then
      v_early_going_base_time := v_half_day_rule.early_going_cutoff_time;
      v_raw_early_going := greatest(0, floor(extract(epoch from (v_early_going_base_time - v_punch_out_ist_time)) / 60)::int);
    elsif v_punch_out_ist_date = p_attendance_date and v_punch_out_ist_time < v_shift.end_time then
      v_raw_early_going := floor(extract(epoch from (v_shift.end_time - v_punch_out_ist_time)) / 60)::int;
      if v_raw_early_going <= coalesce(v_early_going_rule.grace_minutes, 0) then
        v_raw_early_going := 0;
      end if;
    else
      v_raw_early_going := 0;
    end if;

    if v_early_going_rule.calculation_method = 'slab' then
      select t.calculated_minutes into o_early_going_minutes
      from public.attendance_early_going_rule_thresholds t
      where t.early_going_rule_id = v_early_going_rule.id
        and t.from_minutes <= v_raw_early_going
        and (t.to_minutes is null or t.to_minutes >= v_raw_early_going)
      order by t.from_minutes desc
      limit 1;
      if o_early_going_minutes is null then
        o_early_going_minutes := v_raw_early_going;
      end if;
    else
      o_early_going_minutes := v_raw_early_going;
    end if;

    o_early_going_minutes := public.apply_attendance_rounding(o_early_going_minutes, v_early_going_rule.rounding_method, v_early_going_rule.custom_rounding_minutes);
  end if;

  v_shift_end_at := (p_attendance_date + v_shift.end_time) at time zone 'Asia/Kolkata';

  v_extended_duty_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'extended_duty');
  if v_extended_duty_rule_id is not null then
    if not exists (select 1 from public.attendance_extended_duty_rules where id = v_extended_duty_rule_id and is_active) then
      v_extended_duty_rule_id := null;
    end if;
  end if;
  if v_extended_duty_rule_id is null then
    select id into v_extended_duty_rule_id
    from public.attendance_extended_duty_rules
    where company_id = p_company_id
      and is_active
      and effective_from <= p_attendance_date
      and (effective_to is null or effective_to >= p_attendance_date)
    order by effective_from desc
    limit 1;
  end if;
  o_extended_duty_rule_id := v_extended_duty_rule_id;

  select * into v_ext from public.calculate_extended_duty(v_extended_duty_rule_id, p_attendance_date, v_shift_end_at, p_punch_out_at);
  o_extra_duty_value := v_ext.o_extra_duty_value;
  o_night_ot_minutes := v_ext.o_night_ot_minutes;

  if v_shift.overtime_enabled then
    v_raw_overtime := v_ext.o_normal_ot_minutes;
    v_day_type := coalesce(p_day_type_override, case when v_late_facts.o_is_weekly_off then 'weekly_off' else 'normal' end);
    o_overtime_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'overtime');
    o_overtime_minutes := public.calculate_overtime_minutes(o_overtime_rule_id, v_raw_overtime, v_day_type);
  else
    o_overtime_minutes := 0;
    o_extra_duty_value := 0;
    o_night_ot_minutes := 0;
  end if;
end;
$function$;

grant execute on function public.compute_extended_attendance_facts(uuid, uuid, uuid, uuid, date, timestamptz, timestamptz, boolean, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- attendance_explain_rules() — external signature UNCHANGED (still 8 params,
-- no frontend/grant change needed). Its internal call to
-- compute_extended_attendance_facts() now passes p_read_only=true, so opening
-- the Super Admin Edit Attendance dialog (which calls this purely to preview)
-- can never delete or insert an employee_information_usage row -- preserving
-- the exact safety invariant migration 0070 established, now under the new
-- automatic-eligibility design. The only other change: the 'late' kind's old
-- "Historical Information/Intimation Day -- not safely re-derivable live here"
-- caveat (migration 0070) is removed, because it no longer applies -- Actual
-- Late is now fully decoupled from Information (see above), so it is always
-- safely re-derivable live regardless of whether Information was used that
-- day. Every other line is unchanged.
-- ----------------------------------------------------------------------------

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

  -- Always read-only: this is a read-only explain endpoint and must never be able to delete or
  -- insert an employee_information_usage row, no matter what p_use_information was passed. See
  -- migration 0085 notes above (and the original migration 0070 invariant this preserves).
  select * into v_facts from public.compute_extended_attendance_facts(
    p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date,
    p_punch_in_at, p_punch_out_at, false, null, true
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

grant execute on function public.attendance_explain_rules(uuid, uuid, uuid, uuid, date, timestamptz, timestamptz, boolean) to authenticated;

