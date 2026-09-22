-- ============================================================================
-- Retail HRMS — Phase 2B: Employee Transfer module + effective-dated
--   employee_assignment_history.
--
-- Reuses (no new engine): salary_assign_employee (Dynamic Salary Structure,
-- unchanged), employee_shift_assignments (already effective-dated — a
-- transfer just closes the open row and opens a new one, the SAME shape the
-- existing shift-assignment screen already writes), leave_resolve_policy_assignment
-- (already resolves by employee+date so a transferred employee's leave policy
-- changes automatically once employees.* is synced — no leave engine touched),
-- advance_recovery_* (untouched — advance is employee-linked only, no store/
-- dept column exists on it, so a transfer can never affect it).
--
-- Design:
--  * employee_assignment_history is a pure, additive, effective-dated LEDGER
--    (never rewritten) used for reconstruction/reporting (§13) and for
--    resolving "what was the employee's assignment on date X" (payroll
--    snapshot labels). It does NOT drive Attendance/Leave/Payroll calculation
--    — those already read the LIVE employees.* columns (Attendance/Leave) or
--    the existing effective-dated resolvers (salary/policy), so a transfer
--    only needs employees.* to change AT the effective date, never before.
--  * A transfer request is fully applied (assignment-history rows written,
--    salary structure re-assigned via the EXISTING engine, shift re-assigned
--    via the EXISTING effective-dated table) at APPROVAL time — all of those
--    are themselves effective-dated and safely ignore a future date. Only the
--    plain employees.* columns (store/department/designation/grade/category/
--    manager/team/employment_type) are NOT effective-dated by themselves, so
--    they are synced immediately if the effective date has already arrived,
--    otherwise deferred to transfer_apply_due_effective() (no cron in this
--    project; the frontend calls it once on the Transfers page load / can be
--    triggered by an admin — documented in the final report).
--  * Only fields the request actually specifies change; everything else
--    carries forward from the employee's current assignment (§6).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. transfer_approvers — same shape/authority pattern as exit_approvers, but
--    a SEPARATE roster (not reused finance/payroll authority per the brief).
-- ----------------------------------------------------------------------------
create table if not exists public.transfer_approvers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  stage_no int not null default 1 check (stage_no >= 1),
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id)
);
create index if not exists idx_transfer_approvers_company on public.transfer_approvers (company_id, is_active);

create or replace function public.transfer_can_approve(p_company_id uuid)
returns boolean
language sql
stable
security definer
as $fn$
  select public.is_super_admin()
      or exists (select 1 from public.transfer_approvers a
                 where a.employee_id = public.current_user_employee_id() and a.is_active and a.company_id = p_company_id);
$fn$;
grant execute on function public.transfer_can_approve(uuid) to authenticated;

create or replace function public.transfer_max_stage(p_company_id uuid)
returns int
language sql
stable
security definer
as $fn$
  select greatest(coalesce(max(stage_no), 1), 1) from public.transfer_approvers where company_id = p_company_id and is_active;
$fn$;
grant execute on function public.transfer_max_stage(uuid) to authenticated;

create or replace function public.transfer_can_decide_stage(p_company_id uuid, p_stage int)
returns boolean
language sql
stable
security definer
as $fn$
  select public.is_super_admin()
      or exists (select 1 from public.transfer_approvers a
                 where a.company_id = p_company_id and a.is_active and a.stage_no = p_stage
                   and a.employee_id = public.current_user_employee_id());
