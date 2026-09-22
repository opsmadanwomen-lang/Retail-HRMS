# Changelog

All notable changes to this project are documented here, grouped by delivery phase.

> Note: between "Phase 1 Part 6" below and this Phase 5 entry, the Attendance /
> Night Duty engine (migrations `0017`–`0087`) and Leave Management Phases 1–4
> (migrations `0088`–`0120`) were delivered but not recorded in this file.
> `ARCHITECTURE.md` / `DATABASE.md` / `MODULE.md` were likewise last fully
> revised at Phase 1 Part 6. Phase 5 does not change that backlog; it only adds
> its own section here and to `MODULE.md`.

## Phase 5 — Leave → Attendance Integration + Leave Reports

**New migrations**
- `0121_leave_attendance_effects_schema.sql` — `leave_attendance_effects` (per-date
  materialization of an approved application's chargeable days; `status` `active`/`reversed`,
  append-only), a **partial unique index** `idx_leave_attendance_effects_one_active_per_date`
  on `(employee_id, attendance_date) WHERE status='active'` (database-level idempotency +
  one-leave-per-day), RLS mirroring `leave_applications`' own visibility shape (staff sees
  own / direct-manager / super-manager; company non-staff sees company-wide), audit trigger,
  plus `leave_materialize_attendance_dates(p_application_id)` (reuses the SAME
  Weekly-Off/Holiday per-day exclusion rules `leave_compute_total_days()` applied; idempotent
  via `ON CONFLICT DO NOTHING`) and `leave_list_attendance_effects(employee, from, to)` for
  the Attendance Calendar.
- `0122_leave_decide_materialize_and_cancel_after_approval.sql` — `leave_manager_decide()` /
  `leave_super_manager_decide()` gain one line at each **final-approval** branch:
  `perform leave_materialize_attendance_dates(...)`. No authorization / ledger / status logic
  changed. `leave_cancel()` extended to also accept `approved` (Phase 5 §7): an offsetting
  `reversal` ledger row nets the earlier `used` debit to zero and the leave's
  `leave_attendance_effects` rows are marked `reversed` (never deleted). No payroll/attendance
  lock exists in the codebase yet, so there is nothing to bypass — disclosed, not assumed.
- `0123_leave_reports_rpcs.sql` — reporting RPCs, each reading an existing authoritative
  source: `leave_report_applications(from, to)` (one rich listing powering Short/Long/Pending/
  Approval-Rejection/Monthly/Store-wise/Department-wise — all filter/group-by over the same
  rows, incl. server-computed `pending_with`), `leave_report_balances(fy)` (batches
  `leave_get_balance()` per employee/type — never a second formula),
  `leave_report_probation(company)` (reuses `leave_resolve_eligibility()`),
  `leave_list_fy_closing_batches_for_company(company)`, `leave_report_policy_changes(company)`
  and `leave_report_audit(company, from, to)` (both reuse the one generic `audit_logs` table,
  re-enforcing its Super-Admin-only gate explicitly inside the SECURITY DEFINER body).

**No existing table altered.** One new table (`leave_attendance_effects`). No new audit
system, no second balance/day-count engine, no change to any Attendance or Night Duty RPC.

**Frontend**
- New page `src/modules/leave/pages/LeaveReportsPage.tsx` (route
  `/settings/leave-reports`, Super-Admin only, Sidebar "Leave Reports") — all **15** report
  categories, each composed from `PageHeader` / `Card` / `Table` / `Badge` / `Select` / date &
  FY filters / `EmptyState` / `LoadingState`; per-report relevant filters only; CSV export via
  the existing `src/lib/csvExport.ts` (no new reporting framework). The Employee Leave Ledger
  report has a **Summary (§15)** pivot view (Opening / Earned / Carry Forward / Used / Pending /
  Adjustment / Encashment / Lapse / Closing — pure group-by over `leave_ledger` rows +
  `leave_get_balance()` for Pending/Closing + confirmed FY-closing lines for Encashment/Lapse)
  and a raw **Transactions** view.
- New service methods in `src/services/leaveService.ts` (`listAttendanceEffects`,
  `reportLedger`, `reportApplications`, `reportBalances`, `reportProbation`,
  `listFyClosingBatchesForCompany`, `reportPolicyChanges`, `reportAudit`) and hooks in
  `src/hooks/useLeave.ts` (`useLeaveAttendanceEffects` + one `useLeaveReport*` per report).
- **Attendance Calendar (display-layer merge only, never a write to `attendance_records`):**
  `src/modules/attendance/utils.ts` `toAttendanceRow()` now takes `leaveEffects` and applies
  precedence **real attendance record > approved Leave > Weekly Off > Absent**; half-day Leave
  maps to the existing `half_day` status, full-day to `leave`. Wired through every employee-
  calendar surface: the employee's own Monthly view (`AttendancePage.tsx`), the Admin/Super-
  Admin Staff-View date-range table, `MonthlyAttendanceDialog`, and `ManualStaffAttendanceCard`.
  `AttendanceCalendarCard.tsx` already styled the `leave` status.
