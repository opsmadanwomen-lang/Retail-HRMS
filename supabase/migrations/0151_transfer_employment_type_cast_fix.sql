-- ============================================================================
-- Retail HRMS — Phase 2 fix: employees.employment_type is the ENUM
--   public.employment_type (full_time/part_time/contract/intern/consultant),
--   not text. employee_transfer_requests.new_employment_type /
--   employee_assignment_history.employment_type are plain text (so a company
--   is never blocked by a value not yet in the enum). Cast at the enum<->text
--   boundary instead of at the live employees column's own type.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._transfer_apply_history_and_engines(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  r public.employee_transfer_requests; v_open public.employee_assignment_history; v_emp record;
  v_gross numeric; v_close date;
begin
  select * into r from public.employee_transfer_requests where id = p_id;
  select id, joining_date, store_id, store_department_id, store_designation_id, store_team_id,
         grade_id, category_id, reporting_manager_id, employment_type
    into v_emp from public.employees where id = r.employee_id;

  select * into v_open from public.employee_assignment_history where employee_id = r.employee_id and effective_to is null;
  v_close := r.effective_date - 1;

  if v_open.id is null then
    -- no history yet: baseline the employee's CURRENT assignment from joining, closed the day before this transfer.
    insert into public.employee_assignment_history (
      company_id, employee_id, effective_from, effective_to, store_id, store_department_id, store_designation_id,
      store_team_id, grade_id, category_id, reporting_manager_id, employment_type, source, created_by
    ) values (
      r.company_id, r.employee_id, coalesce(v_emp.joining_date, r.effective_date), v_close,
      v_emp.store_id, v_emp.store_department_id, v_emp.store_designation_id, v_emp.store_team_id,
      v_emp.grade_id, v_emp.category_id, v_emp.reporting_manager_id, v_emp.employment_type::text, 'initial', auth.uid()
    );
  else
    update public.employee_assignment_history set effective_to = v_close where id = v_open.id;
  end if;

  insert into public.employee_assignment_history (
    company_id, employee_id, effective_from, effective_to,
    store_id, store_department_id, store_designation_id, store_team_id, grade_id, category_id,
    reporting_manager_id, super_manager_id, employment_type, salary_structure_id, shift_id,
    source, transfer_request_id, reason, created_by
  ) values (
    r.company_id, r.employee_id, r.effective_date, null,
    coalesce(r.new_store_id, v_open.store_id, v_emp.store_id),
    coalesce(r.new_store_department_id, v_open.store_department_id, v_emp.store_department_id),
    coalesce(r.new_store_designation_id, v_open.store_designation_id, v_emp.store_designation_id),
    coalesce(r.new_store_team_id, v_open.store_team_id, v_emp.store_team_id),
    coalesce(r.new_grade_id, v_open.grade_id, v_emp.grade_id),
    coalesce(r.new_category_id, v_open.category_id, v_emp.category_id),
    coalesce(r.new_reporting_manager_id, v_open.reporting_manager_id, v_emp.reporting_manager_id),
    coalesce(r.new_super_manager_id, v_open.super_manager_id),
    coalesce(r.new_employment_type, v_open.employment_type, v_emp.employment_type::text),
    coalesce(r.new_salary_structure_id, v_open.salary_structure_id),
    coalesce(r.new_shift_id, v_open.shift_id),
    'transfer', r.id, r.reason, auth.uid()
  );

  -- salary structure change: reuse the EXISTING Dynamic Salary Structure engine, same gross.
  if r.new_salary_structure_id is not null then
    select gross_salary into v_gross from public.salary_resolve_for_employee(r.employee_id, current_date);
    if v_gross is not null then
      perform public.salary_assign_employee(r.employee_id, v_gross, r.effective_date, r.new_salary_structure_id, 'Transfer', r.reason);
    end if;
  end if;

  -- shift change: reuse the EXISTING effective-dated shift-assignment table.
  if r.new_shift_id is not null then
    update public.employee_shift_assignments set effective_to = v_close, is_active = false
    where employee_id = r.employee_id and effective_to is null;
    insert into public.employee_shift_assignments (company_id, employee_id, shift_id, effective_from, effective_to, is_active, created_by, updated_by, remark)
    values (r.company_id, r.employee_id, r.new_shift_id, r.effective_date, null, true, auth.uid(), auth.uid(), 'Transfer ' || r.id::text);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public._transfer_sync_live_employee(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare r public.employee_transfer_requests;
begin
  select * into r from public.employee_transfer_requests where id = p_id;
  update public.employees set
    store_id = coalesce(r.new_store_id, store_id),
    store_department_id = coalesce(r.new_store_department_id, store_department_id),
    store_designation_id = coalesce(r.new_store_designation_id, store_designation_id),
    store_team_id = coalesce(r.new_store_team_id, store_team_id),
    grade_id = coalesce(r.new_grade_id, grade_id),
    category_id = coalesce(r.new_category_id, category_id),
    reporting_manager_id = coalesce(r.new_reporting_manager_id, reporting_manager_id),
    employment_type = coalesce(r.new_employment_type::public.employment_type, employment_type),
    updated_by = auth.uid()
  where id = r.employee_id;
  update public.employee_transfer_requests set status = 'effective', applied_at = now(), updated_by = auth.uid() where id = p_id;
end;
$function$;


-- fix: same-day transfer supersede must not violate the effective_to>=effective_from check.
CREATE OR REPLACE FUNCTION public._transfer_apply_history_and_engines(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  r public.employee_transfer_requests; v_open public.employee_assignment_history; v_emp record;
  v_gross numeric; v_close date;
begin
  select * into r from public.employee_transfer_requests where id = p_id;
  select id, joining_date, store_id, store_department_id, store_designation_id, store_team_id,
         grade_id, category_id, reporting_manager_id, employment_type
    into v_emp from public.employees where id = r.employee_id;

  select * into v_open from public.employee_assignment_history where employee_id = r.employee_id and effective_to is null;
  v_close := r.effective_date - 1;

  if v_open.id is null then
    -- no history yet: baseline the employee's CURRENT assignment from joining, closed the day before this transfer.
    insert into public.employee_assignment_history (
      company_id, employee_id, effective_from, effective_to, store_id, store_department_id, store_designation_id,
      store_team_id, grade_id, category_id, reporting_manager_id, employment_type, source, created_by
    ) values (
      r.company_id, r.employee_id, coalesce(v_emp.joining_date, r.effective_date), v_close,
      v_emp.store_id, v_emp.store_department_id, v_emp.store_designation_id, v_emp.store_team_id,
      v_emp.grade_id, v_emp.category_id, v_emp.reporting_manager_id, v_emp.employment_type::text, 'initial', auth.uid()
    );
  elsif v_open.effective_from >= r.effective_date then
    -- same-day (or out-of-order) supersede: the open row never had any elapsed
    -- duration before this transfer takes effect — replace it outright rather
    -- than close it with an effective_to before its own effective_from.
    -- employees.* already reflects it live if it was already synced (only
    -- possible when its own effective_from <= current_date), so v_emp below
    -- (re-read fresh at the top of this call) is never stale.
    delete from public.employee_assignment_history where id = v_open.id;
    v_open := null;
  else
    update public.employee_assignment_history set effective_to = v_close where id = v_open.id;
  end if;

  insert into public.employee_assignment_history (
    company_id, employee_id, effective_from, effective_to,
    store_id, store_department_id, store_designation_id, store_team_id, grade_id, category_id,
    reporting_manager_id, super_manager_id, employment_type, salary_structure_id, shift_id,
    source, transfer_request_id, reason, created_by
  ) values (
    r.company_id, r.employee_id, r.effective_date, null,
    coalesce(r.new_store_id, v_open.store_id, v_emp.store_id),
    coalesce(r.new_store_department_id, v_open.store_department_id, v_emp.store_department_id),
    coalesce(r.new_store_designation_id, v_open.store_designation_id, v_emp.store_designation_id),
    coalesce(r.new_store_team_id, v_open.store_team_id, v_emp.store_team_id),
    coalesce(r.new_grade_id, v_open.grade_id, v_emp.grade_id),
    coalesce(r.new_category_id, v_open.category_id, v_emp.category_id),
    coalesce(r.new_reporting_manager_id, v_open.reporting_manager_id, v_emp.reporting_manager_id),
    coalesce(r.new_super_manager_id, v_open.super_manager_id),
    coalesce(r.new_employment_type, v_open.employment_type, v_emp.employment_type::text),
    coalesce(r.new_salary_structure_id, v_open.salary_structure_id),
    coalesce(r.new_shift_id, v_open.shift_id),
    'transfer', r.id, r.reason, auth.uid()
  );

  -- salary structure change: reuse the EXISTING Dynamic Salary Structure engine, same gross.
  if r.new_salary_structure_id is not null then
    select gross_salary into v_gross from public.salary_resolve_for_employee(r.employee_id, current_date);
    if v_gross is not null then
      perform public.salary_assign_employee(r.employee_id, v_gross, r.effective_date, r.new_salary_structure_id, 'Transfer', r.reason);
    end if;
  end if;

  -- shift change: reuse the EXISTING effective-dated shift-assignment table.
  if r.new_shift_id is not null then
    delete from public.employee_shift_assignments
    where employee_id = r.employee_id and effective_to is null and effective_from >= r.effective_date;
    update public.employee_shift_assignments set effective_to = v_close, is_active = false
    where employee_id = r.employee_id and effective_to is null and effective_from < r.effective_date;
    insert into public.employee_shift_assignments (company_id, employee_id, shift_id, effective_from, effective_to, is_active, created_by, updated_by, remark)
    values (r.company_id, r.employee_id, r.new_shift_id, r.effective_date, null, true, auth.uid(), auth.uid(), 'Transfer ' || r.id::text);
  end if;
end;
$function$;


-- fix: guard salary re-assignment against an unresolved (0/null) gross.
CREATE OR REPLACE FUNCTION public._transfer_apply_history_and_engines(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  r public.employee_transfer_requests; v_open public.employee_assignment_history; v_emp record;
  v_gross numeric; v_close date;
begin
  select * into r from public.employee_transfer_requests where id = p_id;
  select id, joining_date, store_id, store_department_id, store_designation_id, store_team_id,
         grade_id, category_id, reporting_manager_id, employment_type
    into v_emp from public.employees where id = r.employee_id;

  select * into v_open from public.employee_assignment_history where employee_id = r.employee_id and effective_to is null;
  v_close := r.effective_date - 1;

  if v_open.id is null then
    -- no history yet: baseline the employee's CURRENT assignment from joining, closed the day before this transfer.
    insert into public.employee_assignment_history (
      company_id, employee_id, effective_from, effective_to, store_id, store_department_id, store_designation_id,
      store_team_id, grade_id, category_id, reporting_manager_id, employment_type, source, created_by
    ) values (
      r.company_id, r.employee_id, coalesce(v_emp.joining_date, r.effective_date), v_close,
      v_emp.store_id, v_emp.store_department_id, v_emp.store_designation_id, v_emp.store_team_id,
      v_emp.grade_id, v_emp.category_id, v_emp.reporting_manager_id, v_emp.employment_type::text, 'initial', auth.uid()
    );
  elsif v_open.effective_from >= r.effective_date then
    -- same-day (or out-of-order) supersede: the open row never had any elapsed
    -- duration before this transfer takes effect — replace it outright rather
    -- than close it with an effective_to before its own effective_from.
    -- employees.* already reflects it live if it was already synced (only
    -- possible when its own effective_from <= current_date), so v_emp below
    -- (re-read fresh at the top of this call) is never stale.
    delete from public.employee_assignment_history where id = v_open.id;
    v_open := null;
  else
    update public.employee_assignment_history set effective_to = v_close where id = v_open.id;
  end if;

  insert into public.employee_assignment_history (
    company_id, employee_id, effective_from, effective_to,
    store_id, store_department_id, store_designation_id, store_team_id, grade_id, category_id,
    reporting_manager_id, super_manager_id, employment_type, salary_structure_id, shift_id,
    source, transfer_request_id, reason, created_by
  ) values (
    r.company_id, r.employee_id, r.effective_date, null,
    coalesce(r.new_store_id, v_open.store_id, v_emp.store_id),
    coalesce(r.new_store_department_id, v_open.store_department_id, v_emp.store_department_id),
    coalesce(r.new_store_designation_id, v_open.store_designation_id, v_emp.store_designation_id),
    coalesce(r.new_store_team_id, v_open.store_team_id, v_emp.store_team_id),
    coalesce(r.new_grade_id, v_open.grade_id, v_emp.grade_id),
    coalesce(r.new_category_id, v_open.category_id, v_emp.category_id),
    coalesce(r.new_reporting_manager_id, v_open.reporting_manager_id, v_emp.reporting_manager_id),
    coalesce(r.new_super_manager_id, v_open.super_manager_id),
    coalesce(r.new_employment_type, v_open.employment_type, v_emp.employment_type::text),
    coalesce(r.new_salary_structure_id, v_open.salary_structure_id),
    coalesce(r.new_shift_id, v_open.shift_id),
    'transfer', r.id, r.reason, auth.uid()
  );

  -- salary structure change: reuse the EXISTING Dynamic Salary Structure engine, same gross.
  if r.new_salary_structure_id is not null then
    select gross_salary into v_gross from public.salary_resolve_for_employee(r.employee_id, current_date);
    if coalesce(v_gross, 0) > 0 then
      perform public.salary_assign_employee(r.employee_id, v_gross, r.effective_date, r.new_salary_structure_id, 'Transfer', r.reason);
    end if;
  end if;

  -- shift change: reuse the EXISTING effective-dated shift-assignment table.
  if r.new_shift_id is not null then
    delete from public.employee_shift_assignments
    where employee_id = r.employee_id and effective_to is null and effective_from >= r.effective_date;
    update public.employee_shift_assignments set effective_to = v_close, is_active = false
    where employee_id = r.employee_id and effective_to is null and effective_from < r.effective_date;
    insert into public.employee_shift_assignments (company_id, employee_id, shift_id, effective_from, effective_to, is_active, created_by, updated_by, remark)
    values (r.company_id, r.employee_id, r.new_shift_id, r.effective_date, null, true, auth.uid(), auth.uid(), 'Transfer ' || r.id::text);
  end if;
end;
$function$;

