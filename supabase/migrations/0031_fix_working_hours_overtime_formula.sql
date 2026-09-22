-- ============================================================================
-- Retail HRMS — Correct Working Hours / Overtime formula
-- Migration 0031
--
-- WHY: attendance_punch_out() computed:
--   working_minutes = punch_out - punch_in                       (raw elapsed, ignored break)
--   overtime_minutes = clock-time(punch_out) - shift.end_time    (wrong basis entirely)
--
-- Per the shift model's actual fields (break_minutes from 0030,
-- minimum_work_minutes = "Required Working Hours"), the correct formulas are:
--   working_minutes  = max(0, (punch_out - punch_in) - break_minutes)
--   overtime_minutes = max(0, working_minutes - minimum_work_minutes)
--
-- e.g. shift 10:00-19:00 (9h span), break 60m, required 8h:
--   punch 10:00->19:00: raw 9h - 1h break = 8h worked, 8h - 8h required = 0 overtime  ✓
--   punch 10:00->20:00: raw 10h - 1h break = 9h worked, 9h - 8h required = 1h overtime ✓
-- If working_minutes is 0, overtime is always 0 (max(0, 0 - required) = 0 already, but
-- explicit greatest() calls make this invariant unambiguous either way).
--
-- Late-minutes formula and the IST-aware casts (migration 0019) and the
-- auth_user_id-first employee lookup (migration 0028) are unchanged.
-- ============================================================================

create or replace function public.attendance_punch_out()
returns public.attendance_records as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
  v_record public.attendance_records%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_raw_minutes int;
  v_working int;
  v_overtime int;
begin
  if v_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_record
  from public.attendance_records
  where employee_id = v_employee_id
    and attendance_date = current_date
  limit 1;

  if not found or v_record.punch_in_at is null then
    raise exception 'Please punch in before punching out.';
  end if;

  if v_record.punch_out_at is not null then
    raise exception 'You have already punched out for today.';
  end if;

  select * into v_shift from public.attendance_shifts where id = v_record.shift_id and is_active;
  if not found then
    raise exception 'Assigned shift is not available.';
  end if;

  v_raw_minutes := greatest(0, floor(extract(epoch from (now() - v_record.punch_in_at)) / 60)::int);
  v_working := greatest(0, v_raw_minutes - coalesce(v_shift.break_minutes, 0));
  v_overtime := case
    when v_shift.overtime_enabled then greatest(0, v_working - coalesce(v_shift.minimum_work_minutes, 0))
    else 0
  end;

  update public.attendance_records
  set punch_out_at = now(),
      working_minutes = v_working,
      overtime_minutes = v_overtime,
      status = 'present',
      source = 'web',
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_record.id
  returning * into v_record;

  return v_record;
end;
$$ language plpgsql security definer;