$fn$;
grant execute on function public.transfer_can_decide_stage(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- B. employee_assignment_history — effective-dated, additive, never rewritten.
-- ----------------------------------------------------------------------------
create table if not exists public.employee_assignment_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  effective_from date not null,
  effective_to date,
  store_id uuid references public.stores (id),
  store_department_id uuid references public.store_departments (id),
  store_designation_id uuid references public.store_designations (id),
  store_team_id uuid references public.store_teams (id),
  grade_id uuid references public.employee_grades (id),
  category_id uuid references public.employee_categories (id),
  reporting_manager_id uuid references public.employees (id),
  super_manager_id uuid references public.employees (id),
  employment_type text,
  salary_structure_id uuid references public.salary_structures (id),
  shift_id uuid references public.attendance_shifts (id),
  source text not null default 'transfer' check (source in ('initial', 'transfer', 'promotion', 'correction')),
  transfer_request_id uuid,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_assignment_history_employee on public.employee_assignment_history (employee_id, effective_from);
create index if not exists idx_assignment_history_company on public.employee_assignment_history (company_id);
-- at most one OPEN (current) assignment row per employee at any time.
create unique index if not exists uidx_assignment_history_one_open
  on public.employee_assignment_history (employee_id) where effective_to is null;

-- resolve the assignment effective on a given date (NULL if the employee has
-- no history yet — callers fall back to the live employees.* columns, so an
-- employee who was never transferred is completely unaffected).
create or replace function public.employee_assignment_as_of(p_employee_id uuid, p_as_of date)
returns public.employee_assignment_history
language sql
stable
security definer
as $fn$
  select * from public.employee_assignment_history
  where employee_id = p_employee_id and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc limit 1;
$fn$;
grant execute on function public.employee_assignment_as_of(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- C. employee_transfer_requests + decision history. Only specified new_*
--    fields represent a change; null = "no change for this field".
-- ----------------------------------------------------------------------------
create table if not exists public.employee_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  effective_date date not null,
  reason text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'effective')),
  current_step int not null default 0,
  new_store_id uuid references public.stores (id),
  new_store_department_id uuid references public.store_departments (id),
  new_store_designation_id uuid references public.store_designations (id),
  new_store_team_id uuid references public.store_teams (id),
  new_grade_id uuid references public.employee_grades (id),
  new_category_id uuid references public.employee_categories (id),
  new_reporting_manager_id uuid references public.employees (id),
  new_super_manager_id uuid references public.employees (id),
  new_employment_type text,
  new_salary_structure_id uuid references public.salary_structures (id),
  new_shift_id uuid references public.attendance_shifts (id),
  requested_by uuid,
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_remark text,
  applied_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_transfer_requests_company on public.employee_transfer_requests (company_id, status);
create index if not exists idx_transfer_requests_employee on public.employee_transfer_requests (employee_id);
create index if not exists idx_transfer_requests_due on public.employee_transfer_requests (company_id, status, effective_date) where status = 'approved';
create unique index if not exists uidx_transfer_requests_one_active_per_employee
  on public.employee_transfer_requests (employee_id) where status not in ('rejected', 'cancelled', 'effective');

alter table public.employee_assignment_history
  add constraint employee_assignment_history_transfer_fk
  foreign key (transfer_request_id) references public.employee_transfer_requests (id);

create table if not exists public.employee_transfer_decisions (
  id uuid primary key default gen_random_uuid(),
  transfer_request_id uuid not null references public.employee_transfer_requests (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  step_no int not null,
  action text not null check (action in ('submit', 'approve', 'reject', 'cancel')),
  actor uuid,
  remark text,
  decided_at timestamptz not null default now()
);
create index if not exists idx_transfer_decisions on public.employee_transfer_decisions (transfer_request_id, decided_at);

-- ----------------------------------------------------------------------------
-- D. RLS + triggers.
-- ----------------------------------------------------------------------------
alter table public.transfer_approvers enable row level security;
alter table public.employee_assignment_history enable row level security;
alter table public.employee_transfer_requests enable row level security;
alter table public.employee_transfer_decisions enable row level security;

drop policy if exists "transfer_approvers_select" on public.transfer_approvers;
create policy "transfer_approvers_select" on public.transfer_approvers for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
drop policy if exists "transfer_approvers_write" on public.transfer_approvers;
create policy "transfer_approvers_write" on public.transfer_approvers for insert with check (is_super_admin());
drop policy if exists "transfer_approvers_update" on public.transfer_approvers;
create policy "transfer_approvers_update" on public.transfer_approvers for update using (is_super_admin());

drop policy if exists "employee_assignment_history_select" on public.employee_assignment_history;
create policy "employee_assignment_history_select" on public.employee_assignment_history for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id())
         or employee_id = current_user_employee_id());

drop policy if exists "employee_transfer_requests_select" on public.employee_transfer_requests;
create policy "employee_transfer_requests_select" on public.employee_transfer_requests for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id())
         or employee_id = current_user_employee_id());

drop policy if exists "employee_transfer_decisions_select" on public.employee_transfer_decisions;
create policy "employee_transfer_decisions_select" on public.employee_transfer_decisions for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id())
         or exists (select 1 from public.employee_transfer_requests r where r.id = transfer_request_id and r.employee_id = current_user_employee_id()));
-- no write policy on any of the four — SECURITY DEFINER RPCs only.

