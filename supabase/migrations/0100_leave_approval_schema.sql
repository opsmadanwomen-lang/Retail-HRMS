-- ============================================================================
-- Retail HRMS — Leave Management, Phase 3: Approval schema
-- Migration 0100
--
-- ARCHITECTURE REUSED FROM NIGHT DUTY (inspected live before writing this —
-- attendance_night_duty_om_decide()/_super_manager_decide(), migrations
-- 0047/0049): active-login check, current_user_employee_id() identity,
-- atomic `UPDATE ... WHERE id = X AND status = <expected>` + row-count check
-- to make duplicate/race decisions fail safely, self-action prevention,
-- authorization resolved from a real database relationship (never a client
-- parameter), and the exact same 5-clause RLS shape (super admin / company
-- non-staff / self / manager-of / super-manager-of). Night Duty's OWN table,
-- RPCs, and business rules are NOT touched anywhere in this migration —
-- Leave gets entirely its own approval-history table, per the explicit
-- instruction not to reuse Night Duty's table for Leave.
--
-- STATUS MODEL: Phase 2's single 'pending' status is replaced with
-- 'manager_pending' / 'super_manager_pending' (Direct Manager is ALWAYS the
-- first step regardless of duration — only whether a second step exists
-- differs). Safe to ALTER in place: no real employee has ever applied for
-- leave yet (confirmed live before writing this), so there is no historical
-- 'pending' row this would need to migrate.
--
-- leave_approval_actions: a NEW, INSERT-ONLY table — one row per decision,
-- never updated/overwritten, giving the exact "Step 1: Direct Manager
-- Approved / Step 2: Super Manager Approved" history the approved plan's own
-- example describes. Modeled on the SHAPE of Night Duty's om_/super_manager_
-- decision columns, but as its own proper table rather than columns bolted
-- onto leave_applications, so a future third approval level never needs a
-- schema change.
--
-- APPROVER RESOLUTION: Direct Manager = employees.reporting_manager_id (the
-- EXISTING relationship, already used by employeeService.listDirectReports()
-- — no new table). Super Manager = the EXISTING attendance_super_managers
-- table, the exact same authoritative source Night Duty already uses — not
-- re-resolved into a new table, not duplicated.
-- ============================================================================

alter table public.leave_applications drop constraint if exists leave_applications_status_check;
alter table public.leave_applications add constraint leave_applications_status_check
  check (status in ('manager_pending', 'super_manager_pending', 'approved', 'rejected', 'cancelled'));

create table if not exists public.leave_approval_actions (
  id uuid primary key default gen_random_uuid(),
  leave_application_id uuid not null references public.leave_applications (id) on delete cascade,
  step_order int not null check (step_order in (1, 2)),
  approver_role text not null check (approver_role in ('direct_manager', 'super_manager')),
  approver_employee_id uuid not null references public.employees (id),
  action text not null check (action in ('approved', 'rejected')),
  remark text,
  acted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_leave_approval_actions_application on public.leave_approval_actions (leave_application_id);

alter table public.leave_approval_actions enable row level security;

-- Same visibility as leave_applications itself (see policy below) — anyone who can see the
-- application can see its full approval history; nobody can write to this table directly (all
-- rows are inserted only by the SECURITY DEFINER decide RPCs below).
create policy "leave_approval_actions_select_scoped" on public.leave_approval_actions for select
  using (
    exists (
      select 1 from public.leave_applications a
      where a.id = leave_application_id
        and (
          public.is_super_admin()
          or (public.current_user_role() <> 'staff' and a.company_id = public.current_user_company_id())
          or (public.current_user_role() = 'staff' and a.employee_id = public.current_user_employee_id())
          or (public.current_user_role() = 'staff' and exists (
            select 1 from public.employees e where e.id = a.employee_id and e.reporting_manager_id = public.current_user_employee_id()
          ))
          or (public.current_user_role() = 'staff' and exists (
            select 1 from public.attendance_super_managers sm where sm.employee_id = public.current_user_employee_id() and sm.is_active and sm.company_id = a.company_id
          ))
        )
    )
  );
create policy "leave_approval_actions_insert_scoped" on public.leave_approval_actions for insert with check (public.is_super_admin());

create trigger trg_leave_approval_actions_audit after insert on public.leave_approval_actions for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- Extend leave_applications/leave_application_documents RLS to give Direct
-- Managers and Super Managers visibility of applications requiring their
-- action — the exact same additional-clause pattern as
-- attendance_night_duty_approvals_select_scoped (inspected live above).
-- Nothing about the Staff-self or company-admin clauses changes.
-- ----------------------------------------------------------------------------

drop policy if exists "leave_applications_select_scoped" on public.leave_applications;
create policy "leave_applications_select_scoped" on public.leave_applications for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
    or (current_user_role() = 'staff' and exists (
      select 1 from public.employees e where e.id = leave_applications.employee_id and e.reporting_manager_id = current_user_employee_id()
    ))
    or (current_user_role() = 'staff' and exists (
      select 1 from public.attendance_super_managers sm where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = leave_applications.company_id
    ))
  );

drop policy if exists "leave_application_documents_select_scoped" on public.leave_application_documents;
create policy "leave_application_documents_select_scoped" on public.leave_application_documents for select
  using (
    is_super_admin()
    or exists (
      select 1 from public.leave_applications a
      where a.id = leave_application_id
        and (
          (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or (current_user_role() = 'staff' and a.employee_id = current_user_employee_id())
          or (current_user_role() = 'staff' and exists (
            select 1 from public.employees e where e.id = a.employee_id and e.reporting_manager_id = current_user_employee_id()
          ))
          or (current_user_role() = 'staff' and exists (
            select 1 from public.attendance_super_managers sm where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = a.company_id
          ))
        )
    )
  );

-- ----------------------------------------------------------------------------
-- Resolver helpers — pure reads, no business decision, reused by leave_apply()
-- and both decide RPCs (migration 0101) so the resolution logic exists in
-- exactly one place.
-- ----------------------------------------------------------------------------

create or replace function public.leave_resolve_direct_manager(p_employee_id uuid)
returns uuid
language sql
stable
security definer
as $$
  select m.id
  from public.employees e
  join public.employees m on m.id = e.reporting_manager_id
  where e.id = p_employee_id and m.status = 'active';
$$;

grant execute on function public.leave_resolve_direct_manager(uuid) to authenticated;

create or replace function public.leave_active_super_manager_exists(p_company_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (select 1 from public.attendance_super_managers where company_id = p_company_id and is_active);
$$;

grant execute on function public.leave_active_super_manager_exists(uuid) to authenticated;
