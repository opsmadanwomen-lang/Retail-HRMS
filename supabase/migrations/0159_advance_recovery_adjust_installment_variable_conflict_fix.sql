-- ============================================================================
-- Retail HRMS — Fix ambiguous column/variable references in
-- advance_recovery_adjust_installment() (migration 0157)
-- Migration 0159
--
-- FOUND LIVE (E2E verification, this session, rolled-back test transaction):
-- every call that reached a WHERE clause comparing `installment_number` or
-- `status` failed with "column reference is ambiguous". Root cause: the
-- function's own `RETURNS TABLE (installment_number int, due_month date,
-- scheduled_amount numeric, status text)` implicitly declares PL/pgSQL
-- variables with those exact names in the function's scope, which collide
-- with the identically-named columns on public.advance_recovery_installments
-- referenced (unqualified) inside the function body. This made the function
-- completely non-functional for any real call beyond its initial auth
-- checks — a severe defect, caught only by live end-to-end testing.
--
-- FIX: add `#variable_conflict use_column` as the function's first line —
-- the EXACT SAME pragma advance_recovery_run_period() (migration 0136)
-- already uses for this identical class of issue. No other line changes.
-- Confirmed safe: this function never uses the "assign to installment_number/
-- due_month/scheduled_amount/status then RETURN NEXT" idiom (it uses
-- `RETURN QUERY SELECT i.col ...` instead), so there is no legitimate use of
-- those as PL/pgSQL variables anywhere in this function to preserve.
-- ============================================================================
create or replace function public.advance_recovery_adjust_installment(
  p_advance_request_id uuid,
  p_installment_number int,
  p_new_amount numeric,
  p_reason text,
  p_new_future_installment_count int default null
)
returns table (installment_number int, due_month date, scheduled_amount numeric, status text)
language plpgsql
security definer
as $$
#variable_conflict use_column
declare
  v_caller uuid := public.current_user_employee_id();
  v_hr record;
  v_req public.advance_requests;
  v_plan public.advance_recovery_plans;
  v_target public.advance_recovery_installments;
  v_period record;
  v_lock_status text;
  v_future_sum numeric;
  v_total_redistributable numeric;
  v_remaining_for_future numeric;
  v_future_count int;
  v_existing_future_count int;
  v_batch uuid := gen_random_uuid();
  v_q numeric;
  v_sum numeric := 0;
  v_recovered numeric;
  v_k int;
  v_amt numeric;
  v_next_month date;
  v_adj_type text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Your login is disabled.' using errcode = '42501';
  end if;
  if v_caller is null then raise exception 'No employee record is linked to the current user.'; end if;

  select * into v_hr from public.advance_hr_processors where employee_id = v_caller and is_active;
  if v_hr.id is null then
    raise exception 'You are not an active HR Processor.' using errcode = '42501';
  end if;

  select * into v_req from public.advance_requests where id = p_advance_request_id;
  if v_req.id is null then raise exception 'Advance request not found.'; end if;
  if v_req.company_id <> v_hr.company_id then
    raise exception 'This request does not belong to your company.' using errcode = '42501';
  end if;

  select * into v_plan from public.advance_recovery_plans where advance_request_id = p_advance_request_id for update;
  if v_plan.id is null then raise exception 'No recovery plan exists for this advance yet.'; end if;
  if v_plan.status not in ('recovery_pending', 'recovering') then
    raise exception 'Recovery is % — the schedule can no longer be adjusted.', v_plan.status;
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required for a recovery adjustment.';
  end if;
  if p_new_amount is null or p_new_amount < 0 then
    raise exception 'New scheduled amount must be zero or greater.';
  end if;

  select * into v_target from public.advance_recovery_installments
  where recovery_plan_id = v_plan.id and installment_number = p_installment_number
  for update;
  if v_target.id is null then
    raise exception 'Installment % not found for this advance.', p_installment_number;
  end if;
  if v_target.status <> 'scheduled' then
    raise exception 'Installment % has already been processed and can no longer be adjusted (status: %).', p_installment_number, v_target.status;
  end if;
  if exists (
    select 1 from public.advance_recovery_installments
    where recovery_plan_id = v_plan.id and installment_number > p_installment_number and status <> 'scheduled'
  ) then
    raise exception 'A later installment has already been processed out of order — this schedule cannot be safely rebuilt automatically.';
  end if;

  select * into v_period from public.advance_payroll_periods
  where company_id = v_req.company_id and period_month = date_trunc('month', v_target.due_month)::date;
  if v_period.id is not null and v_period.status = 'finalized' then
    raise exception 'Payroll is locked for this period. Advance recovery deduction can no longer be changed.';
  end if;
  v_lock_status := coalesce(v_period.status, 'not_created');

  select coalesce(sum(scheduled_amount), 0), count(*) into v_future_sum, v_existing_future_count
  from public.advance_recovery_installments
  where recovery_plan_id = v_plan.id and installment_number > p_installment_number and status = 'scheduled';

  v_total_redistributable := v_target.scheduled_amount + v_future_sum;
  if p_new_amount > v_total_redistributable then
    raise exception 'New amount (%) cannot exceed this period''s current schedule plus all remaining future scheduled amounts (%).', p_new_amount, v_total_redistributable;
  end if;

  v_remaining_for_future := v_total_redistributable - p_new_amount;
  v_future_count := coalesce(p_new_future_installment_count, v_existing_future_count);
  if v_future_count < 0 then
    raise exception 'Future installment count cannot be negative.';
  end if;
  if v_remaining_for_future > 0 and v_future_count < 1 then
    raise exception 'At least one future installment is required to hold the remaining %.', v_remaining_for_future;
  end if;

  v_adj_type := case when p_new_amount < v_target.scheduled_amount then 'decrease'
                     when p_new_amount > v_target.scheduled_amount then 'increase'
                     else 'no_change' end;

  insert into public.advance_recovery_installment_adjustments (
    company_id, advance_request_id, recovery_plan_id, batch_id, adjustment_scope,
    installment_number, due_month, old_scheduled_amount, new_scheduled_amount,
    adjustment_type, reason, processed_by, payroll_lock_status_at_time
  ) values (
    v_req.company_id, v_req.id, v_plan.id, v_batch, 'target_period',
    p_installment_number, v_target.due_month, v_target.scheduled_amount, p_new_amount,
    v_adj_type, p_reason, auth.uid(), v_lock_status
  );

  update public.advance_recovery_installments
  set scheduled_amount = p_new_amount
  where id = v_target.id;

  delete from public.advance_recovery_installments
  where recovery_plan_id = v_plan.id and installment_number > p_installment_number and status = 'scheduled';

  if v_future_count > 0 then
    insert into public.advance_recovery_installment_adjustments (
      company_id, advance_request_id, recovery_plan_id, batch_id, adjustment_scope,
      installment_number, due_month, old_scheduled_amount, new_scheduled_amount,
      adjustment_type, reason, processed_by, payroll_lock_status_at_time
    ) values (
      v_req.company_id, v_req.id, v_plan.id, v_batch, 'future_redistribution',
      null, null, v_future_sum, v_remaining_for_future,
      'redistribute', p_reason, auth.uid(), v_lock_status
    );

    v_q := trunc(v_remaining_for_future / v_future_count * 100) / 100;
    v_sum := 0;
    v_next_month := (v_target.due_month + interval '1 month')::date;
    for v_k in 1 .. v_future_count loop
      v_amt := case when v_k < v_future_count then v_q else v_remaining_for_future - v_sum end;
      v_sum := v_sum + v_amt;
      insert into public.advance_recovery_installments (company_id, advance_request_id, recovery_plan_id, employee_id, installment_number, due_month, scheduled_amount)
      values (v_req.company_id, v_req.id, v_plan.id, v_req.employee_id, p_installment_number + v_k,
              (v_next_month + ((v_k - 1) || ' month')::interval)::date, v_amt);
    end loop;
  end if;

  select coalesce(sum(scheduled_amount), 0) into v_sum
  from public.advance_recovery_installments where recovery_plan_id = v_plan.id and status <> 'cancelled';
  select coalesce(sum(x.amount), 0) into v_recovered
  from public.advance_recovery_transactions x
  where x.recovery_plan_id = v_plan.id and x.txn_type = 'deduction'
    and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
  if v_sum + v_recovered <> v_plan.actual_paid_amount then
    raise exception 'Adjustment would break the exact-total invariant (scheduled % + recovered % <> actual paid %).', v_sum, v_recovered, v_plan.actual_paid_amount;
  end if;

  update public.advance_recovery_plans
  set installment_count = (select count(*) from public.advance_recovery_installments where recovery_plan_id = v_plan.id)
  where id = v_plan.id;

  perform public.advance_notify(v_req.company_id, v_req.employee_id, 'advance_recovery_schedule_adjusted', 'Advance recovery schedule updated',
    format('Your advance recovery schedule was adjusted by HR: installment %s deduction is now %s.', p_installment_number, p_new_amount), v_req.id);

  return query
  select i.installment_number, i.due_month, i.scheduled_amount, i.status
  from public.advance_recovery_installments i
  where i.recovery_plan_id = v_plan.id
  order by i.installment_number;
end;
$$;
grant execute on function public.advance_recovery_adjust_installment(uuid, int, numeric, text, int) to authenticated;
