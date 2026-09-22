-- ============================================================================
-- Retail HRMS — Attendance Import → Automatic Attendance Calculation → Payroll
--   The Attendance Import now feeds the EXISTING authoritative attendance
--   engine (compute_extended_attendance_facts + attendance_admin_upsert) rather
--   than a parallel client-side calculation. Imported punches become the source
--   input; the system derives Status / Late / Early Going / Half Day / Working /
--   Break / Overtime / Night-OT from the configured Attendance Rules, exactly
--   like a manual Super-Admin correction. Payroll is NOT touched here — the
--   existing Payroll Run re-consumes the refreshed attendance_records.
-- Migration 0141
--
-- PREREQUISITE (applied standalone, cannot run inside a txn block):
--   alter type public.attendance_source add value if not exists 'import';
--
-- NOTHING new is calculated: shift resolution mirrors attendance_admin_upsert;
-- weekly-off via is_weekly_off_on_date(); holiday via the existing `holidays`
-- master; leave via leave_attendance_effects; every rule-driven number via
-- compute_extended_attendance_facts(read_only). No second attendance engine, no
-- second payroll engine, no hard-coded shift/grace/threshold/OT value.
--
-- Reuses: is_super_admin(), current_user_company_id(), current_user_role(),
-- compute_extended_attendance_facts(), attendance_admin_upsert(),
-- is_weekly_off_on_date(). attendance_records keeps its own audit trigger +
-- attendance_audit_logs entry from attendance_admin_upsert. RLS unchanged.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tolerant date / time parsers for spreadsheet cells. DD/MM/YYYY (the required
-- format), ISO dates/datetimes, and Excel time cells. Invalid -> NULL (the
-- caller raises a row-level validation error).
-- ----------------------------------------------------------------------------
create or replace function public._attendance_import_parse_date(p_text text)
returns date
language plpgsql
immutable
as $$
declare m text[]; p text;
begin
  if p_text is null then return null; end if;
  p := btrim(p_text);
  if p = '' then return null; end if;

  m := regexp_match(p, '^(\d{4})-(\d{2})-(\d{2})');           -- ISO date / datetime
  if m is not null then return make_date(m[1]::int, m[2]::int, m[3]::int); end if;

  m := regexp_match(p, '^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})');  -- DD/MM/YYYY (+ - .)
  if m is not null and m[2]::int between 1 and 12 and m[1]::int between 1 and 31 then
    return make_date(m[3]::int, m[2]::int, m[1]::int);
  end if;

  return null;
exception when others then return null;
end;
$$;

create or replace function public._attendance_import_parse_time(p_text text)
returns time
language plpgsql
immutable
as $$
declare m text[]; p text; h int; mi int; s int; ap text;
begin
  if p_text is null then return null; end if;
  p := btrim(p_text);
  if p = '' then return null; end if;
  p := regexp_replace(p, '^\d{4}-\d{2}-\d{2}[T ]', '');       -- strip an Excel time-cell date prefix

  m := regexp_match(p, '^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$');  -- 12h + AM/PM
  if m is not null then
    h := m[1]::int; mi := m[2]::int; s := coalesce(m[3]::int, 0); ap := lower(m[4]);
    if h < 1 or h > 12 or mi > 59 or s > 59 then return null; end if;
    if ap = 'am' then h := case when h = 12 then 0 else h end;
    else h := case when h = 12 then 12 else h + 12 end; end if;
    return make_time(h, mi, s);
  end if;

  m := regexp_match(p, '^(\d{1,2}):(\d{2})(?::(\d{2}))?$');    -- 24h
  if m is not null then
    h := m[1]::int; mi := m[2]::int; s := coalesce(m[3]::int, 0);
    if h > 23 or mi > 59 or s > 59 then return null; end if;
    return make_time(h, mi, s);
  end if;

  return null;
