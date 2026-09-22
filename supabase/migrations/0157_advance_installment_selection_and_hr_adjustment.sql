-- ============================================================================
-- Retail HRMS — Advance Installment Selection + Boss Final Plan + HR
-- Pre-Payroll-Lock Recovery Adjustment
-- Migration 0157
--
-- Reuses the EXISTING Advance Recovery engine end-to-end (migration 0136):
-- advance_recovery_plans / advance_recovery_installments /
-- advance_recovery_transactions, advance_recovery_generate_plan()'s exact
-- floor-to-paise + remainder-to-last algorithm, advance_recovery_
-- recompute_plan() (untouched — total_recovered/outstanding still derive
-- only from transactions/settlements, never from the schedule breakdown),
-- advance_recovery_run_period()'s FIFO + idempotency (untouched), and the
-- existing advance_payroll_periods draft/finalized/reversed lock states as
-- the authoritative "payroll lock" signal. NOTHING in that engine is
-- replaced. No new recovery-calculation engine is created.
--
-- WHAT'S NEW (additive only):
--   1. advance_requests gains 3 nullable installment-count columns
--      (requested / manager-recommended / boss-final) — the exact same
--      "requested / recommended / approved" separation already used for
--      amounts, extended to installment count.
--   2. advance_apply() requires and validates the employee's chosen
--      installment count against the resolved policy (max_installments,
--      min_installment_amount — both existing columns, the latter dormant
--      until now, exactly like advance_types.allows_multiple was before
--      migration 0155).
--   3. advance_manager_decide() accepts an optional recommended installment
--      count — informational only, exactly like the existing recommended
--      amount; never authoritative.
--   4. advance_boss_decide() accepts an optional final installment count,
--      validated against the same policy ceiling, stored as
--      boss_final_installment_count. This is the ONLY installment value
--      the recovery engine consults going forward.
--   5. advance_recovery_generate_plan()'s existing fallback chain
--      (`coalesce(p_installment_count, v_cfg.recovery_installment_count,
--      v_cfg.max_installments, 12)`) gets ONE new link inserted between the
--      explicit override and the policy default: the advance's own
--      boss_final_installment_count. An authorised user may still pass an
--      explicit p_installment_count to override even that, exactly as the
--      original comment already documented.
--   6. A new, narrowly-scoped HR authority — NOT an approval level — to
--      adjust a still-unprocessed future installment's scheduled amount and
--      redistribute the remainder, gated by the EXISTING advance_hr_
--      processors roster (not advance_finance_processors, which is a
--      deliberately different authority already used for advance_recovery_
--      can_manage()), and hard-blocked once the target month's
--      advance_payroll_periods row is 'finalized'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. advance_requests — installment-count columns, mirroring the existing
--    requested/manager-recommended/boss-approved AMOUNT columns exactly.
-- ----------------------------------------------------------------------------
alter table public.advance_requests
  add column if not exists requested_installment_count int,
  add column if not exists manager_recommended_installment_count int,
  add column if not exists boss_final_installment_count int;

alter table public.advance_requests drop constraint if exists advance_requests_requested_installment_count_check;
alter table public.advance_requests add constraint advance_requests_requested_installment_count_check
  check (requested_installment_count is null or requested_installment_count >= 1);
alter table public.advance_requests drop constraint if exists advance_requests_manager_recommended_installment_count_check;
alter table public.advance_requests add constraint advance_requests_manager_recommended_installment_count_check
  check (manager_recommended_installment_count is null or manager_recommended_installment_count >= 1);
alter table public.advance_requests drop constraint if exists advance_requests_boss_final_installment_count_check;
alter table public.advance_requests add constraint advance_requests_boss_final_installment_count_check
  check (boss_final_installment_count is null or boss_final_installment_count >= 1);

comment on column public.advance_requests.requested_installment_count is
  'Employee''s chosen recovery installment count at apply time (migration 0157). Immutable once set — never overwritten by manager/boss actions.';
comment on column public.advance_requests.manager_recommended_installment_count is
  'Reporting Manager''s recommended installment count — informational only, exactly like manager_recommended_amount. NEVER consulted by the recovery engine.';
comment on column public.advance_requests.boss_final_installment_count is
  'The Boss''s FINAL installment count decision. The only installment value advance_recovery_generate_plan() consults as a policy-level default (an explicit p_installment_count argument still wins).';

-- ----------------------------------------------------------------------------
-- 2. advance_approval_actions — one new action value so installment-count
--    changes get the exact same immutable audit trail as amount changes,
--    reusing the existing table instead of a parallel one.
-- ----------------------------------------------------------------------------
alter table public.advance_approval_actions drop constraint if exists advance_approval_actions_action_check;
alter table public.advance_approval_actions add constraint advance_approval_actions_action_check
  check (action in ('approved', 'rejected', 'sent_back', 'amount_modified', 'installment_modified', 'commented'));

