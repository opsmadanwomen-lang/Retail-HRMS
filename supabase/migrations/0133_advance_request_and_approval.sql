-- ============================================================================
-- Retail HRMS — Advance Management, Phase 1 (part 2 of 2):
--   REQUEST + REPORTING-MANAGER APPROVAL + BOSS FINAL APPROVAL
-- Migration 0133
--
-- Workflow (Phase 1 only):  Employee -> Reporting Manager -> Boss (final).
-- HR is NOT an approval level and is not referenced by any transition here.
-- Amount model: requested_amount is IMMUTABLE; manager_recommended_amount and
-- boss_approved_amount are separate columns, never overwriting each other.
-- All authority is enforced inside SECURITY DEFINER RPCs + RLS; the frontend
-- is presentation only. Approval history (advance_approval_actions) is
-- INSERT-only. Notifications reuse the generic `notifications` table via a
-- thin advance_notify() wrapper (identical body to leave_notify()).
-- Nothing in Leave / Night Duty / Attendance / Payroll is modified.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- advance_requests — the central request row.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  advance_type_id uuid not null references public.advance_types (id),
  policy_id uuid not null references public.advance_policies (id),
  policy_version int not null,
  requested_amount numeric not null check (requested_amount > 0),      -- IMMUTABLE
  manager_recommended_amount numeric check (manager_recommended_amount is null or manager_recommended_amount >= 0),
  boss_approved_amount numeric check (boss_approved_amount is null or boss_approved_amount >= 0),
  boss_modification_reason text,
  reason text not null,
  remarks text,
  status text not null default 'manager_pending'
    check (status in ('manager_pending', 'boss_pending', 'approved', 'rejected', 'sent_back', 'cancelled')),
  current_step int not null default 1,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_advance_requests_company on public.advance_requests (company_id, status);
create index if not exists idx_advance_requests_employee on public.advance_requests (employee_id, status);

create table if not exists public.advance_request_documents (
  id uuid primary key default gen_random_uuid(),
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  doc_kind text not null default 'supporting' check (doc_kind in ('supporting', 'payment_proof')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_advance_request_documents_request on public.advance_request_documents (advance_request_id);

-- Immutable approval-action log (same architecture as leave_approval_actions).
create table if not exists public.advance_approval_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  step_order int not null check (step_order in (1, 2)),
  actor_role text not null check (actor_role in ('reporting_manager', 'boss')),
  actor_employee_id uuid not null references public.employees (id),
  action text not null check (action in ('approved', 'rejected', 'sent_back', 'amount_modified', 'commented')),
  old_amount numeric,
  new_amount numeric,
  remark text,
  acted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_advance_approval_actions_request on public.advance_approval_actions (advance_request_id);

alter table public.advance_requests enable row level security;
alter table public.advance_request_documents enable row level security;
alter table public.advance_approval_actions enable row level security;

create trigger trg_advance_requests_set_updated_at before update on public.advance_requests for each row execute function public.set_updated_at();
create trigger trg_advance_requests_audit after insert or update or delete on public.advance_requests for each row execute function public.write_audit_log();
create trigger trg_advance_request_documents_audit after insert or delete on public.advance_request_documents for each row execute function public.write_audit_log();
create trigger trg_advance_approval_actions_audit after insert on public.advance_approval_actions for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- RLS: Staff sees own; the assigned Reporting Manager sees the request;
-- an active configured Boss sees the company's requests; non-staff company
-- roles see company-wide; Super Admin sees all. All writes are Super-Admin-only
-- at the RLS layer (real writes go through the SECURITY DEFINER RPCs below).
-- ----------------------------------------------------------------------------
-- NOTE: the "am I the configured Boss" test MUST go through the SECURITY DEFINER
-- helper public.advance_am_i_boss(). A bare sub-select against advance_final_approvers
-- inside a policy is itself filtered by that table's RLS (which excludes staff),
-- so a staff-role Boss would see nothing. The manager test likewise uses the
-- SECURITY DEFINER resolver.
create policy "advance_requests_select" on public.advance_requests for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or employee_id = current_user_employee_id()
    or public.advance_resolve_direct_manager(advance_requests.employee_id) = current_user_employee_id()
    or (public.advance_am_i_boss(public.current_user_employee_id()) and company_id = current_user_company_id())
  );
create policy "advance_requests_write"  on public.advance_requests for insert with check (is_super_admin());
create policy "advance_requests_update" on public.advance_requests for update using (is_super_admin());

create policy "advance_request_documents_select" on public.advance_request_documents for select
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
        )
    )
  );
