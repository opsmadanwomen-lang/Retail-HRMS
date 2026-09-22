-- ============================================================================
-- Retail HRMS — Secure permanent DELETE for Salary Structures (Super Admin only)
-- Migration 0177
--
-- INSPECTED FIRST (live schema + migrations 0138/0140/0153/0175/0176):
--   * Authorization: public.is_super_admin() (profiles.role = 'super_admin'); this is the
--     mechanism already used by the salary_structures RLS policies. No second role system.
--   * Audit: trg_salary_structures_audit (write_audit_log) is AFTER INSERT/UPDATE/DELETE on
--     salary_structures and on the three child tables below. A DELETE writes audit_logs
--     (table_name, record_id, action = 'delete', changed_data = to_jsonb(OLD) which carries
--     code / name / status, performed_by = auth.uid(), performed_at). Reused as-is — no new
--     audit infrastructure. Child rows removed below are audited by their own triggers.
--   * Foreign keys that point at salary_structures (NOT all of them cascade):
--       salary_structure_components     ON DELETE CASCADE   -> exclusive to the structure, removed
--       salary_slab_rules               ON DELETE CASCADE   -> exclusive to the structure, removed
--       salary_structure_assignments    ON DELETE CASCADE   -> scope RULES (no UI); removed unless
--                                                              they target a specific employee
--       employee_salary_assignments     ON DELETE SET NULL  -> would silently ERASE salary history: BLOCK
--       employee_assignment_history     NO ACTION           -> protected history: BLOCK
--       employee_transfer_requests      NO ACTION (new_salary_structure_id) -> BLOCK
--       fnf_settlements                 NO ACTION           -> Full & Final history: BLOCK
--       salary_structures.previous_version_id NO ACTION     -> version chain: BLOCK
--     and payroll_employee_results.salary_structure_id has NO foreign key at all, so the
--     database would NOT stop a delete that leaves payroll history dangling: checked explicitly
--     (any payroll result row, whatever the run status, blocks).
--
-- ADDS (nothing existing is redefined — salary_bifurcate / preview / resolve / activate /
-- clone / payroll engine / slab overlap are untouched):
--   1. salary_structure_delete_check(uuid) — Super Admin only, read-only. Returns the counts and
--      the first blocker; drives the confirmation dialog.
--   2. salary_structure_delete(uuid)       — Super Admin only. Locks the row, re-runs the same check,
--      then deletes the structure and only its own components / slabs / non-employee rules.
--   3. Drops the salary_structures DELETE RLS policy. It let a Super Admin DELETE a structure
--      straight through the API, bypassing every check above (and, via ON DELETE SET NULL,
--      erasing employee salary history). Nothing in the app uses that path (the app only
--      inserts/updates salary_structures). The RPC is SECURITY DEFINER so it is unaffected,
--      and FK cascades from a parent (e.g. company) never go through RLS.
--
-- Deletable = status is NOT 'active' AND no employee/payroll/protected reference.
-- Deployment: run in the Supabase SQL editor / linked-DB SQL runner like earlier migrations.
-- Never `supabase db push`. Idempotent (create or replace / drop policy if exists).
-- ============================================================================