- `src/types/database.types.ts` — Phase 5 RPC + `leave_attendance_effects` types layered onto
  the `LooseDatabase` compat section (generated block untouched, per that file's own
  convention; regenerate to fold them in once the live schema includes 0121–0123).
- `StaffLeavePage.tsx` already exposed Balance (Earned/Used/Pending/Available) / Apply / My
  Requests / Leave History-Ledger and now also offers Cancel on an already-approved leave.

**Notifications** — reuses `leave_notify()`; final-approval still fires exactly one
`leave_approved`, cancellation one `leave_cancelled`. Materialization adds no notification.
`Balance Low` / `Leave Expiring` remain deferred (need scheduler infrastructure — none added).

## Phase 1 Part 6 — Performance Data Collection Engine

**New migrations**
- `0015_performance_data_engine_schema.sql` — `performance_cycles` (data-collection
  periods, distinct from the existing singular `performance_cycle` from Part 4),
  `performance_data_sources` (lookup: Manual Entry, Bulk Entry, and three future
  integrations), `metric_master`, `metric_mapping` (Metric → Role/Department/Store/
  Employee, with a check constraint requiring at least one scope), `performance_entries`
  (the Daily Entry data itself, with partial unique indexes preventing duplicate
  employee/metric/date and store/metric/date entries), `metric_approval`,
  `metric_comments`, `metric_history` (auto-populated by trigger on every create/
  update/approve/reject/lock), `metric_target`, `metric_actual`,
  `performance_daily_summary`, `performance_monthly_summary`, `employee_daily_metrics`,
  `employee_role_metrics`, `store_daily_metrics`, `department_daily_metrics`,
  `future_ai_metrics`, plus indexes, triggers, and full RLS.
- `0016_seed_performance_data.sql` — seeds 5 performance data sources, 19 default
  metrics from the spec (Daily Sale, Bill Count, UPT, Conversion, Footfall, …), and a
  default "Today" daily performance cycle so Daily Entry works out of the box.

**New services**: `metricMasterService`, `metricMappingService`,
`performanceEntryService` (enforces no-duplicate-entry and no-future-date rules),
`metricApprovalService` (+ `metricCommentService`, `metricHistoryService`),
`performanceDataLookupService` (cycles + sources).

**New hooks**: `useMetrics`, `useMetricMapping`, `usePerformanceDataLookups`,
`usePerformanceDashboardStats`, `useMetricApproval`, `usePerformanceEntries`.

**New pages** (`src/modules/performance-data/`): Performance Data (metric mapping),
Metrics (list + form), Daily Entry (manual + bulk, with a filterable entry list),
Approvals, Performance Dashboard.

**Additive edits to existing files** (no completed module rebuilt):
- `EmployeeProfilePage.tsx` — added a **Performance** tab (Daily Entries + Metric
  History), alongside every tab from Parts 3–5.
- `RoleFormPage.tsx` — added a **Performance Metrics** section for existing roles.
- `StoreFormPage.tsx` — added a **Store Metrics** section for existing stores.
- `DashboardPage.tsx` — added a Performance Data section (Today's/Pending/Approved/
  Rejected Entries) with a link to the full Performance Dashboard.
- `Sidebar.tsx` — added Performance Data, Metrics, Daily Entry, Approvals, Performance
  Dashboard.
- `routes.ts`, `AppRouter.tsx` — new route constants and routes.

**Audit log coverage extended to**: Create/Update/Delete Entry, Approve/Reject Entry —
via the existing generic `write_audit_log()` trigger from Phase 1 Part 1, plus the
dedicated `metric_history` table for entry-level edit history independent of the
generic audit log.

## Phase 1 Part 5 — Task, SOP & Checklist Engine

**New migrations**
- `0013_task_engine_schema.sql` — `task_categories`, `task_frequency`, `task_status`
  (lookup tables, not hardcoded enums), `task_templates`, `task_master`,
  `role_task_mapping`, `task_checklists`, `task_checklist_items`,
  `employee_task_assignment`, `task_submission`, `task_verification`, `task_comments`,
  `task_attachments`, `task_history` (auto-populated by trigger), `task_score`,
  `future_task_performance_mapping`, the private `task-attachments` Storage bucket, and
  full RLS on every table.
- `0014_seed_tasks.sql` — seeds 7 frequencies, 7 statuses, 14 categories, 15 templates
  (Store Opening, Store Closing, Inventory Audit, …), 25 default tasks mapped onto the
  Phase 1 Part 3 default roles (Floor Manager, Department Manager, Operations
  Coordinator, Inventory Controller, Security Coordinator, Housekeeping Coordinator),
  and the "Store Opening" checklist example from the spec (Lights ON, AC ON, …).