create policy "advance_request_documents_write" on public.advance_request_documents for insert with check (is_super_admin());

create policy "advance_approval_actions_select" on public.advance_approval_actions for select
  using (
    exists (
      select 1 from public.advance_requests a
      where a.id = advance_request_id
        and (
          is_super_admin()
          or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or a.employee_id = current_user_employee_id()
          or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
          or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  );
create policy "advance_approval_actions_write" on public.advance_approval_actions for insert with check (is_super_admin());
-- no UPDATE / DELETE policy on advance_approval_actions -> immutable for everyone.

-- ----------------------------------------------------------------------------
-- advance_notify(): thin wrapper over the generic `notifications` table
-- (identical body shape to leave_notify()). Respects advance_notification_settings
-- (in-app is the only delivered channel today).
-- ----------------------------------------------------------------------------
create or replace function public.advance_notify(
  p_company_id uuid,
  p_recipient_employee_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_related_id uuid
)
returns void
language plpgsql
security definer
as $$
declare v_in_app boolean;
begin
  if p_recipient_employee_id is null then return; end if;
  select coalesce(in_app_enabled, true) into v_in_app
  from public.advance_notification_settings
  where company_id = p_company_id and event_type = p_event_type;
  if v_in_app is null then v_in_app := true; end if;  -- default on when unconfigured
  if not v_in_app then return; end if;

  insert into public.notifications (company_id, recipient_employee_id, event_type, title, body, related_table, related_id, is_read)
  values (p_company_id, p_recipient_employee_id, p_event_type, p_title, p_body, 'advance_requests', p_related_id, false);
end;
$$;
grant execute on function public.advance_notify(uuid, uuid, text, text, text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_get_apply_context(): everything the Staff "Request Advance" form
-- needs. Self-scoped (current_user_employee_id()). Returns the COMPUTED
-- maximum allowed amount — never the raw salary.
-- ----------------------------------------------------------------------------
create or replace function public.advance_get_apply_context()
returns table (
  employee_id uuid,
  employee_name text,
  employee_code text,
  policy_id uuid,
  policy_name text,
  policy_version int,
  service_months int,
  active_advance_count int,
  reporting_manager_configured boolean,
  boss_configured boolean,
  max_amount numeric,
  max_pct_of_salary numeric,
  max_allowed_amount numeric,
  min_service_months int,
  max_active_advances int,
  allow_multiple_advances boolean,
  manager_approval_required boolean,
  boss_final_approval_required boolean,
  eligible boolean,
  ineligible_reason text
)
language plpgsql
stable
security definer
as $$
#variable_conflict use_variable
declare
  v_emp record;
  v_pol record;
  v_cfg record;
  v_policy_id uuid;
  v_salary numeric;
  v_pct_limit numeric;
  v_allowed numeric;
  v_service_months int;
  v_active int;
  v_mgr uuid;
  v_boss uuid;
  v_reason text;
begin
  select e.id, e.company_id, e.full_name, e.employee_code, e.joining_date, e.status
  into v_emp from public.employees e where e.id = public.current_user_employee_id();
  if v_emp.id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  v_policy_id := public.advance_resolve_policy_assignment(v_emp.company_id, v_emp.id, current_date);
  -- INTO always assigns the record (all-NULL fields when no row), so v_pol / v_cfg
  -- are safe to read below even when no policy is resolved.
  select p.id, p.name, p.version_number into v_pol from public.advance_policies p where p.id = v_policy_id;
  select c.* into v_cfg from public.advance_policy_configs c where c.policy_id = v_policy_id;

  v_salary := public.advance_resolve_salary_gross(v_emp.id, current_date);
  v_pct_limit := case
    when v_salary is not null and v_cfg.max_pct_of_salary is not null
    then round(v_cfg.max_pct_of_salary / 100.0 * v_salary, 2) else null end;
  v_allowed := least(v_cfg.max_amount, v_pct_limit);   -- least() ignores NULLs

  v_service_months := case when v_emp.joining_date is null then 0
    else (extract(year from age(current_date, v_emp.joining_date)) * 12 + extract(month from age(current_date, v_emp.joining_date)))::int end;

  select count(*) into v_active from public.advance_requests a
  where a.employee_id = v_emp.id and a.status in ('manager_pending', 'boss_pending', 'approved');

  v_mgr := public.advance_resolve_direct_manager(v_emp.id);
  v_boss := public.advance_resolve_final_approver(v_emp.company_id);

  v_reason := null;
  if v_emp.status is distinct from 'active' then v_reason := 'Employee is not active.';
  elsif v_policy_id is null then v_reason := 'No Advance Policy is assigned for this employee.';
  elsif v_cfg.id is null then v_reason := 'The assigned Advance Policy has no configuration.';
  elsif v_mgr is null then v_reason := 'Advance approval workflow is not configured for this employee. Please contact HR.';
  elsif coalesce(v_cfg.boss_final_approval_required, true) and v_boss is null then v_reason := 'No Final Approver (Boss) is configured for this company. Please contact HR.';
  elsif v_service_months < coalesce(v_cfg.min_service_months, 0) then v_reason := format('Minimum service of %s month(s) is required.', v_cfg.min_service_months);
  elsif not coalesce(v_cfg.allow_multiple_advances, false) and v_active >= 1 then v_reason := 'You already have an active advance.';
  elsif v_active >= coalesce(v_cfg.max_active_advances, 1) then v_reason := format('Maximum of %s active advance(s) reached.', v_cfg.max_active_advances);
  end if;

  employee_id := v_emp.id;
  employee_name := v_emp.full_name;
  employee_code := v_emp.employee_code;
  policy_id := v_policy_id;
  policy_name := v_pol.name;
  policy_version := v_pol.version_number;
  service_months := v_service_months;
  active_advance_count := v_active;
  reporting_manager_configured := v_mgr is not null;
  boss_configured := v_boss is not null;
  max_amount := v_cfg.max_amount;
  max_pct_of_salary := v_cfg.max_pct_of_salary;
  max_allowed_amount := v_allowed;
  min_service_months := v_cfg.min_service_months;
  max_active_advances := v_cfg.max_active_advances;
  allow_multiple_advances := v_cfg.allow_multiple_advances;
  manager_approval_required := coalesce(v_cfg.manager_approval_required, true);
  boss_final_approval_required := coalesce(v_cfg.boss_final_approval_required, true);
  eligible := v_reason is null;
  ineligible_reason := v_reason;
  return next;
end;
$$;
grant execute on function public.advance_get_apply_context() to authenticated;

-- ----------------------------------------------------------------------------
-- advance_apply(): NO employee_id parameter — identity is
-- current_user_employee_id(). Backend-enforces every §20 check. Writes NO
-- ledger row (recovery is Phase 3).
-- ----------------------------------------------------------------------------
create or replace function public.advance_apply(
  p_advance_type_id uuid,
  p_requested_amount numeric,
  p_reason text,
  p_remarks text default null,
  p_document_storage_path text default null,
  p_document_file_name text default null,
  p_document_mime_type text default null,
  p_document_file_size_bytes bigint default null
)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_emp record;
  v_type record;
  v_policy_id uuid;
  v_policy record;
  v_cfg record;
  v_mgr uuid;
  v_boss uuid;
  v_salary numeric;
  v_allowed numeric;
  v_service_months int;
  v_active int;
  v_status text;
  v_step int;
  v_request public.advance_requests;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;

  select id, company_id, full_name, joining_date, status
  into v_emp from public.employees where id = public.current_user_employee_id();
  if v_emp.id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;
  if v_emp.status is distinct from 'active' then
    raise exception 'Only an active employee may request an advance.';
  end if;

  if p_requested_amount is null or p_requested_amount <= 0 then
    raise exception 'Requested amount must be greater than zero.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required for an advance request.';
  end if;

  select id, is_active, requires_document into v_type from public.advance_types
  where id = p_advance_type_id and company_id = v_emp.company_id;
  if v_type.id is null or not v_type.is_active then
    raise exception 'Selected Advance Type is not available.';
  end if;
  if v_type.requires_document and p_document_storage_path is null then
    raise exception 'This Advance Type requires a supporting document.';
  end if;

  v_policy_id := public.advance_resolve_policy_assignment(v_emp.company_id, v_emp.id, current_date);
  if v_policy_id is null then
    raise exception 'No Advance Policy is assigned for this employee.';
  end if;
  select id, name, version_number, status into v_policy from public.advance_policies where id = v_policy_id;
  if v_policy.status <> 'active' then
    raise exception 'The assigned Advance Policy is not active.';
  end if;
  select * into v_cfg from public.advance_policy_configs where policy_id = v_policy_id;
  if v_cfg.id is null then
    raise exception 'The assigned Advance Policy has no configuration.';
  end if;

  v_mgr := public.advance_resolve_direct_manager(v_emp.id);
  if v_mgr is null then
    raise exception 'Advance approval workflow is not configured for this employee. Please contact HR.';
  end if;

  v_boss := public.advance_resolve_final_approver(v_emp.company_id);
  if coalesce(v_cfg.boss_final_approval_required, true) and v_boss is null then
    raise exception 'No Final Approver (Boss) is configured for this company. Please contact HR.';
  end if;

  v_service_months := case when v_emp.joining_date is null then 0
    else (extract(year from age(current_date, v_emp.joining_date)) * 12 + extract(month from age(current_date, v_emp.joining_date)))::int end;
  if v_service_months < coalesce(v_cfg.min_service_months, 0) then
    raise exception 'Minimum service of % month(s) is required for an advance.', v_cfg.min_service_months;
  end if;

  select count(*) into v_active from public.advance_requests
  where employee_id = v_emp.id and status in ('manager_pending', 'boss_pending', 'approved');
  if not coalesce(v_cfg.allow_multiple_advances, false) and v_active >= 1 then
    raise exception 'You already have an active advance. Multiple advances are not allowed under your policy.';
  end if;
  if v_active >= coalesce(v_cfg.max_active_advances, 1) then
    raise exception 'You have reached the maximum of % active advance(s).', v_cfg.max_active_advances;
  end if;

  v_salary := public.advance_resolve_salary_gross(v_emp.id, current_date);
  v_allowed := least(
    v_cfg.max_amount,
    case when v_salary is not null and v_cfg.max_pct_of_salary is not null
         then round(v_cfg.max_pct_of_salary / 100.0 * v_salary, 2) else null end
  );
  if v_allowed is not null and p_requested_amount > v_allowed then
    raise exception 'Requested amount exceeds the maximum allowed for you (%).', v_allowed;
  end if;

  if coalesce(v_cfg.manager_approval_required, true) then
    v_status := 'manager_pending'; v_step := 1;
  elsif coalesce(v_cfg.boss_final_approval_required, true) then
    v_status := 'boss_pending'; v_step := 2;
  else
    v_status := 'approved'; v_step := 2;
  end if;

  insert into public.advance_requests (
    company_id, employee_id, advance_type_id, policy_id, policy_version,
    requested_amount, reason, remarks, status, current_step,
    boss_approved_amount, decided_by, decided_at, created_by, updated_by
  ) values (
    v_emp.company_id, v_emp.id, p_advance_type_id, v_policy_id, v_policy.version_number,
    p_requested_amount, p_reason, p_remarks, v_status, v_step,
    case when v_status = 'approved' then p_requested_amount else null end,
    case when v_status = 'approved' then auth.uid() else null end,
    case when v_status = 'approved' then now() else null end,
    auth.uid(), auth.uid()
  ) returning * into v_request;

  if p_document_storage_path is not null then
    insert into public.advance_request_documents (advance_request_id, doc_kind, storage_path, file_name, mime_type, file_size_bytes, created_by)
    values (v_request.id, 'supporting', p_document_storage_path, coalesce(p_document_file_name, 'document'), p_document_mime_type, p_document_file_size_bytes, auth.uid());
  end if;

  perform public.advance_notify(v_emp.company_id, v_emp.id, 'advance_applied', 'Advance request submitted',
    format('Your advance request for %s has been submitted.', p_requested_amount), v_request.id);
  if v_status = 'manager_pending' then
    perform public.advance_notify(v_emp.company_id, v_mgr, 'advance_manager_approval_required', 'Advance approval required',
      format('An advance request from %s (%s) requires your approval.', v_emp.full_name, p_requested_amount), v_request.id);
  elsif v_status = 'boss_pending' then
    perform public.advance_notify(v_emp.company_id, v_boss, 'advance_boss_approval_required', 'Advance final approval required',
      format('An advance request from %s (%s) requires your final approval.', v_emp.full_name, p_requested_amount), v_request.id);
  end if;

  return v_request;
end;
$$;
grant execute on function public.advance_apply(uuid, numeric, text, text, text, text, text, bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_manager_decide(): Step 1. approved / rejected / sent_back, with an
-- optional recommended amount (<= requested; never overwrites requested).
-- ----------------------------------------------------------------------------
create or replace function public.advance_manager_decide(
  p_request_id uuid,
  p_decision text,
  p_recommended_amount numeric default null,
  p_remark text default null
)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_req public.advance_requests;
  v_cfg record;
  v_new_status text;
  v_updated int;
  v_boss uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;
  if p_decision not in ('approved', 'rejected', 'sent_back') then
    raise exception 'Invalid decision.';
  end if;

  select * into v_req from public.advance_requests where id = p_request_id;
  if not found then raise exception 'Advance request not found.'; end if;
  if v_req.status <> 'manager_pending' then
    raise exception 'This request is not pending with the Reporting Manager (current status: %).', v_req.status;
  end if;
  if v_req.employee_id = v_caller then
    raise exception 'You cannot act on your own advance request.' using errcode = '42501';
  end if;
  if public.advance_resolve_direct_manager(v_req.employee_id) is distinct from v_caller then
    raise exception 'You are not the assigned Reporting Manager for this employee.' using errcode = '42501';
  end if;
  if p_decision in ('rejected', 'sent_back') and (p_remark is null or length(trim(p_remark)) = 0) then
    raise exception 'A remark is required to reject or send back a request.';
  end if;
  if p_recommended_amount is not null then
    if p_recommended_amount <= 0 then raise exception 'Recommended amount must be greater than zero.'; end if;
    if p_recommended_amount > v_req.requested_amount then
      raise exception 'Recommended amount cannot exceed the employee''s requested amount (%).', v_req.requested_amount;
    end if;
  end if;

  select * into v_cfg from public.advance_policy_configs where policy_id = v_req.policy_id;

  if p_decision = 'rejected' then v_new_status := 'rejected';
  elsif p_decision = 'sent_back' then v_new_status := 'sent_back';
  elsif coalesce(v_cfg.boss_final_approval_required, true) then v_new_status := 'boss_pending';
  else v_new_status := 'approved';
  end if;

  update public.advance_requests
  set status = v_new_status,
      current_step = case when v_new_status = 'boss_pending' then 2 else current_step end,
      manager_recommended_amount = coalesce(p_recommended_amount, manager_recommended_amount),
      boss_approved_amount = case when v_new_status = 'approved' then v_req.requested_amount else boss_approved_amount end,
      decided_by = case when v_new_status in ('approved', 'rejected') then auth.uid() else decided_by end,
      decided_at = case when v_new_status in ('approved', 'rejected') then now() else decided_at end,
      decision_remark = coalesce(p_remark, decision_remark),
      updated_by = auth.uid()
  where id = p_request_id and status = 'manager_pending'
  returning * into v_req;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Request has already been processed.';
  end if;

  if p_recommended_amount is not null and p_recommended_amount <> v_req.requested_amount then
    insert into public.advance_approval_actions (company_id, advance_request_id, step_order, actor_role, actor_employee_id, action, old_amount, new_amount, remark, acted_at)
    values (v_req.company_id, v_req.id, 1, 'reporting_manager', v_caller, 'amount_modified', v_req.requested_amount, p_recommended_amount, 'Manager recommended amount', now());
  end if;
  insert into public.advance_approval_actions (company_id, advance_request_id, step_order, actor_role, actor_employee_id, action, old_amount, new_amount, remark, acted_at)
  values (v_req.company_id, v_req.id, 1, 'reporting_manager', v_caller, p_decision, v_req.requested_amount, coalesce(p_recommended_amount, v_req.requested_amount), p_remark, now());

  if v_new_status = 'boss_pending' then
    v_boss := public.advance_resolve_final_approver(v_req.company_id);
    perform public.advance_notify(v_req.company_id, v_boss, 'advance_boss_approval_required', 'Advance final approval required',
      format('An advance request now requires your final approval (%s).', v_req.requested_amount), v_req.id);
    perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_manager_approved', 'Advance forwarded to Boss',
      'Your Reporting Manager approved your advance request; it now awaits final approval.', v_req.id);
  elsif v_new_status = 'approved' then
    perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_manager_approved', 'Advance approved',
      'Your advance request has been approved by your Reporting Manager.', v_req.id);
  elsif v_new_status = 'rejected' then
    perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_manager_rejected', 'Advance rejected',
      'Your advance request was rejected by your Reporting Manager.', v_req.id);
  else
    perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_sent_back', 'Advance sent back',
      'Your Reporting Manager sent your advance request back.', v_req.id);
  end if;

  return v_req;
