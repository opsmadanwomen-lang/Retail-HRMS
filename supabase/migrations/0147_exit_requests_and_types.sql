-- ============================================================================
-- Retail HRMS — Phase 2A: Employee Exit Request Workflow + Exit Type master.
--
-- Reuses (no new engine): the F&F Core RPCs from 0145/0146 (fnf_create is
-- called internally, unchanged), the exit_approvers roster from 0145 (now
-- staged), leave_resolve_direct_manager (existing manager resolver).
--
-- Design choices (documented, not invented business rules):
--  * Approval stages are CONFIGURABLE via exit_approvers.stage_no (new column,
--    defaults to 1 so every existing Phase-1 approver keeps approving F&F and
--    now also approves exit requests at stage 1 — zero regression). Stage 1
--    additionally always allows the employee's resolved reporting manager (a
--    company can run stage 1 with zero configured roster rows and still work),
--    matching "Reporting Manager / configured first approver" without
--    hard-coding HR as a level. Stage count = MAX(stage_no) among a company's
--    ACTIVE exit_approvers (minimum 1).
--  * 'submitted' is a real, valid status (schema-complete per the brief) but
--    exit_request_submit collapses Draft -> Under Approval directly (there is
--    no separate gate between "submitted" and the first reviewer) — step 1.
--  * fnf_create (Phase 1) is UNCHANGED and still accepts a raw leaving date —
--    Phase 1 tests and any emergency admin use keep working. The NORMAL
--    workflow is steered through fnf_create_from_exit_request(), which only
--    accepts an APPROVED exit request (frontend uses this path).
--  * employees.exit_status keeps its existing fixed CHECK enum (unchanged, no
--    schema risk to Phase 1/7). A custom Exit Type maps to that enum by code
--    where it matches one of the known values, else 'other' — the exit type
--    ITSELF is fully custom/configurable; only the legacy narrow employee
--    column falls back sensibly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. exit_types — configurable master. Never hard-coded; never deleted once
--    referenced (default RESTRICT on the FK from employee_exit_requests).
-- ----------------------------------------------------------------------------
create table if not exists public.exit_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  display_order int not null default 100,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

-- ----------------------------------------------------------------------------
-- B. exit_approvers gains a configurable stage number (default 1 -> no
--    regression for Phase 1's flat F&F-approval roster).
-- ----------------------------------------------------------------------------
alter table public.exit_approvers add column if not exists stage_no int not null default 1 check (stage_no >= 1);

create or replace function public.exit_request_max_stage(p_company_id uuid)
returns int
language sql
stable
security definer
as $fn$
  select greatest(coalesce(max(stage_no), 1), 1) from public.exit_approvers where company_id = p_company_id and is_active;
$fn$;
grant execute on function public.exit_request_max_stage(uuid) to authenticated;

-- who may decide at a given stage: the roster at that stage, OR (stage 1 only)
-- the employee's resolved reporting manager, OR a super-admin (always).
create or replace function public.exit_request_can_decide_stage(p_company_id uuid, p_employee_id uuid, p_stage int)
returns boolean
language plpgsql
stable
security definer
as $fn$
declare v_mgr uuid;
begin
  if public.is_super_admin() then return true; end if;
  if exists (select 1 from public.exit_approvers a
             where a.company_id = p_company_id and a.is_active and a.stage_no = p_stage
               and a.employee_id = public.current_user_employee_id()) then
    return true;
  end if;
  if p_stage = 1 then
    v_mgr := public.leave_resolve_direct_manager(p_employee_id);
    if v_mgr is not null and v_mgr = public.current_user_employee_id() then return true; end if;
  end if;
  return false;
end;
$fn$;
grant execute on function public.exit_request_can_decide_stage(uuid, uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- C. employee_exit_requests + per-stage decision history.
-- ----------------------------------------------------------------------------
create table if not exists public.employee_exit_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  exit_type_id uuid not null references public.exit_types (id),
  reason text,
  notes text,
  requested_leaving_date date not null,
  notice_period_days int not null default 0,
  notice_served_days numeric not null default 0,
  expected_last_working_date date,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'under_approval', 'approved', 'rejected', 'sent_back', 'cancelled', 'completed')),
  current_step int not null default 0,
  effective_leaving_date date,
  fnf_settlement_id uuid references public.fnf_settlements (id),
  requested_by uuid,
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_exit_requests_company on public.employee_exit_requests (company_id, status);
create index if not exists idx_exit_requests_employee on public.employee_exit_requests (employee_id);
-- at most one live (non-terminal) exit request per employee
create unique index if not exists uidx_exit_requests_one_active_per_employee
  on public.employee_exit_requests (employee_id) where status not in ('rejected', 'cancelled', 'completed');

