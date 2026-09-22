# DATABASE.md

Full schema reference for the Retail HRMS. All tables live in the `public` schema of a
single Supabase/PostgreSQL project. Every table uses a UUID primary key
(`gen_random_uuid()`), and every write-path table carries `created_at` / `updated_at`
(and `created_by` / `updated_by` where the writer matters). Row Level Security is
enabled on every table; see each migration file for the exact policies.

Migrations run in numeric order from `supabase/migrations/`.

## 1. Core Foundation (0001–0005)

```
companies (1) ── (N) stores
master_teams (1) ── (N) master_departments (1) ── (N) master_designations
stores (1) ── (N) store_teams  [copied from master_teams on store creation]
store_teams (1) ── (N) store_departments  [copied from master_departments]
store_departments (1) ── (N) store_designations  [copied from master_designations]
companies (1) ── (N) profiles  [Supabase Auth users]
stores (1) ── (N) employees
audit_logs  [generic, table_name + record_id + action + old/new data]
```

`0003_auto_store_provisioning.sql` contains the trigger that copies the entire master
template into `store_teams` / `store_departments` / `store_designations` the moment a
store is inserted — no manual setup step exists anywhere in the app.

## 2. Employee Management (0006–0008)

`employees` (defined in 0001) is extended in `0006_employee_master.sql` with: name
parts, gender, DOB, blood group, mobile numbers, photo, `store_team_id` /
`store_department_id` (auto-derived from `store_designation_id` by trigger —
never set directly), `reporting_manager_id` (self-FK), joining/confirmation dates,
employment/salary type, and a `status` enum (kept in sync with the legacy `is_active`
boolean for backward compatibility).

```
employees (1) ── (N) employee_documents      [Supabase Storage pointer]
employees (1) ── (N) employee_transfers      [history only, no workflow]
employees (1) ── (N) employee_promotions     [history only, no workflow]
employees (1) ── (N) employee_notes
companies (1) ── (N) employee_import_batches [one row per CSV/XLSX import run]
employees (1) ── (N) employees               [reporting_manager_id self-reference]
```

## 3. Role Management (0009–0010)

A **responsibility** system, not permissions. An employee's Primary Designation stays
in `employees.store_designation_id`; this layer is entirely additive.

```
role_categories                          [11 seeded: Sales Management, Operations, …]
role_status                              [4 seeded: Active, Inactive, Temporary, Permanent
                                           — a lookup table, not a hardcoded enum]
roles                                    [company_id null = system default, like master_*]
  L category_id -> role_categories
  L department_id -> master_departments (optional - many roles span the whole store)

employees (N) --< employee_roles >-- (N) roles     [many-to-many, via employee_roles]
  employee_roles.status_id -> role_status
  employee_roles: partial unique (employee_id, role_id) WHERE removed_at IS NULL
    -> blocks a duplicate *active* assignment of the same role

employee_role_history                    [auto-populated by trigger on every
                                           assign / remove / status-change — never
                                           written to directly by application code]
role_notes                               [free-text notes on a Role Master record]
role_permissions_placeholder             [future-ready, unused by the app today]
future_role_kpi_mapping                  [superseded by the real role_kpi_mapping
                                           built in Phase 1 Part 4 below]
```

21 default system roles are seeded (Floor Manager, Department Manager, Inventory
Controller, …), each assigned a category and role_type.

## 4. KPI Management Engine (0011–0012)

The foundation for Performance, Promotion, Training, Appraisal, Incentive, and a future
AI Recommendation Engine.

