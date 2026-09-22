-- ============================================================================
-- Retail HRMS — Tab-level permission gate for Advance receipt upload/replace
-- Migration 0171
--
-- INSPECTED FIRST: advance_finance_upload_receipt()/advance_finance_replace_receipt()
-- (migrations 0160/0162/0163) already enforce, server-side: (1) real business
-- authority (HR or Finance Processor roster), (2) a Dynamic Permission gate
-- on the OLD per-role module ('finance_advance_payment' / 'hr_advance_processing').
-- This migration does NOT remove that check — an existing Super Admin
-- configuration against those modules keeps working exactly as before.
--
-- It ADDS one more, independent check against the NEW tab dimension
-- (migration 0169): 'advance_management' -> 'paid_receipt' tab -> 'UPLOAD'
-- action, which is what the unified Approvals -> Advance screen's Permission
-- Management UI now configures (task spec section 19-20: "Paid / Receipt ->
-- Upload" must be controllable independently of "Payment -> Process", and
-- must NOT accidentally change when e.g. Recovery's permission changes).
-- Both checks default to allowed (fail-open) until explicitly configured, so
-- applying this changes nothing until a Super Admin actually denies one or
-- the other — the two are AND'd, so a request must pass BOTH.
-- No table/column change; CREATE OR REPLACE only, same signatures.
-- ============================================================================

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
  v_is_finance boolean;
  v_module text;
  v_receipt public.advance_payment_receipts;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if v_caller is null then raise exception 'No employee record is linked to the current user.'; end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;

  v_is_finance := exists (select 1 from public.advance_finance_processors where employee_id = v_caller and is_active and company_id = v_req.company_id);
  v_authorized := v_is_finance
               or exists (select 1 from public.advance_hr_processors where employee_id = v_caller and is_active and company_id = v_req.company_id);
  if not v_authorized then
    raise exception 'You are not an authorized HR/Finance user for advance receipts.' using errcode = '42501';
  end if;

  -- Migration 0162 gate (unchanged) + migration 0171 tab-level gate (new) — both must pass.
  v_module := case when v_is_finance then 'finance_advance_payment' else 'hr_advance_processing' end;
  if not public.has_dynamic_permission(auth.uid(), v_module, 'UPLOAD') then
    raise exception 'You do not have permission to upload an advance receipt.' using errcode = '42501';
  end if;
  if not public.has_dynamic_tab_permission(auth.uid(), 'advance_management', 'paid_receipt', 'UPLOAD') then
    raise exception 'You do not have permission to upload an advance receipt.' using errcode = '42501';
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
  v_is_finance boolean;
  v_module text;
  v_new_id uuid := gen_random_uuid();
  v_new public.advance_payment_receipts;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if v_caller is null then raise exception 'No employee record is linked to the current user.'; end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;

  v_is_finance := exists (select 1 from public.advance_finance_processors where employee_id = v_caller and is_active and company_id = v_req.company_id);
  v_authorized := v_is_finance
               or exists (select 1 from public.advance_hr_processors where employee_id = v_caller and is_active and company_id = v_req.company_id);
  if not v_authorized then
    raise exception 'You are not an authorized HR/Finance user for advance receipts.' using errcode = '42501';
  end if;

  -- Migration 0162 gate (unchanged) + migration 0171 tab-level gate (new) — both must pass.
  v_module := case when v_is_finance then 'finance_advance_payment' else 'hr_advance_processing' end;
  if not public.has_dynamic_permission(auth.uid(), v_module, 'UPLOAD') then
    raise exception 'You do not have permission to replace an advance receipt.' using errcode = '42501';
  end if;
  if not public.has_dynamic_tab_permission(auth.uid(), 'advance_management', 'paid_receipt', 'UPLOAD') then
    raise exception 'You do not have permission to replace an advance receipt.' using errcode = '42501';
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

  -- Migration 0163's fixed 3-step order — unchanged.
  update public.advance_payment_receipts
  set status = 'replaced', replace_reason = p_reason
  where id = v_old.id;

  insert into public.advance_payment_receipts (
    id, company_id, advance_request_id, finance_payment_id, employee_id,
    storage_path, file_name, mime_type, file_size_bytes, status, uploaded_by
  ) values (
    v_new_id, v_req.company_id, v_req.id, v_pay.id, v_req.employee_id,
    p_storage_path, p_file_name, p_mime_type, p_file_size_bytes, 'active', auth.uid()
  ) returning * into v_new;

  update public.advance_payment_receipts
  set replaced_by_receipt_id = v_new.id
  where id = v_old.id;

  return v_new;
end;
$$;
grant execute on function public.advance_finance_replace_receipt(uuid, text, text, text, text, bigint) to authenticated;
