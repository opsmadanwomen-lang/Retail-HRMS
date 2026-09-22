-- ============================================================================
-- Retail HRMS — Phase 1 Part 5 (Task, SOP & Checklist Engine)
-- Migration 0014: Seed lookups, categories, templates, default tasks,
-- default role-task mappings, and the "Store Opening" checklist example.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- TASK FREQUENCY
-- ---------------------------------------------------------------------------
insert into public.task_frequency (code, label, display_order) values
  ('daily', 'Daily', 1),
  ('weekly', 'Weekly', 2),
  ('monthly', 'Monthly', 3),
  ('quarterly', 'Quarterly', 4),
  ('yearly', 'Yearly', 5),
  ('one_time', 'One Time', 6),
  ('recurring', 'Recurring', 7);

-- ---------------------------------------------------------------------------
-- TASK STATUS
-- ---------------------------------------------------------------------------
insert into public.task_status (code, label, display_order) values
  ('pending', 'Pending', 1),
  ('in_progress', 'In Progress', 2),
  ('completed', 'Completed', 3),
  ('verified', 'Verified', 4),
  ('rejected', 'Rejected', 5),
  ('cancelled', 'Cancelled', 6),
  ('expired', 'Expired', 7);

-- ---------------------------------------------------------------------------
-- TASK CATEGORIES
-- ---------------------------------------------------------------------------
insert into public.task_categories (name, display_order) values
  ('Sales', 1),
  ('Operations', 2),
  ('Inventory', 3),
  ('Cash', 4),
  ('Customer Care', 5),
  ('Alteration', 6),
  ('Security', 7),
  ('Housekeeping', 8),
  ('Administration', 9),
  ('Compliance', 10),
  ('Training', 11),
  ('Visual Merchandising', 12),
  ('Maintenance', 13),
  ('Custom', 14);

-- ---------------------------------------------------------------------------
-- TASK TEMPLATES, DEFAULT TASKS, ROLE-TASK MAPPING, AND THE STORE OPENING
-- CHECKLIST EXAMPLE
-- ---------------------------------------------------------------------------
do $$
declare
  cat_sales uuid;
  cat_operations uuid;
  cat_inventory uuid;
  cat_cash uuid;
  cat_customer_care uuid;
  cat_security uuid;
  cat_housekeeping uuid;
  cat_administration uuid;
  cat_compliance uuid;
  cat_visual_merchandising uuid;
  cat_maintenance uuid;

  freq_daily uuid;
  freq_weekly uuid;
  freq_one_time uuid;

  tpl_store_opening uuid;
  tpl_store_closing uuid;
  tpl_inventory_audit uuid;
  tpl_customer_complaint uuid;
  tpl_floor_walk uuid;
  tpl_housekeeping_inspection uuid;
  tpl_fire_safety_inspection uuid;
  tpl_cash_verification uuid;
  tpl_display_audit uuid;
  tpl_generator_check uuid;
  tpl_ac_check uuid;
  tpl_cctv_check uuid;
  tpl_trial_room_check uuid;
  tpl_stock_replenishment uuid;
  tpl_staff_briefing uuid;

  role_floor_manager uuid;
  role_department_manager uuid;
  role_store_ops_coordinator uuid;
  role_inventory_controller uuid;
  role_security_coordinator uuid;
  role_housekeeping_coordinator uuid;

  task_opening_checklist uuid;
  task_staff_grooming uuid;
  task_floor_walk uuid;
  task_display_inspection uuid;
  task_customer_feedback uuid;
  task_trial_room_inspection uuid;

  task_dept_sale_review uuid;
  task_stock_review uuid;
  task_attendance_review uuid;
  task_complaint_review uuid;

  task_store_opening_ops uuid;
  task_store_closing uuid;
  task_maintenance uuid;
  task_fire_safety uuid;
  task_power_backup uuid;

  task_stock_accuracy uuid;
  task_grn uuid;
  task_transfer uuid;
  task_negative_stock uuid;

  task_visitor_register uuid;
  task_security_patrol uuid;
  task_emergency_drill uuid;

  task_cleaning_checklist uuid;
  task_washroom_checklist uuid;
  task_dusting_checklist uuid;

  checklist_id uuid;
