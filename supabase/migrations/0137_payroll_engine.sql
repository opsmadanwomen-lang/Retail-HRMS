-- ============================================================================
-- Retail HRMS — Phase 5: REAL PAYROLL ENGINE
--   Payroll Period + Payroll Run + Salary Component master + effective-dated
--   Salary snapshot + Earnings / Deductions lines + Advance Recovery
--   integration + Payslip + Finalize / Lock / controlled Reversal.
-- Migration 0137
--
-- INSPECTION (done first, per the spec): the system had NO payroll engine.
-- Available inputs that Phase 5 CONSUMES (never redesigns):
--   * employee_salary_components  — Basic + DA, effective-dated (the salary source).
--   * attendance_records          — per-day status + payable_* minutes / extra-duty
--                                   values (snapshotted as INPUT counts only).
--   * leave_attendance_effects    — per-day paid_status ('paid' | 'unpaid' |
--                                   'unassigned') + paid_units — the daily
--                                   Paid-Leave vs LWP allocation mechanism.
--   * holidays                    — per-day holiday marker (INPUT count).
--   * advance_recovery_* (Phase 4)— the Advance Recovery ledger + RPCs, reused
--                                   as-is through a safe bridge (see below).
--
-- NOT invented (flagged UNRESOLVED in the Phase 5 report, wired as inert
-- config integration points on payroll_policies):
--   LWP salary divisor / basis, salary proration method, PF / ESI / TDS / PT
--   formulas, overtime hourly rate, night-duty payroll rate, general statutory
--   deduction priority, salary-deduction cap, negative-net-pay policy.
-- Each is a NULLable payroll_policies column; NULL => that line computes to ₹0
-- and the employee result is flagged for review. No fake percentages anywhere.
--
-- ADVANCE RECOVERY BRIDGE (§25/§26/§63): Phase 4 tables/history are NOT touched
-- or deleted. advance_payroll_periods gains one nullable column
-- (payroll_run_id). A real payroll run binds/creates exactly one
-- advance_payroll_periods row per (company, month) to itself, then drives the
-- UNMODIFIED Phase-4 advance_recovery_run_period() per employee. Every existing
-- Phase-4 recovery transaction stays valid and queryable; its payroll_period_id
-- now traces to a real run via that column.
--
-- Reuses: current_user_*(), is_super_admin(), write_audit_log(),
-- set_updated_at(), advance_notify(), advance_am_i_hr()/_finance(),
-- advance_recovery_run_period()/_finalize_period()/_reverse_period().
-- Nothing in Leave / Attendance / Night Duty / Employee / Advance Phase 1-4
-- business logic is modified. No app_role change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bridge column on the Phase-4 stand-in (additive; existing rows keep NULL =
-- "manual Phase-4 recovery period, not driven by a real payroll run").
-- ----------------------------------------------------------------------------
alter table public.advance_payroll_periods
  add column if not exists payroll_run_id uuid;

-- ----------------------------------------------------------------------------
-- A. payroll_policies — one row per company. Every not-yet-supplied business
--    rule is a NULLable column here; NULL keeps that feature inert.
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  pay_frequency text not null default 'monthly' check (pay_frequency in ('monthly')),
  -- LWP / proration (UNRESOLVED — inert until an admin sets a divisor)
  lwp_divisor numeric check (lwp_divisor is null or lwp_divisor > 0),
  lwp_divisor_basis text check (lwp_divisor_basis is null or lwp_divisor_basis in ('basic', 'basic_da', 'gross')),
  proration_method text check (proration_method is null or proration_method in ('calendar_days', 'working_days', 'fixed_26', 'fixed_30', 'custom')),
  -- overtime / night duty payroll rates (UNRESOLVED — inert until set)
  overtime_hourly_rate numeric check (overtime_hourly_rate is null or overtime_hourly_rate >= 0),
  night_duty_day_rate numeric check (night_duty_day_rate is null or night_duty_day_rate >= 0),
  -- statutory / caps (UNRESOLVED — no engine supplied)
  deduction_cap_pct numeric check (deduction_cap_pct is null or (deduction_cap_pct > 0 and deduction_cap_pct <= 100)),
  allow_negative_net boolean not null default true,
  rounding text not null default 'round_2' check (rounding in ('none', 'round_2', 'round_0')),
  payslip_labels jsonb,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id)
);

-- ----------------------------------------------------------------------------
-- B. payroll_salary_components — component master (per company, effective-dated).
--    Seeded with Basic + DA (real, sourced from employee_salary_components) and
--    inert integration-point components for PF/ESI/TDS/PT/Overtime/Night Duty/
--    LWP/Advance Recovery.
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_salary_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  component_type text not null check (component_type in ('earning', 'deduction')),
  calculation_method text not null default 'manual'
    check (calculation_method in ('fixed_from_salary', 'manual', 'attendance_input', 'advance_recovery', 'lwp', 'not_configured')),
  source text,   -- 'basic' | 'da' | 'custom' | 'statutory' | 'overtime' | 'night_duty' | 'advance_recovery' | 'lwp'
  is_taxable boolean not null default false,
  is_statutory boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 100,
  effective_from date not null default current_date,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_payroll_salary_components_company on public.payroll_salary_components (company_id, is_active, component_type);

