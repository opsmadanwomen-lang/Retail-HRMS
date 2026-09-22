-- ============================================================================
-- Retail HRMS — Phase 1 Attendance Foundation
-- Migration 0017 (CLI-safe): Attendance schema, security, and punch-in/out functions
-- This version uses conditional DO blocks to create enum types for compatibility.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE public.attendance_status AS ENUM (
      'present',
      'absent',
      'half_day',
      'leave',
      'weekly_off',
      'holiday',
      'work_from_home',
      'on_duty'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_source') THEN
    CREATE TYPE public.attendance_source AS ENUM (
      'web',
      'mobile',
      'backend'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'correction_status') THEN
    CREATE TYPE public.correction_status AS ENUM (
      'pending',
      'approved',
      'rejected'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_action') THEN
    CREATE TYPE public.attendance_action AS ENUM (
      'punch_in',
      'punch_out',
      'correction_requested',
      'correction_approved',
      'correction_rejected'
    );
  END IF;
END
$$;

create table if not exists public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  grace_minutes int not null default 0,
  minimum_work_minutes int not null default 0,
  overtime_enabled boolean not null default true,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  shift_id uuid not null references public.attendance_shifts (id) on delete cascade,
  effective_from date not null default current_date,
  effective_to date null,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  attendance_date date not null,
  shift_id uuid not null references public.attendance_shifts (id) on delete cascade,
  punch_in_at timestamptz,
  punch_out_at timestamptz,
  working_minutes int,
  late_minutes int,
  overtime_minutes int,
  status public.attendance_status not null default 'present',
  remarks text,
  source public.attendance_source not null default 'web',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, attendance_date)
);

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  attendance_record_id uuid not null references public.attendance_records (id) on delete cascade,
  requested_punch_in timestamptz,
  requested_punch_out timestamptz,
  reason text,
  status public.correction_status not null default 'pending',
  requested_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  attendance_record_id uuid not null references public.attendance_records (id) on delete cascade,
  action public.attendance_action not null,
  source public.attendance_source not null,
  performed_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_attendance_shifts_company_id on public.attendance_shifts (company_id);
create index if not exists idx_employee_shift_assignments_employee_id on public.employee_shift_assignments (employee_id);
create index if not exists idx_attendance_records_employee_date on public.attendance_records (employee_id, attendance_date);
create index if not exists idx_attendance_corrections_employee_id on public.attendance_corrections (employee_id);
create index if not exists idx_attendance_audit_logs_employee_id on public.attendance_audit_logs (employee_id);

alter table public.attendance_shifts enable row level security;
alter table public.employee_shift_assignments enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.attendance_audit_logs enable row level security;

create or replace function public.current_user_profile_email()
returns text as $$
  select email from public.profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function public.current_user_employee_id()
returns uuid as $$
  select e.id
  from public.employees e
  join public.profiles p on p.company_id = e.company_id
  where p.id = auth.uid()
    and e.email is not null
    and lower(e.email) = lower(p.email)
  limit 1;
$$ language sql stable security definer;

create policy "attendance_shifts_select_scoped"
  on public.attendance_shifts for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "attendance_shifts_insert_scoped"
  on public.attendance_shifts for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "attendance_shifts_update_scoped"
  on public.attendance_shifts for update
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "attendance_shifts_delete_scoped"
  on public.attendance_shifts for delete
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_shift_assignments_select_scoped"
  on public.employee_shift_assignments for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_shift_assignments_insert_scoped"
  on public.employee_shift_assignments for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_shift_assignments_update_scoped"
  on public.employee_shift_assignments for update
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "employee_shift_assignments_delete_scoped"
  on public.employee_shift_assignments for delete
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "attendance_records_select_scoped"
  on public.attendance_records for select
  using (
    public.is_super_admin() or company_id = public.current_user_company_id()
  );

create policy "attendance_records_insert_scoped"
  on public.attendance_records for insert
  with check (
    public.is_super_admin() or company_id = public.current_user_company_id()
  );

create policy "attendance_records_update_scoped"
  on public.attendance_records for update
  using (
    public.is_super_admin() or company_id = public.current_user_company_id()
  );

create policy "attendance_records_delete_scoped"
  on public.attendance_records for delete
  using (
    public.is_super_admin() or company_id = public.current_user_company_id()
  );