create table if not exists public.employee_exit_request_decisions (
  id uuid primary key default gen_random_uuid(),
  exit_request_id uuid not null references public.employee_exit_requests (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  step_no int not null,
  action text not null check (action in ('submit', 'approve', 'reject', 'send_back', 'cancel', 'correct_leaving_date')),
  actor uuid,
  remark text,
  decided_at timestamptz not null default now()
);
create index if not exists idx_exit_request_decisions on public.employee_exit_request_decisions (exit_request_id, decided_at);

alter table public.fnf_settlements add column if not exists exit_request_id uuid references public.employee_exit_requests (id);

-- ----------------------------------------------------------------------------
-- D. RLS + triggers.
-- ----------------------------------------------------------------------------
alter table public.exit_types enable row level security;
alter table public.employee_exit_requests enable row level security;
alter table public.employee_exit_request_decisions enable row level security;

drop policy if exists "exit_types_select" on public.exit_types;
create policy "exit_types_select" on public.exit_types for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
drop policy if exists "exit_types_write" on public.exit_types;
create policy "exit_types_write" on public.exit_types for insert with check (is_super_admin());
drop policy if exists "exit_types_update" on public.exit_types;
create policy "exit_types_update" on public.exit_types for update using (is_super_admin());

drop policy if exists "employee_exit_requests_select" on public.employee_exit_requests;
create policy "employee_exit_requests_select" on public.employee_exit_requests for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id())
         or employee_id = current_user_employee_id());
drop policy if exists "employee_exit_request_decisions_select" on public.employee_exit_request_decisions;
create policy "employee_exit_request_decisions_select" on public.employee_exit_request_decisions for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id())
         or exists (select 1 from public.employee_exit_requests r where r.id = exit_request_id and r.employee_id = current_user_employee_id()));
-- no write policy on either — SECURITY DEFINER RPCs only.

drop trigger if exists trg_exit_types_set_updated_at on public.exit_types;
create trigger trg_exit_types_set_updated_at before update on public.exit_types for each row execute function public.set_updated_at();
drop trigger if exists trg_exit_types_audit on public.exit_types;
create trigger trg_exit_types_audit after insert or update or delete on public.exit_types for each row execute function public.write_audit_log();
drop trigger if exists trg_exit_requests_set_updated_at on public.employee_exit_requests;
create trigger trg_exit_requests_set_updated_at before update on public.employee_exit_requests for each row execute function public.set_updated_at();
drop trigger if exists trg_exit_requests_audit on public.employee_exit_requests;
create trigger trg_exit_requests_audit after insert or update or delete on public.employee_exit_requests for each row execute function public.write_audit_log();
drop trigger if exists trg_exit_request_decisions_audit on public.employee_exit_request_decisions;
create trigger trg_exit_request_decisions_audit after insert on public.employee_exit_request_decisions for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- E. helper: map an exit_type to the employee.exit_status fixed enum (§ legacy
--    column, unchanged). Custom/unknown types fall back to 'other'.
-- ----------------------------------------------------------------------------
create or replace function public._exit_status_from_type(p_code text)
returns text
language sql
immutable
as $fn$
  select case lower(coalesce(p_code, ''))
    when 'resignation' then 'resigned' when 'resigned' then 'resigned'
    when 'termination' then 'terminated' when 'terminated' then 'terminated'
    when 'retirement' then 'retired' when 'retired' then 'retired'
    when 'absconded' then 'absconded'
    when 'contract_end' then 'contract_end' when 'contract end' then 'contract_end'
    else 'other' end;
