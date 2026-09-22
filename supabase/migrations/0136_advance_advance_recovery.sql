-- ============================================================================
-- Retail HRMS — Advance Management, Phase 4: PAYROLL RECOVERY, INSTALLMENTS,
-- PAYROLL DEDUCTION, EARLY SETTLEMENT & CLOSURE
-- Migration 0136
--
-- Phase 3 ends at status = 'paid'. Phase 4 adds the recovery lifecycle:
--   paid -> recovery_pending -> recovering -> closed          (normal recovery)
--   paid -> recovery_pending -> recovering -> settled -> closed (early settlement)
--
-- KEY RULES (all backend-enforced):
--  * Recovery basis is the ACTUAL PAID AMOUNT (advance_finance_payments.payment_amount),
--    never requested / manager-recommended / boss-approved.
--  * Outstanding = actual_paid - Σ(valid deductions) - Σ(settlements); a deduction is
--    "valid" iff no reversal row points at it. Outstanding can never be negative.
--  * closed only when Outstanding = 0.
--  * Same installment can never be deducted twice for the same payroll period
--    (partial UNIQUE index).
--  * Monetary math is NUMERIC only — no floating point.
--
-- NO existing Payroll engine exists in this system (confirmed by inspection:
-- only employee_salary_components + an empty payroll_leave_transactions stub).
-- Phase 4 therefore introduces a MINIMAL recovery-run stand-in
-- (advance_payroll_periods: company + month + draft/finalized/reversed) as the
-- documented payroll integration point — see the Phase 4 report.
--
-- Reuses (unmodified): every advance_* table + helper from Phases 1-3,
-- current_user_*(), is_super_admin(), write_audit_log(), set_updated_at(),
-- advance_am_i_finance()/_hr()/_boss(), advance_resolve_direct_manager(),
-- advance_notify(), advance_notification_settings. advance_finance_pay() and
-- every other Phase 1-3 RPC are UNTOUCHED. Nothing in Leave / Night Duty /
-- Attendance / Employee is touched. No app_role change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Status extension. 4 new values; every existing value keeps its meaning.
-- ----------------------------------------------------------------------------
alter table public.advance_requests drop constraint advance_requests_status_check;
alter table public.advance_requests add constraint advance_requests_status_check
  check (status in (
    'manager_pending', 'boss_pending', 'approved', 'rejected', 'sent_back', 'cancelled',
    'hr_pending', 'hr_on_hold', 'hr_sent_back', 'finance_pending',
    'finance_processing', 'paid', 'finance_on_hold',
    'recovery_pending', 'recovering', 'settled', 'closed'
  ));

-- ----------------------------------------------------------------------------
-- B. Recovery configuration — ADDITIVE columns on the existing
--    advance_policy_configs (respects Phase 1 policy versioning / effective
--    dates: a paid Advance snapshots its policy_id + policy_version and the
--    plan reads config through that snapshot). Nothing hard-coded.
-- ----------------------------------------------------------------------------
alter table public.advance_policy_configs
  add column if not exists recovery_enabled boolean not null default true,
  add column if not exists recovery_method text not null default 'fixed_installments',
  add column if not exists recovery_installment_count int,
  add column if not exists recovery_monthly_amount numeric,
  add column if not exists recovery_start_specific date;

alter table public.advance_policy_configs drop constraint if exists advance_policy_configs_recovery_method_check;
alter table public.advance_policy_configs add constraint advance_policy_configs_recovery_method_check
  check (recovery_method in ('fixed_installments', 'fixed_monthly', 'custom', 'full'));

alter table public.advance_policy_configs drop constraint if exists advance_policy_configs_recovery_start_rule_check;
alter table public.advance_policy_configs add constraint advance_policy_configs_recovery_start_rule_check
  check (recovery_start_rule in ('same_payroll', 'next_payroll', 'specific_date', 'specific_month', 'manual'));

alter table public.advance_policy_configs
  add constraint advance_policy_configs_recovery_installment_count_check
    check (recovery_installment_count is null or recovery_installment_count >= 1),
  add constraint advance_policy_configs_recovery_monthly_amount_check
    check (recovery_monthly_amount is null or recovery_monthly_amount > 0);

-- ----------------------------------------------------------------------------
-- C. advance_payroll_periods — the MINIMAL payroll-run stand-in. One row per
--    company per calendar month. A deduction run can only touch a 'draft'
--    period; 'finalized' locks it; 'reversed' unwinds every deduction in it.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_payroll_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  period_month date not null,
  label text,
  status text not null default 'draft' check (status in ('draft', 'finalized', 'reversed')),
  finalized_by uuid,
  finalized_at timestamptz,
  reversed_by uuid,
  reversed_at timestamptz,
  reverse_reason text,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, period_month),
  check (period_month = date_trunc('month', period_month)::date)
);
create index if not exists idx_advance_payroll_periods_company on public.advance_payroll_periods (company_id, status);

