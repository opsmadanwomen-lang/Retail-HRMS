-- ============================================================================
-- Retail HRMS — Phase 1 Part 2 (Employee Management Foundation)
-- Migration 0008: Employee Notes (backs the "Notes" tab on Employee Profile)
-- ============================================================================

create table public.employee_notes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  note text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index idx_employee_notes_employee on public.employee_notes (employee_id);
create index idx_employee_notes_company on public.employee_notes (company_id);

alter table public.employee_notes enable row level security;

create policy "employee_notes_select_scoped"
  on public.employee_notes for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_notes_insert_scoped"
  on public.employee_notes for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_notes_delete_scoped"
  on public.employee_notes for delete
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create trigger trg_employee_notes_audit
  after insert or update or delete on public.employee_notes
  for each row execute function public.write_audit_log();