exception when others then return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- attendance_import_preview() — resolve + validate + calculate every row using
-- the existing engine, WITHOUT writing anything. Returns exactly what commit
-- will do. p_rows: jsonb array of
--   { row_number, staff_id, staff_name, date_raw, punch_in_raw, punch_out_raw }
-- ----------------------------------------------------------------------------
create or replace function public.attendance_import_preview(p_company_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  r record;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_staff_id text; v_staff_name text;
  v_date date; v_pin time; v_pout time;
  v_pin_at timestamptz; v_pout_at timestamptz;
  v_errors jsonb; v_warnings jsonb;
  v_emp_id uuid; v_emp_company uuid; v_emp_store uuid; v_emp_name text; v_emp_code text;
  v_shift_id uuid; v_shift_name text;
  v_facts record;
  v_has_pair boolean; v_is_woff boolean; v_is_holiday boolean; v_is_leave boolean;
  v_status text; v_day_override text; v_existing_id uuid; v_pr_status text;
  v_late int; v_early int; v_tw int; v_bd int; v_wm int; v_ot int; v_not int; v_edv numeric; v_hdr text;
  v_state text; v_key text;
begin
  if not (public.is_super_admin() or (public.current_user_role() <> 'staff' and p_company_id = public.current_user_company_id())) then
    raise exception 'You are not authorised to import attendance for this company.' using errcode = '42501';
  end if;

  for r in select value as row, ordinality as ord from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality loop
    v_errors := '[]'::jsonb; v_warnings := '[]'::jsonb;
    v_emp_id := null; v_emp_company := null; v_emp_store := null; v_emp_name := null; v_emp_code := null;
    v_shift_id := null; v_shift_name := null; v_status := null; v_day_override := null;
    v_pin_at := null; v_pout_at := null;
    v_existing_id := null; v_pr_status := null; v_is_woff := false; v_is_holiday := false; v_is_leave := false;
    v_late := null; v_early := null; v_tw := null; v_bd := null; v_wm := null; v_ot := null; v_not := null; v_edv := null; v_hdr := null;

    v_staff_id := btrim(coalesce(r.row ->> 'staff_id', ''));
    v_staff_name := btrim(coalesce(r.row ->> 'staff_name', ''));
    v_date := public._attendance_import_parse_date(r.row ->> 'date_raw');
    v_pin := public._attendance_import_parse_time(r.row ->> 'punch_in_raw');
    v_pout := public._attendance_import_parse_time(r.row ->> 'punch_out_raw');

    -- employee (Staff ID is the authoritative key; company-scoped)
    if v_staff_id = '' then
      v_errors := v_errors || to_jsonb('Staff ID is required.'::text);
    else
      select e.id, e.company_id, e.store_id, e.full_name, e.employee_code
      into v_emp_id, v_emp_company, v_emp_store, v_emp_name, v_emp_code
      from public.employees e
      where e.company_id = p_company_id and lower(e.employee_code) = lower(v_staff_id) and e.is_active
      limit 1;
      if v_emp_id is null then
        v_errors := v_errors || to_jsonb(format('Employee not found for Staff ID "%s".', v_staff_id));
      elsif v_staff_name <> '' and lower(v_staff_name) <> lower(v_emp_name) then
        v_warnings := v_warnings || to_jsonb(format('Staff Name "%s" does not match employee master ("%s"). Staff ID identity is used.', v_staff_name, v_emp_name));
      end if;
    end if;

    -- date
    if btrim(coalesce(r.row ->> 'date_raw', '')) = '' then
      v_errors := v_errors || to_jsonb('Date is required.'::text);
    elsif v_date is null then
      v_errors := v_errors || to_jsonb('Invalid date — use DD/MM/YYYY.'::text);
    elsif v_date > current_date then
      v_errors := v_errors || to_jsonb('Date is in the future.'::text);
    end if;

    -- time validity
    if btrim(coalesce(r.row ->> 'punch_in_raw', '')) <> '' and v_pin is null then
      v_errors := v_errors || to_jsonb('Invalid Punch In time.'::text);
    end if;
    if btrim(coalesce(r.row ->> 'punch_out_raw', '')) <> '' and v_pout is null then
      v_errors := v_errors || to_jsonb('Invalid Punch Out time.'::text);
    end if;
    v_has_pair := v_pin is not null and v_pout is not null;
    if (v_pin is not null) <> (v_pout is not null) then
      v_warnings := v_warnings || to_jsonb('Only one punch provided — the day is evaluated without a working session (existing attendance rules decide the outcome).'::text);
    end if;

    if jsonb_array_length(v_errors) = 0 and v_emp_id is not null and v_date is not null then
      -- shift resolution — mirrors attendance_admin_upsert exactly
      select s.id, s.name into v_shift_id, v_shift_name
      from public.employee_shift_assignments a
      join public.attendance_shifts s on s.id = a.shift_id and s.is_active
      where a.employee_id = v_emp_id and a.is_active
        and a.effective_from <= v_date and (a.effective_to is null or a.effective_to >= v_date)
      order by a.effective_from desc limit 1;
      if v_shift_id is null then
        select s.id, s.name into v_shift_id, v_shift_name
        from public.attendance_shifts s where s.company_id = p_company_id and s.is_active order by s.name limit 1;
      end if;
      if v_shift_id is null then
        v_errors := v_errors || to_jsonb('No active shift resolves for this employee/date — cannot calculate. Assign a shift or a company default.'::text);
      end if;

      v_is_woff := public.is_weekly_off_on_date(v_emp_id, v_date);
      v_is_holiday := exists (
        select 1 from public.holidays h
        where h.company_id = p_company_id and (h.store_id = v_emp_store or h.store_id is null) and h.holiday_date = v_date);
      v_is_leave := exists (
        select 1 from public.leave_attendance_effects le
        where le.employee_id = v_emp_id and le.attendance_date = v_date and le.reversed_at is null);

      if v_shift_id is not null then
        if v_pin is not null then v_pin_at := (v_date + v_pin) at time zone 'Asia/Kolkata'; end if;
        if v_pout is not null then
          if v_pin is not null and v_pout < v_pin
          then v_pout_at := (v_date + 1 + v_pout) at time zone 'Asia/Kolkata';   -- overnight / cross-midnight
          else v_pout_at := (v_date + v_pout) at time zone 'Asia/Kolkata'; end if;
        end if;

        if v_has_pair then
          v_day_override := null;
        elsif v_is_holiday then
          v_status := 'holiday'; v_day_override := 'holiday';
        elsif v_is_woff then
          v_status := 'weekly_off'; v_day_override := null;
        elsif v_is_leave then
          v_status := 'leave'; v_day_override := 'leave';
        else
          v_status := 'absent'; v_day_override := null;
        end if;

        select * into v_facts from public.compute_extended_attendance_facts(
          p_company_id, v_emp_id, v_shift_id, v_emp_store, v_date, v_pin_at, v_pout_at, false, v_day_override, true);

        if v_has_pair then
          v_status := v_facts.o_status;   -- engine decides Present vs Half Day
        end if;
        v_late := v_facts.o_late_minutes; v_early := v_facts.o_early_going_minutes;
        v_tw := v_facts.o_total_working_minutes; v_bd := v_facts.o_break_deduction_minutes; v_wm := v_facts.o_working_minutes;
        v_ot := v_facts.o_overtime_minutes; v_not := v_facts.o_night_ot_minutes; v_edv := v_facts.o_extra_duty_value;
        v_hdr := v_facts.o_half_day_reason;
      end if;

      select id into v_existing_id from public.attendance_records
      where employee_id = v_emp_id and attendance_date = v_date limit 1;

      select pr.status into v_pr_status
      from public.payroll_runs pr join public.payroll_periods pp on pp.id = pr.payroll_period_id
      where pp.company_id = p_company_id and pp.period_month = date_trunc('month', v_date)::date and pr.is_current
      limit 1;
      if v_pr_status in ('finalized', 'locked') then
        v_errors := v_errors || to_jsonb(format('Payroll for %s is %s. Attendance changes require the existing payroll correction/reversal workflow.', to_char(v_date, 'Mon YYYY'), v_pr_status));
      end if;
    end if;

    -- in-file duplicate
    if v_emp_id is not null and v_date is not null then
      v_key := v_emp_id::text || '|' || v_date::text;
      if v_key = any(v_seen) then
        v_errors := v_errors || to_jsonb('Duplicate row for the same employee and date within this file.'::text);
      else
        v_seen := array_append(v_seen, v_key);
      end if;
    end if;

    if jsonb_array_length(v_errors) > 0 then v_state := 'error';
    elsif v_existing_id is not null then v_state := 'update';
    elsif jsonb_array_length(v_warnings) > 0 then v_state := 'warning';
    else v_state := 'valid'; end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'row_number', coalesce((r.row ->> 'row_number')::int, r.ord::int),
      'staff_id', v_staff_id, 'staff_name', v_staff_name,
      'date', v_date, 'punch_in', v_pin::text, 'punch_out', v_pout::text,
      'employee_id', v_emp_id, 'employee_name', v_emp_name, 'employee_code', v_emp_code, 'store_id', v_emp_store,
      'name_match', (v_emp_id is not null and (v_staff_name = '' or lower(v_staff_name) = lower(v_emp_name))),
      'shift_id', v_shift_id, 'shift_name', v_shift_name,
      'weekly_off', v_is_woff, 'holiday', v_is_holiday, 'leave', v_is_leave,
      'calc_status', v_status,
      'late_minutes', v_late, 'early_going_minutes', v_early,
      'total_working_minutes', v_tw, 'break_deduction_minutes', v_bd, 'working_minutes', v_wm,
      'overtime_minutes', v_ot, 'night_ot_minutes', v_not, 'extra_duty_value', v_edv,
      'half_day_reason', v_hdr,
      'is_update', (v_existing_id is not null),
      'state', v_state, 'errors', v_errors, 'warnings', v_warnings
    ));
  end loop;

  return jsonb_build_object(
    'rows', v_out,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_out),
      'valid', (select count(*) from jsonb_array_elements(v_out) x where x ->> 'state' in ('valid', 'warning', 'update')),
      'new', (select count(*) from jsonb_array_elements(v_out) x where x ->> 'state' in ('valid', 'warning')),
      'updates', (select count(*) from jsonb_array_elements(v_out) x where x ->> 'state' = 'update'),
      'warnings', (select count(*) from jsonb_array_elements(v_out) x where x ->> 'state' = 'warning'),
      'errors', (select count(*) from jsonb_array_elements(v_out) x where x ->> 'state' = 'error')
    )
  );
