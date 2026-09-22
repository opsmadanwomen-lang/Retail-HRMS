-- ============================================================================
-- Retail HRMS — Night Duty two-tier approval: Operations Manager -> Super
-- Manager (replaces the Super-Admin-only routing from migration 0045)
-- Migration 0047
--
-- WHY: Night Duty approval must go to the Operations Manager(s) assigned to
-- the employee's store first; the OM can Approve, Disallow, or Carry Forward
-- to a Super Manager, who then makes the FINAL decision. Neither role exists
-- in the app_role enum (still just super_admin/company_admin/staff) and no
-- Role & Permission Management system exists yet — per explicit instruction
-- this migration does NOT build that system. Instead it adds two small,
-- purpose-scoped assignment tables (OM<->Store, Super Manager designation)
-- that only govern Night Duty approval routing, managed by Super Admin (who
-- already manages every other configuration table in this app) until a real
-- Role & Permission system replaces this later.
--
-- STATE MACHINE (attendance_night_duty_approvals.approval_status):
--   pending_om -> om_approved                      (FINAL)
--   pending_om -> om_disallowed                    (FINAL, requires payable-out time)
--   pending_om -> pending_super_manager             (OM carried forward, not final)
--   pending_super_manager -> super_manager_approved (FINAL)
--   pending_super_manager -> super_manager_disallowed (FINAL, requires payable-out time)
-- The OLD 3-value set ('pending'/'approved'/'disallowed') is kept in the
-- CHECK constraint alongside the 6 new values purely so the existing
-- Super-Admin-only attendance_night_duty_decide() RPC (migration 0045) keeps
-- working as an emergency/administrative fallback — it is no longer used by
-- the normal UI, which now goes through the OM/Super Manager RPCs below, but
-- nothing about it is removed, per "Super Admin may have emergency
-- administrative access if the existing security model supports it."
-- No existing row is touched — the table has zero real rows today (verified).
-- ============================================================================

create table if not exists public.attendance_operations_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  is_active boolean not null default true,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, store_id)
);

create index if not exists idx_om_assignments_store on public.attendance_operations_manager_assignments (store_id, is_active);
create index if not exists idx_om_assignments_employee on public.attendance_operations_manager_assignments (employee_id, is_active);

create table if not exists public.attendance_super_managers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  is_active boolean not null default true,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id)
);

create index if not exists idx_super_managers_company on public.attendance_super_managers (company_id, is_active);

alter table public.attendance_operations_manager_assignments enable row level security;
alter table public.attendance_super_managers enable row level security;

-- Select: Super Admin + any non-staff same-company user (so OMs/Super Managers/Company Admin can
-- see the roster); staff excluded. Write: Super Admin only — matches every other config table.
do $$
declare
  t text;
begin
  for t in select unnest(array['attendance_operations_manager_assignments', 'attendance_super_managers'])
  loop
    execute format($f$create policy "%1$s_select_scoped" on public.%1$s for select
      using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$f$, t);
    execute format($f$create policy "%1$s_write_scoped" on public.%1$s for insert with check (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_update_scoped" on public.%1$s for update using (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_delete_scoped" on public.%1$s for delete using (is_super_admin());$f$, t);
    execute format('create trigger trg_%1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at();', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function public.write_audit_log();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Extend attendance_night_duty_approvals with store routing + full OM/Super
-- Manager action history. Additive only.
-- ---------------------------------------------------------------------------
alter table public.attendance_night_duty_approvals
  add column if not exists store_id uuid references public.stores (id) on delete set null,
  add column if not exists om_id uuid references public.employees (id) on delete set null,
  add column if not exists om_action text check (om_action is null or om_action in ('approved', 'disallowed', 'carried_forward')),
  add column if not exists om_acted_at timestamptz,
  add column if not exists om_remark text,
  add column if not exists super_manager_id uuid references public.employees (id) on delete set null,
  add column if not exists super_manager_action text check (super_manager_action is null or super_manager_action in ('approved', 'disallowed')),
  add column if not exists super_manager_acted_at timestamptz,
  add column if not exists super_manager_remark text;

alter table public.attendance_night_duty_approvals drop constraint if exists attendance_night_duty_approvals_approval_status_check;
alter table public.attendance_night_duty_approvals add constraint attendance_night_duty_approvals_approval_status_check
  check (approval_status in (
    'pending', 'approved', 'disallowed', -- legacy values, kept only for the emergency admin RPC
    'pending_om', 'om_approved', 'om_disallowed',
    'pending_super_manager', 'super_manager_approved', 'super_manager_disallowed'
  ));

alter table public.attendance_night_duty_approvals drop constraint if exists attendance_night_duty_approvals_manager_confirmed_out_check;
alter table public.attendance_night_duty_approvals add constraint attendance_night_duty_approvals_manager_confirmed_out_check
  check (approval_status not in ('disallowed', 'om_disallowed', 'super_manager_disallowed') or manager_confirmed_payable_out_at is not null);

create index if not exists idx_night_duty_approvals_status_store on public.attendance_night_duty_approvals (approval_status, store_id);
