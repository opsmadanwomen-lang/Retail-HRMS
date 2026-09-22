-- ============================================================================
-- Retail HRMS — Advance Policy Configuration Completion
-- Migration 0155
--
-- SCOPE: closes real, confirmed gaps in the EXISTING Advance policy
-- configuration (migrations 0132/0136) so it is complete/production-ready,
-- per inspection of 0132 (masters/config/assignment), 0133 (apply/approval),
-- 0136 (recovery), 0140 (grade/category precedent), 0145/0146 (F&F). Nothing
-- else in the Advance workflow, Advance Recovery engine, Payroll Recovery, or
-- F&F integration is touched — all were inspected and found ALREADY CORRECT:
--   - Recovery installment rounding (floor-to-paise, remainder absorbed by the
--     final installment, schedule-total-equals-paid assertion) — migration
--     0136 advance_recovery_generate_plan(). No change.
--   - Payroll Recovery FIFO order (payment_date/created_at), idempotency
--     (EXISTS check before insert + uidx_arx_one_deduction unique index) —
--     migration 0136 advance_recovery_run_period(). No change.
--   - F&F integration already reuses advance_recovery_plans/installments/
--     transactions/advance_recovery_recompute_plan directly (no parallel
--     calculation) — migration 0146 advance_recovery_run_period_full(). No
--     change.
--   - Employee Transfer never touches an Advance row; employees.store_id is
--     the correct "current store" source (migration 0148). No change.
--
-- REAL GAPS CLOSED HERE (confirmed missing by reading advance_apply() and the
-- policy config schema before writing anything):
--   1. advance_types.allows_multiple existed since 0132 but was NEVER READ by
--      advance_apply() — "multiple advances of the SAME Advance Type" was not
--      actually enforceable. Wired up now (§2).
--   2. No minimum advance amount existed anywhere (only max_amount). Added
--      advance_policy_configs.min_amount (§2).
--   3. No "existing outstanding advance" rule existed — advance_apply() only
--      ever counted PRE-PAYMENT pipeline statuses (manager_pending/
--      boss_pending/approved) toward allow_multiple_advances/
--      max_active_advances; a PAID-but-still-recovering advance was invisible
--      to eligibility. Added the explicit, configurable rule (§10).
--   4. A Policy could not be restricted to specific Advance Types — added an
--      additive junction table, defaulting to "all types" (zero rows) so
--      every existing policy's behavior is unchanged (§11).
--   5. "Activate" was a raw, unvalidated client-side UPDATE — no server-side
--      completeness check, and activating a new version while an old one was
--      still 'active' required a separate manual archive first (two
--      unguarded steps racing against the one-active-per-code unique index).
--      Added advance_validate_policy() (read-only checklist) and
--      advance_activate_policy() (validates, archives the prior active
--      version of the same code, activates — one transaction) (§13/§14).
--   6. Policy Assignment could not target Grade/Category, even though both
--      already exist as real employee attributes and an identical scope_type
--      extension already exists for salary_structure_assignments/
--      payroll_policy_assignments (migration 0140) — extended the SAME
--      advance_policy_assignments table/resolver with the same two scope
--      types, not a new assignment engine (§12).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. advance_policy_configs — minimum amount + existing-outstanding-advance
--    rule. Both default to today's actual behavior (no minimum; unrestricted
--    while any advance is outstanding), so every existing policy keeps
--    working identically until a company explicitly configures otherwise.
-- ----------------------------------------------------------------------------
alter table public.advance_policy_configs
  add column if not exists min_amount numeric,
  add column if not exists existing_outstanding_rule text not null default 'allowed_unrestricted',
  add column if not exists max_total_outstanding_limit numeric;

alter table public.advance_policy_configs drop constraint if exists advance_policy_configs_min_amount_check;
alter table public.advance_policy_configs add constraint advance_policy_configs_min_amount_check
  check (min_amount is null or min_amount >= 0);

alter table public.advance_policy_configs drop constraint if exists advance_policy_configs_existing_outstanding_rule_check;
alter table public.advance_policy_configs add constraint advance_policy_configs_existing_outstanding_rule_check
  check (existing_outstanding_rule in ('not_allowed', 'allowed_within_limit', 'allowed_unrestricted'));

