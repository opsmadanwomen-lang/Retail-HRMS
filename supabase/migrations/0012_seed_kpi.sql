-- ============================================================================
-- Retail HRMS — Phase 1 Part 4 (KPI Management Engine)
-- Migration 0012: Seed kpi_categories, performance_rating, default KPIs,
-- and an example Role -> KPI -> Weightage mapping (Floor Manager) matching
-- the worked example in the spec (weightages sum to 100%).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- KPI CATEGORIES
-- ---------------------------------------------------------------------------
insert into public.kpi_categories (name, display_order) values
  ('Sales', 1),
  ('Customer Service', 2),
  ('Operations', 3),
  ('Inventory', 4),
  ('Cash', 5),
  ('Security', 6),
  ('Housekeeping', 7),
  ('Visual Merchandising', 8),
  ('Training', 9),
  ('Compliance', 10),
  ('Safety', 11),
  ('Administration', 12),
  ('Store Management', 13),
  ('Custom', 14);

-- ---------------------------------------------------------------------------
-- PERFORMANCE RATING (configurable score bands)
-- ---------------------------------------------------------------------------
insert into public.performance_rating (code, label, min_score, max_score, color, display_order) values
  ('excellent', 'Excellent', 90, 100, 'emerald', 1),
  ('very_good', 'Very Good', 80, 89.99, 'green', 2),
  ('good', 'Good', 70, 79.99, 'blue', 3),
  ('average', 'Average', 60, 69.99, 'amber', 4),
  ('needs_improvement', 'Needs Improvement', 40, 59.99, 'orange', 5),
  ('poor', 'Poor', 0, 39.99, 'red', 6);

-- ---------------------------------------------------------------------------
-- DEFAULT (SYSTEM) KPIs, ROLE MAPPING, AND WEIGHTAGE EXAMPLE
-- Mirrors the spec's worked example under "KPI WEIGHTAGE":
--   Department Sale 30% / VM Audit 15% / Attendance 10% /
--   Customer Complaint 15% / Stock Accuracy 20% / Training 10% = 100%
-- Mapped onto the Floor Manager default role seeded in 0010.
-- ---------------------------------------------------------------------------
do $$
declare
  cat_sales uuid;
  cat_customer_service uuid;
  cat_inventory uuid;
  cat_vm uuid;
  cat_training uuid;
  cat_administration uuid;

  kpi_department_sale uuid;
  kpi_vm_audit uuid;
  kpi_attendance uuid;
  kpi_customer_complaint uuid;
  kpi_stock_accuracy uuid;
  kpi_training_completion uuid;

  role_floor_manager uuid;
  mapping_id uuid;
