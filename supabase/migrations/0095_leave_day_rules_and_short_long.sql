-- ============================================================================
-- Retail HRMS — Leave Management, Phase 2: Weekly-Off/Holiday/Sandwich rules,
-- Short/Long Leave threshold
-- Migration 0095
--
-- EXTENDS the existing Phase 1 leave_policy_type_configs table (does not
-- create a duplicate) with the 3 day-classification rules Phase 2's
-- validation checklist requires (§19) — these were explicitly deferred out
-- of Phase 1 (see migration 0090's own header note) because Phase 1 had no
-- Leave Application to apply them to yet; Phase 2 does.
--
-- Short/Long classification (§20 of the prompts) gets its OWN new table,
-- leave_short_long_rules, one row per policy — a single configurable
-- threshold + operator, exactly mirroring how the approved plan insists
-- "exactly N days" must never be silently decided in code.
-- ============================================================================

alter table public.leave_policy_type_configs
  add column if not exists weekly_off_count_rule text not null default 'dont_count'
    check (weekly_off_count_rule in ('count', 'dont_count', 'custom')),
  add column if not exists holiday_count_rule text not null default 'dont_count'
    check (holiday_count_rule in ('count', 'dont_count', 'custom')),
  add column if not exists sandwich_rule_enabled boolean not null default false;

create table if not exists public.leave_short_long_rules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.leave_policies (id) on delete cascade,
  threshold_days numeric not null default 3 check (threshold_days > 0),
  -- 'short_lte': threshold_days and below = Short (matches the prompt's confirmed default,
  -- "1-3 Days = Short, 4+ = Long"). 'short_lt': strictly below threshold_days = Short.
  threshold_operator text not null default 'short_lte' check (threshold_operator in ('short_lte', 'short_lt')),
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id)
);

alter table public.leave_short_long_rules enable row level security;

create policy "leave_short_long_rules_select_scoped" on public.leave_short_long_rules for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and exists (
      select 1 from public.leave_policies p where p.id = policy_id and p.company_id = current_user_company_id()
    ))
  );
create policy "leave_short_long_rules_insert_scoped" on public.leave_short_long_rules for insert with check (is_super_admin());
create policy "leave_short_long_rules_update_scoped" on public.leave_short_long_rules for update using (is_super_admin());
create policy "leave_short_long_rules_delete_scoped" on public.leave_short_long_rules for delete using (is_super_admin());

create trigger trg_leave_short_long_rules_set_updated_at before update on public.leave_short_long_rules for each row execute function public.set_updated_at();
create trigger trg_leave_short_long_rules_audit after insert or update or delete on public.leave_short_long_rules for each row execute function public.write_audit_log();

-- Seed the confirmed default (1-3 = Short, 4+ = Long) for the existing seeded policy — an ordinary,
-- HR-editable row, not a code decision. Idempotent.
insert into public.leave_short_long_rules (policy_id, threshold_days, threshold_operator, remark)
select id, 3, 'short_lte', 'Seeded default Short/Long threshold — Phase 2, migration 0095.'
from public.leave_policies
where company_id = '34818dc6-dea3-45c2-a6a7-38b288007902' and code = 'GENERAL-STAFF' and version_number = 1
on conflict (policy_id) do nothing;