drop trigger if exists trg_transfer_approvers_audit on public.transfer_approvers;
create trigger trg_transfer_approvers_audit after insert or update or delete on public.transfer_approvers for each row execute function public.write_audit_log();
drop trigger if exists trg_assignment_history_audit on public.employee_assignment_history;
create trigger trg_assignment_history_audit after insert or update or delete on public.employee_assignment_history for each row execute function public.write_audit_log();
drop trigger if exists trg_transfer_requests_set_updated_at on public.employee_transfer_requests;
create trigger trg_transfer_requests_set_updated_at before update on public.employee_transfer_requests for each row execute function public.set_updated_at();
drop trigger if exists trg_transfer_requests_audit on public.employee_transfer_requests;
create trigger trg_transfer_requests_audit after insert or update or delete on public.employee_transfer_requests for each row execute function public.write_audit_log();
drop trigger if exists trg_transfer_decisions_audit on public.employee_transfer_decisions;
create trigger trg_transfer_decisions_audit after insert on public.employee_transfer_decisions for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- E. RPCs.
-- ----------------------------------------------------------------------------
create or replace function public.transfer_request_create(
  p_company_id uuid, p_employee_id uuid, p_effective_date date, p_reason text default null,
  p_new_store_id uuid default null, p_new_store_department_id uuid default null, p_new_store_designation_id uuid default null,
  p_new_store_team_id uuid default null, p_new_grade_id uuid default null, p_new_category_id uuid default null,
  p_new_reporting_manager_id uuid default null, p_new_super_manager_id uuid default null,
  p_new_employment_type text default null, p_new_salary_structure_id uuid default null, p_new_shift_id uuid default null
)
returns public.employee_transfer_requests
language plpgsql
security definer
as $fn$
declare v_emp record; v_row public.employee_transfer_requests;
begin
  if not (public.is_super_admin() or public.payroll_can_manage(p_company_id)) then
    raise exception 'Not authorised to create a transfer request.' using errcode = '42501';
  end if;
  select id, company_id into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then raise exception 'Employee not found.'; end if;
  if v_emp.company_id <> p_company_id then raise exception 'Employee does not belong to this company.' using errcode = '42501'; end if;
  if p_effective_date is null then raise exception 'An effective date is required.'; end if;
  if p_new_store_id is null and p_new_store_department_id is null and p_new_store_designation_id is null
     and p_new_store_team_id is null and p_new_grade_id is null and p_new_category_id is null
     and p_new_reporting_manager_id is null and p_new_super_manager_id is null
     and p_new_employment_type is null and p_new_salary_structure_id is null and p_new_shift_id is null then
    raise exception 'At least one field must change for a transfer.';
  end if;
  if exists (select 1 from public.employee_transfer_requests
             where employee_id = p_employee_id and status not in ('rejected', 'cancelled', 'effective')) then
    raise exception 'An active transfer request already exists for this employee.' using errcode = '23505';
  end if;

  insert into public.employee_transfer_requests (
    company_id, employee_id, effective_date, reason, status,
    new_store_id, new_store_department_id, new_store_designation_id, new_store_team_id,
    new_grade_id, new_category_id, new_reporting_manager_id, new_super_manager_id,
    new_employment_type, new_salary_structure_id, new_shift_id, requested_by, created_by, updated_by
  ) values (
    p_company_id, p_employee_id, p_effective_date, p_reason, 'draft',
    p_new_store_id, p_new_store_department_id, p_new_store_designation_id, p_new_store_team_id,
    p_new_grade_id, p_new_category_id, p_new_reporting_manager_id, p_new_super_manager_id,
    p_new_employment_type, p_new_salary_structure_id, p_new_shift_id, auth.uid(), auth.uid(), auth.uid()
  ) returning * into v_row;
  return v_row;
end;
$fn$;
grant execute on function public.transfer_request_create(uuid, uuid, date, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, uuid) to authenticated;

create or replace function public.transfer_request_submit(p_id uuid)
returns public.employee_transfer_requests
language plpgsql
security definer
as $fn$
declare r public.employee_transfer_requests;
begin
  select * into r from public.employee_transfer_requests where id = p_id for update;
  if r.id is null then raise exception 'Transfer request not found.'; end if;
  if not (public.is_super_admin() or public.payroll_can_manage(r.company_id)) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if r.status <> 'draft' then raise exception 'Only a draft transfer can be submitted (current: %).', r.status; end if;
  update public.employee_transfer_requests set status = 'pending_approval', current_step = 1, submitted_at = now(), updated_by = auth.uid()
  where id = p_id returning * into r;
  insert into public.employee_transfer_decisions (transfer_request_id, company_id, step_no, action, actor) values (p_id, r.company_id, 1, 'submit', auth.uid());
  return r;
