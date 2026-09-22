-- ============================================================================
-- Retail HRMS — Automatic recalculation of existing attendance on Rule
-- Assignment (migration 0064)
--
-- PROBLEM: migration 0063 made Rule Assignment the central, independent
-- assignment system for all 8 rule kinds, and resolve_attendance_rule() /
-- compute_extended_attendance_facts() already resolve and apply the correct
-- rule for any NEW attendance calculation. But an assignment being created or
-- changed never touched attendance records that ALREADY EXISTED for dates the
-- new assignment covers — those stayed frozen at whatever was calculated
-- before the assignment existed, until a Super Admin manually re-opened and
-- re-saved each one via Attendance Edit. That manual step is the requirement
-- this migration removes.
--
-- FIX: attendance_rule_assignment_upsert() replaces the assignment-writing
-- half of what the TypeScript assignRuleScoped() previously did purely on the
-- client (SELECT existing, carry-forward, close-old, insert-new — see
-- src/services/attendanceRuleService.ts) with a single SECURITY DEFINER
-- function that does the SAME carry-forward/versioning AND, in the same
-- transaction, recalculates every existing attendance_records row that falls
-- inside the assignment's own (store, employee, effective_from..effective_to)
-- scope, through the EXISTING authoritative engine
-- (compute_extended_attendance_facts — no new formula, no new resolver).
-- This makes assignment-write and recalculation atomic per (store, employee)
-- pair: either both happen or neither does (a mid-call error rolls back the
-- whole function, including the assignment row itself).
--
-- SCOPE BOUNDING (never "recalculate everything blindly"):
--   company_id = the assignment's own company
--   store_id   = the assignment's own store_id, OR any store if the
--                assignment itself is store_id IS NULL (All Stores)
--   employee_id = the assignment's own employee_id, OR any employee if the
--                 assignment itself is employee_id IS NULL (All Employees)
--   attendance_date between effective_from and least(effective_to, current_date)
--     (never touches a future date that has no record yet, and never a date
--     the assignment does not cover)
-- Recalculating a record that is ALSO covered by a still-higher-priority
-- assignment is harmless and self-correcting: compute_extended_attendance_
-- facts() re-invokes resolve_attendance_rule() itself, which still picks the
-- higher-priority row exactly as before, so that record's values do not
-- change. Only rows whose computed facts actually differ are written
-- (WHERE ... IS DISTINCT FROM ...), so no-op recalculations do not even touch
-- updated_at or produce audit noise.
--
-- INDEPENDENCE PRESERVED: the 8-column carry-forward logic is unchanged from
-- migration 0063's assignRuleScoped() fix — a "touch" flag per rule kind
-- (p_touch_late, p_touch_overtime, ...) tells the function whether THIS call
-- is changing that kind at all; untouched kinds keep whatever the existing
-- open row already had. Recalculation itself always recomputes ALL 8 kinds'
-- facts together (compute_extended_attendance_facts is a single combined
-- calculation, exactly as it already was before this migration — not
-- reimplemented per-kind), but the WHERE ... IS DISTINCT FROM guard means a
-- record whose Penalty didn't actually change does not get a spurious write
-- or audit row just because Late was also recomputed alongside it.
--
-- AUDIT: reuses the existing attendance_audit_logs table/action
-- ('admin_correction', matching how attendance_admin_upsert already logs
-- manual edits) — no new audit mechanism. One row per recalculated record,
-- naming the assignment id and the before/after values for Late/Overtime/
-- Penalty/Early Going.
--
-- NOT CHANGED: resolve_attendance_rule(), compute_late_and_penalty_facts(),
-- compute_extended_attendance_facts(), attendance_admin_upsert() — zero
-- formula changes. This migration only adds new plumbing around them.
-- ============================================================================

