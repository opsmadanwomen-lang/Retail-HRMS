-- ============================================================================
-- Retail HRMS — Leave Management, Phase 5: materializer / day-count parity
-- Migration 0124
--
-- Found during Phase 5 review: leave_materialize_attendance_dates() (migration
-- 0121) mirrored the IN-RANGE Weekly-Off/Holiday exclusion of
-- leave_compute_total_days() (migration 0101) exactly, but did NOT replicate
-- that function's SANDWICH-RULE branch. When a policy has
-- leave_policy_type_configs.sandwich_rule_enabled = true, a bridging Weekly
-- Off / Holiday day between two leave applications is added to
-- leave_applications.total_days — but 0121 never inserted a
-- leave_attendance_effects row for it, so the Attendance Calendar showed that
-- day as Weekly Off while the ledger had charged it as Leave. That is exactly
-- the "two day-count engines that drift" situation the Phase 5 brief (§9)
-- forbids.
--
-- This migration redefines leave_materialize_attendance_dates() so its
-- chargeable-day decision is byte-identical to leave_compute_total_days()
-- (0101) — the SAME is_weekly_off_on_date() call, the SAME holidays predicate,
-- the SAME weekly_off_count_rule / holiday_count_rule comparison, and now the
-- SAME sandwich-bridge test (same adjacent-application status set,
-- same ±2-day anchor). Nothing else changes: still SECURITY DEFINER, still
-- append-only, still idempotent via ON CONFLICT DO NOTHING against
-- idx_leave_attendance_effects_one_active_per_date, still never touches
-- attendance_records or any Attendance/Night-Duty object, still only callable
-- for an application whose status is already 'approved'.
--
-- NOTE: the truly single-source design would have leave_compute_total_days()
-- expose the chargeable DATE SET and have both callers consume it. That
-- refactor touches the leave_apply() hot path and is deferred; this migration
-- makes the two implementations produce identical days in the meantime.
-- ============================================================================
create or replace function public.leave_materialize_attendance_dates(p_application_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_app public.leave_applications%rowtype;
  v_config record;
  v_employee record;
  v_day date;
  v_is_weekly_off boolean;
  v_is_holiday boolean;
  v_gap_day date;
begin
  select * into v_app from public.leave_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'Leave application not found.';
  end if;
  if v_app.status <> 'approved' then
    raise exception 'Only an approved leave application can be materialized into Attendance.';
  end if;

  if v_app.is_half_day then
    insert into public.leave_attendance_effects (company_id, employee_id, leave_application_id, attendance_date, is_half_day, half_day_session)
    values (v_app.company_id, v_app.employee_id, v_app.id, v_app.from_date, true, v_app.half_day_session)
    on conflict (employee_id, attendance_date) where status = 'active' do nothing;
    return;
  end if;

  select weekly_off_count_rule, holiday_count_rule, sandwich_rule_enabled into v_config
  from public.leave_policy_type_configs
  where policy_id = v_app.policy_id and leave_type_id = v_app.leave_type_id;

  select company_id, store_id into v_employee from public.employees where id = v_app.employee_id;

  -- In-range days — identical to leave_compute_total_days()'s main loop.
  v_day := v_app.from_date;
  while v_day <= v_app.to_date loop
    v_is_weekly_off := public.is_weekly_off_on_date(v_app.employee_id, v_day);
    v_is_holiday := exists (
      select 1 from public.holidays h
      where h.company_id = v_employee.company_id and h.holiday_date = v_day and (h.store_id is null or h.store_id = v_employee.store_id)
    );

    if v_is_weekly_off and coalesce(v_config.weekly_off_count_rule, 'dont_count') <> 'count' then
      -- excluded — the same day the balance calculation excluded
    elsif v_is_holiday and coalesce(v_config.holiday_count_rule, 'dont_count') <> 'count' then
      -- excluded — same reasoning
    else
      insert into public.leave_attendance_effects (company_id, employee_id, leave_application_id, attendance_date, is_half_day)
      values (v_app.company_id, v_app.employee_id, v_app.id, v_day, false)
      on conflict (employee_id, attendance_date) where status = 'active' do nothing;
    end if;

    v_day := v_day + 1;
  end loop;

  -- Sandwich bridge days — identical predicate to leave_compute_total_days() (0101).
  if coalesce(v_config.sandwich_rule_enabled, false) then
    v_gap_day := v_app.from_date - 1;
    if (public.is_weekly_off_on_date(v_app.employee_id, v_gap_day)
        or exists (select 1 from public.holidays h where h.company_id = v_employee.company_id and h.holiday_date = v_gap_day and (h.store_id is null or h.store_id = v_employee.store_id)))
       and exists (
         select 1 from public.leave_applications a
         where a.employee_id = v_app.employee_id and a.status in ('manager_pending', 'super_manager_pending', 'approved') and a.to_date = v_app.from_date - 2
       )
    then
      insert into public.leave_attendance_effects (company_id, employee_id, leave_application_id, attendance_date, is_half_day)
      values (v_app.company_id, v_app.employee_id, v_app.id, v_gap_day, false)
      on conflict (employee_id, attendance_date) where status = 'active' do nothing;
    end if;

    v_gap_day := v_app.to_date + 1;
    if (public.is_weekly_off_on_date(v_app.employee_id, v_gap_day)
        or exists (select 1 from public.holidays h where h.company_id = v_employee.company_id and h.holiday_date = v_gap_day and (h.store_id is null or h.store_id = v_employee.store_id)))
       and exists (
         select 1 from public.leave_applications a
         where a.employee_id = v_app.employee_id and a.status in ('manager_pending', 'super_manager_pending', 'approved') and a.from_date = v_app.to_date + 2
       )
    then
      insert into public.leave_attendance_effects (company_id, employee_id, leave_application_id, attendance_date, is_half_day)
      values (v_app.company_id, v_app.employee_id, v_app.id, v_gap_day, false)
      on conflict (employee_id, attendance_date) where status = 'active' do nothing;
    end if;
  end if;
end;
$$;

grant execute on function public.leave_materialize_attendance_dates(uuid) to authenticated;
