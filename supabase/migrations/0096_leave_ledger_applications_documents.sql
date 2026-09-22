-- ============================================================================
-- Retail HRMS — Leave Management, Phase 2: Ledger, Applications, Documents
-- Migration 0096
--
-- LEAVE LEDGER: pure append-only event log — the ONE source of truth for
-- balance (§15/§17 of the master prompts / §18 of the approved plan).
-- Available = SUM(days) for an employee+leave_type+financial_year, computed
-- fresh every time by leave_get_balance() (migration 0097), never a stored
-- mutable counter. No UPDATE, no DELETE -- RLS below permits neither, for
-- anyone, including Super Admin (a genuine mistake is corrected with a new
-- offsetting 'reversal'/'adjustment' row, per the explicit "never delete
-- historical ledger transactions" rule -- this is enforced at the RLS layer,
-- not just by convention).
--
-- LEAVE APPLICATIONS: its own table, NOT the Night Duty approvals table
-- (explicitly instructed not to reuse it) -- but modeled on the SAME
-- architecture pattern already proven there: a request row + a status
-- column + (in Phase 3) a decision-log table analogous to
-- attendance_night_duty_approvals' own OM/SM decision fields. Phase 2 keeps
-- status intentionally simple (pending/approved/rejected/cancelled) since
-- the real Manager->Super Manager workflow is explicitly Phase 3's job --
-- current_step/short_or_long are already stored now so Phase 3 can extend
-- status handling without an application-table redesign.
--
-- LEAVE APPLICATION DOCUMENTS: a NEW table + NEW storage bucket
-- (leave-documents), deliberately NOT the employee_documents table -- see
-- migration 0090's own header note (Phase 0 architecture decision):
-- employee_documents means "this employee's one master-record document per
-- type" (Aadhaar, PAN), a fundamentally different shape than "an arbitrary
-- attachment for one specific leave request". Reuses the EXACT SAME pattern
-- (private bucket + company/employee-folder RLS + signed URL access) as
-- employee_documents, never a new storage paradigm.
-- ============================================================================

create table if not exists public.leave_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  financial_year_id uuid not null references public.leave_financial_years (id) on delete cascade,
  transaction_type text not null check (transaction_type in (
    'opening', 'accrual', 'used', 'pending_reservation', 'carry_forward', 'adjustment',
    'reversal', 'lwp_conversion', 'closing'
  )),
  transaction_date date not null,
  -- Signed: positive credits the balance (opening/accrual/carry_forward/reversal-of-a-debit),
  -- negative debits it (used/pending_reservation/lwp_conversion). Supports fractional days
  -- (0.5/0.25) per the Leave Type's own minimum_unit.
  days numeric not null,
  reference_type text,
  reference_id uuid,
  remark text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_leave_ledger_balance_lookup
  on public.leave_ledger (employee_id, leave_type_id, financial_year_id);
create index if not exists idx_leave_ledger_reference on public.leave_ledger (reference_type, reference_id);
create index if not exists idx_leave_ledger_company on public.leave_ledger (company_id);

create table if not exists public.leave_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  financial_year_id uuid not null references public.leave_financial_years (id) on delete cascade,
  policy_id uuid not null references public.leave_policies (id) on delete cascade,
  from_date date not null,
  to_date date not null,
  is_half_day boolean not null default false,
  half_day_session text check (half_day_session in ('first_half', 'second_half')),
  -- Computed by leave_compute_total_days() at application time -- never trusted from the client.
  total_days numeric not null,
  reason text,
  remarks text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- Resolved once at application time from leave_short_long_rules -- snapshotted so a later
  -- threshold change never reclassifies a historical application (mirrors the ledger's own
  -- historical-immutability principle).
  short_or_long text check (short_or_long in ('short', 'long')),
  -- Reserved for Phase 3's multi-step workflow -- always 0 in Phase 2 (no step engine runs yet).
  current_step int not null default 0,
  applied_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (to_date >= from_date),
  check (not is_half_day or from_date = to_date)
);