create or replace function public.attendance_rule_assignment_upsert(
  p_company_id uuid,
  p_store_id uuid,       -- null = All Stores
  p_employee_id uuid,    -- null = All Employees
  p_touch_late boolean, p_late_rule_id uuid,
  p_touch_overtime boolean, p_overtime_rule_id uuid,
  p_touch_information boolean, p_information_rule_id uuid,
  p_touch_weekly_off_late boolean, p_weekly_off_late_rule_id uuid,
  p_touch_penalty boolean, p_penalty_rule_id uuid,
  p_touch_half_day boolean, p_half_day_rule_id uuid,
  p_touch_early_going boolean, p_early_going_rule_id uuid,
  p_touch_extended_duty boolean, p_extended_duty_rule_id uuid,
  p_effective_from date,
  p_effective_to date default null,
  p_remark text default null,
  p_user_id uuid default null
)
returns table (assignment_id uuid, recalculated_count int)
language plpgsql
security definer
as $function$
declare
  v_existing public.attendance_rule_assignments%rowtype;
  v_new_id uuid;
  v_late uuid; v_overtime uuid; v_information uuid; v_weekly_off_late uuid;
  v_penalty uuid; v_half_day uuid; v_early_going uuid; v_extended_duty uuid;
  v_recalc_count int := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can assign attendance rules.' using errcode = '42501';
  end if;

  if p_effective_from is null then
    raise exception 'Effective From is required.';
  end if;

  -- Find the currently OPEN row for this exact (store, employee) scope key, if any -- same lookup
  -- assignRuleScoped() used to do client-side.
  select * into v_existing
  from public.attendance_rule_assignments
  where company_id = p_company_id
    and scope_type = 'store_employee'
    and effective_to is null
    and store_id is not distinct from p_store_id
    and employee_id is not distinct from p_employee_id
  limit 1;

  -- Carry-forward: untouched rule kinds keep whatever the existing row already had (or null if
  -- there is no existing row) -- this is the independence guarantee from migration 0063, now
  -- enforced server-side instead of in assignRuleScoped().
  v_late := case when p_touch_late then p_late_rule_id else v_existing.late_rule_id end;
  v_overtime := case when p_touch_overtime then p_overtime_rule_id else v_existing.overtime_rule_id end;
  v_information := case when p_touch_information then p_information_rule_id else v_existing.information_rule_id end;
  v_weekly_off_late := case when p_touch_weekly_off_late then p_weekly_off_late_rule_id else v_existing.weekly_off_late_rule_id end;
  v_penalty := case when p_touch_penalty then p_penalty_rule_id else v_existing.penalty_rule_id end;
  v_half_day := case when p_touch_half_day then p_half_day_rule_id else v_existing.half_day_rule_id end;
  v_early_going := case when p_touch_early_going then p_early_going_rule_id else v_existing.early_going_rule_id end;
  v_extended_duty := case when p_touch_extended_duty then p_extended_duty_rule_id else v_existing.extended_duty_rule_id end;

  if v_existing.id is not null and v_existing.effective_from >= p_effective_from then
    -- Same-day (or earlier) re-save of the currently open row -> update in place.
    update public.attendance_rule_assignments set
      late_rule_id = v_late, overtime_rule_id = v_overtime, information_rule_id = v_information,
      weekly_off_late_rule_id = v_weekly_off_late, penalty_rule_id = v_penalty, half_day_rule_id = v_half_day,
      early_going_rule_id = v_early_going, extended_duty_rule_id = v_extended_duty,
      effective_from = p_effective_from, effective_to = p_effective_to,
      remark = coalesce(p_remark, remark), updated_by = p_user_id, updated_at = now()
    where id = v_existing.id
    returning id into v_new_id;
  else
    if v_existing.id is not null then
      -- Genuinely later effective_from -> version: close the old row so historical attendance
      -- keeps resolving to it for dates before this change.
      update public.attendance_rule_assignments
      set effective_to = p_effective_from - 1, updated_by = p_user_id
      where id = v_existing.id;
    end if;

    insert into public.attendance_rule_assignments (
      company_id, scope_type, scope_id, store_id, employee_id,
      late_rule_id, overtime_rule_id, information_rule_id, weekly_off_late_rule_id,
      penalty_rule_id, half_day_rule_id, early_going_rule_id, extended_duty_rule_id,
      effective_from, effective_to, is_active, remark, created_by, updated_by
    ) values (
      p_company_id, 'store_employee', null, p_store_id, p_employee_id,
      v_late, v_overtime, v_information, v_weekly_off_late, v_penalty, v_half_day, v_early_going, v_extended_duty,
      p_effective_from, p_effective_to, true, p_remark, p_user_id, p_user_id
    )
    returning id into v_new_id;
  end if;

  -- Recalculate existing, in-scope attendance through the SAME authoritative engine
  -- attendance_admin_upsert() uses -- bounded to this assignment's own store/employee scope and
  -- effective window; never touches a date outside it or in the future.
  with affected as (
    select ar.*
    from public.attendance_records ar
    where ar.company_id = p_company_id
      and (p_store_id is null or ar.store_id = p_store_id)
      and (p_employee_id is null or ar.employee_id = p_employee_id)
      and ar.attendance_date >= p_effective_from
      and ar.attendance_date <= least(coalesce(p_effective_to, current_date), current_date)
  ),
  recalced as (
    select
      a.id, a.late_minutes as old_late_minutes, a.overtime_minutes as old_overtime_minutes,
      a.penalty_minutes as old_penalty_minutes, a.early_going_minutes as old_early_going_minutes,
      a.employee_id, f.*
    from affected a
    cross join lateral public.compute_extended_attendance_facts(
      a.company_id, a.employee_id, a.shift_id, a.store_id, a.attendance_date,
      a.punch_in_at, a.punch_out_at, a.used_information,
      case when a.status in ('leave', 'holiday') then a.status::text else null end
    ) f
  ),
  updated as (
    update public.attendance_records ar set
      total_working_minutes = r.o_total_working_minutes,
      break_deduction_minutes = r.o_break_deduction_minutes,
      working_minutes = r.o_working_minutes,
      late_minutes = r.o_late_minutes,
      late_rule_id = r.o_late_rule_id,
      information_rule_id = r.o_information_rule_id,
      half_day_reason = r.o_half_day_reason,
      half_day_rule_id = r.o_half_day_rule_id,
      penalty_minutes = r.o_penalty_minutes,
      penalty_rule_id = r.o_penalty_rule_id,
      early_going_minutes = r.o_early_going_minutes,
      early_going_rule_id = r.o_early_going_rule_id,
      overtime_minutes = r.o_overtime_minutes,
      overtime_rule_id = r.o_overtime_rule_id,
      extra_duty_value = r.o_extra_duty_value,
      night_ot_minutes = r.o_night_ot_minutes,
      extended_duty_rule_id = r.o_extended_duty_rule_id,
      updated_at = now()
    from recalced r
    where ar.id = r.id
      and (
        ar.late_minutes is distinct from r.o_late_minutes or
        ar.overtime_minutes is distinct from r.o_overtime_minutes or
        ar.penalty_minutes is distinct from r.o_penalty_minutes or
        ar.early_going_minutes is distinct from r.o_early_going_minutes or
        ar.late_rule_id is distinct from r.o_late_rule_id or
        ar.overtime_rule_id is distinct from r.o_overtime_rule_id or
        ar.penalty_rule_id is distinct from r.o_penalty_rule_id or
        ar.early_going_rule_id is distinct from r.o_early_going_rule_id or
        ar.information_rule_id is distinct from r.o_information_rule_id or
        ar.half_day_rule_id is distinct from r.o_half_day_rule_id or
        ar.extended_duty_rule_id is distinct from r.o_extended_duty_rule_id
      )
    returning
      ar.id, r.employee_id, r.old_late_minutes, r.o_late_minutes, r.old_overtime_minutes, r.o_overtime_minutes,
      r.old_penalty_minutes, r.o_penalty_minutes, r.old_early_going_minutes, r.o_early_going_minutes
  )
  insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
  select
    p_company_id, u.employee_id, u.id, 'admin_correction', 'admin', p_user_id,
    format(
      'Automatic recalculation triggered by Rule Assignment %s (effective %s%s). Late %s -> %s, Overtime %s -> %s, Penalty %s -> %s, Early Going %s -> %s.',
      v_new_id, p_effective_from,
      case when p_effective_to is null then '' else ' to ' || p_effective_to end,
      u.old_late_minutes, u.o_late_minutes, u.old_overtime_minutes, u.o_overtime_minutes,
      u.old_penalty_minutes, u.o_penalty_minutes, u.old_early_going_minutes, u.o_early_going_minutes
    )
  from updated u;

  get diagnostics v_recalc_count = row_count;

  return query select v_new_id, v_recalc_count;
end;
$function$;

grant execute on function public.attendance_rule_assignment_upsert(
  uuid, uuid, uuid,
  boolean, uuid, boolean, uuid, boolean, uuid, boolean, uuid,
  boolean, uuid, boolean, uuid, boolean, uuid, boolean, uuid,
  date, date, text, uuid
) to authenticated;
