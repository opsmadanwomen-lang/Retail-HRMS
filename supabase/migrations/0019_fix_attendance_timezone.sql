-- ============================================================================
-- Retail HRMS — Attendance Timezone Correction
-- Migration 0019: Fix late/overtime calculation in the punch RPCs.
--
-- WHY: `attendance_punch_in`/`attendance_punch_out` (migration 0017) compute
-- late/overtime by casting a `timestamptz` straight to `time`
-- (e.g. `v_punch_in::time`). That cast uses the DATABASE SESSION timezone,
-- which on this Supabase project is UTC (verified via
-- `select current_setting('TIMEZONE')`), not India Standard Time. Shifts are
-- configured with IST business hours (e.g. 09:00–18:00 meaning 9 AM–6 PM
-- IST), so comparing a UTC time-of-day against an IST-intended shift time is
-- off by exactly the IST offset (+05:30) — in practice this means real
-- punches almost never register as late or overtime, because IST business
-- hours map to UTC times far enough from the shift window that the
-- greatest(0, ...) clamp always wins.
--
-- FIX: explicitly convert to Asia/Kolkata before extracting the time-of-day.
-- Nothing else about the functions changes — same signature, same tables,
-- same duplicate/validation guards. This is a pure `CREATE OR REPLACE
-- FUNCTION`; it does not alter any table, does not touch existing rows, and
-- is safe to re-run.
-- ============================================================================

create or replace function public.attendance_punch_in()
returns public.attendance_records as $$
declare
  v_employee record;
  v_shift record;
  v_assignment record;
  v_punch_in timestamptz := now();
  v_late int;
  v_existing public.attendance_records%rowtype;
begin
  select id, company_id, store_id, status into v_employee
  from public.employees e
  where company_id = public.current_user_company_id()
    and e.email is not null
    and lower(e.email) = lower(public.current_user_profile_email())
    and status = 'active'
  limit 1;

  if not found then
    raise exception 'No active employee record is linked to the current user.';
  end if;

  select * into v_assignment
  from public.employee_shift_assignments
  where employee_id = v_employee.id
    and is_active
    and effective_from <= current_date
    and (effective_to is null or effective_to >= current_date)
  order by effective_from desc
  limit 1;

  if found then
    select * into v_shift from public.attendance_shifts where id = v_assignment.shift_id and is_active;
  end if;

  if v_shift is null then
    select * into v_shift
    from public.attendance_shifts
    where company_id = v_employee.company_id
      and is_active
    order by name
    limit 1;
  end if;

  if v_shift is null then
    raise exception 'No active shift is assigned to this employee.';
  end if;

  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = current_date
  limit 1;

  if found and v_existing.punch_in_at is not null then
    raise exception 'You have already punched in for today.';
  end if;

  v_late := greatest(
    0,
    floor(extract(epoch from ((v_punch_in at time zone 'Asia/Kolkata')::time - v_shift.start_time)) / 60)::int - v_shift.grace_minutes
  );

  if found then
    update public.attendance_records
    set punch_in_at = v_punch_in,
        late_minutes = v_late,
        status = 'present',
        source = 'web',
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    return v_existing;
  end if;

  insert into public.attendance_records (
    company_id,
    employee_id,
    store_id,
    attendance_date,
    shift_id,
    punch_in_at,
    late_minutes,
    status,
    source,
    created_by,
    updated_by
  ) values (
    v_employee.company_id,
    v_employee.id,
    v_employee.store_id,
    current_date,
    v_shift.id,
    v_punch_in,
    v_late,
    'present',
    'web',
    auth.uid(),
    auth.uid()
  ) returning * into v_existing;

  return v_existing;
end;
$$ language plpgsql security definer;

create or replace function public.attendance_punch_out()
returns public.attendance_records as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
  v_record public.attendance_records%rowtype;
  v_shift public.attendance_shifts%rowtype;
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

  v_working := greatest(0, floor(extract(epoch from (now() - v_record.punch_in_at)) / 60)::int);
  v_overtime := greatest(0, floor(extract(epoch from ((now() at time zone 'Asia/Kolkata')::time - v_shift.end_time)) / 60)::int);

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