```
kpi_categories                           [14 seeded: Sales, Customer Service, …]
performance_rating                       [6 seeded bands: Excellent … Poor — configurable,
                                           not a hardcoded enum]
kpi_master                               [company_id null = system default KPI]
  L category_id -> kpi_categories

roles (N) --< role_kpi_mapping >-- (N) kpi_master   [many-to-many]
  role_kpi_mapping: partial unique (role_id, kpi_id) WHERE is_active = true
    -> a removed mapping can be re-added later without a unique-constraint conflict

role_kpi_mapping (1) -- (N) kpi_weightage
  [versioned: only one is_active=true row per mapping at a time; updating a
   weightage closes the old row (sets expiry_date) and opens a new one, so full
   weightage history is preserved. The application enforces that the SUM of all
   currently-active weightages for a role equals exactly 100% before saving.]

employees (N) --< employee_kpi_assignment >-- (N) kpi_master
  [materializes "Employee -> Assigned Role -> Assigned KPI". source = 'role' when
   synced from role_kpi_mapping via an employee's role, or 'manual' when an admin
   assigned it directly. Partial unique (employee_id, kpi_id) WHERE is_active = true
   blocks a duplicate active assignment.]

kpi_target       [flexible grain: store / department / role / employee(optional);
                  most-specific currently-effective row wins, resolved in the app]
kpi_actual       [manual entry; data_source names the future integration
                  (billing / attendance / inventory / POS) so no schema change is
                  needed when those land]
kpi_scoring_rules [Scoring Engine Foundation: banded rules per KPI, e.g. range_based
                   0-50% -> score 1, 50-80% -> score 3, 80%+ -> score 5]

performance_cycle                        [Monthly / Quarterly / Yearly / Custom]
kpi_result       [one computed row per employee/KPI/cycle - target + actual +
                  weightage + score, written by performanceService, unique on
                  (employee_id, kpi_id, performance_cycle_id)]
performance_summary [rollup: role-wise scores (jsonb snapshot) + one overall score
                     + resolved performance_rating, unique on
                     (employee_id, performance_cycle_id)]

future_performance_history [append-only event log a future Promotion / Training /
                            Incentive / Appraisal / AI engine can read from without
                            new tables of its own]
```

### 4.1 Weightage versioning example

```
role_kpi_mapping "Floor Manager <-> Department Sale"
  L kpi_weightage: 30% (effective 2026-01-01, is_active=true)

# admin changes it to 25% on 2026-04-01:
  L kpi_weightage: 30% (expiry_date=2026-04-01, is_active=false)   -- closed
  L kpi_weightage: 25% (effective 2026-04-01, is_active=true)      -- current
```

### 4.2 Scoring flow (Scoring Engine Foundation)

1. `kpi_target` (latest active, employee-scoped) + `kpi_actual` (summed within the
   cycle's date range) -> `achievement_percentage = actual / target * 100`.
2. `kpi_scoring_rules` (if `range_based` rules exist for the KPI) resolves a `score`
   (0-5); otherwise a simple linear fallback (`achievement% / 20`, capped at 5).
3. The KPI's current `kpi_weightage` (via the employee's role) is applied:
   `weighted_score = score * weightage / 100`.
4. All of an employee's `kpi_result` rows for a cycle are grouped by `role_id` into
   `role_wise_scores`, and averaged into one `overall_score`, which is matched against
   `performance_rating` bands.

This is intentionally simple ("foundation", per spec) — a full formula-based engine,
automatic scheduling, and cross-integration (billing/attendance/inventory feeding
`kpi_actual` automatically) are future work.

## 5. Task, SOP & Checklist Engine (0013–0014)

The operational backbone: Role → Task → SOP (Checklist) → Verification → Completion →
Performance Contribution.