-- ----------------------------------------------------------------------------
-- 3. advance_recovery_installment_adjustments — HR's pre-payroll-lock
--    recovery-schedule adjustments. Insert-only (immutable ledger, same
--    convention as advance_recovery_transactions/settlements — corrections
--    are new rows, never edits). Distinct from (and never overwrites):
--      A. Boss Approved Recovery Terms   = advance_requests.boss_final_installment_count
--      B. Generated Recovery Plan        = advance_recovery_plans/installments (unchanged engine)
--      C. Period-specific HR adjustments = THIS table
-- ----------------------------------------------------------------------------
create table if not exists public.advance_recovery_installment_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  recovery_plan_id uuid not null references public.advance_recovery_plans (id) on delete cascade,
  batch_id uuid not null,                 -- groups every row one HR action produced
  adjustment_scope text not null check (adjustment_scope in ('target_period', 'future_redistribution')),
  installment_number int,                 -- the target period's number; null for the future-redistribution summary row
  due_month date,
  old_scheduled_amount numeric not null check (old_scheduled_amount >= 0),
  new_scheduled_amount numeric not null check (new_scheduled_amount >= 0),
  adjustment_type text not null check (adjustment_type in ('increase', 'decrease', 'redistribute', 'no_change')),
  reason text not null,
  processed_by uuid not null,             -- auth.uid() of the HR Processor who executed it
  payroll_lock_status_at_time text,       -- advance_payroll_periods.status for that month at adjustment time, or 'not_created'
  created_at timestamptz not null default now()
);
create index if not exists idx_advance_recovery_installment_adjustments_request
  on public.advance_recovery_installment_adjustments (advance_request_id, created_at);
create index if not exists idx_advance_recovery_installment_adjustments_batch
  on public.advance_recovery_installment_adjustments (batch_id);

alter table public.advance_recovery_installment_adjustments enable row level security;

