-- ============================================================================
-- Retail HRMS — Advance Management, Phase 3: FINANCE PAYMENT / DISBURSEMENT
-- Migration 0135
--
-- Workflow added in this phase:  finance_pending -> finance_processing -> paid
-- (with an optional finance_on_hold detour). Finance is NOT an approval level:
-- it cannot re-approve, reject, or change requested_amount /
-- manager_recommended_amount / boss_approved_amount. It records the ACTUAL
-- payment only. Boss Approved Amount is the MAXIMUM payable; a lower amount is
-- allowed only when the applicable policy's existing allow_partial_payment
-- flag is true. NOTHING about payroll recovery / installments / outstanding
-- balance / settlement / closure exists in this phase, and payment completion
-- creates NO payroll transaction and changes NO payslip.
--
-- Reuses (unmodified): every advance_* table + helper from Phases 1-2,
-- current_user_*(), is_super_admin(), write_audit_log(), set_updated_at(),
-- advance_am_i_finance() (migration 0132), advance_notify(),
-- advance_notification_settings, and the private-bucket + signed-URL storage
-- pattern from migration 0096 (leave-documents). advance_boss_decide() /
-- advance_hr_process() and every other Phase 1-2 RPC are UNTOUCHED. Nothing in
-- Leave / Night Duty / Attendance / Payroll is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Status extension. Only 3 new values; no 'recovering' / 'closed' (Phase 4).
--    Every existing value keeps its exact Phase 1/2 meaning.
-- ----------------------------------------------------------------------------
alter table public.advance_requests drop constraint advance_requests_status_check;
alter table public.advance_requests add constraint advance_requests_status_check
  check (status in (
    'manager_pending', 'boss_pending', 'approved', 'rejected', 'sent_back', 'cancelled',
    'hr_pending', 'hr_on_hold', 'hr_sent_back', 'finance_pending',
    'finance_processing', 'paid', 'finance_on_hold'
  ));

-- ----------------------------------------------------------------------------
-- B. advance_payment_modes — configurable Payment Mode master (per company).
--    requires_reference drives the "Bank Transfer needs a UTR, Cash does not"
--    rule from config, NOT hard-coded logic. Historical payments snapshot the
--    mode code + label onto the payment row (see C) so a later rename/deactivate
--    never rewrites history.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_payment_modes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  requires_reference boolean not null default true,
  sort_order int not null default 100,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists idx_advance_payment_modes_company on public.advance_payment_modes (company_id, is_active);

-- Sensible default set for every existing company (fully editable afterwards).
insert into public.advance_payment_modes (company_id, code, name, sort_order, requires_reference)
select c.id, m.code, m.name, m.sort_order, m.requires_reference
from public.companies c
cross join (values
  ('bank_transfer', 'Bank Transfer', 10, true),
  ('neft',          'NEFT',          20, true),
  ('rtgs',          'RTGS',          30, true),
  ('imps',          'IMPS',          40, true),
  ('upi',           'UPI',           50, true),
  ('cash',          'Cash',          60, false),
  ('cheque',        'Cheque',        70, false),
  ('other',         'Other',         80, false)
) as m(code, name, sort_order, requires_reference)
on conflict (company_id, code) do nothing;

-- ----------------------------------------------------------------------------
-- C. advance_finance_payments — the actual disbursement record, one row per
--    request. boss_approved_amount is COPIED in at start time for Finance's
--    own record; the authoritative value always remains
--    advance_requests.boss_approved_amount, which this table never writes back.
--    payment_amount is the ACTUAL amount paid and is a SEPARATE value.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_finance_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  boss_approved_amount numeric not null check (boss_approved_amount >= 0),
  payment_amount numeric check (payment_amount is null or payment_amount > 0),
  payment_date date,
  payment_mode_id uuid references public.advance_payment_modes (id) on delete set null,
  payment_mode text,          -- snapshot of the mode CODE at pay time (history stability)
  payment_mode_label text,    -- snapshot of the mode NAME at pay time
  transaction_reference text,
  utr_number text,
  bank_reference text,
  payment_proof_path text,
  payment_remarks text,
  hold_reason text,
  status text not null default 'processing' check (status in ('processing', 'paid', 'on_hold')),
  processed_by uuid,
  processed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (advance_request_id)          -- one Advance -> one Finance payment (Phase 3 design decision)
);
create index if not exists idx_advance_finance_payments_company on public.advance_finance_payments (company_id, status);