end;
$$;
grant execute on function public.advance_manager_decide(uuid, text, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_boss_decide(): Step 2 (final). approved / modify-&-approve /
-- rejected / sent_back. All amount rules from §11/§27-30 enforced here.
-- ----------------------------------------------------------------------------
create or replace function public.advance_boss_decide(
  p_request_id uuid,
  p_decision text,
  p_approved_amount numeric default null,
  p_modification_reason text default null,
  p_remark text default null
)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_req public.advance_requests;
  v_cfg record;
  v_boss_primary uuid;
  v_me record;
  v_final numeric;
  v_limit numeric;
  v_modified boolean := false;
  v_updated int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;
  if p_decision not in ('approved', 'rejected', 'sent_back') then
    raise exception 'Invalid decision.';
  end if;

  select * into v_req from public.advance_requests where id = p_request_id;
  if not found then raise exception 'Advance request not found.'; end if;
  if v_req.status <> 'boss_pending' then
    raise exception 'This request is not pending final approval (current status: %).', v_req.status;
  end if;
  if v_req.employee_id = v_caller then
    raise exception 'You cannot act on your own advance request.' using errcode = '42501';
  end if;

  -- Boss authority: caller must be an active configured Boss for the company,
  -- AND be the resolved primary approver OR that approver's backup.
  select * into v_me from public.advance_final_approvers
  where company_id = v_req.company_id and employee_id = v_caller and is_active;
  if v_me.id is null then
    raise exception 'You are not a configured Final Approver (Boss).' using errcode = '42501';
  end if;
  v_boss_primary := public.advance_resolve_final_approver(v_req.company_id);
  if v_caller <> v_boss_primary and not exists (
    select 1 from public.advance_final_approvers fa
    where fa.company_id = v_req.company_id and fa.employee_id = v_boss_primary and fa.backup_approver_employee_id = v_caller
  ) then
    raise exception 'This advance request is not assigned to you for final approval.' using errcode = '42501';
  end if;

  if p_decision in ('rejected', 'sent_back') and (p_remark is null or length(trim(p_remark)) = 0) then
    raise exception 'A remark is required to reject or send back a request.';
  end if;

  select * into v_cfg from public.advance_policy_configs where policy_id = v_req.policy_id;

  if p_decision = 'approved' then
    v_final := coalesce(p_approved_amount, v_req.requested_amount);
    if v_final <= 0 then raise exception 'Approved amount must be greater than zero.'; end if;

    if v_final <> v_req.requested_amount then
      v_modified := true;
      if not coalesce(v_cfg.boss_can_modify_amount, false) or not coalesce(v_me.can_modify_amount, false) then
        raise exception 'You are not permitted to modify the amount for this policy.';
      end if;
      if v_final > v_req.requested_amount then
        if not coalesce(v_cfg.boss_can_increase_amount, false) or not coalesce(v_me.can_increase_amount, false) then
          raise exception 'You cannot approve an amount above the requested amount (%).', v_req.requested_amount;
        end if;
      end if;
      if coalesce(v_cfg.modification_reason_mandatory, true) and (p_modification_reason is null or length(trim(p_modification_reason)) = 0) then
        raise exception 'A modification reason is required when changing the approved amount.';
      end if;
    end if;

    -- Configured Boss approval limit (policy limit and/or this Boss's own limit) applies
    -- to the FINAL amount regardless of whether it was increased.
    v_limit := least(v_cfg.max_boss_approval_limit, v_me.max_approval_limit);
    if v_limit is not null and v_final > v_limit then
      raise exception 'Approved amount % exceeds the configured Boss approval limit (%).', v_final, v_limit;
    end if;

    update public.advance_requests
    set status = 'approved',
        boss_approved_amount = v_final,
        boss_modification_reason = case when v_modified then p_modification_reason else boss_modification_reason end,
        decided_by = auth.uid(), decided_at = now(),
        decision_remark = coalesce(p_remark, decision_remark), updated_by = auth.uid()
    where id = p_request_id and status = 'boss_pending'
    returning * into v_req;
  else
    update public.advance_requests
    set status = case when p_decision = 'rejected' then 'rejected' else 'sent_back' end,
        decided_by = case when p_decision = 'rejected' then auth.uid() else decided_by end,
        decided_at = case when p_decision = 'rejected' then now() else decided_at end,
        decision_remark = coalesce(p_remark, decision_remark), updated_by = auth.uid()
    where id = p_request_id and status = 'boss_pending'
    returning * into v_req;
  end if;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Request has already been processed.';
  end if;

  if v_modified then
    insert into public.advance_approval_actions (company_id, advance_request_id, step_order, actor_role, actor_employee_id, action, old_amount, new_amount, remark, acted_at)
    values (v_req.company_id, v_req.id, 2, 'boss', v_caller, 'amount_modified', v_req.requested_amount, v_final, p_modification_reason, now());
  end if;
  insert into public.advance_approval_actions (company_id, advance_request_id, step_order, actor_role, actor_employee_id, action, old_amount, new_amount, remark, acted_at)
  values (v_req.company_id, v_req.id, 2, 'boss', v_caller, p_decision, v_req.requested_amount,
          case when p_decision = 'approved' then v_req.boss_approved_amount else null end, p_remark, now());

  if p_decision = 'approved' then
    perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_boss_approved', 'Advance approved',
      format('Your advance request has been approved for %s.', v_req.boss_approved_amount), v_req.id);
    if v_modified then
      perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_amount_modified', 'Advance amount modified',
        format('The approved amount was set to %s (requested %s).', v_req.boss_approved_amount, v_req.requested_amount), v_req.id);
    end if;
  elsif p_decision = 'rejected' then
    perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_boss_rejected', 'Advance rejected',
      'Your advance request was rejected at final approval.', v_req.id);
  else
    perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_sent_back', 'Advance sent back',
      'Your advance request was sent back at final approval.', v_req.id);
  end if;

  return v_req;
