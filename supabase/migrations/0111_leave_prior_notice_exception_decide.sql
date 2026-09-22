-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: Prior Notice Exception decision
-- Migration 0111
--
-- Admin/HR (any non-staff role, or Super Admin) decides a pending exception
-- request created by leave_apply() for the 'hr_approval_required' /
-- 'special_approval_required' / 'emergency_exception' behaviors. Approving
-- does NOT create the leave application itself — the employee re-submits
-- leave_apply() with the same Leave Type/From/To, which then finds this
-- now-approved, unconsumed exception and proceeds (see 0109).
-- ============================================================================
create or replace function public.leave_decide_prior_notice_exception(
  p_exception_id uuid,
  p_decision text,
  p_remark text default null
)
returns public.leave_prior_notice_exceptions
language plpgsql
security definer
as $$
declare
  v_exception public.leave_prior_notice_exceptions;
  v_updated_rows int;
begin
  if not (public.is_super_admin() or public.current_user_role() <> 'staff') then
    raise exception 'Only Admin/HR may decide a prior notice exception.' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select * into v_exception from public.leave_prior_notice_exceptions where id = p_exception_id;
  if v_exception.id is null then
    raise exception 'Exception request not found.';
  end if;

  if not public.is_super_admin() and v_exception.company_id <> public.current_user_company_id() then
    raise exception 'This exception request belongs to a different company.' using errcode = '42501';
  end if;

  update public.leave_prior_notice_exceptions
  set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_remark = p_remark
  where id = p_exception_id and status = 'pending'
  returning * into v_exception;

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows = 0 then
    raise exception 'This exception request has already been decided.';
  end if;

  perform public.leave_notify(
    v_exception.company_id, v_exception.employee_id, 'prior_notice_exception',
    case when p_decision = 'approved' then 'Prior notice exception approved' else 'Prior notice exception rejected' end,
    case when p_decision = 'approved' then 'You may now re-submit your leave application.' else coalesce(p_remark, 'Your exception request was rejected.') end,
    'leave_prior_notice_exceptions', v_exception.id
  );

  return v_exception;
end;
$$;

grant execute on function public.leave_decide_prior_notice_exception(uuid, text, text) to authenticated;

create or replace function public.leave_list_pending_prior_notice_exceptions()
returns setof public.leave_prior_notice_exceptions
language sql
stable
security definer
as $$
  select e.* from public.leave_prior_notice_exceptions e
  where e.status = 'pending'
    and (public.is_super_admin() or (public.current_user_role() <> 'staff' and e.company_id = public.current_user_company_id()));
$$;

grant execute on function public.leave_list_pending_prior_notice_exceptions() to authenticated;
