-- ============================================================================
-- Retail HRMS — SECOND bug found while testing the Punch In fix (migration
-- 0083): attendance_punch_in() never actually creates today's first record
-- Migration 0084
--
-- ROOT CAUSE (confirmed via a safe, read-only diagnostic -- forced RAISE
-- EXCEPTION, no data written -- reproducing the exact sequence):
--
--   select id into v_existing from attendance_records where <no match>;
--   -- FOUND is now false, correctly
--   select * into v_facts from compute_late_and_penalty_facts(...);
--   -- FOUND is now TRUE (this call always returns exactly one row) --
--   -- clobbering the earlier, correct FOUND value.
--
-- attendance_punch_in() then does `if found then <UPDATE> else <INSERT>`
-- using this now-stale FOUND -- so it ALWAYS takes the UPDATE branch, even
-- for a brand-new employee's first punch-in of the day, where v_existing.id
-- is NULL. `UPDATE attendance_records SET ... WHERE id = NULL` matches zero
-- rows, so the punch silently does nothing: no error, no row, nothing
-- returned. This is why the real Staff Punch In flow still didn't work
-- immediately after migration 0083's type-cast fix (verified: a real call
-- to attendance_punch_in() for an employee with no record yet today
-- returned an all-NULL row and created nothing).
--
-- This is a pre-existing bug (present since migration 0045, unrelated to
-- and independent of the type-cast bug fixed in 0083) -- attendance_admin_
-- punch() and attendance_admin_upsert() do NOT have it, because both
-- already check `v_existing.id is not null` instead of relying on FOUND.
--
-- FIX: replace `if found then` with `if v_existing.id is not null then` --
-- the exact same robust pattern already used by every other punch/upsert
-- RPC in this codebase. This is a pure control-flow correction: no Night
-- Duty/Night OT/Overtime/Break Deduction/Final Working/Late/approval
-- formula, and no other line of this function, changes.
-- ============================================================================

create or replace function public.attendance_punch_in(p_use_information boolean default false)
returns public.attendance_records as $$
declare
  v_employee record;
  v_shift record;
  v_assignment record;
  v_punch_in timestamptz := now();
  v_existing public.attendance_records%rowtype;
  v_facts record;
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

  if v_existing.id is not null and v_existing.punch_in_at is not null then
    raise exception 'You have already punched in for today.';
  end if;

  select * into v_facts from public.compute_late_and_penalty_facts(
    v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, current_date, v_punch_in, coalesce(p_use_information, false)
  );

  -- FIX (migration 0084): decide UPDATE-vs-INSERT from v_existing.id directly, never from FOUND --
  -- the compute_late_and_penalty_facts() call just above always sets FOUND to true regardless of
  -- whether an existing row was found, which silently broke every first-punch-of-the-day case.
  if v_existing.id is not null then
    update public.attendance_records
    set punch_in_at = v_punch_in,
        late_minutes = v_facts.o_late_minutes,
        late_rule_id = v_facts.o_late_rule_id,
        used_information = v_facts.o_used_information,
        information_rule_id = v_facts.o_information_rule_id,
        half_day_reason = case when v_facts.o_half_day_late_coming then 'late_coming' else null end,
        half_day_rule_id = v_facts.o_half_day_rule_id,
        penalty_minutes = v_facts.o_penalty_minutes,
        penalty_rule_id = v_facts.o_penalty_rule_id,
        status = (case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end)::public.attendance_status,
        source = 'web',
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    return v_existing;
  end if;

  insert into public.attendance_records (
    company_id, employee_id, store_id, attendance_date, shift_id,
    punch_in_at, late_minutes, late_rule_id, used_information, information_rule_id,
    half_day_reason, half_day_rule_id, penalty_minutes, penalty_rule_id,
    status, source, created_by, updated_by
  ) values (
    v_employee.company_id, v_employee.id, v_employee.store_id, current_date, v_shift.id,
    v_punch_in, v_facts.o_late_minutes, v_facts.o_late_rule_id, v_facts.o_used_information, v_facts.o_information_rule_id,
    case when v_facts.o_half_day_late_coming then 'late_coming' else null end, v_facts.o_half_day_rule_id,
    v_facts.o_penalty_minutes, v_facts.o_penalty_rule_id,
    (case when v_facts.o_half_day_late_coming then 'half_day' else 'present' end)::public.attendance_status, 'web', auth.uid(), auth.uid()
  ) returning * into v_existing;

  return v_existing;
end;
$$ language plpgsql security definer;
