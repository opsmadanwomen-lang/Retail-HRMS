-- ============================================================================
-- Retail HRMS — read-only Information preview must not double-count itself
-- (migration 0086)
--
-- FOUND DURING MANDATORY TESTING of migration 0085: attendance_explain_rules()
-- (read-only mode) previews a record's own Penalty using a monthly used-count
-- that STILL INCLUDES that exact record's own already-persisted usage row (the
-- read-only path intentionally skips the DELETE-then-recount migration 0085
-- uses in commit mode, to guarantee no write ever happens purely from a
-- preview). For a record that genuinely used Information and was one of the
-- two allowed uses that month, this made the count look "already at the
-- limit" (because the record's own row was one of the two), so the Penalty
-- preview showed 60 even though the real persisted Penalty is 0 -- while the
-- 'information' row on the same preview correctly showed Triggered=true
-- (read directly from history). Two rows of the same preview disagreeing with
-- each other, and with the real record, is a genuine bug (not the disclosed
-- "cannot safely replay historical noon-cutoff Late" limitation of migration
-- 0070/0085 -- that limitation no longer exists at all after 0085 decoupled
-- Late from Information).
--
-- FIX: in read-only mode only, exclude THIS record's own attendance_date from
-- the monthly used-count -- i.e. preview "would this record independently
-- qualify, judged against every OTHER day's usage this month". Commit mode
-- (attendance_punch_in/attendance_admin_upsert/attendance_punch_out) is
-- completely unaffected -- it already deletes its own row before recounting,
-- so this added condition is a no-op for it. Every other line unchanged.
-- ============================================================================

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

    -- FIX (migration 0086): in read-only/preview mode (where this record's own row was NOT
    -- deleted above), exclude this exact date from the count -- so a preview judges "would this
    -- record independently qualify against every OTHER day's usage this month" instead of double-
    -- counting the record's own already-persisted contribution against itself. No-op in commit
    -- mode (the row was already deleted, so this condition never excludes anything there).
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