create or replace function public.salary_structure_delete_check(p_structure_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s public.salary_structures;
  v_components int; v_slabs int; v_rules int;
  v_emp_assign int; v_payroll int; v_protected int;
  v_code text := null; v_msg text := null;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.' using errcode = '28000', hint = 'NOT_AUTHENTICATED';
  end if;
  -- is_super_admin() is NULL (not false) for a signed-in user with no profiles row, and `not NULL` is NULL,
  -- which would silently skip this guard. Only an explicit TRUE passes.
  if coalesce(public.is_super_admin(), false) is not true then
    raise exception 'Not authorised — only a Super Admin can delete a salary structure.' using errcode = '42501', hint = 'NOT_AUTHORISED';
  end if;

  select * into v_s from public.salary_structures where id = p_structure_id;
  if v_s.id is null then
    raise exception 'Salary structure not found.' using errcode = 'P0002', hint = 'NOT_FOUND';
  end if;

  select count(*) into v_components from public.salary_structure_components where salary_structure_id = v_s.id;
  select count(*) into v_slabs      from public.salary_slab_rules            where salary_structure_id = v_s.id;
  -- scope rules that do NOT name a specific employee: draft-only configuration, removed with the structure
  select count(*) into v_rules      from public.salary_structure_assignments
                                    where salary_structure_id = v_s.id and scope_type <> 'employee' and employee_id is null;

  -- employee-level references: salary revisions, employee-scope rules
  select (select count(*) from public.employee_salary_assignments where salary_structure_id = v_s.id)
       + (select count(*) from public.salary_structure_assignments where salary_structure_id = v_s.id
                                                                     and (scope_type = 'employee' or employee_id is not null))
    into v_emp_assign;

  -- payroll history (no FK protects this one)
  select count(*) into v_payroll from public.payroll_employee_results where salary_structure_id = v_s.id;

  -- other protected historical references
  select (select count(*) from public.fnf_settlements            where salary_structure_id     = v_s.id)
       + (select count(*) from public.employee_assignment_history where salary_structure_id     = v_s.id)
       + (select count(*) from public.employee_transfer_requests  where new_salary_structure_id = v_s.id)
       + (select count(*) from public.salary_structures           where previous_version_id     = v_s.id)
    into v_protected;

  if v_s.status = 'active' then
    v_code := 'ACTIVE';
    v_msg  := 'Cannot delete this Salary Structure because it is active. Deactivate/Archive it instead.';
  elsif v_emp_assign > 0 then
    v_code := 'EMPLOYEE_ASSIGNED';
    v_msg  := format('Cannot delete this Salary Structure because it is currently assigned to employees or referenced by employee salary history (%s record(s)).', v_emp_assign);
  elsif v_payroll > 0 then
    v_code := 'PAYROLL_USED';
    v_msg  := format('Cannot delete this Salary Structure because it has been used in payroll history (%s payroll result(s)). Please archive/deactivate it instead.', v_payroll);
  elsif v_protected > 0 then
    v_code := 'PROTECTED_HISTORY';
    v_msg  := format('Cannot delete this Salary Structure because it is referenced by protected historical records (%s reference(s) in Full & Final settlements, assignment/transfer history, or another structure''s version chain). Archive/deactivate it instead.', v_protected);
  end if;

  return jsonb_build_object(
    'id', v_s.id, 'company_id', v_s.company_id, 'code', v_s.code, 'name', v_s.name, 'status', v_s.status,
    'component_count', v_components,
    'slab_count', v_slabs,
    'rule_assignment_count', v_rules,
    'employee_assignment_count', v_emp_assign,
    'payroll_use_count', v_payroll,
    'protected_reference_count', v_protected,
    'is_assigned_to_employees', v_emp_assign > 0,
    'used_in_payroll', v_payroll > 0,
    'can_delete', v_code is null,
    'block_code', v_code,
    'block_message', v_msg
  );
end;
$$;

create or replace function public.salary_structure_delete(p_structure_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s public.salary_structures;
  v_chk jsonb;
  v_components int; v_slabs int; v_rules int;
begin
  -- Authorization BEFORE any lookup so an unauthorised caller learns nothing about the structure.
  if auth.uid() is null then
    raise exception 'Not authenticated.' using errcode = '28000', hint = 'NOT_AUTHENTICATED';
  end if;
  if coalesce(public.is_super_admin(), false) is not true then   -- NULL-safe: see salary_structure_delete_check
    raise exception 'Not authorised — only a Super Admin can delete a salary structure.' using errcode = '42501', hint = 'NOT_AUTHORISED';
  end if;

  -- Lock the row: a concurrent salary_assign_employee() (FK insert takes a share lock on it) either
  -- committed before this point and is seen by the check, or waits and then fails its FK.
  select * into v_s from public.salary_structures where id = p_structure_id for update;
  if v_s.id is null then
    raise exception 'Salary structure not found.' using errcode = 'P0002', hint = 'NOT_FOUND';
  end if;

  v_chk := public.salary_structure_delete_check(v_s.id);
  if not (v_chk ->> 'can_delete')::boolean then
    raise exception '%', v_chk ->> 'block_message' using errcode = 'P0001', hint = v_chk ->> 'block_code';
  end if;

  -- Only data that belongs exclusively to this (unused, non-active) structure. Explicit rather than
  -- relying on cascade so the counts are reported; each delete is audited by the table's own trigger.
  delete from public.salary_structure_components  where salary_structure_id = v_s.id;  get diagnostics v_components = row_count;
  delete from public.salary_slab_rules            where salary_structure_id = v_s.id;  get diagnostics v_slabs = row_count;
  delete from public.salary_structure_assignments where salary_structure_id = v_s.id;  get diagnostics v_rules = row_count;
  delete from public.salary_structures            where id = v_s.id;                   -- audited: action 'delete', old row incl. code/name

  return jsonb_build_object(
    'ok', true, 'id', v_s.id, 'code', v_s.code, 'name', v_s.name, 'status', v_s.status,
    'deleted_components', v_components, 'deleted_slabs', v_slabs, 'deleted_rule_assignments', v_rules
  );
end;
$$;

revoke all on function public.salary_structure_delete_check(uuid) from public, anon;
revoke all on function public.salary_structure_delete(uuid)       from public, anon;
grant execute on function public.salary_structure_delete_check(uuid) to authenticated;
grant execute on function public.salary_structure_delete(uuid)       to authenticated;

-- Close the direct-API delete path (see header). RPC above is the only sanctioned way to delete.
drop policy if exists "salary_structures_delete" on public.salary_structures;