**New services**: `taskCategoryService`, `taskLookupService` (frequency/status),
`taskTemplateService`, `taskMasterService`, `roleTaskService`, `taskChecklistService`,
`employeeTaskService` (assignment/submission/verification/comments/history),
`taskAttachmentService`, `taskScoreService` (Scoring Engine Foundation for tasks).

**New hooks**: one per service above, plus `useTaskDashboardStats`.

**New pages** (`src/modules/tasks/`): Task Categories, Task Master (list + form with
inline checklist editor), Task Templates, Role Task Mapping, Task Assignment,
Checklist (standalone), Task Dashboard.

**New UI primitive**: `Checkbox` (`@radix-ui/react-checkbox` added to `package.json`) —
used by the checklist completion UI in `TaskSubmissionDialog` and the task form's
Submission Options section.

**Additive edits to existing files** (no completed module rebuilt):
- `EmployeeProfilePage.tsx` — added **Tasks**, **SOP**, **Checklist**, and **History**
  tabs, alongside the existing Responsibilities (Part 3) and KPIs (Part 4) tabs.
- `DashboardPage.tsx` — added a Tasks section (Today's/Pending/Completed/Overdue) with
  a link to the full Task Dashboard.
- `Sidebar.tsx` — added Task Categories, Task Master, Task Templates, Task Assignment,
  Checklist, Task Dashboard.
- `routes.ts`, `AppRouter.tsx` — new route constants and routes.

**Audit log coverage extended to**: Create/Update/Delete Task, Assign Task, Complete
Task (submission insert), Verify/Reject Task (verification insert) — all via the
existing generic `write_audit_log()` trigger from Phase 1 Part 1.

## Phase 1 Part 4 — KPI Management Engine

**New migrations**
- `0011_kpi_management_schema.sql` — `kpi_categories`, `kpi_master`, `role_kpi_mapping`,
  `kpi_weightage`, `employee_kpi_assignment`, `kpi_target`, `kpi_actual`,
  `kpi_scoring_rules`, `performance_cycle`, `performance_rating`, `kpi_result`,
  `performance_summary`, `future_performance_history`, plus indexes, triggers, and RLS.
- `0012_seed_kpi.sql` — seeds 14 KPI categories, 6 performance rating bands, 6 default
  system KPIs, and an example Role → KPI → Weightage mapping on Floor Manager matching
  the spec's worked example (30/15/10/15/20/10 = 100%).

**New services**: `kpiCategoryService`, `kpiMasterService`, `roleKpiService`,
`employeeKpiService`, `performanceService`.

**New hooks**: `useKpiCategories`, `useKpis`, `useRoleKpi`, `useEmployeeKpi`,
`usePerformance`, `useKpiDashboardStats`.

**New pages** (`src/modules/kpi/`): KPI Categories, KPI Master (list + form), Role KPI
(weightage editor), Performance Summary.

**Additive edits to existing files** (no completed module rebuilt):
- `EmployeeProfilePage.tsx` — added a **KPIs** tab (assignment, target, actual, sync
  from roles), alongside the Part 3 Responsibilities tab.
- `DashboardPage.tsx` — added a KPI & Performance section (Total/Mapped/Pending KPI,
  active cycle, Top Performing Roles/KPI) and widened `StatCard`'s `value` prop to
  `number | string` so the active cycle *name* can be shown as a stat.
- `Sidebar.tsx` — added KPI Categories, KPI Master, Role KPI, Performance Summary.
- `routes.ts`, `AppRouter.tsx` — new route constants and routes.

**Audit log coverage extended to**: Create/Update/Delete KPI, Assign KPI (role and
employee), Update Target, Update Weightage — all via the existing generic
`write_audit_log()` trigger from Phase 1 Part 1.

## Phase 1 Part 3 — Role Management Engine

Responsibility system (not permissions): `role_categories`, `role_status`, `roles`,
`employee_roles`, `employee_role_history`, `role_notes`, `role_permissions_placeholder`,
`future_role_kpi_mapping`. Role Master, Role Assignment, and a Responsibilities tab on
Employee Profile. Seeded 11 categories and 21 default system roles.

## Phase 1 Part 2 — Employee Management Foundation

Extended `employees` with full HR fields; added `employee_documents`,
`employee_transfers`, `employee_promotions`, `employee_import_batches`,
`employee_notes`. Employee Master, Import (CSV/XLSX with auto-mapping), Profile
(tabbed), Documents (Supabase Storage), Search & Filters, Reporting Structure,
Transfer/Promotion foundations.

## Phase 1 Part 1 — Enterprise Retail HRMS Foundation

Initial schema: `companies`, `stores`, master organization template
(`master_teams`/`master_departments`/`master_designations`), auto store-provisioning
trigger, `profiles`, `employees` (base), `audit_logs`. Authentication, Company/Store
modules, Dashboard, Organization Tree.
