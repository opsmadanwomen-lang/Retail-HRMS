-- ============================================================================
-- Retail HRMS — Advance Payment Receipt Management (post-payment signed
-- receipt upload)
-- Migration 0160
--
-- INSPECTED FIRST (nothing below duplicates what already exists and works):
--   - advance_finance_pay() ALREADY hard-enforces "Finance can never pay more
--     than boss_approved_amount" (`if p_payment_amount > v_req.boss_approved_
--     amount then raise exception`) and ALREADY treats payment_proof_path as
--     fully optional (no validation requires it). Test Cases 1 and 2 from
--     this task's acceptance criteria already pass against the EXISTING
--     code — untouched here.
--   - advance_hr_process()/advance_hr_hold()/advance_hr_send_back() (migration
--     0134) never accept an amount parameter at all — HR structurally cannot
--     change the Boss Approved Amount; nothing to add.
--   - advance_finance_payments.payment_proof_path already exists for the
--     AT-PAYMENT-TIME optional proof — left completely alone.
--
-- WHAT'S NEW: a dedicated, auditable, replaceable POST-PAYMENT signed
-- employee receipt, distinct from the at-payment-time proof above (the
-- proof is whatever Finance has when they record the payment; the receipt
-- is the employee's own signed acknowledgment, which arrives later). Reuses
-- the EXISTING 'advance-payment-proofs' storage bucket (additive RLS only —
-- extends, never replaces, the existing Finance-only insert/select
-- policies) rather than provisioning a second bucket.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. advance_payment_receipts — one row per upload, insert-only (a
--    replacement is a NEW row; the old row is marked 'replaced', never
--    edited/deleted). At most one 'active' row per finance_payment_id.
-- ----------------------------------------------------------------------------
create table if not exists public.advance_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  advance_request_id uuid not null references public.advance_requests (id) on delete cascade,
  finance_payment_id uuid not null references public.advance_finance_payments (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  status text not null default 'active' check (status in ('active', 'replaced')),
  replaced_by_receipt_id uuid references public.advance_payment_receipts (id),
  replace_reason text,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_advance_payment_receipts_request on public.advance_payment_receipts (advance_request_id, uploaded_at);
create index if not exists idx_advance_payment_receipts_payment on public.advance_payment_receipts (finance_payment_id);
-- exactly one ACTIVE receipt per payment at a time (a replacement flips the old row to 'replaced'
-- in the same transaction as inserting the new 'active' one).
create unique index if not exists uidx_advance_payment_receipts_one_active
  on public.advance_payment_receipts (finance_payment_id) where status = 'active';

alter table public.advance_payment_receipts enable row level security;

create trigger trg_advance_payment_receipts_audit
  after insert or update on public.advance_payment_receipts
  for each row execute function public.write_audit_log();

-- Visibility mirrors advance_finance_payments/advance_recovery_* (owner, non-staff same company,
-- Reporting Manager, Boss, HR, Finance, Super Admin). Writes only via the RPCs below (SECURITY
-- DEFINER, run as table owner, bypass this restrictive check exactly like every other advance
-- write RPC in this codebase).
create policy "advance_payment_receipts_select" on public.advance_payment_receipts for select
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
create policy "advance_payment_receipts_write" on public.advance_payment_receipts for insert with check (is_super_admin());
create policy "advance_payment_receipts_update" on public.advance_payment_receipts for update using (is_super_admin());
-- no delete policy -> immutable; a correction is always a new "replace" row, never a delete.

-- ----------------------------------------------------------------------------
-- 2. Storage RLS — additive OR-branch only. Every existing branch (employee
--    owner read, Finance read/insert, Super Admin) is untouched; HR gains the
--    SAME access Finance already has, matching "authorized HR/Finance user".
-- ----------------------------------------------------------------------------
drop policy if exists "advance_payment_proofs_storage_select" on storage.objects;
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
            or (public.advance_am_i_hr(public.current_user_employee_id()) and a.company_id = current_user_company_id())
          )
      )
    )
  );

drop policy if exists "advance_payment_proofs_storage_insert" on storage.objects;
create policy "advance_payment_proofs_storage_insert" on storage.objects for insert
  with check (
    bucket_id = 'advance-payment-proofs'
    and (storage.foldername(name))[1] = current_user_company_id()::text
    and (is_super_admin() or public.advance_am_i_finance(public.current_user_employee_id()) or public.advance_am_i_hr(public.current_user_employee_id()))
  );

-- ----------------------------------------------------------------------------
-- 3. advance_finance_upload_receipt() — first upload only (status must
--    currently have no 'active' receipt). Authorized: active Finance
--    Processor OR active HR Processor for the request's company.
-- ----------------------------------------------------------------------------
create or replace function public.advance_finance_upload_receipt(
  p_advance_request_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_file_size_bytes bigint default null
)
returns public.advance_payment_receipts
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_req public.advance_requests;
  v_pay public.advance_finance_payments;
  v_authorized boolean;
  v_receipt public.advance_payment_receipts;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if v_caller is null then raise exception 'No employee record is linked to the current user.'; end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;

  v_authorized := exists (select 1 from public.advance_finance_processors where employee_id = v_caller and is_active and company_id = v_req.company_id)
               or exists (select 1 from public.advance_hr_processors where employee_id = v_caller and is_active and company_id = v_req.company_id);
  if not v_authorized then
    raise exception 'You are not an authorized HR/Finance user for advance receipts.' using errcode = '42501';
  end if;

  select * into v_pay from public.advance_finance_payments where advance_request_id = p_advance_request_id;
  if v_pay.id is null or v_pay.status <> 'paid' then
    raise exception 'A receipt can only be uploaded for a completed (Paid) advance payment.';
  end if;

  if p_storage_path is null or length(trim(p_storage_path)) = 0 then raise exception 'A file is required.'; end if;
  if p_file_name is null or length(trim(p_file_name)) = 0 then raise exception 'A file name is required.'; end if;

  if exists (select 1 from public.advance_payment_receipts where finance_payment_id = v_pay.id and status = 'active') then
    raise exception 'A receipt has already been uploaded for this payment. Use Replace Receipt to update it.';
  end if;

  insert into public.advance_payment_receipts (
    company_id, advance_request_id, finance_payment_id, employee_id,
    storage_path, file_name, mime_type, file_size_bytes, status, uploaded_by
  ) values (
    v_req.company_id, v_req.id, v_pay.id, v_req.employee_id,
    p_storage_path, p_file_name, p_mime_type, p_file_size_bytes, 'active', auth.uid()
  ) returning * into v_receipt;

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_receipt_uploaded', 'Advance receipt uploaded',
    'The signed receipt for your advance payment has been uploaded.', v_req.id);

  return v_receipt;
end;
$$;
grant execute on function public.advance_finance_upload_receipt(uuid, text, text, text, bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. advance_finance_replace_receipt() — requires an existing active
--    receipt; marks it 'replaced' and links it to the new row. Reason is
--    mandatory (audit requirement, §8).
-- ----------------------------------------------------------------------------
create or replace function public.advance_finance_replace_receipt(
  p_advance_request_id uuid,
  p_storage_path text,
  p_file_name text,
  p_reason text,
  p_mime_type text default null,
  p_file_size_bytes bigint default null
)
returns public.advance_payment_receipts
language plpgsql
security definer
as $$
declare
  v_caller uuid := public.current_user_employee_id();
  v_req public.advance_requests;
  v_pay public.advance_finance_payments;
  v_old public.advance_payment_receipts;
  v_authorized boolean;
  v_new public.advance_payment_receipts;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if v_caller is null then raise exception 'No employee record is linked to the current user.'; end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;

  v_authorized := exists (select 1 from public.advance_finance_processors where employee_id = v_caller and is_active and company_id = v_req.company_id)
               or exists (select 1 from public.advance_hr_processors where employee_id = v_caller and is_active and company_id = v_req.company_id);
  if not v_authorized then
    raise exception 'You are not an authorized HR/Finance user for advance receipts.' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to replace a receipt.';
  end if;
  if p_storage_path is null or length(trim(p_storage_path)) = 0 then raise exception 'A file is required.'; end if;

  select * into v_pay from public.advance_finance_payments where advance_request_id = p_advance_request_id;
  if v_pay.id is null then raise exception 'No payment record found for this advance.'; end if;

  select * into v_old from public.advance_payment_receipts where finance_payment_id = v_pay.id and status = 'active' for update;
  if v_old.id is null then
    raise exception 'No existing receipt to replace — use Upload Receipt instead.';
  end if;

  insert into public.advance_payment_receipts (
    company_id, advance_request_id, finance_payment_id, employee_id,
    storage_path, file_name, mime_type, file_size_bytes, status, uploaded_by
  ) values (
    v_req.company_id, v_req.id, v_pay.id, v_req.employee_id,
    p_storage_path, p_file_name, p_mime_type, p_file_size_bytes, 'active', auth.uid()
  ) returning * into v_new;

  update public.advance_payment_receipts
  set status = 'replaced', replaced_by_receipt_id = v_new.id, replace_reason = p_reason
  where id = v_old.id;

  return v_new;
end;
$$;
grant execute on function public.advance_finance_replace_receipt(uuid, text, text, text, text, bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. advance_get_payment_receipt() — the CURRENT (active) receipt + a
--    derived display status, for the payment detail screen.
-- ----------------------------------------------------------------------------
create or replace function public.advance_get_payment_receipt(p_advance_request_id uuid)
returns table (
  receipt_id uuid,
  storage_path text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_name text,
  uploaded_at timestamptz,
  receipt_status text
)
language sql
stable
security definer
as $$
  with vis as (
    select 1 where exists (
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
  )
  select r.id, r.storage_path, r.file_name, r.mime_type, r.file_size_bytes,
         e.full_name, r.uploaded_at,
         case when r.id is not null then 'uploaded' else 'pending' end
  from public.advance_finance_payments p
  left join public.advance_payment_receipts r on r.finance_payment_id = p.id and r.status = 'active'
  left join public.employees e on e.auth_user_id = r.uploaded_by
  where p.advance_request_id = p_advance_request_id and exists (select 1 from vis)
  union all
  -- if there is no finance_payments row match at all (shouldn't normally happen once paid) still
  -- report a deterministic "pending" row so the UI never breaks on a missing join.
  select null, null, null, null, null, null, null, 'pending'
  where not exists (select 1 from public.advance_finance_payments p where p.advance_request_id = p_advance_request_id)
    and exists (select 1 from vis)
  limit 1;
$$;
grant execute on function public.advance_get_payment_receipt(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. advance_list_payment_receipt_history() — full audit history (active +
--    replaced), oldest first, for the "view history" / audit trail.
-- ----------------------------------------------------------------------------
create or replace function public.advance_list_payment_receipt_history(p_advance_request_id uuid)
returns table (
  id uuid,
  file_name text,
  storage_path text,
  status text,
  uploaded_by_name text,
  uploaded_at timestamptz,
  replace_reason text,
  replaced_by_receipt_id uuid
)
language sql
stable
security definer
as $$
  with vis as (
    select 1 where exists (
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
  )
  select r.id, r.file_name, r.storage_path, r.status, e.full_name, r.uploaded_at, r.replace_reason, r.replaced_by_receipt_id
  from public.advance_payment_receipts r
  left join public.employees e on e.auth_user_id = r.uploaded_by
  where r.advance_request_id = p_advance_request_id and exists (select 1 from vis)
  order by r.uploaded_at asc;
$$;
grant execute on function public.advance_list_payment_receipt_history(uuid) to authenticated;
