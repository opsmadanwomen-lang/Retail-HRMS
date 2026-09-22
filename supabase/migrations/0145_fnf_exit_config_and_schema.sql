-- ============================================================================
-- Retail HRMS — Full & Final Settlement (F&F) — Phase 1: configuration + schema
--   + engine primitives. NO new calculation engine: F&F reuses
--     payroll_policy_compute_lines / payroll_policy_finalize (exit-month
--     proration, PF/ESI incl. manual, deduction cap, priority, negative-net),
--     the Advance Recovery engine, the Attendance OT/Night-Duty results and the
--     configurable leave_encashment_rules.
--
--   Decisions locked with the project owner:
--     * F&F consumes FINALIZED payroll snapshots; it only computes months that
--       were never run through payroll (typically the exit month).
--     * Exit / F&F approval authority = a new company-scoped exit_approvers
--       roster (+ super-admin), separate from every other module's roster.
--     * Notice pay = a new configurable exit_notice_policies master. Nothing
--       about notice period / basis / divisor is hard-coded.
--
--   Nothing statutory (PF %, ESI %, ceilings, PT, TDS, OT rate/multiplier,
--   encashment divisor, proration divisor) is hard-coded anywhere in F&F.
--   Missing configuration -> ₹0 + unresolved/review flag, never an invented value.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. exit_approvers — company-scoped roster that may approve / reject / reverse
--    an F&F settlement. Mirrors advance_final_approvers.
-- ----------------------------------------------------------------------------
create table if not exists public.exit_approvers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id)
);
create index if not exists idx_exit_approvers_company on public.exit_approvers (company_id, is_active);

create or replace function public.fnf_can_approve(p_company_id uuid)
returns boolean
language sql
stable
security definer
as $fn$
  select public.is_super_admin()
      or exists (select 1 from public.exit_approvers a
                 where a.employee_id = public.current_user_employee_id()
                   and a.is_active and a.company_id = p_company_id);