$fn$;

-- ----------------------------------------------------------------------------
-- F. RPCs.
-- ----------------------------------------------------------------------------
create or replace function public.exit_request_create(
  p_company_id uuid, p_employee_id uuid, p_exit_type_id uuid, p_requested_leaving_date date,
  p_reason text default null, p_notes text default null,
  p_notice_period_days int default 0, p_notice_served_days numeric default 0,
  p_expected_last_working_date date default null
)
returns public.employee_exit_requests
language plpgsql
security definer
as $fn$
declare v_emp record; v_type record; v_row public.employee_exit_requests;
begin
  select id, company_id, joining_date into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then raise exception 'Employee not found.'; end if;
  if v_emp.company_id <> p_company_id then raise exception 'Employee does not belong to this company.' using errcode = '42501'; end if;
  if not (public.is_super_admin() or public.payroll_can_manage(p_company_id) or p_employee_id = public.current_user_employee_id()) then
    raise exception 'Not authorised to raise an exit request for this employee.' using errcode = '42501';
  end if;

  select * into v_type from public.exit_types where id = p_exit_type_id and company_id = p_company_id;
  if v_type.id is null then raise exception 'Exit type not found for this company.'; end if;
  if p_requested_leaving_date is null then raise exception 'A requested leaving date is required.'; end if;
  if v_emp.joining_date is not null and p_requested_leaving_date < v_emp.joining_date then
    raise exception 'Leaving date % is before the joining date %.', p_requested_leaving_date, v_emp.joining_date;
  end if;
  if exists (select 1 from public.employee_exit_requests where employee_id = p_employee_id
             and status not in ('rejected', 'cancelled', 'completed')) then
    raise exception 'An active exit request already exists for this employee.' using errcode = '23505';
  end if;

  insert into public.employee_exit_requests (
    company_id, employee_id, exit_type_id, reason, notes, requested_leaving_date,
    notice_period_days, notice_served_days, expected_last_working_date, status, requested_by, created_by, updated_by
  ) values (
    p_company_id, p_employee_id, p_exit_type_id, p_reason, p_notes, p_requested_leaving_date,
    coalesce(p_notice_period_days, 0), coalesce(p_notice_served_days, 0), p_expected_last_working_date,
    'draft', auth.uid(), auth.uid(), auth.uid()
  ) returning * into v_row;
  return v_row;
end;
$fn$;
grant execute on function public.exit_request_create(uuid, uuid, uuid, date, text, text, int, numeric, date) to authenticated;

create or replace function public.exit_request_submit(p_id uuid)
returns public.employee_exit_requests
language plpgsql
security definer
as $fn$
declare r public.employee_exit_requests;
begin
  select * into r from public.employee_exit_requests where id = p_id for update;
  if r.id is null then raise exception 'Exit request not found.'; end if;
  if not (public.is_super_admin() or public.payroll_can_manage(r.company_id) or r.employee_id = public.current_user_employee_id()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'sent_back') then raise exception 'Only a draft or sent-back exit request can be submitted (current: %).', r.status; end if;

  update public.employee_exit_requests
  set status = 'under_approval', current_step = 1, submitted_at = coalesce(submitted_at, now()), updated_by = auth.uid()
  where id = p_id returning * into r;
  insert into public.employee_exit_request_decisions (exit_request_id, company_id, step_no, action, actor)
  values (p_id, r.company_id, 1, 'submit', auth.uid());
  return r;
end;
$fn$;
grant execute on function public.exit_request_submit(uuid) to authenticated;

