-- ============================================================================
-- Retail HRMS — Configurable Late Rule & Overtime Rule Management
-- Migration 0038
--
-- ARCHITECTURE DECISION (per explicit request to resolve, not duplicate, the
-- Shift vs Rule overlap):
--   SHIFT (attendance_shifts) stays the SOLE authority for TIMING:
--     start_time, end_time, break_minutes, grace_minutes, minimum_work_minutes
--     (Required Working Hours), overtime_enabled (structural OT eligibility gate).
--   RULE (this migration) is the SOLE authority for POLICY — how a raw
--     lateness/overtime figure derived from the shift gets COUNTED:
--     calculation method (exact vs slab), rounding, min/max clamps, and (for
--     overtime only) which day-types are OT-eligible.
--   Grace Period and Required Working Hours are deliberately NOT duplicated
--   here — they remain single-sourced on attendance_shifts, exactly as before.
--   This keeps exactly one place that can say "Grace = 10" and one place that
--   can say "OT is structurally on/off for this shift".
--
-- VERSIONING: a rule "changing" is modeled the same non-destructive way as
-- employee_shift_assignments / employee_weekly_off_history — editing closes
-- the current open-ended row (effective_to = day before) and inserts a new
-- row with the same rule_code and the new effective_from. rule_code is the
-- stable identity across versions; a rule's history is just every row that
-- shares its rule_code, ordered by effective_from. No separate history table
-- is needed — attendance_records.late_rule_id/overtime_rule_id (added below)
-- point at the EXACT versioned row that was active when a record was
-- calculated, so historical attendance can always be traced back to the
-- precise rule configuration used, even after the rule is edited again later.
--
-- BACKWARD COMPATIBILITY: every calculation helper function added here
-- returns the CURRENT hard-coded behaviour unchanged when no rule is
-- resolved/assigned (rule_id IS NULL) — no company has any rule configured
-- yet, so nothing changes until Super Admin explicitly creates and assigns
-- one. See migration 0039 for the calculation functions and RPC wiring.
-- ============================================================================

create table if not exists public.attendance_late_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  rule_code text not null,
  rule_name text not null,
  description text,
  calculation_method text not null default 'exact' check (calculation_method in ('exact', 'slab')),
  rounding_method text not null default 'exact'
    check (rounding_method in ('exact', 'round_down', 'round_up', 'nearest_5', 'nearest_10', 'nearest_15', 'nearest_30', 'custom')),
  custom_rounding_minutes int check (custom_rounding_minutes is null or custom_rounding_minutes > 0),
  -- Final clamp applied after slab + rounding. minimum_late_minutes defaults to 0, which is a
  -- no-op floor matching today's greatest(0, ...) behaviour; maximum_late_minutes is an optional cap.
  minimum_late_minutes int not null default 0,
  maximum_late_minutes int,
  is_active boolean not null default true,
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_attendance_late_rules_company on public.attendance_late_rules (company_id);
create index if not exists idx_attendance_late_rules_code on public.attendance_late_rules (company_id, rule_code);
create index if not exists idx_attendance_late_rules_effective on public.attendance_late_rules (company_id, effective_from, effective_to);

create table if not exists public.attendance_late_rule_thresholds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  late_rule_id uuid not null references public.attendance_late_rules (id) on delete cascade,
  from_minutes int not null,
  to_minutes int, -- null = unbounded upper ("and above")
  calculated_minutes int not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (to_minutes is null or to_minutes >= from_minutes)
);

create index if not exists idx_attendance_late_rule_thresholds_rule on public.attendance_late_rule_thresholds (late_rule_id, sort_order);

create table if not exists public.attendance_overtime_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  rule_code text not null,
  rule_name text not null,
  description text,
  calculation_method text not null default 'exact' check (calculation_method in ('exact', 'slab')),
  -- OT below this is not counted at all (0). Distinct from Shift.minimum_work_minutes (Required
  -- Working Hours, which decides where "raw OT" starts) — this is the POLICY threshold on top of it.
  minimum_overtime_minutes int not null default 0,
  maximum_overtime_minutes int,
  rounding_method text not null default 'exact'
    check (rounding_method in ('exact', 'round_down', 'round_up', 'nearest_5', 'nearest_10', 'nearest_15', 'nearest_30', 'custom')),
  custom_rounding_minutes int check (custom_rounding_minutes is null or custom_rounding_minutes > 0),
  weekly_off_overtime_allowed boolean not null default true,
  holiday_overtime_allowed boolean not null default true,
  leave_overtime_allowed boolean not null default false,
  is_active boolean not null default true,
  effective_from date not null,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_attendance_overtime_rules_company on public.attendance_overtime_rules (company_id);