-- ----------------------------------------------------------------------------
-- D. advance_finance_payment_actions — INSERT-only semantic history, same
--    architecture as advance_hr_process_actions.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_finance_payment_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  finance_payment_id uuid not null references public.advance_finance_payments (id) on delete cascade,
  actor_employee_id uuid not null references public.employees (id),
  action text not null check (action in ('started', 'paid', 'on_hold', 'resumed', 'commented')),
  old_status text,
  new_status text,
  old_payment_amount numeric,
  new_payment_amount numeric,
  remark text,
  acted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_advance_finance_payment_actions_request on public.advance_finance_payment_actions (advance_request_id);

alter table public.advance_payment_modes enable row level security;
alter table public.advance_finance_payments enable row level security;
alter table public.advance_finance_payment_actions enable row level security;

create trigger trg_advance_payment_modes_set_updated_at before update on public.advance_payment_modes for each row execute function public.set_updated_at();
create trigger trg_advance_payment_modes_audit after insert or update or delete on public.advance_payment_modes for each row execute function public.write_audit_log();
create trigger trg_advance_finance_payments_set_updated_at before update on public.advance_finance_payments for each row execute function public.set_updated_at();
create trigger trg_advance_finance_payments_audit after insert or update or delete on public.advance_finance_payments for each row execute function public.write_audit_log();
create trigger trg_advance_finance_payment_actions_audit after insert on public.advance_finance_payment_actions for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
-- Payment Mode master: Super Admin writes; readable to any authenticated user
-- of the same company (mirrors advance_types, migration 0132) so the Finance
-- payment form can list modes.
create policy "advance_payment_modes_select" on public.advance_payment_modes for select
  using (is_super_admin() or company_id = current_user_company_id());
create policy "advance_payment_modes_write"  on public.advance_payment_modes for insert with check (is_super_admin());
create policy "advance_payment_modes_update" on public.advance_payment_modes for update using (is_super_admin());
create policy "advance_payment_modes_delete" on public.advance_payment_modes for delete using (is_super_admin());

