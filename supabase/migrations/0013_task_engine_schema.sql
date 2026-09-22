-- ============================================================================
-- Retail HRMS — Phase 1 Part 5 (Task, SOP & Checklist Engine)
-- Migration 0013: Core schema
--
-- Operational backbone: Role -> Task -> SOP (Checklist) -> Verification ->
-- Completion -> Performance Contribution. Future Attendance / Audit /
-- Performance / Promotion / Training / Incentive / AI modules read from this
-- layer; none of them are implemented here (future_task_performance_mapping
-- is the landing table for them, same convention as
-- future_performance_history from Phase 1 Part 4).
--
-- No existing table is modified. Only new tables are added.
-- ============================================================================

create type public.task_priority as enum ('low', 'medium', 'high', 'critical');
create type public.task_attachment_type as enum ('photo', 'document');
create type public.task_verification_decision as enum ('approved', 'rejected');
create type public.task_history_action as enum (
  'assigned', 'started', 'submitted', 'verified', 'rejected', 'cancelled', 'status_changed'
);

-- ---------------------------------------------------------------------------
-- TASK CATEGORIES
-- ---------------------------------------------------------------------------
create table public.task_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- ---------------------------------------------------------------------------
-- TASK FREQUENCY — lookup table (Daily/Weekly/.../One Time/Recurring),
-- not a hardcoded enum. Doubles as the "Task Type" field on task_master.
-- ---------------------------------------------------------------------------
create table public.task_frequency (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  display_order int not null default 0,
  is_active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- TASK STATUS — lookup table, configurable like role_status.
-- ---------------------------------------------------------------------------
create table public.task_status (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  display_order int not null default 0,
  is_active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- TASK TEMPLATES — reusable named presets (Store Opening, Store Closing, …)
-- ---------------------------------------------------------------------------
create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  template_code text not null,
  template_name text not null,
  category_id uuid references public.task_categories (id) on delete set null,
  description text,
  is_system_template boolean not null default false,
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_task_templates_company on public.task_templates (company_id);
create index idx_task_templates_category on public.task_templates (category_id);
create unique index uidx_task_templates_system_code on public.task_templates (template_code) where company_id is null;
create unique index uidx_task_templates_company_code on public.task_templates (company_id, template_code) where company_id is not null;

-- ---------------------------------------------------------------------------
-- TASK MASTER
-- ---------------------------------------------------------------------------
create table public.task_master (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  task_code text not null,
  task_name text not null,
  category_id uuid references public.task_categories (id) on delete set null,
  frequency_id uuid references public.task_frequency (id) on delete set null,
  template_id uuid references public.task_templates (id) on delete set null,
  priority public.task_priority not null default 'medium',
  description text,
  estimated_time_minutes integer,
  requires_verification boolean not null default true,
  allow_photo_upload boolean not null default false,
  allow_document_upload boolean not null default false,
  allow_remarks boolean not null default true,
  allow_gps_placeholder boolean not null default false,
  allow_qr_placeholder boolean not null default false,
  weightage numeric(5, 2) not null default 0 check (weightage >= 0 and weightage <= 100),
  is_system_task boolean not null default false,
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_task_master_company on public.task_master (company_id);
create index idx_task_master_category on public.task_master (category_id);
create index idx_task_master_frequency on public.task_master (frequency_id);
create index idx_task_master_template on public.task_master (template_id);
create index idx_task_master_is_active on public.task_master (is_active);
create unique index uidx_task_master_system_code on public.task_master (task_code) where company_id is null;
create unique index uidx_task_master_company_code on public.task_master (company_id, task_code) where company_id is not null;

-- ---------------------------------------------------------------------------
-- ROLE TASK MAPPING (many-to-many: one Role -> many Tasks, one Task -> many Roles)
-- ---------------------------------------------------------------------------
create table public.role_task_mapping (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id) on delete cascade,
  task_id uuid not null references public.task_master (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_role_task_mapping_role on public.role_task_mapping (role_id);
create index idx_role_task_mapping_task on public.role_task_mapping (task_id);
create index idx_role_task_mapping_company on public.role_task_mapping (company_id);
create unique index uidx_role_task_mapping_open on public.role_task_mapping (role_id, task_id) where is_active = true;

-- ---------------------------------------------------------------------------
-- TASK CHECKLISTS / ITEMS — SOP for a task. Unlimited items per checklist.
-- ---------------------------------------------------------------------------
create table public.task_checklists (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_master (id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_task_checklists_task on public.task_checklists (task_id);

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_checklist_id uuid not null references public.task_checklists (id) on delete cascade,
  item_name text not null,
  description text,
  is_mandatory boolean not null default true,
  weightage numeric(5, 2) not null default 0 check (weightage >= 0 and weightage <= 100),
  sequence int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_task_checklist_items_checklist on public.task_checklist_items (task_checklist_id);

-- ---------------------------------------------------------------------------
-- EMPLOYEE TASK ASSIGNMENT
-- Employee -> Role -> Task -> Due Date -> Due Time -> Priority -> Status.
-- is_active is purely a soft-delete/uniqueness convenience (mirrors
-- employee_roles / employee_kpi_assignment); the real workflow state lives
-- in status_id.
-- ---------------------------------------------------------------------------
create table public.employee_task_assignment (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  role_id uuid references public.roles (id) on delete set null,
  task_id uuid not null references public.task_master (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  status_id uuid not null references public.task_status (id),
  priority public.task_priority not null default 'medium',
  due_date date not null default current_date,
  due_time time,
  is_active boolean not null default true,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index idx_employee_task_assignment_employee on public.employee_task_assignment (employee_id);
create index idx_employee_task_assignment_role on public.employee_task_assignment (role_id);
create index idx_employee_task_assignment_task on public.employee_task_assignment (task_id);
create index idx_employee_task_assignment_store on public.employee_task_assignment (store_id);
create index idx_employee_task_assignment_company on public.employee_task_assignment (company_id);
create index idx_employee_task_assignment_status on public.employee_task_assignment (status_id);
create index idx_employee_task_assignment_due_date on public.employee_task_assignment (due_date);

-- Prevents assigning the same task to the same employee twice while a prior
-- assignment is still open — "Prevent duplicate active task assignment".
create unique index uidx_employee_task_assignment_open
  on public.employee_task_assignment (employee_id, task_id) where is_active = true;

-- ---------------------------------------------------------------------------
-- TASK SUBMISSION — Completion Time, Remarks, Checklist responses.
-- Photos/documents live in task_attachments. Multiple submissions per
-- assignment are allowed (resubmission after rejection).
-- ---------------------------------------------------------------------------
create table public.task_submission (
  id uuid primary key default gen_random_uuid(),
  employee_task_assignment_id uuid not null references public.employee_task_assignment (id) on delete cascade,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  completion_time timestamptz,
  remarks text,
  checklist_responses jsonb,
  created_at timestamptz not null default now()
);

create index idx_task_submission_assignment on public.task_submission (employee_task_assignment_id);

-- ---------------------------------------------------------------------------
-- TASK VERIFICATION — Verifier, Review, Approve/Reject, Remarks, Score.
-- ---------------------------------------------------------------------------
create table public.task_verification (
  id uuid primary key default gen_random_uuid(),
  task_submission_id uuid not null references public.task_submission (id) on delete cascade,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz not null default now(),
  decision public.task_verification_decision not null,
  remarks text,
  score numeric,
  created_at timestamptz not null default now()
);

create index idx_task_verification_submission on public.task_verification (task_submission_id);

-- ---------------------------------------------------------------------------
-- TASK COMMENTS
-- ---------------------------------------------------------------------------
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  employee_task_assignment_id uuid not null references public.employee_task_assignment (id) on delete cascade,
  comment text not null,
  commented_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_task_comments_assignment on public.task_comments (employee_task_assignment_id);

-- ---------------------------------------------------------------------------
-- TASK ATTACHMENTS — Supabase Storage pointer (bucket: task-attachments,
-- path convention: {company_id}/{employee_task_assignment_id}/{file_name}).
-- ---------------------------------------------------------------------------
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  employee_task_assignment_id uuid not null references public.employee_task_assignment (id) on delete cascade,
  task_submission_id uuid references public.task_submission (id) on delete set null,
  company_id uuid not null references public.companies (id) on delete cascade,
  attachment_type public.task_attachment_type not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_task_attachments_assignment on public.task_attachments (employee_task_assignment_id);
create index idx_task_attachments_submission on public.task_attachments (task_submission_id);
create index idx_task_attachments_company on public.task_attachments (company_id);

-- ---------------------------------------------------------------------------
-- TASK HISTORY — full audit trail, auto-populated by trigger on
-- employee_task_assignment; submission/verification events are appended by
-- the application alongside the corresponding task_submission /
-- task_verification insert (richer payloads than a simple column diff).
-- ---------------------------------------------------------------------------
create table public.task_history (
  id uuid primary key default gen_random_uuid(),
  employee_task_assignment_id uuid not null references public.employee_task_assignment (id) on delete cascade,
  action public.task_history_action not null,
  status_id uuid references public.task_status (id),
  performed_by uuid references public.profiles (id) on delete set null,
  remarks text,
  created_at timestamptz not null default now()
);

create index idx_task_history_assignment on public.task_history (employee_task_assignment_id);

create or replace function public.log_task_assignment_history()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.task_history (employee_task_assignment_id, action, status_id, performed_by)
    values (new.id, 'assigned', new.status_id, new.assigned_by);
    return new;
  elsif (tg_op = 'UPDATE' and new.status_id is distinct from old.status_id) then
    insert into public.task_history (employee_task_assignment_id, action, status_id, performed_by)
    values (new.id, 'status_changed', new.status_id, new.updated_by);
    return new;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger trg_employee_task_assignment_history
  after insert or update on public.employee_task_assignment
  for each row execute function public.log_task_assignment_history();

-- ---------------------------------------------------------------------------
-- TASK SCORE — Weightage, Completion %, Verification %, Quality Score,
-- Final Score. One row per assignment, written by the scoring foundation
-- service (not by end users directly).
-- ---------------------------------------------------------------------------
create table public.task_score (
  id uuid primary key default gen_random_uuid(),
  employee_task_assignment_id uuid not null references public.employee_task_assignment (id) on delete cascade,
  weightage numeric,
  completion_percentage numeric,
  verification_percentage numeric,
  quality_score numeric,
  final_score numeric,
  calculated_at timestamptz not null default now(),
  calculated_by uuid,
  created_at timestamptz not null default now(),
  unique (employee_task_assignment_id)
);

create index idx_task_score_assignment on public.task_score (employee_task_assignment_id);

-- ---------------------------------------------------------------------------
-- FUTURE-READY FOUNDATION TABLE (structure only — not implemented/used yet)
-- ---------------------------------------------------------------------------
create table public.future_task_performance_mapping (
  id uuid primary key default gen_random_uuid(),
  employee_task_assignment_id uuid not null references public.employee_task_assignment (id) on delete cascade,
  event_type text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index idx_future_task_performance_mapping_assignment on public.future_task_performance_mapping (employee_task_assignment_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger trg_task_categories_set_updated_at before update on public.task_categories for each row execute function public.set_updated_at();
create trigger trg_task_templates_set_updated_at before update on public.task_templates for each row execute function public.set_updated_at();
create trigger trg_task_master_set_updated_at before update on public.task_master for each row execute function public.set_updated_at();
create trigger trg_role_task_mapping_set_updated_at before update on public.role_task_mapping for each row execute function public.set_updated_at();
create trigger trg_task_checklists_set_updated_at before update on public.task_checklists for each row execute function public.set_updated_at();
create trigger trg_task_checklist_items_set_updated_at before update on public.task_checklist_items for each row execute function public.set_updated_at();
create trigger trg_employee_task_assignment_set_updated_at before update on public.employee_task_assignment for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- AUDIT LOGGING — reuses the generic write_audit_log() trigger from 0004.
-- Covers Create/Update/Delete Task, Assign Task, Complete Task (submission
-- insert), Verify/Reject Task (verification insert with decision field).
-- ---------------------------------------------------------------------------
create trigger trg_task_master_audit after insert or update or delete on public.task_master for each row execute function public.write_audit_log();
create trigger trg_role_task_mapping_audit after insert or update or delete on public.role_task_mapping for each row execute function public.write_audit_log();
create trigger trg_employee_task_assignment_audit after insert or update or delete on public.employee_task_assignment for each row execute function public.write_audit_log();
create trigger trg_task_submission_audit after insert on public.task_submission for each row execute function public.write_audit_log();
create trigger trg_task_verification_audit after insert on public.task_verification for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- SUPABASE STORAGE — task-attachments bucket (private; access via RLS below)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.task_categories enable row level security;
alter table public.task_frequency enable row level security;
alter table public.task_status enable row level security;
alter table public.task_templates enable row level security;
alter table public.task_master enable row level security;
alter table public.role_task_mapping enable row level security;
alter table public.task_checklists enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.employee_task_assignment enable row level security;
alter table public.task_submission enable row level security;
alter table public.task_verification enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_history enable row level security;
alter table public.task_score enable row level security;
alter table public.future_task_performance_mapping enable row level security;

-- Global lookup tables
create policy "task_categories_select_all" on public.task_categories for select using (auth.role() = 'authenticated');
create policy "task_categories_write_super_admin" on public.task_categories for insert with check (public.is_super_admin());
create policy "task_categories_update_super_admin" on public.task_categories for update using (public.is_super_admin());

create policy "task_frequency_select_all" on public.task_frequency for select using (auth.role() = 'authenticated');
create policy "task_frequency_write_super_admin" on public.task_frequency for insert with check (public.is_super_admin());

create policy "task_status_select_all" on public.task_status for select using (auth.role() = 'authenticated');
create policy "task_status_write_super_admin" on public.task_status for insert with check (public.is_super_admin());

-- Task Templates / Task Master: system defaults visible to all, custom scoped to owner company.
create policy "task_templates_select_scoped" on public.task_templates for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "task_templates_write_scoped" on public.task_templates for all
  using (public.is_super_admin() or (company_id = public.current_user_company_id() and is_system_template = false))
  with check (public.is_super_admin() or (company_id = public.current_user_company_id() and is_system_template = false));

create policy "task_master_select_scoped" on public.task_master for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "task_master_write_scoped" on public.task_master for all
  using (public.is_super_admin() or (company_id = public.current_user_company_id() and is_system_task = false))
  with check (public.is_super_admin() or (company_id = public.current_user_company_id() and is_system_task = false));

-- Role Task Mapping: scoped via denormalized company_id (null = system role/task pairing).
create policy "role_task_mapping_select_scoped" on public.role_task_mapping for select
  using (company_id is null or public.is_super_admin() or company_id = public.current_user_company_id());
create policy "role_task_mapping_write_scoped" on public.role_task_mapping for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

-- Checklists / items: scoped via the parent task's visibility.
create policy "task_checklists_select_scoped" on public.task_checklists for select
  using (
    public.is_super_admin() or task_id in (
      select id from public.task_master
      where company_id is null or company_id = public.current_user_company_id()
    )
  );
create policy "task_checklists_write_scoped" on public.task_checklists for all
  using (
    public.is_super_admin() or task_id in (
      select id from public.task_master where company_id = public.current_user_company_id()
    )
  )
  with check (
    public.is_super_admin() or task_id in (
      select id from public.task_master where company_id = public.current_user_company_id()
    )
  );

create policy "task_checklist_items_select_scoped" on public.task_checklist_items for select
  using (public.is_super_admin() or task_checklist_id in (select id from public.task_checklists));
create policy "task_checklist_items_write_scoped" on public.task_checklist_items for all
  using (
    public.is_super_admin() or task_checklist_id in (
      select tc.id from public.task_checklists tc
      join public.task_master tm on tm.id = tc.task_id
      where tm.company_id = public.current_user_company_id()
    )
  )
  with check (
    public.is_super_admin() or task_checklist_id in (
      select tc.id from public.task_checklists tc
      join public.task_master tm on tm.id = tc.task_id
      where tm.company_id = public.current_user_company_id()
    )
  );

-- Company-scoped operational tables
create policy "employee_task_assignment_select_scoped" on public.employee_task_assignment for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "employee_task_assignment_write_scoped" on public.employee_task_assignment for all
  using (public.is_super_admin() or company_id = public.current_user_company_id())
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "task_submission_select_scoped" on public.task_submission for select
  using (
    public.is_super_admin() or employee_task_assignment_id in (
      select id from public.employee_task_assignment where company_id = public.current_user_company_id()
    )
  );
create policy "task_submission_write_scoped" on public.task_submission for insert
  with check (
    public.is_super_admin() or employee_task_assignment_id in (
      select id from public.employee_task_assignment where company_id = public.current_user_company_id()
    )
  );

create policy "task_verification_select_scoped" on public.task_verification for select
  using (
    public.is_super_admin() or task_submission_id in (
      select ts.id from public.task_submission ts
      join public.employee_task_assignment eta on eta.id = ts.employee_task_assignment_id
      where eta.company_id = public.current_user_company_id()
    )
  );
create policy "task_verification_write_scoped" on public.task_verification for insert
  with check (
    public.is_super_admin() or task_submission_id in (
      select ts.id from public.task_submission ts
      join public.employee_task_assignment eta on eta.id = ts.employee_task_assignment_id
      where eta.company_id = public.current_user_company_id()
    )
  );

create policy "task_comments_select_scoped" on public.task_comments for select
  using (
    public.is_super_admin() or employee_task_assignment_id in (
      select id from public.employee_task_assignment where company_id = public.current_user_company_id()
    )
  );
create policy "task_comments_write_scoped" on public.task_comments for insert
  with check (
    public.is_super_admin() or employee_task_assignment_id in (
      select id from public.employee_task_assignment where company_id = public.current_user_company_id()
    )
  );

create policy "task_attachments_select_scoped" on public.task_attachments for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "task_attachments_insert_scoped" on public.task_attachments for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());
create policy "task_attachments_delete_scoped" on public.task_attachments for delete
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "task_history_select_scoped" on public.task_history for select
  using (
    public.is_super_admin() or employee_task_assignment_id in (
      select id from public.employee_task_assignment where company_id = public.current_user_company_id()
    )
  );

create policy "task_score_select_scoped" on public.task_score for select
  using (
    public.is_super_admin() or employee_task_assignment_id in (
      select id from public.employee_task_assignment where company_id = public.current_user_company_id()
    )
  );
create policy "task_score_write_scoped" on public.task_score for all
  using (
    public.is_super_admin() or employee_task_assignment_id in (
      select id from public.employee_task_assignment where company_id = public.current_user_company_id()
    )
  )
  with check (
    public.is_super_admin() or employee_task_assignment_id in (
      select id from public.employee_task_assignment where company_id = public.current_user_company_id()
    )
  );

create policy "future_task_performance_mapping_select_scoped" on public.future_task_performance_mapping for select
  using (
    public.is_super_admin() or employee_task_assignment_id in (
      select id from public.employee_task_assignment where company_id = public.current_user_company_id()
    )
  );

-- Storage RLS: users may only read/write objects under their own company_id
-- folder (first path segment), mirroring the employee-documents pattern.
create policy "task_attachments_storage_select"
  on storage.objects for select
  using (
    bucket_id = 'task-attachments'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_user_company_id()::text)
  );

create policy "task_attachments_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'task-attachments'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_user_company_id()::text)
  );

create policy "task_attachments_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'task-attachments'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_user_company_id()::text)
  );
