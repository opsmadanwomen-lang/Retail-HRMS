-- ============================================================================
-- Retail HRMS — Leave Management, Phase 5: Leave -> Attendance integration
-- schema
-- Migration 0121
--
-- SCOPE DECISION (from inspecting the existing Attendance Calendar before
-- writing anything): `attendance_records` has `unique(employee_id,
-- attendance_date)` and does NOT have a row for every day — the Staff
-- Attendance Calendar (buildMonthlyAttendanceRows() /
-- src/modules/attendance/utils.ts) already fills gaps CLIENT-SIDE with a
-- precedence chain: an actual attendance_records row wins, else Weekly Off,
-- else Absent. Its own `MonthlyAttendanceRow.status` type and
-- `buildAttendanceSummary()` ALREADY have a `'leave'` branch fully wired
-- (`case "leave": summary.leave += 1`) — genuinely never fed, since nothing
-- currently supplies leave dates. A comment on toAttendanceRow() even names
-- "an approved-leave entry" as an example of what could feed that
-- precedence chain. This is the intended, already-anticipated integration
-- point: NEVER writing into attendance_records or touching any Attendance
-- RPC — Leave dates are merged in at the SAME client-side display layer
-- that already merges Weekly Off, exactly preserving existing precedence
-- (a real attendance_records row still always wins).
--
-- leave_attendance_effects: the per-DATE materialization of an approved
-- application's chargeable days — needed because leave_applications only
-- stores from_date/to_date/total_days, not which specific dates within that
-- range were actually chargeable (Weekly Off/Holiday days inside the range
-- are excluded from the count per the SAME leave_compute_total_days()
-- rules — reused verbatim in the materialize function below, never
-- reimplemented). This is a display-materialization of an ALREADY-decided
-- total, not a second balance/day-count engine. Append-only in spirit: a
-- row is marked 'reversed' on cancellation, never deleted or edited.
-- ============================================================================
create table if not exists public.leave_attendance_effects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_application_id uuid not null references public.leave_applications (id) on delete cascade,
  attendance_date date not null,
  is_half_day boolean not null default false,
  half_day_session text,
  status text not null default 'active' check (status in ('active', 'reversed')),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid,
  -- Idempotency + correctness: exactly one ACTIVE leave effect may exist per employee per date —
  -- matches attendance_applications' own overlap prevention (only one approved/pending application
  -- can ever cover a given date), enforced here at the database level too, not just trusted from
  -- the caller. A partial unique index (not a plain unique constraint) so a REVERSED row never
  -- blocks a later, unrelated leave from covering the same date after the first was cancelled.
  constraint leave_attendance_effects_no_reverse_reason check (status = 'active' or reversed_at is not null)
);

create unique index if not exists idx_leave_attendance_effects_one_active_per_date
  on public.leave_attendance_effects (employee_id, attendance_date)
  where status = 'active';

create index if not exists idx_leave_attendance_effects_application on public.leave_attendance_effects (leave_application_id);
create index if not exists idx_leave_attendance_effects_employee_date on public.leave_attendance_effects (employee_id, attendance_date);

alter table public.leave_attendance_effects enable row level security;

