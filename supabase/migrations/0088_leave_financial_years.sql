-- ============================================================================
-- Retail HRMS — Leave Management, Phase 1: Financial Year
-- Migration 0088
--
-- First table of the new Leave Policy Engine. Purely additive — no existing
-- table is touched, no existing Attendance/Night Duty function or table is
-- referenced or modified. Follows the EXACT existing rule-table convention
-- (see attendance_information_rules, migration 0042): company_id FK,
-- effective_from/effective_to + is_active + remark, created_by/updated_by
-- (plain uuid, no auth.users FK — matches every existing rule table),
-- set_updated_at() + write_audit_log() triggers reused, RLS = Super-Admin
-- write / company-wide read (same pattern as every other rule-configuration
-- table in this codebase).
--
-- Financial Year is a standalone concept (§6 of the approved plan) — no
-- existing "financial_year"/"fiscal_year" table exists anywhere in this
-- project (confirmed by investigation), so this is a genuinely new table,
-- not a duplicate of anything.
-- ============================================================================

create table if not exists public.leave_financial_years (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed', 'archived')),
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date > start_date)
);

create index if not exists idx_leave_financial_years_company on public.leave_financial_years (company_id);

-- Only one 'active' FY per company at a time -- the resolver (migration 0092) always looks up the
-- single active FY for "today", so this must be unambiguous.
create unique index if not exists uidx_leave_financial_years_one_active
  on public.leave_financial_years (company_id) where status = 'active';

alter table public.leave_financial_years enable row level security;

create policy "leave_financial_years_select_scoped" on public.leave_financial_years for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "leave_financial_years_insert_scoped" on public.leave_financial_years for insert
  with check (is_super_admin());
create policy "leave_financial_years_update_scoped" on public.leave_financial_years for update
  using (is_super_admin());
create policy "leave_financial_years_delete_scoped" on public.leave_financial_years for delete
  using (is_super_admin());

create trigger trg_leave_financial_years_set_updated_at before update on public.leave_financial_years
  for each row execute function public.set_updated_at();
create trigger trg_leave_financial_years_audit after insert or update or delete on public.leave_financial_years
  for each row execute function public.write_audit_log();