alter table public.advance_policy_configs drop constraint if exists advance_policy_configs_max_total_outstanding_limit_check;
alter table public.advance_policy_configs add constraint advance_policy_configs_max_total_outstanding_limit_check
  check (max_total_outstanding_limit is null or max_total_outstanding_limit >= 0);

comment on column public.advance_policy_configs.existing_outstanding_rule is
  'Whether an employee with an existing OUTSTANDING advance (advance_recovery_plans.status in recovery_pending/recovering, sum(outstanding_amount) > 0) may request a NEW advance. not_allowed: never while any outstanding > 0. allowed_within_limit: allowed only while current total outstanding is below max_total_outstanding_limit. allowed_unrestricted (default): today''s existing behavior — outstanding is not considered at all.';

-- ----------------------------------------------------------------------------
-- 2. advance_policy_types — optional Policy -> Advance Type restriction.
--    ZERO rows for a policy = applies to every (active) Advance Type, exactly
--    today's behavior, so this is purely additive.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_policy_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  policy_id uuid not null references public.advance_policies (id) on delete cascade,
  advance_type_id uuid not null references public.advance_types (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (policy_id, advance_type_id)
);
create index if not exists idx_advance_policy_types_policy on public.advance_policy_types (policy_id);
create index if not exists idx_advance_policy_types_company on public.advance_policy_types (company_id);

alter table public.advance_policy_types enable row level security;

create trigger trg_advance_policy_types_audit
  after insert or delete on public.advance_policy_types
  for each row execute function public.write_audit_log();

-- Same shape as every other Advance config table (migration 0132): Super
-- Admin write, Super Admin + non-staff same-company read.
create policy "advance_policy_types_select" on public.advance_policy_types for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "advance_policy_types_write" on public.advance_policy_types for insert with check (is_super_admin());
create policy "advance_policy_types_delete" on public.advance_policy_types for delete using (is_super_admin());
-- no update policy — a restriction row is added or removed, never edited in place.

-- ----------------------------------------------------------------------------
-- 3. advance_policy_assignments — add Grade / Category scope (mirrors
--    salary_structure_assignments / payroll_policy_assignments exactly,
--    migration 0140). Reuses public.employee_grades / employee_categories —
--    no new master, no new assignment table.
-- ----------------------------------------------------------------------------
alter table public.advance_policy_assignments
  add column if not exists grade_id uuid references public.employee_grades (id) on delete cascade,
  add column if not exists category_id uuid references public.employee_categories (id) on delete cascade;

alter table public.advance_policy_assignments drop constraint if exists advance_policy_assignments_scope_type_check;
alter table public.advance_policy_assignments add constraint advance_policy_assignments_scope_type_check
  check (scope_type in ('employee', 'store', 'store_designation', 'store_department', 'grade', 'category', 'employment_type', 'company'));

-- IMPORTANT (confirmed live via pg_constraint inspection before writing this): the original
-- (migration 0132) unnamed table-level CHECK for THIS consistency rule was auto-named
-- `advance_policy_assignments_check1` — NOT `advance_policy_assignments_check`, which is the
-- UNRELATED `effective_to is null or effective_to >= effective_from` check and must never be
-- dropped. Only `_check1` (and, once this migration has run once, the explicitly-named
-- `_scope_consistency` for reapply-safety) are dropped here.
alter table public.advance_policy_assignments drop constraint if exists advance_policy_assignments_check1;
alter table public.advance_policy_assignments drop constraint if exists advance_policy_assignments_scope_consistency;
alter table public.advance_policy_assignments add constraint advance_policy_assignments_scope_consistency check (
  (scope_type = 'employee' and employee_id is not null) or
  (scope_type = 'store' and store_id is not null) or
  (scope_type = 'store_designation' and store_designation_id is not null) or
  (scope_type = 'store_department' and store_department_id is not null) or
  (scope_type = 'grade' and grade_id is not null) or
  (scope_type = 'category' and category_id is not null) or
  (scope_type = 'employment_type' and employment_type is not null) or
  (scope_type = 'company')
);