end;
$$;
grant execute on function public.advance_boss_decide(uuid, text, numeric, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_cancel(): the employee (or Super Admin) withdraws a request that is
-- still pending / sent back. Nothing has been paid, so no ledger effect.
-- ----------------------------------------------------------------------------
create or replace function public.advance_cancel(p_request_id uuid, p_remark text default null)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_req public.advance_requests;
begin
  select * into v_req from public.advance_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;
  if not public.is_super_admin() and v_req.employee_id <> v_caller then
    raise exception 'You may only cancel your own advance request.' using errcode = '42501';
  end if;
  if v_req.status not in ('manager_pending', 'boss_pending', 'sent_back') then
    raise exception 'Only a pending or sent-back advance request can be cancelled.';
  end if;

  update public.advance_requests
  set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_remark = p_remark, updated_by = auth.uid()
  where id = p_request_id
  returning * into v_req;

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_cancelled', 'Advance request cancelled',
    'Your advance request was cancelled.', v_req.id);
  return v_req;
end;
$$;
grant execute on function public.advance_cancel(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Display / list RPCs (SECURITY DEFINER, each self/role-scoped).
-- ----------------------------------------------------------------------------

-- Staff: my own requests + type/policy names.
create or replace function public.advance_list_my_requests()
returns table (
  id uuid, company_id uuid, employee_id uuid, advance_type_id uuid, advance_type_name text,
  policy_id uuid, policy_name text, policy_version int,
  requested_amount numeric, manager_recommended_amount numeric, boss_approved_amount numeric,
  boss_modification_reason text, reason text, remarks text, status text, current_step int,
  requested_at timestamptz, decided_at timestamptz, decision_remark text
)
language sql
stable
security definer
as $$
  select a.id, a.company_id, a.employee_id, a.advance_type_id, t.name,
         a.policy_id, p.name, a.policy_version,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         a.boss_modification_reason, a.reason, a.remarks, a.status, a.current_step,
         a.requested_at, a.decided_at, a.decision_remark
  from public.advance_requests a
  join public.advance_types t on t.id = a.advance_type_id
  join public.advance_policies p on p.id = a.policy_id
  where a.employee_id = public.current_user_employee_id()
  order by a.requested_at desc;
$$;
grant execute on function public.advance_list_my_requests() to authenticated;

-- Reporting Manager: requests pending my decision (Step 1).
create or replace function public.advance_list_manager_pending()
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text,
  advance_type_name text, requested_amount numeric, reason text, requested_at timestamptz, status text
)
language sql
stable
security definer
as $$
  select a.id, a.employee_id, e.full_name, e.employee_code,
         t.name, a.requested_amount, a.reason, a.requested_at, a.status
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  where a.status = 'manager_pending'
    and public.advance_resolve_direct_manager(a.employee_id) = public.current_user_employee_id()
  order by a.requested_at asc;
