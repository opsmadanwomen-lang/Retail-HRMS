-- ============================================================================
-- Retail HRMS — Leave Management, Phase 1: Accrual Periods, Probation, Pro-Rata
-- Migration 0091
--
-- ACCRUAL PERIODS (§8/§9): the exact mechanism that makes "April-September =
-- 3/month, October-March = 1/month" pure DATA, never code -- unlimited rows
-- per leave_policy_type_configs row, each an independent (start_month,
-- end_month, amount) window. Periods may wrap the calendar year boundary
-- (e.g. Oct=10 -> Mar=3) -- the resolver RPC (migration 0092) handles that,
-- not the schema. Overlap prevention (§9's "prevent overlapping accrual
-- periods") is enforced by the write RPC that will create/update these rows
-- (added alongside the Admin UI in this same phase), not a DB constraint --
-- wrap-around ranges make a pure SQL exclusion constraint impractical here,
-- matching how attendance rule tables in this codebase already leave
-- similar cross-row validation to the RPC layer rather than the schema.
--
-- PROBATION (§11/§12): one row per POLICY (not per leave type) -- probation
-- duration and the post-probation-start rule are company/policy-wide HR
-- decisions in the approved plan's own wording, shared across every leave
-- type in that policy. Per-leave-type probation eligibility already lives on
-- leave_policy_type_configs.probation_eligible (migration 0090) -- a leave
-- type can opt out of the probation gate entirely without needing its own
-- duration row.
--
-- PRO-RATA (§13): per leave-type-per-policy, since whether/how a specific
-- leave type prorates is independent per type.
-- ============================================================================

create table if not exists public.leave_accrual_periods (
  id uuid primary key default gen_random_uuid(),
  policy_type_config_id uuid not null references public.leave_policy_type_configs (id) on delete cascade,
  -- 1-12. period_end_month < period_start_month means the window wraps the calendar year
  -- (e.g. Oct(10)-Mar(3)) -- resolved explicitly in leave_month_in_period(), not assumed by any
  -- caller.
  period_start_month int not null check (period_start_month between 1 and 12),
  period_end_month int not null check (period_end_month between 1 and 12),
  accrual_amount numeric not null check (accrual_amount >= 0),
  sort_order int not null default 0,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leave_accrual_periods_config on public.leave_accrual_periods (policy_type_config_id);

create table if not exists public.leave_probation_rules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.leave_policies (id) on delete cascade,
  duration_value int not null default 0 check (duration_value >= 0),
  duration_unit text not null default 'months' check (duration_unit in ('months', 'days')),
  extra_leave_during_probation numeric not null default 0 check (extra_leave_during_probation >= 0),
  weekly_off_during_probation boolean not null default true,
  post_probation_start_rule text not null default 'same_month'
    check (post_probation_start_rule in ('same_month', 'next_month', 'specific_date', 'pro_rata', 'full_entitlement', 'custom')),
  -- Only meaningful when post_probation_start_rule = 'specific_date'.
  specific_start_date date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id)
);

create table if not exists public.leave_pro_rata_rules (
  id uuid primary key default gen_random_uuid(),
  policy_type_config_id uuid not null references public.leave_policy_type_configs (id) on delete cascade,
  enabled boolean not null default false,
  basis text not null default 'joining_date'
    check (basis in ('joining_date', 'eligibility_date', 'month', 'actual_days', 'payroll_cycle', 'custom')),
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_type_config_id)
);

alter table public.leave_accrual_periods enable row level security;
alter table public.leave_probation_rules enable row level security;
alter table public.leave_pro_rata_rules enable row level security;

create policy "leave_accrual_periods_select_scoped" on public.leave_accrual_periods for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and exists (
      select 1 from public.leave_policy_type_configs c
      join public.leave_policies p on p.id = c.policy_id
      where c.id = policy_type_config_id and p.company_id = current_user_company_id()
    ))
  );
create policy "leave_accrual_periods_insert_scoped" on public.leave_accrual_periods for insert with check (is_super_admin());
create policy "leave_accrual_periods_update_scoped" on public.leave_accrual_periods for update using (is_super_admin());
create policy "leave_accrual_periods_delete_scoped" on public.leave_accrual_periods for delete using (is_super_admin());

create policy "leave_probation_rules_select_scoped" on public.leave_probation_rules for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and exists (
      select 1 from public.leave_policies p where p.id = policy_id and p.company_id = current_user_company_id()
    ))
  );
create policy "leave_probation_rules_insert_scoped" on public.leave_probation_rules for insert with check (is_super_admin());
create policy "leave_probation_rules_update_scoped" on public.leave_probation_rules for update using (is_super_admin());
create policy "leave_probation_rules_delete_scoped" on public.leave_probation_rules for delete using (is_super_admin());

create policy "leave_pro_rata_rules_select_scoped" on public.leave_pro_rata_rules for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and exists (
      select 1 from public.leave_policy_type_configs c
      join public.leave_policies p on p.id = c.policy_id
      where c.id = policy_type_config_id and p.company_id = current_user_company_id()
    ))
  );
create policy "leave_pro_rata_rules_insert_scoped" on public.leave_pro_rata_rules for insert with check (is_super_admin());
create policy "leave_pro_rata_rules_update_scoped" on public.leave_pro_rata_rules for update using (is_super_admin());
create policy "leave_pro_rata_rules_delete_scoped" on public.leave_pro_rata_rules for delete using (is_super_admin());

create trigger trg_leave_accrual_periods_set_updated_at before update on public.leave_accrual_periods for each row execute function public.set_updated_at();
create trigger trg_leave_accrual_periods_audit after insert or update or delete on public.leave_accrual_periods for each row execute function public.write_audit_log();

create trigger trg_leave_probation_rules_set_updated_at before update on public.leave_probation_rules for each row execute function public.set_updated_at();
create trigger trg_leave_probation_rules_audit after insert or update or delete on public.leave_probation_rules for each row execute function public.write_audit_log();

create trigger trg_leave_pro_rata_rules_set_updated_at before update on public.leave_pro_rata_rules for each row execute function public.set_updated_at();
create trigger trg_leave_pro_rata_rules_audit after insert or update or delete on public.leave_pro_rata_rules for each row execute function public.write_audit_log();