create index if not exists idx_attendance_overtime_rules_code on public.attendance_overtime_rules (company_id, rule_code);
create index if not exists idx_attendance_overtime_rules_effective on public.attendance_overtime_rules (company_id, effective_from, effective_to);

create table if not exists public.attendance_overtime_rule_thresholds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  overtime_rule_id uuid not null references public.attendance_overtime_rules (id) on delete cascade,
  from_minutes int not null,
  to_minutes int,
  calculated_minutes int not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (to_minutes is null or to_minutes >= from_minutes)
);

create index if not exists idx_attendance_overtime_rule_thresholds_rule on public.attendance_overtime_rule_thresholds (overtime_rule_id, sort_order);

-- Rule assignment: WHICH rule applies to an employee/shift/store/company-default, with priority
-- Employee > Shift > Store > Company (resolved by the functions in migration 0039). scope_id is
-- polymorphic (employees.id / attendance_shifts.id / stores.id / null for company) so it is not a
-- single FK — validated at the service layer, matching how employee_shift_assignments already
-- validates shift_id relationships in application code rather than a cross-table DB constraint.
create table if not exists public.attendance_rule_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  scope_type text not null check (scope_type in ('employee', 'shift', 'store', 'company')),
  scope_id uuid, -- null iff scope_type = 'company'
  late_rule_id uuid references public.attendance_late_rules (id) on delete set null,
  overtime_rule_id uuid references public.attendance_overtime_rules (id) on delete set null,
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope_type = 'company') = (scope_id is null)),
  check (late_rule_id is not null or overtime_rule_id is not null)
);

create index if not exists idx_attendance_rule_assignments_lookup
  on public.attendance_rule_assignments (company_id, scope_type, scope_id, effective_from, effective_to);

alter table public.attendance_late_rules enable row level security;
alter table public.attendance_late_rule_thresholds enable row level security;
alter table public.attendance_overtime_rules enable row level security;
alter table public.attendance_overtime_rule_thresholds enable row level security;
alter table public.attendance_rule_assignments enable row level security;

-- SELECT: visible to Super Admin and any non-staff user of the same company (Company Admin can
-- VIEW rules — nothing in the spec forbids that — but never write them, matching the pattern
-- already used for shift/weekly-off tables). Staff never sees rule configuration at all.
-- WRITE (insert/update/delete): Super Admin ONLY — stricter than the shift/weekly-off pattern,
-- per this feature's explicit "only Super Admin, enforced at RLS level" requirement.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'attendance_late_rules',
    'attendance_late_rule_thresholds',
    'attendance_overtime_rules',
    'attendance_overtime_rule_thresholds',
    'attendance_rule_assignments'
  ])
  loop
    execute format($f$
      create policy "%1$s_select_scoped" on public.%1$s for select
        using (
          public.is_super_admin()
          or (public.current_user_role() <> 'staff' and company_id = public.current_user_company_id())
        );
    $f$, t);

    execute format($f$
      create policy "%1$s_write_scoped" on public.%1$s for insert
        with check (public.is_super_admin());
    $f$, t);

    execute format($f$
      create policy "%1$s_update_scoped" on public.%1$s for update
        using (public.is_super_admin());
    $f$, t);

    execute format($f$
      create policy "%1$s_delete_scoped" on public.%1$s for delete
        using (public.is_super_admin());
    $f$, t);

    execute format(
      'create trigger trg_%1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at();',
      t
    );

    execute format(
      'create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function public.write_audit_log();',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- attendance_records must be able to remember exactly which rule VERSION
-- calculated it (section 15) — nullable/additive, existing rows are untouched
-- (NULL means "calculated before the rule system existed", which is accurate).
-- ---------------------------------------------------------------------------
alter table public.attendance_records
  add column if not exists late_rule_id uuid references public.attendance_late_rules (id) on delete set null,
  add column if not exists overtime_rule_id uuid references public.attendance_overtime_rules (id) on delete set null;