```
task_categories                          [14 seeded: Sales, Operations, Inventory, …]
task_frequency                           [7 seeded: Daily … Recurring — a lookup table,
                                           doubles as the "Task Type" field on task_master]
task_status                              [7 seeded: Pending … Expired — configurable,
                                           not a hardcoded enum]
task_templates                           [15 seeded presets: Store Opening, Store
                                           Closing, Inventory Audit, …]
task_master                              [company_id null = system default task]
  L category_id -> task_categories
  L frequency_id -> task_frequency
  L template_id -> task_templates (optional link back to the preset it came from)

roles (N) --< role_task_mapping >-- (N) task_master   [many-to-many]
  role_task_mapping: partial unique (role_id, task_id) WHERE is_active = true
    -> a removed mapping can be re-added later without a unique-constraint conflict

task_master (1) -- (N) task_checklists (1) -- (N) task_checklist_items
  [unlimited checklist items per task, each with is_mandatory + weightage + sequence]

employees (N) --< employee_task_assignment >-- (N) task_master
  [Employee -> Role -> Task -> Due Date -> Due Time -> Priority -> Status.
   is_active is a soft-delete/uniqueness convenience (mirrors employee_roles /
   employee_kpi_assignment); the real workflow state lives in status_id.
   Partial unique (employee_id, task_id) WHERE is_active = true blocks a duplicate
   active assignment of the same task.]

employee_task_assignment (1) -- (N) task_submission
  [Completion Time, Remarks, checklist_responses (jsonb). Multiple submissions per
   assignment are allowed, to support resubmission after rejection.]
task_submission (1) -- (N) task_verification
  [Verifier, decision (approved/rejected), Remarks, Score. Cannot verify a task with
   no submission — enforced in the application layer.]
employee_task_assignment (1) -- (N) task_comments
employee_task_assignment (1) -- (N) task_attachments
  [Supabase Storage pointer, bucket: task-attachments, private, RLS scoped by
   company_id folder — same pattern as employee-documents from Phase 1 Part 2]
employee_task_assignment (1) -- (N) task_history
  [auto-populated by trigger on assign / status-change; submission and verification
   events are appended by the application alongside the corresponding
   task_submission / task_verification insert, since those carry richer context than
   a simple column diff]
employee_task_assignment (1) -- (1) task_score
  [Scoring Engine Foundation for tasks: Weightage (from task_master), Completion %
   (mandatory checklist items checked / total, from the latest submission),
   Verification % (100 if approved, 0 if rejected), Quality Score (the verifier's
   score), Final Score (average of Completion % and Verification %)]

future_task_performance_mapping [append-only event log a future Attendance / Audit /
                                 Performance / Training / Promotion / Payroll /
                                 Incentive / AI engine can read from without new
                                 tables of its own]
```

### 5.1 Validation rules enforced

- **Prevent duplicate active task assignment** — the partial unique index on
  `employee_task_assignment (employee_id, task_id) WHERE is_active = true`, backed up
  by an application-level check before insert.
- **Mandatory checklist must be completed** — `employeeTaskService.submit()` compares
  the submitted `checklist_responses` against every checklist item where
  `is_mandatory = true` for the task, and rejects the submission if any are missing.
- **Cannot verify incomplete task** — `TaskVerificationDialog` only accepts a real
  `task_submission` row; there is no path to insert a `task_verification` without one.
- **Cannot submit without required documents if mandatory** — `task_master.allow_photo_upload`
  / `allow_document_upload` gate whether the attachment control appears at all in
  `TaskSubmissionDialog`; enforcing a hard "must attach" rule is left to the UI layer
  per-company policy in a future phase (the columns exist for it today).

## 6. Performance Data Collection Engine (0015–0016)

The central data collection system. Every future module (Attendance, Payroll, Leave,
Performance Calculation, Promotion, Training, Audit, Incentive, AI Analytics) reads
from here. **This layer does not calculate performance — it only collects structured
operational data.**

### 6.1 A note on `performance_cycles` vs `performance_cycle`

Phase 1 Part 4 (KPI Engine) already created a singular `performance_cycle` table to
drive `performance_summary` rollups (Monthly/Quarterly/Yearly/Custom). This phase's
spec explicitly lists a *plural* `performance_cycles` table with a different grain
(Daily/Weekly/Monthly/Quarterly/Yearly) for raw data-collection periods. Rather than
overload one table with two different purposes, both tables now exist side by side —
`performance_cycle` for KPI rollup periods, `performance_cycles` for Daily Entry
periods. No existing table was modified to make room for this.