create index if not exists idx_advance_policy_assignments_grade on public.advance_policy_assignments (grade_id) where grade_id is not null;
create index if not exists idx_advance_policy_assignments_category on public.advance_policy_assignments (category_id) where category_id is not null;

-- ----------------------------------------------------------------------------
-- 4. advance_resolve_policy_assignment() — insert Grade/Category as tiers
--    5 and 6, between Store Department and Employment Type (unchanged order
--    otherwise): Employee -> Store -> Store Designation -> Store Department
--    -> Grade -> Category -> Employment Type -> Company.
-- ----------------------------------------------------------------------------
create or replace function public.advance_resolve_policy_assignment(
  p_company_id uuid,
  p_employee_id uuid,
  p_date date
)
returns uuid
language plpgsql
stable
security definer
as $$
declare
  v_emp record;
  v_policy_id uuid;
begin
  select store_id, store_designation_id, store_department_id, grade_id, category_id, employment_type
  into v_emp from public.employees where id = p_employee_id;

  -- Tier 1: employee-specific
  select a.policy_id into v_policy_id
  from public.advance_policy_assignments a
  join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
  where a.company_id = p_company_id and a.scope_type = 'employee' and a.employee_id = p_employee_id
    and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
  order by a.effective_from desc limit 1;
  if v_policy_id is not null then return v_policy_id; end if;

  -- Tier 2: store
  if v_emp.store_id is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'store' and a.store_id = v_emp.store_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 3: store designation
  if v_emp.store_designation_id is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'store_designation' and a.store_designation_id = v_emp.store_designation_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 4: store department
  if v_emp.store_department_id is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'store_department' and a.store_department_id = v_emp.store_department_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 5: grade (new)
  if v_emp.grade_id is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'grade' and a.grade_id = v_emp.grade_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 6: category (new)
  if v_emp.category_id is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'category' and a.category_id = v_emp.category_id
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 7: employment type
  if v_emp.employment_type is not null then
    select a.policy_id into v_policy_id
    from public.advance_policy_assignments a
    join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
    where a.company_id = p_company_id and a.scope_type = 'employment_type' and a.employment_type = v_emp.employment_type::text
      and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc limit 1;
    if v_policy_id is not null then return v_policy_id; end if;
  end if;

  -- Tier 8: company-wide default
  select a.policy_id into v_policy_id
  from public.advance_policy_assignments a
  join public.advance_policies p on p.id = a.policy_id and p.status = 'active'
  where a.company_id = p_company_id and a.scope_type = 'company'
    and a.is_active and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
  order by a.effective_from desc limit 1;

  return v_policy_id;
