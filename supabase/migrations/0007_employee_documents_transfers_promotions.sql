-- ============================================================================
-- Retail HRMS — Phase 1 Part 2 (Employee Management Foundation)
-- Migration 0007: Documents, Transfer/Promotion foundations, Import tracking
-- ============================================================================

create type public.employee_document_type as enum (
  'photo', 'aadhaar', 'pan', 'address_proof', 'joining_letter',
  'appointment_letter', 'resume', 'certificate', 'other'
);

-- ---------------------------------------------------------------------------
-- EMPLOYEE DOCUMENTS
-- Files themselves live in Supabase Storage (bucket: employee-documents,
-- path convention: {company_id}/{employee_id}/{document_type}/{file_name}).
-- This table stores the metadata/pointer only.
-- ---------------------------------------------------------------------------
create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  document_type public.employee_document_type not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  notes text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index idx_employee_documents_employee on public.employee_documents (employee_id);
create index idx_employee_documents_company on public.employee_documents (company_id);
create index idx_employee_documents_type on public.employee_documents (document_type);

-- ---------------------------------------------------------------------------
-- TRANSFER FOUNDATION
-- Structure and history only — no approval workflow in this phase.
-- ---------------------------------------------------------------------------
create table public.employee_transfers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  from_store_id uuid references public.stores (id) on delete set null,
  to_store_id uuid references public.stores (id) on delete set null,
  from_store_designation_id uuid references public.store_designations (id) on delete set null,
  to_store_designation_id uuid references public.store_designations (id) on delete set null,
  transfer_date date not null default current_date,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index idx_employee_transfers_employee on public.employee_transfers (employee_id);
create index idx_employee_transfers_company on public.employee_transfers (company_id);
create index idx_employee_transfers_date on public.employee_transfers (transfer_date);

-- ---------------------------------------------------------------------------
-- PROMOTION FOUNDATION
-- Structure and history only — no approval workflow in this phase.
-- ---------------------------------------------------------------------------
create table public.employee_promotions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  from_store_designation_id uuid references public.store_designations (id) on delete set null,
  to_store_designation_id uuid references public.store_designations (id) on delete set null,
  promotion_date date not null default current_date,
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index idx_employee_promotions_employee on public.employee_promotions (employee_id);
create index idx_employee_promotions_company on public.employee_promotions (company_id);
create index idx_employee_promotions_date on public.employee_promotions (promotion_date);

-- ---------------------------------------------------------------------------
-- IMPORT BATCH TRACKING
-- One row per Employee Import run — powers the Import Summary screen and
-- gives a distinct, queryable audit trail for imports (separate from the
-- generic insert/update/delete audit_logs, which still fires per-row).
-- ---------------------------------------------------------------------------
create table public.employee_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  file_name text not null,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  imported_rows integer not null default 0,
  skipped_rows integer not null default 0,
  error_rows integer not null default 0,
  errors jsonb,
  performed_by uuid,
  performed_at timestamptz not null default now()
);

create index idx_employee_import_batches_company on public.employee_import_batches (company_id);
create index idx_employee_import_batches_performed_at on public.employee_import_batches (performed_at desc);

-- ---------------------------------------------------------------------------
-- updated_at / audit triggers reused from 0001 / 0004 helper functions
-- ---------------------------------------------------------------------------
create trigger trg_employee_documents_audit
  after insert or update or delete on public.employee_documents
  for each row execute function public.write_audit_log();

create trigger trg_employee_transfers_audit
  after insert or update or delete on public.employee_transfers
  for each row execute function public.write_audit_log();

create trigger trg_employee_promotions_audit
  after insert or update or delete on public.employee_promotions
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- SUPABASE STORAGE — employee-documents bucket (private; access via RLS below)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.employee_documents enable row level security;
alter table public.employee_transfers enable row level security;
alter table public.employee_promotions enable row level security;
alter table public.employee_import_batches enable row level security;

create policy "employee_documents_select_scoped"
  on public.employee_documents for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "employee_documents_insert_scoped"
  on public.employee_documents for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "employee_documents_delete_scoped"
  on public.employee_documents for delete
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_transfers_select_scoped"
  on public.employee_transfers for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "employee_transfers_insert_scoped"
  on public.employee_transfers for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_promotions_select_scoped"
  on public.employee_promotions for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "employee_promotions_insert_scoped"
  on public.employee_promotions for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_import_batches_select_scoped"
  on public.employee_import_batches for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "employee_import_batches_insert_scoped"
  on public.employee_import_batches for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

-- Storage RLS: users may only read/write objects under their own company_id
-- folder (first path segment), mirroring the table-level policies above.
create policy "employee_documents_storage_select"
  on storage.objects for select
  using (
    bucket_id = 'employee-documents'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_user_company_id()::text)
  );

create policy "employee_documents_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'employee-documents'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_user_company_id()::text)
  );

create policy "employee_documents_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'employee-documents'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_user_company_id()::text)
  );