-- Payment record + its history: visibility mirrors advance_hr_processes exactly,
-- plus an active Finance Processor of the SAME company (via the SECURITY DEFINER
-- helper advance_am_i_finance(), never a bare sub-select). Direct writes are
-- Super-Admin-only; real writes go through the RPCs below. No UPDATE/DELETE
-- policy on advance_finance_payment_actions -> immutable for everyone.
create policy "advance_finance_payments_select" on public.advance_finance_payments for select
  using (
    is_super_admin()
    or exists (
      select 1 from public.advance_requests a
      where a.id = advance_request_id
        and (
          (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or a.employee_id = current_user_employee_id()
          or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
          or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_finance(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  );
create policy "advance_finance_payments_write"  on public.advance_finance_payments for insert with check (is_super_admin());
create policy "advance_finance_payments_update" on public.advance_finance_payments for update using (is_super_admin());

create policy "advance_finance_payment_actions_select" on public.advance_finance_payment_actions for select
  using (
    is_super_admin()
    or exists (
      select 1 from public.advance_requests a
      where a.id = advance_request_id
        and (
          (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or a.employee_id = current_user_employee_id()
          or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
          or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_finance(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  );
create policy "advance_finance_payment_actions_write" on public.advance_finance_payment_actions for insert with check (is_super_admin());

-- ----------------------------------------------------------------------------
-- Storage: advance-payment-proofs (private) — same pattern as leave-documents
-- (migration 0096). Path = company_id/advance_request_id/timestamp_filename.
-- Only an active Finance Processor (or Super Admin) may upload; read is limited
-- to the owning employee and the company's Finance Processors / Super Admin.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('advance-payment-proofs', 'advance-payment-proofs', false)
on conflict (id) do nothing;

create policy "advance_payment_proofs_storage_select" on storage.objects for select
  using (
    bucket_id = 'advance-payment-proofs'
    and (
      is_super_admin()
      or exists (
        select 1 from public.advance_requests a
        where a.id::text = (storage.foldername(name))[2]
          and (
            a.employee_id = current_user_employee_id()
            or (public.advance_am_i_finance(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          )
      )
    )
  );

create policy "advance_payment_proofs_storage_insert" on storage.objects for insert
  with check (
    bucket_id = 'advance-payment-proofs'
    and (storage.foldername(name))[1] = current_user_company_id()::text
    and (is_super_admin() or public.advance_am_i_finance(public.current_user_employee_id()))
  );

-- ----------------------------------------------------------------------------
-- advance_list_finance_pending(): the Finance queue. Company resolved from the
-- CALLER's own active advance_finance_processors row — never client-supplied.
-- Only status = 'finance_pending'.
-- ----------------------------------------------------------------------------
create or replace function public.advance_list_finance_pending()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  advance_type_name text,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  hr_processed_at timestamptz,
  reason text,
  requested_at timestamptz,
  status text
)
language plpgsql
stable
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_is_admin boolean := public.is_super_admin();
  v_fin_company uuid;
begin
  if not v_is_admin then
    select fp.company_id into v_fin_company from public.advance_finance_processors fp where fp.employee_id = v_caller and fp.is_active limit 1;
    if v_fin_company is null then
      raise exception 'You are not an active Finance Processor.' using errcode = '42501';
    end if;
  end if;

  return query
  select a.id, a.employee_id, e.full_name, e.employee_code, t.name,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         hp.processed_at, a.reason, a.requested_at, a.status
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  left join public.advance_hr_processes hp on hp.advance_request_id = a.id
  where a.status = 'finance_pending'
    and (v_is_admin or a.company_id = v_fin_company)
  order by a.requested_at asc;
end;
$$;
grant execute on function public.advance_list_finance_pending() to authenticated;

-- ----------------------------------------------------------------------------
-- advance_list_finance_history(): the Processing / On Hold / Paid tabs. Same
-- security model as advance_list_finance_pending(), different status filter.
-- ----------------------------------------------------------------------------
create or replace function public.advance_list_finance_history()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  advance_type_name text,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  status text,
  finance_status text,
  payment_amount numeric,
  payment_date date,
  payment_mode text,
  payment_mode_label text,
  transaction_reference text,
  utr_number text,
  bank_reference text,
  hold_reason text,
  processed_by_name text,
  processed_at timestamptz
)
language plpgsql
stable
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_is_admin boolean := public.is_super_admin();
  v_fin_company uuid;
begin
  if not v_is_admin then
    select fp.company_id into v_fin_company from public.advance_finance_processors fp where fp.employee_id = v_caller and fp.is_active limit 1;
    if v_fin_company is null then
      raise exception 'You are not an active Finance Processor.' using errcode = '42501';
    end if;
  end if;

  return query
  select a.id, a.employee_id, e.full_name, e.employee_code, t.name,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount, a.status,
         fp.status, fp.payment_amount, fp.payment_date, fp.payment_mode, fp.payment_mode_label,
         fp.transaction_reference, fp.utr_number, fp.bank_reference, fp.hold_reason,
         pb.full_name, fp.processed_at
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  left join public.advance_finance_payments fp on fp.advance_request_id = a.id
  left join public.employees pb on pb.auth_user_id = fp.processed_by
  where a.status in ('finance_processing', 'finance_on_hold', 'paid')
    and (v_is_admin or a.company_id = v_fin_company)
  order by a.requested_at desc;
end;
$$;
grant execute on function public.advance_list_finance_history() to authenticated;

-- ----------------------------------------------------------------------------
-- advance_get_finance_payment(): the full Finance detail-drawer bundle for ONE
-- request. Visibility mirrors advance_finance_payments RLS. Never returns
-- salary — only the amounts already on the request / HR / payment rows.
-- "Maximum Payable Amount" = boss_approved_amount, surfaced explicitly.
-- ----------------------------------------------------------------------------
create or replace function public.advance_get_finance_payment(p_advance_request_id uuid)
returns table (
  advance_request_id uuid,
  employee_id uuid,
  employee_name text,
  employee_code text,
  advance_type_name text,
  policy_name text,
  policy_version int,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  max_payable_amount numeric,
  allow_partial_payment boolean,
  reason text,
  remarks text,
  request_status text,
  requested_at timestamptz,
  document_count int,
  hr_processed_amount numeric,
  hr_processed_at timestamptz,
  hr_process_remarks text,
  hr_processed_by_name text,
  finance_payment_id uuid,
  finance_status text,
  payment_amount numeric,
  payment_date date,
  payment_mode text,
  payment_mode_label text,
  transaction_reference text,
  utr_number text,
  bank_reference text,
  payment_proof_path text,
  payment_remarks text,
  hold_reason text,
  processed_by_name text,
  processed_at timestamptz
)
language plpgsql
stable
security definer
as $$
begin
  if not exists (
    select 1 from public.advance_requests a
    where a.id = p_advance_request_id
      and (
        public.is_super_admin()
        or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
        or a.employee_id = current_user_employee_id()
        or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
        or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        or (public.advance_am_i_finance(public.current_user_employee_id()) and a.company_id = current_user_company_id())
      )
  ) then
    raise exception 'Advance request not found or not visible to you.';
  end if;

  return query
  select a.id, a.employee_id, e.full_name, e.employee_code, t.name, p.name, a.policy_version,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         a.boss_approved_amount, coalesce(cfg.allow_partial_payment, false),
         a.reason, a.remarks, a.status, a.requested_at,
         (select count(*)::int from public.advance_request_documents d where d.advance_request_id = a.id),
         hp.boss_approved_amount, hp.processed_at, hp.process_remarks, hpb.full_name,
         fp.id, fp.status, fp.payment_amount, fp.payment_date, fp.payment_mode, fp.payment_mode_label,
         fp.transaction_reference, fp.utr_number, fp.bank_reference, fp.payment_proof_path,
         fp.payment_remarks, fp.hold_reason, pb.full_name, fp.processed_at
  from public.advance_requests a
  join public.employees e on e.id = a.employee_id
  join public.advance_types t on t.id = a.advance_type_id
  join public.advance_policies p on p.id = a.policy_id
  left join public.advance_policy_configs cfg on cfg.policy_id = a.policy_id
  left join public.advance_hr_processes hp on hp.advance_request_id = a.id
  left join public.employees hpb on hpb.auth_user_id = hp.processed_by
  left join public.advance_finance_payments fp on fp.advance_request_id = a.id
  left join public.employees pb on pb.auth_user_id = fp.processed_by
  where a.id = p_advance_request_id;
end;
$$;
grant execute on function public.advance_get_finance_payment(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_list_finance_payment_actions(): immutable Finance history for one
-- request — the Finance counterpart of advance_list_hr_process_actions().
-- ----------------------------------------------------------------------------
create or replace function public.advance_list_finance_payment_actions(p_advance_request_id uuid)
returns table (
  action text,
  actor_employee_id uuid,
  actor_name text,
  old_status text,
  new_status text,
  old_payment_amount numeric,
  new_payment_amount numeric,
  remark text,
  acted_at timestamptz
)
language sql
stable
security definer
as $$
  select fa.action, fa.actor_employee_id, e.full_name, fa.old_status, fa.new_status,
         fa.old_payment_amount, fa.new_payment_amount, fa.remark, fa.acted_at
  from public.advance_finance_payment_actions fa
  join public.employees e on e.id = fa.actor_employee_id
  where fa.advance_request_id = p_advance_request_id
    and exists (
      select 1 from public.advance_requests a
      where a.id = p_advance_request_id
        and (
          is_super_admin()
          or (current_user_role() <> 'staff' and a.company_id = current_user_company_id())
          or a.employee_id = current_user_employee_id()
          or public.advance_resolve_direct_manager(a.employee_id) = current_user_employee_id()
          or (public.advance_am_i_boss(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          or (public.advance_am_i_finance(public.current_user_employee_id()) and a.company_id = current_user_company_id())
        )
    )
  order by fa.acted_at asc;
$$;
grant execute on function public.advance_list_finance_payment_actions(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Mutating RPCs. Same authorization prelude as the Phase 2 HR RPCs, inlined:
--   1) caller login active   2) caller resolves to an employee
--   3) caller is an ACTIVE advance_finance_processors row -> that row's OWN
--      company_id is the only company this call may touch
--   4) the target request belongs to that exact company
-- No is_super_admin() bypass on the mutating actions — matching the precedent
-- of advance_manager_decide/_boss_decide (Phase 1) and advance_hr_* (Phase 2).
--
-- RESOLVED DESIGN DECISIONS (see Phase 3 report §27):
--  * ONE Advance -> ONE Finance payment (unique(advance_request_id)). Phase 1
--    policy has no multiple-disbursement setting, so none is invented.
--  * advance_finance_resume(): finance_on_hold -> finance_processing (§21 allows
--    either target). The Start preconditions (HR processed, Boss approval,
--    company match) cannot change while a request sits on hold, and
--    advance_finance_pay() re-checks every rule itself before any money moves,
--    so returning straight to finance_processing is both the safest and the
--    simplest — no re-Start needed, and the payment row stays consistent.
-- ----------------------------------------------------------------------------

create or replace function public.advance_finance_start(p_advance_request_id uuid)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_fin record;
  v_req public.advance_requests;
  v_hp record;
  v_old_status text;
  v_payment_id uuid;
  v_updated int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_fin from public.advance_finance_processors where employee_id = v_caller and is_active;
  if v_fin.id is null then
    raise exception 'You are not an active Finance Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;
  if v_req.company_id <> v_fin.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;
  if v_req.status <> 'finance_pending' then
    raise exception 'This request is not available to start (current status: %).', v_req.status;
  end if;
  if v_req.boss_approved_amount is null then
    raise exception 'This request has no Boss Approved Amount.';
  end if;

  select * into v_hp from public.advance_hr_processes where advance_request_id = p_advance_request_id;
  if v_hp.id is null or v_hp.status <> 'processed' then
    raise exception 'HR processing is not complete for this request.';
  end if;

  v_old_status := v_req.status;

  update public.advance_requests
  set status = 'finance_processing', updated_by = auth.uid()
  where id = p_advance_request_id and status = 'finance_pending'
  returning * into v_req;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Advance is already being processed.';
  end if;

  select id into v_payment_id from public.advance_finance_payments where advance_request_id = p_advance_request_id;
  if v_payment_id is null then
    insert into public.advance_finance_payments (company_id, advance_request_id, employee_id, boss_approved_amount, status, processed_by, processed_at, created_by, updated_by)
    values (v_req.company_id, v_req.id, v_req.employee_id, v_req.boss_approved_amount, 'processing', auth.uid(), now(), auth.uid(), auth.uid())
    returning id into v_payment_id;
  else
    update public.advance_finance_payments
    set status = 'processing', boss_approved_amount = v_req.boss_approved_amount, hold_reason = null,
        processed_by = auth.uid(), processed_at = now(), updated_by = auth.uid()
    where id = v_payment_id;
  end if;

  insert into public.advance_finance_payment_actions (company_id, advance_request_id, finance_payment_id, actor_employee_id, action, old_status, new_status, acted_at)
  values (v_req.company_id, v_req.id, v_payment_id, v_caller, 'started', v_old_status, 'finance_processing', now());

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_finance_processing', 'Advance payment in progress',
    'Finance has started processing your advance payment.', v_req.id);

  return v_req;
end;
$$;
grant execute on function public.advance_finance_start(uuid) to authenticated;

create or replace function public.advance_finance_pay(
  p_advance_request_id uuid,
  p_payment_amount numeric,
  p_payment_date date,
  p_payment_mode_id uuid,
  p_transaction_reference text default null,
  p_utr_number text default null,
  p_bank_reference text default null,
  p_payment_remarks text default null,
  p_payment_proof_path text default null
)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_fin record;
  v_req public.advance_requests;
  v_hp record;
  v_mode record;
  v_allow_partial boolean;
  v_payment_id uuid;
  v_old_amount numeric;
  v_updated int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_fin from public.advance_finance_processors where employee_id = v_caller and is_active;
  if v_fin.id is null then
    raise exception 'You are not an active Finance Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;
  if v_req.company_id <> v_fin.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;
  if v_req.status = 'paid' then
    raise exception 'Advance payment has already been completed.';
  end if;
  if v_req.status <> 'finance_processing' then
    raise exception 'This request is not ready for payment (current status: %). Start processing it first.', v_req.status;
  end if;
  if v_req.boss_approved_amount is null then
    raise exception 'This request has no Boss Approved Amount.';
  end if;

  select * into v_hp from public.advance_hr_processes where advance_request_id = p_advance_request_id;
  if v_hp.id is null or v_hp.status <> 'processed' then
    raise exception 'HR processing is not complete for this request.';
  end if;

  -- amount rules
  if p_payment_amount is null or p_payment_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_payment_amount > v_req.boss_approved_amount then
    raise exception 'Payment amount % exceeds the Boss Approved Amount (%). Finance can never pay more than the approved amount.', p_payment_amount, v_req.boss_approved_amount;
  end if;
  select coalesce(cfg.allow_partial_payment, false) into v_allow_partial
  from public.advance_policy_configs cfg where cfg.policy_id = v_req.policy_id;
  if not coalesce(v_allow_partial, false) and p_payment_amount <> v_req.boss_approved_amount then
    raise exception 'Partial payment is not allowed under this policy — the payment must equal the Boss Approved Amount (%).', v_req.boss_approved_amount;
  end if;

  -- payment date
  if p_payment_date is null then
    raise exception 'A payment date is required.';
  end if;
  if p_payment_date > (current_date + 1) then
    raise exception 'Payment date cannot be in the future.';
  end if;

  -- payment mode + config-driven reference requirement
  select * into v_mode from public.advance_payment_modes where id = p_payment_mode_id and company_id = v_req.company_id and is_active;
  if v_mode.id is null then
    raise exception 'Select a valid, active payment mode.';
  end if;
  if v_mode.requires_reference
     and coalesce(nullif(trim(p_transaction_reference), ''), nullif(trim(p_utr_number), ''), nullif(trim(p_bank_reference), '')) is null then
    raise exception 'The "%" payment mode requires a transaction / UTR / bank reference.', v_mode.name;
  end if;

  select id, payment_amount into v_payment_id, v_old_amount from public.advance_finance_payments where advance_request_id = p_advance_request_id;
  if v_payment_id is null then
    raise exception 'Finance processing has not been started for this request.';
  end if;

  update public.advance_requests
  set status = 'paid', updated_by = auth.uid()
  where id = p_advance_request_id and status = 'finance_processing'
  returning * into v_req;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Advance payment has already been completed or is no longer available.';
  end if;

  update public.advance_finance_payments
  set status = 'paid',
      payment_amount = p_payment_amount,
      payment_date = p_payment_date,
      payment_mode_id = v_mode.id,
      payment_mode = v_mode.code,
      payment_mode_label = v_mode.name,
      transaction_reference = nullif(trim(coalesce(p_transaction_reference, '')), ''),
      utr_number = nullif(trim(coalesce(p_utr_number, '')), ''),
      bank_reference = nullif(trim(coalesce(p_bank_reference, '')), ''),
      payment_proof_path = nullif(trim(coalesce(p_payment_proof_path, '')), ''),
      payment_remarks = p_payment_remarks,
      hold_reason = null,
      boss_approved_amount = v_req.boss_approved_amount,
      processed_by = auth.uid(), processed_at = now(), updated_by = auth.uid()
  where id = v_payment_id;

  insert into public.advance_finance_payment_actions (company_id, advance_request_id, finance_payment_id, actor_employee_id, action, old_status, new_status, old_payment_amount, new_payment_amount, remark, acted_at)
  values (v_req.company_id, v_req.id, v_payment_id, v_caller, 'paid', 'finance_processing', 'paid', v_old_amount, p_payment_amount, p_payment_remarks, now());

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_paid', 'Advance payment completed',
    format('Advance payment completed — %s paid on %s.', p_payment_amount, p_payment_date), v_req.id);

  return v_req;
end;
$$;
grant execute on function public.advance_finance_pay(uuid, numeric, date, uuid, text, text, text, text, text) to authenticated;

create or replace function public.advance_finance_hold(p_advance_request_id uuid, p_reason text)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_fin record;
  v_req public.advance_requests;
  v_old_status text;
  v_payment_id uuid;
  v_updated int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to put a payment on hold.';
  end if;

  select * into v_fin from public.advance_finance_processors where employee_id = v_caller and is_active;
  if v_fin.id is null then
    raise exception 'You are not an active Finance Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;
  if v_req.company_id <> v_fin.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;
  if v_req.status not in ('finance_pending', 'finance_processing') then
    raise exception 'Only a pending or in-progress Finance request can be put on hold (current status: %).', v_req.status;
  end if;
  v_old_status := v_req.status;

  update public.advance_requests
  set status = 'finance_on_hold', updated_by = auth.uid()
  where id = p_advance_request_id and status in ('finance_pending', 'finance_processing')
  returning * into v_req;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Advance is no longer available to put on hold.';
  end if;

  select id into v_payment_id from public.advance_finance_payments where advance_request_id = p_advance_request_id;
  if v_payment_id is null then
    insert into public.advance_finance_payments (company_id, advance_request_id, employee_id, boss_approved_amount, status, hold_reason, processed_by, processed_at, created_by, updated_by)
    values (v_req.company_id, v_req.id, v_req.employee_id, v_req.boss_approved_amount, 'on_hold', p_reason, auth.uid(), now(), auth.uid(), auth.uid())
    returning id into v_payment_id;
  else
    update public.advance_finance_payments
    set status = 'on_hold', hold_reason = p_reason, processed_by = auth.uid(), processed_at = now(), updated_by = auth.uid()
    where id = v_payment_id;
  end if;

  insert into public.advance_finance_payment_actions (company_id, advance_request_id, finance_payment_id, actor_employee_id, action, old_status, new_status, remark, acted_at)
  values (v_req.company_id, v_req.id, v_payment_id, v_caller, 'on_hold', v_old_status, 'finance_on_hold', p_reason, now());

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_finance_on_hold', 'Advance payment on hold',
    format('Finance has put your advance payment on hold: %s', p_reason), v_req.id);

  return v_req;
end;
$$;
grant execute on function public.advance_finance_hold(uuid, text) to authenticated;

create or replace function public.advance_finance_resume(p_advance_request_id uuid, p_remark text default null)
returns public.advance_requests
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_fin record;
  v_req public.advance_requests;
  v_payment_id uuid;
  v_updated int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled. Contact your administrator.' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'No employee record is linked to the current user.';
  end if;

  select * into v_fin from public.advance_finance_processors where employee_id = v_caller and is_active;
  if v_fin.id is null then
    raise exception 'You are not an active Finance Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;
  if v_req.company_id <> v_fin.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;
  if v_req.status <> 'finance_on_hold' then
    raise exception 'Only an on-hold Finance request can be resumed (current status: %).', v_req.status;
  end if;

  update public.advance_requests
  set status = 'finance_processing', updated_by = auth.uid()
  where id = p_advance_request_id and status = 'finance_on_hold'
  returning * into v_req;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Advance is no longer available to resume.';
  end if;

  select id into v_payment_id from public.advance_finance_payments where advance_request_id = p_advance_request_id;
  update public.advance_finance_payments
  set status = 'processing', hold_reason = null, processed_by = auth.uid(), processed_at = now(), updated_by = auth.uid()
  where id = v_payment_id;

  insert into public.advance_finance_payment_actions (company_id, advance_request_id, finance_payment_id, actor_employee_id, action, old_status, new_status, remark, acted_at)
  values (v_req.company_id, v_req.id, v_payment_id, v_caller, 'resumed', 'finance_on_hold', 'finance_processing', p_remark, now());

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_finance_processing', 'Advance payment resumed',
    'Your advance payment has been taken off hold and Finance is processing it again.', v_req.id);

  return v_req;
end;
$$;
grant execute on function public.advance_finance_resume(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- advance_list_my_requests(): PURELY ADDITIVE extension of the Phase 1 self-
-- service list — 3 new trailing columns (paid_amount / payment_date /
-- payment_mode_label) so the Staff "My Advances" list can show the ACTUAL PAID
-- amount alongside Requested / Manager Recommended / Boss Approved (§23). Still
-- self-scoped by current_user_employee_id(); no filter or ordering changed.
-- RETURNS TABLE signatures cannot be widened in place, so drop + recreate.
-- ----------------------------------------------------------------------------
drop function if exists public.advance_list_my_requests();
create function public.advance_list_my_requests()
returns table (
  id uuid, company_id uuid, employee_id uuid, advance_type_id uuid, advance_type_name text,
  policy_id uuid, policy_name text, policy_version int,
  requested_amount numeric, manager_recommended_amount numeric, boss_approved_amount numeric,
  boss_modification_reason text, reason text, remarks text, status text, current_step int,
  requested_at timestamptz, decided_at timestamptz, decision_remark text,
  paid_amount numeric, payment_date date, payment_mode_label text
)
language sql
stable
security definer
as $$
  select a.id, a.company_id, a.employee_id, a.advance_type_id, t.name,
         a.policy_id, p.name, a.policy_version,
         a.requested_amount, a.manager_recommended_amount, a.boss_approved_amount,
         a.boss_modification_reason, a.reason, a.remarks, a.status, a.current_step,
         a.requested_at, a.decided_at, a.decision_remark,
         fp.payment_amount, fp.payment_date, fp.payment_mode_label
  from public.advance_requests a
  join public.advance_types t on t.id = a.advance_type_id
  join public.advance_policies p on p.id = a.policy_id
  left join public.advance_finance_payments fp on fp.advance_request_id = a.id and fp.status = 'paid'
  where a.employee_id = public.current_user_employee_id()
  order by a.requested_at desc;
$$;
grant execute on function public.advance_list_my_requests() to authenticated;
