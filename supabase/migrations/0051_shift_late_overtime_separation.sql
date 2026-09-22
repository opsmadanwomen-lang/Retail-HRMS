-- ============================================================================
-- Retail HRMS — Separate Shift configuration from Late/Overtime calculation
-- Migration 0051
--
-- WHY (full inspection findings, see accompanying report):
--
-- 1. attendance_shifts had no way to say "this shift's Late is not tracked" — only
--    overtime_enabled existed. Adding late_eligible (default true, so every existing shift keeps
--    behaving exactly as before until someone deliberately turns it off).
--
-- 2. compute_late_and_penalty_facts() (the SOLE write-path late engine — attendance_punch_in,
--    attendance_punch_out, attendance_admin_punch, attendance_admin_upsert all delegate to it)
--    still used `v_shift.grace_minutes` as a threshold GATE before computing raw late minutes on
--    normal (non-noon-rule) days. Per the explicit new requirement, Actual Late Minutes must ALWAYS
--    equal punch-in minus scheduled start, full stop — grace must not gate or reduce it at all
--    anymore. (If a company wants a grace-like effect, that now belongs entirely inside a Late
--    Rule's own slab thresholds, e.g. a 0-10 minute slab mapped to 0 — a mechanism that already
--    exists and needs no schema change.) This migration removes the shift-grace gate and adds the
--    late_eligible output gate (mirroring how overtime_enabled already gates OT to 0).
--
-- 3. Two ORPHANED, UNREACHABLE function overloads were found still live in the database, both
--    still containing the OLD "late = raw - shift.grace_minutes" / "OT = working - shift.
--    minimum_work_minutes" subtraction formulas:
--      - attendance_punch_in()                                            [0-arg legacy overload]
--      - attendance_admin_upsert(uuid,date,text,time,time,text)           [6-arg legacy overload,
--        missing the p_use_information parameter added when the rule engine was introduced]
--    The frontend always calls the newer overloads (attendance_punch_in(boolean) and the 7-arg
--    attendance_admin_upsert with p_use_information) via attendanceService.ts, so these two are
--    dead code from the app's perspective — but they were still directly callable (e.g. via
--    `supabase.rpc('attendance_punch_in')` with no body), which is exactly the "two calculation
--    engines running simultaneously" risk called out explicitly. Dropped. Nothing else references
--    them (confirmed via pg_proc source search before dropping).
--
-- 4. calculate_extended_duty() (Normal OT + Extended Duty), calculate_late_minutes(),
--    calculate_overtime_minutes(), resolve_attendance_rule() were all inspected and are already
--    correctly Rule/Shift-End-only — no changes needed to any of them.
--
-- 5. NEW: attendance_reset_late_overtime_rules(company_id) — Super Admin only. Deactivates
--    (never physically deletes) every Late Rule, Overtime Rule, and Rule Assignment for a company,
--    so resolve_attendance_rule() finds nothing and calculate_late_minutes/calculate_overtime_minutes
--    fall back to their documented "no rule configured" legacy behaviour (plain actual minutes,
--    floor 0) — i.e. a clean slate to configure a brand-new rule structure, without ever touching
--    attendance_records, employees, shifts, stores, or any other table. Historical attendance rows
--    keep pointing at the now-inactive rule ids they were actually calculated with (late_rule_id /
--    overtime_rule_id are never rewritten) — audit history is preserved exactly as it happened.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Late Eligible flag (mirrors the existing Overtime Eligible flag exactly)
-- ---------------------------------------------------------------------------
alter table public.attendance_shifts
  add column if not exists late_eligible boolean not null default true;

comment on column public.attendance_shifts.late_eligible is
  'Whether Late is tracked at all for this shift. Mirrors overtime_enabled. Does NOT itself define any Late calculation rule — see Attendance Rule Management > Late Rules for that.';