-- ----------------------------------------------------------------------------
-- D. advance_recovery_plans — one per recoverable Advance (paid). Snapshots
--    the actual paid amount (the recovery BASIS) + the applicable policy.
--    total_* / outstanding_amount are CACHES: every RPC recomputes them from
--    the immutable ledger and never trusts a client value.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_recovery_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  actual_paid_amount numeric not null check (actual_paid_amount > 0),
  payment_date date,
  policy_id uuid,
  policy_version int,
  recovery_method text not null check (recovery_method in ('fixed_installments', 'fixed_monthly', 'custom', 'full')),
  installment_count int,
  monthly_amount numeric,
  recovery_start_date date not null,
  total_scheduled numeric not null check (total_scheduled >= 0),
  total_recovered numeric not null default 0 check (total_recovered >= 0),
  total_settled numeric not null default 0 check (total_settled >= 0),
  total_reversed numeric not null default 0 check (total_reversed >= 0),
  outstanding_amount numeric not null check (outstanding_amount >= 0),
  status text not null check (status in ('recovery_pending', 'recovering', 'settled', 'closed')),
  closed_reason text check (closed_reason is null or closed_reason in ('fully_recovered', 'settled')),
  settled_at timestamptz,
  closed_at timestamptz,
  payslip_component_label text not null default 'Advance Recovery',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (advance_request_id)
);
create index if not exists idx_advance_recovery_plans_company on public.advance_recovery_plans (company_id, status);
create index if not exists idx_advance_recovery_plans_employee on public.advance_recovery_plans (employee_id, status);

-- ----------------------------------------------------------------------------
-- E. advance_recovery_installments — the schedule. Sum(scheduled_amount) is
--    validated to equal actual_paid_amount exactly at generation time.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_recovery_installments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  recovery_plan_id uuid not null references public.advance_recovery_plans (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  installment_number int not null check (installment_number >= 1),
  due_month date not null,
  scheduled_amount numeric not null check (scheduled_amount > 0),
  recovered_amount numeric not null default 0 check (recovered_amount >= 0),
  outstanding_after numeric,
  status text not null default 'scheduled' check (status in ('scheduled', 'processed', 'partially_processed', 'cancelled')),
  payroll_period_id uuid references public.advance_payroll_periods (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recovery_plan_id, installment_number),
  check (due_month = date_trunc('month', due_month)::date)
);
create index if not exists idx_advance_recovery_installments_plan on public.advance_recovery_installments (recovery_plan_id, installment_number);

