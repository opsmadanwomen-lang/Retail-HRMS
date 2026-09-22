-- ============================================================================
-- Retail HRMS — Weekly Off Late Rule TEMPORARILY decoupled from Information
-- Migration 0057
--
-- EXPLICIT INSTRUCTION (this phase only): remove the Information/Intimation dependency from
-- Weekly Off Late entirely. The Weekly Off + Information interaction (migration 0056) is deferred
-- to a later, separate phase. For now, Weekly Off Late is simple and unconditional:
--
--   Weekly Off Late Rule has its OWN independent cutoff (new table, own storage — NOT the
--   Information Rule's cutoff_time; "Weekly Off Late must work independently"):
--
--     Punch In <= Weekly Off Cutoff  -> Late = 0
--     Punch In >  Weekly Off Cutoff  -> Late = Punch In - Weekly Off Cutoff
--
--   No Information Remaining check. No Information consumption. No
--   employee_information_usage row is ever created by the Weekly-Off path anymore. No
--   Shift-Start fallback tied to Information exhaustion — Information no longer has any bearing
--   on Weekly Off Late at all.
--
-- If no Weekly Off Late Rule is configured/active for the company on this date, Weekly Off falls
-- back to the plain Shift-Start formula (same as any other day with no special rule) — a sane,
-- backward-compatible default, not a new concept.
--
-- The EXPLICIT p_use_information = true path (an ordinary Information Day, unrelated to Weekly
-- Off) is completely UNTOUCHED — same lookup, same monthly-limit check, same usage insert, same
-- noon-cutoff-governs-Late behaviour as before. "Do NOT modify Normal Information/Intimation" is
-- honoured literally: not one line in that branch changes.
--
-- Nothing else changes: Half Day's late-arrival-cutoff override, Penalty's applicability switch
-- (its OUTCOME for Weekly Off naturally shifts because Weekly Off Late's own value now comes from
-- this new, simpler formula — the Penalty *logic* itself is byte-for-byte unchanged), Early Going,
-- Normal OT, Extended Duty, Night Duty, Working/Break/Final Working, and Holiday are all completely
-- untouched — this function's other branches are byte-for-byte identical to migration 0056.
--
-- attendance_information_rules.applicable_on_weekly_off is left in the schema, unreferenced by
-- this function from now on — additive-only, so the deferred future phase can reactivate the
-- Weekly-Off + Information interaction without another schema change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. New, genuinely independent table for the Weekly Off Late Rule. Same versioned-singleton
--    shape as the other five extended rule tables (migration 0042) — "close old open-ended row,
--    insert new" — but its own table, so editing it can never alter the Information Rule row.
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_weekly_off_late_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  cutoff_time time not null default '12:00:00',
  is_active boolean not null default true,
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.attendance_weekly_off_late_rules enable row level security;

create policy "attendance_weekly_off_late_rules_select_scoped" on public.attendance_weekly_off_late_rules for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "attendance_weekly_off_late_rules_write_scoped" on public.attendance_weekly_off_late_rules for insert with check (is_super_admin());
create policy "attendance_weekly_off_late_rules_update_scoped" on public.attendance_weekly_off_late_rules for update using (is_super_admin());
create policy "attendance_weekly_off_late_rules_delete_scoped" on public.attendance_weekly_off_late_rules for delete using (is_super_admin());
create trigger trg_attendance_weekly_off_late_rules_set_updated_at before update on public.attendance_weekly_off_late_rules for each row execute function public.set_updated_at();
create trigger trg_attendance_weekly_off_late_rules_audit after insert or update or delete on public.attendance_weekly_off_late_rules for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- 2. compute_late_and_penalty_facts() — Weekly Off branch replaced with the simple, independent
--    cutoff formula above. Explicit Information Day branch (p_use_information) is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.compute_late_and_penalty_facts(
  p_company_id uuid,
  p_employee_id uuid,
  p_shift_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_punch_in_at timestamptz,
  p_use_information boolean,
  p_day_type_override text default null,
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
  v_uses_noon_rule boolean := false;
  v_late_base_time time;
  v_raw_late int;
  v_month_start date;
  v_month_end date;
  v_used_count int := 0;
  v_penalty_applicable boolean := false;
  v_day_type text;
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

  -- Information Rule lookup and the explicit p_use_information branch below are UNCHANGED from
  -- migration 0056 — the ordinary Information Day feature keeps working exactly as it does today.
  select * into v_info_rule
  from public.attendance_information_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;
  o_information_rule_id := v_info_rule.id;

  if v_info_rule.id is not null then
    v_month_start := date_trunc('month', p_attendance_date)::date;
    v_month_end := (date_trunc('month', p_attendance_date) + interval '1 month - 1 day')::date;

    select count(*) into v_used_count
    from public.employee_information_usage
    where employee_id = p_employee_id
      and attendance_date >= v_month_start
      and attendance_date <= v_month_end;
  end if;

  if v_info_rule.id is not null and p_use_information then
    if v_used_count >= v_info_rule.monthly_limit then
      raise exception 'No Information/Intimation remaining for this month (limit %).', v_info_rule.monthly_limit;
    end if;

    insert into public.employee_information_usage (company_id, employee_id, attendance_date, used_by)
    values (p_company_id, p_employee_id, p_attendance_date, auth.uid())
    on conflict (employee_id, attendance_date) do nothing;

    o_used_information := true;
  end if;

  -- CHANGED (this migration): v_uses_noon_rule now reflects ONLY an explicit Information Day use.
  -- Weekly Off no longer has any automatic Information-availability gate — that entire mechanism
  -- (migration 0056) is removed for this phase.
  v_uses_noon_rule := v_info_rule.id is not null and o_used_information;

  -- CHANGED (this migration): Weekly Off Late now looked up from its own, independent rule table —
  -- simple unconditional cutoff, no Information involvement whatsoever.
  select * into v_wo_rule
  from public.attendance_weekly_off_late_rules
  where company_id = p_company_id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;

  if o_is_weekly_off and v_wo_rule.id is not null then
    -- Weekly Off Late Rule (independent of Information): Punch In <= cutoff -> 0;
    -- Punch In > cutoff -> Punch In - cutoff, in full. Nothing is ever consumed here.
    v_late_base_time := v_wo_rule.cutoff_time;
    if v_punch_in_ist_time <= v_late_base_time then
      v_raw_late := 0;
    else
      v_raw_late := floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int;
    end if;
  elsif v_uses_noon_rule then
    -- Ordinary Information Day (explicit use only) — unchanged noon-cutoff formula.
    v_late_base_time := v_info_rule.cutoff_time;
    if v_punch_in_ist_time <= v_late_base_time then
      v_raw_late := 0;
    else
      v_raw_late := floor(extract(epoch from (v_punch_in_ist_time - v_late_base_time)) / 60)::int;
    end if;
  else
    -- Normal day (or Weekly Off with no Weekly Off Late Rule configured) — Shift-Start based, full.
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

  -- Unchanged from migration 0056: 'weekly_off' stays OUT of this forced-zero list — its Late is
  -- entirely determined by the branch above. 'holiday' and Late Eligible = No are untouched.
  if not coalesce(v_shift.late_eligible, true) or v_day_type = 'holiday' then
    o_late_minutes := 0;
    o_half_day_late_coming := false;
    o_penalty_minutes := 0;
  end if;
end;
$function$;