-- ----------------------------------------------------------------------------
-- C. payroll_periods — one complete salary period per company per month.
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  period_month date not null,
  period_start_date date not null,
  period_end_date date not null,
  label text,
  status text not null default 'draft' check (status in ('draft', 'processing', 'calculated', 'finalized', 'locked', 'reversed')),
  finalized_by uuid,
  finalized_at timestamptz,
  locked_by uuid,
  locked_at timestamptz,
  reversed_by uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, period_month),
  check (period_month = date_trunc('month', period_month)::date),
  check (period_end_date >= period_start_date)
);
create index if not exists idx_payroll_periods_company on public.payroll_periods (company_id, status);

-- ----------------------------------------------------------------------------
-- D. payroll_runs — a calculation of a period. run_number allows recalcs; the
--    is_current run is the single authoritative result.
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  run_number int not null default 1,
  is_current boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'processing', 'calculated', 'finalized', 'locked', 'reversed')),
  employee_count int not null default 0,
  gross_total numeric not null default 0,
  deduction_total numeric not null default 0,
  advance_recovery_total numeric not null default 0,
  net_total numeric not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  finalized_at timestamptz,
  locked_at timestamptz,
  reversed_at timestamptz,
  reverse_reason text,
  created_by uuid,
  processed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_period_id, run_number)
);
create unique index if not exists uidx_payroll_runs_one_current on public.payroll_runs (payroll_period_id) where is_current;
create index if not exists idx_payroll_runs_company on public.payroll_runs (company_id, status);

