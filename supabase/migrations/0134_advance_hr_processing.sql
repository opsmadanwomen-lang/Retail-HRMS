-- ============================================================================
-- Retail HRMS — Advance Management, Phase 2: HR PROCESS EXECUTION
-- Migration 0134
--
-- Workflow added in this phase:  Boss Approved -> HR Processing -> Ready for
-- Finance. HR IS NOT AN APPROVAL LEVEL — it cannot approve/reject the Boss
-- decision and cannot change requested_amount / manager_recommended_amount /
-- boss_approved_amount. HR only Processes (-> finance_pending), Holds, or
-- Sends Back an already Boss-approved request. Finance payment, payroll
-- recovery, installments, settlement and closure are NOT part of this phase.
--
-- Reuses (unmodified): advance_requests, advance_request_documents,
-- advance_approval_actions, advance_types, advance_policies,
-- advance_policy_configs, advance_policy_assignments, advance_final_approvers,
-- advance_hr_processors, advance_finance_processors,
-- advance_notification_settings, current_user_employee_id(),
-- current_user_company_id(), current_user_role(), is_super_admin(),
-- advance_am_i_hr(), advance_am_i_boss(), advance_resolve_direct_manager(),
-- advance_notify(), write_audit_log(), set_updated_at().
-- advance_manager_decide() / advance_boss_decide() / advance_apply() are
-- UNTOUCHED — Boss approval still sets status='approved', exactly as Phase 1
-- left it. Nothing in Leave / Night Duty / Attendance / Payroll is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Status extension. Only 4 new values added — no 'paid' / 'recovering' /
--    'closed' (later phases). 'hr_pending' exists purely as the "resumed after
--    hold/send-back" marker — see the RESOLVED DECISION note above
--    advance_hr_process() below for why HR's three actions accept EITHER
--    'approved' or 'hr_pending' as their starting state.
-- ----------------------------------------------------------------------------
alter table public.advance_requests drop constraint advance_requests_status_check;
alter table public.advance_requests add constraint advance_requests_status_check
  check (status in (
    'manager_pending', 'boss_pending', 'approved', 'rejected', 'sent_back', 'cancelled',
    'hr_pending', 'hr_on_hold', 'hr_sent_back', 'finance_pending'
  ));

-- ----------------------------------------------------------------------------
-- B. advance_hr_processes — the HR execution record, separate from the
--    original request. One row per advance_request_id (created on the first
--    HR action, updated in place thereafter). boss_approved_amount is COPIED
--    in at process time for HR's own record-keeping — the authoritative value
--    always remains advance_requests.boss_approved_amount, which this table
--    never writes back to.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_hr_processes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  boss_approved_amount numeric not null check (boss_approved_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'processed', 'on_hold', 'sent_back')),
  processed_by uuid,
  processed_at timestamptz,
  hold_reason text,
  send_back_reason text,
  process_remarks text,
  verification_status text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (advance_request_id)
);
create index if not exists idx_advance_hr_processes_company on public.advance_hr_processes (company_id, status);

-- ----------------------------------------------------------------------------
-- C. advance_hr_process_actions — INSERT-only semantic history, same
--    architecture as advance_approval_actions. 'resumed' is an addition beyond
--    the literal Phase 2 spec list (processed/on_hold/sent_back/commented) —
--    see advance_hr_resume() below for why it exists and is scoped narrowly.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_hr_process_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  hr_process_id uuid not null references public.advance_hr_processes (id) on delete cascade,
  actor_employee_id uuid not null references public.employees (id),
  action text not null check (action in ('processed', 'on_hold', 'sent_back', 'resumed', 'commented')),
  remark text,
  old_status text,
  new_status text,
  acted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_advance_hr_process_actions_request on public.advance_hr_process_actions (advance_request_id);

alter table public.advance_hr_processes enable row level security;
alter table public.advance_hr_process_actions enable row level security;