$$;
grant execute on function public.advance_list_manager_pending() to authenticated;

-- Boss: requests pending my final decision (Step 2).
create or replace function public.advance_list_boss_pending()
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text,
  advance_type_name text, requested_amount numeric, manager_recommended_amount numeric,
  reason text, requested_at timestamptz, status text
)
language sql
stable
security definer
as $$
  select a.id, a.employee_id, e.full_name, e.employee_code,
         t.name, a.requested_amount, a.manager_recommended_amount, a.reason, a.requested_at, a.status
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  where a.status = 'boss_pending'
    and exists (
      select 1 from public.advance_final_approvers fa
      where fa.company_id = a.company_id and fa.is_active and fa.employee_id = public.current_user_employee_id()
    )
    and (
      public.advance_resolve_final_approver(a.company_id) = public.current_user_employee_id()
      or exists (
        select 1 from public.advance_final_approvers fa2
        where fa2.company_id = a.company_id
          and fa2.employee_id = public.advance_resolve_final_approver(a.company_id)
          and fa2.backup_approver_employee_id = public.current_user_employee_id()
      )
    )
  order by a.requested_at asc;
$$;
grant execute on function public.advance_list_boss_pending() to authenticated;

-- Approver: every request I have acted on, with my latest action (for the
-- "Approved / Rejected / Sent Back" history tabs on the approval pages).
create or replace function public.advance_list_my_decisions()
returns table (
  id uuid, advance_request_id uuid, employee_name text, employee_code text, advance_type_name text,
  requested_amount numeric, manager_recommended_amount numeric, boss_approved_amount numeric,
  status text, my_role text, my_action text, my_old_amount numeric, my_new_amount numeric,
  my_remark text, acted_at timestamptz, requested_at timestamptz
)
language sql
stable
security definer
as $$
  select distinct on (la.advance_request_id)
    la.id, a.id, e.full_name, e.employee_code, t.name,
    a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
    a.status, la.actor_role, la.action, la.old_amount, la.new_amount, la.remark, la.acted_at, a.requested_at
  from public.advance_approval_actions la
  join public.advance_requests a on a.id = la.advance_request_id
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  where la.actor_employee_id = public.current_user_employee_id()
    and la.action in ('approved', 'rejected', 'sent_back')
  order by la.advance_request_id, la.acted_at desc;