-- Same visibility shape as leave_applications itself (Staff sees own; Direct Manager/Super Manager
-- see the applications they're authorized for; company non-staff roles see company-wide) — mirrors
-- migration 0102's pattern exactly, never a new/different authorization rule for this table.
create policy "leave_attendance_effects_select_scoped" on public.leave_attendance_effects for select
  using (
    is_super_admin()
    or (current_user_role() <> 'staff' and company_id = current_user_company_id())
    or (current_user_role() = 'staff' and employee_id = current_user_employee_id())
    or (current_user_role() = 'staff' and public.leave_resolve_direct_manager(employee_id) = current_user_employee_id())
    or (current_user_role() = 'staff' and exists (
      select 1 from public.attendance_super_managers sm where sm.employee_id = current_user_employee_id() and sm.is_active and sm.company_id = leave_attendance_effects.company_id
    ))
  );
-- All writes happen via SECURITY DEFINER RPCs only (leave_materialize_attendance_dates(), called
-- from leave_manager_decide()/leave_super_manager_decide(); reversal from leave_cancel()) — never a
-- direct client insert/update, same as every other Leave transactional table in this codebase.
create policy "leave_attendance_effects_insert_scoped" on public.leave_attendance_effects for insert with check (is_super_admin());
create policy "leave_attendance_effects_update_scoped" on public.leave_attendance_effects for update using (is_super_admin());

create trigger trg_leave_attendance_effects_audit after insert or update on public.leave_attendance_effects for each row execute function public.write_audit_log();

-- ----------------------------------------------------------------------------
-- leave_materialize_attendance_dates(): reuses the EXACT SAME per-day
-- Weekly-Off/Holiday exclusion rules leave_compute_total_days() already
-- applied when the application's total_days was first computed — never a
-- second day-count algorithm. Idempotent via ON CONFLICT DO NOTHING against
-- the partial unique index above (a retry/duplicate call never creates
-- duplicate rows).
-- ----------------------------------------------------------------------------
create or replace function public.leave_materialize_attendance_dates(p_application_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_app public.leave_applications%rowtype;
  v_config record;
  v_employee record;
  v_day date;
  v_is_weekly_off boolean;
  v_is_holiday boolean;
begin
  select * into v_app from public.leave_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'Leave application not found.';
  end if;
  if v_app.status <> 'approved' then
    raise exception 'Only an approved leave application can be materialized into Attendance.';
  end if;

  if v_app.is_half_day then
    insert into public.leave_attendance_effects (company_id, employee_id, leave_application_id, attendance_date, is_half_day, half_day_session)
    values (v_app.company_id, v_app.employee_id, v_app.id, v_app.from_date, true, v_app.half_day_session)
    on conflict (employee_id, attendance_date) where status = 'active' do nothing;
    return;
  end if;

  select weekly_off_count_rule, holiday_count_rule into v_config
  from public.leave_policy_type_configs
  where policy_id = v_app.policy_id and leave_type_id = v_app.leave_type_id;

  select company_id, store_id into v_employee from public.employees where id = v_app.employee_id;

  v_day := v_app.from_date;
  while v_day <= v_app.to_date loop
    v_is_weekly_off := public.is_weekly_off_on_date(v_app.employee_id, v_day);
    v_is_holiday := exists (
      select 1 from public.holidays h
      where h.company_id = v_employee.company_id and h.holiday_date = v_day and (h.store_id is null or h.store_id = v_employee.store_id)
    );

    if v_is_weekly_off and coalesce(v_config.weekly_off_count_rule, 'dont_count') <> 'count' then
      -- excluded — the same day the balance calculation excluded; never shown as Leave in Attendance
    elsif v_is_holiday and coalesce(v_config.holiday_count_rule, 'dont_count') <> 'count' then
      -- excluded — same reasoning
    else
      insert into public.leave_attendance_effects (company_id, employee_id, leave_application_id, attendance_date, is_half_day)
      values (v_app.company_id, v_app.employee_id, v_app.id, v_day, false)
      on conflict (employee_id, attendance_date) where status = 'active' do nothing;
    end if;

    v_day := v_day + 1;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Read RPC for the Attendance Calendar — returns exactly the dates/half-day
-- flags the frontend precedence chain needs, RLS-scoped the same as the
-- table itself.
-- ----------------------------------------------------------------------------
create or replace function public.leave_list_attendance_effects(p_employee_id uuid, p_from_date date, p_to_date date)
returns table (attendance_date date, is_half_day boolean, half_day_session text)
language sql
stable
security definer
as $$
  select e.attendance_date, e.is_half_day, e.half_day_session
  from public.leave_attendance_effects e
  where e.employee_id = p_employee_id
    and e.status = 'active'
    and e.attendance_date between p_from_date and p_to_date
    and (
      is_super_admin()
      or (current_user_role() <> 'staff' and e.company_id = current_user_company_id())
      or (current_user_role() = 'staff' and e.employee_id = current_user_employee_id())
      or (current_user_role() = 'staff' and public.leave_resolve_direct_manager(e.employee_id) = current_user_employee_id())
    );
$$;

grant execute on function public.leave_materialize_attendance_dates(uuid) to authenticated;
grant execute on function public.leave_list_attendance_effects(uuid, date, date) to authenticated;
