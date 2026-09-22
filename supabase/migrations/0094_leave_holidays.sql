-- ============================================================================
-- Retail HRMS — Leave Management, Phase 2: Holidays
-- Migration 0094
--
-- Prerequisite for Phase 2's Holiday Rule validation (§28/§29 of the Leave
-- Management prompts) — no holiday-calendar table exists anywhere in this
-- project (confirmed by the original Phase 0 investigation; 'holiday' was
-- only ever a status-enum literal on attendance_records). This was flagged
-- in the Phase 0 plan as its own small prerequisite. No admin UI is built
-- for managing holidays in this phase (out of the requested Phase 2 scope,
-- and no fabricated holiday data is seeded) — the day-counting engine
-- (migration 0097) reads this table and correctly treats zero rows as "no
-- holidays configured yet", never inventing one.
--
-- Same conventions as every existing rule table.
-- ============================================================================

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- null = company-wide holiday; set = applies only to that store.
  store_id uuid references public.stores (id) on delete cascade,
  name text not null,
  holiday_date date not null,
  is_optional boolean not null default false,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_holidays_company_date on public.holidays (company_id, holiday_date);
create index if not exists idx_holidays_store on public.holidays (store_id) where store_id is not null;

alter table public.holidays enable row level security;

-- SELECT is broader than the Phase 1 rule tables — Staff need to read this to know which days are
-- holidays when applying for leave (same reasoning as Staff already reading Shift/Weekly-Off
-- config on the Attendance Information card). Write stays Super-Admin only.
create policy "holidays_select_scoped" on public.holidays for select
  using (is_super_admin() or company_id = current_user_company_id());
create policy "holidays_insert_scoped" on public.holidays for insert with check (is_super_admin());
create policy "holidays_update_scoped" on public.holidays for update using (is_super_admin());
create policy "holidays_delete_scoped" on public.holidays for delete using (is_super_admin());

create trigger trg_holidays_set_updated_at before update on public.holidays for each row execute function public.set_updated_at();
create trigger trg_holidays_audit after insert or update or delete on public.holidays for each row execute function public.write_audit_log();
