-- ============================================================================
-- Retail HRMS — Leave Management, Phase 1: Leave Type Master
-- Migration 0089
--
-- Leave Type Master (§7 of the approved plan) — the STABLE identity of a leave
-- type (name/code/paid-unpaid/unit granularity). Deliberately lean: numeric,
-- FY-versioned rule values (accrual amounts, carry-forward limits, etc.) live
-- one level down in leave_policy_type_configs (migration 0090), never here —
-- this is the split explicitly called out in the approved Phase 0 audit so
-- that "historical calculations must never change" (§40) holds structurally:
-- a leave type's NAME doesn't change per FY, but its accrual RATE does.
--
-- Same conventions as every existing rule table (see 0088's header note).
-- ============================================================================

create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  is_paid boolean not null default true,
  half_day_allowed boolean not null default true,
  quarter_day_allowed boolean not null default false,
  -- Smallest applicable unit, in days -- 1, 0.5, 0.25, or any custom fraction HR configures.
  minimum_unit numeric not null default 1 check (minimum_unit > 0 and minimum_unit <= 1),
  document_required boolean not null default false,
  requires_reason boolean not null default true,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists idx_leave_types_company on public.leave_types (company_id);

alter table public.leave_types enable row level security;

create policy "leave_types_select_scoped" on public.leave_types for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "leave_types_insert_scoped" on public.leave_types for insert
  with check (is_super_admin());
create policy "leave_types_update_scoped" on public.leave_types for update
  using (is_super_admin());
create policy "leave_types_delete_scoped" on public.leave_types for delete
  using (is_super_admin());

create trigger trg_leave_types_set_updated_at before update on public.leave_types
  for each row execute function public.set_updated_at();
create trigger trg_leave_types_audit after insert or update or delete on public.leave_types
  for each row execute function public.write_audit_log();
