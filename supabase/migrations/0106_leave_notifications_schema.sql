-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: Notifications — schema
-- Migration 0106
--
-- SCOPE DECISION (confirmed with the user): NO notification infrastructure of
-- any kind exists anywhere in this codebase (confirmed by audit — no table,
-- no email/SMS/push integration, unchanged since the original Phase 0
-- audit). Building a minimal, real In-App notification system now (table +
-- RLS + delivery from the Leave RPCs); Email/SMS/Push are configurable
-- per-event toggles that are stored and shown in the Admin UI but never
-- fabricated as delivering anything — see leave_notification_settings below.
-- ============================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  recipient_employee_id uuid not null references public.employees (id) on delete cascade,
  event_type text not null,
  title text not null,
  body text,
  related_table text,
  related_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient on public.notifications (recipient_employee_id, created_at desc);

alter table public.notifications enable row level security;

-- Staff: own notifications only. Any non-staff role (company admin/super admin) may also see
-- company-wide, purely for support/oversight — never a substitute for "own only" for staff.
create policy "notifications_select_scoped" on public.notifications for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (recipient_employee_id = current_user_employee_id())
  );

-- Marking as read is the one thing a recipient does themselves — allowed only on their own rows,
-- and only the is_read flag matters (no other column should ever be touched here).
create policy "notifications_update_own_read_state" on public.notifications for update
  using (recipient_employee_id = current_user_employee_id())
  with check (recipient_employee_id = current_user_employee_id());

-- All inserts happen via SECURITY DEFINER RPCs (leave_notify(), called from inside leave_apply()/
-- leave_manager_decide()/etc.), which bypass RLS for their own writes like every other RPC in this
-- codebase — direct client inserts are never permitted.
create policy "notifications_insert_scoped" on public.notifications for insert with check (is_super_admin());

-- ----------------------------------------------------------------------------
-- leave_notification_settings — per company, per event, which channels are
-- configured. Only in_app_enabled ever actually causes a notifications row
-- to be written (see leave_notify() in the next migration) — the other three
-- are genuine configuration switches with NO delivery implementation behind
-- them yet, and the Admin UI must show them as "Not Configured" rather than
-- implying they work.
-- ----------------------------------------------------------------------------
create table if not exists public.leave_notification_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  event_type text not null,
  in_app_enabled boolean not null default true,
  push_enabled boolean not null default false,
  email_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, event_type)
);

alter table public.leave_notification_settings enable row level security;
create policy "leave_notification_settings_select_scoped" on public.leave_notification_settings for select
  using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));
create policy "leave_notification_settings_write_scoped" on public.leave_notification_settings for insert with check (is_super_admin());
create policy "leave_notification_settings_update_scoped" on public.leave_notification_settings for update using (is_super_admin());

create trigger trg_leave_notification_settings_audit after insert or update on public.leave_notification_settings for each row execute function public.write_audit_log();