begin
  select id into cat_sales from public.task_categories where name = 'Sales';
  select id into cat_operations from public.task_categories where name = 'Operations';
  select id into cat_inventory from public.task_categories where name = 'Inventory';
  select id into cat_cash from public.task_categories where name = 'Cash';
  select id into cat_customer_care from public.task_categories where name = 'Customer Care';
  select id into cat_security from public.task_categories where name = 'Security';
  select id into cat_housekeeping from public.task_categories where name = 'Housekeeping';
  select id into cat_administration from public.task_categories where name = 'Administration';
  select id into cat_compliance from public.task_categories where name = 'Compliance';
  select id into cat_visual_merchandising from public.task_categories where name = 'Visual Merchandising';
  select id into cat_maintenance from public.task_categories where name = 'Maintenance';

  select id into freq_daily from public.task_frequency where code = 'daily';
  select id into freq_weekly from public.task_frequency where code = 'weekly';
  select id into freq_one_time from public.task_frequency where code = 'one_time';

  -- -----------------------------------------------------------------------
  -- TASK TEMPLATES (15 examples from the spec)
  -- -----------------------------------------------------------------------
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('STORE_OPENING', 'Store Opening', cat_operations, true, 1) returning id into tpl_store_opening;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('STORE_CLOSING', 'Store Closing', cat_operations, true, 2) returning id into tpl_store_closing;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('INVENTORY_AUDIT', 'Inventory Audit', cat_inventory, true, 3) returning id into tpl_inventory_audit;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('CUSTOMER_COMPLAINT', 'Customer Complaint', cat_customer_care, true, 4) returning id into tpl_customer_complaint;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('FLOOR_WALK', 'Floor Walk', cat_sales, true, 5) returning id into tpl_floor_walk;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('HOUSEKEEPING_INSPECTION', 'Housekeeping Inspection', cat_housekeeping, true, 6) returning id into tpl_housekeeping_inspection;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('FIRE_SAFETY_INSPECTION', 'Fire Safety Inspection', cat_compliance, true, 7) returning id into tpl_fire_safety_inspection;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('CASH_VERIFICATION', 'Cash Verification', cat_cash, true, 8) returning id into tpl_cash_verification;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('DISPLAY_AUDIT', 'Display Audit', cat_visual_merchandising, true, 9) returning id into tpl_display_audit;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('GENERATOR_CHECK', 'Generator Check', cat_maintenance, true, 10) returning id into tpl_generator_check;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('AC_CHECK', 'AC Check', cat_maintenance, true, 11) returning id into tpl_ac_check;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('CCTV_CHECK', 'CCTV Check', cat_security, true, 12) returning id into tpl_cctv_check;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('TRIAL_ROOM_CHECK', 'Trial Room Check', cat_customer_care, true, 13) returning id into tpl_trial_room_check;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('STOCK_REPLENISHMENT', 'Stock Replenishment', cat_inventory, true, 14) returning id into tpl_stock_replenishment;
  insert into public.task_templates (template_code, template_name, category_id, is_system_template, display_order) values
    ('STAFF_BRIEFING', 'Staff Briefing', cat_administration, true, 15) returning id into tpl_staff_briefing;

  -- -----------------------------------------------------------------------
  -- DEFAULT TASKS — Floor Manager
  -- -----------------------------------------------------------------------
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, display_order) values
    ('OPENING_CHECKLIST', 'Opening Checklist', cat_operations, freq_daily, tpl_store_opening, true, true, 1) returning id into task_opening_checklist;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('STAFF_GROOMING', 'Staff Grooming', cat_administration, freq_daily, true, true, 2) returning id into task_staff_grooming;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, display_order) values
    ('FLOOR_WALK_TASK', 'Floor Walk', cat_sales, freq_daily, tpl_floor_walk, true, true, 3) returning id into task_floor_walk;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, allow_photo_upload, display_order) values
    ('DISPLAY_INSPECTION', 'Display Inspection', cat_visual_merchandising, freq_daily, tpl_display_audit, true, true, true, 4) returning id into task_display_inspection;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('CUSTOMER_FEEDBACK', 'Customer Feedback', cat_customer_care, freq_daily, true, true, 5) returning id into task_customer_feedback;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, display_order) values
    ('TRIAL_ROOM_INSPECTION', 'Trial Room Inspection', cat_customer_care, freq_daily, tpl_trial_room_check, true, true, 6) returning id into task_trial_room_inspection;

  -- Department Manager
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('DEPT_SALE_REVIEW', 'Department Sale Review', cat_sales, freq_daily, true, true, 7) returning id into task_dept_sale_review;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('STOCK_REVIEW', 'Stock Review', cat_inventory, freq_weekly, true, true, 8) returning id into task_stock_review;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('STAFF_ATTENDANCE_REVIEW', 'Staff Attendance Review', cat_administration, freq_daily, true, true, 9) returning id into task_attendance_review;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('CUSTOMER_COMPLAINT_REVIEW', 'Customer Complaint Review', cat_customer_care, freq_weekly, true, true, 10) returning id into task_complaint_review;

  -- Operations Manager
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, display_order) values
    ('STORE_OPENING_OPS', 'Store Opening', cat_operations, freq_daily, tpl_store_opening, true, true, 11) returning id into task_store_opening_ops;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, display_order) values
    ('STORE_CLOSING_OPS', 'Store Closing', cat_operations, freq_daily, tpl_store_closing, true, true, 12) returning id into task_store_closing;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, allow_photo_upload, display_order) values
    ('MAINTENANCE_TASK', 'Maintenance', cat_maintenance, freq_weekly, true, true, true, 13) returning id into task_maintenance;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, display_order) values
    ('FIRE_SAFETY_TASK', 'Fire Safety', cat_compliance, freq_weekly, tpl_fire_safety_inspection, true, true, 14) returning id into task_fire_safety;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('POWER_BACKUP', 'Power Backup', cat_maintenance, freq_weekly, true, true, 15) returning id into task_power_backup;

  -- Inventory Manager
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, display_order) values
    ('STOCK_ACCURACY_TASK', 'Stock Accuracy', cat_inventory, freq_weekly, tpl_inventory_audit, true, true, 16) returning id into task_stock_accuracy;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('GRN_TASK', 'GRN', cat_inventory, freq_daily, true, true, 17) returning id into task_grn;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('TRANSFER_TASK', 'Transfer', cat_inventory, freq_daily, true, true, 18) returning id into task_transfer;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('NEGATIVE_STOCK', 'Negative Stock', cat_inventory, freq_daily, true, true, 19) returning id into task_negative_stock;

  -- Security
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('VISITOR_REGISTER', 'Visitor Register', cat_security, freq_daily, true, false, 20) returning id into task_visitor_register;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, display_order) values
    ('SECURITY_PATROL', 'Security Patrol', cat_security, freq_daily, tpl_cctv_check, true, true, 21) returning id into task_security_patrol;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('EMERGENCY_DRILL', 'Emergency Drill', cat_security, freq_one_time, true, true, 22) returning id into task_emergency_drill;

  -- Housekeeping
  insert into public.task_master (task_code, task_name, category_id, frequency_id, template_id, is_system_task, requires_verification, display_order) values
    ('CLEANING_CHECKLIST', 'Cleaning Checklist', cat_housekeeping, freq_daily, tpl_housekeeping_inspection, true, true, 23) returning id into task_cleaning_checklist;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('WASHROOM_CHECKLIST', 'Washroom Checklist', cat_housekeeping, freq_daily, true, true, 24) returning id into task_washroom_checklist;
  insert into public.task_master (task_code, task_name, category_id, frequency_id, is_system_task, requires_verification, display_order) values
    ('DUSTING_CHECKLIST', 'Dusting Checklist', cat_housekeeping, freq_daily, true, true, 25) returning id into task_dusting_checklist;

  -- -----------------------------------------------------------------------
  -- ROLE TASK MAPPING (default roles seeded in 0010)
  -- -----------------------------------------------------------------------
  select id into role_floor_manager from public.roles where role_code = 'FLOOR_MANAGER' and company_id is null;
  select id into role_department_manager from public.roles where role_code = 'DEPARTMENT_MANAGER' and company_id is null;
  select id into role_store_ops_coordinator from public.roles where role_code = 'STORE_OPS_COORDINATOR' and company_id is null;
  select id into role_inventory_controller from public.roles where role_code = 'INVENTORY_CONTROLLER' and company_id is null;
  select id into role_security_coordinator from public.roles where role_code = 'SECURITY_COORDINATOR' and company_id is null;
  select id into role_housekeeping_coordinator from public.roles where role_code = 'HOUSEKEEPING_COORDINATOR' and company_id is null;

  if role_floor_manager is not null then
    insert into public.role_task_mapping (role_id, task_id) values
      (role_floor_manager, task_opening_checklist),
      (role_floor_manager, task_staff_grooming),
      (role_floor_manager, task_floor_walk),
      (role_floor_manager, task_display_inspection),
      (role_floor_manager, task_customer_feedback),
      (role_floor_manager, task_trial_room_inspection);
  end if;

  if role_department_manager is not null then
    insert into public.role_task_mapping (role_id, task_id) values
      (role_department_manager, task_dept_sale_review),
      (role_department_manager, task_stock_review),
      (role_department_manager, task_attendance_review),
      (role_department_manager, task_complaint_review);
  end if;

  if role_store_ops_coordinator is not null then
    insert into public.role_task_mapping (role_id, task_id) values
      (role_store_ops_coordinator, task_store_opening_ops),
      (role_store_ops_coordinator, task_store_closing),
      (role_store_ops_coordinator, task_maintenance),
      (role_store_ops_coordinator, task_fire_safety),
      (role_store_ops_coordinator, task_power_backup);
  end if;

  if role_inventory_controller is not null then
    insert into public.role_task_mapping (role_id, task_id) values
      (role_inventory_controller, task_stock_accuracy),
      (role_inventory_controller, task_grn),
      (role_inventory_controller, task_transfer),
      (role_inventory_controller, task_negative_stock);
  end if;

  if role_security_coordinator is not null then
    insert into public.role_task_mapping (role_id, task_id) values
      (role_security_coordinator, task_visitor_register),
      (role_security_coordinator, task_security_patrol),
      (role_security_coordinator, task_emergency_drill);
  end if;

  if role_housekeeping_coordinator is not null then
    insert into public.role_task_mapping (role_id, task_id) values
      (role_housekeeping_coordinator, task_cleaning_checklist),
      (role_housekeeping_coordinator, task_washroom_checklist),
      (role_housekeeping_coordinator, task_dusting_checklist);
  end if;

  -- -----------------------------------------------------------------------
  -- STORE OPENING CHECKLIST EXAMPLE (from the spec's CHECKLIST MASTER section)
  -- Attached to the Operations "Store Opening" task.
  -- -----------------------------------------------------------------------
  insert into public.task_checklists (task_id, name, display_order) values
    (task_store_opening_ops, 'Store Opening Checklist', 1) returning id into checklist_id;

  insert into public.task_checklist_items (task_checklist_id, item_name, is_mandatory, sequence) values
    (checklist_id, 'Lights ON', true, 1),
    (checklist_id, 'AC ON', true, 2),
    (checklist_id, 'Music ON', false, 3),
    (checklist_id, 'POS Running', true, 4),
    (checklist_id, 'Trial Room Ready', true, 5),
    (checklist_id, 'Staff Present', true, 6),
    (checklist_id, 'Display Ready', true, 7);
end;
$$;
