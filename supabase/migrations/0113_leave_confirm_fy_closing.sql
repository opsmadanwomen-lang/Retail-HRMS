-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: Confirm FY Closing
-- Migration 0113
--
-- Single PL/pgSQL function call = single Postgres transaction: any RAISE
-- EXCEPTION anywhere in the loop below rolls back every insert/update this
-- call made, including the 'processing' batch row itself — genuinely
-- all-or-nothing, not simulated. Uses the SAME leave_compute_fy_closing()
-- Preview uses; nothing here recomputes anything differently.
--
-- Idempotency: a CLOSED batch already existing for (company, FY) is
-- rejected up front (also structurally enforced by the 0107 partial unique
-- index even under a race). payroll_leave_transactions' own unique
-- constraint is a second line of defense against duplicate postings.
-- ============================================================================
create or replace function public.leave_confirm_fy_closing(
  p_financial_year_id uuid,
  p_next_financial_year_id uuid default null,
  p_remark text default null
)
returns public.leave_fy_closing_batches
language plpgsql
security definer
as $$
declare
  v_fy record;
  v_next_fy record;
  v_batch public.leave_fy_closing_batches;
  v_line record;
begin
  if not (public.is_super_admin() or public.current_user_role() <> 'staff') then
    raise exception 'Only Admin/HR may close a Financial Year.' using errcode = '42501';
  end if;

  select id, company_id, start_date, end_date, status into v_fy from public.leave_financial_years where id = p_financial_year_id;
  if v_fy.id is null then
    raise exception 'Financial Year not found.';
  end if;

  if not public.is_super_admin() and v_fy.company_id <> public.current_user_company_id() then
    raise exception 'This Financial Year belongs to a different company.' using errcode = '42501';
  end if;

  if exists (select 1 from public.leave_fy_closing_batches where company_id = v_fy.company_id and financial_year_id = p_financial_year_id and status = 'closed') then
    raise exception 'This Financial Year has already been closed.';
  end if;

  if p_next_financial_year_id is not null then
    select id, company_id, start_date into v_next_fy from public.leave_financial_years where id = p_next_financial_year_id;
    if v_next_fy.id is null or v_next_fy.company_id <> v_fy.company_id then
      raise exception 'The specified next Financial Year is invalid.';
    end if;
  end if;

  insert into public.leave_fy_closing_batches (company_id, financial_year_id, next_financial_year_id, status, initiated_by, remark)
  values (v_fy.company_id, p_financial_year_id, p_next_financial_year_id, 'processing', auth.uid(), p_remark)
  returning * into v_batch;

  for v_line in select * from public.leave_compute_fy_closing(p_financial_year_id) loop
    insert into public.leave_fy_closing_lines (
      batch_id, employee_id, leave_type_id, policy_id, policy_version,
      opening, earned, used, pending, available,
      carry_forward_days, encashment_days, lapse_days,
      basic_salary_snapshot, da_snapshot, salary_base_snapshot, divisor_snapshot, daily_rate, encashment_amount,
      final_status
    ) values (
      v_batch.id, v_line.employee_id, v_line.leave_type_id, v_line.policy_id, v_line.policy_version,
      v_line.opening, v_line.earned, v_line.used, v_line.pending, v_line.available,
      v_line.carry_forward_days, v_line.encashment_days, v_line.lapse_days,
      v_line.basic_salary_snapshot, v_line.da_snapshot, v_line.salary_base_snapshot, v_line.divisor_snapshot, v_line.daily_rate, v_line.encashment_amount,
      v_line.final_status
    );

    if v_line.carry_forward_days > 0 then
      if p_next_financial_year_id is null then
        raise exception 'At least one employee has leave to carry forward but no next Financial Year was specified. Create the next Financial Year first (Leave Management > Financial Years), then retry closing with it selected.';
      end if;
      insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
      values (v_fy.company_id, v_line.employee_id, v_line.leave_type_id, p_next_financial_year_id, 'carry_forward', v_next_fy.start_date, v_line.carry_forward_days, 'leave_fy_closing_batch', v_batch.id, format('Carried forward from Financial Year closing (batch %s).', v_batch.id), auth.uid());
    end if;

    if v_line.encashment_days > 0 then
      insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
      values (v_fy.company_id, v_line.employee_id, v_line.leave_type_id, p_financial_year_id, 'encashment', v_fy.end_date, -v_line.encashment_days, 'leave_fy_closing_batch', v_batch.id, format('Encashed at Financial Year closing (batch %s).', v_batch.id), auth.uid());

      insert into public.payroll_leave_transactions (company_id, employee_id, financial_year_id, leave_type_id, transaction_type, days, amount, source, status, fy_closing_batch_id, created_by)
      values (v_fy.company_id, v_line.employee_id, p_financial_year_id, v_line.leave_type_id, 'encashment', v_line.encashment_days, v_line.encashment_amount, 'leave_fy_closing', 'pending', v_batch.id, auth.uid())
      on conflict (employee_id, financial_year_id, leave_type_id, transaction_type) do nothing;

      perform public.leave_notify(v_fy.company_id, v_line.employee_id, 'encashment_generated', 'Leave encashment processed',
        format('%s day(s) encashed for %s.', v_line.encashment_days, coalesce(v_line.encashment_amount::text, 'an amount pending calculation')), 'leave_fy_closing_batch', v_batch.id);
    end if;

    if v_line.lapse_days > 0 then
      insert into public.leave_ledger (company_id, employee_id, leave_type_id, financial_year_id, transaction_type, transaction_date, days, reference_type, reference_id, remark, created_by)
      values (v_fy.company_id, v_line.employee_id, v_line.leave_type_id, p_financial_year_id, 'lapse', v_fy.end_date, -v_line.lapse_days, 'leave_fy_closing_batch', v_batch.id, format('Lapsed at Financial Year closing (batch %s).', v_batch.id), auth.uid());

      perform public.leave_notify(v_fy.company_id, v_line.employee_id, 'lapse_generated', 'Leave lapsed',
        format('%s day(s) lapsed at Financial Year closing.', v_line.lapse_days), 'leave_fy_closing_batch', v_batch.id);
    end if;
  end loop;

  update public.leave_fy_closing_batches set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = v_batch.id returning * into v_batch;
  update public.leave_financial_years set status = 'closed', updated_by = auth.uid() where id = p_financial_year_id;

  if public.current_user_employee_id() is not null then
    perform public.leave_notify(v_fy.company_id, public.current_user_employee_id(), 'financial_year_closed', 'Financial Year closed',
      format('Financial Year closing completed (batch %s).', v_batch.id), 'leave_fy_closing_batch', v_batch.id);
  end if;

  return v_batch;
end;
$$;

grant execute on function public.leave_confirm_fy_closing(uuid, uuid, text) to authenticated;

create or replace function public.leave_get_fy_closing_batch(p_financial_year_id uuid)
returns public.leave_fy_closing_batches
language sql
stable
security definer
as $$
  select * from public.leave_fy_closing_batches
  where financial_year_id = p_financial_year_id and status = 'closed'
  order by closed_at desc limit 1;
$$;

grant execute on function public.leave_get_fy_closing_batch(uuid) to authenticated;

create or replace function public.leave_list_fy_closing_lines(p_batch_id uuid)
returns setof public.leave_fy_closing_lines
language sql
stable
security definer
as $$
  select * from public.leave_fy_closing_lines where batch_id = p_batch_id;
$$;

grant execute on function public.leave_list_fy_closing_lines(uuid) to authenticated;