end;
$fn$;
grant execute on function public.transfer_request_submit(uuid) to authenticated;

create or replace function public.transfer_request_cancel(p_id uuid, p_reason text)
returns public.employee_transfer_requests
language plpgsql
security definer
as $fn$
declare r public.employee_transfer_requests;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to cancel a transfer.'; end if;
  select * into r from public.employee_transfer_requests where id = p_id for update;
  if r.id is null then raise exception 'Transfer request not found.'; end if;
  if not (public.is_super_admin() or public.payroll_can_manage(r.company_id)) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if r.status = 'effective' then raise exception 'An already-effective transfer cannot be cancelled.'; end if;
  update public.employee_transfer_requests set status = 'cancelled', decision_remark = p_reason, updated_by = auth.uid() where id = p_id returning * into r;
  insert into public.employee_transfer_decisions (transfer_request_id, company_id, step_no, action, actor, remark) values (p_id, r.company_id, r.current_step, 'cancel', auth.uid(), p_reason);
  return r;
end;
$fn$;
grant execute on function public.transfer_request_cancel(uuid, text) to authenticated;

-- writes the effective-dated history + re-assigns salary structure / shift via
-- the EXISTING engines (both already effective-dated, so a future date is safe).
create or replace function public._transfer_apply_history_and_engines(p_id uuid)
returns void
language plpgsql
security definer
as $fn$
declare
  r public.employee_transfer_requests; v_open public.employee_assignment_history; v_emp record;
  v_gross numeric; v_close date;
begin
  select * into r from public.employee_transfer_requests where id = p_id;
  select id, joining_date, store_id, store_department_id, store_designation_id, store_team_id,
         grade_id, category_id, reporting_manager_id, employment_type
    into v_emp from public.employees where id = r.employee_id;

  select * into v_open from public.employee_assignment_history where employee_id = r.employee_id and effective_to is null;
  v_close := r.effective_date - 1;

  if v_open.id is null then
    -- no history yet: baseline the employee's CURRENT assignment from joining, closed the day before this transfer.
    insert into public.employee_assignment_history (
      company_id, employee_id, effective_from, effective_to, store_id, store_department_id, store_designation_id,
      store_team_id, grade_id, category_id, reporting_manager_id, employment_type, source, created_by
    ) values (
      r.company_id, r.employee_id, coalesce(v_emp.joining_date, r.effective_date), v_close,
      v_emp.store_id, v_emp.store_department_id, v_emp.store_designation_id, v_emp.store_team_id,
      v_emp.grade_id, v_emp.category_id, v_emp.reporting_manager_id, v_emp.employment_type, 'initial', auth.uid()
    );
  else
    update public.employee_assignment_history set effective_to = v_close where id = v_open.id;
  end if;

  insert into public.employee_assignment_history (
    company_id, employee_id, effective_from, effective_to,
    store_id, store_department_id, store_designation_id, store_team_id, grade_id, category_id,
    reporting_manager_id, super_manager_id, employment_type, salary_structure_id, shift_id,
    source, transfer_request_id, reason, created_by
  ) values (
    r.company_id, r.employee_id, r.effective_date, null,
    coalesce(r.new_store_id, v_open.store_id, v_emp.store_id),
    coalesce(r.new_store_department_id, v_open.store_department_id, v_emp.store_department_id),
    coalesce(r.new_store_designation_id, v_open.store_designation_id, v_emp.store_designation_id),
    coalesce(r.new_store_team_id, v_open.store_team_id, v_emp.store_team_id),
    coalesce(r.new_grade_id, v_open.grade_id, v_emp.grade_id),
    coalesce(r.new_category_id, v_open.category_id, v_emp.category_id),
    coalesce(r.new_reporting_manager_id, v_open.reporting_manager_id, v_emp.reporting_manager_id),
    coalesce(r.new_super_manager_id, v_open.super_manager_id),
    coalesce(r.new_employment_type, v_open.employment_type, v_emp.employment_type),
    coalesce(r.new_salary_structure_id, v_open.salary_structure_id),
    coalesce(r.new_shift_id, v_open.shift_id),
    'transfer', r.id, r.reason, auth.uid()
  );

  -- salary structure change: reuse the EXISTING Dynamic Salary Structure engine, same gross.
  if r.new_salary_structure_id is not null then
    select gross_salary into v_gross from public.salary_resolve_for_employee(r.employee_id, current_date);
    if v_gross is not null then
      perform public.salary_assign_employee(r.employee_id, v_gross, r.effective_date, r.new_salary_structure_id, 'Transfer', r.reason);
    end if;
  end if;

  -- shift change: reuse the EXISTING effective-dated shift-assignment table.
  if r.new_shift_id is not null then
    update public.employee_shift_assignments set effective_to = v_close, is_active = false
    where employee_id = r.employee_id and effective_to is null;
    insert into public.employee_shift_assignments (company_id, employee_id, shift_id, effective_from, effective_to, is_active, created_by, updated_by, remark)
    values (r.company_id, r.employee_id, r.new_shift_id, r.effective_date, null, true, auth.uid(), auth.uid(), 'Transfer ' || r.id::text);
  end if;
