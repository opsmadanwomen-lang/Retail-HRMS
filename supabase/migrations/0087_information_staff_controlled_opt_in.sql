-- ============================================================================
-- Retail HRMS — Information/Intimation reverted to STAFF-CONTROLLED opt-in
-- (migration 0087)
--
-- CORRECTION to migration 0085: Information/Intimation must NOT be automatic.
-- The Staff must be shown an explicit "Use Information/Intimation for today"
-- choice on every applicable late day and can accept or decline it -- the
-- system must never consume it merely because the employee is late, eligible,
-- and has balance.
--
-- KEPT from migration 0085/0086 (still correct, not reverted):
--   - Actual Late is ALWAYS computed from Shift Start (or the Weekly Off Late
--     Rule's own cutoff, or the Half Day Rule's own override) -- Information
--     NEVER changes this. The removed "noon rule" late-base-time branch stays
--     removed.
--   - The Information Rule's cutoff_time is an ELIGIBILITY gate on Punch In
--     time (inclusive <=), never a late-calculation base.
--   - No accumulation: every commit-mode call still deletes any existing usage
--     row for this exact (employee, date) before recomputing, so recomputes
--     are idempotent.
--   - Read-only preview mode (p_read_only) still never writes, and still
--     excludes this record's own date from its preview count.
--
-- REVERTED/CHANGED:
--   - p_use_information is once again a genuine REQUEST flag (Staff's actual
--     checkbox choice), not ignored. Consumption now requires BOTH: the
--     caller requested it (p_use_information = true) AND the backend
--     independently validates it is actually allowed (rule configured, late >
--     0, not Half Day late-coming, within cutoff, Weekly-Off-applicability,
--     and balance remaining) -- the backend is authoritative; a bogus/forced
--     true from a compromised client can never consume Information it is not
--     entitled to.
--   - NEW output: o_information_eligible -- true iff Information WOULD be
--     allowed for this exact call if requested, independent of whether it was
--     actually requested. This is the one authoritative signal
--     attendance_explain_rules() now also surfaces (config.eligibleNow) so the
--     frontend can decide whether to SHOW the "Use Information" checkbox at
--     all, without ever re-deriving the eligibility formula itself.
--   - attendance_admin_upsert(): an ordinary Super Admin edit (Manual Staff
--     Attendance -- which has no Information checkbox of its own) must never
--     silently grant OR revoke the Staff's original choice. It now looks up
--     the EXISTING record's own used_information value first and uses THAT as
--     the request flag (re-validated against the edited punch time) instead
--     of the p_use_information parameter -- so "was Information used" is
--     preserved across an edit, but a now-ineligible edit (e.g. Punch In
--     pushed past the cutoff) correctly clears a now-invalid usage row. A
--     brand-new admin-created record (no prior state) defaults to not used,
--     matching there being no Staff choice to preserve. p_use_information
--     stays in the signature for interface stability but is no longer read.
--   - attendance_use_information() (the Super Admin's dedicated manual-use
--     RPC) is UNCHANGED -- it already explicitly requests true, which is
--     exactly the "explicit request, backend validates" pattern being
--     restored here, so it continues to work exactly as before.
--   - attendance_punch_in() is UNCHANGED -- it already threads its own
--     p_use_information parameter (the Staff's checkbox) straight through;
--     that parameter now has real effect again, validated by the backend.
-- ============================================================================

drop function if exists public.compute_late_and_penalty_facts(uuid, uuid, uuid, uuid, date, timestamptz, boolean, text, boolean);

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
  out o_information_eligible boolean,
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
  o_information_eligible := false;
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
      -- after an edit makes the day no longer an applicable/eligible late, and must never inflate
      -- this month's count on a genuine recompute of the same day.
      delete from public.employee_information_usage
      where employee_id = p_employee_id
        and attendance_date = p_attendance_date;
    end if;

    v_month_start := date_trunc('month', p_attendance_date)::date;
    v_month_end := (date_trunc('month', p_attendance_date) + interval '1 month - 1 day')::date;

    -- In read-only/preview mode (row NOT deleted above), exclude this exact date from the count --
    -- a preview judges "would this record independently qualify against every OTHER day's usage
    -- this month" instead of double-counting the record's own already-persisted contribution.
    select count(*) into v_used_count
    from public.employee_information_usage
    where employee_id = p_employee_id
      and attendance_date >= v_month_start
      and attendance_date <= v_month_end
      and (not p_read_only or attendance_date <> p_attendance_date);
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

  -- Actual Late is ALWAYS computed from Shift Start (or the Weekly Off Late Rule's own cutoff on
  -- Weekly Off days) -- Information/Intimation never changes this base time, whether or not it ends
  -- up used.
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

  -- ELIGIBILITY (independent of whether it was actually requested): a rule is configured, there IS
  -- an actual late arrival, this is not a Half Day late-coming case (Penalty never applies there
  -- regardless, so Information would never help), the punch-in falls at/before the Information
  -- Rule's own configured cutoff_time, -- only on a Weekly Off day -- the Information Rule's own
  -- applicable_on_weekly_off toggle allows it, and this month's balance is not yet exhausted.
  if v_info_rule.id is not null then
    o_information_eligible := o_late_minutes > 0
      and not o_half_day_late_coming
      and v_punch_in_ist_time <= v_info_rule.cutoff_time
      and (not o_is_weekly_off or coalesce(v_info_rule.applicable_on_weekly_off, true))
      and v_used_count < v_info_rule.monthly_limit;
  end if;

  -- STAFF-CONTROLLED CONSUMPTION (migration 0087): only ever consume when BOTH the caller actually
  -- requested it (p_use_information -- the Staff's own checkbox choice at Punch In, or an explicit
  -- Super Admin action via attendance_use_information(), or the preserved prior choice replayed by
  -- attendance_admin_upsert() on an ordinary edit) AND the backend independently confirms it is
  -- allowed. Never automatic merely from being late + eligible + having balance.
  if coalesce(p_use_information, false) and o_information_eligible then
    if not p_read_only then
      insert into public.employee_information_usage (company_id, employee_id, attendance_date, used_by)
      values (p_company_id, p_employee_id, p_attendance_date, auth.uid())
      on conflict (employee_id, attendance_date) do nothing;
    end if;
    o_used_information := true;
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
-- compute_extended_attendance_facts() -- thread the new o_information_eligible
-- output through. Every other line unchanged.
-- ----------------------------------------------------------------------------

drop function if exists public.compute_extended_attendance_facts(uuid, uuid, uuid, uuid, date, timestamptz, timestamptz, boolean, text, boolean);

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
  out o_information_eligible boolean,
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
  o_information_eligible := v_late_facts.o_information_eligible;
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
-- attendance_admin_upsert() -- an ordinary edit (no Information checkbox in
-- the Admin UI) must preserve the record's EXISTING used_information choice
-- (re-validated against the edited punch time), never silently grant or
-- revoke it. Only the change described in the header comment; every other
-- line is unchanged.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.attendance_admin_upsert(
  p_employee_id uuid,
  p_attendance_date date,
  p_status text,
  p_punch_in_time time without time zone DEFAULT NULL::time without time zone,
  p_punch_out_time time without time zone DEFAULT NULL::time without time zone,
  p_remark text DEFAULT NULL::text,
  p_use_information boolean DEFAULT false
)
RETURNS attendance_records
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
  v_preserved_use_information boolean := false;
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

  -- Fetch the EXISTING record first (before recomputing facts) purely to read its own
  -- used_information choice -- an ordinary edit made from the Manual Staff Attendance screen (which
  -- has no Information checkbox) must PRESERVE whatever the Staff originally chose at Punch In, only
  -- re-validated against the (possibly edited) punch time -- never silently grant or revoke it. A
  -- brand-new admin-created record (no prior row) has no prior choice to preserve, so it defaults to
  -- not used. p_use_information itself is no longer read here (kept in the signature only for
  -- interface stability).
  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = p_attendance_date
  limit 1;

  v_preserved_use_information := coalesce(v_existing.used_information, false);

  select * into v_facts from public.compute_extended_attendance_facts(
    v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, p_attendance_date,
    v_punch_in_at, v_punch_out_at, v_preserved_use_information, v_day_type_override
  );

  v_final_status := p_status;

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

-- ----------------------------------------------------------------------------
-- attendance_explain_rules() -- external signature UNCHANGED. Adds
-- config.eligibleNow to the 'information' kind row -- the ONE authoritative
-- signal (mirroring compute_late_and_penalty_facts()'s own
-- o_information_eligible) the Staff Punch In flow uses to decide whether to
-- show the "Use Information" checkbox at all, without re-deriving the
-- eligibility formula in the frontend. Every other line unchanged.
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
  -- insert an employee_information_usage row, no matter what p_use_information was passed.
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
        v_config := v_config || jsonb_build_object('monthlyUsage', v_used_count, 'eligibleNow', coalesce(v_facts.o_information_eligible, false));
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
