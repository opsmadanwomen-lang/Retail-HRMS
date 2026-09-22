-- ============================================================================
-- Retail HRMS — Information / Penalty / Half-Day / Early-Going / Extended-Duty
-- / Night-Duty-Approval rule tables
-- Migration 0042
--
-- ARCHITECTURE: unlike Late Rule / Overtime Rule (which support a 4-level
-- Employee>Shift>Store>Company assignment hierarchy via attendance_rule_
-- assignments), these six new rule types are COMPANY-WIDE ONLY, versioned the
-- identical way (close-old-open-new sharing a rule_code where relevant, or a
-- single "current row" per company for the singleton configs) — an explicit,
-- approved simplification: this business policy is store/company-wide, not
-- per-employee/shift/store variable. The existing Late/Overtime assignment
-- hierarchy is completely untouched by this migration.
--
-- All tables: RLS write = is_super_admin() only, select = non-staff same
-- company (Company Admin can view, not modify — same pattern as every other
-- rule table). Generic write_audit_log() trigger reused, not duplicated.
-- ============================================================================

create table if not exists public.attendance_information_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  monthly_limit int not null default 2,
  cutoff_time time not null default '12:00:00',
  applicable_on_weekly_off boolean not null default true,
  is_active boolean not null default true,
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_penalty_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  method text not null default 'none'
    check (method in ('none', 'actual', 'double', '1.5x', '2x', 'fixed', 'slab', 'custom_multiplier', 'custom_fixed')),
  fixed_minutes int,
  multiplier numeric,
  applicability text not null default 'after_information_exhausted'
    check (applicability in ('every_late', 'after_information_exhausted', 'normal_day_only', 'information_day_after_cutoff', 'weekly_off', 'half_day', 'other')),
  is_active boolean not null default true,
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_penalty_rule_thresholds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  penalty_rule_id uuid not null references public.attendance_penalty_rules (id) on delete cascade,
  from_minutes int not null,
  to_minutes int,
  calculated_minutes int not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (to_minutes is null or to_minutes >= from_minutes)
);

create table if not exists public.attendance_half_day_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  late_arrival_cutoff_time time not null default '14:00:00',
  early_going_cutoff_time time not null default '16:00:00',
  is_active boolean not null default true,
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_early_going_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  grace_minutes int not null default 0,
  calculation_method text not null default 'exact' check (calculation_method in ('exact', 'slab')),
  rounding_method text not null default 'exact'
    check (rounding_method in ('exact', 'round_down', 'round_up', 'nearest_5', 'nearest_10', 'nearest_15', 'nearest_30', 'custom')),
  custom_rounding_minutes int,
  is_active boolean not null default true,
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_early_going_rule_thresholds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  early_going_rule_id uuid not null references public.attendance_early_going_rules (id) on delete cascade,
  from_minutes int not null,
  to_minutes int,
  calculated_minutes int not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (to_minutes is null or to_minutes >= from_minutes)
);

-- Extended Duty ladder: Midnight Threshold -> Midnight Extra Duty, First Day Salary Threshold ->
-- First Day Extra Duty, Second Day Salary Threshold -> Second Day Extra Duty, with hourly OT
-- accruing within [midnight_threshold, first_day_threshold) and [first_day_threshold,
-- second_day_threshold) only — never before midnight_threshold (that span is Normal OT's,
-- computed in the RPC layer, capped at this same midnight_threshold so the two never overlap).
create table if not exists public.attendance_extended_duty_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  midnight_threshold_time time not null default '00:00:00',
  midnight_extra_duty_value numeric not null default 0.5,
  first_day_salary_threshold_time time not null default '02:00:00',
  first_day_extra_duty_value numeric not null default 1.0,
  second_day_salary_threshold_time time not null default '08:00:00',
  second_day_extra_duty_value numeric not null default 2.0,
  hourly_ot_rounding_method text not null default 'exact'
    check (hourly_ot_rounding_method in ('exact', 'round_down', 'round_up', 'nearest_5', 'nearest_10', 'nearest_15', 'nearest_30', 'custom')),
  hourly_ot_custom_rounding_minutes int,
  is_active boolean not null default true,
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (first_day_salary_threshold_time > midnight_threshold_time),
  check (second_day_salary_threshold_time > first_day_salary_threshold_time)
);