-- grace_minutes / minimum_work_minutes / break_minutes are intentionally kept (not dropped): they
-- are real, populated columns on potentially-existing rows and break_minutes is still legitimately
-- used elsewhere (working-minutes deduction) — dropping columns is a one-way, higher-risk operation
-- this task does not require. They are simply no longer read by any Late/Overtime calculation, and
-- no longer exposed on the Shift Create/Edit UI (frontend change, this migration only touches SQL).

-- ---------------------------------------------------------------------------
-- 2. compute_late_and_penalty_facts() — remove shift-grace gate, add late_eligible gate
-- ---------------------------------------------------------------------------
create or replace function public.compute_late_and_penalty_facts(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_punch_in_at timestamptz,
  p_use_information boolean,
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
  v_half_day_rule public.attendance_half_day_rules%rowtype;
  v_penalty_rule public.attendance_penalty_rules%rowtype;
  v_punch_in_ist_time time;
  v_uses_noon_rule boolean := false;
  v_late_base_time time;
  v_raw_late int;
  v_month_start date;
  v_month_end date;
  v_used_count int;
  v_penalty_applicable boolean := false;
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

  select * into v_info_rule
  from public.attendance_information_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;
  o_information_rule_id := v_info_rule.id;

  if v_info_rule.id is not null and p_use_information then
    v_month_start := date_trunc('month', p_attendance_date)::date;
    v_month_end := (date_trunc('month', p_attendance_date) + interval '1 month - 1 day')::date;

    select count(*) into v_used_count
    from public.employee_information_usage
    where employee_id = p_employee_id
      and attendance_date >= v_month_start
      and attendance_date <= v_month_end;

    if v_used_count >= v_info_rule.monthly_limit then
      raise exception 'No Information/Intimation remaining for this month (limit %).', v_info_rule.monthly_limit;
    end if;

    insert into public.employee_information_usage (company_id, employee_id, attendance_date, used_by)
    values (p_company_id, p_employee_id, p_attendance_date, auth.uid())
    on conflict (employee_id, attendance_date) do nothing;

    o_used_information := true;
  end if;

  v_uses_noon_rule := v_info_rule.id is not null and (o_used_information or (o_is_weekly_off and v_info_rule.applicable_on_weekly_off));

  if v_uses_noon_rule then
    -- Noon-rule window has no separate grace concept (12:00->0, 12:01->1) — the cutoff itself is
    -- the gate. Unchanged by this migration.
    v_late_base_time := v_info_rule.cutoff_time;
    if v_punch_in_ist_time <= v_late_base_time then
      v_raw_late := 0;
    else
      v_raw_late := floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int;
    end if;
  else
    -- CHANGED (this migration): Actual Late Minutes is ALWAYS punch-in minus scheduled start, full
    -- stop. Shift-level grace_minutes is no longer read here at all — it never gates or reduces
    -- this value. (10:00 start, 10:11 punch-in -> 11, unconditionally; 10:00 start, 10:05 punch-in
    -- -> 5, not 0 as the old grace-gate produced.) Any desired "grace-like" leniency must now be
    -- expressed as a Late Rule slab threshold (e.g. 0-10 minutes -> 0), which is a Late Rule engine
    -- concern, not a Shift concern.
    v_late_base_time := v_shift.start_time;
    v_raw_late := greatest(0, floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int);
  end if;

  select * into v_half_day_rule
  from public.attendance_half_day_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;
  o_half_day_rule_id := v_half_day_rule.id;

  if v_half_day_rule.id is not null and v_punch_in_ist_time >= v_half_day_rule.late_arrival_cutoff_time then
    o_half_day_late_coming := true;
    v_raw_late := greatest(0, floor(extract(epoch from (v_punch_in_ist_time - v_half_day_rule.late_arrival_cutoff_time)) / 60)::int);
  end if;

  o_late_rule_id := public.resolve_attendance_rule(p_company_id, p_employee_id, p_shift_id, p_store_id, p_attendance_date, 'late');
  o_late_minutes := public.calculate_late_minutes(o_late_rule_id, v_raw_late);

  select * into v_penalty_rule
  from public.attendance_penalty_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;
  o_penalty_rule_id := v_penalty_rule.id;

  if v_penalty_rule.id is not null and o_late_minutes > 0 then
    v_penalty_applicable := case v_penalty_rule.applicability
      when 'every_late' then true
      when 'after_information_exhausted' then not v_uses_noon_rule
      when 'normal_day_only' then not v_uses_noon_rule and not o_is_weekly_off
      when 'information_day_after_cutoff' then v_uses_noon_rule
      when 'weekly_off' then o_is_weekly_off
      when 'half_day' then o_half_day_late_coming
      else true
    end;

    if v_penalty_applicable then
      o_penalty_minutes := public.calculate_penalty_minutes(o_penalty_rule_id, o_late_minutes);
    end if;
  end if;

  -- NEW (this migration): Late Eligible = No means this shift's Late is never tracked, mirroring
  -- how Overtime Eligible = No already zeroes Overtime/Extended Duty output. Computed above
  -- unconditionally (so Information usage-consumption and rule resolution metadata behave exactly
  -- as before), only the visible late-driven output is zeroed here.
  if not coalesce(v_shift.late_eligible, true) then
    o_late_minutes := 0;
    o_half_day_late_coming := false;
    o_penalty_minutes := 0;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Drop the two orphaned/unreachable legacy overloads that still contained the old formulas.
--    Confirmed via pg_proc source search: the frontend never calls these signatures (it always
--    passes p_use_information), and no other function/trigger references them by name+signature.
-- ---------------------------------------------------------------------------
drop function if exists public.attendance_punch_in();
drop function if exists public.attendance_admin_upsert(uuid, date, text, time without time zone, time without time zone, text);

-- ---------------------------------------------------------------------------
-- 4. Reset/Deactivate Existing Late & Overtime Rules (Super Admin only). Physical deletion is
--    deliberately avoided — attendance_records.late_rule_id / overtime_rule_id reference these rows
--    and must keep resolving for historical audit purposes. Deactivating achieves the required
--    "start fresh from zero" result: resolve_attendance_rule() will find nothing (is_active is
--    checked at every scope), so calculate_late_minutes/calculate_overtime_minutes fall back to
--    their own documented "no rule" legacy behaviour (plain actual minutes) until new rules are
--    configured and assigned.
-- ---------------------------------------------------------------------------
create or replace function public.attendance_reset_late_overtime_rules(p_company_id uuid)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_late_count int;
  v_overtime_count int;
  v_assignment_count int;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can reset Late/Overtime rules.'
      using errcode = '42501';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required.';
  end if;

  update public.attendance_late_rules
  set is_active = false, updated_by = auth.uid(), updated_at = now()
  where company_id = p_company_id and is_active;
  get diagnostics v_late_count = row_count;

  update public.attendance_overtime_rules
  set is_active = false, updated_by = auth.uid(), updated_at = now()
  where company_id = p_company_id and is_active;
  get diagnostics v_overtime_count = row_count;

  update public.attendance_rule_assignments
  set is_active = false, updated_by = auth.uid()
  where company_id = p_company_id and is_active;
  get diagnostics v_assignment_count = row_count;

  -- attendance_audit_logs is scoped to a specific employee_id + attendance_record_id (both NOT
  -- NULL) — it is the punch-level audit trail, not a general admin-action log, and no other
  -- company-wide rule-configuration change in this codebase writes to it either (Late/Overtime/
  -- Information/Penalty/etc rule edits all rely on each row's own updated_by/updated_at, exactly
  -- what the three UPDATEs above already set). Consistent with that existing convention, this
  -- action's audit trail IS is_active=false + updated_by + updated_at on every affected row.

  return jsonb_build_object(
    'lateRulesDeactivated', v_late_count,
    'overtimeRulesDeactivated', v_overtime_count,
    'assignmentsDeactivated', v_assignment_count
  );
end;
$function$;

revoke all on function public.attendance_reset_late_overtime_rules(uuid) from public;
grant execute on function public.attendance_reset_late_overtime_rules(uuid) to authenticated;