-- ----------------------------------------------------------------------------
-- E. payroll_employee_results — one header per employee per run, with the
--    salary/attendance/leave SNAPSHOT so a finalized payslip never changes.
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_employee_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs (id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  employee_code_snapshot text,
  employee_name_snapshot text,
  department_snapshot text,
  designation_snapshot text,
  store_snapshot text,
  salary_effective_from date,
  basic_snapshot numeric not null default 0,
  da_snapshot numeric not null default 0,
  calendar_days int not null default 0,
  working_days numeric not null default 0,
  present_days numeric not null default 0,
  paid_leave_days numeric not null default 0,
  lwp_days numeric not null default 0,
  weekly_off_days numeric not null default 0,
  holiday_days numeric not null default 0,
  absent_days numeric not null default 0,
  paid_days numeric not null default 0,
  unpaid_days numeric not null default 0,
  gross_earnings numeric not null default 0,
  total_deductions numeric not null default 0,
  advance_recovery_amount numeric not null default 0,
  net_salary numeric not null default 0,
  has_negative_net boolean not null default false,
  needs_review boolean not null default false,
  review_notes text,
  status text not null default 'calculated' check (status in ('calculated', 'finalized', 'reversed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_run_id, employee_id)
);
create index if not exists idx_payroll_employee_results_run on public.payroll_employee_results (payroll_run_id);
create index if not exists idx_payroll_employee_results_emp on public.payroll_employee_results (employee_id);

-- ----------------------------------------------------------------------------
-- F. payroll_lines — every earning / deduction, independently identifiable and
--    IMMUTABLE. Advance Recovery lines carry calculation_ref = the
--    advance_recovery_transactions id(s) they represent.
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs (id) on delete cascade,
  payroll_employee_result_id uuid not null references public.payroll_employee_results (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  component_id uuid references public.payroll_salary_components (id) on delete set null,
  line_type text not null check (line_type in ('earning', 'deduction')),
  code text not null,
  name text not null,
  quantity numeric,
  rate numeric,
  amount numeric not null default 0,
  source text,
  calculation_ref text,
  sort_order int not null default 100,
  is_reversal boolean not null default false,
  reverses_line_id uuid references public.payroll_lines (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_payroll_lines_result on public.payroll_lines (payroll_employee_result_id, line_type, sort_order);

-- ----------------------------------------------------------------------------
-- G. payslips — one immutable snapshot per finalized employee result.
-- ----------------------------------------------------------------------------
create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs (id) on delete cascade,
  payroll_employee_result_id uuid not null references public.payroll_employee_results (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  payslip_number text not null,
  period_month date not null,
  snapshot jsonb not null,
  generated_by uuid,
  generated_at timestamptz not null default now(),
  unique (payroll_employee_result_id)
);
create index if not exists idx_payslips_employee on public.payslips (employee_id, period_month);

alter table public.payroll_policies enable row level security;
alter table public.payroll_salary_components enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_employee_results enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.payslips enable row level security;

do $trg$
declare t text;
begin
  for t in select unnest(array['payroll_policies','payroll_salary_components','payroll_periods','payroll_runs','payroll_employee_results']) loop
    execute format('create trigger trg_%1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at();', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function public.write_audit_log();', t);
  end loop;
  execute 'create trigger trg_payroll_lines_audit after insert on public.payroll_lines for each row execute function public.write_audit_log();';
  execute 'create trigger trg_payslips_audit after insert on public.payslips for each row execute function public.write_audit_log();';
end $trg$;

-- ----------------------------------------------------------------------------
-- Authority: payroll administration = Super Admin OR an active Finance
-- Processor of the company. Reuses the Phase 3 roster (no new role); Finance
-- rather than HR because the payroll engine drives the Phase-4 Advance Recovery
-- RPC, whose own authority check is Finance/Super-Admin — a payroll admin must
-- therefore also hold that authority for the recovery step to run.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_can_manage(p_company_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select public.is_super_admin()
      or exists (select 1 from public.advance_finance_processors r
                 where r.employee_id = public.current_user_employee_id() and r.is_active and r.company_id = p_company_id);
$$;
grant execute on function public.payroll_can_manage(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS. Config + run tables: admin read (Super Admin / non-staff same company),
-- Super-Admin-only write. Employee-scoped tables (results / lines / payslips):
-- additionally readable by the owning employee. All real writes go through the
-- SECURITY DEFINER RPCs. payroll_lines / payslips have NO update/delete policy
-- -> immutable for everyone.
-- ----------------------------------------------------------------------------
do $rls$
declare t text;
begin
  for t in select unnest(array['payroll_policies','payroll_salary_components','payroll_periods','payroll_runs']) loop
    execute format($f$create policy "%1$s_select" on public.%1$s for select
      using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$f$, t);
    execute format($f$create policy "%1$s_write"  on public.%1$s for insert with check (is_super_admin());$f$, t);
    execute format($f$create policy "%1$s_update" on public.%1$s for update using (is_super_admin());$f$, t);
  end loop;
  for t in select unnest(array['payroll_employee_results','payroll_lines','payslips']) loop
    execute format($f$create policy "%1$s_select" on public.%1$s for select
      using (is_super_admin()
             or (current_user_role() <> 'staff' and company_id = current_user_company_id())
             or employee_id = current_user_employee_id());$f$, t);
    execute format($f$create policy "%1$s_write" on public.%1$s for insert with check (is_super_admin());$f$, t);
  end loop;
  execute $f$create policy "payroll_employee_results_update" on public.payroll_employee_results for update using (is_super_admin());$f$;
end $rls$;

-- ----------------------------------------------------------------------------
-- Component master seed per company (idempotent).
-- ----------------------------------------------------------------------------
insert into public.payroll_salary_components (company_id, code, name, component_type, calculation_method, source, is_taxable, is_statutory, sort_order)
select c.id, x.code, x.name, x.ctype, x.method, x.src, x.taxable, x.statutory, x.so
from public.companies c
cross join (values
  ('BASIC',  'Basic',            'earning',   'fixed_from_salary', 'basic',            true,  false, 10),
  ('DA',     'DA',               'earning',   'fixed_from_salary', 'da',               true,  false, 20),
  ('OT',     'Overtime',         'earning',   'attendance_input',  'overtime',         true,  false, 60),
  ('NDUTY',  'Night Duty',       'earning',   'attendance_input',  'night_duty',       true,  false, 70),
  ('PF',     'PF',               'deduction', 'not_configured',    'statutory',        false, true,  10),
  ('ESI',    'ESI',              'deduction', 'not_configured',    'statutory',        false, true,  20),
  ('TDS',    'TDS',              'deduction', 'not_configured',    'statutory',        false, true,  30),
  ('PT',     'Professional Tax', 'deduction', 'not_configured',    'statutory',        false, true,  40),
  ('LWP',    'LWP Deduction',    'deduction', 'lwp',               'lwp',              false, false, 50),
  ('ADVREC', 'Advance Recovery', 'deduction', 'advance_recovery',  'advance_recovery', false, false, 90)
) as x(code, name, ctype, method, src, taxable, statutory, so)
on conflict (company_id, code) do nothing;

-- default policy row per company (all UNRESOLVED knobs left NULL)
insert into public.payroll_policies (company_id)
select c.id from public.companies c
on conflict (company_id) do nothing;

-- ============================================================================
-- LIFECYCLE RPCs (all SECURITY DEFINER, backend-authoritative, atomic).
-- ============================================================================

create or replace function public.payroll_create_period(p_company_id uuid, p_period_month date, p_label text default null)
returns public.payroll_periods
language plpgsql
security definer
as $$
declare
  v_month date := date_trunc('month', p_period_month)::date;
  v_row public.payroll_periods;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if not public.payroll_can_manage(p_company_id) then
    raise exception 'You are not authorised to run payroll for this company.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.payroll_policies where company_id = p_company_id) then
    insert into public.payroll_policies (company_id) values (p_company_id) on conflict (company_id) do nothing;
  end if;

  insert into public.payroll_periods (company_id, period_month, period_start_date, period_end_date, label, status, created_by, updated_by)
  values (
    p_company_id, v_month, v_month, (v_month + interval '1 month' - interval '1 day')::date,
    coalesce(p_label, to_char(v_month, 'Mon YYYY')), 'draft', auth.uid(), auth.uid()
  )
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.payroll_create_period(uuid, date, text) to authenticated;

create or replace function public.payroll_start_run(p_payroll_period_id uuid)
returns public.payroll_runs
language plpgsql
security definer
as $$
declare
  v_period public.payroll_periods;
  v_run public.payroll_runs;
  v_num int;
begin
  select * into v_period from public.payroll_periods where id = p_payroll_period_id for update;
  if not found then raise exception 'Payroll period not found.'; end if;
  if not public.payroll_can_manage(v_period.company_id) then
    raise exception 'You are not authorised to run payroll for this company.' using errcode = '42501';
  end if;
  if v_period.status in ('finalized', 'locked') then
    raise exception 'Payroll period is % — start a new period or reverse it first.', v_period.status;
  end if;

  select coalesce(max(run_number), 0) + 1 into v_num from public.payroll_runs where payroll_period_id = p_payroll_period_id;
  update public.payroll_runs set is_current = false where payroll_period_id = p_payroll_period_id and is_current;

  insert into public.payroll_runs (company_id, payroll_period_id, run_number, is_current, status, started_at, created_by, processed_by)
  values (v_period.company_id, p_payroll_period_id, v_num, true, 'draft', now(), auth.uid(), auth.uid())
  returning * into v_run;

  update public.payroll_periods set status = 'processing', updated_by = auth.uid()
  where id = p_payroll_period_id and status in ('draft', 'processing', 'calculated');

  return v_run;
end;
$$;
grant execute on function public.payroll_start_run(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- The calculation engine. Idempotent per run: wipes THIS run's prior
-- results/lines and recomputes. Advance Recovery is NOT re-run if it was
-- already recorded against this run's bridged advance period (§30/§70) — its
-- amount is re-derived from the existing (valid) recovery transactions.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_calculate_run(p_payroll_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
as $$
declare
  v_run public.payroll_runs;
  v_period public.payroll_periods;
  v_pol public.payroll_policies;
  v_emp record;
  v_sal record;
  v_comp record;
  v_rec record;
  v_adv_period_id uuid;
  v_result_id uuid;
  v_basic numeric; v_da numeric;
  v_present_full numeric; v_half numeric; v_woff numeric; v_holi numeric; v_absent numeric; v_att_leave numeric;
  v_ot_min numeric; v_nd_val numeric;
  v_paid_leave numeric; v_lwp_days numeric; v_unassigned int;
  v_calendar int; v_working numeric; v_present numeric; v_paid_days numeric; v_unpaid_days numeric;
  v_gross numeric; v_ded numeric; v_advrec numeric; v_net numeric;
  v_qty numeric; v_rate numeric; v_amt numeric;
  v_review boolean; v_notes text; v_hasneg boolean;
  v_r_gross numeric := 0; v_r_ded numeric := 0; v_r_adv numeric := 0; v_r_net numeric := 0; v_cnt int := 0;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then
    raise exception 'You are not authorised to run payroll for this company.' using errcode = '42501';
  end if;
  if v_run.status not in ('draft', 'processing', 'calculated') then
    raise exception 'Payroll run is % — a finalized/locked/reversed run cannot be recalculated.', v_run.status;
  end if;
  if not v_run.is_current then
    raise exception 'This is not the current run for its period.';
  end if;

  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id;
  select * into v_pol from public.payroll_policies where company_id = v_run.company_id;
  v_calendar := (v_period.period_end_date - v_period.period_start_date + 1);

  update public.payroll_runs set status = 'processing', started_at = coalesce(started_at, now()), processed_by = auth.uid() where id = v_run.id;

  delete from public.payroll_lines where payroll_run_id = v_run.id;
  delete from public.payroll_employee_results where payroll_run_id = v_run.id;

  -- bridge: one advance_payroll_periods row per (company, month), bound to this run
  select id into v_adv_period_id from public.advance_payroll_periods
  where company_id = v_run.company_id and period_month = v_period.period_month;
  if v_adv_period_id is null then
    insert into public.advance_payroll_periods (company_id, period_month, label, status, payroll_run_id, created_by, updated_by)
    values (v_run.company_id, v_period.period_month, coalesce(v_period.label, to_char(v_period.period_month, 'Mon YYYY')), 'draft', v_run.id, auth.uid(), auth.uid())
    returning id into v_adv_period_id;
  else
    update public.advance_payroll_periods set payroll_run_id = v_run.id, updated_by = auth.uid()
    where id = v_adv_period_id and status = 'draft';
  end if;

  for v_emp in
    select e.id, e.full_name, e.employee_code, e.store_id, e.store_department_id, e.store_designation_id
    from public.employees e
    where e.company_id = v_run.company_id
      and e.status in ('active', 'on_leave', 'notice_period')
      and (e.joining_date is null or e.joining_date <= v_period.period_end_date)
    order by e.full_name
  loop
    v_review := false; v_notes := '';

    select sc.basic_salary, sc.da, sc.effective_from into v_sal
    from public.employee_salary_components sc
    where sc.employee_id = v_emp.id
      and sc.effective_from <= v_period.period_end_date
      and (sc.effective_to is null or sc.effective_to >= v_period.period_start_date)
    order by sc.effective_from desc limit 1;
    v_basic := coalesce(v_sal.basic_salary, 0);
    v_da := coalesce(v_sal.da, 0);
    if v_sal.effective_from is null then v_review := true; v_notes := v_notes || 'No effective salary structure for this period. '; end if;

    select
      coalesce(count(*) filter (where ar.status in ('present', 'work_from_home', 'on_duty')), 0),
      coalesce(count(*) filter (where ar.status = 'half_day'), 0) * 0.5,
      coalesce(count(*) filter (where ar.status = 'weekly_off'), 0),
      coalesce(count(*) filter (where ar.status = 'holiday'), 0),
      coalesce(count(*) filter (where ar.status = 'absent'), 0),
      coalesce(count(*) filter (where ar.status = 'leave'), 0),
      coalesce(sum(ar.payable_overtime_minutes), 0),
      coalesce(sum(ar.payable_extra_duty_value), 0)
    into v_present_full, v_half, v_woff, v_holi, v_absent, v_att_leave, v_ot_min, v_nd_val
    from public.attendance_records ar
    where ar.employee_id = v_emp.id and ar.attendance_date between v_period.period_start_date and v_period.period_end_date;

    select
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'paid'), 0),
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'unpaid'), 0),
      coalesce(count(*) filter (where lae.paid_status is null or lae.paid_status = 'unassigned'), 0)
    into v_paid_leave, v_lwp_days, v_unassigned
    from public.leave_attendance_effects lae
    where lae.employee_id = v_emp.id
      and lae.attendance_date between v_period.period_start_date and v_period.period_end_date
      and lae.reversed_at is null;
    if v_unassigned > 0 then
      v_review := true;
      v_notes := v_notes || format('%s approved leave day(s) not yet allocated as Paid Leave / LWP. ', v_unassigned);
    end if;

    v_present := coalesce(v_present_full, 0) + coalesce(v_half, 0);
    v_working := greatest(v_calendar - coalesce(v_woff, 0) - coalesce(v_holi, 0), 0);
    v_paid_days := v_present + coalesce(v_paid_leave, 0) + coalesce(v_woff, 0) + coalesce(v_holi, 0);
    v_unpaid_days := coalesce(v_lwp_days, 0) + coalesce(v_absent, 0);

    insert into public.payroll_employee_results (
      company_id, payroll_run_id, payroll_period_id, employee_id,
      employee_code_snapshot, employee_name_snapshot, department_snapshot, designation_snapshot, store_snapshot,
      salary_effective_from, basic_snapshot, da_snapshot,
      calendar_days, working_days, present_days, paid_leave_days, lwp_days, weekly_off_days, holiday_days, absent_days, paid_days, unpaid_days,
      status
    ) values (
      v_run.company_id, v_run.id, v_period.id, v_emp.id,
      v_emp.employee_code, v_emp.full_name,
      (select sd.name from public.store_departments sd where sd.id = v_emp.store_department_id),
      (select sg.title from public.store_designations sg where sg.id = v_emp.store_designation_id),
      (select s.name from public.stores s where s.id = v_emp.store_id),
      v_sal.effective_from, v_basic, v_da,
      v_calendar, v_working, v_present, coalesce(v_paid_leave, 0), coalesce(v_lwp_days, 0), coalesce(v_woff, 0), coalesce(v_holi, 0), coalesce(v_absent, 0), v_paid_days, v_unpaid_days,
      'calculated'
    ) returning id into v_result_id;

    -- ---------- EARNINGS ----------
    v_gross := 0;
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'earning'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.source = 'basic' then
        v_amt := round(v_basic, 2);
      elsif v_comp.source = 'da' then
        v_amt := round(v_da, 2);
      elsif v_comp.source = 'overtime' then
        v_qty := round(v_ot_min / 60.0, 2); v_rate := v_pol.overtime_hourly_rate;
        if v_rate is null then
          v_amt := 0;
          if v_qty > 0 then v_review := true; v_notes := v_notes || 'Overtime hourly rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
      elsif v_comp.source = 'night_duty' then
        v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate;
        if v_rate is null then
          v_amt := 0;
          if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
      else
        v_amt := 0;
      end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, v_comp.sort_order);
      v_gross := v_gross + v_amt;
    end loop;

    -- ---------- DEDUCTIONS ----------
    v_ded := 0; v_advrec := 0;
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'deduction'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.calculation_method = 'not_configured' then
        v_amt := 0;   -- statutory formula not supplied (UNRESOLVED)
      elsif v_comp.calculation_method = 'lwp' then
        if v_pol.lwp_divisor is not null and coalesce(v_lwp_days, 0) > 0 then
          v_rate := round(
            (case v_pol.lwp_divisor_basis when 'basic' then v_basic when 'gross' then v_gross else v_basic + v_da end) / v_pol.lwp_divisor, 4);
          v_qty := v_lwp_days;
          v_amt := round(v_rate * v_lwp_days, 2);
        else
          v_amt := 0;
          if coalesce(v_lwp_days, 0) > 0 then
            v_review := true;
            v_notes := v_notes || format('%s LWP day(s) — LWP salary divisor not configured. ', v_lwp_days);
          end if;
        end if;
      elsif v_comp.calculation_method = 'advance_recovery' then
        if exists (
          select 1 from public.advance_recovery_transactions x
          where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
        ) then
          select coalesce(sum(x.amount), 0) into v_advrec
          from public.advance_recovery_transactions x
          where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
            and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
        else
          v_advrec := 0;
          for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
            v_advrec := v_advrec + coalesce(v_rec.deducted_amount, 0);
          end loop;
        end if;
        v_amt := round(v_advrec, 2);
      else
        v_amt := 0;
      end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calculation_ref, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'deduction', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source,
              case when v_comp.calculation_method = 'advance_recovery' then 'advance_payroll_period:' || v_adv_period_id::text else null end,
              v_comp.sort_order);
      v_ded := v_ded + v_amt;
    end loop;

    v_net := round(v_gross - v_ded, 2);
    v_hasneg := v_net < 0;
    if v_hasneg then
      v_review := true;
      v_notes := v_notes || 'Total deductions exceed gross — negative net pay (no cap applied; policy not defined). ';
    end if;

    update public.payroll_employee_results
    set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2), net_salary = v_net,
        has_negative_net = v_hasneg, needs_review = v_review, review_notes = nullif(v_notes, '')
    where id = v_result_id;

    v_r_gross := v_r_gross + v_gross; v_r_ded := v_r_ded + v_ded; v_r_adv := v_r_adv + round(v_advrec, 2); v_r_net := v_r_net + v_net; v_cnt := v_cnt + 1;
  end loop;

  update public.payroll_runs
  set status = 'calculated', completed_at = now(),
      employee_count = v_cnt, gross_total = v_r_gross, deduction_total = v_r_ded, advance_recovery_total = v_r_adv, net_total = v_r_net
  where id = v_run.id
  returning * into v_run;

  update public.payroll_periods set status = 'calculated', updated_by = auth.uid() where id = v_period.id;

  return v_run;
end;
$$;
grant execute on function public.payroll_calculate_run(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Finalize: reconcile totals, freeze, generate payslips, finalize the bridged
-- advance recovery period, notify.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_finalize_run(p_payroll_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
as $$
declare
  v_run public.payroll_runs;
  v_period public.payroll_periods;
  v_company public.companies;
  v_res record;
  v_sum_g numeric; v_sum_d numeric; v_sum_n numeric; v_dupes int;
  v_adv_period_id uuid;
  v_snapshot jsonb;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if v_run.status <> 'calculated' then
    raise exception 'Only a calculated run can be finalized (current: %).', v_run.status;
  end if;

  select count(*) - count(distinct employee_id) into v_dupes from public.payroll_employee_results where payroll_run_id = v_run.id;
  if v_dupes <> 0 then raise exception 'Duplicate employee results detected — recalculate.'; end if;

  select coalesce(sum(gross_earnings), 0), coalesce(sum(total_deductions), 0), coalesce(sum(net_salary), 0)
  into v_sum_g, v_sum_d, v_sum_n from public.payroll_employee_results where payroll_run_id = v_run.id;
  if round(v_sum_g, 2) <> round(v_run.gross_total, 2) or round(v_sum_d, 2) <> round(v_run.deduction_total, 2) or round(v_sum_n, 2) <> round(v_run.net_total, 2) then
    raise exception 'Payroll totals do not reconcile (Σgross=%, run=%; Σded=%, run=%; Σnet=%, run=%).', v_sum_g, v_run.gross_total, v_sum_d, v_run.deduction_total, v_sum_n, v_run.net_total;
  end if;

  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id;
  select * into v_company from public.companies where id = v_run.company_id;

  update public.payroll_runs set status = 'finalized', finalized_at = now() where id = v_run.id returning * into v_run;
  update public.payroll_periods set status = 'finalized', finalized_by = auth.uid(), finalized_at = now(), updated_by = auth.uid() where id = v_period.id;

  -- payslips (one immutable snapshot per result)
  for v_res in select * from public.payroll_employee_results where payroll_run_id = v_run.id loop
    v_snapshot := jsonb_build_object(
      'company', jsonb_build_object('name', v_company.name, 'city', v_company.city, 'state', v_company.state),
      'employee', jsonb_build_object('code', v_res.employee_code_snapshot, 'name', v_res.employee_name_snapshot,
                                     'department', v_res.department_snapshot, 'designation', v_res.designation_snapshot, 'store', v_res.store_snapshot),
      'period', jsonb_build_object('month', to_char(v_period.period_month, 'Mon YYYY'),
                                   'start', v_period.period_start_date, 'end', v_period.period_end_date),
      'days', jsonb_build_object('calendar', v_res.calendar_days, 'working', v_res.working_days, 'paid', v_res.paid_days,
                                 'unpaid', v_res.unpaid_days, 'paid_leave', v_res.paid_leave_days, 'lwp', v_res.lwp_days),
      'earnings', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'qty', quantity, 'rate', rate, 'amount', amount) order by sort_order), '[]'::jsonb)
                   from public.payroll_lines where payroll_employee_result_id = v_res.id and line_type = 'earning'),
      'deductions', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'qty', quantity, 'rate', rate, 'amount', amount) order by sort_order), '[]'::jsonb)
                     from public.payroll_lines where payroll_employee_result_id = v_res.id and line_type = 'deduction'),
      'gross_earnings', v_res.gross_earnings,
      'total_deductions', v_res.total_deductions,
      'advance_recovery', v_res.advance_recovery_amount,
      'net_salary', v_res.net_salary
    );
    insert into public.payslips (company_id, payroll_run_id, payroll_employee_result_id, employee_id, payslip_number, period_month, snapshot, generated_by)
    values (v_run.company_id, v_run.id, v_res.id, v_res.employee_id,
            to_char(v_period.period_month, 'YYYYMM') || '-' || coalesce(v_res.employee_code_snapshot, left(v_res.employee_id::text, 8)),
            v_period.period_month, v_snapshot, auth.uid())
    on conflict (payroll_employee_result_id) do nothing;

    update public.payroll_employee_results set status = 'finalized' where id = v_res.id;

    perform public.advance_notify(v_run.company_id, v_res.employee_id, 'payroll_finalized', 'Payroll finalized',
      format('Your %s payroll has been finalized. Net salary: %s.', to_char(v_period.period_month, 'Mon YYYY'), v_res.net_salary), v_run.id);
    perform public.advance_notify(v_run.company_id, v_res.employee_id, 'payslip_available', 'Payslip available',
      format('Your %s payslip is now available.', to_char(v_period.period_month, 'Mon YYYY')), v_run.id);
    if v_res.advance_recovery_amount > 0 then
      perform public.advance_notify(v_run.company_id, v_res.employee_id, 'advance_recovery_deducted', 'Advance recovery deducted',
        format('%s Advance Recovery was deducted from your %s salary.', v_res.advance_recovery_amount, to_char(v_period.period_month, 'Mon YYYY')), v_run.id);
    end if;
  end loop;

  -- finalize the bridged Phase-4 advance recovery period for this run
  select id into v_adv_period_id from public.advance_payroll_periods where payroll_run_id = v_run.id and status = 'draft';
  if v_adv_period_id is not null then
    perform public.advance_recovery_finalize_period(v_adv_period_id);
  end if;

  return v_run;