$$;
grant execute on function public.advance_list_my_decisions() to authenticated;

-- Full immutable action history for one request (+ actor names). Visibility
-- mirrors advance_requests' own RLS.
create or replace function public.advance_list_approval_history(p_request_id uuid)
returns table (
  step_order int, actor_role text, actor_employee_id uuid, actor_name text,
  action text, old_amount numeric, new_amount numeric, remark text, acted_at timestamptz
)
language sql
stable
security definer
as $$
  select la.step_order, la.actor_role, la.actor_employee_id, e.full_name,
         la.action, la.old_amount, la.new_amount, la.remark, la.acted_at
  from public.advance_approval_actions la
  join public.employees e on e.id = la.actor_employee_id
  where la.advance_request_id = p_request_id
    and exists (
      select 1 from public.advance_requests a
      where a.id = p_request_id
        and (
          is_super_admin()
          or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or (current_user_role() = 'staff' and a.employee_id = current_user_employee_id())
          or (current_user_role() = 'staff' and public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id())
          or (current_user_role() = 'staff' and exists (
            select 1 from public.advance_final_approvers fa where fa.employee_id = current_user_employee_id() and fa.is_active and fa.company_id = a.company_id
          ))
        )
    )
  order by la.acted_at asc;
$$;
grant execute on function public.advance_list_approval_history(uuid) to authenticated;
