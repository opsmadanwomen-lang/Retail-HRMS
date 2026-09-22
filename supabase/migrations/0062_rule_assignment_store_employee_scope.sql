-- ============================================================================
-- Retail HRMS — Attendance Rule Assignment: Store + Employee scope, with priority resolution
-- Migration 0062
--
-- ADDITIVE ONLY. Reuses the existing attendance_rule_assignments table and
-- resolve_attendance_rule() — no second resolution engine, no new table.
--
-- NEW MODEL (scope_type = 'store_employee'): one row per (store_id, employee_id) combination,
-- either of which may be NULL to mean "All":
--   store_id = NULL,    employee_id = NULL    -> All Stores + All Employees (company default)
--   store_id = <store>, employee_id = NULL    -> This Store + All Employees
--   store_id = <store>, employee_id = <emp>   -> This Store + this Employee (most specific)
--   store_id = NULL,    employee_id = <emp>   -> This Employee at any store (generalization the
--                                                 UI does not expose yet, but the resolver
--                                                 supports it defensively)
--
-- The OLD model (scope_type in 'employee'/'shift'/'store'/'company', single scope_id column) is
-- COMPLETELY UNCHANGED and untouched — every existing assignment row (including the real
-- company-wide "Normal Late Rule" assignment created for the Late Grace fix) keeps resolving
-- exactly as before. It becomes the Tier 4 fallback, only reached when no 'store_employee' row
-- matches at all.
--
-- PRIORITY (highest to lowest):
--   1. store_employee: employee match (most specific store first, then store-agnostic)
--   2. store_employee: store match, employee_id IS NULL (store-wide default)
--   3. store_employee: store_id IS NULL AND employee_id IS NULL (all-stores default)
--   4. OLD scope_type ladder: employee -> shift -> store -> company (unchanged, byte-for-byte)
--
-- Conflict prevention: a partial unique index blocks two simultaneously-OPEN (effective_to IS
-- NULL) 'store_employee' rows for the exact same (company, store, employee) key — creating a new
-- assignment for that exact key must go through the existing "close old open row, insert new"
-- versioning pattern (already used everywhere else in this app for Late/Overtime/Information/
-- Penalty/etc. rules), which the service layer performs before inserting.
-- ============================================================================

alter table public.attendance_rule_assignments
  add column if not exists store_id uuid references public.stores (id) on delete cascade,
  add column if not exists employee_id uuid references public.employees (id) on delete cascade;

comment on column public.attendance_rule_assignments.store_id is
  'Only meaningful when scope_type = ''store_employee''. NULL = All Stores.';
comment on column public.attendance_rule_assignments.employee_id is
  'Only meaningful when scope_type = ''store_employee''. NULL = All Employees.';

alter table public.attendance_rule_assignments drop constraint if exists attendance_rule_assignments_scope_type_check;
alter table public.attendance_rule_assignments add constraint attendance_rule_assignments_scope_type_check
  check (scope_type in ('employee', 'shift', 'store', 'company', 'store_employee'));

-- Pre-existing constraint (migration 0038/0039 era) assumed scope_id IS NULL <=> scope_type =
-- 'company' — the ONLY scope with no scope_id. 'store_employee' rows also legitimately have a
-- NULL scope_id (their scope lives in the new store_id/employee_id columns instead), so the
-- constraint must allow both.
alter table public.attendance_rule_assignments drop constraint if exists attendance_rule_assignments_check;
alter table public.attendance_rule_assignments add constraint attendance_rule_assignments_check
  check ((scope_type in ('company', 'store_employee')) = (scope_id is null));

create index if not exists idx_rule_assignments_store_employee
  on public.attendance_rule_assignments (company_id, store_id, employee_id)
  where scope_type = 'store_employee';

