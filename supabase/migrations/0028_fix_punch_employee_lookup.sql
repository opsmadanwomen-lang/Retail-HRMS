-- ============================================================================
-- Retail HRMS — Fix employee lookup in punch RPCs for auth_user_id-linked Staff
-- Migration 0028
--
-- WHY: migration 0025 added employees.auth_user_id as the robust link between
-- a Staff login and its employee record (the staff-account edge function sets
-- it). attendanceService.getCurrentEmployee (client-side) was updated to use
-- it. These two SQL functions were NOT updated and still only match by
-- email (employees.email = profiles.email) — which fails for any Staff
-- account, because the Staff login uses a synthesized, non-deliverable auth
-- email (see lib/staffLogin.ts) that is deliberately different from the
-- employee's real business email. Caught live: a real Staff test login could
-- authenticate, load its profile, and be auto-detected as an employee by the
-- client — but `attendance_punch_in()` still raised "No active employee
-- record is linked to the current user."
--
-- FIX: both functions now try auth_user_id = auth.uid() FIRST (the
-- authoritative link), falling back to the original email match only for
-- employees that predate this link. No signature change, no data touched.
-- ============================================================================

create or replace function public.current_user_employee_id()
returns uuid as $$
  select coalesce(
    (select e.id from public.employees e where e.auth_user_id = auth.uid() limit 1),
    (
      select e.id
      from public.employees e
      join public.profiles p on p.company_id = e.company_id
      where p.id = auth.uid()
        and e.auth_user_id is null
        and e.email is not null
        and lower(e.email) = lower(p.email)
      limit 1
    )
  );
$$ language sql stable security definer;

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
  where e.auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if not found then
    select id, company_id, store_id, status into v_employee
    from public.employees e
    where company_id = public.current_user_company_id()
      and e.auth_user_id is null
      and e.email is not null
      and lower(e.email) = lower(public.current_user_profile_email())
      and status = 'active'
    limit 1;
  end if;

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
