-- ============================================================================
-- Retail HRMS — Dynamic Role & Permission System: backend enforcement wiring
-- Migration 0162
--
-- Migration 0161 built the full Dynamic Role & Permission System (catalogs, dynamic_roles,
-- role_permissions, user_permission_overrides, field permissions, has_dynamic_permission() /
-- has_field_permission()) but — by explicit, disclosed design — wired it into NOTHING yet: every
-- check function existed but nothing called it. This migration is the (deliberately small, additive)
-- backend enforcement pass, scoped to exactly what this task's acceptance tests require:
--   1. Employee module — VIEW/ADD/EDIT/DELETE on `employees`.
--   2. Employee Documents module — VIEW/UPLOAD/DELETE on `employee_documents`.
--   3. Advance receipt upload/replace — UPLOAD, re-checked inside the existing 0160 RPCs.
--
-- MECHANISM (safety-critical design choice): rather than editing `employees`' or
-- `employee_documents`' existing PERMISSIVE RLS policies — which have been iterated on across
-- many prior migrations (0001, 0005, 0006, 0025, 0026, 0061, 0078) and are load-bearing for
-- every module in this app — this migration adds NEW policies `AS RESTRICTIVE`. Per Postgres RLS
-- semantics, a restrictive policy is ANDed on top of whatever the existing permissive policies
-- already allow; it can only ever NARROW access, never widen it, and it requires ZERO changes to
-- any existing policy's text. Combined with has_dynamic_permission()'s own fail-OPEN default
-- (returns true whenever nothing has been configured for that user/module/action — see 0161),
-- applying this migration changes NOTHING for any existing user until a Super Admin explicitly
-- configures a deny from the new Settings -> User & Role Permissions page. No other table, and no
-- Attendance/Leave/Payroll internal RPC, is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Employee module — public.employees.
-- ----------------------------------------------------------------------------
drop policy if exists "employees_dynamic_permission_select" on public.employees;
create policy "employees_dynamic_permission_select" on public.employees
  as restrictive for select
  using (public.has_dynamic_permission(auth.uid(), 'employee', 'VIEW'));

drop policy if exists "employees_dynamic_permission_insert" on public.employees;
create policy "employees_dynamic_permission_insert" on public.employees
  as restrictive for insert
  with check (public.has_dynamic_permission(auth.uid(), 'employee', 'ADD'));

drop policy if exists "employees_dynamic_permission_update" on public.employees;
create policy "employees_dynamic_permission_update" on public.employees
  as restrictive for update
  using (public.has_dynamic_permission(auth.uid(), 'employee', 'EDIT'))
  with check (public.has_dynamic_permission(auth.uid(), 'employee', 'EDIT'));

drop policy if exists "employees_dynamic_permission_delete" on public.employees;
create policy "employees_dynamic_permission_delete" on public.employees
  as restrictive for delete
  using (public.has_dynamic_permission(auth.uid(), 'employee', 'DELETE'));

-- ----------------------------------------------------------------------------
-- 2. Employee Documents module — public.employee_documents (migration 0007 defines select/
--    insert/delete only — there is no update policy on this table today, so none is added here
--    either; nothing to narrow that doesn't already exist).
-- ----------------------------------------------------------------------------
drop policy if exists "employee_documents_dynamic_permission_select" on public.employee_documents;
create policy "employee_documents_dynamic_permission_select" on public.employee_documents
  as restrictive for select
  using (public.has_dynamic_permission(auth.uid(), 'employee_documents', 'VIEW'));

drop policy if exists "employee_documents_dynamic_permission_insert" on public.employee_documents;
create policy "employee_documents_dynamic_permission_insert" on public.employee_documents
  as restrictive for insert
  with check (public.has_dynamic_permission(auth.uid(), 'employee_documents', 'UPLOAD'));

drop policy if exists "employee_documents_dynamic_permission_delete" on public.employee_documents;
create policy "employee_documents_dynamic_permission_delete" on public.employee_documents
  as restrictive for delete
  using (public.has_dynamic_permission(auth.uid(), 'employee_documents', 'DELETE'));

-- ----------------------------------------------------------------------------
-- 3. Advance Payment Receipt upload/replace (migration 0160) — CREATE OR REPLACE, same
--    signature, every existing line of logic preserved verbatim; only the new dynamic-permission
--    check is inserted (module resolved from whichever roster — Finance or HR — the existing
--    check already found the caller on). This is the concrete backend proof for spec Test Case 5
--    ("Super Admin removes Finance -> Advance -> Upload Receipt" -> button disappears AND the
--    backend also rejects), without touching advance_finance_pay()/the Boss-approved-amount cap/
--    any other Advance RPC.
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

  -- NEW (migration 0162): Dynamic Role & Permission System — an explicit Super-Admin-configured
  -- deny of 'UPLOAD' for whichever module authorized this caller is enforced here too, not just
  -- hidden by the frontend button. Fails open (default allowed) until actually configured.
  v_module := case when v_is_finance then 'finance_advance_payment' else 'hr_advance_processing' end;
  if not public.has_dynamic_permission(auth.uid(), v_module, 'UPLOAD') then
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

  -- NEW (migration 0162): same dynamic-permission gate as advance_finance_upload_receipt() above.
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