end;
$fn$;

-- syncs the plain employees.* columns (NOT effective-dated on their own) â€” only
-- ever called once the effective date has actually arrived.
create or replace function public._transfer_sync_live_employee(p_id uuid)
returns void
language plpgsql
security definer
as $fn$
declare r public.employee_transfer_requests;
begin
  select * into r from public.employee_transfer_requests where id = p_id;
  update public.employees set
    store_id = coalesce(r.new_store_id, store_id),
    store_department_id = coalesce(r.new_store_department_id, store_department_id),
    store_designation_id = coalesce(r.new_store_designation_id, store_designation_id),
    store_team_id = coalesce(r.new_store_team_id, store_team_id),
    grade_id = coalesce(r.new_grade_id, grade_id),
    category_id = coalesce(r.new_category_id, category_id),
    reporting_manager_id = coalesce(r.new_reporting_manager_id, reporting_manager_id),
    employment_type = coalesce(r.new_employment_type, employment_type),
    updated_by = auth.uid()
  where id = r.employee_id;
  update public.employee_transfer_requests set status = 'effective', applied_at = now(), updated_by = auth.uid() where id = p_id;
end;
$fn$;

create or replace function public.transfer_request_decide(p_id uuid, p_action text, p_remark text default null)
returns public.employee_transfer_requests
language plpgsql
security definer
as $fn$
declare r public.employee_transfer_requests; v_max int;
begin
  if p_action not in ('approve', 'reject') then raise exception 'Invalid action.'; end if;
  select * into r from public.employee_transfer_requests where id = p_id for update;
  if r.id is null then raise exception 'Transfer request not found.'; end if;
  if r.status <> 'pending_approval' then raise exception 'Transfer request is % â€” nothing to decide.', r.status; end if;
  if not public.transfer_can_decide_stage(r.company_id, r.current_step) then
    raise exception 'You are not an authorised transfer approver at step %.', r.current_step using errcode = '42501';
  end if;
  if p_action = 'reject' and coalesce(btrim(p_remark), '') = '' then raise exception 'A reason is required to reject a transfer.'; end if;

  insert into public.employee_transfer_decisions (transfer_request_id, company_id, step_no, action, actor, remark)
  values (p_id, r.company_id, r.current_step, p_action, auth.uid(), p_remark);

  if p_action = 'reject' then
    update public.employee_transfer_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_remark = p_remark, updated_by = auth.uid() where id = p_id returning * into r;
    return r;
  end if;

  v_max := public.transfer_max_stage(r.company_id);
  if r.current_step < v_max then
    update public.employee_transfer_requests set current_step = r.current_step + 1, updated_by = auth.uid() where id = p_id returning * into r;
    return r;
  end if;

  update public.employee_transfer_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
    decision_remark = p_remark, updated_by = auth.uid() where id = p_id returning * into r;

  perform public._transfer_apply_history_and_engines(p_id);
  if r.effective_date <= current_date then
    perform public._transfer_sync_live_employee(p_id);
  end if;
  select * into r from public.employee_transfer_requests where id = p_id;
  return r;
end;
$fn$;
grant execute on function public.transfer_request_decide(uuid, text, text) to authenticated;