create policy "attendance_corrections_select_scoped"
  on public.attendance_corrections for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "attendance_corrections_insert_scoped"
  on public.attendance_corrections for insert
  with check (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "attendance_corrections_update_scoped"
  on public.attendance_corrections for update
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "attendance_corrections_delete_scoped"
  on public.attendance_corrections for delete
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create policy "attendance_audit_logs_select_scoped"
  on public.attendance_audit_logs for select
  using (public.is_super_admin() or company_id = public.current_user_company_id());

create or replace function public.attendance_punch_in()
returns public.attendance_records as $$
declare
  v_employee record;
  v_shift record;
  v_assignment record;
  v_punch_in timestamptz := now();
  v_late int;
  v_existing public.attendance_records%rowtype;
begin
  select id, company_id, store_id, status into v_employee
  from public.employees e
  where company_id = public.current_user_company_id()
    and e.email is not null
    and lower(e.email) = lower(public.current_user_profile_email())
    and status = 'active'
  limit 1;

  if not found then
    raise exception 'No active employee record is linked to the current user.';
  end if;

  select * into v_assignment
  from public.employee_shift_assignments
  where employee_id = v_employee.id
    and is_active
    and effective_from <= current_date
    and (effective_to is null or effective_to >= current_date)
  order by effective_from desc
  limit 1;

  if found then
    select * into v_shift from public.attendance_shifts where id = v_assignment.shift_id and is_active;
  end if;

  if v_shift is null then
    select * into v_shift
    from public.attendance_shifts
    where company_id = v_employee.company_id
      and is_active
    order by name
    limit 1;
  end if;

  if v_shift is null then
    raise exception 'No active shift is assigned to this employee.';
  end if;

  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = current_date
  limit 1;

  if found and v_existing.punch_in_at is not null then
    raise exception 'You have already punched in for today.';
  end if;

  v_late := greatest(
    0,
    floor(extract(epoch from (v_punch_in::time - v_shift.start_time)) / 60)::int - v_shift.grace_minutes
  );

  if found then
    update public.attendance_records
    set punch_in_at = v_punch_in,
        late_minutes = v_late,
        status = 'present',
        source = 'web',
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;

    return v_existing;
  end if;

  insert into public.attendance_records (
    company_id,
    employee_id,
    store_id,
    attendance_date,
    shift_id,
    punch_in_at,
    late_minutes,
    status,
    source,
    created_by,
    updated_by
  ) values (
    v_employee.company_id,
    v_employee.id,
    v_employee.store_id,
    current_date,
    v_shift.id,
    v_punch_in,
    v_late,
    'present',
    'web',
    auth.uid(),
    auth.uid()
  ) returning * into v_existing;

  return v_existing;
end;
$$ language plpgsql security definer;

create or replace function public.attendance_punch_out()
returns public.attendance_records as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
  v_record public.attendance_records%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_working int;
  v_overtime int;
begin
  if v_employee_id is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_record
  from public.attendance_records
  where employee_id = v_employee_id
    and attendance_date = current_date
  limit 1;

  if not found or v_record.punch_in_at is null then
    raise exception 'Please punch in before punching out.';
  end if;

  if v_record.punch_out_at is not null then
    raise exception 'You have already punched out for today.';
  end if;

  select * into v_shift from public.attendance_shifts where id = v_record.shift_id and is_active;
  if not found then
    raise exception 'Assigned shift is not available.';
  end if;

  v_working := greatest(0, floor(extract(epoch from (now() - v_record.punch_in_at)) / 60)::int);
  v_overtime := greatest(0, floor(extract(epoch from (now()::time - v_shift.end_time)) / 60)::int);

  update public.attendance_records
  set punch_out_at = now(),
      working_minutes = v_working,
      overtime_minutes = v_overtime,
      status = 'present',
      source = 'web',
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_record.id
  returning * into v_record;

  return v_record;
end;
$$ language plpgsql security definer;

-- Triggers for timestamps and audit logs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_shifts_set_updated_at') THEN
    CREATE TRIGGER trg_attendance_shifts_set_updated_at
      BEFORE UPDATE ON public.attendance_shifts
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_employee_shift_assignments_set_updated_at') THEN
    CREATE TRIGGER trg_employee_shift_assignments_set_updated_at
      BEFORE UPDATE ON public.employee_shift_assignments
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_records_set_updated_at') THEN
    CREATE TRIGGER trg_attendance_records_set_updated_at
      BEFORE UPDATE ON public.attendance_records
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_corrections_set_updated_at') THEN
    CREATE TRIGGER trg_attendance_corrections_set_updated_at
      BEFORE UPDATE ON public.attendance_corrections
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_audit_logs_set_updated_at') THEN
    CREATE TRIGGER trg_attendance_audit_logs_set_updated_at
      BEFORE UPDATE ON public.attendance_audit_logs
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_shifts_audit') THEN
    CREATE TRIGGER trg_attendance_shifts_audit
      AFTER INSERT OR UPDATE OR DELETE ON public.attendance_shifts
      FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_employee_shift_assignments_audit') THEN
    CREATE TRIGGER trg_employee_shift_assignments_audit
      AFTER INSERT OR UPDATE OR DELETE ON public.employee_shift_assignments
      FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_records_audit') THEN
    CREATE TRIGGER trg_attendance_records_audit
      AFTER INSERT OR UPDATE OR DELETE ON public.attendance_records
      FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_corrections_audit') THEN
    CREATE TRIGGER trg_attendance_corrections_audit
      AFTER INSERT OR UPDATE OR DELETE ON public.attendance_corrections
      FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_audit_logs_audit') THEN
    CREATE TRIGGER trg_attendance_audit_logs_audit
      AFTER INSERT OR UPDATE OR DELETE ON public.attendance_audit_logs
      FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
  END IF;
END
$$;
