-- ============================================================================
-- Retail HRMS — Correction: PF & ESI support configurable calculation methods
--   INCLUDING a per-employee / per-payroll-period Manual + Excel Import amount.
-- Migration 0143
--
-- PF and ESI (statutory rules) gain a `calc_method`:
--     pct_of_base       — calc_base (basic / basic_da / gross) x employee_rate %   (existing behaviour, default)
--     fixed_amount      — flat employee_amount / employer_amount in ₹
--     pct_of_component  — ref_component_code amount x rate %
--     formula           — base_formula / employer_formula evaluated to ₹
--     manual            — amount comes from public.payroll_component_amounts, keyed by
--                         (company, payroll_period, employee, component) — entered by hand
--                         or imported from Excel. Blank ≠ 0 (blank = not supplied; 0 = intentional).
--
-- The SAME payroll pipeline (payroll_calculate_run -> payroll_apply_policy ->
-- payroll_policy_compute_lines) consumes the resulting PF/ESI amount. No second
-- calculation engine is created.
--
-- OT IS COMPLETELY EXCLUDED. OT is not a statutory rule, never uses calc_method,
-- and public.payroll_component_amounts / the import framework hard-reject the
-- 'OT' code and any component whose source is 'overtime'. OT continues to come
-- ONLY from Attendance -> Overtime / OT Rules -> attendance_records
-- .payable_overtime_minutes -> payroll OT valuation -> payslip.
--
-- No statutory percentage, wage ceiling or rate is hard-coded anywhere.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. payroll_statutory_rules — configurable calculation method for PF / ESI / …
-- ----------------------------------------------------------------------------
alter table public.payroll_statutory_rules
  add column if not exists calc_method text not null default 'pct_of_base'
    check (calc_method in ('pct_of_base', 'fixed_amount', 'pct_of_component', 'formula', 'manual')),
  add column if not exists employee_amount numeric check (employee_amount is null or employee_amount >= 0),
  add column if not exists employer_amount numeric check (employer_amount is null or employer_amount >= 0),
  add column if not exists ref_component_code text,
  add column if not exists employer_formula text;

update public.payroll_statutory_rules set calc_method = 'pct_of_base' where calc_method is null;

comment on column public.payroll_statutory_rules.calc_method is
  'How this statutory (PF/ESI/…) amount is determined for the payroll period: '
  'pct_of_base (calc_base x employee_rate %), fixed_amount (employee_amount/employer_amount ₹), '
  'pct_of_component (ref_component_code amount x rate %), formula (base_formula/employer_formula -> ₹), '
  'manual (per employee+period amount from payroll_component_amounts). '
  'Overtime is NOT a statutory rule and never uses this — OT comes only from the Attendance OT Rules.';

-- ----------------------------------------------------------------------------
-- B. payroll_component_import_batches — one row per confirmed Excel import.
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_component_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  component_codes text[] not null,
  file_name text,
  row_count int not null default 0,
  employee_amount_total numeric not null default 0,
  employer_amount_total numeric not null default 0,
  status text not null default 'committed' check (status in ('committed', 'reverted')),
  created_by uuid,
  created_at timestamptz not null default now(),
  -- the commit RPC always upper-cases codes before insert; OT can never be imported.
  constraint pcib_component_codes_not_ot check (not ('OT' = any(component_codes)))
);
create index if not exists idx_pcib_period on public.payroll_component_import_batches (payroll_period_id);

-- ----------------------------------------------------------------------------
-- C. payroll_component_amounts — the per-employee / per-period amount for a
--    component whose calc_method = 'manual'. NULL amount = blank (not supplied);
--    an explicit 0 is a real, intentional zero.
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_component_amounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  component_code text not null,
  employee_amount numeric check (employee_amount is null or employee_amount >= 0),
  employer_amount numeric check (employer_amount is null or employer_amount >= 0),
  source text not null default 'manual' check (source in ('manual', 'excel_import')),
  import_batch_id uuid references public.payroll_component_import_batches (id) on delete set null,
  note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_period_id, employee_id, component_code),
  constraint payroll_component_amounts_not_ot check (upper(component_code) <> 'OT'),
  constraint payroll_component_amounts_some_value
    check (employee_amount is not null or employer_amount is not null)
);
create index if not exists idx_pca_period_emp on public.payroll_component_amounts (payroll_period_id, employee_id);
create index if not exists idx_pca_company on public.payroll_component_amounts (company_id);

-- ----------------------------------------------------------------------------
-- D. payroll_component_amount_audit — old -> new every change (§10). This is in
--    ADDITION to the generic write_audit_log trigger.
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_component_amount_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  payroll_period_id uuid not null,
  employee_id uuid not null,
  component_code text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_employee_amount numeric,
  new_employee_amount numeric,
  old_employer_amount numeric,
  new_employer_amount numeric,
  source text,
  import_batch_id uuid,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists idx_pcaa_period_emp on public.payroll_component_amount_audit (payroll_period_id, employee_id, component_code);

create or replace function public.payroll_component_amounts_audit_trg()
returns trigger
language plpgsql
security definer
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.payroll_component_amount_audit (company_id, payroll_period_id, employee_id, component_code, action,
      old_employee_amount, new_employee_amount, old_employer_amount, new_employer_amount, source, import_batch_id, changed_by)
    values (new.company_id, new.payroll_period_id, new.employee_id, new.component_code, 'insert',
      null, new.employee_amount, null, new.employer_amount, new.source, new.import_batch_id, coalesce(new.updated_by, new.created_by, auth.uid()));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.payroll_component_amount_audit (company_id, payroll_period_id, employee_id, component_code, action,
      old_employee_amount, new_employee_amount, old_employer_amount, new_employer_amount, source, import_batch_id, changed_by)
    values (new.company_id, new.payroll_period_id, new.employee_id, new.component_code, 'update',
      old.employee_amount, new.employee_amount, old.employer_amount, new.employer_amount, new.source, new.import_batch_id, coalesce(new.updated_by, auth.uid()));
    return new;
  else
    insert into public.payroll_component_amount_audit (company_id, payroll_period_id, employee_id, component_code, action,
      old_employee_amount, new_employee_amount, old_employer_amount, new_employer_amount, source, import_batch_id, changed_by)
    values (old.company_id, old.payroll_period_id, old.employee_id, old.component_code, 'delete',
      old.employee_amount, null, old.employer_amount, null, old.source, old.import_batch_id, auth.uid());
    return old;
  end if;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- E. Immutability guard (§8) — a manual/imported amount may only change while
--    the payroll period is still editable (draft / processing / calculated).
--    Once finalized / locked / reversed it is immutable; corrections go through
--    the existing payroll reverse/correction process.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_component_amounts_guard()
returns trigger
language plpgsql
security definer
as $fn$
declare v_status text; v_period uuid;
begin
  v_period := coalesce(new.payroll_period_id, old.payroll_period_id);
  select status into v_status from public.payroll_periods where id = v_period;
  if v_status in ('finalized', 'locked', 'reversed') then
    raise exception 'Payroll period is % — PF/ESI manual amounts are immutable. Use the payroll reversal/correction process.', v_status
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$fn$;

-- ----------------------------------------------------------------------------
-- F. RLS + triggers.
-- ----------------------------------------------------------------------------
alter table public.payroll_component_import_batches enable row level security;
alter table public.payroll_component_amounts enable row level security;
alter table public.payroll_component_amount_audit enable row level security;

drop trigger if exists trg_pca_guard on public.payroll_component_amounts;
create trigger trg_pca_guard before insert or update or delete on public.payroll_component_amounts
  for each row execute function public.payroll_component_amounts_guard();

drop trigger if exists trg_pca_audit_row on public.payroll_component_amounts;
create trigger trg_pca_audit_row after insert or update or delete on public.payroll_component_amounts
  for each row execute function public.payroll_component_amounts_audit_trg();

drop trigger if exists trg_pca_set_updated_at on public.payroll_component_amounts;
create trigger trg_pca_set_updated_at before update on public.payroll_component_amounts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pca_audit on public.payroll_component_amounts;
create trigger trg_pca_audit after insert or update or delete on public.payroll_component_amounts
  for each row execute function public.write_audit_log();

drop trigger if exists trg_pcib_audit on public.payroll_component_import_batches;
create trigger trg_pcib_audit after insert or update or delete on public.payroll_component_import_batches
  for each row execute function public.write_audit_log();

do $rls$
begin
  -- read: super admin OR non-staff of the same company. writes go ONLY through the SECURITY DEFINER RPCs.
  execute $p$create policy "pca_select" on public.payroll_component_amounts for select
    using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$p$;
  execute $p$create policy "pcib_select" on public.payroll_component_import_batches for select
    using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$p$;
  execute $p$create policy "pcaa_select" on public.payroll_component_amount_audit for select
    using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$p$;
end
$rls$;

-- ----------------------------------------------------------------------------
-- G. Eligibility helper — which component codes may carry a manual/imported
--    amount. PF & ESI always; any other ACTIVE non-overtime component that a
--    company has explicitly set to calculation_method = 'manual' (e.g. a future
--    Incentive / Bonus). OT is ALWAYS rejected.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_component_import_eligible(p_company_id uuid, p_code text)
returns boolean
language sql
stable
security definer
as $fn$
  select case
    when p_code is null or upper(btrim(p_code)) = 'OT' then false
    when upper(btrim(p_code)) in ('PF', 'ESI') then true
    when exists (
      select 1 from public.payroll_salary_components c
      where c.company_id = p_company_id
        and upper(c.code) = upper(btrim(p_code))
        and c.is_active
        and coalesce(c.source, '') <> 'overtime'
        and c.calculation_method = 'manual'
    ) then true
    else false
  end;