-- sweep: sync employees.* for any approved-but-not-yet-live transfer whose
-- effective date has arrived. No cron in this project â€” called from the
-- Transfers list page on load, and callable on demand by an authorised user.
create or replace function public.transfer_apply_due_effective(p_company_id uuid)
returns int
language plpgsql
security definer
as $fn$
declare r record; v_n int := 0;
begin
  if not (public.is_super_admin() or public.payroll_can_manage(p_company_id) or public.transfer_can_approve(p_company_id)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  for r in select id from public.employee_transfer_requests
           where company_id = p_company_id and status = 'approved' and applied_at is null and effective_date <= current_date
           for update
  loop
    perform public._transfer_sync_live_employee(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
grant execute on function public.transfer_apply_due_effective(uuid) to authenticated;

create or replace function public.transfer_request_list(p_company_id uuid)
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text,
  old_store text, new_store text, old_department text, new_department text, old_designation text, new_designation text,
  effective_date date, reason text, status text, current_step int, decided_by uuid, created_at timestamptz
)
language sql
stable
security definer
as $fn$
  select r.id, r.employee_id, e.full_name, e.employee_code,
         (select name from public.stores s where s.id = e.store_id),
         (select name from public.stores s where s.id = r.new_store_id),
         (select name from public.store_departments d where d.id = e.store_department_id),
         (select name from public.store_departments d where d.id = r.new_store_department_id),
         (select title from public.store_designations g where g.id = e.store_designation_id),
         (select title from public.store_designations g where g.id = r.new_store_designation_id),
         r.effective_date, r.reason, r.status, r.current_step, r.decided_by, r.created_at
  from public.employee_transfer_requests r
  join public.employees e on e.id = r.employee_id
  where r.company_id = p_company_id
    and (is_super_admin() or (current_user_role() <> 'staff' and r.company_id = current_user_company_id()) or r.employee_id = current_user_employee_id())
  order by r.created_at desc;
$fn$;
grant execute on function public.transfer_request_list(uuid) to authenticated;

create or replace function public.transfer_request_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $fn$
declare r public.employee_transfer_requests; v_emp record; v_out jsonb;
begin
  select * into r from public.employee_transfer_requests where id = p_id;
  if r.id is null then raise exception 'Transfer request not found.'; end if;
  if not (public.is_super_admin() or (public.current_user_role() <> 'staff' and r.company_id = public.current_user_company_id()) or r.employee_id = public.current_user_employee_id()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select e.full_name, e.employee_code, e.store_id, e.store_department_id, e.store_designation_id into v_emp from public.employees e where e.id = r.employee_id;
  v_out := to_jsonb(r) || jsonb_build_object(
    'employee_name', v_emp.full_name, 'employee_code', v_emp.employee_code,
    'max_stage', public.transfer_max_stage(r.company_id),
    'decisions', (select coalesce(jsonb_agg(to_jsonb(d) order by d.decided_at), '[]'::jsonb) from public.employee_transfer_decisions d where d.transfer_request_id = r.id)
  );
  return v_out;
end;
$fn$;
grant execute on function public.transfer_request_get(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- F. Transfer Register report.
-- ----------------------------------------------------------------------------
create or replace function public.transfer_register(
  p_company_id uuid, p_from date default null, p_to date default null,
  p_employee_id uuid default null, p_status text default null
)
returns table (
  staff_id text, employee_name text, old_store text, new_store text, old_department text, new_department text,
  old_designation text, new_designation text, effective_date date, reason text, status text, approved_by text
)
language sql
stable
security definer
as $fn$
  select e.employee_code, e.full_name,
         (select name from public.stores s where s.id = h.store_id),
         (select name from public.stores s where s.id = r.new_store_id),
         (select name from public.store_departments d where d.id = h.store_department_id),
         (select name from public.store_departments d where d.id = r.new_store_department_id),
         (select title from public.store_designations g where g.id = h.store_designation_id),
         (select title from public.store_designations g where g.id = r.new_store_designation_id),
         r.effective_date, r.reason, r.status,
         (select full_name from public.employees ap where ap.id = r.decided_by)
  from public.employee_transfer_requests r
  join public.employees e on e.id = r.employee_id
  left join lateral (
    select * from public.employee_assignment_history ah
    where ah.employee_id = r.employee_id and ah.effective_to = r.effective_date - 1
    order by ah.effective_from desc limit 1
  ) h on true
  where r.company_id = p_company_id
    and (p_from is null or r.effective_date >= p_from) and (p_to is null or r.effective_date <= p_to)
    and (p_employee_id is null or r.employee_id = p_employee_id)
    and (p_status is null or r.status = p_status)
    and (is_super_admin() or (current_user_role() <> 'staff' and r.company_id = current_user_company_id()))
  order by r.effective_date desc;
$fn$;
grant execute on function public.transfer_register(uuid, date, date, uuid, text) to authenticated;

