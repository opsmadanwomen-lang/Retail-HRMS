-- ============================================================================
-- Retail HRMS — Phase 1 Part 1
-- Migration 0002: Seed the Master Organization Template
--
-- This is the single source of truth copied into every new store.
-- Nothing here is hardcoded in the UI — it is entirely data-driven.
-- ============================================================================

do $$
declare
  v_team_id uuid;
  v_dept_id uuid;
begin
  -- =========================================================================
  -- FRONTEND TEAM
  -- =========================================================================
  insert into public.master_teams (name, category, display_order)
  values ('Frontend Team', 'frontend', 1)
  returning id into v_team_id;

  -- Sales Team
  insert into public.master_departments (master_team_id, name, display_order)
  values (v_team_id, 'Sales Team', 1)
  returning id into v_dept_id;

  insert into public.master_designations (master_department_id, title, display_order) values
    (v_dept_id, 'Sales Manager', 1),
    (v_dept_id, 'Floor Manager', 2),
    (v_dept_id, 'Department Manager', 3),
    (v_dept_id, 'SSE', 4),
    (v_dept_id, 'JSE', 5);

  -- Cash Team
  insert into public.master_departments (master_team_id, name, display_order)
  values (v_team_id, 'Cash Team', 2)
  returning id into v_dept_id;

  insert into public.master_designations (master_department_id, title, display_order) values
    (v_dept_id, 'Head Cashier', 1),
    (v_dept_id, 'Senior Cashier', 2),
    (v_dept_id, 'Cashier Support', 3);

  -- Customer Care Team
  insert into public.master_departments (master_team_id, name, display_order)
  values (v_team_id, 'Customer Care Team', 3)
  returning id into v_dept_id;

  insert into public.master_designations (master_department_id, title, display_order) values
    (v_dept_id, 'Customer Care Manager', 1),
    (v_dept_id, 'Customer Care Support', 2);

  -- Alteration Team
  insert into public.master_departments (master_team_id, name, display_order)
  values (v_team_id, 'Alteration Team', 4)
  returning id into v_dept_id;

  insert into public.master_designations (master_department_id, title, display_order) values
    (v_dept_id, 'Head Tailor', 1),
    (v_dept_id, 'Senior Tailor', 2),
    (v_dept_id, 'Tailor Support', 3);

  -- =========================================================================
  -- BACKEND TEAM
  -- =========================================================================
  insert into public.master_teams (name, category, display_order)
  values ('Backend Team', 'backend', 2)
  returning id into v_team_id;

  -- Operations Team
  insert into public.master_departments (master_team_id, name, display_order)
  values (v_team_id, 'Operations Team', 1)
  returning id into v_dept_id;

  insert into public.master_designations (master_department_id, title, display_order) values
    (v_dept_id, 'Operations Manager', 1),
    (v_dept_id, 'Assistant Operations Manager', 2),
    (v_dept_id, 'Operations Supervisor', 3),
    (v_dept_id, 'Tea Staff', 4);

  -- Inventory Team
  insert into public.master_departments (master_team_id, name, display_order)
  values (v_team_id, 'Inventory Team', 2)
  returning id into v_dept_id;

  insert into public.master_designations (master_department_id, title, display_order) values
    (v_dept_id, 'Inventory Manager', 1),
    (v_dept_id, 'Support Staff', 2);

  -- Security Team
  insert into public.master_departments (master_team_id, name, display_order)
  values (v_team_id, 'Security Team', 3)
  returning id into v_dept_id;

  insert into public.master_designations (master_department_id, title, display_order) values
    (v_dept_id, 'Guard', 1),
    (v_dept_id, 'Gunman', 2);

  -- Housekeeping Team
  insert into public.master_departments (master_team_id, name, display_order)
  values (v_team_id, 'Housekeeping Team', 4)
  returning id into v_dept_id;

  insert into public.master_designations (master_department_id, title, display_order) values
    (v_dept_id, 'Housekeeping', 1),
    (v_dept_id, 'Sweeper', 2);

end $$;