-- Approver is hard-coded to Super Admin at the RPC level (attendance_night_duty_decide, migration
-- 0045) per explicit decision — this config table does not have an "approver role" field because
-- there is no Store Manager / Role & Permission system yet to select one from.
create table if not exists public.attendance_night_duty_approval_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  approval_required boolean not null default true,
  allow_payable_out_override boolean not null default true,
  is_active boolean not null default true,
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per Information/Intimation USE — "remaining" is always derived as
-- (monthly_limit - count of rows this employee/month), never stored as a separate mutable
-- counter, so there is exactly one source of truth.
create table if not exists public.employee_information_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  attendance_date date not null,
  used_by uuid,
  remark text,
  created_at timestamptz not null default now(),
  unique (employee_id, attendance_date)
);

create index if not exists idx_employee_information_usage_employee_month
  on public.employee_information_usage (employee_id, attendance_date);

-- Non-destructive Night Duty approval record. The actual punch (attendance_records.punch_out_at)
-- is NEVER modified by an approval decision — manager_confirmed_payable_out_at is a separate
-- field payroll must use instead of the actual time when approval_status = 'disallowed'.
create table if not exists public.attendance_night_duty_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  attendance_record_id uuid not null references public.attendance_records (id) on delete cascade,
  attendance_date date not null,
  shift_end_at timestamptz,
  actual_punch_out_at timestamptz not null,
  extra_duty_value numeric not null default 0,
  night_ot_minutes int not null default 0,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'disallowed')),
  manager_confirmed_payable_out_at timestamptz,
  manager_remark text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attendance_record_id),
  check (approval_status <> 'disallowed' or manager_confirmed_payable_out_at is not null)
);

create index if not exists idx_night_duty_approvals_employee on public.attendance_night_duty_approvals (employee_id, attendance_date);
create index if not exists idx_night_duty_approvals_status on public.attendance_night_duty_approvals (company_id, approval_status);

alter table public.attendance_information_rules enable row level security;
alter table public.attendance_penalty_rules enable row level security;
alter table public.attendance_penalty_rule_thresholds enable row level security;
alter table public.attendance_half_day_rules enable row level security;
alter table public.attendance_early_going_rules enable row level security;
alter table public.attendance_early_going_rule_thresholds enable row level security;
alter table public.attendance_extended_duty_rules enable row level security;
alter table public.attendance_night_duty_approval_config enable row level security;
alter table public.employee_information_usage enable row level security;
alter table public.attendance_night_duty_approvals enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'attendance_information_rules',
    'attendance_penalty_rules',
    'attendance_penalty_rule_thresholds',
    'attendance_half_day_rules',
    'attendance_early_going_rules',
    'attendance_early_going_rule_thresholds',
    'attendance_extended_duty_rules',
    'attendance_night_duty_approval_config'
  ])
  loop
    -- Rule config tables: Super Admin write-only, non-staff view (identical to Late/Overtime Rules)
    execute format($f$create policy "%1$s_select_scoped" on public.%1$s for select
      using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$f$, t);
    execute format($f$create policy "%1$s_write_scoped" on public.%1$s for insert with check (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_update_scoped" on public.%1$s for update using (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_delete_scoped" on public.%1$s for delete using (is_super_admin());$f$, t);
    execute format('create trigger trg_%1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at();', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function public.write_audit_log();', t);
  end loop;
end $$;

-- employee_information_usage: Staff can see their OWN usage rows (own history/remaining count);
-- non-staff sees the whole company; writes are Super-Admin-only via RPC (SECURITY DEFINER bypasses
-- RLS for the self-service "use Information" path inside attendance_punch_in()).
create policy "employee_information_usage_select_scoped" on public.employee_information_usage for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
  );
create policy "employee_information_usage_write_scoped" on public.employee_information_usage for insert with check (is_super_admin());
create policy "employee_information_usage_delete_scoped" on public.employee_information_usage for delete using (is_super_admin());
create trigger trg_employee_information_usage_audit after insert or update or delete on public.employee_information_usage for each row execute function public.write_audit_log();

-- attendance_night_duty_approvals: staff can see their OWN approval status (Part 24/29); only
-- Super Admin can write (both the auto-creation at punch-out and the approve/disallow decision run
-- through SECURITY DEFINER RPCs, which bypass RLS regardless of these policies).
create policy "attendance_night_duty_approvals_select_scoped" on public.attendance_night_duty_approvals for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
  );
create policy "attendance_night_duty_approvals_write_scoped" on public.attendance_night_duty_approvals for insert with check (is_super_admin());
create policy "attendance_night_duty_approvals_update_scoped" on public.attendance_night_duty_approvals for update using (is_super_admin());
create trigger trg_night_duty_approvals_set_updated_at before update on public.attendance_night_duty_approvals for each row execute function public.set_updated_at();
create trigger trg_night_duty_approvals_audit after insert or update or delete on public.attendance_night_duty_approvals for each row execute function public.write_audit_log();