end;
$$;
grant execute on function public.attendance_import_preview(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- attendance_import_commit() — re-validates authoritatively via the preview
-- function (never trusts client-computed numbers), then writes each row through
-- attendance_admin_upsert() (Super-Admin only). Atomic: if ANY row has an error
-- the whole commit is refused. Payroll is NOT modified — the affected period is
-- simply reported as needing a Payroll Calculate re-run (finalized/locked runs
-- are already rejected at validation).
-- ----------------------------------------------------------------------------
create or replace function public.attendance_import_commit(p_company_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_prev jsonb;
  v_err_count int;
  e jsonb;
  v_rec public.attendance_records;
  v_imported int := 0;
  v_updated int := 0;
  v_periods jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can import attendance.' using errcode = '42501';
  end if;

  v_prev := public.attendance_import_preview(p_company_id, p_rows);

  select count(*) into v_err_count from jsonb_array_elements(v_prev -> 'rows') x where x ->> 'state' = 'error';
  if v_err_count > 0 then
    raise exception 'Import blocked — % row(s) have errors. Fix the file and preview again.', v_err_count;
  end if;

  for e in select value from jsonb_array_elements(v_prev -> 'rows') loop
    if (e ->> 'state') in ('valid', 'warning', 'update') then
      v_rec := public.attendance_admin_upsert(
        (e ->> 'employee_id')::uuid,
        (e ->> 'date')::date,
        e ->> 'calc_status',
        nullif(e ->> 'punch_in', '')::time,
        nullif(e ->> 'punch_out', '')::time,
        'Imported from attendance file',
        false
      );

      update public.attendance_records
      set source = 'import', updated_by = auth.uid(), updated_at = now()
      where id = v_rec.id;

      if (e ->> 'is_update')::boolean then v_updated := v_updated + 1; else v_imported := v_imported + 1; end if;
    end if;
  end loop;

  select coalesce(jsonb_agg(distinct to_char((x ->> 'date')::date, 'Mon YYYY')), '[]'::jsonb)
  into v_periods
  from jsonb_array_elements(v_prev -> 'rows') x
  where (x ->> 'state') in ('valid', 'warning', 'update');

  return jsonb_build_object(
    'imported', v_imported,
    'updated', v_updated,
    'skipped', 0,
    'affected_periods', v_periods,
    'note', 'Attendance records saved. Re-run the Payroll Calculate step for the affected period(s) to refresh salary. Finalized / locked payroll runs are never changed automatically.'
  );
end;
$$;
grant execute on function public.attendance_import_commit(uuid, jsonb) to authenticated;