end;
$$;
grant execute on function public.payroll_finalize_run(uuid) to authenticated;

create or replace function public.payroll_lock_run(p_payroll_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
as $$
declare v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_run.status <> 'finalized' then raise exception 'Only a finalized run can be locked (current: %).', v_run.status; end if;

  update public.payroll_runs set status = 'locked', locked_at = now() where id = v_run.id returning * into v_run;
  update public.payroll_periods set status = 'locked', locked_by = auth.uid(), locked_at = now(), updated_by = auth.uid() where id = v_run.payroll_period_id;
  return v_run;
end;
$$;
grant execute on function public.payroll_lock_run(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Controlled reversal: original payroll & recovery rows are KEPT; mirroring
-- is_reversal lines are added; Phase-4 advance recovery is reversed via its own
-- RPC (restores Outstanding, keeps originals, reopens closed advances).
-- ----------------------------------------------------------------------------
create or replace function public.payroll_reverse_run(p_payroll_run_id uuid, p_reason text)
returns public.payroll_runs
language plpgsql
security definer
as $$
declare
  v_run public.payroll_runs;
  v_period public.payroll_periods;
  v_line record;
  v_adv_period_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'A reason is required to reverse payroll.'; end if;
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_run.status not in ('finalized', 'locked') then
    raise exception 'Only a finalized or locked run can be reversed (current: %).', v_run.status;
  end if;
  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id;

  -- reverse the bridged advance recovery period (Phase-4 semantics)
  select id into v_adv_period_id from public.advance_payroll_periods where payroll_run_id = v_run.id and status <> 'reversed';
  if v_adv_period_id is not null then
    perform public.advance_recovery_reverse_period(v_adv_period_id, 'Payroll reversal: ' || p_reason);
  end if;

  -- mirror every original line with a reversal line (originals untouched)
  for v_line in select * from public.payroll_lines where payroll_run_id = v_run.id and not is_reversal loop
    insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calculation_ref, sort_order, is_reversal, reverses_line_id)
    values (v_line.company_id, v_line.payroll_run_id, v_line.payroll_employee_result_id, v_line.employee_id, v_line.component_id, v_line.line_type,
            v_line.code, v_line.name || ' (Reversal)', v_line.quantity, v_line.rate, -1 * v_line.amount, v_line.source, v_line.calculation_ref, v_line.sort_order, true, v_line.id);
  end loop;

  update public.payroll_employee_results set status = 'reversed' where payroll_run_id = v_run.id;
  update public.payroll_runs set status = 'reversed', reversed_at = now(), reverse_reason = p_reason where id = v_run.id returning * into v_run;
  update public.payroll_periods set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reverse_reason = p_reason, updated_by = auth.uid() where id = v_period.id;

  perform public.advance_notify(v_run.company_id, r.employee_id, 'payroll_processed', 'Payroll reversed',
    format('Your %s payroll has been reversed: %s', to_char(v_period.period_month, 'Mon YYYY'), p_reason), v_run.id)
  from (select distinct employee_id from public.payroll_employee_results where payroll_run_id = v_run.id) r;

  return v_run;
end;
$$;
grant execute on function public.payroll_reverse_run(uuid, text) to authenticated;

-- ============================================================================
-- READ RPCs
-- ============================================================================

create or replace function public.payroll_list_periods(p_company_id uuid)
returns table (
  id uuid, period_month date, period_start_date date, period_end_date date, label text, status text,
  current_run_id uuid, run_status text, employee_count int, gross_total numeric, deduction_total numeric,
  advance_recovery_total numeric, net_total numeric, finalized_at timestamptz, locked_at timestamptz
)
language plpgsql
stable
security definer
as $$
begin
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and p_company_id = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select pp.id, pp.period_month, pp.period_start_date, pp.period_end_date, pp.label, pp.status,
         r.id, r.status, r.employee_count, r.gross_total, r.deduction_total, r.advance_recovery_total, r.net_total,
         pp.finalized_at, pp.locked_at
  from public.payroll_periods pp
  left join public.payroll_runs r on r.payroll_period_id = pp.id and r.is_current
  where pp.company_id = p_company_id
  order by pp.period_month desc;
end;
$$;
grant execute on function public.payroll_list_periods(uuid) to authenticated;

create or replace function public.payroll_list_run_results(p_payroll_run_id uuid)
returns table (
  id uuid, employee_id uuid, employee_code text, employee_name text, department text, designation text, store text,
  basic numeric, da numeric, paid_days numeric, unpaid_days numeric, lwp_days numeric,
  gross_earnings numeric, total_deductions numeric, advance_recovery_amount numeric, net_salary numeric,
  has_negative_net boolean, needs_review boolean, review_notes text, status text
)
language plpgsql
stable
security definer
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.payroll_runs where id = p_payroll_run_id;
  if v_company is null then raise exception 'Payroll run not found.'; end if;
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and v_company = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select r.id, r.employee_id, r.employee_code_snapshot, r.employee_name_snapshot, r.department_snapshot, r.designation_snapshot, r.store_snapshot,
         r.basic_snapshot, r.da_snapshot, r.paid_days, r.unpaid_days, r.lwp_days,
         r.gross_earnings, r.total_deductions, r.advance_recovery_amount, r.net_salary,
         r.has_negative_net, r.needs_review, r.review_notes, r.status
  from public.payroll_employee_results r
  where r.payroll_run_id = p_payroll_run_id
  order by r.employee_name_snapshot;
end;
$$;
grant execute on function public.payroll_list_run_results(uuid) to authenticated;

create or replace function public.payroll_get_employee_result(p_result_id uuid)
returns table (
  result_id uuid, payroll_run_id uuid, run_status text, period_month date,
  employee_id uuid, employee_code text, employee_name text, department text, designation text, store text,
  salary_effective_from date, basic numeric, da numeric,
  calendar_days int, working_days numeric, present_days numeric, paid_leave_days numeric, lwp_days numeric,
  weekly_off_days numeric, holiday_days numeric, absent_days numeric, paid_days numeric, unpaid_days numeric,
  gross_earnings numeric, total_deductions numeric, advance_recovery_amount numeric, net_salary numeric,
  has_negative_net boolean, needs_review boolean, review_notes text, status text
)
language plpgsql
stable
security definer
as $$
begin
  return query
  select r.id, r.payroll_run_id, pr.status, pp.period_month,
         r.employee_id, r.employee_code_snapshot, r.employee_name_snapshot, r.department_snapshot, r.designation_snapshot, r.store_snapshot,
         r.salary_effective_from, r.basic_snapshot, r.da_snapshot,
         r.calendar_days, r.working_days, r.present_days, r.paid_leave_days, r.lwp_days,
         r.weekly_off_days, r.holiday_days, r.absent_days, r.paid_days, r.unpaid_days,
         r.gross_earnings, r.total_deductions, r.advance_recovery_amount, r.net_salary,
         r.has_negative_net, r.needs_review, r.review_notes, r.status
  from public.payroll_employee_results r
  join public.payroll_runs pr on pr.id = r.payroll_run_id
  join public.payroll_periods pp on pp.id = r.payroll_period_id
  where r.id = p_result_id
    and (public.is_super_admin()
         or (current_user_role() <> 'staff' and r.company_id = current_user_company_id())
         or r.employee_id = current_user_employee_id());
end;
$$;
grant execute on function public.payroll_get_employee_result(uuid) to authenticated;

create or replace function public.payroll_list_employee_result_lines(p_result_id uuid)
returns table (
  line_type text, code text, name text, quantity numeric, rate numeric, amount numeric, source text,
  calculation_ref text, is_reversal boolean, sort_order int
)
language sql
stable
security definer
as $$
  select l.line_type, l.code, l.name, l.quantity, l.rate, l.amount, l.source, l.calculation_ref, l.is_reversal, l.sort_order
  from public.payroll_lines l
  where l.payroll_employee_result_id = p_result_id
    and exists (
      select 1 from public.payroll_employee_results r
      where r.id = p_result_id
        and (is_super_admin()
             or (current_user_role() <> 'staff' and r.company_id = current_user_company_id())
             or r.employee_id = current_user_employee_id())
    )
  order by l.line_type desc, l.is_reversal, l.sort_order, l.code;
$$;
grant execute on function public.payroll_list_employee_result_lines(uuid) to authenticated;

create or replace function public.payroll_list_my_payslips()
returns table (
  result_id uuid, payslip_id uuid, payslip_number text, period_month date, run_status text,
  gross_earnings numeric, total_deductions numeric, advance_recovery_amount numeric, net_salary numeric, status text
)
language sql
stable
security definer
as $$
  select r.id, ps.id, ps.payslip_number, pp.period_month, pr.status,
         r.gross_earnings, r.total_deductions, r.advance_recovery_amount, r.net_salary, r.status
  from public.payroll_employee_results r
  join public.payroll_runs pr on pr.id = r.payroll_run_id
  join public.payroll_periods pp on pp.id = r.payroll_period_id
  left join public.payslips ps on ps.payroll_employee_result_id = r.id
  where r.employee_id = public.current_user_employee_id()
    and r.status in ('finalized', 'reversed')
  order by pp.period_month desc;
$$;
grant execute on function public.payroll_list_my_payslips() to authenticated;

create or replace function public.payroll_get_payslip(p_result_id uuid)
returns jsonb
language sql
stable
security definer
as $$
  select ps.snapshot
  from public.payslips ps
  where ps.payroll_employee_result_id = p_result_id
    and (is_super_admin()
         or (current_user_role() <> 'staff' and ps.company_id = current_user_company_id())
         or ps.employee_id = current_user_employee_id());
$$;
grant execute on function public.payroll_get_payslip(uuid) to authenticated;

create or replace function public.payroll_report_advance_recovery(p_payroll_run_id uuid)
returns table (
  employee_name text, employee_code text, advance_type_name text,
  actual_paid_amount numeric, recovered_this_period numeric, total_recovered numeric, outstanding_amount numeric, period_month date
)
language plpgsql
stable
security definer
as $$
declare v_company uuid; v_month date;
begin
  select r.company_id, pp.period_month into v_company, v_month
  from public.payroll_runs r join public.payroll_periods pp on pp.id = r.payroll_period_id where r.id = p_payroll_run_id;
  if v_company is null then raise exception 'Payroll run not found.'; end if;
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and v_company = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select e.full_name, e.employee_code, t.name,
         p.actual_paid_amount,
         coalesce(sum(x.amount) filter (where x.txn_type = 'deduction'
            and not exists (select 1 from public.advance_recovery_transactions rr where rr.txn_type = 'reversal' and rr.reverses_transaction_id = x.id)), 0),
         p.total_recovered, p.outstanding_amount, v_month
  from public.advance_recovery_transactions x
  join public.advance_recovery_plans p on p.id = x.recovery_plan_id
  join public.advance_requests a on a.id = p.advance_request_id
  join public.employees e on e.id = p.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  join public.advance_payroll_periods app on app.id = x.payroll_period_id
  where app.payroll_run_id = p_payroll_run_id
  group by e.full_name, e.employee_code, t.name, p.actual_paid_amount, p.total_recovered, p.outstanding_amount, v_month
  order by e.full_name;
end;
$$;
grant execute on function public.payroll_report_advance_recovery(uuid) to authenticated;