-- Prevent two simultaneously-open assignments for the exact same (company, store, employee) key.
-- coalesce() to a sentinel nil-uuid so NULL (="All") participates in uniqueness like any other
-- value — a plain multi-column UNIQUE index treats NULLs as distinct from each other by default.
create unique index if not exists uidx_rule_assignments_store_employee_open
  on public.attendance_rule_assignments (
    company_id,
    coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where scope_type = 'store_employee' and effective_to is null;

-- ---------------------------------------------------------------------------
-- resolve_attendance_rule(): add the 3-tier store_employee resolution ahead of the existing
-- (unchanged) 4-tier employee/shift/store/company ladder, which becomes the Tier-4 fallback.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_attendance_rule(p_company_id uuid, p_employee_id uuid, p_shift_id uuid, p_store_id uuid, p_date date, p_kind text)
 returns uuid
 language plpgsql
 stable security definer
as $function$
declare
  v_rule_id uuid;
  v_scope text;
  v_scope_id uuid;
begin
  -- Tier 1: store_employee, exact employee match (prefer a store-specific row over a
  -- store-agnostic one for the same employee, then most recent effective_from).
  if p_kind = 'late' then
    select late_rule_id into v_rule_id
    from public.attendance_rule_assignments
    where company_id = p_company_id
      and scope_type = 'store_employee'
      and employee_id = p_employee_id
      and (store_id is null or store_id = p_store_id)
      and is_active
      and late_rule_id is not null
      and effective_from <= p_date
      and (effective_to is null or effective_to >= p_date)
    order by (store_id is not null) desc, effective_from desc
    limit 1;
  else
    select overtime_rule_id into v_rule_id
    from public.attendance_rule_assignments
    where company_id = p_company_id
      and scope_type = 'store_employee'
      and employee_id = p_employee_id
      and (store_id is null or store_id = p_store_id)
      and is_active
      and overtime_rule_id is not null
      and effective_from <= p_date
      and (effective_to is null or effective_to >= p_date)
    order by (store_id is not null) desc, effective_from desc
    limit 1;
  end if;
  if v_rule_id is not null then
    return v_rule_id;
  end if;

  -- Tier 2: store_employee, this store, ALL employees (employee_id is null).
  if p_store_id is not null then
    if p_kind = 'late' then
      select late_rule_id into v_rule_id
      from public.attendance_rule_assignments
      where company_id = p_company_id
        and scope_type = 'store_employee'
        and store_id = p_store_id
        and employee_id is null
        and is_active
        and late_rule_id is not null
        and effective_from <= p_date
        and (effective_to is null or effective_to >= p_date)
      order by effective_from desc
      limit 1;
    else
      select overtime_rule_id into v_rule_id
      from public.attendance_rule_assignments
      where company_id = p_company_id
        and scope_type = 'store_employee'
        and store_id = p_store_id
        and employee_id is null
        and is_active
        and overtime_rule_id is not null
        and effective_from <= p_date
        and (effective_to is null or effective_to >= p_date)
      order by effective_from desc
      limit 1;
    end if;
    if v_rule_id is not null then
      return v_rule_id;
    end if;
  end if;

  -- Tier 3: store_employee, ALL stores + ALL employees (the new default/company-wide row shape).
  if p_kind = 'late' then
    select late_rule_id into v_rule_id
    from public.attendance_rule_assignments
    where company_id = p_company_id
      and scope_type = 'store_employee'
      and store_id is null
      and employee_id is null
      and is_active
      and late_rule_id is not null
      and effective_from <= p_date
      and (effective_to is null or effective_to >= p_date)
    order by effective_from desc
    limit 1;
  else
    select overtime_rule_id into v_rule_id
    from public.attendance_rule_assignments
    where company_id = p_company_id
      and scope_type = 'store_employee'
      and store_id is null
      and employee_id is null
      and is_active
      and overtime_rule_id is not null
      and effective_from <= p_date
      and (effective_to is null or effective_to >= p_date)
    order by effective_from desc
    limit 1;
  end if;
  if v_rule_id is not null then
    return v_rule_id;
  end if;

  -- Tier 4: OLD scope_type ladder (employee -> shift -> store -> company). UNCHANGED,
  -- byte-for-byte identical to the pre-migration function — every existing assignment (including
  -- 'company'-scope rows created before this migration) keeps resolving exactly as before.
  foreach v_scope in array array['employee', 'shift', 'store', 'company']
  loop
    v_scope_id := case v_scope
      when 'employee' then p_employee_id
      when 'shift' then p_shift_id
      when 'store' then p_store_id
      else null
    end;

    if v_scope <> 'company' and v_scope_id is null then
      continue;
    end if;

    if p_kind = 'late' then
      select late_rule_id into v_rule_id
      from public.attendance_rule_assignments
      where company_id = p_company_id
        and scope_type = v_scope
        and scope_id is not distinct from v_scope_id
        and is_active
        and late_rule_id is not null
        and effective_from <= p_date
        and (effective_to is null or effective_to >= p_date)
      order by effective_from desc
      limit 1;
    else
      select overtime_rule_id into v_rule_id
      from public.attendance_rule_assignments
      where company_id = p_company_id
        and scope_type = v_scope
        and scope_id is not distinct from v_scope_id
        and is_active
        and overtime_rule_id is not null
        and effective_from <= p_date
        and (effective_to is null or effective_to >= p_date)
      order by effective_from desc
      limit 1;
    end if;

    if v_rule_id is not null then
      return v_rule_id;
    end if;
  end loop;

  return null;
end;
$function$;