begin
  select id into cat_sales from public.kpi_categories where name = 'Sales';
  select id into cat_customer_service from public.kpi_categories where name = 'Customer Service';
  select id into cat_inventory from public.kpi_categories where name = 'Inventory';
  select id into cat_vm from public.kpi_categories where name = 'Visual Merchandising';
  select id into cat_training from public.kpi_categories where name = 'Training';
  select id into cat_administration from public.kpi_categories where name = 'Administration';

  insert into public.kpi_master
    (kpi_code, kpi_name, category_id, description, calculation_type, target_type, measurement_unit, data_source, formula_type, is_system_kpi, display_order)
  values
    ('DEPT_SALE', 'Department Sale', cat_sales, 'Total sales achieved against target for the department.', 'manual', 'monthly', 'amount', 'Manual Entry', 'percentage_based', true, 1)
  returning id into kpi_department_sale;

  insert into public.kpi_master
    (kpi_code, kpi_name, category_id, description, calculation_type, target_type, measurement_unit, data_source, formula_type, is_system_kpi, display_order)
  values
    ('VM_AUDIT', 'VM Audit Score', cat_vm, 'Visual merchandising audit compliance score.', 'manual', 'monthly', 'score', 'Manual Entry', 'range_based', true, 2)
  returning id into kpi_vm_audit;

  insert into public.kpi_master
    (kpi_code, kpi_name, category_id, description, calculation_type, target_type, measurement_unit, data_source, formula_type, is_system_kpi, display_order)
  values
    ('ATTENDANCE', 'Attendance', cat_administration, 'Attendance percentage for the period.', 'automatic', 'monthly', 'percentage', 'Future Attendance Integration', 'percentage_based', true, 3)
  returning id into kpi_attendance;

  insert into public.kpi_master
    (kpi_code, kpi_name, category_id, description, calculation_type, target_type, measurement_unit, data_source, formula_type, is_system_kpi, display_order)
  values
    ('CUST_COMPLAINT', 'Customer Complaint', cat_customer_service, 'Number of unresolved customer complaints (lower is better).', 'manual', 'monthly', 'number', 'Manual Entry', 'less_than_target', true, 4)
  returning id into kpi_customer_complaint;

  insert into public.kpi_master
    (kpi_code, kpi_name, category_id, description, calculation_type, target_type, measurement_unit, data_source, formula_type, is_system_kpi, display_order)
  values
    ('STOCK_ACCURACY', 'Stock Accuracy', cat_inventory, 'Inventory count accuracy against system records.', 'hybrid', 'monthly', 'percentage', 'Future Inventory Integration', 'percentage_based', true, 5)
  returning id into kpi_stock_accuracy;

  insert into public.kpi_master
    (kpi_code, kpi_name, category_id, description, calculation_type, target_type, measurement_unit, data_source, formula_type, is_system_kpi, display_order)
  values
    ('TRAINING_COMPLETION', 'Training Completion', cat_training, 'Percentage of assigned training modules completed.', 'manual', 'quarterly', 'percentage', 'Manual Entry', 'percentage_based', true, 6)
  returning id into kpi_training_completion;

  -- Map all six onto the Floor Manager default role (seeded in 0010) with
  -- the exact weightage split from the spec example.
  select id into role_floor_manager from public.roles where role_code = 'FLOOR_MANAGER' and company_id is null;

  if role_floor_manager is not null then
    insert into public.role_kpi_mapping (role_id, kpi_id) values (role_floor_manager, kpi_department_sale) returning id into mapping_id;
    insert into public.kpi_weightage (role_kpi_mapping_id, weightage) values (mapping_id, 30);

    insert into public.role_kpi_mapping (role_id, kpi_id) values (role_floor_manager, kpi_vm_audit) returning id into mapping_id;
    insert into public.kpi_weightage (role_kpi_mapping_id, weightage) values (mapping_id, 15);

    insert into public.role_kpi_mapping (role_id, kpi_id) values (role_floor_manager, kpi_attendance) returning id into mapping_id;
    insert into public.kpi_weightage (role_kpi_mapping_id, weightage) values (mapping_id, 10);

    insert into public.role_kpi_mapping (role_id, kpi_id) values (role_floor_manager, kpi_customer_complaint) returning id into mapping_id;
    insert into public.kpi_weightage (role_kpi_mapping_id, weightage) values (mapping_id, 15);

    insert into public.role_kpi_mapping (role_id, kpi_id) values (role_floor_manager, kpi_stock_accuracy) returning id into mapping_id;
    insert into public.kpi_weightage (role_kpi_mapping_id, weightage) values (mapping_id, 20);

    insert into public.role_kpi_mapping (role_id, kpi_id) values (role_floor_manager, kpi_training_completion) returning id into mapping_id;
    insert into public.kpi_weightage (role_kpi_mapping_id, weightage) values (mapping_id, 10);
  end if;

  -- Example scoring rules (range-based) for VM Audit, since it uses formula_type = range_based.
  insert into public.kpi_scoring_rules (kpi_id, rule_type, min_value, max_value, score_value, display_order) values
    (kpi_vm_audit, 'range_based', 0, 49.99, 1, 1),
    (kpi_vm_audit, 'range_based', 50, 79.99, 3, 2),
    (kpi_vm_audit, 'range_based', 80, 100, 5, 3);
end;
$$;
