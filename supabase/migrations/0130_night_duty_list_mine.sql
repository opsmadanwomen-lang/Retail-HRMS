-- ============================================================================
-- Retail HRMS — Night Duty: Staff-side self-scoped "my Night Duty history"
-- Migration 0130
--
-- Approvals -> Night Duty Approval must, for a normal Staff user, show THAT
-- employee's own Night Duty requests and their full approval history (Pending
-- / Approved / Disallowed), mirroring the Leave Approval page. The existing
-- Staff card previously used a client-supplied employee_id
-- (extendedAttendanceRuleService.getMyNightDutyApprovals(employeeId)) capped
-- at 10 rows.
--
-- This RPC is the secure replacement for that page: strictly scoped to
-- current_user_employee_id() server-side, NO employee-id parameter, so no
-- client value can widen the result. It only READS the EXISTING
-- attendance_night_duty_approvals row (which already carries the whole OM ->
-- Super Manager decision trail as columns — om_*, super_manager_*,
-- manager_confirmed_payable_out_at) plus the LIVE figures from
-- attendance_records. NO new table, NO duplicate record, NO change to any
-- Night Duty calculation, decide RPC, threshold, payable logic, or the
-- OM -> Super Manager workflow.
-- ============================================================================
create or replace function public.attendance_night_duty_list_mine()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  attendance_record_id uuid,
  attendance_date date,
  punch_in_at timestamptz,
  actual_punch_out_at timestamptz,
  extra_duty_value numeric,
  night_ot_minutes int,
  payable_extra_duty_value numeric,
  payable_overtime_minutes int,
  approval_status text,
  om_id uuid,
  om_name text,
  om_action text,
  om_acted_at timestamptz,
  om_remark text,
  super_manager_id uuid,
  super_manager_name text,
  super_manager_action text,
  super_manager_acted_at timestamptz,
  super_manager_remark text,
  manager_confirmed_payable_out_at timestamptz,
  manager_remark text,
  created_at timestamptz,
  decided_stage text,
  decided_by_name text,
  decided_action text,
  decided_at timestamptz,
  decided_remark text
)
language sql
stable
security definer
as $$
  select
    a.id,
    a.employee_id,
    e.full_name  as employee_name,
    a.attendance_record_id,
    a.attendance_date,
    r.punch_in_at,
    a.actual_punch_out_at,
    coalesce(r.extra_duty_value, a.extra_duty_value)        as extra_duty_value,
    coalesce(r.night_ot_minutes, a.night_ot_minutes)        as night_ot_minutes,
    r.payable_extra_duty_value,
    r.payable_overtime_minutes,
    a.approval_status,
    a.om_id,
    om.full_name as om_name,
    a.om_action,
    a.om_acted_at,
    a.om_remark,
    a.super_manager_id,
    sm.full_name as super_manager_name,
    a.super_manager_action,
    a.super_manager_acted_at,
    a.super_manager_remark,
    a.manager_confirmed_payable_out_at,
    a.manager_remark,
    a.created_at,
    -- terminal decision (whichever step actually finalised the request)
    case
      when a.super_manager_action is not null then 'Super Manager'
      when a.om_action in ('approved', 'disallowed')  then 'Operations Manager'
      when a.approval_status in ('approved', 'disallowed') then 'Administrator'
      else null
    end as decided_stage,
    case
      when a.super_manager_action is not null then sm.full_name
      when a.om_action in ('approved', 'disallowed')  then om.full_name
      when a.approval_status in ('approved', 'disallowed') then adm.full_name
      else null
    end as decided_by_name,
    case
      when a.super_manager_action is not null then a.super_manager_action
      when a.om_action in ('approved', 'disallowed')  then a.om_action
      when a.approval_status in ('approved', 'disallowed') then a.approval_status
      else null
    end as decided_action,
    case
      when a.super_manager_action is not null then a.super_manager_acted_at
      when a.om_action in ('approved', 'disallowed')  then a.om_acted_at
      when a.approval_status in ('approved', 'disallowed') then a.approved_at
      else null
    end as decided_at,
    case
      when a.super_manager_action is not null then a.super_manager_remark
      when a.om_action in ('approved', 'disallowed')  then a.om_remark
      when a.approval_status in ('approved', 'disallowed') then a.manager_remark
      else null
    end as decided_remark
  from public.attendance_night_duty_approvals a
  join public.employees e  on e.id = a.employee_id
  left join public.attendance_records r on r.id = a.attendance_record_id
  left join public.employees om  on om.id = a.om_id
  left join public.employees sm  on sm.id = a.super_manager_id
  left join public.employees adm on adm.id = a.approved_by
  where a.employee_id = public.current_user_employee_id()
  order by a.attendance_date desc, a.created_at desc;
$$;

grant execute on function public.attendance_night_duty_list_mine() to authenticated;