create index if not exists idx_leave_applications_employee on public.leave_applications (employee_id);
create index if not exists idx_leave_applications_company on public.leave_applications (company_id);
create index if not exists idx_leave_applications_status on public.leave_applications (status);
-- Overlap/duplicate detection (§19) queries by employee + date range + non-terminal status.
create index if not exists idx_leave_applications_overlap on public.leave_applications (employee_id, from_date, to_date) where status in ('pending', 'approved');

create table if not exists public.leave_application_documents (
  id uuid primary key default gen_random_uuid(),
  leave_application_id uuid not null references public.leave_applications (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_leave_application_documents_application on public.leave_application_documents (leave_application_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.leave_ledger enable row level security;
alter table public.leave_applications enable row level security;
alter table public.leave_application_documents enable row level security;

-- LEDGER: Staff sees only their OWN rows (resolved via the SAME employees.auth_user_id = auth.uid()
-- identity check every other Staff-scoped table in this project already uses); non-staff sees the
-- whole company. INSERT is Super-Admin-only at the RLS layer (the real writer is always the
-- SECURITY DEFINER leave_apply()/leave_decide()/leave_cancel() RPCs, which run as the function
-- owner and bypass RLS regardless -- this policy is defense-in-depth against any accidental direct
-- table write). NO update or delete policy exists for ANYONE, including Super Admin -- omitting
-- them denies both operations outright, enforcing "never delete/update a historical ledger
-- transaction" at the database level, not just by convention.
create policy "leave_ledger_select_scoped" on public.leave_ledger for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
  );
create policy "leave_ledger_insert_scoped" on public.leave_ledger for insert with check (is_super_admin());

-- APPLICATIONS: Staff sees/creates only their own; non-staff sees the whole company (read) for
-- Phase 3's future approval screens. INSERT/UPDATE at the RLS layer are Super-Admin-only for the
-- same defense-in-depth reason as the ledger above -- the real writers are the SECURITY DEFINER
-- leave_apply()/leave_cancel()/leave_admin_decide() RPCs. No delete policy exists for anyone.
create policy "leave_applications_select_scoped" on public.leave_applications for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
  );
create policy "leave_applications_insert_scoped" on public.leave_applications for insert with check (is_super_admin());
create policy "leave_applications_update_scoped" on public.leave_applications for update using (is_super_admin());

-- DOCUMENTS: same self-or-company visibility, joined through the parent application.
create policy "leave_application_documents_select_scoped" on public.leave_application_documents for select
  using (
    is_super_admin()
    or exists (
      select 1 from public.leave_applications a
      where a.id = leave_application_id
        and (
          (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or (current_user_role() = 'staff' and a.employee_id = current_user_employee_id())
        )
    )
  );
create policy "leave_application_documents_insert_scoped" on public.leave_application_documents for insert with check (is_super_admin());

create trigger trg_leave_applications_set_updated_at before update on public.leave_applications for each row execute function public.set_updated_at();
create trigger trg_leave_applications_audit after insert or update or delete on public.leave_applications for each row execute function public.write_audit_log();
create trigger trg_leave_ledger_audit after insert on public.leave_ledger for each row execute function public.write_audit_log();
create trigger trg_leave_application_documents_audit after insert or delete on public.leave_application_documents for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- Storage: leave-documents bucket (private; access via RLS below) — mirrors the EXISTING
-- employee-documents bucket pattern (migration 0007) exactly, own bucket per the Phase 0/Phase 2
-- architecture decision (see header note).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('leave-documents', 'leave-documents', false)
on conflict (id) do nothing;

create policy "leave_documents_storage_select" on storage.objects for select
  using (
    bucket_id = 'leave-documents'
    and (is_super_admin() or (storage.foldername(name))[1] = current_user_company_id()::text)
  );

create policy "leave_documents_storage_insert" on storage.objects for insert
  with check (
    bucket_id = 'leave-documents'
    and (is_super_admin() or (storage.foldername(name))[1] = current_user_company_id()::text)
  );