$fn$;
grant execute on function public.payroll_component_import_eligible(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- H. Amount parser for the Excel import. '' / NULL -> NULL (blank, not supplied).
--    '0' -> 0 (intentional). Anything non-numeric or negative raises.
-- ----------------------------------------------------------------------------
create or replace function public._pca_parse_amount(p_raw text)
returns numeric
language plpgsql
immutable
as $fn$
declare v text; v_num numeric;
begin
  if p_raw is null then return null; end if;
  v := btrim(p_raw);
  v := replace(replace(replace(v, ',', ''), '₹', ''), ' ', '');
  if v = '' then return null; end if;
  if v !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'not a valid amount: "%"', p_raw;
  end if;
  v_num := v::numeric;
  if v_num < 0 then raise exception 'amount cannot be negative: "%"', p_raw; end if;
  return v_num;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- I. RPC — set a single manual PF/ESI amount for one employee + period.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_component_amount_set(
  p_period_id uuid,
  p_employee_id uuid,
  p_component_code text,
  p_employee_amount numeric default null,
  p_employer_amount numeric default null,
  p_note text default null
)
returns public.payroll_component_amounts
language plpgsql
security definer
as $fn$
declare
  v_company uuid; v_pstatus text; v_emp_company uuid; v_code text := upper(btrim(p_component_code)); v_row public.payroll_component_amounts;
begin
  select company_id, status into v_company, v_pstatus from public.payroll_periods where id = p_period_id;
  if v_company is null then raise exception 'Payroll period not found.'; end if;
  if not public.payroll_can_manage(v_company) then
    raise exception 'You are not authorised to manage payroll for this company.' using errcode = '42501';
  end if;

  if v_code = 'OT' then
    raise exception 'Overtime cannot use a manual or imported amount. OT comes only from Attendance -> Overtime / OT Rules.'
      using errcode = '22023';
  end if;
  if not public.payroll_component_import_eligible(v_company, v_code) then
    raise exception '% is not a component that supports a manual / imported amount.', v_code using errcode = '22023';
  end if;

  select company_id into v_emp_company from public.employees where id = p_employee_id;
  if v_emp_company is null then raise exception 'Employee not found.'; end if;
  if v_emp_company <> v_company then
    raise exception 'Employee % does not belong to this company (cross-company blocked).', p_employee_id using errcode = '42501';
  end if;
  if p_employee_amount is null and p_employer_amount is null then
    raise exception 'Nothing to store — supply an employee and/or employer amount (or delete the row).';
  end if;
  if p_employee_amount is not null and p_employee_amount < 0 then raise exception 'Employee amount cannot be negative.'; end if;
  if p_employer_amount is not null and p_employer_amount < 0 then raise exception 'Employer amount cannot be negative.'; end if;
  -- period-editable is enforced by trg_pca_guard as well.
  if v_pstatus in ('finalized', 'locked', 'reversed') then
    raise exception 'Payroll period is % — PF/ESI manual amounts are immutable.', v_pstatus using errcode = '55000';
  end if;

  insert into public.payroll_component_amounts (company_id, payroll_period_id, employee_id, component_code,
    employee_amount, employer_amount, source, note, created_by, updated_by)
  values (v_company, p_period_id, p_employee_id, v_code, p_employee_amount, p_employer_amount, 'manual', p_note, auth.uid(), auth.uid())
  on conflict (payroll_period_id, employee_id, component_code) do update
    set employee_amount = excluded.employee_amount,
        employer_amount = excluded.employer_amount,
        source = 'manual',
        import_batch_id = null,
        note = excluded.note,
        updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end;
$fn$;
grant execute on function public.payroll_component_amount_set(uuid, uuid, text, numeric, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- J. RPC — bulk manual set (the grid UI). p_rows: [{employee_id, component_code,
--    employee_amount, employer_amount, note}]. One transaction.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_component_amounts_bulk_set(p_period_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
as $fn$
declare r jsonb; v_n int := 0; v_del int := 0; v_ea numeric; v_er numeric;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_ea := nullif(r ->> 'employee_amount', '')::numeric;
    v_er := nullif(r ->> 'employer_amount', '')::numeric;
    if v_ea is null and v_er is null then
      -- explicit clear
      delete from public.payroll_component_amounts
      where payroll_period_id = p_period_id
        and employee_id = (r ->> 'employee_id')::uuid
        and component_code = upper(btrim(r ->> 'component_code'));
      v_del := v_del + 1;
    else
      perform public.payroll_component_amount_set(p_period_id, (r ->> 'employee_id')::uuid, r ->> 'component_code',
        v_ea, v_er, r ->> 'note');
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('saved', v_n, 'cleared', v_del);
end;
$fn$;
grant execute on function public.payroll_component_amounts_bulk_set(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- K. RPC — Excel import PREVIEW. p_rows: [{row_number, staff_id, staff_name,
--    amounts: { "PF": "1800", "ESI": "350" }}]. Validates without writing.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_component_import_preview(
  p_company_id uuid,
  p_period_id uuid,
  p_component_codes text[],
  p_rows jsonb
)
returns jsonb
language plpgsql
stable
security definer
as $fn$
declare
  v_pcompany uuid; v_pstatus text;
  v_codes text[];
  r jsonb; v_rn int; v_staff text; v_name text;
  v_emp_id uuid; v_emp_name text; v_emp_code text;
  v_out jsonb := '[]'::jsonb; v_row jsonb; v_amts jsonb; v_msgs text[]; v_state text;
  c text; v_raw text; v_val numeric; v_supplied boolean; v_comp_out jsonb;
  v_total int := 0; v_valid int := 0; v_warn int := 0; v_err int := 0;
  v_ea_total numeric := 0; v_er_total numeric := 0;
  v_seen text[] := '{}';
begin
  select company_id, status into v_pcompany, v_pstatus from public.payroll_periods where id = p_period_id;
  if v_pcompany is null then raise exception 'Payroll period not found.'; end if;
  if v_pcompany <> p_company_id then raise exception 'Period does not belong to this company.' using errcode = '42501'; end if;
  if not public.payroll_can_manage(p_company_id) then
    raise exception 'You are not authorised to import payroll amounts for this company.' using errcode = '42501';
  end if;

  -- normalise + validate the requested component scope (OT can never appear here)
  select array_agg(distinct upper(btrim(x))) into v_codes from unnest(coalesce(p_component_codes, array['PF','ESI'])) x;
  if v_codes is null or array_length(v_codes, 1) is null then v_codes := array['PF','ESI']; end if;
  if 'OT' = any(v_codes) then
    raise exception 'Overtime cannot be imported. OT comes only from Attendance -> Overtime / OT Rules.' using errcode = '22023';
  end if;
  foreach c in array v_codes loop
    if not public.payroll_component_import_eligible(p_company_id, c) then
      raise exception '% is not importable as a manual amount.', c using errcode = '22023';
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_total := v_total + 1;
    v_rn := coalesce((r ->> 'row_number')::int, v_total);
    v_staff := btrim(coalesce(r ->> 'staff_id', ''));
    v_name := btrim(coalesce(r ->> 'staff_name', ''));
    v_amts := coalesce(r -> 'amounts', '{}'::jsonb);
    v_msgs := '{}'; v_state := 'valid'; v_emp_id := null; v_emp_name := null; v_emp_code := null;

    if v_staff = '' then
      v_msgs := array_append(v_msgs, 'Staff ID is blank.'); v_state := 'error';
    else
      select e.id, e.full_name, e.employee_code into v_emp_id, v_emp_name, v_emp_code
      from public.employees e
      where e.company_id = p_company_id and upper(btrim(e.employee_code)) = upper(v_staff);

      if v_emp_id is null then
        v_msgs := array_append(v_msgs, format('No employee with Staff ID "%s" in this company.', v_staff));
        v_state := 'error';
      else
        if v_staff = any(v_seen) then
          v_msgs := array_append(v_msgs, format('Duplicate Staff ID "%s" in the file.', v_staff));
          v_state := 'error';
        end if;
        v_seen := array_append(v_seen, v_staff);
        if v_name <> '' and lower(v_name) <> lower(coalesce(v_emp_name, '')) then
          v_msgs := array_append(v_msgs, format('Name "%s" does not match "%s" (Staff ID wins).', v_name, v_emp_name));
          if v_state = 'valid' then v_state := 'warning'; end if;
        end if;
      end if;
    end if;

    -- per requested component: parse the amount (blank vs 0 vs number)
    v_comp_out := '{}'::jsonb;
    foreach c in array v_codes loop
      v_raw := v_amts ->> c;
      v_supplied := false; v_val := null;
      begin
        v_val := public._pca_parse_amount(v_raw);
        v_supplied := v_val is not null;
        if v_supplied and v_state <> 'error' and v_emp_id is not null then
          v_ea_total := v_ea_total + v_val;
        end if;
      exception when others then
        v_msgs := array_append(v_msgs, format('%s amount "%s" is not a valid number.', c, v_raw));
        v_state := 'error';
      end;
      v_comp_out := v_comp_out || jsonb_build_object(c, jsonb_build_object(
        'raw', v_raw,
        'value', v_val,
        'supplied', v_supplied,
        'zero', (v_supplied and v_val = 0)
      ));
    end loop;

    if v_state = 'error' then v_err := v_err + 1;
    elsif v_state = 'warning' then v_warn := v_warn + 1; v_valid := v_valid + 1;
    else v_valid := v_valid + 1;
    end if;

    v_row := jsonb_build_object(
      'row_number', v_rn,
      'staff_id', v_staff,
      'staff_name', v_name,
      'employee_id', v_emp_id,
      'matched_name', v_emp_name,
      'matched_code', v_emp_code,
      'state', v_state,
      'messages', to_jsonb(v_msgs),
      'components', v_comp_out
    );
    v_out := v_out || v_row;
  end loop;

  return jsonb_build_object(
    'period', jsonb_build_object('id', p_period_id, 'status', v_pstatus,
                                'editable', v_pstatus not in ('finalized', 'locked', 'reversed')),
    'component_codes', to_jsonb(v_codes),
    'summary', jsonb_build_object(
      'total_rows', v_total, 'valid', v_valid, 'warnings', v_warn, 'errors', v_err,
      'employee_amount_total', v_ea_total, 'employer_amount_total', v_er_total
    ),
    'rows', v_out
  );
end;
$fn$;
grant execute on function public.payroll_component_import_preview(uuid, uuid, text[], jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- L. RPC — Excel import COMMIT. Re-runs the preview; refuses if ANY row errors.
--    Writes only SUPPLIED (non-blank) amounts. Blank leaves the component alone
--    (never silently zeroed). Records a batch + audit.
-- ----------------------------------------------------------------------------
create or replace function public.payroll_component_import_commit(
  p_company_id uuid,
  p_period_id uuid,
  p_component_codes text[],
  p_rows jsonb,
  p_file_name text default null
)
returns jsonb
language plpgsql
security definer
as $fn$
declare
  v_prev jsonb; v_codes text[]; v_pstatus text; v_pcompany uuid;
  r jsonb; c text; v_batch uuid; v_emp uuid; v_val numeric;
  v_imported int := 0; v_updated int := 0; v_skipped int := 0;
  v_ea_total numeric := 0; v_er_total numeric := 0; v_existed boolean;
begin
  select company_id, status into v_pcompany, v_pstatus from public.payroll_periods where id = p_period_id;
  if v_pcompany is null then raise exception 'Payroll period not found.'; end if;
  if v_pcompany <> p_company_id then raise exception 'Period does not belong to this company.' using errcode = '42501'; end if;
  if not public.payroll_can_manage(p_company_id) then
    raise exception 'You are not authorised to import payroll amounts for this company.' using errcode = '42501';
  end if;
  if v_pstatus in ('finalized', 'locked', 'reversed') then
    raise exception 'Payroll period is % — PF/ESI amounts are immutable. Use the payroll reversal/correction process.', v_pstatus
      using errcode = '55000';
  end if;

  v_prev := public.payroll_component_import_preview(p_company_id, p_period_id, p_component_codes, p_rows);
  if (v_prev -> 'summary' ->> 'errors')::int > 0 then
    raise exception 'Import has % row error(s) — fix the file and preview again. Nothing was imported.',
      (v_prev -> 'summary' ->> 'errors')::int using errcode = '22023';
  end if;
  select array_agg(value::text) into v_codes from jsonb_array_elements_text(v_prev -> 'component_codes');

  insert into public.payroll_component_import_batches (company_id, payroll_period_id, component_codes, file_name, created_by)
  values (p_company_id, p_period_id, v_codes, p_file_name, auth.uid())
  returning id into v_batch;

  for r in select * from jsonb_array_elements(v_prev -> 'rows') loop
    v_emp := nullif(r ->> 'employee_id', '')::uuid;
    if v_emp is null then continue; end if;
    foreach c in array v_codes loop
      if coalesce((r -> 'components' -> c ->> 'supplied')::boolean, false) then
        v_val := (r -> 'components' -> c ->> 'value')::numeric;
        select exists (select 1 from public.payroll_component_amounts
                       where payroll_period_id = p_period_id and employee_id = v_emp and component_code = c) into v_existed;
        insert into public.payroll_component_amounts (company_id, payroll_period_id, employee_id, component_code,
          employee_amount, employer_amount, source, import_batch_id, note, created_by, updated_by)
        values (p_company_id, p_period_id, v_emp, c, v_val, null, 'excel_import', v_batch,
          nullif(p_file_name, ''), auth.uid(), auth.uid())
        on conflict (payroll_period_id, employee_id, component_code) do update
          set employee_amount = excluded.employee_amount,
              source = 'excel_import',
              import_batch_id = v_batch,
              note = excluded.note,
              updated_by = auth.uid();
        if v_existed then v_updated := v_updated + 1; else v_imported := v_imported + 1; end if;
        v_ea_total := v_ea_total + coalesce(v_val, 0);
      else
        v_skipped := v_skipped + 1;   -- blank: left untouched, NOT zeroed
      end if;
    end loop;
  end loop;

  update public.payroll_component_import_batches
  set row_count = jsonb_array_length(v_prev -> 'rows'),
      employee_amount_total = v_ea_total,
      employer_amount_total = v_er_total
  where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch,
    'imported', v_imported,
    'updated', v_updated,
    'skipped_blank', v_skipped,
    'employee_amount_total', v_ea_total,
    'component_codes', to_jsonb(v_codes),
    'note', 'PF/ESI amounts stored for this period. Re-run Payroll Calculate to fold them into the payslips.'
  );
end;
$fn$;
grant execute on function public.payroll_component_import_commit(uuid, uuid, text[], jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- M. payroll_policy_compute_lines â€” statutory (PF/ESI/â€¦) section gains the
--    fixed_amount / pct_of_component / formula / manual calculation methods.
--    pct_of_base is byte-for-byte the original. OT section is UNTOUCHED â€” OT is
--    not a statutory rule and never enters this loop.
--    Two new trailing params carry per-employee context:
--      p_manual_components : { "PF": {"employee_amount": .., "employer_amount": .., "source": ..}, "ESI": {...} }
--      p_component_amounts : { "<code>": <amount already on this payslip> }  (for pct_of_component)
-- ----------------------------------------------------------------------------
drop function if exists public.payroll_policy_compute_lines(uuid,date,date,numeric,date,numeric,numeric,numeric,numeric,numeric,numeric,uuid,text[],date,boolean,jsonb);

CREATE OR REPLACE FUNCTION public.payroll_policy_compute_lines(p_policy_id uuid, p_period_start date, p_period_end date, p_working_days numeric, p_joining_date date, p_basic numeric, p_da numeric, p_gross numeric, p_lwp_days numeric, p_ot_minutes numeric, p_nd_value numeric, p_structure_id uuid DEFAULT NULL::uuid, p_existing_codes text[] DEFAULT '{}'::text[], p_leaving_date date DEFAULT NULL::date, p_exit_date_payable boolean DEFAULT NULL::boolean, p_tds jsonb DEFAULT NULL::jsonb, p_manual_components jsonb DEFAULT '{}'::jsonb, p_component_amounts jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(kind text, line_type text, code text, name text, quantity numeric, rate numeric, amount numeric, calc_type text, calc_base text, calc_note text, unresolved boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  p public.payroll_policies;
  v_days int := (p_period_end - p_period_start + 1);
  v_prec int;
  v_div numeric;
  v_base numeric;
  v_daily numeric;
  v_lost numeric;
  v_lost_join numeric := 0;
  v_hours numeric;
  v_stdh numeric;
  v_rate numeric;
  v_amt numeric;
  v_note text;
  r record;
  v_sbase numeric;
  v_has_struct_stat boolean;
  v_last_payable date;
  v_mkey text;
  v_man jsonb;
  v_emp_amt numeric;
  v_er_amt numeric;
  v_mnote text;
  v_munres boolean;
  v_refamt numeric;
begin
  select * into p from public.payroll_policies where id = p_policy_id;
  if p.id is null then return; end if;
  v_prec := coalesce(p.currency_precision, 2);
  v_stdh := nullif(coalesce(p.ot_std_hours_per_day, 0), 0);

  v_div := case p.proration_method
    when 'calendar_days' then v_days
    when 'working_days'  then nullif(p_working_days, 0)
    when 'fixed_26'      then 26
    when 'fixed_30'      then 30
    when 'custom'        then p.proration_custom_divisor
    else null end;
  v_base := case p.proration_basis
    when 'basic'    then p_basic
    when 'basic_da' then p_basic + p_da
    when 'gross'    then p_gross
    when 'custom'   then public.payroll_eval_formula(p.proration_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross))
    else null end;

  -- ---- 1. Joining-month proration ----
  if p_joining_date is not null and p_joining_date > p_period_start then
    v_lost_join := (p_joining_date - p_period_start);
    if v_div is not null then v_lost_join := least(v_lost_join, v_div); end if;
    if v_lost_join > 0 then
      if p.proration_method is null or v_div is null or v_div = 0 or v_base is null then
        kind := 'earning_prorate'; line_type := 'earning'; code := 'PRORATE'; name := 'Joining-month proration';
        quantity := v_lost_join; rate := null; amount := 0; calc_type := 'proration'; calc_base := p.proration_basis;
        calc_note := format('Joined %s - %s day(s) not worked. Proration method/basis/divisor not configured.', p_joining_date, v_lost_join);
        unresolved := true; return next;
      else
        v_daily := round(v_base / v_div, 6);
        kind := 'earning_prorate'; line_type := 'earning'; code := 'PRORATE'; name := 'Joining-month proration';
        quantity := v_lost_join; rate := v_daily; amount := - round(v_daily * v_lost_join, v_prec); calc_type := 'proration';
        calc_base := p.proration_basis;
        calc_note := format('Joined %s - %s day(s) x daily %s (%s / %s, %s)', p_joining_date, v_lost_join, v_daily, v_base, v_div, p.proration_method);
        unresolved := false; return next;
      end if;
    end if;
  end if;

  -- ---- 1b. Exit-month proration (SAME engine, SAME policy) ----
  if p_leaving_date is not null and p_leaving_date < p_period_end then
    if p_exit_date_payable is null then
      kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
      quantity := (p_period_end - p_leaving_date); rate := null; amount := 0; calc_type := 'proration_exit'; calc_base := p.proration_basis;
      calc_note := format('Left %s - exit_date_payable not confirmed (business decision). No exit proration applied.', p_leaving_date);
      unresolved := true; return next;
    else
      v_last_payable := case when p_exit_date_payable then p_leaving_date else p_leaving_date - 1 end;
      v_lost := greatest(p_period_end - v_last_payable, 0);
      if v_div is not null then v_lost := least(v_lost, greatest(v_div - v_lost_join, 0)); end if;
      if v_lost > 0 then
        if p.proration_method is null or v_div is null or v_div = 0 or v_base is null then
          kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
          quantity := v_lost; rate := null; amount := 0; calc_type := 'proration_exit'; calc_base := p.proration_basis;
          calc_note := format('Left %s - %s day(s) after last payable day. Proration method/basis/divisor not configured.', p_leaving_date, v_lost);
          unresolved := true; return next;
        else
          v_daily := round(v_base / v_div, 6);
          kind := 'earning_prorate_exit'; line_type := 'earning'; code := 'PRORATE_EXIT'; name := 'Exit-month proration';
          quantity := v_lost; rate := v_daily; amount := - round(v_daily * v_lost, v_prec); calc_type := 'proration_exit';
          calc_base := p.proration_basis;
          calc_note := format('Left %s (last payable %s) - %s day(s) x daily %s (%s / %s, %s)', p_leaving_date, v_last_payable, v_lost, v_daily, v_base, v_div, p.proration_method);
          unresolved := false; return next;
        end if;
      end if;
    end if;
  end if;

  -- ---- 2. Overtime â€” SYSTEM-CALCULATED, sourced ONLY from the Attendance OT Rule Engine ----
  -- p_ot_minutes is attendance_records.payable_overtime_minutes: eligibility, minimum, slab,
  -- rounding and maximum have ALREADY been applied by the configured Attendance OT Rule
  -- (calculate_overtime_minutes). Payroll adds NO rate method, NO fixed amount, NO %-of-salary,
  -- NO formula, NO Excel import and NO override. It only VALUES those payable minutes at the
  -- employee's ordinary hourly wage (Basic+DA over the standard monthly hours). The OT premium
  -- (1.5x / 2x / slab) is entirely inside p_ot_minutes.
  if p.ot_enabled and coalesce(p_ot_minutes, 0) > 0 and not ('OT' = any(p_existing_codes)) then
    v_hours := round(p_ot_minutes / 60.0, 2);
    if v_div is null or v_stdh is null then
      v_rate := null; v_amt := 0; unresolved := true;
      v_note := format('%s payable OT minute(s) from the Attendance OT Rule â€” cannot be valued: standard hours/day and/or a proration divisor are not configured.', p_ot_minutes);
    else
      v_rate := round((p_basic + p_da) / v_div / v_stdh, 4);   -- ordinary per-hour wage (Basic+DA / divisor / std hours)
      v_amt := round(v_hours * v_rate, v_prec);
      unresolved := false;
      v_note := format('%s payable OT min from the Attendance OT Rule (premium already applied) Ã— ordinary hourly wage %s (Basic+DA Ã· %s Ã· %s h/day)', p_ot_minutes, v_rate, v_div, v_stdh);
    end if;
    kind := 'earning_ot'; line_type := 'earning'; code := 'OT'; name := 'Overtime';
    quantity := v_hours; rate := v_rate; amount := v_amt; calc_type := 'overtime_attendance'; calc_base := 'basic_da'; calc_note := v_note;
    return next;
  end if;

  -- ---- 3. Night-Duty payroll earning ----
  if p.nd_earning_enabled and coalesce(p_nd_value, 0) > 0 and not ('NDUTY' = any(p_existing_codes)) then
    v_note := null;
    v_rate := case p.nd_rate_type
      when 'fixed'           then coalesce(p.nd_rate, p.night_duty_day_rate)
      when 'pct_of_basic'    then case when v_div is null then null else round(p_basic / v_div * coalesce(p.nd_rate, 0) / 100.0, 4) end
      when 'pct_of_basic_da' then case when v_div is null then null else round((p_basic + p_da) / v_div * coalesce(p.nd_rate, 0) / 100.0, 4) end
      when 'custom_formula'  then public.payroll_eval_formula(p.nd_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross, 'NDVALUE', p_nd_value, 'DIVISOR', coalesce(v_div, 0)))
      else null end;
    if v_rate is null then
      v_amt := 0; unresolved := true; v_note := 'Night-duty payroll rate not configured.';
    else
      v_amt := round(coalesce(p_nd_value, 0) * v_rate, case coalesce(p.nd_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
      unresolved := false; v_note := format('%s unit(s) x %s (%s)', p_nd_value, v_rate, coalesce(p.nd_rate_type, 'fixed'));
    end if;
    kind := 'earning_nd'; line_type := 'earning'; code := 'NDUTY'; name := 'Night Duty';
    quantity := p_nd_value; rate := v_rate; amount := v_amt; calc_type := 'night_duty'; calc_base := p.nd_basis; calc_note := v_note;
    return next;
  end if;

  -- ---- 4. LWP deduction ----
  if p.lwp_enabled and coalesce(p_lwp_days, 0) > 0 and not ('LWP' = any(p_existing_codes)) then
    declare
      v_ld numeric := case coalesce(p.lwp_proration_method, p.proration_method)
        when 'calendar_days' then v_days
        when 'working_days'  then nullif(p_working_days, 0)
        when 'fixed_26'      then 26
        when 'fixed_30'      then 30
        when 'custom'        then coalesce(p.proration_custom_divisor, p.lwp_divisor)
        else p.lwp_divisor end;
      v_lb numeric := case coalesce(p.lwp_basis, p.lwp_divisor_basis)
        when 'basic'    then p_basic
        when 'basic_da' then p_basic + p_da
        when 'gross'    then p_gross
        when 'custom'   then public.payroll_eval_formula(p.lwp_custom_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross))
        else null end;
    begin
      if v_ld is null or v_ld = 0 or v_lb is null then
        kind := 'deduction_lwp'; line_type := 'deduction'; code := 'LWP'; name := 'Loss of Pay';
        quantity := p_lwp_days; rate := null; amount := 0; calc_type := 'lwp'; calc_base := coalesce(p.lwp_basis, p.lwp_divisor_basis);
        calc_note := format('%s LWP day(s) - LWP daily-rate needs a configured basis + divisor/method.', p_lwp_days);
        unresolved := true; return next;
      else
        v_daily := round(v_lb / v_ld, 6);
        kind := 'deduction_lwp'; line_type := 'deduction'; code := 'LWP'; name := 'Loss of Pay';
        quantity := p_lwp_days; rate := v_daily;
        amount := round(v_daily * p_lwp_days, case coalesce(p.lwp_rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else v_prec end);
        calc_type := 'lwp'; calc_base := coalesce(p.lwp_basis, p.lwp_divisor_basis);
        calc_note := format('%s day(s) x daily %s (%s / %s)', p_lwp_days, v_daily, v_lb, v_ld);
        unresolved := false; return next;
      end if;
    end;
  end if;

  -- ---- 5. Statutory (PF / ESI / PT / TDS / Gratuity / Other) ----
  for r in
    select * from public.payroll_statutory_rules sr
    where sr.payroll_policy_id = p_policy_id and sr.enabled
      and sr.effective_from <= p_period_end and (sr.effective_to is null or sr.effective_to >= p_period_start)
    order by array_position(array['pf','esi','pt','tds','gratuity','other'], sr.kind)
  loop
    v_has_struct_stat := p_structure_id is not null and exists (
      select 1 from public.salary_structure_components c
      where c.salary_structure_id = p_structure_id and c.is_active and c.statutory_kind = r.kind);
    if v_has_struct_stat or (upper(r.kind) = any(p_existing_codes)) then continue; end if;

    v_sbase := case r.calc_base
      when 'basic'    then p_basic
      when 'basic_da' then p_basic + p_da
      when 'gross'    then p_gross
      when 'custom'   then public.payroll_eval_formula(r.base_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross))
      else null end;
    if r.wage_ceiling is not null and v_sbase is not null then v_sbase := least(v_sbase, r.wage_ceiling); end if;
    v_prec := case coalesce(r.rounding, 'round_2') when 'nearest_rupee' then 0 when 'none' then 6 else coalesce(p.currency_precision, 2) end;

    if r.kind = 'pt' then
      select s.amount into v_amt from public.payroll_pt_slabs s
      where s.payroll_policy_id = p_policy_id
        and s.effective_from <= p_period_end and (s.effective_to is null or s.effective_to >= p_period_start)
        and coalesce(v_sbase, p_gross) >= s.min_salary and (s.max_salary is null or coalesce(v_sbase, p_gross) <= s.max_salary)
      order by s.min_salary desc limit 1;
      kind := 'deduction_pt'; line_type := 'deduction'; code := 'PT'; name := 'Professional Tax';
      quantity := null; rate := null; calc_type := 'statutory_pt'; calc_base := coalesce(r.calc_base, 'gross');
      if v_amt is null then amount := 0; unresolved := true; calc_note := 'PT slabs not configured for this salary.';
      else amount := round(v_amt, 0); unresolved := false; calc_note := format('PT slab @ %s', coalesce(v_sbase, p_gross)); end if;
      return next;

    elsif r.kind = 'tds' then
      kind := 'deduction_tds'; line_type := 'deduction'; code := 'TDS'; name := 'TDS';
      quantity := null; rate := null; calc_type := 'statutory_tds'; calc_base := r.calc_base;
      if p_tds is not null and coalesce((p_tds ->> 'configured')::boolean, false) then
        amount := round(coalesce((p_tds ->> 'monthly_tds')::numeric, 0), v_prec); unresolved := false;
        calc_note := format('TDS %s regime - annual %s / 12 (slab %s%%)', p_tds ->> 'tax_regime', p_tds ->> 'final_annual_tds', coalesce(p_tds ->> 'slab_rate', '?'));
      elsif p_tds is not null then
        amount := 0; unresolved := true; calc_note := 'TDS Not Configured - ' || coalesce(p_tds ->> 'reason', 'incomplete TDS policy.');
      elsif coalesce(btrim(r.base_formula), '') <> '' then
        amount := round(coalesce(public.payroll_eval_formula(r.base_formula, jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec);
        unresolved := false; calc_note := 'TDS via configured formula.';
      else
        amount := 0; unresolved := true; calc_note := 'TDS Not Configured - no tax engine / policy supplied.';
      end if;
      return next;

    else
      -- ============ PF / ESI / Gratuity / Other ============
      if r.calc_method = 'pct_of_base' then
        -- ----- original behaviour, unchanged -----
        if r.kind = 'esi' and r.wage_ceiling is not null and p_gross > r.wage_ceiling then
          kind := 'deduction_esi'; line_type := 'deduction'; code := 'ESI'; name := 'ESI';
          quantity := null; rate := 0; amount := 0; calc_type := 'statutory_esi'; calc_base := coalesce(r.calc_base, 'gross');
          calc_note := format('ESI not applicable - gross %s above ceiling %s.', p_gross, r.wage_ceiling); unresolved := false;
          return next;
        else
          kind := 'deduction_' || r.kind; line_type := 'deduction';
          code := upper(r.kind); name := (case r.kind when 'pf' then 'Provident Fund' when 'esi' then 'ESI' when 'gratuity' then 'Gratuity (employee)' else 'Statutory' end);
          quantity := null; calc_type := 'statutory_' || r.kind; calc_base := r.calc_base;
          if r.employee_rate is null then
            rate := null; amount := 0; unresolved := true; calc_note := format('%s employee rate not configured.', upper(r.kind));
          elsif v_sbase is null then
            rate := r.employee_rate; amount := 0; unresolved := true; calc_note := format('%s calculation base not configured.', upper(r.kind));
          else
            rate := r.employee_rate; amount := round(v_sbase * r.employee_rate / 100.0, v_prec); unresolved := false;
            calc_note := format('%s%% of %s (%s)%s', r.employee_rate, coalesce(r.calc_base, 'base'), v_sbase,
                                case when r.wage_ceiling is not null then format(' capped @ %s', r.wage_ceiling) else '' end);
          end if;
          return next;
        end if;

        if r.employer_rate is not null and v_sbase is not null then
          kind := 'employer_' || r.kind; line_type := 'employer_contribution';
          code := upper(r.kind) || '_ER'; name := 'Employer ' || upper(r.kind);
          quantity := null; rate := r.employer_rate; amount := round(v_sbase * r.employer_rate / 100.0, v_prec);
          calc_type := 'employer_' || r.kind; calc_base := r.calc_base;
          calc_note := format('%s%% of %s (%s) - employer', r.employer_rate, coalesce(r.calc_base, 'base'), v_sbase); unresolved := false;
          return next;
        end if;

      else
        -- ----- fixed_amount / pct_of_component / formula / manual -----
        v_mkey := upper(r.kind);
        v_emp_amt := null; v_er_amt := null; v_mnote := null; v_munres := false;

        if r.calc_method = 'manual' then
          v_man := coalesce(p_manual_components -> v_mkey, p_manual_components -> lower(v_mkey));
          if v_man is null or (v_man ->> 'employee_amount') is null then
            v_munres := true;
            v_mnote := format('%s: Manual / Excel amount not entered for this employee and payroll period.', v_mkey);
          else
            v_emp_amt := round((v_man ->> 'employee_amount')::numeric, v_prec);   -- explicit 0 is respected
            v_er_amt := case when (v_man ->> 'employer_amount') is not null
                             then round((v_man ->> 'employer_amount')::numeric, v_prec) else null end;
            v_mnote := format('%s: manual/imported amount for this payroll period (%s).', v_mkey, coalesce(v_man ->> 'source', 'manual'));
          end if;

        elsif r.calc_method = 'fixed_amount' then
          if r.employee_amount is null then
            v_munres := true; v_mnote := format('%s: fixed amount not configured.', v_mkey);
          else
            v_emp_amt := round(r.employee_amount, v_prec);
            v_er_amt := case when r.employer_amount is not null then round(r.employer_amount, v_prec) else null end;
            v_mnote := format('%s: fixed amount %s.', v_mkey, v_emp_amt);
          end if;

        elsif r.calc_method = 'pct_of_component' then
          v_refamt := (p_component_amounts ->> coalesce(r.ref_component_code, ''))::numeric;
          if coalesce(btrim(r.ref_component_code), '') = '' or v_refamt is null then
            v_munres := true;
            v_mnote := format('%s: %% of component "%s" - the referenced component is not present in this payslip.', v_mkey, coalesce(r.ref_component_code, '?'));
          elsif r.employee_rate is null then
            v_munres := true; v_mnote := format('%s: %% of component rate not configured.', v_mkey);
          else
            if r.wage_ceiling is not null then v_refamt := least(v_refamt, r.wage_ceiling); end if;
            v_emp_amt := round(v_refamt * r.employee_rate / 100.0, v_prec);
            v_er_amt := case when r.employer_rate is not null then round(v_refamt * r.employer_rate / 100.0, v_prec) else null end;
            v_mnote := format('%s: %s%% of %s (%s).', v_mkey, r.employee_rate, r.ref_component_code, v_refamt);
          end if;

        elsif r.calc_method = 'formula' then
          if coalesce(btrim(r.base_formula), '') = '' then
            v_munres := true; v_mnote := format('%s: custom formula not configured.', v_mkey);
          else
            v_emp_amt := round(coalesce(public.payroll_eval_formula(r.base_formula,
                          jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec);
            v_er_amt := case when coalesce(btrim(r.employer_formula), '') <> ''
                             then round(coalesce(public.payroll_eval_formula(r.employer_formula,
                                   jsonb_build_object('BASIC', p_basic, 'DA', p_da, 'GROSS', p_gross)), 0), v_prec)
                             else null end;
            v_mnote := format('%s: custom formula.', v_mkey);
          end if;
        end if;

        -- employee deduction line
        kind := 'deduction_' || r.kind; line_type := 'deduction';
        code := upper(r.kind); name := (case r.kind when 'pf' then 'Provident Fund' when 'esi' then 'ESI' when 'gratuity' then 'Gratuity (employee)' else 'Statutory' end);
        quantity := null;
        rate := case when r.calc_method = 'pct_of_component' then r.employee_rate else null end;
        calc_type := 'statutory_' || r.kind;
        calc_base := coalesce(r.calc_base, case when r.calc_method = 'pct_of_component' then r.ref_component_code else r.calc_method end);
        if v_munres then amount := 0; unresolved := true; calc_note := v_mnote;
        else amount := coalesce(v_emp_amt, 0); unresolved := false; calc_note := v_mnote; end if;
        return next;

        -- employer contribution line (only when the method produced one)
        if v_er_amt is not null then
          kind := 'employer_' || r.kind; line_type := 'employer_contribution';
          code := upper(r.kind) || '_ER'; name := 'Employer ' || upper(r.kind);
          quantity := null;
          rate := case when r.calc_method = 'pct_of_component' then r.employer_rate else null end;
          amount := v_er_amt; calc_type := 'employer_' || r.kind; calc_base := r.calc_base;
          calc_note := format('%s employer contribution (%s).', upper(r.kind), r.calc_method); unresolved := false;
          return next;
        end if;
      end if;
    end if;
  end loop;

  return;
end;
$function$;
grant execute on function public.payroll_policy_compute_lines(uuid,date,date,numeric,date,numeric,numeric,numeric,numeric,numeric,numeric,uuid,text[],date,boolean,jsonb,jsonb,jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- N. payroll_apply_policy â€” threads the per-employee manual PF/ESI amounts and
--    the current payslip component amounts into payroll_policy_compute_lines.
-- ----------------------------------------------------------------------------
drop function if exists public.payroll_apply_policy(uuid,uuid,date,date,numeric,date,numeric,numeric,numeric,numeric,numeric,numeric,uuid,date,boolean);

CREATE OR REPLACE FUNCTION public.payroll_apply_policy(p_result_id uuid, p_policy_id uuid, p_period_start date, p_period_end date, p_working_days numeric, p_joining_date date, p_basic numeric, p_da numeric, p_gross numeric, p_lwp_days numeric, p_ot_minutes numeric, p_nd_value numeric, p_structure_id uuid, p_leaving_date date DEFAULT NULL::date, p_exit_date_payable boolean DEFAULT NULL::boolean, p_manual_components jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_run uuid; v_company uuid; v_emp uuid;
  v_existing text[];
  v_comp_amounts jsonb := '{}'::jsonb;
  l record;
  v_gross numeric := p_gross;
  v_empc numeric := 0;
  v_lwp numeric := 0;
  v_stat_total numeric := 0;
  v_prorate numeric := 0;
  v_prorate_exit numeric := 0;
  v_deds jsonb := '[]'::jsonb;
  v_fin jsonb;
  o jsonb;
  v_note text := '';
  v_unresolved boolean := false;
  p public.payroll_policies;
  v_tds_pol public.tds_policies;
  v_tds jsonb := null;
  v_annual numeric;
  v_decl record;
  v_fy_start date;
begin
  select payroll_run_id, company_id, employee_id into v_run, v_company, v_emp
  from public.payroll_employee_results where id = p_result_id;
  select * into p from public.payroll_policies where id = p_policy_id;

  select coalesce(array_agg(code), '{}') into v_existing
  from public.payroll_lines where payroll_employee_result_id = p_result_id;

  -- component amounts already on this payslip (for a 'pct_of_component' statutory method)
  select coalesce(jsonb_object_agg(code, amt), '{}'::jsonb) into v_comp_amounts
  from (select code, sum(amount) as amt from public.payroll_lines
        where payroll_employee_result_id = p_result_id and line_type = 'earning' group by code) s;

  -- ---- real TDS resolution (inert unless fully configured) ----
  v_tds_pol := public.tds_resolve_policy(v_company, p_period_end);
  if v_tds_pol.id is not null then
    if v_tds_pol.annualization_method = 'flat_x12' then
      v_fy_start := coalesce(v_tds_pol.financial_year_start, make_date(extract(year from p_period_end)::int, 4, 1));
      select * into v_decl from public.tds_employee_declarations
      where employee_id = v_emp and financial_year_start = v_fy_start;
      v_annual := greatest(
        p_gross * 12
        + coalesce(v_decl.previous_employer_income, 0)
        + coalesce(v_decl.other_income, 0)
        - coalesce(v_tds_pol.standard_deduction, 0)
        - coalesce(v_decl.investment_declared, 0)
        - coalesce(v_decl.other_exemptions, 0), 0);
      v_tds := public.tds_compute(v_tds_pol.id, v_annual);
    else
      v_tds := jsonb_build_object('configured', false,
        'reason', format('Annualization method "%s" needs year-to-date income (not available in a single run).', coalesce(v_tds_pol.annualization_method, 'not defined')));
    end if;
  end if;

  -- 1. policy-driven lines
  for l in select * from public.payroll_policy_compute_lines(
             p_policy_id, p_period_start, p_period_end, p_working_days, p_joining_date,
             p_basic, p_da, p_gross, p_lwp_days, p_ot_minutes, p_nd_value, p_structure_id, v_existing,
             p_leaving_date, p_exit_date_payable, v_tds, coalesce(p_manual_components, '{}'::jsonb), v_comp_amounts)
  loop
    insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id,
      line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, calc_formula, sort_order)
    values (v_company, v_run, p_result_id, v_emp, l.line_type, l.code, l.name, l.quantity, l.rate, l.amount,
      'payroll_policy', l.calc_type, l.calc_base, l.calc_note,
      case l.kind
        when 'earning_ot' then 60 when 'earning_nd' then 65 when 'earning_prorate' then 70 when 'earning_prorate_exit' then 72
        when 'deduction_pf' then 300 when 'deduction_esi' then 310 when 'deduction_pt' then 320
        when 'deduction_tds' then 330 when 'deduction_lwp' then 350
        when 'employer_pf' then 400 when 'employer_esi' then 410 when 'employer_gratuity' then 420
        else 360 end);

    if l.line_type = 'earning' then v_gross := v_gross + l.amount;
    elsif l.line_type = 'employer_contribution' then v_empc := v_empc + l.amount;
    end if;
    if l.kind = 'deduction_lwp' then v_lwp := l.amount; end if;
    if l.kind = 'earning_prorate' then v_prorate := l.amount; end if;
    if l.kind = 'earning_prorate_exit' then v_prorate_exit := l.amount; end if;
    if l.calc_type like 'statutory_%' then v_stat_total := v_stat_total + l.amount; end if;
    if l.unresolved then v_unresolved := true; v_note := v_note || coalesce(l.calc_note, '') || ' '; end if;
  end loop;

  -- 2. collect ALL employee-deduction lines for finalize
  for l in select code, amount from public.payroll_lines
           where payroll_employee_result_id = p_result_id and line_type = 'deduction'
  loop
    v_deds := v_deds || jsonb_build_object('code', l.code, 'amount', l.amount, 'protected', l.code = 'ADVREC');
  end loop;

  v_fin := public.payroll_policy_finalize(p_policy_id, v_gross, v_deds);

  for o in select * from jsonb_array_elements(v_fin -> 'ordered') loop
    if (o ? 'capped') or (o ? 'neg_blocked') then
      update public.payroll_lines
      set amount = (o ->> 'amount')::numeric,
          calc_formula = coalesce(calc_formula, '') ||
            case when (o ? 'capped') then ' [reduced by deduction cap]' else '' end ||
            case when (o ? 'neg_blocked') then ' [reduced to block negative net]' else '' end
      where payroll_employee_result_id = p_result_id and line_type = 'deduction' and code = (o ->> 'code');
    end if;
  end loop;

  if (v_fin ->> 'cap_reduction')::numeric > 0 then v_note := v_note || format('Deduction cap trimmed %s. ', v_fin ->> 'cap_reduction'); end if;
  if (v_fin ->> 'negative_flag')::boolean then v_note := v_note || format('Negative net (%s policy). ', v_fin ->> 'negative_net_policy'); end if;
  if not (v_fin ->> 'priority_configured')::boolean
     and exists (select 1 from public.payroll_lines where payroll_employee_result_id = p_result_id and line_type = 'deduction') then
    v_note := v_note || 'Deduction priority not configured. ';
  end if;

  -- ---- TDS calculation snapshot (only when it actually computed) ----
  if v_tds is not null and coalesce((v_tds ->> 'configured')::boolean, false) then
    insert into public.tds_calculations (company_id, payroll_employee_result_id, employee_id, tds_policy_id, tds_policy_version,
      tax_regime, annual_projected_income, taxable_income, applicable_slab_id, slab_rate, computed_tax, rebate, cess, final_annual_tds, monthly_tds, snapshot)
    values (v_company, p_result_id, v_emp, v_tds_pol.id, (v_tds ->> 'policy_version')::int,
      v_tds ->> 'tax_regime', v_annual, (v_tds ->> 'annual_taxable')::numeric,
      nullif(v_tds ->> 'applicable_slab_id', '')::uuid, (v_tds ->> 'slab_rate')::numeric,
      (v_tds ->> 'computed_tax_before_rebate')::numeric, (v_tds ->> 'rebate')::numeric, (v_tds ->> 'cess')::numeric,
      (v_tds ->> 'final_annual_tds')::numeric, (v_tds ->> 'monthly_tds')::numeric, v_tds)
    on conflict (payroll_employee_result_id) do update set
      snapshot = excluded.snapshot, monthly_tds = excluded.monthly_tds, final_annual_tds = excluded.final_annual_tds,
      taxable_income = excluded.taxable_income, annual_projected_income = excluded.annual_projected_income, computed_at = now();
  end if;

  return jsonb_build_object(
    'gross', v_gross,
    'total_deductions', (v_fin ->> 'total_deductions')::numeric,
    'net', (v_fin ->> 'net')::numeric,
    'employer_contribution_extra', v_empc,
    'lwp_amount', v_lwp,
    'prorate_amount', v_prorate,
    'prorate_exit_amount', v_prorate_exit,
    'statutory_total', v_stat_total,
    'needs_review', v_unresolved or (v_fin ->> 'negative_flag')::boolean,
    'review_note', nullif(btrim(v_note), ''),
    'snapshot', jsonb_build_object(
      'policy_id', p_policy_id, 'policy_code', p.code, 'policy_name', p.policy_name, 'version_no', p.version_no,
      'effective_from', p.effective_from, 'effective_to', p.effective_to,
      'proration_method', p.proration_method, 'proration_basis', p.proration_basis, 'exit_date_payable', p.exit_date_payable,
      'lwp', jsonb_build_object('enabled', p.lwp_enabled, 'basis', coalesce(p.lwp_basis, p.lwp_divisor_basis), 'method', coalesce(p.lwp_proration_method, p.proration_method), 'divisor', p.lwp_divisor),
      'overtime', jsonb_build_object('enabled', p.ot_enabled, 'rate_type', p.ot_rate_type, 'rate', p.ot_rate, 'std_hours_per_day', p.ot_std_hours_per_day),
      'night_duty', jsonb_build_object('enabled', p.nd_earning_enabled, 'rate_type', p.nd_rate_type, 'rate', p.nd_rate),
      'statutory', (select coalesce(jsonb_agg(jsonb_build_object('kind', sr.kind, 'enabled', sr.enabled, 'calc_method', sr.calc_method, 'base', sr.calc_base, 'employee_rate', sr.employee_rate, 'employer_rate', sr.employer_rate, 'employee_amount', sr.employee_amount, 'employer_amount', sr.employer_amount, 'ref_component_code', sr.ref_component_code, 'ceiling', sr.wage_ceiling)), '[]'::jsonb)
                    from public.payroll_statutory_rules sr where sr.payroll_policy_id = p_policy_id),
      'manual_components', coalesce(p_manual_components, '{}'::jsonb),
      'tds', coalesce(v_tds, jsonb_build_object('configured', false, 'reason', 'No active TDS policy for this company/period.')),
      'deduction_cap', jsonb_build_object('mode', p.deduction_cap_mode, 'value', p.deduction_cap_value),
      'negative_net_policy', p.negative_net_policy,
      'deduction_order', (select coalesce(jsonb_agg(jsonb_build_object('code', d.deduction_code, 'priority', d.priority) order by d.priority), '[]'::jsonb)
                          from public.payroll_deduction_order d where d.payroll_policy_id = p_policy_id and d.is_active)
    )
  );
end;
$function$;
grant execute on function public.payroll_apply_policy(uuid,uuid,date,date,numeric,date,numeric,numeric,numeric,numeric,numeric,numeric,uuid,date,boolean,jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- O. payroll_calculate_run — resolve each employee's manual/imported PF/ESI
--    amounts for the period and hand them to payroll_apply_policy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_calculate_run(p_payroll_run_id uuid)
 RETURNS payroll_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_run public.payroll_runs;
  v_period public.payroll_periods;
  v_pol public.payroll_policies;
  v_emp record;
  v_sal record;
  v_comp record;
  v_rec record;
  v_bif record;
  v_adv_period_id uuid;
  v_result_id uuid;
  v_basic numeric; v_da numeric;
  v_present_full numeric; v_half numeric; v_woff numeric; v_holi numeric; v_absent numeric; v_att_leave numeric;
  v_ot_min numeric; v_nd_val numeric;
  v_paid_leave numeric; v_lwp_days numeric; v_unassigned int;
  v_calendar int; v_working numeric; v_present numeric; v_paid_days numeric; v_unpaid_days numeric;
  v_gross numeric; v_ded numeric; v_advrec numeric; v_net numeric; v_empc numeric;
  v_qty numeric; v_rate numeric; v_amt numeric;
  v_review boolean; v_notes text; v_hasneg boolean;
  v_res_gross numeric; v_struct_id uuid; v_ambig boolean; v_resolve_note text; v_src text; v_ltype text; v_advrec_extra numeric;
  v_join date; v_leave date; v_exit_pay boolean; v_pol_j jsonb; v_gross_pre numeric;
  v_cal public.store_payroll_calendars; v_cal_wd numeric;
  v_elig_start date; v_elig_end date; v_eligible_days numeric; v_ss_scope text;
  v_manual_comp jsonb;
  v_r_gross numeric := 0; v_r_ded numeric := 0; v_r_adv numeric := 0; v_r_net numeric := 0; v_cnt int := 0;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then
    raise exception 'You are not authorised to run payroll for this company.' using errcode = '42501';
  end if;
  if v_run.status not in ('draft', 'processing', 'calculated') then
    raise exception 'Payroll run is % - a finalized/locked/reversed run cannot be recalculated.', v_run.status;
  end if;
  if not v_run.is_current then raise exception 'This is not the current run for its period.'; end if;

  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id;
  v_calendar := (v_period.period_end_date - v_period.period_start_date + 1);

  update public.payroll_runs set status = 'processing', started_at = coalesce(started_at, now()), processed_by = auth.uid() where id = v_run.id;
  delete from public.payroll_lines where payroll_run_id = v_run.id;
  delete from public.payroll_employee_results where payroll_run_id = v_run.id;

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
    select e.id, e.full_name, e.employee_code, e.store_id, e.store_department_id, e.store_designation_id,
           e.joining_date, e.leaving_date
    from public.employees e
    where e.company_id = v_run.company_id
      and (e.status in ('active', 'on_leave', 'notice_period')
           or (e.status in ('resigned', 'terminated', 'transferred') and e.leaving_date is not null and e.leaving_date >= v_period.period_start_date))
      and (e.joining_date is null or e.joining_date <= v_period.period_end_date)
      and (e.leaving_date is null or e.leaving_date >= v_period.period_start_date)
    order by e.full_name
  loop
    v_review := false; v_notes := ''; v_basic := 0; v_da := 0; v_empc := 0; v_advrec := 0; v_gross := 0; v_ded := 0;
    v_join := v_emp.joining_date; v_leave := v_emp.leaving_date;

    -- per-employee scoped Payroll Policy (falls back to the company-wide active policy)
    select * into v_pol from public.payroll_resolve_policy_for_employee(v_run.company_id, v_emp.id, v_period.period_end_date);
    v_exit_pay := v_pol.exit_date_payable;

    -- per-employee manual / imported PF/ESI amounts for THIS period (calc_method = 'manual')
    select coalesce(jsonb_object_agg(upper(pca.component_code),
             jsonb_build_object('employee_amount', pca.employee_amount, 'employer_amount', pca.employer_amount, 'source', pca.source)), '{}'::jsonb)
      into v_manual_comp
    from public.payroll_component_amounts pca
    where pca.payroll_period_id = v_period.id and pca.employee_id = v_emp.id;

    select sc.basic_salary, sc.da, sc.effective_from into v_sal
    from public.employee_salary_components sc
    where sc.employee_id = v_emp.id
      and sc.effective_from <= v_period.period_end_date
      and (sc.effective_to is null or sc.effective_to >= v_period.period_start_date)
    order by sc.effective_from desc limit 1;

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

    -- Store Calendar working days (Â§28) - only when the policy asks for it
    v_cal := null; v_cal_wd := null;
    if v_pol.working_days_method = 'store_calendar' then
      v_cal := public.payroll_resolve_store_calendar(v_run.company_id, v_emp.store_id, v_period.period_end_date);
      if v_cal.id is not null then
        v_cal_wd := public.payroll_calendar_working_days(v_cal.id, v_period.period_start_date, v_period.period_end_date);
        if v_cal_wd is not null then v_working := v_cal_wd; end if;
      else
        v_review := true; v_notes := v_notes || 'Store calendar working-days method selected but no active calendar resolves. ';
      end if;
    end if;

    -- Eligible days (joining / leaving inside the period)
    v_elig_start := greatest(v_period.period_start_date, coalesce(v_join, v_period.period_start_date));
    v_elig_end := case
      when v_leave is null then v_period.period_end_date
      when v_exit_pay is true then least(v_leave, v_period.period_end_date)
      when v_exit_pay is false then least(v_leave - 1, v_period.period_end_date)
      else v_period.period_end_date end;
    v_eligible_days := greatest((v_elig_end - v_elig_start) + 1, 0);

    insert into public.payroll_employee_results (
      company_id, payroll_run_id, payroll_period_id, employee_id,
      employee_code_snapshot, employee_name_snapshot, department_snapshot, designation_snapshot, store_snapshot,
      salary_effective_from, basic_snapshot, da_snapshot,
      calendar_days, working_days, present_days, paid_leave_days, lwp_days, weekly_off_days, holiday_days, absent_days, paid_days, unpaid_days,
      payroll_policy_id, store_calendar_id, store_calendar_snapshot, leaving_date_snapshot, eligible_days, status
    ) values (
      v_run.company_id, v_run.id, v_period.id, v_emp.id,
      v_emp.employee_code, v_emp.full_name,
      (select sd.name from public.store_departments sd where sd.id = v_emp.store_department_id),
      (select sg.title from public.store_designations sg where sg.id = v_emp.store_designation_id),
      (select s.name from public.stores s where s.id = v_emp.store_id),
      v_sal.effective_from, coalesce(v_sal.basic_salary, 0), coalesce(v_sal.da, 0),
      v_calendar, v_working, v_present, coalesce(v_paid_leave, 0), coalesce(v_lwp_days, 0), coalesce(v_woff, 0), coalesce(v_holi, 0), coalesce(v_absent, 0), v_paid_days, v_unpaid_days,
      v_pol.id, v_cal.id,
      case when v_cal.id is not null then jsonb_build_object('calendar_id', v_cal.id, 'name', v_cal.name, 'effective_from', v_cal.effective_from, 'effective_to', v_cal.effective_to,
        'weekly_off_days', to_jsonb(v_cal.weekly_off_days), 'alternate_saturday_off', v_cal.alternate_saturday_off, 'holiday_source', v_cal.holiday_source, 'working_days', v_cal_wd) else null end,
      v_leave, v_eligible_days, 'calculated'
    ) returning id into v_result_id;

    -- ================= PHASE 5A: dynamic salary structure path =================
    select r.gross_salary, r.salary_structure_id, r.ambiguous, r.resolve_note, r.source
      into v_res_gross, v_struct_id, v_ambig, v_resolve_note, v_src
    from public.salary_resolve_for_employee(v_emp.id, v_period.period_end_date) r;
    v_ss_scope := (regexp_match(coalesce(v_src, ''), 'assign_([a-z_]+)'))[1];

    if v_ambig then
      update public.payroll_employee_results
      set needs_review = true, review_notes = coalesce(v_resolve_note, 'Ambiguous salary structure - resolve the assignment.'),
          gross_earnings = 0, total_deductions = 0, net_salary = 0, salary_structure_scope = v_ss_scope
      where id = v_result_id;
      v_cnt := v_cnt + 1;
      continue;
    end if;

    if v_struct_id is not null then
      begin
        for v_bif in select * from public.salary_bifurcate(v_struct_id, v_res_gross) loop
          if v_bif.calculation_type = 'advance_recovery' then
            if exists (select 1 from public.advance_recovery_transactions x
                       where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
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
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, amount, source, calc_type, calculation_ref, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, 'deduction', v_bif.code, v_bif.name, round(v_advrec, 2), 'advance_recovery', 'advance_recovery',
                    'advance_payroll_period:' || v_adv_period_id::text, v_bif.display_order);
            v_ded := v_ded + round(v_advrec, 2);
          else
            v_ltype := case v_bif.category when 'earning' then 'earning' when 'employer_contribution' then 'employer_contribution' else 'deduction' end;
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, calc_formula, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_ltype, v_bif.code, v_bif.name, null, v_bif.calc_rate, v_bif.amount, v_bif.category, v_bif.calculation_type, v_bif.calc_base, v_bif.calc_formula, v_bif.display_order);
            if v_ltype = 'earning' then v_gross := v_gross + v_bif.amount;
            elsif v_ltype = 'employer_contribution' then v_empc := v_empc + v_bif.amount;
            else v_ded := v_ded + v_bif.amount; end if;
            if v_bif.is_basic then v_basic := v_bif.amount; end if;
            if v_bif.code = 'DA' then v_da := v_bif.amount; end if;
          end if;
        end loop;

        if not exists (select 1 from public.payroll_lines where payroll_employee_result_id = v_result_id and calc_type = 'advance_recovery') then
          if exists (select 1 from public.advance_recovery_transactions x
                     where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
            select coalesce(sum(x.amount), 0) into v_advrec_extra
            from public.advance_recovery_transactions x
            where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
              and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
          else
            v_advrec_extra := 0;
            for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
              v_advrec_extra := v_advrec_extra + coalesce(v_rec.deducted_amount, 0);
            end loop;
          end if;
          if coalesce(v_advrec_extra, 0) > 0 or exists (select 1 from public.advance_recovery_plans p where p.employee_id = v_emp.id and p.status in ('recovering', 'recovery_pending')) then
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, amount, source, calc_type, calculation_ref, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, 'deduction', 'ADVREC', 'Advance Recovery', round(coalesce(v_advrec_extra, 0), 2), 'advance_recovery', 'advance_recovery',
                    'advance_payroll_period:' || v_adv_period_id::text, 95);
            v_ded := v_ded + round(coalesce(v_advrec_extra, 0), 2);
            v_advrec := coalesce(v_advrec_extra, 0);
          end if;
        end if;
      exception when others then
        delete from public.payroll_lines where payroll_employee_result_id = v_result_id;
        v_gross := 0; v_ded := 0; v_empc := 0; v_advrec := 0;
        v_review := true; v_notes := v_notes || 'Salary structure calculation failed: ' || sqlerrm || '. ';
      end;

      -- Overtime is NEVER emitted by the flat component master here — it is a system-calculated
      -- line owned solely by payroll_policy_compute_lines, sourced from the Attendance OT Rule
      -- Engine (payable_overtime_minutes). Night Duty stays as-is when its policy toggle is off.
      for v_comp in
        select * from public.payroll_salary_components
        where company_id = v_run.company_id and is_active and component_type = 'earning' and source = 'night_duty'
          and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
          and not v_pol.nd_earning_enabled
        order by sort_order, code
      loop
        v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate; v_amt := 0;
        if v_rate is null then
          if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
        insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
        values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, 'attendance_input', v_comp.sort_order);
        v_gross := v_gross + v_amt;
      end loop;

      v_gross_pre := v_gross;
      v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                  v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), v_struct_id,
                  v_leave, v_exit_pay, v_manual_comp);
      v_gross := (v_pol_j ->> 'gross')::numeric;
      v_ded := (v_pol_j ->> 'total_deductions')::numeric;
      v_net := (v_pol_j ->> 'net')::numeric;
      v_empc := v_empc + (v_pol_j ->> 'employer_contribution_extra')::numeric;
      if (v_pol_j ->> 'needs_review')::boolean then v_review := true; end if;
      if coalesce(v_pol_j ->> 'review_note', '') <> '' then v_notes := v_notes || (v_pol_j ->> 'review_note') || ' '; end if;
      v_hasneg := v_net < 0;

      update public.payroll_employee_results
      set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2),
          employer_contribution_total = v_empc, net_salary = v_net,
          salary_structure_id = v_struct_id, gross_from_structure = v_res_gross, structure_reconciled = true,
          basic_snapshot = v_basic, da_snapshot = v_da,
          policy_snapshot = v_pol_j -> 'snapshot',
          proration_factor = case when v_gross_pre = 0 then null else round(v_gross / nullif(v_gross_pre, 0), 6) end,
          lwp_deduction_amount = coalesce((v_pol_j ->> 'lwp_amount')::numeric, 0),
          statutory_deduction_total = coalesce((v_pol_j ->> 'statutory_total')::numeric, 0),
          exit_proration_amount = coalesce((v_pol_j ->> 'prorate_exit_amount')::numeric, 0),
          salary_structure_scope = v_ss_scope,
          has_negative_net = v_hasneg, needs_review = v_review, review_notes = nullif(v_notes, '')
      where id = v_result_id;

      v_r_gross := v_r_gross + v_gross; v_r_ded := v_r_ded + v_ded; v_r_adv := v_r_adv + round(v_advrec, 2); v_r_net := v_r_net + v_net; v_cnt := v_cnt + 1;
      continue;
    end if;
    -- ================= LEGACY Basic+DA path =================

    v_basic := coalesce(v_sal.basic_salary, 0);
    v_da := coalesce(v_sal.da, 0);
    if v_sal.effective_from is null then v_review := true; v_notes := v_notes || 'No effective salary structure for this period. '; end if;

    v_gross := 0;
    -- Overtime (source='overtime') is EXCLUDED here: it is a system-calculated line owned solely
    -- by payroll_policy_compute_lines, valued from the Attendance OT Rule's payable_overtime_minutes.
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'earning'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        and source <> 'overtime'
        and not (source = 'night_duty' and v_pol.nd_earning_enabled)
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.source = 'basic' then v_amt := round(v_basic, 2);
      elsif v_comp.source = 'da' then v_amt := round(v_da, 2);
      elsif v_comp.source = 'night_duty' then
        v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate;
        if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
      else v_amt := 0; end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, v_comp.calculation_method, v_comp.sort_order);
      v_gross := v_gross + v_amt;
    end loop;

    v_ded := 0; v_advrec := 0;
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'deduction'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        and not (calculation_method = 'lwp' and v_pol.lwp_enabled)
        and not (source = 'statutory' and exists (
                   select 1 from public.payroll_statutory_rules sr
                   where sr.payroll_policy_id = v_pol.id and sr.enabled and upper(sr.kind) = payroll_salary_components.code))
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.calculation_method = 'not_configured' then v_amt := 0;
      elsif v_comp.calculation_method = 'lwp' then
        if v_pol.lwp_divisor is not null and coalesce(v_lwp_days, 0) > 0 then
          v_rate := round((case v_pol.lwp_divisor_basis when 'basic' then v_basic when 'gross' then v_gross else v_basic + v_da end) / v_pol.lwp_divisor, 4);
          v_qty := v_lwp_days; v_amt := round(v_rate * v_lwp_days, 2);
        else
          v_amt := 0;
          if coalesce(v_lwp_days, 0) > 0 then v_review := true; v_notes := v_notes || format('%s LWP day(s) - LWP salary divisor not configured. ', v_lwp_days); end if;
        end if;
      elsif v_comp.calculation_method = 'advance_recovery' then
        if exists (select 1 from public.advance_recovery_transactions x
                   where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
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
      else v_amt := 0; end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, calculation_ref, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'deduction', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, v_comp.calculation_method,
              case when v_comp.calculation_method = 'advance_recovery' then 'advance_payroll_period:' || v_adv_period_id::text else null end, v_comp.sort_order);
      v_ded := v_ded + v_amt;
    end loop;

    v_gross_pre := v_gross;
    v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), null,
                v_leave, v_exit_pay, v_manual_comp);
    v_gross := (v_pol_j ->> 'gross')::numeric;
    v_ded := (v_pol_j ->> 'total_deductions')::numeric;
    v_net := (v_pol_j ->> 'net')::numeric;
    v_empc := (v_pol_j ->> 'employer_contribution_extra')::numeric;
    if (v_pol_j ->> 'needs_review')::boolean then v_review := true; end if;
    if coalesce(v_pol_j ->> 'review_note', '') <> '' then v_notes := v_notes || (v_pol_j ->> 'review_note') || ' '; end if;
    v_hasneg := v_net < 0;

    update public.payroll_employee_results
    set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2), net_salary = v_net,
        employer_contribution_total = coalesce(v_empc, 0),
        policy_snapshot = v_pol_j -> 'snapshot',
        proration_factor = case when v_gross_pre = 0 then null else round(v_gross / nullif(v_gross_pre, 0), 6) end,
        lwp_deduction_amount = coalesce((v_pol_j ->> 'lwp_amount')::numeric, 0),
        statutory_deduction_total = coalesce((v_pol_j ->> 'statutory_total')::numeric, 0),
        exit_proration_amount = coalesce((v_pol_j ->> 'prorate_exit_amount')::numeric, 0),
        salary_structure_scope = v_ss_scope,
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
$function$;
grant execute on function public.payroll_calculate_run(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- Q. payroll_policy_preview — same manual-amount resolution for the preview.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_policy_preview(p_employee_id uuid, p_period_month date, p_inputs jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_company uuid; v_store uuid; v_pstart date; v_pend date; v_working numeric;
  v_pol public.payroll_policies;
  v_res record; v_struct uuid; v_gross numeric; v_basic numeric; v_da numeric;
  v_bif record;
  v_earn jsonb := '[]'::jsonb; v_ded jsonb := '[]'::jsonb; v_empc jsonb := '[]'::jsonb;
  l record; v_fin jsonb; o jsonb;
  v_g numeric := 0; v_join date; v_leave date; v_exit_pay boolean; v_adv numeric;
  v_lines_deds jsonb := '[]'::jsonb;
  v_cal public.store_payroll_calendars;
  v_manual_comp jsonb; v_comp_amounts jsonb := '{}'::jsonb;
  v_tds_pol public.tds_policies; v_tds jsonb := null; v_annual numeric; v_decl record; v_fy date;
begin
  select company_id, store_id, joining_date, leaving_date into v_company, v_store, v_join, v_leave from public.employees where id = p_employee_id;
  if v_company is null then raise exception 'Employee not found.'; end if;
  if not (public.is_super_admin() or (current_user_role() <> 'staff' and v_company = current_user_company_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  v_pstart := date_trunc('month', p_period_month)::date;
  v_pend := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  v_working := (v_pend - v_pstart + 1);
  v_pol := public.payroll_resolve_policy_for_employee(v_company, p_employee_id, v_pend);
  v_join := coalesce((p_inputs ->> 'joining_date')::date, v_join);
  v_leave := coalesce((p_inputs ->> 'leaving_date')::date, v_leave);
  v_exit_pay := v_pol.exit_date_payable;

  if v_pol.working_days_method = 'store_calendar' then
    v_cal := public.payroll_resolve_store_calendar(v_company, v_store, v_pend);
    if v_cal.id is not null then v_working := coalesce(public.payroll_calendar_working_days(v_cal.id, v_pstart, v_pend), v_working); end if;
  end if;

  select r.gross_salary, r.salary_structure_id into v_res from public.salary_resolve_for_employee(p_employee_id, v_pend) r;
  v_gross := coalesce((p_inputs ->> 'gross')::numeric, v_res.gross_salary, 0);
  v_struct := v_res.salary_structure_id;
  v_basic := coalesce((p_inputs ->> 'basic')::numeric, 0);
  v_da := coalesce((p_inputs ->> 'da')::numeric, 0);

  if v_struct is not null then
    for v_bif in select * from public.salary_bifurcate(v_struct, v_gross) loop
      if v_bif.calculation_type = 'advance_recovery' then continue;
      elsif v_bif.category = 'earning' then
        v_earn := v_earn || jsonb_build_object('code', v_bif.code, 'name', v_bif.name, 'amount', v_bif.amount, 'calc_type', v_bif.calculation_type, 'calc_base', v_bif.calc_base);
        v_g := v_g + v_bif.amount;
        if v_bif.is_basic then v_basic := v_bif.amount; end if;
        if v_bif.code = 'DA' then v_da := v_bif.amount; end if;
      elsif v_bif.category = 'employer_contribution' then
        v_empc := v_empc || jsonb_build_object('code', v_bif.code, 'name', v_bif.name, 'amount', v_bif.amount);
      else
        v_ded := v_ded || jsonb_build_object('code', v_bif.code, 'name', v_bif.name, 'amount', v_bif.amount, 'calc_type', v_bif.calculation_type);
        v_lines_deds := v_lines_deds || jsonb_build_object('code', v_bif.code, 'amount', v_bif.amount);
      end if;
    end loop;
  else
    v_g := v_gross;
    v_earn := jsonb_build_array(jsonb_build_object('code', 'GROSS', 'name', 'Gross (flat)', 'amount', v_gross, 'calc_type', 'flat'));
  end if;

  v_adv := coalesce((p_inputs ->> 'advance_recovery')::numeric, 0);
  if v_adv > 0 then
    v_ded := v_ded || jsonb_build_object('code', 'ADVREC', 'name', 'Advance Recovery', 'amount', v_adv, 'calc_type', 'advance_recovery');
    v_lines_deds := v_lines_deds || jsonb_build_object('code', 'ADVREC', 'amount', v_adv, 'protected', true);
  end if;
  for o in select * from jsonb_array_elements(coalesce(p_inputs -> 'other_deductions', '[]'::jsonb)) loop
    v_ded := v_ded || (o || jsonb_build_object('calc_type', 'other'));
    v_lines_deds := v_lines_deds || jsonb_build_object('code', o ->> 'code', 'amount', (o ->> 'amount')::numeric);
  end loop;

  -- real TDS (inert unless fully configured)
  v_tds_pol := public.tds_resolve_policy(v_company, v_pend);
  if v_tds_pol.id is not null then
    if v_tds_pol.annualization_method = 'flat_x12' then
      v_fy := coalesce(v_tds_pol.financial_year_start, make_date(extract(year from v_pend)::int, 4, 1));
      select * into v_decl from public.tds_employee_declarations where employee_id = p_employee_id and financial_year_start = v_fy;
      v_annual := greatest(v_g * 12 + coalesce(v_decl.previous_employer_income, 0) + coalesce(v_decl.other_income, 0)
        - coalesce(v_tds_pol.standard_deduction, 0) - coalesce(v_decl.investment_declared, 0) - coalesce(v_decl.other_exemptions, 0), 0);
      v_tds := public.tds_compute(v_tds_pol.id, v_annual);
    else
      v_tds := jsonb_build_object('configured', false, 'reason', format('Annualization method "%s" needs year-to-date income.', coalesce(v_tds_pol.annualization_method, 'not defined')));
    end if;
  end if;

  -- manual / imported PF/ESI amounts: explicit override in p_inputs, else this period's stored values
  v_manual_comp := coalesce(p_inputs -> 'manual_components', '{}'::jsonb);
  if v_manual_comp = '{}'::jsonb then
    select coalesce(jsonb_object_agg(upper(pca.component_code),
             jsonb_build_object('employee_amount', pca.employee_amount, 'employer_amount', pca.employer_amount, 'source', pca.source)), '{}'::jsonb)
      into v_manual_comp
    from public.payroll_component_amounts pca
    join public.payroll_periods pp on pp.id = pca.payroll_period_id
    where pp.company_id = v_company and pp.period_month = v_pstart and pca.employee_id = p_employee_id;
  end if;
  select coalesce(jsonb_object_agg(x ->> 'code', (x ->> 'amount')::numeric), '{}'::jsonb) into v_comp_amounts
  from jsonb_array_elements(v_earn) x;

  for l in select * from public.payroll_policy_compute_lines(
             v_pol.id, v_pstart, v_pend, v_working, v_join, v_basic, v_da, v_g,
             coalesce((p_inputs ->> 'lwp_days')::numeric, 0),
             coalesce((p_inputs ->> 'ot_minutes')::numeric, 0),
             coalesce((p_inputs ->> 'nd_value')::numeric, 0),
             v_struct, (select coalesce(array_agg(x->>'code'), '{}') from jsonb_array_elements(v_earn || v_ded) x),
             v_leave, v_exit_pay, v_tds, v_manual_comp, v_comp_amounts)
  loop
    if l.line_type = 'earning' then
      v_earn := v_earn || jsonb_build_object('code', l.code, 'name', l.name, 'amount', l.amount, 'calc_type', l.calc_type, 'note', l.calc_note, 'unresolved', l.unresolved);
      v_g := v_g + l.amount;
    elsif l.line_type = 'employer_contribution' then
      v_empc := v_empc || jsonb_build_object('code', l.code, 'name', l.name, 'amount', l.amount, 'note', l.calc_note);
    else
      v_ded := v_ded || jsonb_build_object('code', l.code, 'name', l.name, 'amount', l.amount, 'calc_type', l.calc_type, 'note', l.calc_note, 'unresolved', l.unresolved);
      v_lines_deds := v_lines_deds || jsonb_build_object('code', l.code, 'amount', l.amount);
    end if;
  end loop;

  v_fin := public.payroll_policy_finalize(v_pol.id, v_g, v_lines_deds);

  return jsonb_build_object(
    'policy', jsonb_build_object('id', v_pol.id, 'code', v_pol.code, 'name', v_pol.policy_name, 'version_no', v_pol.version_no,
                                 'effective_from', v_pol.effective_from, 'effective_to', v_pol.effective_to,
                                 'working_days_method', v_pol.working_days_method, 'exit_date_payable', v_pol.exit_date_payable),
    'store_calendar', case when v_cal.id is not null then jsonb_build_object('id', v_cal.id, 'name', v_cal.name, 'working_days', v_working) else null end,
    'gross', v_g,
    'earnings', v_earn,
    'deductions', v_fin -> 'ordered',
    'employer_contributions', v_empc,
    'total_deductions', v_fin -> 'total_deductions',
    'net_salary', v_fin -> 'net',
    'cap', v_fin -> 'cap',
    'cap_reduction', v_fin -> 'cap_reduction',
    'negative_net_policy', v_fin -> 'negative_net_policy',
    'negative_flag', v_fin -> 'negative_flag',
    'priority_configured', v_fin -> 'priority_configured',
    'tds', coalesce(v_tds, jsonb_build_object('configured', false, 'reason', 'No active TDS policy.'))
  );
end;
$function$;
grant execute on function public.payroll_policy_preview(uuid,date,jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- P. payroll_policy_validate â€” sanity-check the PF/ESI calc_method config and
--    the employer_formula (formula method) alongside the existing checks.
--    'manual' and 'fixed_amount' with nothing entered are NOT blockers â€” they
--    surface as a per-employee review flag at calculation time, like OT.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_policy_validate(p_policy_id uuid)
 RETURNS TABLE(ok boolean, error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare p public.payroll_policies; v_overlap int; sr record;
begin
  select * into p from public.payroll_policies where id = p_policy_id;
  if p.id is null then ok := false; error := 'Policy not found.'; return next; return; end if;
  if p.effective_from is null then ok := false; error := 'Effective From is required.'; return next; return; end if;
  if p.effective_to is not null and p.effective_to < p.effective_from then ok := false; error := 'Effective To is before Effective From.'; return next; return; end if;

  select count(*) into v_overlap from public.payroll_policies q
  where q.company_id = p.company_id and q.id <> p.id and q.status = 'active'
    and q.effective_from >= p.effective_from
    and daterange(q.effective_from, coalesce(q.effective_to, 'infinity'::date), '[]')
        && daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[]');
  if v_overlap > 0 then ok := false; error := 'Another active policy version starts inside this date range.'; return next; return; end if;

  if p.proration_method = 'custom' and p.proration_custom_divisor is null and coalesce(btrim(p.proration_custom_formula), '') = '' then
    ok := false; error := 'Custom proration method needs a custom divisor or formula.'; return next; return; end if;
  if p.lwp_enabled and coalesce(p.lwp_basis, p.lwp_divisor_basis) is null then
    ok := false; error := 'LWP is enabled but no salary basis is configured.'; return next; return; end if;
  if p.deduction_cap_mode = 'custom' and coalesce(btrim(p.deduction_cap_formula), '') = '' then
    ok := false; error := 'Custom deduction cap needs a formula.'; return next; return; end if;

  for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and enabled loop
    if sr.calc_method = 'pct_of_component' and coalesce(btrim(sr.ref_component_code), '') = '' then
      ok := false; error := format('%s uses "%% of another component" but no reference component code is set.', upper(sr.kind));
      return next; return;
    end if;
    if sr.calc_method = 'formula' and coalesce(btrim(sr.base_formula), '') = '' then
      ok := false; error := format('%s uses a custom formula but none is configured.', upper(sr.kind));
      return next; return;
    end if;
  end loop;

  begin
    if coalesce(btrim(p.proration_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.proration_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1)); end if;
    if coalesce(btrim(p.nd_custom_formula), '') <> '' then perform public.payroll_eval_formula(p.nd_custom_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1, 'NDVALUE', 1, 'DIVISOR', 1)); end if;
    if coalesce(btrim(p.deduction_cap_formula), '') <> '' then perform public.payroll_eval_formula(p.deduction_cap_formula, jsonb_build_object('GROSS', 1)); end if;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(base_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.base_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
    for sr in select * from public.payroll_statutory_rules where payroll_policy_id = p_policy_id and coalesce(btrim(employer_formula), '') <> '' loop
      perform public.payroll_eval_formula(sr.employer_formula, jsonb_build_object('BASIC', 1, 'DA', 1, 'GROSS', 1));
    end loop;
  exception when others then ok := false; error := 'Invalid formula: ' || sqlerrm; return next; return; end;

  ok := true; error := null; return next;
end;
$function$;
grant execute on function public.payroll_policy_validate(uuid) to authenticated;

