-- ============================================================================
-- Retail HRMS — Phase 1 Part 6 (Performance Data Collection Engine)
-- Migration 0016: Seed performance data sources and default metrics
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PERFORMANCE DATA SOURCES
-- ---------------------------------------------------------------------------
insert into public.performance_data_sources (code, label, is_automated, display_order) values
  ('manual_entry', 'Manual Entry', false, 1),
  ('bulk_entry', 'Bulk Entry', false, 2),
  ('api_entry', 'Future API Entry', true, 3),
  ('billing_integration', 'Future Billing Integration', true, 4),
  ('attendance_integration', 'Future Attendance Integration', true, 5);

-- ---------------------------------------------------------------------------
-- DEFAULT (SYSTEM) METRICS
-- company_id is left null — these are available to every company, same
-- convention as default roles/KPIs/tasks.
-- ---------------------------------------------------------------------------
insert into public.metric_master (metric_code, metric_name, category, measurement_unit, calculation_type, is_system_metric, display_order) values
  ('DAILY_SALE', 'Daily Sale', 'sales', 'amount', 'manual', true, 1),
  ('BILL_COUNT', 'Bill Count', 'billing', 'number', 'manual', true, 2),
  ('UPT', 'UPT', 'sales', 'number', 'manual', true, 3),
  ('CONVERSION', 'Conversion', 'sales', 'percentage', 'manual', true, 4),
  ('FOOTFALL', 'Footfall', 'customer', 'number', 'manual', true, 5),
  ('CUSTOMER_COUNT', 'Customer Count', 'customer', 'number', 'manual', true, 6),
  ('TASK_COMPLETION', 'Task Completion', 'task', 'percentage', 'automatic', true, 7),
  ('CHECKLIST_COMPLETION', 'Checklist Completion', 'checklist', 'percentage', 'automatic', true, 8),
  ('LATE_COMING', 'Late Coming', 'attendance', 'number', 'manual', true, 9),
  ('ABSENT', 'Absent', 'attendance', 'number', 'manual', true, 10),
  ('PRESENT', 'Present', 'attendance', 'number', 'manual', true, 11),
  ('LEAVE', 'Leave', 'attendance', 'number', 'manual', true, 12),
  ('TRAINING_HOURS', 'Training Hours', 'training', 'hours', 'manual', true, 13),
  ('AUDIT_SCORE', 'Audit Score', 'audit', 'score', 'manual', true, 14),
  ('STOCK_ACCURACY_METRIC', 'Stock Accuracy', 'inventory', 'percentage', 'hybrid', true, 15),
  ('CUSTOMER_COMPLAINT_METRIC', 'Customer Complaint', 'customer', 'number', 'manual', true, 16),
  ('CUSTOMER_RATING', 'Customer Rating', 'customer', 'rating', 'manual', true, 17),
  ('STORE_OPENING_TIME', 'Store Opening Time', 'operations', 'number', 'manual', true, 18),
  ('STORE_CLOSING_TIME', 'Store Closing Time', 'operations', 'number', 'manual', true, 19);

-- ---------------------------------------------------------------------------
-- A default "Today" daily performance cycle so the Daily Entry screen has
-- something to attach entries to out of the box. Companies can create their
-- own weekly/monthly/quarterly/yearly cycles from the Performance Data page.
-- ---------------------------------------------------------------------------
insert into public.performance_cycles (name, cycle_type, start_date, end_date) values
  ('Today', 'daily', current_date, current_date);
