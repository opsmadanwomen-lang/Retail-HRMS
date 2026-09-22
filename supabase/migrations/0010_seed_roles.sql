-- ============================================================================
-- Retail HRMS — Phase 1 Part 3 (Role Management Engine)
-- Migration 0010: Seed role_status, role_categories, and default roles
--
-- Everything here is data, not UI logic — new categories/roles can be added
-- later with a plain INSERT, no code changes required.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ROLE STATUS
-- ---------------------------------------------------------------------------
insert into public.role_status (code, label, display_order) values
  ('active', 'Active', 1),
  ('inactive', 'Inactive', 2),
  ('temporary', 'Temporary', 3),
  ('permanent', 'Permanent', 4);

-- ---------------------------------------------------------------------------
-- ROLE CATEGORIES
-- ---------------------------------------------------------------------------
insert into public.role_categories (name, display_order) values
  ('Sales Management', 1),
  ('Operations', 2),
  ('Inventory', 3),
  ('Security', 4),
  ('Customer Service', 5),
  ('Compliance', 6),
  ('Safety', 7),
  ('Administration', 8),
  ('Training', 9),
  ('Store Management', 10),
  ('Custom', 11);

-- ---------------------------------------------------------------------------
-- DEFAULT (SYSTEM) ROLES
-- company_id is left null — these are available to every company. A
-- Company Admin can still create their own Custom roles alongside these.
-- ---------------------------------------------------------------------------
do $$
declare
  cat_sales uuid;
  cat_ops uuid;
  cat_inventory uuid;
  cat_security uuid;
  cat_customer_service uuid;
  cat_compliance uuid;
  cat_safety uuid;
  cat_admin uuid;
  cat_training uuid;
  cat_store_mgmt uuid;
begin
  select id into cat_sales from public.role_categories where name = 'Sales Management';
  select id into cat_ops from public.role_categories where name = 'Operations';
  select id into cat_inventory from public.role_categories where name = 'Inventory';
  select id into cat_security from public.role_categories where name = 'Security';
  select id into cat_customer_service from public.role_categories where name = 'Customer Service';
  select id into cat_compliance from public.role_categories where name = 'Compliance';
  select id into cat_safety from public.role_categories where name = 'Safety';
  select id into cat_admin from public.role_categories where name = 'Administration';
  select id into cat_training from public.role_categories where name = 'Training';
  select id into cat_store_mgmt from public.role_categories where name = 'Store Management';

  insert into public.roles (role_name, role_code, category_id, role_type, is_system_role, display_order) values
    ('Floor Manager', 'FLOOR_MANAGER', cat_sales, 'frontend', true, 1),
    ('Department Manager', 'DEPARTMENT_MANAGER', cat_sales, 'frontend', true, 2),
    ('Store Operations Coordinator', 'STORE_OPS_COORDINATOR', cat_ops, 'backend', true, 3),
    ('Inventory Controller', 'INVENTORY_CONTROLLER', cat_inventory, 'backend', true, 4),
    ('VM Coordinator', 'VM_COORDINATOR', cat_store_mgmt, 'both', true, 5),
    ('Trial Room Incharge', 'TRIAL_ROOM_INCHARGE', cat_customer_service, 'frontend', true, 6),
    ('Cash Supervisor', 'CASH_SUPERVISOR', cat_sales, 'frontend', true, 7),
    ('Customer Service Incharge', 'CUSTOMER_SERVICE_INCHARGE', cat_customer_service, 'frontend', true, 8),
    ('Fire Safety Incharge', 'FIRE_SAFETY_INCHARGE', cat_safety, 'both', true, 9),
    ('Training Coordinator', 'TRAINING_COORDINATOR', cat_training, 'both', true, 10),
    ('Opening Checklist Incharge', 'OPENING_CHECKLIST_INCHARGE', cat_store_mgmt, 'both', true, 11),
    ('Closing Checklist Incharge', 'CLOSING_CHECKLIST_INCHARGE', cat_store_mgmt, 'both', true, 12),
    ('Store Audit Coordinator', 'STORE_AUDIT_COORDINATOR', cat_compliance, 'both', true, 13),
    ('Stock Audit Coordinator', 'STOCK_AUDIT_COORDINATOR', cat_inventory, 'backend', true, 14),
    ('Visual Merchandising Incharge', 'VISUAL_MERCHANDISING_INCHARGE', cat_store_mgmt, 'frontend', true, 15),
    ('Locker Key Incharge', 'LOCKER_KEY_INCHARGE', cat_security, 'backend', true, 16),
    ('Repair & Maintenance Incharge', 'REPAIR_MAINTENANCE_INCHARGE', cat_ops, 'backend', true, 17),
    ('Attendance Coordinator', 'ATTENDANCE_COORDINATOR', cat_admin, 'both', true, 18),
    ('Housekeeping Coordinator', 'HOUSEKEEPING_COORDINATOR', cat_ops, 'backend', true, 19),
    ('Security Coordinator', 'SECURITY_COORDINATOR', cat_security, 'backend', true, 20),
    ('Festival Display Incharge', 'FESTIVAL_DISPLAY_INCHARGE', cat_store_mgmt, 'frontend', true, 21);
end;
$$;
