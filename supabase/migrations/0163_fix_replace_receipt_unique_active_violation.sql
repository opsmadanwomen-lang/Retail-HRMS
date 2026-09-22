-- ============================================================================
-- Retail HRMS — Fix advance_finance_replace_receipt() unique-active-receipt
-- constraint violation
-- Migration 0163
--
-- FOUND LIVE (E2E verification, this session, inside a rolled-back
-- transaction — no production data affected): every call to
-- advance_finance_replace_receipt() failed with
--   23505 duplicate key value violates unique constraint
--   "uidx_advance_payment_receipts_one_active"
-- Root cause: migration 0160's function body INSERTs the new 'active' row
-- BEFORE UPDATing the old row to 'replaced'. For one instant both rows are
-- 'active' for the same finance_payment_id, which the partial unique index
-- `uidx_advance_payment_receipts_one_active on (finance_payment_id) where
-- status = 'active'` (by design, migration 0160) correctly rejects. This made
-- Replace Receipt completely non-functional since the feature was deployed —
-- Upload Receipt (first upload) was and remains unaffected, since it never
-- has an old row to juggle.
--
-- FIX, take 2 (also found live, same rolled-back session): the first attempt at this fix
-- (UPDATE old row's replaced_by_receipt_id to a pre-generated new id, THEN insert the new row
-- with that id) violates advance_payment_receipts_replaced_by_receipt_id_fkey instead — the FK is
-- NOT deferrable, so it is checked immediately at the UPDATE, before the referenced row exists.
-- CORRECT FIX (3 steps, no schema change needed): (1) flip the old row to 'replaced' WITHOUT yet
-- setting replaced_by_receipt_id (frees the partial unique index's slot); (2) insert the new
-- 'active' row (now satisfies the unique index); (3) backfill the old row's
-- replaced_by_receipt_id now that the new row genuinely exists (satisfies the FK). Every other
-- line (authorization, the migration 0162 dynamic-permission gate, validation, return value) is
-- unchanged.
-- ============================================================================
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

  -- Dynamic-permission gate (migration 0162) — unchanged.
  v_module := case when v_is_finance then 'finance_advance_payment' else 'hr_advance_processing' end;
  if not public.has_dynamic_permission(auth.uid(), v_module, 'UPLOAD') then
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

  -- FIX (migration 0163, corrected): step 1 — flip the OLD row to 'replaced' first, WITHOUT
  -- replaced_by_receipt_id yet (frees the partial unique index's slot for this
  -- finance_payment_id; replaced_by_receipt_id stays null for an instant, which the column
  -- allows).
  update public.advance_payment_receipts
  set status = 'replaced', replace_reason = p_reason
  where id = v_old.id;

  -- step 2 — insert the new 'active' row (the unique index now has no conflicting row).
  insert into public.advance_payment_receipts (
    id, company_id, advance_request_id, finance_payment_id, employee_id,
    storage_path, file_name, mime_type, file_size_bytes, status, uploaded_by
  ) values (
    v_new_id, v_req.company_id, v_req.id, v_pay.id, v_req.employee_id,
    p_storage_path, p_file_name, p_mime_type, p_file_size_bytes, 'active', auth.uid()
  ) returning * into v_new;

  -- step 3 — backfill the old row's replaced_by_receipt_id now that the new row exists
  -- (satisfies advance_payment_receipts_replaced_by_receipt_id_fkey).
  update public.advance_payment_receipts
  set replaced_by_receipt_id = v_new.id
  where id = v_old.id;

  return v_new;
end;
$$;
grant execute on function public.advance_finance_replace_receipt(uuid, text, text, text, text, bigint) to authenticated;
