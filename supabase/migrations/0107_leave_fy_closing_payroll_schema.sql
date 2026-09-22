-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: FY Closing + Payroll Integration
-- schema
-- Migration 0107
--
-- leave_ledger.transaction_type already reserved 'lwp_conversion' and
-- 'closing' back in Phase 2 (migration 0096) — clear evidence this exact
-- phase was anticipated. Adding 'lapse' and 'encashment' now as their own
-- explicit types (clearer audit trail than overloading 'adjustment').
--
-- leave_fy_closing_batches / leave_fy_closing_lines: the persisted result of
-- running the SAME calculation engine Preview uses (see the RPC migration) —
-- Preview computes and returns without writing; Confirm computes the
-- identical thing and persists it. One CLOSED batch per (company, FY) is
-- enforced by a partial unique index — closing twice is structurally
-- impossible, not just discouraged.
--
-- payroll_leave_transactions: deliberately NOT a payroll module (none
-- exists — confirmed by audit). This is the same "integration-ready
-- transaction, no invented formula" foundation explicitly permitted for LWP
-- in the master prompt, applied consistently to Encashment's payroll-facing
-- side too, since there is no real payroll engine to post either one into
-- yet. A future Payroll phase reads this table; nothing here assumes what
-- that phase will look like.
-- ============================================================================

alter table public.leave_ledger drop constraint if exists leave_ledger_transaction_type_check;
alter table public.leave_ledger add constraint leave_ledger_transaction_type_check
  check (transaction_type in (
    'opening', 'accrual', 'used', 'pending_reservation', 'carry_forward', 'adjustment',
    'reversal', 'lwp_conversion', 'closing', 'lapse', 'encashment'
  ));

create table if not exists public.leave_fy_closing_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  financial_year_id uuid not null references public.leave_financial_years (id),
  next_financial_year_id uuid references public.leave_financial_years (id),
  status text not null default 'preview' check (status in ('preview', 'processing', 'closed')),
  initiated_by uuid not null,
  initiated_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  remark text
);

-- Idempotency, structurally enforced: at most one CLOSED batch may ever exist per (company, FY).
create unique index if not exists idx_leave_fy_closing_batches_one_closed_per_fy
  on public.leave_fy_closing_batches (company_id, financial_year_id)
  where status = 'closed';

create index if not exists idx_leave_fy_closing_batches_fy on public.leave_fy_closing_batches (financial_year_id);

alter table public.leave_fy_closing_batches enable row level security;
create policy "leave_fy_closing_batches_select_scoped" on public.leave_fy_closing_batches for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "leave_fy_closing_batches_write_scoped" on public.leave_fy_closing_batches for insert with check (is_super_admin());
create policy "leave_fy_closing_batches_update_scoped" on public.leave_fy_closing_batches for update using (is_super_admin());

create table if not exists public.leave_fy_closing_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.leave_fy_closing_batches (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  leave_type_id uuid not null references public.leave_types (id),
  policy_id uuid,
  policy_version int,
  opening numeric not null default 0,
  earned numeric not null default 0,
  used numeric not null default 0,
  pending numeric not null default 0,
  available numeric not null default 0,
  carry_forward_days numeric not null default 0,
  encashment_days numeric not null default 0,
  lapse_days numeric not null default 0,
  basic_salary_snapshot numeric,
  da_snapshot numeric,
  salary_base_snapshot numeric,
  divisor_snapshot numeric,
  daily_rate numeric,
  encashment_amount numeric,
  final_status text not null check (final_status in ('carry_forward_only', 'encashed', 'lapsed', 'mixed', 'no_action')),
  created_at timestamptz not null default now()
);

create index if not exists idx_leave_fy_closing_lines_batch on public.leave_fy_closing_lines (batch_id);
create index if not exists idx_leave_fy_closing_lines_employee on public.leave_fy_closing_lines (employee_id);

alter table public.leave_fy_closing_lines enable row level security;
create policy "leave_fy_closing_lines_select_scoped" on public.leave_fy_closing_lines for select
  using (
    is_super_admin()
    or exists (
      select 1 from public.leave_fy_closing_batches b
      where b.id = batch_id and current_user_role() <> 'staff' and b.company_id = current_user_company_id()
    )
    or employee_id = current_user_employee_id()
  );
create policy "leave_fy_closing_lines_write_scoped" on public.leave_fy_closing_lines for insert with check (is_super_admin());

create table if not exists public.payroll_leave_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  financial_year_id uuid not null references public.leave_financial_years (id),
  leave_type_id uuid not null references public.leave_types (id),
  transaction_type text not null check (transaction_type in ('encashment', 'lwp_deduction')),
  days numeric not null check (days > 0),
  amount numeric check (amount is null or amount >= 0),
  source text not null default 'leave_management',
  status text not null default 'pending' check (status in ('pending', 'posted', 'processed', 'cancelled')),
  fy_closing_batch_id uuid references public.leave_fy_closing_batches (id),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Duplicate protection: the same employee/FY/leave type/transaction type may never be posted twice —
  -- a retried closing run must not create a second payroll transaction.
  unique (employee_id, financial_year_id, leave_type_id, transaction_type)
);

alter table public.payroll_leave_transactions enable row level security;
create policy "payroll_leave_transactions_select_scoped" on public.payroll_leave_transactions for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "payroll_leave_transactions_write_scoped" on public.payroll_leave_transactions for insert with check (is_super_admin());
create policy "payroll_leave_transactions_update_scoped" on public.payroll_leave_transactions for update using (is_super_admin());

create trigger trg_payroll_leave_transactions_audit after insert or update on public.payroll_leave_transactions for each row execute function public.write_audit_log();
create trigger trg_leave_fy_closing_batches_audit after insert or update on public.leave_fy_closing_batches for each row execute function public.write_audit_log();
