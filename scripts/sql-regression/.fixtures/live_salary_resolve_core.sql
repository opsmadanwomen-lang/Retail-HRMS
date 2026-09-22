CREATE OR REPLACE FUNCTION public.salary_resolve_core(p_employee_id uuid, p_as_of date, p_gross_override numeric, p_company_id uuid DEFAULT NULL::uuid)
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
  -- "Virtual employee" (Add Employee screen / Salary Structure Test): no employee row exists yet. Only a company and the Gross being
  -- tried are known, so only the company-level slab / company-scope rules can match — the slab lookup below is the SAME code.
  if v_emp.company_id is null and p_employee_id is null and p_company_id is not null and p_gross_override is not null then
    v_emp.company_id := p_company_id;
  end if;
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

  if p_gross_override is not null then
    -- Preview / revision-save path: the Gross being typed is the input. The structure is NOT taken from the
    -- saved assignment (a new revision carries no explicit structure); scope tiers + slab decide, exactly as payroll.
    v_gross := p_gross_override; v_src := 'entered_gross';
  elsif v_asg.id is not null then
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
$function$
