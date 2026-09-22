-- ============================================================================
-- Retail HRMS — Phase 2 correction (continued):
--   Authoritative effective-date resolution for Employee Transfer.
--
-- Problem: salary_resolve_for_employee(), payroll_resolve_policy_for_employee()
-- and attendance_admin_upsert() all read the employee's CURRENT/LIVE store /
-- department / designation / grade / category / employment_type columns with
-- no date-awareness, then used those live values for scope-tier matching
-- against salary_structure_assignments / payroll_policy_assignments, or for
-- attendance store attribution. employee_assignment_history rows are written
-- IMMEDIATELY at transfer approval (regardless of whether effective_date is
-- future), so it is the authoritative ledger — but these three functions
-- never consulted it. That made date-based resolution incorrect for a
-- transferred employee: it used TODAY's assignment regardless of the
-- payroll/attendance date being resolved.
--
-- Fix: each function now resolves scope fields via
-- employee_assignment_as_of(employee_id, as_of_date) and coalesces onto the
-- live columns. An employee with no assignment history (never transferred)
-- gets an all-null row back, so every coalesce falls through to the live
-- column unchanged — zero behavioural change for any company/employee that
-- has never used Employee Transfer.
--
-- payroll_calculate_run() additionally gets a best-effort housekeeping sweep
-- (transfer_apply_due_effective) at its start, so the legacy employees.* live
-- columns stay fresh for screens that still read them directly, WITHOUT ever
-- being a cron and WITHOUT payroll correctness depending on it (payroll's own
-- resolution is already date-correct via the two functions above,
-- independent of whether this sweep has run). A failure inside the sweep can
-- never abort the actual payroll calculation.
--
-- No new engine. No signature changes -> no DROP FUNCTION needed; CREATE OR
-- REPLACE preserves existing grants for all four functions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- E. salary_resolve_for_employee — scope fields resolved as of p_as_of.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salary_resolve_for_employee(p_employee_id uuid, p_as_of date)
 RETURNS TABLE(gross_salary numeric, salary_structure_id uuid, structure_name text, source text, ambiguous boolean, resolve_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_emp record;
  v_asg record;
  v_gross numeric;
  v_struct uuid;
  v_src text := '';
  v_note text := '';
  v_ambig boolean := false;
  v_cnt int;
  v_basic numeric; v_da numeric;
  v_tier record;
  v_hist public.employee_assignment_history;
begin
  select e.company_id, e.store_id, e.store_department_id, e.store_designation_id, e.grade_id, e.category_id,
         e.employment_type::text as employment_type
  into v_emp from public.employees e where e.id = p_employee_id;
  if v_emp.company_id is null then raise exception 'Employee not found.'; end if;

  -- Employee Transfer (Phase 2 correction): scope-based structure resolution
  -- must use the assignment EFFECTIVE as of p_as_of, not whatever the employee's
  -- live row happens to hold right now (which may lag until a transfer's
  -- effective date is swept) — resolve from the authoritative history ledger.
  -- No history for this employee -> v_hist is all-null -> every coalesce below
  -- falls back to the live columns, so an employee never transferred is
  -- completely unaffected.
  v_hist := public.employee_assignment_as_of(p_employee_id, p_as_of);
  v_emp.store_id := coalesce(v_hist.store_id, v_emp.store_id);
  v_emp.store_department_id := coalesce(v_hist.store_department_id, v_emp.store_department_id);
  v_emp.store_designation_id := coalesce(v_hist.store_designation_id, v_emp.store_designation_id);
  v_emp.grade_id := coalesce(v_hist.grade_id, v_emp.grade_id);
  v_emp.category_id := coalesce(v_hist.category_id, v_emp.category_id);
  v_emp.employment_type := coalesce(v_hist.employment_type, v_emp.employment_type);

  select * into v_asg from public.employee_salary_assignments a
  where a.employee_id = p_employee_id and a.effective_from <= p_as_of and (a.effective_to is null or a.effective_to >= p_as_of)
  order by a.effective_from desc limit 1;

  if v_asg.id is not null then
    v_gross := v_asg.gross_salary; v_src := 'assignment';
    if v_asg.salary_structure_id is not null then v_struct := v_asg.salary_structure_id; v_src := v_src || '+explicit_structure'; end if;
  else
    select sc.basic_salary, sc.da into v_basic, v_da
    from public.employee_salary_components sc
    where sc.employee_id = p_employee_id and sc.effective_from <= p_as_of and (sc.effective_to is null or sc.effective_to >= p_as_of)
    order by sc.effective_from desc limit 1;
    if v_basic is not null then
      v_gross := coalesce(v_basic, 0) + coalesce(v_da, 0); v_src := 'legacy_raw';
      v_note := 'No dynamic salary assignment — legacy Basic+DA used as Gross. Assign a salary structure for dynamic bifurcation.';
    else
      v_gross := 0; v_src := 'none'; v_note := 'No salary assignment or legacy salary components for this employee.';
    end if;
  end if;

  if v_struct is null and v_gross > 0 then
    for v_tier in
      select ord, scope, ss, cnt from (
        select 1 ord, 'employee' scope, (array_agg(sa.salary_structure_id order by sa.priority))[1] ss, count(*) cnt, min(sa.priority) minp,
               count(*) filter (where sa.priority = (select min(x.priority) from public.salary_structure_assignments x
                 where x.company_id=v_emp.company_id and x.is_active and x.scope_type='employee' and x.employee_id=p_employee_id
                   and x.effective_from<=p_as_of and (x.effective_to is null or x.effective_to>=p_as_of))) tied
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='employee' and sa.employee_id=p_employee_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 2, 'grade', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0,
               count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='grade' and sa.grade_id=v_emp.grade_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 3, 'category', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='category' and sa.category_id=v_emp.category_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 4, 'store_designation', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_designation' and sa.store_designation_id=v_emp.store_designation_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 5, 'store_department', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='store_department' and sa.store_department_id=v_emp.store_department_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 6, 'location', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type in ('location','store') and sa.store_id=v_emp.store_id
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 7, 'employment_type', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='employment_type' and sa.employment_type=v_emp.employment_type
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
        union all
        select 8, 'company', (array_agg(sa.salary_structure_id order by sa.priority))[1], count(*), 0, count(*) filter (where true)
        from public.salary_structure_assignments sa join public.salary_structures s on s.id=sa.salary_structure_id and s.status='active'
        where sa.company_id=v_emp.company_id and sa.is_active and sa.scope_type='company'
          and sa.effective_from<=p_as_of and (sa.effective_to is null or sa.effective_to>=p_as_of)
      ) t
      where t.cnt >= 1
      order by t.ord
    loop
      if v_tier.cnt > 1 then
        v_ambig := true; v_note := format('Multiple applicable salary structures found (%s scope).', v_tier.scope); v_struct := null;
      else
        v_struct := v_tier.ss; v_src := v_src || '+assign_' || v_tier.scope;
      end if;
      exit;   -- first tier with a match decides
    end loop;

    if v_struct is null and not v_ambig then
      select count(*), (array_agg(sl.salary_structure_id))[1] into v_cnt, v_struct
      from public.salary_slab_rules sl join public.salary_structures s on s.id = sl.salary_structure_id and s.status = 'active'
      where sl.company_id = v_emp.company_id and sl.is_active
        and v_gross >= sl.min_gross and (sl.max_gross is null or v_gross <= sl.max_gross);
      if v_cnt > 1 then v_ambig := true; v_note := 'Multiple applicable salary slabs found.'; v_struct := null;
      elsif v_cnt = 1 then v_src := v_src || '+slab'; end if;
    end if;
  end if;

  gross_salary := v_gross;
  salary_structure_id := v_struct;
  structure_name := (select name from public.salary_structures where id = v_struct);
  source := nullif(v_src, '');
  ambiguous := v_ambig;
  resolve_note := nullif(v_note, '');
  return next;
end;
$function$;

grant execute on function public.salary_resolve_for_employee(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- F. payroll_resolve_policy_for_employee — scope fields resolved as of p_as_of.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_resolve_policy_for_employee(p_company_id uuid, p_employee_id uuid, p_as_of date)
 RETURNS payroll_policies
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
declare
  v_emp record;
  v_tier record;
  v_pol_id uuid;
  v_pol public.payroll_policies;
  v_hist public.employee_assignment_history;
begin
  select e.store_id, e.store_department_id, e.store_designation_id, e.grade_id, e.category_id, e.employment_type::text et
  into v_emp from public.employees e where e.id = p_employee_id;

  -- Employee Transfer (Phase 2 correction): resolve scope fields as of p_as_of
  -- from the authoritative assignment history, same reasoning as
  -- salary_resolve_for_employee. No history -> unaffected (coalesce to live).
  v_hist := public.employee_assignment_as_of(p_employee_id, p_as_of);
  v_emp.store_id := coalesce(v_hist.store_id, v_emp.store_id);
  v_emp.store_department_id := coalesce(v_hist.store_department_id, v_emp.store_department_id);
  v_emp.store_designation_id := coalesce(v_hist.store_designation_id, v_emp.store_designation_id);
  v_emp.grade_id := coalesce(v_hist.grade_id, v_emp.grade_id);
  v_emp.category_id := coalesce(v_hist.category_id, v_emp.category_id);
  v_emp.et := coalesce(v_hist.employment_type, v_emp.et);

  for v_tier in
    select ord, scope, pid, cnt from (
      select 1 ord, 'employee' scope, (array_agg(a.payroll_policy_id order by a.priority))[1] pid, count(*) cnt
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='employee' and a.employee_id=p_employee_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 2, 'grade', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='grade' and a.grade_id=v_emp.grade_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 3, 'category', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='category' and a.category_id=v_emp.category_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 4, 'store_designation', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='store_designation' and a.store_designation_id=v_emp.store_designation_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 5, 'store_department', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='store_department' and a.store_department_id=v_emp.store_department_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 6, 'location', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type in ('location','store') and a.store_id=v_emp.store_id
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 7, 'employment_type', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='employment_type' and a.employment_type=v_emp.et
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      union all
      select 8, 'company', (array_agg(a.payroll_policy_id order by a.priority))[1], count(*)
      from public.payroll_policy_assignments a where a.company_id=p_company_id and a.is_active and a.scope_type='company'
        and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
    ) t
    where t.cnt >= 1
    order by t.ord
  loop
    if v_tier.cnt = 1 then v_pol_id := v_tier.pid; end if;
    exit;
  end loop;

  if v_pol_id is not null then
    -- resolve the effective-dated ACTIVE version of the assigned policy's code chain
    select * into v_pol from public.payroll_policies base
    where base.id = v_pol_id;
    if v_pol.id is not null then
      select * into v_pol from public.payroll_policies q
      where q.company_id = p_company_id and q.code = v_pol.code and q.status = 'active'
        and q.effective_from <= p_as_of and (q.effective_to is null or q.effective_to >= p_as_of)
      order by q.effective_from desc limit 1;
      if v_pol.id is not null then return v_pol; end if;
      select * into v_pol from public.payroll_policies where id = v_pol_id; return v_pol;
    end if;
  end if;

  -- fall back to the company-wide resolver (unchanged Phase 6 path)
  return public.payroll_resolve_policy(p_company_id, p_as_of);
end;
$function$;

grant execute on function public.payroll_resolve_policy_for_employee(uuid, uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- G. attendance_admin_upsert — attribute the record to the store effective ON
--    p_attendance_date (past date, never future) from assignment history.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_admin_upsert(p_employee_id uuid, p_attendance_date date, p_status text, p_punch_in_time time without time zone DEFAULT NULL::time without time zone, p_punch_out_time time without time zone DEFAULT NULL::time without time zone, p_remark text DEFAULT NULL::text, p_use_information boolean DEFAULT false)
 RETURNS attendance_records
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_employee record;
  v_shift public.attendance_shifts%rowtype;
  v_assignment record;
  v_existing public.attendance_records%rowtype;
  v_punch_in_at timestamptz;
  v_punch_out_at timestamptz;
  v_facts record;
  v_day_type_override text;
  v_final_status text;
  v_shift_end_at timestamptz;
  v_note text;
  v_prev_status text;
  v_punch_in_note text := '';
  v_punch_out_note text := '';
  v_remark_note text := '';
  v_valid_statuses text[] := array['present','absent','half_day','leave','weekly_off','holiday','work_from_home','on_duty'];
  v_is_overnight boolean := false;
  v_preserved_use_information boolean := false;
  v_hist public.employee_assignment_history;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admin can create or edit attendance for another employee.'
      using errcode = '42501';
  end if;

  if p_attendance_date > current_date then
    raise exception 'Cannot create or edit attendance for a future date (%). Only dates up to today are allowed.', p_attendance_date
      using errcode = '22007';
  end if;

  if p_status is null or not (p_status = any(v_valid_statuses)) then
    raise exception 'Invalid attendance status: %', coalesce(p_status, '<null>');
  end if;

  if p_punch_in_time is not null and p_punch_out_time is not null and p_punch_out_time = p_punch_in_time then
    raise exception 'Punch Out must be after Punch In.';
  end if;

  select id, company_id, store_id into v_employee
  from public.employees
  where id = p_employee_id
  limit 1;

  if not found then
    raise exception 'Selected employee was not found.';
  end if;

  -- Employee Transfer (Phase 2 correction): attribute this attendance record to
  -- the store effective ON p_attendance_date (a past date can predate a later
  -- transfer's effective date), from the authoritative assignment history —
  -- never dependent on employees.store_id having been synced yet. No history
  -- for this employee -> unaffected (falls back to the live column).
  v_hist := public.employee_assignment_as_of(v_employee.id, p_attendance_date);
  if v_hist.store_id is not null then
    v_employee.store_id := v_hist.store_id;
  end if;

  select * into v_assignment
  from public.employee_shift_assignments
  where employee_id = v_employee.id
    and is_active
    and effective_from <= p_attendance_date
    and (effective_to is null or effective_to >= p_attendance_date)
  order by effective_from desc
  limit 1;

  if found then
    select * into v_shift from public.attendance_shifts where id = v_assignment.shift_id and is_active;
  end if;

  if v_shift.id is null then
    select * into v_shift
    from public.attendance_shifts
    where company_id = v_employee.company_id
      and is_active
    order by name
    limit 1;
  end if;

  if v_shift.id is null then
    raise exception 'No active shift is assigned to this employee for %.', p_attendance_date;
  end if;

  if p_punch_in_time is not null then
    v_punch_in_at := (p_attendance_date + p_punch_in_time) at time zone 'Asia/Kolkata';
  end if;
  if p_punch_out_time is not null then
    v_is_overnight := p_punch_in_time is not null and p_punch_out_time < p_punch_in_time;
    if v_is_overnight then
      v_punch_out_at := (p_attendance_date + 1 + p_punch_out_time) at time zone 'Asia/Kolkata';
    else
      v_punch_out_at := (p_attendance_date + p_punch_out_time) at time zone 'Asia/Kolkata';
    end if;
  end if;

  v_day_type_override := case when p_status in ('leave', 'holiday') then p_status else null end;

  -- Fetch the EXISTING record first (before recomputing facts) purely to read its own
  -- used_information choice -- an ordinary edit made from the Manual Staff Attendance screen (which
  -- has no Information checkbox) must PRESERVE whatever the Staff originally chose at Punch In, only
  -- re-validated against the (possibly edited) punch time -- never silently grant or revoke it. A
  -- brand-new admin-created record (no prior row) has no prior choice to preserve, so it defaults to
  -- not used. p_use_information itself is no longer read here (kept in the signature only for
  -- interface stability).
  select * into v_existing
  from public.attendance_records
  where employee_id = v_employee.id
    and attendance_date = p_attendance_date
  limit 1;

  v_preserved_use_information := coalesce(v_existing.used_information, false);

  select * into v_facts from public.compute_extended_attendance_facts(
    v_employee.company_id, v_employee.id, v_shift.id, v_employee.store_id, p_attendance_date,
    v_punch_in_at, v_punch_out_at, v_preserved_use_information, v_day_type_override
  );

  v_final_status := p_status;

  v_prev_status := coalesce(v_existing.status::text, 'none (new record)');
  if v_punch_in_at is not null then
    v_punch_in_note := ' Punch In ' || to_char(v_punch_in_at at time zone 'Asia/Kolkata', 'HH12:MI AM');
  end if;
  if v_punch_out_at is not null then
    v_punch_out_note := ', Punch Out ' || to_char(v_punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
      || (case when v_is_overnight then ' (next day)' else '' end);
  end if;
  if p_remark is not null and length(trim(p_remark)) > 0 then
    v_remark_note := ' Reason: ' || p_remark;
  end if;

  v_note := 'Super Admin ' || (case when v_existing.id is null then 'created' else 'edited' end)
    || ' attendance for ' || to_char(p_attendance_date, 'DD Mon YYYY')
    || ': ' || v_prev_status || ' -> ' || v_final_status || '.'
    || v_punch_in_note || v_punch_out_note || v_remark_note;

  if v_existing.id is not null then
    update public.attendance_records
    set status = v_final_status::public.attendance_status,
        shift_id = v_shift.id,
        punch_in_at = v_punch_in_at,
        punch_out_at = v_punch_out_at,
        total_working_minutes = v_facts.o_total_working_minutes,
        break_deduction_minutes = v_facts.o_break_deduction_minutes,
        working_minutes = v_facts.o_working_minutes,
        late_minutes = v_facts.o_late_minutes,
        late_rule_id = v_facts.o_late_rule_id,
        used_information = v_facts.o_used_information,
        information_rule_id = v_facts.o_information_rule_id,
        half_day_reason = v_facts.o_half_day_reason,
        half_day_rule_id = v_facts.o_half_day_rule_id,
        penalty_minutes = v_facts.o_penalty_minutes,
        penalty_rule_id = v_facts.o_penalty_rule_id,
        early_going_minutes = v_facts.o_early_going_minutes,
        early_going_rule_id = v_facts.o_early_going_rule_id,
        overtime_minutes = v_facts.o_overtime_minutes,
        overtime_rule_id = v_facts.o_overtime_rule_id,
        extra_duty_value = v_facts.o_extra_duty_value,
        night_ot_minutes = v_facts.o_night_ot_minutes,
        extended_duty_rule_id = v_facts.o_extended_duty_rule_id,
        source = 'admin',
        remarks = coalesce(p_remark, remarks),
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_existing;
  else
    insert into public.attendance_records (
      company_id, employee_id, store_id, attendance_date, shift_id,
      punch_in_at, punch_out_at, total_working_minutes, break_deduction_minutes, working_minutes, late_minutes, late_rule_id,
      used_information, information_rule_id, half_day_reason, half_day_rule_id,
      penalty_minutes, penalty_rule_id, early_going_minutes, early_going_rule_id,
      overtime_minutes, overtime_rule_id, extra_duty_value, night_ot_minutes, extended_duty_rule_id,
      status, source, remarks, created_by, updated_by
    ) values (
      v_employee.company_id, v_employee.id, v_employee.store_id, p_attendance_date, v_shift.id,
      v_punch_in_at, v_punch_out_at, v_facts.o_total_working_minutes, v_facts.o_break_deduction_minutes, v_facts.o_working_minutes, v_facts.o_late_minutes, v_facts.o_late_rule_id,
      v_facts.o_used_information, v_facts.o_information_rule_id, v_facts.o_half_day_reason, v_facts.o_half_day_rule_id,
      v_facts.o_penalty_minutes, v_facts.o_penalty_rule_id, v_facts.o_early_going_minutes, v_facts.o_early_going_rule_id,
      v_facts.o_overtime_minutes, v_facts.o_overtime_rule_id, v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_facts.o_extended_duty_rule_id,
      v_final_status::public.attendance_status, 'admin', p_remark, auth.uid(), auth.uid()
    ) returning * into v_existing;
  end if;

  if v_existing.night_duty_approval_id is not null then
    if exists (
      select 1 from public.attendance_night_duty_approvals
      where id = v_existing.night_duty_approval_id
        and approval_status in ('approved', 'om_approved', 'super_manager_approved')
    ) then
      update public.attendance_records
      set payable_working_minutes = working_minutes,
          payable_overtime_minutes = case
            when public.night_duty_normal_ot_suppressed(extended_duty_rule_id, extra_duty_value)
            then coalesce(night_ot_minutes, 0)
            else coalesce(overtime_minutes, 0) + coalesce(night_ot_minutes, 0)
          end,
          payable_extra_duty_value = extra_duty_value,
          updated_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id
      returning * into v_existing;
    end if;
  end if;

  if v_punch_out_at is not null then
    v_shift_end_at := (p_attendance_date + v_shift.end_time) at time zone 'Asia/Kolkata';
    perform public.ensure_night_duty_approval(
      v_employee.company_id, v_employee.id, v_existing.id, p_attendance_date, v_shift_end_at, v_punch_out_at,
      v_facts.o_extra_duty_value, v_facts.o_night_ot_minutes, v_employee.store_id
    );
  end if;

  insert into public.attendance_audit_logs (company_id, employee_id, attendance_record_id, action, source, performed_by, notes)
  values (v_employee.company_id, v_employee.id, v_existing.id, 'admin_correction', 'admin', auth.uid(), v_note);

  return v_existing;
end;
$function$;

grant execute on function public.attendance_admin_upsert(uuid, date, text, time, time, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- H. payroll_calculate_run — best-effort housekeeping sweep of due transfers
--    at the start of every run (request-time, not a cron), plus (unchanged
--    from 0149/0151) the transfer-aware assignment-history snapshot resolution.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_calculate_run(p_payroll_run_id uuid)
 RETURNS payroll_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_run public.payroll_runs;
  v_period public.payroll_periods;
  v_pol public.payroll_policies;
  v_emp record;
  v_sal record;
  v_comp record;
  v_rec record;
  v_bif record;
  v_adv_period_id uuid;
  v_result_id uuid;
  v_basic numeric; v_da numeric;
  v_present_full numeric; v_half numeric; v_woff numeric; v_holi numeric; v_absent numeric; v_att_leave numeric;
  v_ot_min numeric; v_nd_val numeric;
  v_paid_leave numeric; v_lwp_days numeric; v_unassigned int;
  v_calendar int; v_working numeric; v_present numeric; v_paid_days numeric; v_unpaid_days numeric;
  v_gross numeric; v_ded numeric; v_advrec numeric; v_net numeric; v_empc numeric;
  v_qty numeric; v_rate numeric; v_amt numeric;
  v_review boolean; v_notes text; v_hasneg boolean;
  v_res_gross numeric; v_struct_id uuid; v_ambig boolean; v_resolve_note text; v_src text; v_ltype text; v_advrec_extra numeric;
  v_join date; v_leave date; v_exit_pay boolean; v_pol_j jsonb; v_gross_pre numeric;
  v_cal public.store_payroll_calendars; v_cal_wd numeric;
  v_elig_start date; v_elig_end date; v_eligible_days numeric; v_ss_scope text;
  v_manual_comp jsonb;
  v_assign public.employee_assignment_history;
  v_r_gross numeric := 0; v_r_ded numeric := 0; v_r_adv numeric := 0; v_r_net numeric := 0; v_cnt int := 0;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not public.payroll_can_manage(v_run.company_id) then
    raise exception 'You are not authorised to run payroll for this company.' using errcode = '42501';
  end if;
  if v_run.status not in ('draft', 'processing', 'calculated') then
    raise exception 'Payroll run is % - a finalized/locked/reversed run cannot be recalculated.', v_run.status;
  end if;
  if not v_run.is_current then raise exception 'This is not the current run for its period.'; end if;

  -- Employee Transfer (Phase 2 correction): housekeeping sweep of any
  -- approved transfers whose effective_date has now arrived, so the legacy
  -- employees.* live columns stay reasonably fresh for screens that still
  -- read them directly. This is a best-effort CACHE REFRESH ONLY — it is
  -- NOT what payroll relies on for correctness (salary_resolve_for_employee
  -- and payroll_resolve_policy_for_employee resolve scope directly from
  -- employee_assignment_history as of the payroll date, independent of
  -- whether this sweep has ever run). Never invented as a cron: this fires
  -- on the natural business cadence of "someone is running payroll", and a
  -- failure here must never abort the actual payroll calculation.
  begin
    perform public.transfer_apply_due_effective(v_run.company_id);
  exception when others then
    null;
  end;

  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id;
  v_calendar := (v_period.period_end_date - v_period.period_start_date + 1);

  update public.payroll_runs set status = 'processing', started_at = coalesce(started_at, now()), processed_by = auth.uid() where id = v_run.id;
  delete from public.payroll_lines where payroll_run_id = v_run.id;
  delete from public.payroll_employee_results where payroll_run_id = v_run.id;

  select id into v_adv_period_id from public.advance_payroll_periods
  where company_id = v_run.company_id and period_month = v_period.period_month;
  if v_adv_period_id is null then
    insert into public.advance_payroll_periods (company_id, period_month, label, status, payroll_run_id, created_by, updated_by)
    values (v_run.company_id, v_period.period_month, coalesce(v_period.label, to_char(v_period.period_month, 'Mon YYYY')), 'draft', v_run.id, auth.uid(), auth.uid())
    returning id into v_adv_period_id;
  else
    update public.advance_payroll_periods set payroll_run_id = v_run.id, updated_by = auth.uid()
    where id = v_adv_period_id and status = 'draft';
  end if;

  for v_emp in
    select e.id, e.full_name, e.employee_code, e.store_id, e.store_department_id, e.store_designation_id,
           e.joining_date, e.leaving_date
    from public.employees e
    where e.company_id = v_run.company_id
      and (e.status in ('active', 'on_leave', 'notice_period')
           or (e.status in ('resigned', 'terminated', 'transferred') and e.leaving_date is not null and e.leaving_date >= v_period.period_start_date))
      and (e.joining_date is null or e.joining_date <= v_period.period_end_date)
      and (e.leaving_date is null or e.leaving_date >= v_period.period_start_date)
    order by e.full_name
  loop
    v_review := false; v_notes := ''; v_basic := 0; v_da := 0; v_empc := 0; v_advrec := 0; v_gross := 0; v_ded := 0;
    v_join := v_emp.joining_date; v_leave := v_emp.leaving_date;

    -- Employee Transfer (Phase 2): resolve the assignment EFFECTIVE for this payroll period
    -- (as of period end) from the additive history ledger. No history row for this employee
    -- (never transferred) -> v_assign is all-null -> every coalesce below falls back to the
    -- employee's live columns, so a company that never uses Transfer is byte-for-byte unchanged.
    v_assign := public.employee_assignment_as_of(v_emp.id, v_period.period_end_date);

    -- per-employee scoped Payroll Policy (falls back to the company-wide active policy)
    select * into v_pol from public.payroll_resolve_policy_for_employee(v_run.company_id, v_emp.id, v_period.period_end_date);
    v_exit_pay := v_pol.exit_date_payable;

    -- per-employee manual / imported PF/ESI amounts for THIS period (calc_method = 'manual')
    select coalesce(jsonb_object_agg(upper(pca.component_code),
             jsonb_build_object('employee_amount', pca.employee_amount, 'employer_amount', pca.employer_amount, 'source', pca.source)), '{}'::jsonb)
      into v_manual_comp
    from public.payroll_component_amounts pca
    where pca.payroll_period_id = v_period.id and pca.employee_id = v_emp.id;

    select sc.basic_salary, sc.da, sc.effective_from into v_sal
    from public.employee_salary_components sc
    where sc.employee_id = v_emp.id
      and sc.effective_from <= v_period.period_end_date
      and (sc.effective_to is null or sc.effective_to >= v_period.period_start_date)
    order by sc.effective_from desc limit 1;

    select
      coalesce(count(*) filter (where ar.status in ('present', 'work_from_home', 'on_duty')), 0),
      coalesce(count(*) filter (where ar.status = 'half_day'), 0) * 0.5,
      coalesce(count(*) filter (where ar.status = 'weekly_off'), 0),
      coalesce(count(*) filter (where ar.status = 'holiday'), 0),
      coalesce(count(*) filter (where ar.status = 'absent'), 0),
      coalesce(count(*) filter (where ar.status = 'leave'), 0),
      coalesce(sum(ar.payable_overtime_minutes), 0),
      coalesce(sum(ar.payable_extra_duty_value), 0)
    into v_present_full, v_half, v_woff, v_holi, v_absent, v_att_leave, v_ot_min, v_nd_val
    from public.attendance_records ar
    where ar.employee_id = v_emp.id and ar.attendance_date between v_period.period_start_date and v_period.period_end_date;

    select
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'paid'), 0),
      coalesce(sum(lae.paid_units) filter (where lae.paid_status = 'unpaid'), 0),
      coalesce(count(*) filter (where lae.paid_status is null or lae.paid_status = 'unassigned'), 0)
    into v_paid_leave, v_lwp_days, v_unassigned
    from public.leave_attendance_effects lae
    where lae.employee_id = v_emp.id
      and lae.attendance_date between v_period.period_start_date and v_period.period_end_date
      and lae.reversed_at is null;
    if v_unassigned > 0 then
      v_review := true;
      v_notes := v_notes || format('%s approved leave day(s) not yet allocated as Paid Leave / LWP. ', v_unassigned);
    end if;

    v_present := coalesce(v_present_full, 0) + coalesce(v_half, 0);
    v_working := greatest(v_calendar - coalesce(v_woff, 0) - coalesce(v_holi, 0), 0);
    v_paid_days := v_present + coalesce(v_paid_leave, 0) + coalesce(v_woff, 0) + coalesce(v_holi, 0);
    v_unpaid_days := coalesce(v_lwp_days, 0) + coalesce(v_absent, 0);

    -- Store Calendar working days (§28) - only when the policy asks for it
    v_cal := null; v_cal_wd := null;
    if v_pol.working_days_method = 'store_calendar' then
      v_cal := public.payroll_resolve_store_calendar(v_run.company_id, coalesce(v_assign.store_id, v_emp.store_id), v_period.period_end_date);
      if v_cal.id is not null then
        v_cal_wd := public.payroll_calendar_working_days(v_cal.id, v_period.period_start_date, v_period.period_end_date);
        if v_cal_wd is not null then v_working := v_cal_wd; end if;
      else
        v_review := true; v_notes := v_notes || 'Store calendar working-days method selected but no active calendar resolves. ';
      end if;
    end if;

    -- Eligible days (joining / leaving inside the period)
    v_elig_start := greatest(v_period.period_start_date, coalesce(v_join, v_period.period_start_date));
    v_elig_end := case
      when v_leave is null then v_period.period_end_date
      when v_exit_pay is true then least(v_leave, v_period.period_end_date)
      when v_exit_pay is false then least(v_leave - 1, v_period.period_end_date)
      else v_period.period_end_date end;
    v_eligible_days := greatest((v_elig_end - v_elig_start) + 1, 0);

    insert into public.payroll_employee_results (
      company_id, payroll_run_id, payroll_period_id, employee_id,
      employee_code_snapshot, employee_name_snapshot, department_snapshot, designation_snapshot, store_snapshot,
      salary_effective_from, basic_snapshot, da_snapshot,
      calendar_days, working_days, present_days, paid_leave_days, lwp_days, weekly_off_days, holiday_days, absent_days, paid_days, unpaid_days,
      payroll_policy_id, store_calendar_id, store_calendar_snapshot, leaving_date_snapshot, eligible_days, status
    ) values (
      v_run.company_id, v_run.id, v_period.id, v_emp.id,
      v_emp.employee_code, v_emp.full_name,
      (select sd.name from public.store_departments sd where sd.id = coalesce(v_assign.store_department_id, v_emp.store_department_id)),
      (select sg.title from public.store_designations sg where sg.id = coalesce(v_assign.store_designation_id, v_emp.store_designation_id)),
      (select s.name from public.stores s where s.id = coalesce(v_assign.store_id, v_emp.store_id)),
      v_sal.effective_from, coalesce(v_sal.basic_salary, 0), coalesce(v_sal.da, 0),
      v_calendar, v_working, v_present, coalesce(v_paid_leave, 0), coalesce(v_lwp_days, 0), coalesce(v_woff, 0), coalesce(v_holi, 0), coalesce(v_absent, 0), v_paid_days, v_unpaid_days,
      v_pol.id, v_cal.id,
      case when v_cal.id is not null then jsonb_build_object('calendar_id', v_cal.id, 'name', v_cal.name, 'effective_from', v_cal.effective_from, 'effective_to', v_cal.effective_to,
        'weekly_off_days', to_jsonb(v_cal.weekly_off_days), 'alternate_saturday_off', v_cal.alternate_saturday_off, 'holiday_source', v_cal.holiday_source, 'working_days', v_cal_wd) else null end,
      v_leave, v_eligible_days, 'calculated'
    ) returning id into v_result_id;

    -- ================= PHASE 5A: dynamic salary structure path =================
    select r.gross_salary, r.salary_structure_id, r.ambiguous, r.resolve_note, r.source
      into v_res_gross, v_struct_id, v_ambig, v_resolve_note, v_src
    from public.salary_resolve_for_employee(v_emp.id, v_period.period_end_date) r;
    v_ss_scope := (regexp_match(coalesce(v_src, ''), 'assign_([a-z_]+)'))[1];

    if v_ambig then
      update public.payroll_employee_results
      set needs_review = true, review_notes = coalesce(v_resolve_note, 'Ambiguous salary structure - resolve the assignment.'),
          gross_earnings = 0, total_deductions = 0, net_salary = 0, salary_structure_scope = v_ss_scope
      where id = v_result_id;
      v_cnt := v_cnt + 1;
      continue;
    end if;

    if v_struct_id is not null then
      begin
        for v_bif in select * from public.salary_bifurcate(v_struct_id, v_res_gross) loop
          if v_bif.calculation_type = 'advance_recovery' then
            if exists (select 1 from public.advance_recovery_transactions x
                       where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
              select coalesce(sum(x.amount), 0) into v_advrec
              from public.advance_recovery_transactions x
              where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
                and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
            else
              v_advrec := 0;
              for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
                v_advrec := v_advrec + coalesce(v_rec.deducted_amount, 0);
              end loop;
            end if;
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, amount, source, calc_type, calculation_ref, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, 'deduction', v_bif.code, v_bif.name, round(v_advrec, 2), 'advance_recovery', 'advance_recovery',
                    'advance_payroll_period:' || v_adv_period_id::text, v_bif.display_order);
            v_ded := v_ded + round(v_advrec, 2);
          else
            v_ltype := case v_bif.category when 'earning' then 'earning' when 'employer_contribution' then 'employer_contribution' else 'deduction' end;
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, quantity, rate, amount, source, calc_type, calc_base, calc_formula, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_ltype, v_bif.code, v_bif.name, null, v_bif.calc_rate, v_bif.amount, v_bif.category, v_bif.calculation_type, v_bif.calc_base, v_bif.calc_formula, v_bif.display_order);
            if v_ltype = 'earning' then v_gross := v_gross + v_bif.amount;
            elsif v_ltype = 'employer_contribution' then v_empc := v_empc + v_bif.amount;
            else v_ded := v_ded + v_bif.amount; end if;
            if v_bif.is_basic then v_basic := v_bif.amount; end if;
            if v_bif.code = 'DA' then v_da := v_bif.amount; end if;
          end if;
        end loop;

        if not exists (select 1 from public.payroll_lines where payroll_employee_result_id = v_result_id and calc_type = 'advance_recovery') then
          if exists (select 1 from public.advance_recovery_transactions x
                     where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
            select coalesce(sum(x.amount), 0) into v_advrec_extra
            from public.advance_recovery_transactions x
            where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
              and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
          else
            v_advrec_extra := 0;
            for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
              v_advrec_extra := v_advrec_extra + coalesce(v_rec.deducted_amount, 0);
            end loop;
          end if;
          if coalesce(v_advrec_extra, 0) > 0 or exists (select 1 from public.advance_recovery_plans p where p.employee_id = v_emp.id and p.status in ('recovering', 'recovery_pending')) then
            insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, line_type, code, name, amount, source, calc_type, calculation_ref, sort_order)
            values (v_run.company_id, v_run.id, v_result_id, v_emp.id, 'deduction', 'ADVREC', 'Advance Recovery', round(coalesce(v_advrec_extra, 0), 2), 'advance_recovery', 'advance_recovery',
                    'advance_payroll_period:' || v_adv_period_id::text, 95);
            v_ded := v_ded + round(coalesce(v_advrec_extra, 0), 2);
            v_advrec := coalesce(v_advrec_extra, 0);
          end if;
        end if;
      exception when others then
        delete from public.payroll_lines where payroll_employee_result_id = v_result_id;
        v_gross := 0; v_ded := 0; v_empc := 0; v_advrec := 0;
        v_review := true; v_notes := v_notes || 'Salary structure calculation failed: ' || sqlerrm || '. ';
      end;

      -- Overtime is NEVER emitted by the flat component master here — it is a system-calculated
      -- line owned solely by payroll_policy_compute_lines, sourced from the Attendance OT Rule
      -- Engine (payable_overtime_minutes). Night Duty stays as-is when its policy toggle is off.
      for v_comp in
        select * from public.payroll_salary_components
        where company_id = v_run.company_id and is_active and component_type = 'earning' and source = 'night_duty'
          and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
          and not v_pol.nd_earning_enabled
        order by sort_order, code
      loop
        v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate; v_amt := 0;
        if v_rate is null then
          if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
        insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
        values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, 'attendance_input', v_comp.sort_order);
        v_gross := v_gross + v_amt;
      end loop;

      v_gross_pre := v_gross;
      v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                  v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), v_struct_id,
                  v_leave, v_exit_pay, v_manual_comp);
      v_gross := (v_pol_j ->> 'gross')::numeric;
      v_ded := (v_pol_j ->> 'total_deductions')::numeric;
      v_net := (v_pol_j ->> 'net')::numeric;
      v_empc := v_empc + (v_pol_j ->> 'employer_contribution_extra')::numeric;
      if (v_pol_j ->> 'needs_review')::boolean then v_review := true; end if;
      if coalesce(v_pol_j ->> 'review_note', '') <> '' then v_notes := v_notes || (v_pol_j ->> 'review_note') || ' '; end if;
      v_hasneg := v_net < 0;

      update public.payroll_employee_results
      set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2),
          employer_contribution_total = v_empc, net_salary = v_net,
          salary_structure_id = v_struct_id, gross_from_structure = v_res_gross, structure_reconciled = true,
          basic_snapshot = v_basic, da_snapshot = v_da,
          policy_snapshot = v_pol_j -> 'snapshot',
          proration_factor = case when v_gross_pre = 0 then null else round(v_gross / nullif(v_gross_pre, 0), 6) end,
          lwp_deduction_amount = coalesce((v_pol_j ->> 'lwp_amount')::numeric, 0),
          statutory_deduction_total = coalesce((v_pol_j ->> 'statutory_total')::numeric, 0),
          exit_proration_amount = coalesce((v_pol_j ->> 'prorate_exit_amount')::numeric, 0),
          salary_structure_scope = v_ss_scope,
          has_negative_net = v_hasneg, needs_review = v_review, review_notes = nullif(v_notes, '')
      where id = v_result_id;

      v_r_gross := v_r_gross + v_gross; v_r_ded := v_r_ded + v_ded; v_r_adv := v_r_adv + round(v_advrec, 2); v_r_net := v_r_net + v_net; v_cnt := v_cnt + 1;
      continue;
    end if;
    -- ================= LEGACY Basic+DA path =================

    v_basic := coalesce(v_sal.basic_salary, 0);
    v_da := coalesce(v_sal.da, 0);
    if v_sal.effective_from is null then v_review := true; v_notes := v_notes || 'No effective salary structure for this period. '; end if;

    v_gross := 0;
    -- Overtime (source='overtime') is EXCLUDED here: it is a system-calculated line owned solely
    -- by payroll_policy_compute_lines, valued from the Attendance OT Rule's payable_overtime_minutes.
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'earning'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        and source <> 'overtime'
        and not (source = 'night_duty' and v_pol.nd_earning_enabled)
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.source = 'basic' then v_amt := round(v_basic, 2);
      elsif v_comp.source = 'da' then v_amt := round(v_da, 2);
      elsif v_comp.source = 'night_duty' then
        v_qty := coalesce(v_nd_val, 0); v_rate := v_pol.night_duty_day_rate;
        if v_rate is null then v_amt := 0; if v_qty > 0 then v_review := true; v_notes := v_notes || 'Night-duty payroll rate not configured. '; end if;
        else v_amt := round(v_qty * v_rate, 2); end if;
      else v_amt := 0; end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'earning', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, v_comp.calculation_method, v_comp.sort_order);
      v_gross := v_gross + v_amt;
    end loop;

    v_ded := 0; v_advrec := 0;
    for v_comp in
      select * from public.payroll_salary_components
      where company_id = v_run.company_id and is_active and component_type = 'deduction'
        and effective_from <= v_period.period_end_date and (effective_to is null or effective_to >= v_period.period_start_date)
        and not (calculation_method = 'lwp' and v_pol.lwp_enabled)
        and not (source = 'statutory' and exists (
                   select 1 from public.payroll_statutory_rules sr
                   where sr.payroll_policy_id = v_pol.id and sr.enabled and upper(sr.kind) = payroll_salary_components.code))
      order by sort_order, code
    loop
      v_qty := null; v_rate := null; v_amt := 0;
      if v_comp.calculation_method = 'not_configured' then v_amt := 0;
      elsif v_comp.calculation_method = 'lwp' then
        if v_pol.lwp_divisor is not null and coalesce(v_lwp_days, 0) > 0 then
          v_rate := round((case v_pol.lwp_divisor_basis when 'basic' then v_basic when 'gross' then v_gross else v_basic + v_da end) / v_pol.lwp_divisor, 4);
          v_qty := v_lwp_days; v_amt := round(v_rate * v_lwp_days, 2);
        else
          v_amt := 0;
          if coalesce(v_lwp_days, 0) > 0 then v_review := true; v_notes := v_notes || format('%s LWP day(s) - LWP salary divisor not configured. ', v_lwp_days); end if;
        end if;
      elsif v_comp.calculation_method = 'advance_recovery' then
        if exists (select 1 from public.advance_recovery_transactions x
                   where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction') then
          select coalesce(sum(x.amount), 0) into v_advrec
          from public.advance_recovery_transactions x
          where x.payroll_period_id = v_adv_period_id and x.employee_id = v_emp.id and x.txn_type = 'deduction'
            and not exists (select 1 from public.advance_recovery_transactions r where r.txn_type = 'reversal' and r.reverses_transaction_id = x.id);
        else
          v_advrec := 0;
          for v_rec in select * from public.advance_recovery_run_period(v_adv_period_id, v_emp.id) loop
            v_advrec := v_advrec + coalesce(v_rec.deducted_amount, 0);
          end loop;
        end if;
        v_amt := round(v_advrec, 2);
      else v_amt := 0; end if;
      insert into public.payroll_lines (company_id, payroll_run_id, payroll_employee_result_id, employee_id, component_id, line_type, code, name, quantity, rate, amount, source, calc_type, calculation_ref, sort_order)
      values (v_run.company_id, v_run.id, v_result_id, v_emp.id, v_comp.id, 'deduction', v_comp.code, v_comp.name, v_qty, v_rate, v_amt, v_comp.source, v_comp.calculation_method,
              case when v_comp.calculation_method = 'advance_recovery' then 'advance_payroll_period:' || v_adv_period_id::text else null end, v_comp.sort_order);
      v_ded := v_ded + v_amt;
    end loop;

    v_gross_pre := v_gross;
    v_pol_j := public.payroll_apply_policy(v_result_id, v_pol.id, v_period.period_start_date, v_period.period_end_date,
                v_working, v_join, v_basic, v_da, v_gross, coalesce(v_lwp_days, 0), coalesce(v_ot_min, 0), coalesce(v_nd_val, 0), null,
                v_leave, v_exit_pay, v_manual_comp);
    v_gross := (v_pol_j ->> 'gross')::numeric;
    v_ded := (v_pol_j ->> 'total_deductions')::numeric;
    v_net := (v_pol_j ->> 'net')::numeric;
    v_empc := (v_pol_j ->> 'employer_contribution_extra')::numeric;
    if (v_pol_j ->> 'needs_review')::boolean then v_review := true; end if;
    if coalesce(v_pol_j ->> 'review_note', '') <> '' then v_notes := v_notes || (v_pol_j ->> 'review_note') || ' '; end if;
    v_hasneg := v_net < 0;

    update public.payroll_employee_results
    set gross_earnings = v_gross, total_deductions = v_ded, advance_recovery_amount = round(v_advrec, 2), net_salary = v_net,
        employer_contribution_total = coalesce(v_empc, 0),
        policy_snapshot = v_pol_j -> 'snapshot',
        proration_factor = case when v_gross_pre = 0 then null else round(v_gross / nullif(v_gross_pre, 0), 6) end,
        lwp_deduction_amount = coalesce((v_pol_j ->> 'lwp_amount')::numeric, 0),
        statutory_deduction_total = coalesce((v_pol_j ->> 'statutory_total')::numeric, 0),
        exit_proration_amount = coalesce((v_pol_j ->> 'prorate_exit_amount')::numeric, 0),
        salary_structure_scope = v_ss_scope,
        has_negative_net = v_hasneg, needs_review = v_review, review_notes = nullif(v_notes, '')
    where id = v_result_id;

    v_r_gross := v_r_gross + v_gross; v_r_ded := v_r_ded + v_ded; v_r_adv := v_r_adv + round(v_advrec, 2); v_r_net := v_r_net + v_net; v_cnt := v_cnt + 1;
  end loop;

  update public.payroll_runs
  set status = 'calculated', completed_at = now(),
      employee_count = v_cnt, gross_total = v_r_gross, deduction_total = v_r_ded, advance_recovery_total = v_r_adv, net_total = v_r_net
  where id = v_run.id
  returning * into v_run;
  update public.payroll_periods set status = 'calculated', updated_by = auth.uid() where id = v_period.id;
  return v_run;
end;
$function$;

grant execute on function public.payroll_calculate_run(uuid) to authenticated;