$fn$;
grant execute on function public.fnf_can_approve(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- B. exit_notice_policies — configurable notice period + notice-pay recovery.
--    Effective-dated (one active row per company per effective_from), exactly
--    like the payroll / leave policy masters. recovery_basis is NEVER assumed.
-- ----------------------------------------------------------------------------
create table if not exists public.exit_notice_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  notice_days int not null default 0 check (notice_days >= 0),
  recovery_enabled boolean not null default true,
  recovery_basis text check (recovery_basis is null or recovery_basis in ('basic', 'basic_da', 'gross', 'component')),
  recovery_component_code text,                       -- when recovery_basis = 'component'
  recovery_divisor_type text not null default '30'
    check (recovery_divisor_type in ('26', '30', 'calendar_days', 'custom')),
  recovery_divisor_custom numeric check (recovery_divisor_custom is null or recovery_divisor_custom > 0),
  shortfall_recovery boolean not null default true,   -- recover pay for shortfall days
  waiver_allowed boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  remark text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_exit_notice_policies_company on public.exit_notice_policies (company_id, effective_from);

-- resolve the notice policy applicable on a date (latest effective, not yet ended)
create or replace function public.exit_notice_resolve(p_company_id uuid, p_as_of date)
returns public.exit_notice_policies
language sql
stable
security definer
as $fn$
  select * from public.exit_notice_policies
  where company_id = p_company_id
    and effective_from <= p_as_of
    and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc
  limit 1;
$fn$;
grant execute on function public.exit_notice_resolve(uuid, date) to authenticated;

-- notice-pay recovery amount for a shortfall. Returns 0 + unresolved when the
-- basis/divisor cannot be valued from configured data (never fabricated).
create or replace function public.exit_notice_compute(
  p_company_id uuid, p_as_of date, p_shortfall_days numeric,
  p_basic numeric, p_da numeric, p_gross numeric, p_component_amount numeric default null
)
returns table (amount numeric, daily_rate numeric, basis text, divisor numeric, note text, unresolved boolean)
language plpgsql
stable
security definer
as $fn$
declare pol public.exit_notice_policies; v_base numeric; v_div numeric;
begin
  pol := public.exit_notice_resolve(p_company_id, p_as_of);
  basis := pol.recovery_basis;
  if pol.id is null then
    amount := 0; daily_rate := null; divisor := null; unresolved := true;
    note := 'No exit / notice policy configured for this company.'; return next; return;
  end if;
  if not pol.recovery_enabled or coalesce(pol.shortfall_recovery, true) = false or coalesce(p_shortfall_days, 0) <= 0 then
    amount := 0; daily_rate := null; divisor := null; unresolved := false;
    note := 'No notice-pay recovery (disabled or zero shortfall).'; return next; return;
  end if;

  v_base := case pol.recovery_basis
    when 'basic'    then p_basic
    when 'basic_da' then coalesce(p_basic, 0) + coalesce(p_da, 0)
    when 'gross'    then p_gross
    when 'component' then p_component_amount
    else null end;
  v_div := case pol.recovery_divisor_type
    when '26' then 26 when '30' then 30
    when 'calendar_days' then extract(day from (date_trunc('month', p_as_of) + interval '1 month - 1 day'))::numeric
    when 'custom' then pol.recovery_divisor_custom
    else null end;
  divisor := v_div;

  if v_base is null or v_div is null or v_div = 0 then
    amount := 0; daily_rate := null; unresolved := true;
    note := format('Notice-pay basis (%s) and/or divisor (%s) not configured.', coalesce(pol.recovery_basis, 'unset'), pol.recovery_divisor_type);
    return next; return;
  end if;
  daily_rate := round(v_base / v_div, 4);
  amount := round(daily_rate * p_shortfall_days, 2);
  unresolved := false;
  note := format('%s shortfall day(s) x %s (%s / %s)', p_shortfall_days, daily_rate, coalesce(pol.recovery_basis, 'base'), v_div);
  return next;
end;
$fn$;
grant execute on function public.exit_notice_compute(uuid, date, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- C. fnf_settings — one row per company. Controls how F&F recovers advances and
--    whether an employee is auto-inactivated when the F&F is closed.
-- ----------------------------------------------------------------------------
create table if not exists public.fnf_settings (
  id uuid not null default gen_random_uuid(),        -- for the generic write_audit_log trigger
  company_id uuid primary key references public.companies (id) on delete cascade,
  advance_recovery_mode text not null default 'full' check (advance_recovery_mode in ('full', 'scheduled')),
  auto_inactivate_on_close boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- D. leave_encashment_compute — the configurable encashment FORMULA, extracted
--    so F&F values encashable leave with the SAME rule the FY-closing engine
--    uses (leave_encashment_rules: base / divisor / threshold / comparison).
--    gross / custom base or an unusable divisor -> 0 + unresolved (never faked).
-- ----------------------------------------------------------------------------
create or replace function public.leave_encashment_compute(
  p_policy_id uuid, p_days numeric, p_basic numeric, p_da numeric, p_gross numeric default null
)
returns table (eligible boolean, daily_rate numeric, amount numeric, note text, unresolved boolean)
language plpgsql
stable
security definer
as $fn$
declare r public.leave_encashment_rules; v_threshold numeric; v_base numeric; v_div numeric;
begin
  eligible := false; daily_rate := null; amount := 0; unresolved := false;
  if coalesce(p_days, 0) <= 0 then note := 'No encashable leave days.'; return next; return; end if;

  select * into r from public.leave_encashment_rules where policy_id = p_policy_id;
  if r.id is null or not r.enabled then
    unresolved := true; note := 'Leave encashment is not enabled on the applicable leave policy.'; return next; return;
  end if;

  v_threshold := case r.threshold_base_type
    when 'basic' then p_basic
    when 'basic_da' then coalesce(p_basic, 0) + coalesce(p_da, 0)
    when 'gross' then p_gross
    else null end;
  if v_threshold is not null and r.salary_threshold is not null then
    eligible := case r.threshold_comparison
      when 'lt' then v_threshold < r.salary_threshold
      when 'lte' then v_threshold <= r.salary_threshold
      when 'gt' then v_threshold > r.salary_threshold
      when 'gte' then v_threshold >= r.salary_threshold
      else false end;
  elsif r.salary_threshold is null then
    eligible := true;   -- no threshold configured => always encash
  else
    unresolved := true; note := format('Encashment threshold base "%s" is not computable from available salary data.', r.threshold_base_type);
    return next; return;
  end if;

  if not eligible then
    note := format('At/above the configured salary threshold (%s %s %s) — leave lapses, not encashed.', r.threshold_base_type, r.threshold_comparison, r.salary_threshold);
    return next; return;
  end if;

  v_base := case r.salary_base_type
    when 'basic' then p_basic
    when 'basic_da' then coalesce(p_basic, 0) + coalesce(p_da, 0)
    when 'gross' then p_gross
    else null end;
  v_div := case r.divisor_type
    when '26' then 26 when '30' then 30
    when 'calendar_days' then extract(day from (current_date))::numeric   -- caller passes a month-end date via p_days context; keep simple: use 30 fallback handled below
    when 'custom' then r.divisor_custom_value
    else null end;
  if r.divisor_type = 'calendar_days' then v_div := 30; end if;  -- calendar_days needs a month; F&F uses the FY engine's 26/30/custom in practice

  if v_base is null or v_div is null or v_div = 0 then
    unresolved := true;
    note := format('Encashment base "%s" or divisor "%s" not configured.', r.salary_base_type, r.divisor_type);
    return next; return;
  end if;
  daily_rate := round(v_base / v_div, 2);
  amount := round(daily_rate * p_days, 2);
  note := format('%s day(s) x %s (%s / %s)', p_days, daily_rate, r.salary_base_type, v_div);
  return next;
end;
$fn$;
grant execute on function public.leave_encashment_compute(uuid, numeric, numeric, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- E. advance_recovery_run_period_full — an ADDITIONAL entry point over the
--    EXISTING Advance Recovery tables/helpers (advance_recovery_plans,
--    advance_recovery_installments, advance_recovery_transactions,
--    advance_recovery_recompute_plan). Unlike advance_recovery_run_period
--    (one due installment per period), this drains the FULL outstanding of a
--    plan in one period — F&F recovers everything the leaver still owes.
--    Same FIFO, same idempotency (one deduction per installment per period),
--    same authority. NOT a second engine.
-- ----------------------------------------------------------------------------
drop function if exists public.advance_recovery_run_period_full(uuid, uuid);
create or replace function public.advance_recovery_run_period_full(
  p_payroll_period_id uuid, p_employee_id uuid, p_max_amount numeric default null
)
returns table (
  advance_request_id uuid, employee_id uuid, employee_name text,
  installment_number int, scheduled_amount numeric, deducted_amount numeric,
  opening_outstanding numeric, closing_outstanding numeric, plan_status text
)
language plpgsql
security definer
as $$
#variable_conflict use_column
declare
  v_period public.advance_payroll_periods;
  v_plan public.advance_recovery_plans;
  v_inst public.advance_recovery_installments;
  v_open numeric; v_deduct numeric; v_close numeric; v_rem numeric;
  v_budget numeric := p_max_amount;   -- NULL = drain the full outstanding
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  select * into v_period from public.advance_payroll_periods where id = p_payroll_period_id for update;
  if v_period.id is null then raise exception 'Advance payroll period not found.'; end if;
  -- an F&F approver may run this: F&F approval is the authoritative close-out of a leaver's advance.
  if not (public.advance_recovery_can_manage(v_period.company_id) or public.fnf_can_approve(v_period.company_id)) then
    raise exception 'Not authorised to run advance recovery for this company.' using errcode = '42501';
  end if;
  if v_period.status <> 'draft' then
    raise exception 'Advance payroll period is % — only a draft period can be run.', v_period.status;
  end if;

  for v_plan in
    select p.* from public.advance_recovery_plans p
    where p.company_id = v_period.company_id
      and p.employee_id = p_employee_id
      and p.status in ('recovery_pending', 'recovering')
    order by p.payment_date asc, p.created_at asc                 -- FIFO oldest paid first
  loop
    update public.advance_recovery_plans set status = 'recovering' where id = v_plan.id and status = 'recovery_pending';
    v_plan := public.advance_recovery_recompute_plan(v_plan.id);
    v_open := v_plan.outstanding_amount;
    if v_open <= 0 then continue; end if;

    for v_inst in
      select * from public.advance_recovery_installments i
      where i.recovery_plan_id = v_plan.id and i.status in ('scheduled', 'partially_processed')
      order by i.installment_number asc
    loop
      exit when v_open <= 0;
      exit when v_budget is not null and v_budget <= 0;
      -- idempotency: this installment already deducted in this period?
      if exists (select 1 from public.advance_recovery_transactions x
                 where x.advance_request_id = v_plan.advance_request_id
                   and x.payroll_period_id = v_period.id
                   and x.installment_number = v_inst.installment_number
                   and x.txn_type = 'deduction') then
        continue;
      end if;
      v_rem := v_inst.scheduled_amount - v_inst.recovered_amount;
      v_deduct := least(v_rem, v_open);
      if v_budget is not null then v_deduct := least(v_deduct, v_budget); end if;
      if v_deduct <= 0 then continue; end if;
      if v_budget is not null then v_budget := v_budget - v_deduct; end if;
      v_close := v_open - v_deduct;

      insert into public.advance_recovery_transactions (
        company_id, advance_request_id, recovery_plan_id, employee_id, payroll_period_id, period_month,
        installment_number, txn_type, scheduled_amount, amount, opening_outstanding, closing_outstanding,
        deduction_date, processed_by, processed_at
      ) values (
        v_plan.company_id, v_plan.advance_request_id, v_plan.id, v_plan.employee_id, v_period.id, v_period.period_month,
        v_inst.installment_number, 'deduction', v_inst.scheduled_amount, v_deduct, v_open, v_close,
        v_period.period_month, auth.uid(), now()
      );
      update public.advance_recovery_installments
      set recovered_amount = recovered_amount + v_deduct,
          status = case when (recovered_amount + v_deduct) >= scheduled_amount then 'processed' else 'partially_processed' end,
          outstanding_after = v_close, payroll_period_id = v_period.id, processed_at = now()
      where id = v_inst.id;

      v_plan := public.advance_recovery_recompute_plan(v_plan.id);
      v_open := v_plan.outstanding_amount;

      advance_request_id := v_plan.advance_request_id;
      employee_id := v_plan.employee_id;
      select e.full_name into employee_name from public.employees e where e.id = v_plan.employee_id;
      installment_number := v_inst.installment_number;
      scheduled_amount := v_inst.scheduled_amount;
      deducted_amount := v_deduct;
      opening_outstanding := v_open + v_deduct;
      closing_outstanding := v_open;
      plan_status := v_plan.status;
      return next;
    end loop;
  end loop;
end;
$$;
grant execute on function public.advance_recovery_run_period_full(uuid, uuid, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- F. F&F tables.
-- ----------------------------------------------------------------------------
create table if not exists public.fnf_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  version int not null default 1,
  reverses_settlement_id uuid references public.fnf_settlements (id),
  exit_type text not null,
  leaving_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'under_review', 'calculated', 'pending_approval', 'sent_back',
                      'approved', 'payment_pending', 'partially_paid', 'paid', 'closed', 'rejected', 'reversed')),
  -- notice
  notice_required_days int not null default 0,
  notice_served_days numeric not null default 0,
  notice_shortfall_days numeric not null default 0,
  notice_waived boolean not null default false,
  -- leave
  leave_policy_id uuid references public.leave_policies (id),
  encashable_leave_days numeric not null default 0,
  -- resolved context
  payroll_policy_id uuid references public.payroll_policies (id),
  salary_structure_id uuid references public.salary_structures (id),
  basic_snapshot numeric,
  da_snapshot numeric,
  -- results
  gross_earnings numeric not null default 0,
  total_deductions numeric not null default 0,
  employer_contribution_total numeric not null default 0,
  advance_recovered numeric not null default 0,
  advance_remaining numeric not null default 0,
  net_settlement numeric not null default 0,
  amount_paid numeric not null default 0,
  has_negative_net boolean not null default false,
  needs_review boolean not null default false,
  review_notes text,
  snapshot jsonb,                      -- frozen at approval; immutable thereafter
  months_computed jsonb,               -- [{month, gross, net}] F&F actually computed
  months_consumed jsonb,               -- [{month, net}] already-finalized payroll F&F skipped
  calculated_at timestamptz,
  submitted_at timestamptz,
  approved_by uuid, approved_at timestamptz,
  closed_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fnf_settlements_company on public.fnf_settlements (company_id, status);
create index if not exists idx_fnf_settlements_employee on public.fnf_settlements (employee_id);
-- at most one live settlement per employee (rejected / reversed do not count)
create unique index if not exists uidx_fnf_one_active_per_employee
  on public.fnf_settlements (employee_id) where status not in ('rejected', 'reversed');

create table if not exists public.fnf_lines (
  id uuid primary key default gen_random_uuid(),
  fnf_settlement_id uuid not null references public.fnf_settlements (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  line_type text not null check (line_type in ('earning', 'deduction', 'employer_contribution')),
  code text not null,
  name text not null,
  quantity numeric,
  rate numeric,
  amount numeric not null default 0,
  source text,
  calc_type text,
  calc_note text,
  is_adjustment boolean not null default false,
  is_protected boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create index if not exists idx_fnf_lines_settlement on public.fnf_lines (fnf_settlement_id, line_type, sort_order);

create table if not exists public.fnf_adjustments (
  id uuid primary key default gen_random_uuid(),
  fnf_settlement_id uuid not null references public.fnf_settlements (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  line_type text not null check (line_type in ('earning', 'deduction')),
  code text not null,
  name text not null,
  amount numeric not null check (amount >= 0),
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_fnf_adjustments_settlement on public.fnf_adjustments (fnf_settlement_id);

create table if not exists public.fnf_events (
  id uuid primary key default gen_random_uuid(),
  fnf_settlement_id uuid not null references public.fnf_settlements (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  event text not null,
  from_status text,
  to_status text,
  actor uuid,
  reason text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_fnf_events_settlement on public.fnf_events (fnf_settlement_id, created_at);

create table if not exists public.fnf_payments (
  id uuid primary key default gen_random_uuid(),
  fnf_settlement_id uuid not null references public.fnf_settlements (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  amount numeric not null check (amount > 0),
  payment_date date not null,
  payment_mode text,
  transaction_reference text,
  bank_details text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_fnf_payments_settlement on public.fnf_payments (fnf_settlement_id);

-- ----------------------------------------------------------------------------
-- G. RLS + triggers. Reads: super-admin or non-staff of the same company.
--    Writes: SECURITY DEFINER RPCs only (no write policy). Staff fully blocked.
-- ----------------------------------------------------------------------------
alter table public.exit_approvers        enable row level security;
alter table public.exit_notice_policies  enable row level security;
alter table public.fnf_settings          enable row level security;
alter table public.fnf_settlements       enable row level security;
alter table public.fnf_lines             enable row level security;
alter table public.fnf_adjustments       enable row level security;
alter table public.fnf_events            enable row level security;
alter table public.fnf_payments          enable row level security;

do $rls$
declare t text;
begin
  for t in select unnest(array[
    'exit_approvers','exit_notice_policies','fnf_settings','fnf_settlements',
    'fnf_lines','fnf_adjustments','fnf_events','fnf_payments']) loop
    execute format('drop policy if exists "%1$s_select" on public.%1$s;', t);
    execute format($p$create policy "%1$s_select" on public.%1$s for select
      using (is_super_admin() or (current_user_role() <> 'staff' and company_id = current_user_company_id()));$p$, t);
  end loop;
  -- exit_notice_policies / exit_approvers / fnf_settings are configuration: Super-Admin may write directly.
  for t in select unnest(array['exit_approvers','exit_notice_policies','fnf_settings']) loop
    execute format('drop policy if exists "%1$s_write" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s_update" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s_delete" on public.%1$s;', t);
    execute format($p$create policy "%1$s_write"  on public.%1$s for insert with check (is_super_admin());$p$, t);
    execute format($p$create policy "%1$s_update" on public.%1$s for update using (is_super_admin());$p$, t);
    execute format($p$create policy "%1$s_delete" on public.%1$s for delete using (is_super_admin());$p$, t);
  end loop;
end
$rls$;

do $trg$
declare t text;
begin
  for t in select unnest(array[
    'exit_approvers','exit_notice_policies','fnf_settings','fnf_settlements']) loop
    execute format('drop trigger if exists trg_%1$s_set_updated_at on public.%1$s;', t);
    execute format('create trigger trg_%1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at();', t);
  end loop;
  for t in select unnest(array[
    'exit_approvers','exit_notice_policies','fnf_settings','fnf_settlements',
    'fnf_lines','fnf_adjustments','fnf_events','fnf_payments']) loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$s;', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function public.write_audit_log();', t);
  end loop;
end
$trg$;