```
performance_data_sources                [5 seeded: Manual Entry, Bulk Entry, Future
                                          API/Billing/Attendance Entry — a lookup
                                          table, not hardcoded, same convention as
                                          task_frequency / task_status]
performance_cycles                       [distinct from performance_cycle — see 6.1]

metric_master                            [company_id null = system default metric;
                                           category is a Postgres enum (14 values from
                                           the spec) rather than a separate lookup
                                           table, since it wasn't in this phase's
                                           explicit CREATE TABLES list]

metric_mapping                           [Metric -> Role -> Department -> Store ->
                                           Employee(optional); a check constraint
                                           requires at least one scope to be set]

employees (N) --< performance_entries >-- (N) metric_master
  [the Daily Entry / Bulk Entry data itself. employee_id is nullable — a null
   employee_id means a store-wide value. Two partial unique indexes enforce "no
   duplicate entry for same employee, metric and date": one keyed on
   (employee_id, metric_id, entry_date) where employee_id is not null, one keyed on
   (store_id, metric_id, entry_date) where employee_id is null.]

performance_entries (1) -- (N) metric_approval
  [Entry -> Verifier -> Approved -> Locked, foundation only. Approving an entry also
   sets performance_entries.is_locked = true; a locked entry cannot be edited,
   deleted, or re-verified — enforced in performanceEntryService / metricApprovalService.]
performance_entries (1) -- (N) metric_comments
performance_entries (1) -- (N) metric_history
  [auto-populated by trigger on every insert/update: 'created', 'updated' (only when
   entry_value actually changes), 'approved', 'rejected', 'locked' — independent of
   the generic audit_logs table, so "editing with audit history" always has a record]

metric_target / metric_actual            [flexible-grain foundation tables mirroring
                                           kpi_target / kpi_actual from Phase 1 Part 4,
                                           generalized to any metric. Schema only —
                                           "Do NOT calculate performance."]

performance_daily_summary / performance_monthly_summary
employee_daily_metrics / employee_role_metrics
store_daily_metrics / department_daily_metrics
  [rollup/summary foundation tables — structure only, not populated by this phase's
   application code. A future Performance Calculation engine writes to these; this
   phase only guarantees the shape exists and is queryable.]

future_ai_metrics                        [append-only event log a future AI
                                          Analytics engine can read from without a
                                          new table of its own]
```

### 6.2 Validation rules enforced

- **No duplicate entry for same employee, metric and date** — the two partial unique
  indexes above, backed up by `performanceEntryService.hasEntryForDate()` before
  insert.
- **Prevent future date entry** — `performanceEntryService.create()` rejects any
  `entryDate` after today, checked in the application layer (dates are user-editable
  input, not something a database CHECK constraint can validate against "now"
  reliably across timezones).
- **Prevent editing locked data** — `performanceEntryService.update()` and `.remove()`
  both check `is_locked` before touching a row; approving an entry sets
  `is_locked = true` and the UI disables Edit/Delete accordingly.
- **Support editing with audit history** — every edit fires the `metric_history`
  trigger automatically; no service method can bypass it.

## 7. Row Level Security summary

Every table follows one of two patterns:

- **Global lookup / master template** (`master_teams`, `role_categories`,
  `role_status`, `kpi_categories`, `performance_rating`, `task_categories`,
  `task_frequency`, `task_status`, `performance_data_sources`): readable by any
  authenticated user, writable only by `super_admin`.
- **Company-scoped** (`stores`, `employees`, `roles`, `kpi_master`, `task_master`,
  `metric_master`, `employee_kpi_assignment`, `employee_task_assignment`,
  `performance_entries`, …): a row with `company_id = null` is a system default
  visible to everyone; otherwise visible only to `super_admin` or members of that
  same company (`current_user_company_id()`).

Helper functions used throughout: `public.is_super_admin()`,
`public.current_user_company_id()` (defined in `0005_row_level_security.sql`).