-- Same visibility shape as advance_recovery_transactions/settlements (migration 0136): owner •
-- Reporting Manager • Boss • HR • Finance • non-staff same company • Super Admin. Insert-only via
-- the RPC below (which, as SECURITY DEFINER owned by the migration role, writes regardless of this
-- restrictive check — same established pattern as advance_recovery_transactions_write).
create policy "advance_recovery_installment_adjustments_select" on public.advance_recovery_installment_adjustments for select
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
          or (public.advance_am_i_finance(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  );
create policy "advance_recovery_installment_adjustments_write" on public.advance_recovery_installment_adjustments for insert with check (is_super_admin());
-- no update/delete policy -> immutable for everyone, matching advance_recovery_transactions/settlements.

-- ----------------------------------------------------------------------------
-- 4. advance_get_apply_context() — RETURNS TABLE column list is changing, so
--    CREATE OR REPLACE cannot be used (Postgres forbids changing a
--    function's return type in place); drop and recreate, then re-grant.
-- ----------------------------------------------------------------------------
drop function if exists public.advance_get_apply_context();
create function public.advance_get_apply_context()
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
  max_installments int,
  default_installment_count int,
  min_installment_amount numeric,
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
  select p.id, p.name, p.version_number into v_pol from public.advance_policies p where p.id = v_policy_id;
  select c.* into v_cfg from public.advance_policy_configs c where c.policy_id = v_policy_id;

  v_salary := public.advance_resolve_salary_gross(v_emp.id, current_date);
  v_pct_limit := case
    when v_salary is not null and v_cfg.max_pct_of_salary is not null
    then round(v_cfg.max_pct_of_salary / 100.0 * v_salary, 2) else null end;
  v_allowed := least(v_cfg.max_amount, v_pct_limit);

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
  -- NEW (migration 0157): installment choices are the resolved policy's authority, never hard-coded.
  max_installments := coalesce(v_cfg.max_installments, 12);
  default_installment_count := least(coalesce(v_cfg.recovery_installment_count, v_cfg.max_installments, 1), coalesce(v_cfg.max_installments, 12));
  min_installment_amount := v_cfg.min_installment_amount;
  eligible := v_reason is null;
  ineligible_reason := v_reason;
  return next;
end;
$$;
grant execute on function public.advance_get_apply_context() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. advance_apply() — every existing check is UNCHANGED; the new
--    installment-count parameter/validation is appended, and the new column
--    is populated on insert. New parameter is appended LAST so this remains
--    the exact same function signature Postgres will actually REPLACE
--    (PostgREST/supabase-js call RPCs by named argument, so this is not a
--    breaking change for any caller that omits it — though per §2 apply()
--    itself now requires a value).
-- ----------------------------------------------------------------------------
create or replace function public.advance_apply(
  p_advance_type_id uuid,
  p_requested_amount numeric,
  p_reason text,
  p_remarks text default null,
  p_document_storage_path text default null,
  p_document_file_name text default null,
  p_document_mime_type text default null,
  p_document_file_size_bytes bigint default null,
  p_installment_count int default null
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
  v_active_same_type int;
  v_outstanding_total numeric;
  v_max_installments int;
  v_per_installment numeric;
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

  select id, is_active, requires_document, allows_multiple into v_type from public.advance_types
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

  if exists (select 1 from public.advance_policy_types t where t.policy_id = v_policy_id)
     and not exists (select 1 from public.advance_policy_types t where t.policy_id = v_policy_id and t.advance_type_id = p_advance_type_id)
  then
    raise exception 'This Advance Type is not permitted under your assigned Advance Policy.';
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

  if not coalesce(v_type.allows_multiple, false) then
    select count(*) into v_active_same_type from public.advance_requests
    where employee_id = v_emp.id and advance_type_id = p_advance_type_id
      and status in ('manager_pending', 'boss_pending', 'approved');
    if v_active_same_type >= 1 then
      raise exception 'You already have an active request of this Advance Type. This Advance Type does not allow multiple simultaneous requests.';
    end if;
  end if;

  if coalesce(v_cfg.existing_outstanding_rule, 'allowed_unrestricted') <> 'allowed_unrestricted' then
    select coalesce(sum(rp.outstanding_amount), 0) into v_outstanding_total
    from public.advance_recovery_plans rp
    where rp.employee_id = v_emp.id and rp.status in ('recovery_pending', 'recovering');

    if v_cfg.existing_outstanding_rule = 'not_allowed' and v_outstanding_total > 0 then
      raise exception 'You have an outstanding advance of %. A new advance cannot be requested until it is fully recovered or settled.', v_outstanding_total;
    end if;
    if v_cfg.existing_outstanding_rule = 'allowed_within_limit'
       and v_cfg.max_total_outstanding_limit is not null
       and v_outstanding_total >= v_cfg.max_total_outstanding_limit
    then
      raise exception 'Your existing outstanding advance (%) has reached the configured limit (%). A new advance cannot be requested.', v_outstanding_total, v_cfg.max_total_outstanding_limit;
    end if;
  end if;

  if v_cfg.min_amount is not null and p_requested_amount < v_cfg.min_amount then
    raise exception 'Requested amount is below the minimum allowed (%).', v_cfg.min_amount;
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

  -- NEW (migration 0157): mandatory, policy-bounded installment count. Never trust the client
  -- beyond this point — every bound comes from advance_policy_configs, resolved server-side above.
  if p_installment_count is null then
    raise exception 'Recovery / No. of Installments is required.';
  end if;
  if p_installment_count < 1 then
    raise exception 'Recovery installment count must be at least 1.';
  end if;
  v_max_installments := coalesce(v_cfg.max_installments, 12);
  if p_installment_count > v_max_installments then
    raise exception 'Recovery installment count cannot exceed % under this policy.', v_max_installments;
  end if;
  if v_cfg.min_installment_amount is not null then
    v_per_installment := trunc(p_requested_amount / p_installment_count * 100) / 100;
    if v_per_installment < v_cfg.min_installment_amount then
      raise exception 'With % installments, each deduction (~%) would fall below the policy minimum installment amount (%). Choose fewer installments.', p_installment_count, v_per_installment, v_cfg.min_installment_amount;
    end if;
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
    boss_approved_amount, decided_by, decided_at, created_by, updated_by,
    requested_installment_count, boss_final_installment_count
  ) values (
    v_emp.company_id, v_emp.id, p_advance_type_id, v_policy_id, v_policy.version_number,
    p_requested_amount, p_reason, p_remarks, v_status, v_step,
    case when v_status = 'approved' then p_requested_amount else null end,
    case when v_status = 'approved' then auth.uid() else null end,
    case when v_status = 'approved' then now() else null end,
    auth.uid(), auth.uid(),
    p_installment_count,
    -- Auto-approval path (no Manager/Boss step configured at all) has no human decision point to
    -- finalize installments, so the employee's own choice stands as final immediately.
    case when v_status = 'approved' then p_installment_count else null end
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
grant execute on function public.advance_apply(uuid, numeric, text, text, text, text, text, bigint, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. advance_manager_decide() — adds an OPTIONAL, purely informational
--    recommended installment count. Every existing check/behavior is
--    unchanged; the manager's recommendation is never authoritative and the
--    recovery engine never reads it.
-- ----------------------------------------------------------------------------
create or replace function public.advance_manager_decide(
  p_request_id uuid,
  p_decision text,
  p_recommended_amount numeric default null,
  p_remark text default null,
  p_recommended_installment_count int default null
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
  if p_recommended_installment_count is not null and p_recommended_installment_count < 1 then
    raise exception 'Recommended installment count must be at least 1.';
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
      manager_recommended_installment_count = coalesce(p_recommended_installment_count, manager_recommended_installment_count),
      boss_approved_amount = case when v_new_status = 'approved' then v_req.requested_amount else boss_approved_amount end,
      boss_final_installment_count = case when v_new_status = 'approved'
        then coalesce(p_recommended_installment_count, v_req.requested_installment_count) else boss_final_installment_count end,
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
  if p_recommended_installment_count is not null and p_recommended_installment_count <> v_req.requested_installment_count then
    insert into public.advance_approval_actions (company_id, advance_request_id, step_order, actor_role, actor_employee_id, action, old_amount, new_amount, remark, acted_at)
    values (v_req.company_id, v_req.id, 1, 'reporting_manager', v_caller, 'installment_modified', v_req.requested_installment_count, p_recommended_installment_count, 'Manager recommended installment count', now());
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
grant execute on function public.advance_manager_decide(uuid, text, numeric, text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. advance_boss_decide() — adds an OPTIONAL final installment count,
--    validated against the SAME policy ceiling advance_apply() uses, and
--    reuses the EXISTING modification_reason_mandatory flag (no new "does
--    installment change need a reason" knob — one existing flag governs
--    both amount and installment changes). This becomes the value the
--    recovery engine treats as the approved plan (§5, applied in step 8).
-- ----------------------------------------------------------------------------
create or replace function public.advance_boss_decide(
  p_request_id uuid,
  p_decision text,
  p_approved_amount numeric default null,
  p_modification_reason text default null,
  p_remark text default null,
  p_final_installment_count int default null
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
  v_final_installments int;
  v_limit numeric;
  v_modified boolean := false;
  v_installments_modified boolean := false;
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
    end if;

    -- NEW (migration 0157): final installment count, policy-bounded exactly like apply()'s check.
    v_final_installments := coalesce(p_final_installment_count, v_req.requested_installment_count);
    if v_final_installments is null or v_final_installments < 1 then
      raise exception 'A final installment count is required.';
    end if;
    if v_final_installments > coalesce(v_cfg.max_installments, 12) then
      raise exception 'Final installment count cannot exceed % under this policy.', coalesce(v_cfg.max_installments, 12);
    end if;
    if v_cfg.min_installment_amount is not null
       and trunc(v_final / v_final_installments * 100) / 100 < v_cfg.min_installment_amount
    then
      raise exception 'With % installments, each deduction would fall below the policy minimum installment amount (%).', v_final_installments, v_cfg.min_installment_amount;
    end if;
    if v_final_installments is distinct from v_req.requested_installment_count then
      v_installments_modified := true;
    end if;

    if (v_modified or v_installments_modified) and coalesce(v_cfg.modification_reason_mandatory, true)
       and (p_modification_reason is null or length(trim(p_modification_reason)) = 0)
    then
      raise exception 'A modification reason is required when changing the approved amount or installment count.';
    end if;

    v_limit := least(v_cfg.max_boss_approval_limit, v_me.max_approval_limit);
    if v_limit is not null and v_final > v_limit then
      raise exception 'Approved amount % exceeds the configured Boss approval limit (%).', v_final, v_limit;
    end if;

    update public.advance_requests
    set status = 'approved',
        boss_approved_amount = v_final,
        boss_final_installment_count = v_final_installments,
        boss_modification_reason = case when v_modified or v_installments_modified then p_modification_reason else boss_modification_reason end,
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
  if v_installments_modified then
    insert into public.advance_approval_actions (company_id, advance_request_id, step_order, actor_role, actor_employee_id, action, old_amount, new_amount, remark, acted_at)
    values (v_req.company_id, v_req.id, 2, 'boss', v_caller, 'installment_modified', v_req.requested_installment_count, v_final_installments, p_modification_reason, now());
  end if;
  insert into public.advance_approval_actions (company_id, advance_request_id, step_order, actor_role, actor_employee_id, action, old_amount, new_amount, remark, acted_at)
  values (v_req.company_id, v_req.id, 2, 'boss', v_caller, p_decision, v_req.requested_amount,
          case when p_decision = 'approved' then v_req.boss_approved_amount else null end, p_remark, now());

  if p_decision = 'approved' then
    perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_boss_approved', 'Advance approved',
      format('Your advance request has been approved for %s.', v_req.boss_approved_amount), v_req.id);
    if v_modified or v_installments_modified then
      perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_amount_modified', 'Advance terms modified',
        format('Final terms: amount %s, installments %s (requested %s / %s).', v_req.boss_approved_amount, v_req.boss_final_installment_count, v_req.requested_amount, v_req.requested_installment_count), v_req.id);
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
grant execute on function public.advance_boss_decide(uuid, text, numeric, text, text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. advance_recovery_generate_plan() — ONE new link in the existing
--    fixed_installments fallback chain. Signature UNCHANGED. Everything else
--    (actual-paid basis, floor-to-paise + remainder-to-last, custom/full/
--    fixed_monthly branches, the final sum==paid assertion) is untouched.
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_generate_plan(
  p_advance_request_id uuid,
  p_start_date date default null,
  p_installment_count int default null,
  p_monthly_amount numeric default null,
  p_custom_schedule jsonb default null
)
returns public.advance_recovery_plans
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_req public.advance_requests;
  v_pay public.advance_finance_payments;
  v_cfg record;
  v_paid numeric;
  v_method text;
  v_count int;
  v_monthly numeric;
  v_start date;
  v_plan public.advance_recovery_plans;
  v_status text;
  v_today_month date := date_trunc('month', current_date)::date;
  v_q numeric;
  v_sum numeric := 0;
  v_k int;
  v_amt numeric;
  v_item jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if v_caller is null then raise exception 'No employee record is linked to the current user.'; end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;
  if not public.advance_recovery_can_manage(v_req.company_id) then
    raise exception 'You are not authorised to manage recovery for this company.' using errcode = '42501';
  end if;
  if v_req.status <> 'paid' then
    raise exception 'A recovery plan can only be generated for a PAID advance (current status: %).', v_req.status;
  end if;
  if exists (select 1 from public.advance_recovery_plans where advance_request_id = p_advance_request_id) then
    raise exception 'A recovery plan already exists for this advance.';
  end if;

  select * into v_pay from public.advance_finance_payments where advance_request_id = p_advance_request_id;
  if v_pay.id is null or v_pay.status <> 'paid' or v_pay.payment_amount is null or v_pay.payment_amount <= 0 then
    raise exception 'This advance has no completed Finance payment.';
  end if;
  v_paid := v_pay.payment_amount;   -- THE RECOVERY BASIS (§4/§20) — unchanged.

  select * into v_cfg from public.advance_policy_configs where policy_id = v_req.policy_id;
  if v_cfg.id is null then raise exception 'The advance''s policy has no configuration.'; end if;
  if not coalesce(v_cfg.recovery_enabled, true) then
    raise exception 'Recovery is disabled for this advance''s policy.';
  end if;

  v_method := coalesce(v_cfg.recovery_method, 'fixed_installments');

  if p_start_date is not null then
    v_start := date_trunc('month', p_start_date)::date;
  elsif v_cfg.recovery_start_rule = 'same_payroll' then
    v_start := date_trunc('month', v_pay.payment_date)::date;
  elsif v_cfg.recovery_start_rule = 'next_payroll' then
    v_start := (date_trunc('month', v_pay.payment_date) + interval '1 month')::date;
  elsif v_cfg.recovery_start_rule in ('specific_date', 'specific_month') then
    if v_cfg.recovery_start_specific is null then
      raise exception 'Policy recovery start rule is "%" but no specific date is configured.', v_cfg.recovery_start_rule;
    end if;
    v_start := date_trunc('month', v_cfg.recovery_start_specific)::date;
  else
    raise exception 'Policy recovery start rule is "manual" — pass an explicit start date.';
  end if;

  insert into public.advance_recovery_plans (
    company_id, advance_request_id, employee_id, actual_paid_amount, payment_date,
    policy_id, policy_version, recovery_method, installment_count, monthly_amount,
    recovery_start_date, total_scheduled, outstanding_amount, status, created_by, updated_by
  ) values (
    v_req.company_id, v_req.id, v_req.employee_id, v_paid, v_pay.payment_date,
    v_req.policy_id, v_req.policy_version, v_method, null, null,
    v_start, v_paid, v_paid,
    case when v_start > v_today_month then 'recovery_pending' else 'recovering' end,
    auth.uid(), auth.uid()
  ) returning * into v_plan;

  if v_method = 'full' then
    insert into public.advance_recovery_installments (company_id, advance_request_id, recovery_plan_id, employee_id, installment_number, due_month, scheduled_amount)
    values (v_req.company_id, v_req.id, v_plan.id, v_req.employee_id, 1, v_start, v_paid);
    v_count := 1;

  elsif v_method = 'custom' then
    if p_custom_schedule is null or jsonb_typeof(p_custom_schedule) <> 'array' or jsonb_array_length(p_custom_schedule) = 0 then
      raise exception 'A custom schedule array is required for recovery_method = custom.';
    end if;
    v_k := 0;
    for v_item in select * from jsonb_array_elements(p_custom_schedule) loop
      v_k := v_k + 1;
      v_amt := (v_item->>'scheduled_amount')::numeric;
      if v_amt is null or v_amt <= 0 then raise exception 'Custom schedule item % has a non-positive amount.', v_k; end if;
      v_sum := v_sum + v_amt;
      insert into public.advance_recovery_installments (company_id, advance_request_id, recovery_plan_id, employee_id, installment_number, due_month, scheduled_amount)
      values (v_req.company_id, v_req.id, v_plan.id, v_req.employee_id,
              coalesce((v_item->>'installment_number')::int, v_k),
              date_trunc('month', coalesce((v_item->>'due_month')::date, v_start + ((v_k - 1) || ' month')::interval))::date,
              v_amt);
    end loop;
    if v_sum <> v_paid then
      raise exception 'Custom schedule total (%) must equal the actual paid amount (%).', v_sum, v_paid;
    end if;
    v_count := v_k;

  elsif v_method = 'fixed_monthly' then
    v_monthly := coalesce(p_monthly_amount, v_cfg.recovery_monthly_amount);
    if v_monthly is null or v_monthly <= 0 then raise exception 'A monthly deduction amount is required for recovery_method = fixed_monthly.'; end if;
    v_count := ceil(v_paid / v_monthly)::int;
    v_sum := 0;
    for v_k in 1 .. v_count loop
      v_amt := case when v_k < v_count then v_monthly else v_paid - v_sum end;
      v_sum := v_sum + v_amt;
      insert into public.advance_recovery_installments (company_id, advance_request_id, recovery_plan_id, employee_id, installment_number, due_month, scheduled_amount)
      values (v_req.company_id, v_req.id, v_plan.id, v_req.employee_id, v_k,
              (v_start + ((v_k - 1) || ' month')::interval)::date, v_amt);
    end loop;
    update public.advance_recovery_plans set monthly_amount = v_monthly where id = v_plan.id;

  else -- fixed_installments
    -- NEW (migration 0157): the Boss's FINAL installment decision is the policy-level default,
    -- ranked right after an explicit override — everything else in this branch is unchanged.
    v_count := coalesce(p_installment_count, v_req.boss_final_installment_count, v_cfg.recovery_installment_count, v_cfg.max_installments, 12);
    if v_count < 1 then raise exception 'Installment count must be at least 1.'; end if;
    v_q := trunc(v_paid / v_count * 100) / 100;
    if v_q <= 0 then raise exception 'Actual paid amount is too small for % installments.', v_count; end if;
    v_sum := 0;
    for v_k in 1 .. v_count loop
      v_amt := case when v_k < v_count then v_q else v_paid - v_sum end;
      v_sum := v_sum + v_amt;
      insert into public.advance_recovery_installments (company_id, advance_request_id, recovery_plan_id, employee_id, installment_number, due_month, scheduled_amount)
      values (v_req.company_id, v_req.id, v_plan.id, v_req.employee_id, v_k,
              (v_start + ((v_k - 1) || ' month')::interval)::date, v_amt);
    end loop;
    update public.advance_recovery_plans set installment_count = v_count where id = v_plan.id;
  end if;

  select coalesce(sum(scheduled_amount), 0) into v_sum from public.advance_recovery_installments where recovery_plan_id = v_plan.id;
  if v_sum <> v_paid then
    raise exception 'Generated schedule total (%) does not equal the actual paid amount (%).', v_sum, v_paid;
  end if;

  v_plan := public.advance_recovery_recompute_plan(v_plan.id);

  if v_plan.status = 'recovering' then
    perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_recovery_started', 'Advance recovery scheduled',
      format('A recovery schedule of %s has been set up for your advance, starting %s.', v_paid, to_char(v_start, 'Mon YYYY')), v_req.id);
  end if;

  return v_plan;
end;
$$;
grant execute on function public.advance_recovery_generate_plan(uuid, date, int, numeric, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. advance_recovery_adjust_installment() — the new HR authority (§6-§14).
--    NOT an approval level. Reuses advance_hr_processors (the SAME roster
--    HR Processing already uses — advance_am_i_hr()'s backing table), NOT
--    advance_finance_processors (advance_recovery_can_manage()'s authority),
--    per §9/§23's explicit separation. Touches ONLY still-'scheduled'
--    installments; hard-blocked once the target month's advance_payroll_
--    periods row is 'finalized' (§10/§11) — the existing lock signal, not a
--    new one. Uses the SAME floor-to-paise + remainder-to-last algorithm as
--    advance_recovery_generate_plan() so the total is always exact (§5/§20).
--    Never touches advance_recovery_plans.total_recovered/outstanding_amount
--    (those derive only from advance_recovery_transactions/settlements via
--    advance_recovery_recompute_plan() — completely unaffected by this).
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_adjust_installment(
  p_advance_request_id uuid,
  p_installment_number int,
  p_new_amount numeric,
  p_reason text,
  p_new_future_installment_count int default null
)
returns table (installment_number int, due_month date, scheduled_amount numeric, status text)
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_hr record;
  v_req public.advance_requests;
  v_plan public.advance_recovery_plans;
  v_target public.advance_recovery_installments;
  v_period record;
  v_lock_status text;
  v_future_sum numeric;
  v_total_redistributable numeric;
  v_remaining_for_future numeric;
  v_future_count int;
  v_existing_future_count int;
  v_batch uuid := gen_random_uuid();
  v_q numeric;
  v_sum numeric := 0;
  v_recovered numeric;
  v_k int;
  v_amt numeric;
  v_next_month date;
  v_adj_type text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if v_caller is null then raise exception 'No employee record is linked to the current user.'; end if;

  -- Authorization: active advance_hr_processors row for THIS request's company — same pattern as
  -- advance_hr_process() (migration 0134). Deliberately NOT advance_recovery_can_manage() (Finance).
  select * into v_hr from public.advance_hr_processors where employee_id = v_caller and is_active;
  if v_hr.id is null then
    raise exception 'You are not an active HR Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;
  if v_req.company_id <> v_hr.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;

  select * into v_plan from public.advance_recovery_plans where advance_request_id = p_advance_request_id for update;
  if v_plan.id is null then raise exception 'No recovery plan exists for this advance yet.'; end if;
  if v_plan.status not in ('recovery_pending', 'recovering') then
    raise exception 'Recovery is % — the schedule can no longer be adjusted.', v_plan.status;
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required for a recovery adjustment.';
  end if;
  if p_new_amount is null or p_new_amount < 0 then
    raise exception 'New scheduled amount must be zero or greater.';
  end if;

  select * into v_target from public.advance_recovery_installments
  where recovery_plan_id = v_plan.id and installment_number = p_installment_number
  for update;
  if v_target.id is null then
    raise exception 'Installment % not found for this advance.', p_installment_number;
  end if;
  if v_target.status <> 'scheduled' then
    raise exception 'Installment % has already been processed and can no longer be adjusted (status: %).', p_installment_number, v_target.status;
  end if;
  -- Defensive: FIFO processing (advance_recovery_run_period) always completes installments in
  -- ascending installment_number order, so a later one should never be processed while this one is
  -- still 'scheduled'. Refuse rather than risk an installment_number collision while rebuilding.
  if exists (
    select 1 from public.advance_recovery_installments
    where recovery_plan_id = v_plan.id and installment_number > p_installment_number and status <> 'scheduled'
  ) then
    raise exception 'A later installment has already been processed out of order — this schedule cannot be safely rebuilt automatically.';
  end if;

  -- PAYROLL LOCK (§10/§11) — hard cutoff, server-side. The existing advance_payroll_periods
  -- draft/finalized/reversed state is the authoritative signal; no new lock concept invented.
  select * into v_period from public.advance_payroll_periods
  where company_id = v_req.company_id and period_month = date_trunc('month', v_target.due_month)::date;
  if v_period.id is not null and v_period.status = 'finalized' then
    raise exception 'Payroll is locked for this period. Advance recovery deduction can no longer be changed.';
  end if;
  v_lock_status := coalesce(v_period.status, 'not_created');

  select coalesce(sum(scheduled_amount), 0), count(*) into v_future_sum, v_existing_future_count
  from public.advance_recovery_installments
  where recovery_plan_id = v_plan.id and installment_number > p_installment_number and status = 'scheduled';

  v_total_redistributable := v_target.scheduled_amount + v_future_sum;
  if p_new_amount > v_total_redistributable then
    raise exception 'New amount (%) cannot exceed this period''s current schedule plus all remaining future scheduled amounts (%).', p_new_amount, v_total_redistributable;
  end if;

  v_remaining_for_future := v_total_redistributable - p_new_amount;
  v_future_count := coalesce(p_new_future_installment_count, v_existing_future_count);
  if v_future_count < 0 then
    raise exception 'Future installment count cannot be negative.';
  end if;
  if v_remaining_for_future > 0 and v_future_count < 1 then
    raise exception 'At least one future installment is required to hold the remaining %.', v_remaining_for_future;
  end if;

  v_adj_type := case when p_new_amount < v_target.scheduled_amount then 'decrease'
                     when p_new_amount > v_target.scheduled_amount then 'increase'
                     else 'no_change' end;

  insert into public.advance_recovery_installment_adjustments (
    company_id, advance_request_id, recovery_plan_id, batch_id, adjustment_scope,
    installment_number, due_month, old_scheduled_amount, new_scheduled_amount,
    adjustment_type, reason, processed_by, payroll_lock_status_at_time
  ) values (
    v_req.company_id, v_req.id, v_plan.id, v_batch, 'target_period',
    p_installment_number, v_target.due_month, v_target.scheduled_amount, p_new_amount,
    v_adj_type, p_reason, auth.uid(), v_lock_status
  );

  update public.advance_recovery_installments
  set scheduled_amount = p_new_amount
  where id = v_target.id;

  -- Rebuild the future schedule from scratch — only ever touches rows still 'scheduled' (never a
  -- processed/partially_processed one, so an already-deducted period is never disturbed).
  delete from public.advance_recovery_installments
  where recovery_plan_id = v_plan.id and installment_number > p_installment_number and status = 'scheduled';

  if v_future_count > 0 then
    insert into public.advance_recovery_installment_adjustments (
      company_id, advance_request_id, recovery_plan_id, batch_id, adjustment_scope,
      installment_number, due_month, old_scheduled_amount, new_scheduled_amount,
      adjustment_type, reason, processed_by, payroll_lock_status_at_time
    ) values (
      v_req.company_id, v_req.id, v_plan.id, v_batch, 'future_redistribution',
      null, null, v_future_sum, v_remaining_for_future,
      'redistribute', p_reason, auth.uid(), v_lock_status
    );

    v_q := trunc(v_remaining_for_future / v_future_count * 100) / 100;
    v_sum := 0;
    v_next_month := (v_target.due_month + interval '1 month')::date;
    for v_k in 1 .. v_future_count loop
      v_amt := case when v_k < v_future_count then v_q else v_remaining_for_future - v_sum end;
      v_sum := v_sum + v_amt;
      insert into public.advance_recovery_installments (company_id, advance_request_id, recovery_plan_id, employee_id, installment_number, due_month, scheduled_amount)
      values (v_req.company_id, v_req.id, v_plan.id, v_req.employee_id, p_installment_number + v_k,
              (v_next_month + ((v_k - 1) || ' month')::interval)::date, v_amt);
    end loop;
  end if;

  -- Exact-total invariant (§12/§20): scheduled (not-cancelled) + already-recovered must always
  -- equal the actual paid amount. Reuses the same "valid deduction" definition as
  -- advance_recovery_recompute_plan() (a deduction with no reversal pointing at it).
  select coalesce(sum(scheduled_amount), 0) into v_sum
  from public.advance_recovery_installments where recovery_plan_id = v_plan.id and status <> 'cancelled';
  select coalesce(sum(x.amount), 0) into v_recovered
  from public.advance_recovery_transactions x
  where x.recovery_plan_id = v_plan.id and x.txn_type = 'deduction'
    and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
  if v_sum + v_recovered <> v_plan.actual_paid_amount then
    raise exception 'Adjustment would break the exact-total invariant (scheduled % + recovered % <> actual paid %).', v_sum, v_recovered, v_plan.actual_paid_amount;
  end if;

  update public.advance_recovery_plans
  set installment_count = (select count(*) from public.advance_recovery_installments where recovery_plan_id = v_plan.id)
  where id = v_plan.id;

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_recovery_schedule_adjusted', 'Advance recovery schedule updated',
    format('Your advance recovery schedule was adjusted by HR: installment %s deduction is now %s.', p_installment_number, p_new_amount), v_req.id);

  return query
  select i.installment_number, i.due_month, i.scheduled_amount, i.status
  from public.advance_recovery_installments i
  where i.recovery_plan_id = v_plan.id
  order by i.installment_number;
end;
$$;
grant execute on function public.advance_recovery_adjust_installment(uuid, int, numeric, text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. advance_list_recovery_installment_adjustments() — read-only audit
--     history (§15). Same visibility CTE as advance_list_recovery_
--     transactions() (migration 0136), mirrored exactly.
-- ----------------------------------------------------------------------------
create or replace function public.advance_list_recovery_installment_adjustments(p_advance_request_id uuid)
returns table (
  batch_id uuid,
  adjustment_scope text,
  installment_number int,
  due_month date,
  old_scheduled_amount numeric,
  new_scheduled_amount numeric,
  adjustment_type text,
  reason text,
  processed_by_name text,
  payroll_lock_status_at_time text,
  created_at timestamptz
)
language sql
stable
security definer
as $$
  with vis as (
    select 1 where exists (
      select 1 from public.advance_requests a
      where a.id = p_advance_request_id
        and (
          is_super_admin()
          or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or a.employee_id = current_user_employee_id()
          or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
          or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_finance(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  )
  select j.batch_id, j.adjustment_scope, j.installment_number, j.due_month,
         j.old_scheduled_amount, j.new_scheduled_amount, j.adjustment_type, j.reason,
         e.full_name as processed_by_name, j.payroll_lock_status_at_time, j.created_at
  from public.advance_recovery_installment_adjustments j
  left join public.employees e on e.auth_user_id = j.processed_by
  where j.advance_request_id = p_advance_request_id and exists (select 1 from vis)
  order by j.created_at asc, j.adjustment_scope asc;
$$;
grant execute on function public.advance_list_recovery_installment_adjustments(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. advance_list_my_requests() / advance_list_manager_pending() /
--     advance_list_boss_pending() — RETURNS TABLE column lists are changing
--     (installment counts, §3/§4/§16), so DROP+CREATE (same Postgres
--     restriction as advance_get_apply_context() above). Every existing
--     column, join, filter and ordering is otherwise byte-for-byte
--     unchanged.
-- ----------------------------------------------------------------------------
drop function if exists public.advance_list_my_requests();
create function public.advance_list_my_requests()
returns table (
  id uuid, company_id uuid, employee_id uuid, advance_type_id uuid, advance_type_name text,
  policy_id uuid, policy_name text, policy_version int,
  requested_amount numeric, manager_recommended_amount numeric, boss_approved_amount numeric,
  boss_modification_reason text, reason text, remarks text, status text, current_step int,
  requested_at timestamptz, decided_at timestamptz, decision_remark text,
  requested_installment_count int, manager_recommended_installment_count int, boss_final_installment_count int
)
language sql
stable
security definer
as $$
  select a.id, a.company_id, a.employee_id, a.advance_type_id, t.name,
         a.policy_id, p.name, a.policy_version,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         a.boss_modification_reason, a.reason, a.remarks, a.status, a.current_step,
         a.requested_at, a.decided_at, a.decision_remark,
         a.requested_installment_count, a.manager_recommended_installment_count, a.boss_final_installment_count
  from public.advance_requests a
  join public.advance_types t on t.id = a.advance_type_id
  join public.advance_policies p on p.id = a.policy_id
  where a.employee_id = public.current_user_employee_id()
  order by a.requested_at desc;
$$;
grant execute on function public.advance_list_my_requests() to authenticated;

drop function if exists public.advance_list_manager_pending();
create function public.advance_list_manager_pending()
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text,
  advance_type_name text, requested_amount numeric, reason text, requested_at timestamptz, status text,
  requested_installment_count int
)
language sql
stable
security definer
as $$
  select a.id, a.employee_id, e.full_name, e.employee_code,
         t.name, a.requested_amount, a.reason, a.requested_at, a.status,
         a.requested_installment_count
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  where a.status = 'manager_pending'
    and public.advance_resolve_direct_manager(a.employee_id) = public.current_user_employee_id()
  order by a.requested_at asc;
$$;
grant execute on function public.advance_list_manager_pending() to authenticated;

drop function if exists public.advance_list_boss_pending();
create function public.advance_list_boss_pending()
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text,
  advance_type_name text, requested_amount numeric, manager_recommended_amount numeric,
  reason text, requested_at timestamptz, status text,
  requested_installment_count int, manager_recommended_installment_count int
)
language sql
stable
security definer
as $$
  select a.id, a.employee_id, e.full_name, e.employee_code,
         t.name, a.requested_amount, a.manager_recommended_amount, a.reason, a.requested_at, a.status,
         a.requested_installment_count, a.manager_recommended_installment_count
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