create or replace function public.exit_request_decide(p_id uuid, p_action text, p_remark text default null)
returns public.employee_exit_requests
language plpgsql
security definer
as $fn$
declare r public.employee_exit_requests; v_max int; v_type public.exit_types;
begin
  if p_action not in ('approve', 'reject', 'send_back') then raise exception 'Invalid action.'; end if;
  select * into r from public.employee_exit_requests where id = p_id for update;
  if r.id is null then raise exception 'Exit request not found.'; end if;
  if r.status <> 'under_approval' then raise exception 'Exit request is % — nothing to decide.', r.status; end if;
  if not public.exit_request_can_decide_stage(r.company_id, r.employee_id, r.current_step) then
    raise exception 'You are not an authorised approver at step %.', r.current_step using errcode = '42501';
  end if;
  if p_action in ('reject', 'send_back') and coalesce(btrim(p_remark), '') = '' then
    raise exception 'A reason is required to % an exit request.', p_action;
  end if;

  insert into public.employee_exit_request_decisions (exit_request_id, company_id, step_no, action, actor, remark)
  values (p_id, r.company_id, r.current_step, p_action, auth.uid(), p_remark);

  if p_action = 'reject' then
    update public.employee_exit_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_remark = p_remark, updated_by = auth.uid() where id = p_id returning * into r;
    return r;
  elsif p_action = 'send_back' then
    update public.employee_exit_requests set status = 'sent_back', current_step = 0,
      decision_remark = p_remark, updated_by = auth.uid() where id = p_id returning * into r;
    return r;
  end if;

  -- approve
  v_max := public.exit_request_max_stage(r.company_id);
  if r.current_step < v_max then
    update public.employee_exit_requests set current_step = r.current_step + 1, updated_by = auth.uid()
    where id = p_id returning * into r;
    return r;
  end if;

  -- final approval: the leaving date becomes effective.
  select * into v_type from public.exit_types where id = r.exit_type_id;
  update public.employees
  set leaving_date = r.requested_leaving_date,
      exit_status = public._exit_status_from_type(v_type.code),
      exit_reason = coalesce(r.reason, exit_reason),
      updated_by = auth.uid()
  where id = r.employee_id;

  update public.employee_exit_requests
  set status = 'approved', current_step = r.current_step, effective_leaving_date = r.requested_leaving_date,
      decided_by = auth.uid(), decided_at = now(), decision_remark = p_remark, updated_by = auth.uid()
  where id = p_id returning * into r;
  return r;
end;
$fn$;
grant execute on function public.exit_request_decide(uuid, text, text) to authenticated;