end;
$$;
grant execute on function public.advance_resolve_policy_assignment(uuid, uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. advance_apply() — additive eligibility checks only. Every existing
--    check (active employee, amount > 0, reason, type active/document,
--    policy/config resolved, manager/boss configured, min service, the
--    original allow_multiple_advances/max_active_advances counters, max
--    amount/% of salary, status/step derivation, insert, notify) is
--    UNCHANGED byte-for-byte apart from the new checks inserted at the points
--    noted below. Signature is unchanged so no caller (StaffAdvanceRequestPage)
--    needs updating.
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
  v_active_same_type int;
  v_outstanding_total numeric;
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

  -- NEW: Policy -> Advance Type restriction (§11). Zero rows in
  -- advance_policy_types for this policy = unrestricted (today's behavior).
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

  -- UNCHANGED: overall "any type" active-advance counters (allow_multiple_advances /
  -- max_active_advances), exactly as before.
  select count(*) into v_active from public.advance_requests
  where employee_id = v_emp.id and status in ('manager_pending', 'boss_pending', 'approved');
  if not coalesce(v_cfg.allow_multiple_advances, false) and v_active >= 1 then
    raise exception 'You already have an active advance. Multiple advances are not allowed under your policy.';
  end if;
  if v_active >= coalesce(v_cfg.max_active_advances, 1) then
    raise exception 'You have reached the maximum of % active advance(s).', v_cfg.max_active_advances;
  end if;

  -- NEW: same-Advance-Type restriction (§2), independent of the "different
  -- types simultaneously" counters above. advance_types.allows_multiple
  -- existed since migration 0132 but was never consulted until now.
  if not coalesce(v_type.allows_multiple, false) then
    select count(*) into v_active_same_type from public.advance_requests
    where employee_id = v_emp.id and advance_type_id = p_advance_type_id
      and status in ('manager_pending', 'boss_pending', 'approved');
    if v_active_same_type >= 1 then
      raise exception 'You already have an active request of this Advance Type. This Advance Type does not allow multiple simultaneous requests.';
    end if;
  end if;

  -- NEW: existing OUTSTANDING advance rule (§10) — distinct from the
  -- pre-payment counters above: this looks at advance_recovery_plans, i.e.
  -- advances already PAID and still being recovered.
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

  -- NEW: minimum advance amount (§2).
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
-- 6. advance_validate_policy() — read-only completeness checklist (§13).
--    Returns one row per check so the UI can render ✓/✗ exactly as specified.
-- ----------------------------------------------------------------------------
create or replace function public.advance_validate_policy(p_policy_id uuid)
returns table (check_key text, label text, passed boolean, detail text)
language plpgsql
stable
security definer
as $$
declare
  v_policy public.advance_policies;
  v_cfg public.advance_policy_configs;
  v_has_active_boss boolean;
  v_has_active_type boolean;
begin
  select * into v_policy from public.advance_policies where id = p_policy_id;
  if v_policy.id is null then
    raise exception 'Policy not found.';
  end if;
  if not (is_super_admin() or (current_user_role() <> 'staff' and v_policy.company_id = current_user_company_id())) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_cfg from public.advance_policy_configs where policy_id = p_policy_id;

  -- A. General
  check_key := 'general'; label := 'General policy configured';
  passed := v_policy.name is not null and length(trim(v_policy.name)) > 0
        and v_policy.code is not null and length(trim(v_policy.code)) > 0
        and v_policy.effective_from is not null;
  detail := case when passed then 'Name, code and effective date are set.' else 'Name, code and effective date are required.' end;
  return next;

  -- B. Eligibility (config row exists at all — every numeric knob is
  -- individually optional by design, e.g. NULL max_amount = no cap).
  check_key := 'eligibility'; label := 'Eligibility configured';
  passed := v_cfg.id is not null;
  detail := case when passed then 'Eligibility configuration exists.' else 'Open Configure and save the Eligibility section at least once.' end;
  return next;

  -- C. Approval workflow — Reporting Manager toggle is always a valid
  -- boolean; Boss requirement (if on) needs an active Boss configured (D).
  check_key := 'approval_workflow'; label := 'Approval workflow configured';
  passed := v_cfg.id is not null;
  detail := 'Reporting Manager requirement: ' || case when coalesce(v_cfg.manager_approval_required, true) then 'required' else 'not required' end || '.';
  return next;

  -- D. Boss authority — a Final Approver (Boss) roster entry must exist and
  -- be active for this company whenever Boss final approval is required.
  select exists (
    select 1 from public.advance_final_approvers fa where fa.company_id = v_policy.company_id and fa.is_active
  ) into v_has_active_boss;
  check_key := 'boss_authority'; label := 'Boss authority configured';
  passed := (not coalesce(v_cfg.boss_final_approval_required, true)) or v_has_active_boss;
  detail := case
    when not coalesce(v_cfg.boss_final_approval_required, true) then 'Boss final approval is not required by this policy.'
    when v_has_active_boss then 'An active Final Approver (Boss) is configured for this company.'
    else 'Boss final approval is required but no active Final Approver (Boss) is configured — see Final Approver (Boss) settings.'
  end;
  return next;

  -- E. Payment rules — config row exists (allow_partial_payment always has a
  -- real boolean value via its NOT NULL DEFAULT).
  check_key := 'payment_rules'; label := 'Payment rules configured';
  passed := v_cfg.id is not null;
  detail := 'Partial payment: ' || case when coalesce(v_cfg.allow_partial_payment, false) then 'allowed' else 'not allowed' end || '.';
  return next;

  -- F. Recovery rules — if recovery is enabled, recovery_start_rule must be
  -- resolvable (specific_date/specific_month needs recovery_start_specific).
  check_key := 'recovery_rules'; label := 'Recovery rules configured';
  passed := (not coalesce(v_cfg.recovery_enabled, true))
    or (v_cfg.recovery_start_rule <> 'specific_date' and v_cfg.recovery_start_rule <> 'specific_month')
    or v_cfg.recovery_start_specific is not null;
  detail := case
    when not coalesce(v_cfg.recovery_enabled, true) then 'Recovery is disabled for this policy.'
    when passed then 'Recovery start rule "' || v_cfg.recovery_start_rule || '" is fully configured.'
    else 'Recovery Start Rule is "' || v_cfg.recovery_start_rule || '" but no Specific Start Date/Month is set.'
  end;
  return next;

  -- G. Recovery method — the count/amount the chosen method actually needs.
  check_key := 'recovery_method'; label := 'Recovery method configured';
  passed := (not coalesce(v_cfg.recovery_enabled, true))
    or (v_cfg.recovery_method = 'fixed_installments' and coalesce(v_cfg.recovery_installment_count, v_cfg.max_installments, 12) >= 1)
    or (v_cfg.recovery_method = 'fixed_monthly' and v_cfg.recovery_monthly_amount is not null and v_cfg.recovery_monthly_amount > 0)
    or v_cfg.recovery_method in ('custom', 'full');
  detail := case
    when not coalesce(v_cfg.recovery_enabled, true) then 'Recovery is disabled for this policy.'
    when passed then 'Recovery method "' || v_cfg.recovery_method || '" is fully configured.'
    when v_cfg.recovery_method = 'fixed_monthly' then 'Recovery Method is "Fixed monthly deduction" but no Monthly Deduction amount is set.'
    else 'Recovery Method "' || coalesce(v_cfg.recovery_method, '—') || '" is incomplete.'
  end;
  return next;

  -- H. Advance Type assignment — at least one active Advance Type must exist
  -- for the company (a policy with zero advance_policy_types rows applies to
  -- ALL of them, by design — that is a valid, not incomplete, configuration).
  select exists (
    select 1 from public.advance_types t where t.company_id = v_policy.company_id and t.is_active
  ) into v_has_active_type;
  check_key := 'advance_type_assignment'; label := 'Advance Type assignment configured';
  passed := v_has_active_type;
  detail := case when passed then 'At least one active Advance Type exists for this company.' else 'No active Advance Type exists for this company — create one under Advance Types first.' end;
  return next;
end;
$$;
grant execute on function public.advance_validate_policy(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. advance_activate_policy() — the ONLY path that may set a policy to
--    'active'. Runs the exact same checks as advance_validate_policy() and
--    refuses if any fails; archives the prior 'active' version of the same
--    (company_id, code) first, in the same transaction, so the one-active-
--    per-code unique index is never raced. Super Admin only, matching the
--    existing advance_policies RLS write policy.
-- ----------------------------------------------------------------------------
create or replace function public.advance_activate_policy(p_policy_id uuid, p_change_reason text default null)
returns public.advance_policies
language plpgsql
security definer
as $$
declare
  v_policy public.advance_policies;
  v_failed text;
  v_row record;
begin
  if not is_super_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_policy from public.advance_policies where id = p_policy_id for update;
  if v_policy.id is null then
    raise exception 'Policy not found.';
  end if;
  if v_policy.status = 'active' then
    return v_policy;
  end if;

  for v_row in select * from public.advance_validate_policy(p_policy_id) where not passed loop
    v_failed := coalesce(v_failed || '; ', '') || v_row.label || ' — ' || v_row.detail;
  end loop;
  if v_failed is not null then
    raise exception 'Policy cannot be activated: %', v_failed;
  end if;

  -- Archive the prior active version of the same code (§14 versioning), if any.
  update public.advance_policies
  set status = 'archived', updated_by = auth.uid()
  where company_id = v_policy.company_id and code = v_policy.code and status = 'active' and id <> v_policy.id;

  update public.advance_policies
  set status = 'active',
      approved_by = auth.uid(),
      approved_at = now(),
      change_reason = coalesce(p_change_reason, change_reason),
      updated_by = auth.uid()
  where id = p_policy_id
  returning * into v_policy;

  return v_policy;
end;
$$;
grant execute on function public.advance_activate_policy(uuid, text) to authenticated;
