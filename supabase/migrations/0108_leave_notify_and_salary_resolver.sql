-- ============================================================================
-- Retail HRMS — Leave Management, Phase 4: notification helper + salary
-- resolver + notification read RPCs
-- Migration 0108
--
-- leave_notify(): the ONE place a Leave notification is ever created. Checks
-- leave_notification_settings.in_app_enabled for the event before writing —
-- if disabled, silently does nothing (never partially fabricates a channel).
-- Called from inside the existing Leave RPCs (leave_apply/leave_cancel/
-- leave_manager_decide/leave_super_manager_decide, extended in the next two
-- migrations) — never a second/parallel notification path.
-- ============================================================================
create or replace function public.leave_notify(
  p_company_id uuid,
  p_recipient_employee_id uuid,
  p_event_type text,
  p_title text,
  p_body text default null,
  p_related_table text default null,
  p_related_id uuid default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_in_app_enabled boolean;
begin
  select in_app_enabled into v_in_app_enabled
  from public.leave_notification_settings
  where company_id = p_company_id and event_type = p_event_type;

  -- No configured row for this event yet = fail open to "on" (a newly added event type should not
  -- go silently unnotified just because Admin hasn't visited the settings screen) — matches
  -- leave_notification_settings' own column default of true.
  if coalesce(v_in_app_enabled, true) then
    insert into public.notifications (company_id, recipient_employee_id, event_type, title, body, related_table, related_id)
    values (p_company_id, p_recipient_employee_id, p_event_type, p_title, p_body, p_related_table, p_related_id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_resolve_salary_components(): resolves the salary row in force on a
-- given date — never "the latest row regardless of date", so a closing run
-- for FY 2026-27 always uses what was actually in force during that FY even
-- if the employee's salary changed afterward.
-- ----------------------------------------------------------------------------
create or replace function public.leave_resolve_salary_components(
  p_employee_id uuid,
  p_as_of_date date,
  out basic_salary numeric,
  out da numeric
)
returns record
language sql
stable
security definer
as $$
  select c.basic_salary, c.da
  from public.employee_salary_components c
  where c.employee_id = p_employee_id
    and c.effective_from <= p_as_of_date
    and (c.effective_to is null or c.effective_to >= p_as_of_date)
  order by c.effective_from desc
  limit 1;
$$;

grant execute on function public.leave_resolve_salary_components(uuid, date) to authenticated;
grant execute on function public.leave_notify(uuid, uuid, text, text, text, text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Notification read RPCs — identity always server-resolved, same as every
-- other Leave RPC.
-- ----------------------------------------------------------------------------
create or replace function public.leave_list_my_notifications(p_limit int default 50)
returns setof public.notifications
language sql
stable
security definer
as $$
  select * from public.notifications
  where recipient_employee_id = public.current_user_employee_id()
  order by created_at desc
  limit greatest(1, least(p_limit, 200));
$$;

create or replace function public.leave_unread_notification_count()
returns int
language sql
stable
security definer
as $$
  select count(*)::int from public.notifications
  where recipient_employee_id = public.current_user_employee_id() and not is_read;
$$;

create or replace function public.leave_mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.notifications
  set is_read = true
  where id = p_notification_id and recipient_employee_id = public.current_user_employee_id();
end;
$$;

create or replace function public.leave_mark_all_notifications_read()
returns void
language plpgsql
security definer
as $$
begin
  update public.notifications
  set is_read = true
  where recipient_employee_id = public.current_user_employee_id() and not is_read;
end;
$$;

grant execute on function public.leave_list_my_notifications(int) to authenticated;
grant execute on function public.leave_unread_notification_count() to authenticated;
grant execute on function public.leave_mark_notification_read(uuid) to authenticated;
grant execute on function public.leave_mark_all_notifications_read() to authenticated;