-- ----------------------------------------------------------------------------
-- F. advance_recovery_transactions — IMMUTABLE ledger of payroll deductions
--    and their reversals. A deduction is "valid" (counts toward
--    total_recovered) iff no 'reversal' row references it. Original rows are
--    NEVER updated or deleted.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_recovery_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  recovery_plan_id uuid not null references public.advance_recovery_plans (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  payroll_period_id uuid references public.advance_payroll_periods (id) on delete set null,
  period_month date,
  installment_number int,
  txn_type text not null check (txn_type in ('deduction', 'reversal')),
  scheduled_amount numeric,
  amount numeric not null check (amount > 0),
  opening_outstanding numeric not null,
  closing_outstanding numeric not null,
  deduction_date date,
  reverses_transaction_id uuid references public.advance_recovery_transactions (id),
  remark text,
  processed_by uuid,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_advance_recovery_transactions_request on public.advance_recovery_transactions (advance_request_id, created_at);
-- duplicate-deduction protection: one deduction per (advance, payroll period, installment)
create unique index if not exists uidx_arx_one_deduction
  on public.advance_recovery_transactions (advance_request_id, payroll_period_id, installment_number)
  where txn_type = 'deduction';

-- ----------------------------------------------------------------------------
-- G. advance_recovery_settlements — IMMUTABLE early-settlement records.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_recovery_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  recovery_plan_id uuid not null references public.advance_recovery_plans (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  outstanding_before numeric not null,
  settlement_amount numeric not null check (settlement_amount > 0),
  outstanding_after numeric not null check (outstanding_after >= 0),
  settlement_date date not null,
  payment_mode_id uuid references public.advance_payment_modes (id) on delete set null,
  payment_mode text,
  payment_mode_label text,
  transaction_reference text,
  remarks text,
  processed_by uuid,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_advance_recovery_settlements_request on public.advance_recovery_settlements (advance_request_id, created_at);

alter table public.advance_payroll_periods enable row level security;
alter table public.advance_recovery_plans enable row level security;
alter table public.advance_recovery_installments enable row level security;
alter table public.advance_recovery_transactions enable row level security;
alter table public.advance_recovery_settlements enable row level security;

create trigger trg_advance_payroll_periods_set_updated_at before update on public.advance_payroll_periods for each row execute function public.set_updated_at();
create trigger trg_advance_payroll_periods_audit after insert or update or delete on public.advance_payroll_periods for each row execute function public.write_audit_log();
create trigger trg_advance_recovery_plans_set_updated_at before update on public.advance_recovery_plans for each row execute function public.set_updated_at();
create trigger trg_advance_recovery_plans_audit after insert or update or delete on public.advance_recovery_plans for each row execute function public.write_audit_log();
create trigger trg_advance_recovery_installments_set_updated_at before update on public.advance_recovery_installments for each row execute function public.set_updated_at();
create trigger trg_advance_recovery_installments_audit after insert or update or delete on public.advance_recovery_installments for each row execute function public.write_audit_log();
create trigger trg_advance_recovery_transactions_audit after insert on public.advance_recovery_transactions for each row execute function public.write_audit_log();
create trigger trg_advance_recovery_settlements_audit after insert on public.advance_recovery_settlements for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- RLS. Visibility mirrors advance_finance_payments (owner • Reporting Manager •
-- Boss • HR • Finance • Super Admin, all via SECURITY DEFINER helpers). Direct
-- writes are Super-Admin-only; real writes go through the RPCs. The two ledger
-- tables (transactions, settlements) have NO update/delete policy -> immutable
-- for everyone; corrections are new reversal / adjustment rows.
-- ----------------------------------------------------------------------------
do $rls$
declare t text;
begin
  for t in select unnest(array[
    'advance_recovery_plans', 'advance_recovery_installments',
    'advance_recovery_transactions', 'advance_recovery_settlements'
  ]) loop
    execute format($f$
      create policy "%1$s_select" on public.%1$s for select using (
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
      create policy "%1$s_write" on public.%1$s for insert with check (is_super_admin());
    $f$, t);
  end loop;
end $rls$;
-- plans + installments are cache rows the RPCs update as the table owner; a
-- Super-Admin-only UPDATE policy is defense-in-depth.
create policy "advance_recovery_plans_update" on public.advance_recovery_plans for update using (is_super_admin());
create policy "advance_recovery_installments_update" on public.advance_recovery_installments for update using (is_super_admin());
-- no UPDATE/DELETE policy on advance_recovery_transactions / advance_recovery_settlements -> immutable.

create policy "advance_payroll_periods_select" on public.advance_payroll_periods for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "advance_payroll_periods_write"  on public.advance_payroll_periods for insert with check (is_super_admin());
create policy "advance_payroll_periods_update" on public.advance_payroll_periods for update using (is_super_admin());

-- ----------------------------------------------------------------------------
-- Internal helper: recompute a plan's caches from the immutable ledger and
-- drive its status. Backend-authoritative outstanding (§29). SECURITY DEFINER,
-- not granted to anyone — only the RPCs below call it.
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_recompute_plan(p_plan_id uuid)
returns public.advance_recovery_plans
language plpgsql
security definer
as $$
declare
  v_plan public.advance_recovery_plans;
  v_recovered numeric;
  v_reversed numeric;
  v_settled numeric;
  v_outstanding numeric;
  v_new_status text;
  v_closed_reason text;
begin
  select * into v_plan from public.advance_recovery_plans where id = p_plan_id for update;
  if v_plan.id is null then raise exception 'Recovery plan not found.'; end if;

  -- valid deductions = deduction rows with no reversal pointing at them
  select coalesce(sum(x.amount), 0) into v_recovered
  from public.advance_recovery_transactions x
  where x.recovery_plan_id = p_plan_id and x.txn_type = 'deduction'
    and not exists (select 1 from public.advance_recovery_transactions r
                    where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);

  select coalesce(sum(x.amount), 0) into v_reversed
  from public.advance_recovery_transactions x
  where x.recovery_plan_id = p_plan_id and x.txn_type = 'reversal';

  select coalesce(sum(s.settlement_amount), 0) into v_settled
  from public.advance_recovery_settlements s where s.recovery_plan_id = p_plan_id;

  v_outstanding := v_plan.actual_paid_amount - v_recovered - v_settled;
  if v_outstanding < 0 then v_outstanding := 0; end if;   -- never negative (§5, §29)

  v_new_status := v_plan.status;
  v_closed_reason := v_plan.closed_reason;
  if v_outstanding = 0 then
    if v_settled > 0 and v_recovered < v_plan.actual_paid_amount then
      v_new_status := 'settled'; v_closed_reason := 'settled';
    else
      v_new_status := 'closed'; v_closed_reason := coalesce(v_closed_reason, 'fully_recovered');
    end if;
  elsif v_plan.status = 'closed' or v_plan.status = 'settled' then
    -- reopened by a reversal
    v_new_status := 'recovering'; v_closed_reason := null;
  elsif v_plan.status = 'recovery_pending' and v_recovered > 0 then
    v_new_status := 'recovering';
  end if;

  update public.advance_recovery_plans
  set total_recovered = v_recovered,
      total_reversed = v_reversed,
      total_settled = v_settled,
      outstanding_amount = v_outstanding,
      status = v_new_status,
      closed_reason = v_closed_reason,
      settled_at = case when v_new_status = 'settled' and settled_at is null then now() else settled_at end,
      closed_at = case when v_new_status = 'closed' and closed_at is null then now()
                       when v_new_status not in ('closed', 'settled') then null else closed_at end
  where id = p_plan_id
  returning * into v_plan;

  -- keep advance_requests.status in step (also promotes it out of 'paid' the first
  -- time a plan is recomputed — advance_finance_pay left it at 'paid')
  update public.advance_requests
  set status = case when v_plan.status = 'settled' then 'settled'
                    when v_plan.status = 'closed' then 'closed'
                    when v_plan.status = 'recovering' then 'recovering'
                    else 'recovery_pending' end,
      updated_by = auth.uid()
  where id = v_plan.advance_request_id
    and status in ('paid', 'recovery_pending', 'recovering', 'settled', 'closed');

  return v_plan;
end;
$$;
revoke execute on function public.advance_recovery_recompute_plan(uuid) from public, authenticated;

-- ----------------------------------------------------------------------------
-- Internal helper: is the caller allowed to run recovery / settlement for a
-- given company? = active Finance Processor of THAT company, or Super Admin.
-- (Documented decision — recovery + settlement are money movement, same domain
-- as Phase 3 Finance; HR is deliberately NOT given an approval-shaped role.)
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_can_manage(p_company_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select public.is_super_admin()
      or exists (
        select 1 from public.advance_finance_processors fp
        where fp.employee_id = public.current_user_employee_id()
          and fp.is_active and fp.company_id = p_company_id
      );
$$;
grant execute on function public.advance_recovery_can_manage(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_recovery_generate_plan(): build the installment schedule for a PAID
-- Advance. Basis = actual paid amount. Respects the snapshotted policy version.
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
  v_paid := v_pay.payment_amount;   -- THE RECOVERY BASIS (§4)

  select * into v_cfg from public.advance_policy_configs where policy_id = v_req.policy_id;
  if v_cfg.id is null then raise exception 'The advance''s policy has no configuration.'; end if;
  if not coalesce(v_cfg.recovery_enabled, true) then
    raise exception 'Recovery is disabled for this advance''s policy.';
  end if;

  v_method := coalesce(v_cfg.recovery_method, 'fixed_installments');

  -- recovery start date
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
  else -- manual
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

  -- ---- build installments (NUMERIC only, exact-sum guaranteed) ----
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
    v_count := coalesce(p_installment_count, v_cfg.recovery_installment_count, v_cfg.max_installments, 12);
    if v_count < 1 then raise exception 'Installment count must be at least 1.'; end if;
    v_q := trunc(v_paid / v_count * 100) / 100;   -- floor to paise
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

  -- schedule total MUST equal actual paid amount (§11/§13/§30.6)
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
-- advance_recovery_create_period(): open a 'draft' payroll period for the
-- caller's Finance company (or, for Super Admin, an explicit company).
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_create_period(p_period_month date, p_company_id uuid default null, p_label text default null)
returns public.advance_payroll_periods
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_company uuid;
  v_month date := date_trunc('month', p_period_month)::date;
  v_row public.advance_payroll_periods;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if public.is_super_admin() then
    v_company := p_company_id;
    if v_company is null then raise exception 'Super Admin must pass a company id.'; end if;
  else
    select fp.company_id into v_company from public.advance_finance_processors fp
    where fp.employee_id = v_caller and fp.is_active limit 1;
    if v_company is null then raise exception 'You are not an active Finance Processor.' using errcode = '42501'; end if;
  end if;

  insert into public.advance_payroll_periods (company_id, period_month, label, status, created_by, updated_by)
  values (v_company, v_month, coalesce(p_label, to_char(v_month, 'Mon YYYY')), 'draft', auth.uid(), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.advance_recovery_create_period(date, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_recovery_run_period(): the payroll deduction run. Atomic. Idempotent
-- (a re-run creates NO duplicate — the partial unique index + a pre-check).
-- Multiple active advances per employee are processed OLDEST-PAID-FIRST (FIFO)
-- — a DOCUMENTED interim default (see Phase 4 report, Unresolved Business
-- Decisions). One installment per plan per run.
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_run_period(p_payroll_period_id uuid, p_employee_id uuid default null)
returns table (
  advance_request_id uuid,
  employee_id uuid,
  employee_name text,
  installment_number int,
  scheduled_amount numeric,
  deducted_amount numeric,
  opening_outstanding numeric,
  closing_outstanding numeric,
  plan_status text
)
language plpgsql
security definer
as $$
#variable_conflict use_column
declare
  v_period public.advance_payroll_periods;
  v_plan public.advance_recovery_plans;
  v_inst public.advance_recovery_installments;
  v_open numeric;
  v_remaining_on_inst numeric;
  v_deduct numeric;
  v_close numeric;
  v_txn_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;

  select * into v_period from public.advance_payroll_periods where id = p_payroll_period_id for update;
  if v_period.id is null then raise exception 'Payroll period not found.'; end if;
  if not public.advance_recovery_can_manage(v_period.company_id) then
    raise exception 'You are not authorised to run recovery for this company.' using errcode = '42501';
  end if;
  if v_period.status <> 'draft' then
    raise exception 'Payroll period is % — only a draft period can be run.', v_period.status;
  end if;

  for v_plan in
    select p.* from public.advance_recovery_plans p
    where p.company_id = v_period.company_id
      and p.status in ('recovery_pending', 'recovering')
      and (p_employee_id is null or p.employee_id = p_employee_id)
    order by p.payment_date asc, p.created_at asc          -- FIFO
  loop
    -- promote a pending plan once its start month is reached
    if v_plan.status = 'recovery_pending' and v_plan.recovery_start_date <= v_period.period_month then
      update public.advance_recovery_plans set status = 'recovering' where id = v_plan.id;
      v_plan.status := 'recovering';
    end if;
    if v_plan.status <> 'recovering' then continue; end if;
    if v_plan.recovery_start_date > v_period.period_month then continue; end if;

    -- authoritative opening outstanding
    v_plan := public.advance_recovery_recompute_plan(v_plan.id);
    v_open := v_plan.outstanding_amount;
    if v_open <= 0 then continue; end if;

    -- earliest unfinished, already-due installment
    select * into v_inst from public.advance_recovery_installments i
    where i.recovery_plan_id = v_plan.id
      and i.status in ('scheduled', 'partially_processed')
      and i.due_month <= v_period.period_month
    order by i.installment_number asc
    limit 1;
    if v_inst.id is null then continue; end if;

    -- idempotency: this installment already deducted in this period?
    if exists (
      select 1 from public.advance_recovery_transactions x
      where x.advance_request_id = v_plan.advance_request_id
        and x.payroll_period_id = v_period.id
        and x.installment_number = v_inst.installment_number
        and x.txn_type = 'deduction'
    ) then
      continue;
    end if;

    v_remaining_on_inst := v_inst.scheduled_amount - v_inst.recovered_amount;
    v_deduct := least(v_remaining_on_inst, v_open);     -- never more than outstanding (§12/§14)
    if v_deduct <= 0 then continue; end if;
    v_close := v_open - v_deduct;

    insert into public.advance_recovery_transactions (
      company_id, advance_request_id, recovery_plan_id, employee_id, payroll_period_id, period_month,
      installment_number, txn_type, scheduled_amount, amount, opening_outstanding, closing_outstanding,
      deduction_date, processed_by, processed_at
    ) values (
      v_plan.company_id, v_plan.advance_request_id, v_plan.id, v_plan.employee_id, v_period.id, v_period.period_month,
      v_inst.installment_number, 'deduction', v_inst.scheduled_amount, v_deduct, v_open, v_close,
      v_period.period_month, auth.uid(), now()
    ) returning id into v_txn_id;

    update public.advance_recovery_installments
    set recovered_amount = recovered_amount + v_deduct,
        status = case when (recovered_amount + v_deduct) >= scheduled_amount then 'processed' else 'partially_processed' end,
        outstanding_after = v_close,
        payroll_period_id = v_period.id,
        processed_at = now()
    where id = v_inst.id;

    v_plan := public.advance_recovery_recompute_plan(v_plan.id);

    if v_plan.status = 'closed' then
      perform public.advance_notify(v_plan.company_id, v_plan.employee_id, 'advance_recovery_completed', 'Advance fully recovered',
        format('Your advance is fully recovered. Final deduction %s for %s.', v_deduct, to_char(v_period.period_month, 'Mon YYYY')), v_plan.advance_request_id);
      perform public.advance_notify(v_plan.company_id, v_plan.employee_id, 'advance_closed', 'Advance closed',
        'Your advance has been closed.', v_plan.advance_request_id);
    else
      perform public.advance_notify(v_plan.company_id, v_plan.employee_id, 'advance_recovery_deducted', 'Advance recovery deducted',
        format('%s has been deducted towards Advance Recovery for %s. Outstanding advance balance: %s.',
               v_deduct, to_char(v_period.period_month, 'Mon YYYY'), v_close), v_plan.advance_request_id);
    end if;

    advance_request_id := v_plan.advance_request_id;
    employee_id := v_plan.employee_id;
    select e.full_name into employee_name from public.employees e where e.id = v_plan.employee_id;
    installment_number := v_inst.installment_number;
    scheduled_amount := v_inst.scheduled_amount;
    deducted_amount := v_deduct;
    opening_outstanding := v_open;
    closing_outstanding := v_close;
    plan_status := v_plan.status;
    return next;
  end loop;
end;
$$;
grant execute on function public.advance_recovery_run_period(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_recovery_finalize_period(): lock a draft period (§20).
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_finalize_period(p_payroll_period_id uuid)
returns public.advance_payroll_periods
language plpgsql
security definer
as $$
declare v_period public.advance_payroll_periods;
begin
  select * into v_period from public.advance_payroll_periods where id = p_payroll_period_id for update;
  if v_period.id is null then raise exception 'Payroll period not found.'; end if;
  if not public.advance_recovery_can_manage(v_period.company_id) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if v_period.status <> 'draft' then raise exception 'Only a draft period can be finalized (current: %).', v_period.status; end if;

  update public.advance_payroll_periods
  set status = 'finalized', finalized_by = auth.uid(), finalized_at = now(), updated_by = auth.uid()
  where id = p_payroll_period_id
  returning * into v_period;
  return v_period;
end;
$$;
grant execute on function public.advance_recovery_finalize_period(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_recovery_reverse_period(): unwind every deduction in a period (§22).
-- Creates a 'reversal' row per deduction; original rows are never touched.
-- Reopens any plan that had closed. reason mandatory.
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_reverse_period(p_payroll_period_id uuid, p_reason text)
returns public.advance_payroll_periods
language plpgsql
security definer
as $$
declare
  v_period public.advance_payroll_periods;
  v_txn public.advance_recovery_transactions;
  v_plan public.advance_recovery_plans;
  v_open numeric;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'A reason is required to reverse a payroll period.'; end if;

  select * into v_period from public.advance_payroll_periods where id = p_payroll_period_id for update;
  if v_period.id is null then raise exception 'Payroll period not found.'; end if;
  if not public.advance_recovery_can_manage(v_period.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_period.status = 'reversed' then raise exception 'Payroll period is already reversed.'; end if;

  for v_txn in
    select x.* from public.advance_recovery_transactions x
    where x.payroll_period_id = p_payroll_period_id and x.txn_type = 'deduction'
      and not exists (select 1 from public.advance_recovery_transactions r
                      where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id)
  loop
    select outstanding_amount into v_open from public.advance_recovery_plans where id = v_txn.recovery_plan_id for update;

    insert into public.advance_recovery_transactions (
      company_id, advance_request_id, recovery_plan_id, employee_id, payroll_period_id, period_month,
      installment_number, txn_type, scheduled_amount, amount, opening_outstanding, closing_outstanding,
      deduction_date, reverses_transaction_id, remark, processed_by, processed_at
    ) values (
      v_txn.company_id, v_txn.advance_request_id, v_txn.recovery_plan_id, v_txn.employee_id, v_period.id, v_period.period_month,
      v_txn.installment_number, 'reversal', v_txn.scheduled_amount, v_txn.amount, v_open, v_open + v_txn.amount,
      v_period.period_month, v_txn.id, p_reason, auth.uid(), now()
    );

    update public.advance_recovery_installments
    set recovered_amount = greatest(recovered_amount - v_txn.amount, 0),
        status = case when greatest(recovered_amount - v_txn.amount, 0) <= 0 then 'scheduled' else 'partially_processed' end,
        processed_at = now()
    where recovery_plan_id = v_txn.recovery_plan_id and installment_number = v_txn.installment_number;

    v_plan := public.advance_recovery_recompute_plan(v_txn.recovery_plan_id);
    perform public.advance_notify(v_plan.company_id, v_plan.employee_id, 'advance_recovery_deducted', 'Advance recovery reversed',
      format('A recovery deduction of %s for %s has been reversed. Outstanding advance balance: %s.',
             v_txn.amount, to_char(v_period.period_month, 'Mon YYYY'), v_plan.outstanding_amount), v_plan.advance_request_id);
  end loop;

  update public.advance_payroll_periods
  set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reverse_reason = p_reason, updated_by = auth.uid()
  where id = p_payroll_period_id
  returning * into v_period;
  return v_period;
end;
$$;
grant execute on function public.advance_recovery_reverse_period(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_recovery_settle(): early settlement (§23-§26). Finance Processor /
-- Super Admin only. Amount must be > 0 and <= current outstanding.
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_settle(
  p_advance_request_id uuid,
  p_settlement_amount numeric,
  p_settlement_date date,
  p_payment_mode_id uuid default null,
  p_transaction_reference text default null,
  p_remarks text default null
)
returns public.advance_recovery_plans
language plpgsql
security definer
as $$
declare
  v_plan public.advance_recovery_plans;
  v_cfg record;
  v_mode record;
  v_open numeric;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;

  select * into v_plan from public.advance_recovery_plans where advance_request_id = p_advance_request_id for update;
  if v_plan.id is null then raise exception 'No recovery plan for this advance.'; end if;
  if not public.advance_recovery_can_manage(v_plan.company_id) then
    raise exception 'You are not authorised to settle recovery for this company.' using errcode = '42501';
  end if;
  if v_plan.status not in ('recovery_pending', 'recovering') then
    raise exception 'Only an active recovery can be settled (current status: %).', v_plan.status;
  end if;

  select * into v_cfg from public.advance_policy_configs where policy_id = v_plan.policy_id;
  if not coalesce(v_cfg.allow_early_settlement, true) then
    raise exception 'Early settlement is not allowed under this advance''s policy.';
  end if;

  v_plan := public.advance_recovery_recompute_plan(v_plan.id);
  v_open := v_plan.outstanding_amount;

  if p_settlement_amount is null or p_settlement_amount <= 0 then
    raise exception 'Settlement amount must be greater than zero.';
  end if;
  if p_settlement_amount > v_open then
    raise exception 'Settlement amount % exceeds the outstanding amount (%).', p_settlement_amount, v_open;
  end if;
  if p_settlement_date is null then raise exception 'A settlement date is required.'; end if;

  if p_payment_mode_id is not null then
    select * into v_mode from public.advance_payment_modes where id = p_payment_mode_id and company_id = v_plan.company_id;
  end if;

  insert into public.advance_recovery_settlements (
    company_id, advance_request_id, recovery_plan_id, employee_id,
    outstanding_before, settlement_amount, outstanding_after, settlement_date,
    payment_mode_id, payment_mode, payment_mode_label, transaction_reference, remarks, processed_by, processed_at
  ) values (
    v_plan.company_id, v_plan.advance_request_id, v_plan.id, v_plan.employee_id,
    v_open, p_settlement_amount, v_open - p_settlement_amount, p_settlement_date,
    v_mode.id, v_mode.code, v_mode.name, nullif(trim(coalesce(p_transaction_reference, '')), ''), p_remarks, auth.uid(), now()
  );

  v_plan := public.advance_recovery_recompute_plan(v_plan.id);

  perform public.advance_notify(v_plan.company_id, v_plan.employee_id, 'advance_settlement_completed', 'Advance settlement recorded',
    format('An early settlement of %s has been recorded. Outstanding advance balance: %s.', p_settlement_amount, v_plan.outstanding_amount), v_plan.advance_request_id);
  if v_plan.status in ('settled', 'closed') then
    perform public.advance_notify(v_plan.company_id, v_plan.employee_id, 'advance_closed', 'Advance settled',
      'Your advance has been fully settled.', v_plan.advance_request_id);
  end if;

  return v_plan;
end;
$$;
grant execute on function public.advance_recovery_settle(uuid, numeric, date, uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_recovery_close(): explicit archival close. Outstanding MUST be 0.
-- Moves a 'settled' or fully-recovered 'recovering' plan to 'closed' (§27/§28).
-- ----------------------------------------------------------------------------
create or replace function public.advance_recovery_close(p_advance_request_id uuid, p_remark text default null)
returns public.advance_recovery_plans
language plpgsql
security definer
as $$
declare v_plan public.advance_recovery_plans;
begin
  select * into v_plan from public.advance_recovery_plans where advance_request_id = p_advance_request_id for update;
  if v_plan.id is null then raise exception 'No recovery plan for this advance.'; end if;
  if not public.advance_recovery_can_manage(v_plan.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;

  v_plan := public.advance_recovery_recompute_plan(v_plan.id);
  if v_plan.outstanding_amount <> 0 then
    raise exception 'An advance can only be closed when the outstanding amount is zero (currently %).', v_plan.outstanding_amount;
  end if;
  if v_plan.status = 'closed' then return v_plan; end if;

  update public.advance_recovery_plans
  set status = 'closed', closed_at = coalesce(closed_at, now()),
      closed_reason = coalesce(closed_reason, case when total_settled > 0 then 'settled' else 'fully_recovered' end),
      updated_by = auth.uid()
  where id = v_plan.id
  returning * into v_plan;

  update public.advance_requests set status = 'closed', updated_by = auth.uid()
  where id = p_advance_request_id and status in ('settled', 'recovering', 'recovery_pending');

  perform public.advance_notify(v_plan.company_id, v_plan.employee_id, 'advance_closed', 'Advance closed',
    'Your advance has been closed.', v_plan.advance_request_id);
  return v_plan;
end;
$$;
grant execute on function public.advance_recovery_close(uuid, text) to authenticated;

-- ============================================================================
-- Read RPCs (SECURITY DEFINER, each self/role-scoped).
-- ============================================================================

-- Staff: my own recovery summaries (self-scoped).
create or replace function public.advance_list_my_recoveries()
returns table (
  advance_request_id uuid,
  advance_type_name text,
  actual_paid_amount numeric,
  total_recovered numeric,
  total_settled numeric,
  outstanding_amount numeric,
  recovery_method text,
  installment_count int,
  monthly_amount numeric,
  recovery_start_date date,
  next_due_month date,
  completed_installments int,
  total_installments int,
  status text,
  closed_reason text
)
language sql
stable
security definer
as $$
  select p.advance_request_id, t.name, p.actual_paid_amount, p.total_recovered, p.total_settled, p.outstanding_amount,
         p.recovery_method, p.installment_count, p.monthly_amount, p.recovery_start_date,
         (select min(i.due_month) from public.advance_recovery_installments i where i.recovery_plan_id = p.id and i.status in ('scheduled', 'partially_processed')),
         (select count(*)::int from public.advance_recovery_installments i where i.recovery_plan_id = p.id and i.status = 'processed'),
         (select count(*)::int from public.advance_recovery_installments i where i.recovery_plan_id = p.id and i.status <> 'cancelled'),
         p.status, p.closed_reason
  from public.advance_recovery_plans p
  join public.advance_requests a on a.id = p.advance_request_id
  join public.advance_types t on t.id = a.advance_type_id
  where a.employee_id = public.current_user_employee_id()
  order by p.created_at desc;
$$;
grant execute on function public.advance_list_my_recoveries() to authenticated;

-- Admin/HR/Finance: company-scoped recovery list for the Recovery tab.
create or replace function public.advance_recovery_list_plans(p_status text default null)
returns table (
  advance_request_id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  advance_type_name text,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  actual_paid_amount numeric,
  total_recovered numeric,
  total_settled numeric,
  outstanding_amount numeric,
  recovery_method text,
  installment_count int,
  monthly_amount numeric,
  recovery_start_date date,
  next_due_month date,
  status text,
  closed_reason text
)
language plpgsql
stable
security definer
as $$
declare v_is_admin boolean := public.is_super_admin();
begin
  return query
  select p.advance_request_id, p.employee_id, e.full_name, e.employee_code, t.name,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         p.actual_paid_amount, p.total_recovered, p.total_settled, p.outstanding_amount,
         p.recovery_method, p.installment_count, p.monthly_amount, p.recovery_start_date,
         (select min(i.due_month) from public.advance_recovery_installments i where i.recovery_plan_id = p.id and i.status in ('scheduled', 'partially_processed')),
         p.status, p.closed_reason
  from public.advance_recovery_plans p
  join public.advance_requests a on a.id = p.advance_request_id
  join public.employees e on e.id = p.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  where (v_is_admin
         or (current_user_role() <> 'staff' and p.company_id = current_user_company_id())
         or public.advance_am_i_hr(public.current_user_employee_id())
         or public.advance_am_i_finance(public.current_user_employee_id()))
    and (v_is_admin or p.company_id = current_user_company_id())
    and (p_status is null or p.status = p_status)
  order by p.created_at desc;
end;
$$;
grant execute on function public.advance_recovery_list_plans(text) to authenticated;

-- One-advance recovery detail bundle (visible to owner / manager / boss / HR / Finance / SA).
create or replace function public.advance_get_recovery_detail(p_advance_request_id uuid)
returns table (
  advance_request_id uuid,
  employee_name text,
  employee_code text,
  advance_type_name text,
  policy_name text,
  policy_version int,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  actual_paid_amount numeric,
  payment_date date,
  total_recovered numeric,
  total_settled numeric,
  total_reversed numeric,
  outstanding_amount numeric,
  recovery_method text,
  installment_count int,
  monthly_amount numeric,
  recovery_start_date date,
  next_due_month date,
  last_deduction_date date,
  status text,
  closed_reason text,
  recovery_enabled boolean,
  allow_early_settlement boolean
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
        or (public.advance_am_i_finance(public.current_user_employee_id()) and a.company_id = current_user_company_id())
      )
  ) then
    raise exception 'Advance request not found or not visible to you.';
  end if;

  return query
  select p.advance_request_id, e.full_name, e.employee_code, t.name, pol.name, p.policy_version,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         p.actual_paid_amount, p.payment_date,
         p.total_recovered, p.total_settled, p.total_reversed, p.outstanding_amount,
         p.recovery_method, p.installment_count, p.monthly_amount, p.recovery_start_date,
         (select min(i.due_month) from public.advance_recovery_installments i where i.recovery_plan_id = p.id and i.status in ('scheduled', 'partially_processed')),
         (select max(x.deduction_date) from public.advance_recovery_transactions x where x.recovery_plan_id = p.id and x.txn_type = 'deduction'),
         p.status, p.closed_reason,
         coalesce(cfg.recovery_enabled, true), coalesce(cfg.allow_early_settlement, true)
  from public.advance_recovery_plans p
  join public.advance_requests a on a.id = p.advance_request_id
  join public.employees e on e.id = p.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  join public.advance_policies pol on pol.id = p.policy_id
  left join public.advance_policy_configs cfg on cfg.policy_id = p.policy_id
  where p.advance_request_id = p_advance_request_id;
end;
$$;
grant execute on function public.advance_get_recovery_detail(uuid) to authenticated;

create or replace function public.advance_list_recovery_installments(p_advance_request_id uuid)
returns table (
  installment_number int,
  due_month date,
  scheduled_amount numeric,
  recovered_amount numeric,
  outstanding_after numeric,
  status text,
  processed_at timestamptz
)
language sql
stable
security definer
as $$
  select i.installment_number, i.due_month, i.scheduled_amount, i.recovered_amount, i.outstanding_after, i.status, i.processed_at
  from public.advance_recovery_installments i
  join public.advance_recovery_plans p on p.id = i.recovery_plan_id
  where p.advance_request_id = p_advance_request_id
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
          or (public.advance_am_i_finance(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  order by i.installment_number asc;
$$;
grant execute on function public.advance_list_recovery_installments(uuid) to authenticated;

-- Unified recovery timeline: deductions + reversals + settlements.
create or replace function public.advance_list_recovery_transactions(p_advance_request_id uuid)
returns table (
  kind text,
  period_month date,
  installment_number int,
  scheduled_amount numeric,
  amount numeric,
  opening_outstanding numeric,
  closing_outstanding numeric,
  txn_date date,
  actor_name text,
  remark text,
  acted_at timestamptz
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
  select x.txn_type as kind, x.period_month, x.installment_number, x.scheduled_amount, x.amount,
         x.opening_outstanding, x.closing_outstanding, x.deduction_date as txn_date, e.full_name as actor_name, x.remark, x.created_at as acted_at
  from public.advance_recovery_transactions x
  left join public.employees e on e.auth_user_id = x.processed_by
  where x.advance_request_id = p_advance_request_id and exists (select 1 from vis)
  union all
  select 'settlement' as kind, date_trunc('month', s.settlement_date)::date, null::int, null::numeric, s.settlement_amount,
         s.outstanding_before, s.outstanding_after, s.settlement_date as txn_date, e2.full_name as actor_name, s.remarks, s.created_at as acted_at
  from public.advance_recovery_settlements s
  left join public.employees e2 on e2.auth_user_id = s.processed_by
  where s.advance_request_id = p_advance_request_id and exists (select 1 from vis)
  order by acted_at asc;
$$;
grant execute on function public.advance_list_recovery_transactions(uuid) to authenticated;

-- Payroll periods list for the run screen.
create or replace function public.advance_recovery_list_periods()
returns table (
  id uuid, company_id uuid, period_month date, label text, status text,
  finalized_at timestamptz, reversed_at timestamptz, reverse_reason text,
  deduction_count int, deducted_total numeric
)
language plpgsql
stable
security definer
as $$
declare v_is_admin boolean := public.is_super_admin();
begin
  return query
  select pp.id, pp.company_id, pp.period_month, pp.label, pp.status,
         pp.finalized_at, pp.reversed_at, pp.reverse_reason,
         (select count(*)::int from public.advance_recovery_transactions x where x.payroll_period_id = pp.id and x.txn_type = 'deduction'),
         (select coalesce(sum(x.amount), 0) from public.advance_recovery_transactions x where x.payroll_period_id = pp.id and x.txn_type = 'deduction')
  from public.advance_payroll_periods pp
  where v_is_admin
     or ((current_user_role() <> 'staff') and pp.company_id = current_user_company_id())
  order by pp.period_month desc;
end;
$$;
grant execute on function public.advance_recovery_list_periods() to authenticated;