create trigger trg_advance_hr_processes_set_updated_at before update on public.advance_hr_processes for each row execute function public.set_updated_at();
create trigger trg_advance_hr_processes_audit after insert or update or delete on public.advance_hr_processes for each row execute function public.write_audit_log();
create trigger trg_advance_hr_process_actions_audit after insert on public.advance_hr_process_actions for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- RLS — visibility mirrors advance_approval_actions/advance_request_documents:
-- Super Admin, non-staff same-company, the request's own employee, their
-- Reporting Manager, the company's active Boss, and an active HR Processor of
-- the SAME company (resolved through advance_am_i_hr(), never a bare
-- sub-select on advance_hr_processors, for the identical reason the Phase 1
-- Boss policy was fixed in migration 0133 — that table's own RLS would
-- otherwise filter out a staff-role HR Processor querying it indirectly).
-- Direct table writes remain Super-Admin-only; real writes go through the
-- SECURITY DEFINER RPCs below. No UPDATE/DELETE policy on
-- advance_hr_process_actions -> immutable for everyone.
-- ----------------------------------------------------------------------------
create policy "advance_hr_processes_select" on public.advance_hr_processes for select
  using (
    is_super_admin()
    or exists (
      select 1 from public.advance_requests a
      where a.id = advance_request_id
        and (
          (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or a.employee_id = current_user_employee_id()
          or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
          or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  );
create policy "advance_hr_processes_write"  on public.advance_hr_processes for insert with check (is_super_admin());
create policy "advance_hr_processes_update" on public.advance_hr_processes for update using (is_super_admin());

create policy "advance_hr_process_actions_select" on public.advance_hr_process_actions for select
  using (
    is_super_admin()
    or exists (
      select 1 from public.advance_requests a
      where a.id = advance_request_id
        and (
          (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or a.employee_id = current_user_employee_id()
          or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
          or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  );
create policy "advance_hr_process_actions_write" on public.advance_hr_process_actions for insert with check (is_super_admin());
-- no UPDATE / DELETE policy -> immutable for everyone.

-- ----------------------------------------------------------------------------
-- advance_list_hr_pending(): the HR queue. Company is resolved from the
-- CALLER's own active advance_hr_processors row — never client-supplied — so
-- an HR Processor of Company A structurally cannot see Company B's requests.
-- Only 'approved' (fresh Boss approval) and 'hr_pending' (resumed after
-- hold/send-back) are returned; manager_pending / boss_pending / rejected /
-- cancelled / hr_on_hold / hr_sent_back / finance_pending are never listed
-- here (on-hold and sent-back have their own tabs backed by
-- advance_get_hr_process()/advance_list_my_decisions-style queries on the
-- frontend — see AdvanceHrProcessingPage).
-- ----------------------------------------------------------------------------
create or replace function public.advance_list_hr_pending()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  advance_type_name text,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  reason text,
  requested_at timestamptz,
  approval_completed_at timestamptz,
  status text
)
language plpgsql
stable
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_is_admin boolean := public.is_super_admin();
  v_hr_company uuid;
begin
  if not v_is_admin then
    select fa.company_id into v_hr_company from public.advance_hr_processors fa where fa.employee_id = v_caller and fa.is_active limit 1;
    if v_hr_company is null then
      raise exception 'You are not an active HR Processor.' using errcode = '42501';
    end if;
  end if;

  return query
  select a.id, a.employee_id, e.full_name, e.employee_code, t.name,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         a.reason, a.requested_at, a.decided_at, a.status
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  where a.status in ('approved', 'hr_pending')
    and (v_is_admin or a.company_id = v_hr_company)
  order by a.requested_at asc;
end;
$$;
grant execute on function public.advance_list_hr_pending() to authenticated;

-- ----------------------------------------------------------------------------
-- advance_list_hr_history(): a second addition beyond the literal §12 list —
-- necessary for the "On Hold" / "Sent Back" / "Processed (Ready for Finance)"
-- tabs the §26 HR UI asks for, which need a live list, not just a per-request
-- lookup. Same security model as advance_list_hr_pending() (company resolved
-- from the caller's own advance_hr_processors row), just a different status
-- filter — not a new business rule, purely a read query.
-- ----------------------------------------------------------------------------
create or replace function public.advance_list_hr_history()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  advance_type_name text,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  reason text,
  requested_at timestamptz,
  approval_completed_at timestamptz,
  status text,
  hr_status text,
  hold_reason text,
  send_back_reason text,
  processed_at timestamptz
)
language plpgsql
stable
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_is_admin boolean := public.is_super_admin();
  v_hr_company uuid;
begin
  if not v_is_admin then
    select fa.company_id into v_hr_company from public.advance_hr_processors fa where fa.employee_id = v_caller and fa.is_active limit 1;
    if v_hr_company is null then
      raise exception 'You are not an active HR Processor.' using errcode = '42501';
    end if;
  end if;

  return query
  select a.id, a.employee_id, e.full_name, e.employee_code, t.name,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         a.reason, a.requested_at, a.decided_at, a.status,
         hp.status, hp.hold_reason, hp.send_back_reason, hp.processed_at
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  left join public.advance_hr_processes hp on hp.advance_request_id = a.id
  where a.status in ('hr_on_hold', 'hr_sent_back', 'finance_pending')
    and (v_is_admin or a.company_id = v_hr_company)
  order by a.requested_at desc;
end;
$$;
grant execute on function public.advance_list_hr_history() to authenticated;

-- ----------------------------------------------------------------------------
-- advance_get_hr_process(): the full HR detail-drawer bundle for ONE request
-- (§7 of the audit checklist: identity, type, all three amounts, reason,
-- policy, approval history is fetched separately via the existing
-- advance_list_approval_history(), HR history via advance_list_hr_process_actions()
-- below). Visibility mirrors advance_hr_processes RLS exactly. Never returns
-- salary — only the amounts already stored on the request.
-- ----------------------------------------------------------------------------
create or replace function public.advance_get_hr_process(p_advance_request_id uuid)
returns table (
  advance_request_id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  advance_type_name text,
  policy_name text,
  policy_version int,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  reason text,
  remarks text,
  request_status text,
  requested_at timestamptz,
  approval_completed_at timestamptz,
  document_count int,
  hr_process_id uuid,
  hr_status text,
  hold_reason text,
  send_back_reason text,
  process_remarks text,
  verification_status text,
  processed_by_name text,
  processed_at timestamptz
)
language plpgsql
stable
security definer
as $$
begin
  if not exists (
    select 1 from public.advance_requests a
    where a.id = p_advance_request_id
      and (
        public.is_super_admin()
        or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
        or a.employee_id = current_user_employee_id()
        or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
        or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
      )
  ) then
    raise exception 'Advance request not found or not visible to you.';
  end if;

  return query
  select a.id, a.employee_id, e.full_name, e.employee_code, t.name, p.name, a.policy_version,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         a.reason, a.remarks, a.status, a.requested_at, a.decided_at,
         (select count(*)::int from public.advance_request_documents d where d.advance_request_id = a.id),
         hp.id, hp.status, hp.hold_reason, hp.send_back_reason, hp.process_remarks, hp.verification_status,
         pb.full_name, hp.processed_at
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  join public.advance_policies p on p.id = a.policy_id
  left join public.advance_hr_processes hp on hp.advance_request_id = a.id
  left join public.employees pb on pb.auth_user_id = hp.processed_by
  where a.id = p_advance_request_id;
end;
$$;
grant execute on function public.advance_get_hr_process(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_list_hr_process_actions(): immutable HR history for one request —
-- the HR-side counterpart of advance_list_approval_history(). Same visibility
-- rule as advance_get_hr_process().
-- ----------------------------------------------------------------------------
create or replace function public.advance_list_hr_process_actions(p_advance_request_id uuid)
returns table (
  action text,
  actor_employee_id uuid,
  actor_name text,
  remark text,
  old_status text,
  new_status text,
  acted_at timestamptz
)
language sql
stable
security definer
as $$
  select ha.action, ha.actor_employee_id, e.full_name, ha.remark, ha.old_status, ha.new_status, ha.acted_at
  from public.advance_hr_process_actions ha
  join public.employees e on e.id = ha.actor_employee_id
  where ha.advance_request_id = p_advance_request_id
    and exists (
      select 1 from public.advance_requests a
      where a.id = p_advance_request_id
        and (
          is_super_admin()
          or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or a.employee_id = current_user_employee_id()
          or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
          or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  order by ha.acted_at asc;
$$;
grant execute on function public.advance_list_hr_process_actions(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Shared authorization prelude used by every mutating HR RPC below. Not a
-- standalone function (SECURITY DEFINER functions cannot easily share
-- exception context across calls while still reporting the caller's own
-- errors), so the same four checks are inlined in each of the three RPCs:
--   1) caller's login is active
--   2) caller resolves to an employee record
--   3) caller is an ACTIVE advance_hr_processors row -> that row's OWN
--      company_id is the only company this call may ever touch (never
--      current_user_company_id(), and never a client-supplied company id)
--   4) the target request belongs to that exact company
-- No is_super_admin() bypass is offered for these three mutating actions —
-- deliberately, matching the precedent already set by advance_manager_decide()
-- / advance_boss_decide() in Phase 1 (neither has a super-admin override
-- either), and satisfying §39's requirement that Super Admin not silently
-- bypass the HR workflow during normal testing. Super Admin's elevated access
-- in this phase is read-only (the RLS `is_super_admin()` branches above) plus
-- the pre-existing Advance Management admin UI for the advance_hr_processors
-- roster itself.
-- ----------------------------------------------------------------------------

-- RESOLVED DESIGN DECISION (see also §26 in the Phase 2 report):
-- advance_requests never stores a persisted 'hr_pending' the moment Boss
-- approves — advance_boss_decide() is UNTOUCHED and still sets 'approved'.
-- 'hr_pending' exists solely as the state a request RETURNS to after
-- advance_hr_resume() undoes a Hold/Send-Back. All three HR actions below
-- therefore accept EITHER 'approved' OR 'hr_pending' as a valid starting
-- state — the two are functionally identical to HR ("available to work on"),
-- and advance_list_hr_pending() lists both together. This satisfies §9's own
-- wording ("status = approved OR status = hr_pending depending on the
-- implemented transition") without inventing an extra no-op transition.

create or replace function public.advance_hr_process(p_advance_request_id uuid, p_remarks text default null)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_hr record;
  v_req public.advance_requests;
  v_old_status text;
  v_hr_process_id uuid;
  v_updated int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_hr from public.advance_hr_processors where employee_id = v_caller and is_active;
  if v_hr.id is null then
    raise exception 'You are not an active HR Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then
    raise exception 'Advance request not found.';
  end if;
  if v_req.company_id <> v_hr.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;
  if v_req.status not in ('approved', 'hr_pending') then
    raise exception 'This request is not available for HR processing (current status: %).', v_req.status;
  end if;
  if v_req.boss_approved_amount is null then
    raise exception 'This request has no Boss Approved Amount and cannot be processed.';
  end if;
  v_old_status := v_req.status;

  update public.advance_requests
  set status = 'finance_pending', updated_by = auth.uid()
  where id = p_advance_request_id and status in ('approved', 'hr_pending')
  returning * into v_req;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Advance has already been processed or is no longer available for HR processing.';
  end if;

  select id into v_hr_process_id from public.advance_hr_processes where advance_request_id = p_advance_request_id;
  if v_hr_process_id is null then
    insert into public.advance_hr_processes (
      company_id, advance_request_id, employee_id, boss_approved_amount, status,
      processed_by, processed_at, hold_reason, send_back_reason, process_remarks, verification_status,
      created_by, updated_by
    ) values (
      v_req.company_id, v_req.id, v_req.employee_id, v_req.boss_approved_amount, 'processed',
      auth.uid(), now(), null, null, p_remarks, 'verified',
      auth.uid(), auth.uid()
    ) returning id into v_hr_process_id;
  else
    update public.advance_hr_processes
    set status = 'processed', boss_approved_amount = v_req.boss_approved_amount,
        processed_by = auth.uid(), processed_at = now(),
        hold_reason = null, send_back_reason = null, process_remarks = p_remarks,
        verification_status = 'verified', updated_by = auth.uid()
    where id = v_hr_process_id;
  end if;

  insert into public.advance_hr_process_actions (company_id, advance_request_id, hr_process_id, actor_employee_id, action, remark, old_status, new_status, acted_at)
  values (v_req.company_id, v_req.id, v_hr_process_id, v_caller, 'processed', p_remarks, v_old_status, 'finance_pending', now());

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_hr_processed', 'Advance processed — ready for Finance',
    format('Your advance (%s) has been processed by HR and is ready for Finance.', v_req.boss_approved_amount), v_req.id);
  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_ready_for_finance', 'Advance ready for Finance',
    'Your advance now awaits Finance payment.', v_req.id);

  return v_req;
end;
$$;
grant execute on function public.advance_hr_process(uuid, text) to authenticated;

create or replace function public.advance_hr_hold(p_advance_request_id uuid, p_reason text)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_hr record;
  v_req public.advance_requests;
  v_old_status text;
  v_hr_process_id uuid;
  v_updated int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to put an advance on hold.';
  end if;

  select * into v_hr from public.advance_hr_processors where employee_id = v_caller and is_active;
  if v_hr.id is null then
    raise exception 'You are not an active HR Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then
    raise exception 'Advance request not found.';
  end if;
  if v_req.company_id <> v_hr.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;
  if v_req.status not in ('approved', 'hr_pending') then
    raise exception 'This request is not available for HR processing (current status: %).', v_req.status;
  end if;
  v_old_status := v_req.status;

  update public.advance_requests
  set status = 'hr_on_hold', updated_by = auth.uid()
  where id = p_advance_request_id and status in ('approved', 'hr_pending')
  returning * into v_req;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Advance has already been processed or is no longer available for HR processing.';
  end if;

  select id into v_hr_process_id from public.advance_hr_processes where advance_request_id = p_advance_request_id;
  if v_hr_process_id is null then
    insert into public.advance_hr_processes (company_id, advance_request_id, employee_id, boss_approved_amount, status, processed_by, processed_at, hold_reason, created_by, updated_by)
    values (v_req.company_id, v_req.id, v_req.employee_id, v_req.boss_approved_amount, 'on_hold', auth.uid(), now(), p_reason, auth.uid(), auth.uid())
    returning id into v_hr_process_id;
  else
    update public.advance_hr_processes
    set status = 'on_hold', boss_approved_amount = v_req.boss_approved_amount,
        processed_by = auth.uid(), processed_at = now(), hold_reason = p_reason, send_back_reason = null, updated_by = auth.uid()
    where id = v_hr_process_id;
  end if;

  insert into public.advance_hr_process_actions (company_id, advance_request_id, hr_process_id, actor_employee_id, action, remark, old_status, new_status, acted_at)
  values (v_req.company_id, v_req.id, v_hr_process_id, v_caller, 'on_hold', p_reason, v_old_status, 'hr_on_hold', now());

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_hr_on_hold', 'Advance on hold',
    format('Your advance has been put on hold by HR: %s', p_reason), v_req.id);

  return v_req;
end;
$$;
grant execute on function public.advance_hr_hold(uuid, text) to authenticated;

create or replace function public.advance_hr_send_back(p_advance_request_id uuid, p_reason text)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_hr record;
  v_req public.advance_requests;
  v_old_status text;
  v_hr_process_id uuid;
  v_updated int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to send an advance back.';
  end if;

  select * into v_hr from public.advance_hr_processors where employee_id = v_caller and is_active;
  if v_hr.id is null then
    raise exception 'You are not an active HR Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then
    raise exception 'Advance request not found.';
  end if;
  if v_req.company_id <> v_hr.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;
  if v_req.status not in ('approved', 'hr_pending') then
    raise exception 'This request is not available for HR processing (current status: %).', v_req.status;
  end if;
  v_old_status := v_req.status;

  -- Deliberately NOT 'rejected' — HR is not overturning the Boss's approval,
  -- only returning the request for clarification/correction (§16).
  update public.advance_requests
  set status = 'hr_sent_back', updated_by = auth.uid()
  where id = p_advance_request_id and status in ('approved', 'hr_pending')
  returning * into v_req;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Advance has already been processed or is no longer available for HR processing.';
  end if;

  select id into v_hr_process_id from public.advance_hr_processes where advance_request_id = p_advance_request_id;
  if v_hr_process_id is null then
    insert into public.advance_hr_processes (company_id, advance_request_id, employee_id, boss_approved_amount, status, processed_by, processed_at, send_back_reason, created_by, updated_by)
    values (v_req.company_id, v_req.id, v_req.employee_id, v_req.boss_approved_amount, 'sent_back', auth.uid(), now(), p_reason, auth.uid(), auth.uid())
    returning id into v_hr_process_id;
  else
    update public.advance_hr_processes
    set status = 'sent_back', boss_approved_amount = v_req.boss_approved_amount,
        processed_by = auth.uid(), processed_at = now(), send_back_reason = p_reason, hold_reason = null, updated_by = auth.uid()
    where id = v_hr_process_id;
  end if;

  insert into public.advance_hr_process_actions (company_id, advance_request_id, hr_process_id, actor_employee_id, action, remark, old_status, new_status, acted_at)
  values (v_req.company_id, v_req.id, v_hr_process_id, v_caller, 'sent_back', p_reason, v_old_status, 'hr_sent_back', now());

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_hr_sent_back', 'Advance sent back by HR',
    format('HR sent your advance back: %s', p_reason), v_req.id);

  return v_req;
end;
$$;
grant execute on function public.advance_hr_send_back(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_hr_resume(): an addition beyond the literal §12 RPC list, to give
-- the exact minimal transition §17 asks for (hr_on_hold / hr_sent_back ->
-- hr_pending) an actual caller. §17 explicitly says NOT to invent a new
-- approval rule if the resubmission trigger isn't already defined — an
-- employee-initiated "I've fixed it, please look again" flow is exactly such
-- an undefined rule, so it is intentionally NOT implemented here (flagged as
-- an unresolved business decision in the Phase 2 report). What IS implemented
-- is narrower and uncontroversial: the SAME HR Processor authority that can
-- Hold/Send Back a request can also undo its own hold/send-back and put the
-- request back into their own HR Pending queue — this is the inverse of an
-- action HR already has full authority over, not a new approval rule.
-- ----------------------------------------------------------------------------
create or replace function public.advance_hr_resume(p_advance_request_id uuid, p_remark text default null)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_hr record;
  v_req public.advance_requests;
  v_old_status text;
  v_hr_process_id uuid;
  v_updated int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_hr from public.advance_hr_processors where employee_id = v_caller and is_active;
  if v_hr.id is null then
    raise exception 'You are not an active HR Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then
    raise exception 'Advance request not found.';
  end if;
  if v_req.company_id <> v_hr.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;
  if v_req.status not in ('hr_on_hold', 'hr_sent_back') then
    raise exception 'Only an on-hold or sent-back request can be resumed (current status: %).', v_req.status;
  end if;
  v_old_status := v_req.status;

  update public.advance_requests
  set status = 'hr_pending', updated_by = auth.uid()
  where id = p_advance_request_id and status in ('hr_on_hold', 'hr_sent_back')
  returning * into v_req;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Advance is no longer available to resume.';
  end if;

  select id into v_hr_process_id from public.advance_hr_processes where advance_request_id = p_advance_request_id;
  update public.advance_hr_processes
  set status = 'pending', hold_reason = null, send_back_reason = null, updated_by = auth.uid()
  where id = v_hr_process_id;

  insert into public.advance_hr_process_actions (company_id, advance_request_id, hr_process_id, actor_employee_id, action, remark, old_status, new_status, acted_at)
  values (v_req.company_id, v_req.id, v_hr_process_id, v_caller, 'resumed', p_remark, v_old_status, 'hr_pending', now());

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_hr_processing_required', 'Advance back in HR processing',
    'Your advance has been moved back into HR processing.', v_req.id);

  return v_req;
end;
$$;
grant execute on function public.advance_hr_resume(uuid, text) to authenticated;