create or replace function public.exit_request_cancel(p_id uuid, p_reason text)
returns public.employee_exit_requests
language plpgsql
security definer
as $fn$
declare r public.employee_exit_requests;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to cancel an exit request.'; end if;
  select * into r from public.employee_exit_requests where id = p_id for update;
  if r.id is null then raise exception 'Exit request not found.'; end if;
  if not (public.is_super_admin() or public.payroll_can_manage(r.company_id) or r.employee_id = public.current_user_employee_id()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if r.status in ('approved', 'completed') then raise exception 'An approved/completed exit request cannot be cancelled — use correction / F&F reversal.'; end if;
  update public.employee_exit_requests set status = 'cancelled', decision_remark = p_reason, updated_by = auth.uid() where id = p_id returning * into r;
  insert into public.employee_exit_request_decisions (exit_request_id, company_id, step_no, action, actor, remark)
  values (p_id, r.company_id, r.current_step, 'cancel', auth.uid(), p_reason);
  return r;
end;
$fn$;
grant execute on function public.exit_request_cancel(uuid, text) to authenticated;

-- Audited correction of an already-approved leaving date. Blocked once the
-- linked F&F has moved past the editable stage (must reverse it first, §4/§24).
create or replace function public.exit_request_correct_leaving_date(p_id uuid, p_new_leaving_date date, p_reason text)
returns public.employee_exit_requests
language plpgsql
security definer
as $fn$
declare r public.employee_exit_requests; v_fnf public.fnf_settlements; v_emp record;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to correct a leaving date.'; end if;
  select * into r from public.employee_exit_requests where id = p_id for update;
  if r.id is null then raise exception 'Exit request not found.'; end if;
  if not (public.is_super_admin() or public.payroll_can_manage(r.company_id)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if r.status <> 'approved' then raise exception 'Only an approved exit request has an effective leaving date to correct.'; end if;
  select joining_date into v_emp from public.employees where id = r.employee_id;
  if v_emp.joining_date is not null and p_new_leaving_date < v_emp.joining_date then
    raise exception 'Leaving date % is before the joining date %.', p_new_leaving_date, v_emp.joining_date;
  end if;

  if r.fnf_settlement_id is not null then
    select * into v_fnf from public.fnf_settlements where id = r.fnf_settlement_id;
    if v_fnf.id is not null and v_fnf.status not in ('draft', 'under_review', 'calculated', 'sent_back') then
      raise exception 'F&F is % — reverse it before correcting the leaving date.', v_fnf.status;
    end if;
    if v_fnf.id is not null then
      update public.fnf_settlements set leaving_date = p_new_leaving_date, updated_by = auth.uid() where id = v_fnf.id;
    end if;
  end if;

  update public.employees set leaving_date = p_new_leaving_date, updated_by = auth.uid() where id = r.employee_id;
  update public.employee_exit_requests set requested_leaving_date = p_new_leaving_date, effective_leaving_date = p_new_leaving_date,
    updated_by = auth.uid() where id = p_id returning * into r;
  insert into public.employee_exit_request_decisions (exit_request_id, company_id, step_no, action, actor, remark)
  values (p_id, r.company_id, r.current_step, 'correct_leaving_date', auth.uid(), p_reason);
  return r;
end;
$fn$;
grant execute on function public.exit_request_correct_leaving_date(uuid, date, text) to authenticated;

-- Normal F&F creation path: only from an APPROVED exit request.
create or replace function public.fnf_create_from_exit_request(p_exit_request_id uuid)
returns public.fnf_settlements
language plpgsql
security definer
as $fn$
declare r public.employee_exit_requests; v_type public.exit_types; v_fnf public.fnf_settlements;
begin
  select * into r from public.employee_exit_requests where id = p_exit_request_id for update;
  if r.id is null then raise exception 'Exit request not found.'; end if;
  if not public.payroll_can_manage(r.company_id) then raise exception 'Not authorised to manage F&F for this company.' using errcode = '42501'; end if;
  if r.status <> 'approved' then raise exception 'F&F is only available once the exit request is approved (current: %).', r.status; end if;
  if r.fnf_settlement_id is not null then raise exception 'An F&F settlement already exists for this exit request.' using errcode = '23505'; end if;

  select * into v_type from public.exit_types where id = r.exit_type_id;
  v_fnf := public.fnf_create(r.company_id, r.employee_id, coalesce(v_type.name, v_type.code), r.effective_leaving_date,
              r.notice_served_days, false, 0, null);

  update public.fnf_settlements set exit_request_id = r.id, updated_by = auth.uid() where id = v_fnf.id returning * into v_fnf;
  update public.employee_exit_requests set fnf_settlement_id = v_fnf.id, updated_by = auth.uid() where id = r.id;
  return v_fnf;
end;
$fn$;
grant execute on function public.fnf_create_from_exit_request(uuid) to authenticated;

create or replace function public.exit_request_list(p_company_id uuid)
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text, store text, department text,
  joining_date date, exit_type text, requested_leaving_date date, effective_leaving_date date,
  status text, current_step int, fnf_settlement_id uuid, created_at timestamptz
)
language sql
stable
security definer
as $fn$
  select r.id, r.employee_id, e.full_name, e.employee_code,
         (select name from public.stores st where st.id = e.store_id),
         (select name from public.store_departments d where d.id = e.store_department_id),
         e.joining_date, t.name, r.requested_leaving_date, r.effective_leaving_date,
         r.status, r.current_step, r.fnf_settlement_id, r.created_at
  from public.employee_exit_requests r
  join public.employees e on e.id = r.employee_id
  join public.exit_types t on t.id = r.exit_type_id
  where r.company_id = p_company_id
    and (is_super_admin() or (current_user_role() <> 'staff' and r.company_id = current_user_company_id()) or r.employee_id = current_user_employee_id())
  order by r.created_at desc;
$fn$;
grant execute on function public.exit_request_list(uuid) to authenticated;

create or replace function public.exit_request_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
as $fn$
declare r public.employee_exit_requests; v_out jsonb; v_emp record;
begin
  select * into r from public.employee_exit_requests where id = p_id;
  if r.id is null then raise exception 'Exit request not found.'; end if;
  if not (public.is_super_admin() or (public.current_user_role() <> 'staff' and r.company_id = public.current_user_company_id()) or r.employee_id = public.current_user_employee_id()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select e.full_name, e.employee_code, e.joining_date,
         (select name from public.stores st where st.id = e.store_id) store,
         (select name from public.store_departments d where d.id = e.store_department_id) department,
         (select title from public.store_designations g where g.id = e.store_designation_id) designation
    into v_emp from public.employees e where e.id = r.employee_id;
  v_out := to_jsonb(r) || jsonb_build_object(
    'employee_name', v_emp.full_name, 'employee_code', v_emp.employee_code, 'joining_date', v_emp.joining_date,
    'store', v_emp.store, 'department', v_emp.department, 'designation', v_emp.designation,
    'max_stage', public.exit_request_max_stage(r.company_id),
    'exit_type', (select to_jsonb(t) from public.exit_types t where t.id = r.exit_type_id),
    'decisions', (select coalesce(jsonb_agg(to_jsonb(d) order by d.decided_at), '[]'::jsonb)
                  from public.employee_exit_request_decisions d where d.exit_request_id = r.id)
  );
  return v_out;
end;
$fn$;
grant execute on function public.exit_request_get(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- G. Exit Register report.
-- ----------------------------------------------------------------------------
create or replace function public.exit_register(p_company_id uuid, p_from date default null, p_to date default null)
returns table (
  staff_id text, employee_name text, store text, department text, joining_date date, leaving_date date,
  exit_type text, reason text, exit_status text, fnf_status text, fnf_amount numeric, payment_status text
)
language sql
stable
security definer
as $fn$
  select e.employee_code, e.full_name,
         (select name from public.stores st where st.id = e.store_id),
         (select name from public.store_departments d where d.id = e.store_department_id),
         e.joining_date, e.leaving_date, coalesce(t.name, f.exit_type), r.reason, e.exit_status,
         coalesce(f.status, 'not_started'), f.net_settlement,
         case when f.status is null then 'not_started'
              when f.status in ('paid', 'closed') then 'paid'
              when f.status = 'partially_paid' then 'partially_paid'
              else 'pending' end
  from public.employees e
  left join lateral (
    select * from public.employee_exit_requests er
    where er.employee_id = e.id and er.status not in ('rejected', 'cancelled')
    order by er.created_at desc limit 1
  ) r on true
  left join public.exit_types t on t.id = r.exit_type_id
  left join lateral (
    select * from public.fnf_settlements fs
    where fs.employee_id = e.id and (fs.id = r.fnf_settlement_id or fs.status not in ('rejected', 'reversed'))
    order by fs.created_at desc limit 1
  ) f on true
  where e.company_id = p_company_id and e.leaving_date is not null
    and (p_from is null or e.leaving_date >= p_from) and (p_to is null or e.leaving_date <= p_to)
    and (is_super_admin() or (current_user_role() <> 'staff' and e.company_id = current_user_company_id()))
  order by e.leaving_date desc;
$fn$;
grant execute on function public.exit_register(uuid, date, date) to authenticated;
