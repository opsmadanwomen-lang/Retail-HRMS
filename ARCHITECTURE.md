# ARCHITECTURE.md

## 1. Stack

React 18 + TypeScript + Vite + Tailwind CSS + shadcn-style components + Supabase
(Postgres, Auth, Storage, RLS). TanStack Query for server state, React Hook Form + Zod
for forms/validation, React Router for routing.

## 2. Folder structure

```
src/
  components/
    ui/           shadcn-style primitives (button, card, dialog, table, tabs, ...)
    common/        cross-module reusable pieces (PageHeader, ConfirmDialog, LoadingState,
                    EmptyState) - every module reuses these, none reimplement them
  layouts/         DashboardLayout, Sidebar, Header
  router/          AppRouter (route table), ProtectedRoute
  providers/       AppProviders (QueryClientProvider, BrowserRouter, AuthProvider, Toaster)
  contexts/        AuthContext (session/profile state)
  hooks/           one file per concern, thin TanStack Query wrappers around services
  services/        one file per table/domain - all Supabase reads/writes live here,
                    nothing else touches `supabase` directly except hooks that need a
                    raw aggregate query (dashboard stats)
  types/           database.types.ts (hand-authored Row types mirroring the SQL schema)
                    + one domain file per module (employee.ts, role.ts, kpi.ts, ...)
  modules/         one folder per business module: schema.ts (Zod), components/, pages/
  pages/            top-level pages that don't belong to a single module (dashboard)
  lib/             supabaseClient, queryClient, utils (cn, formatDate, initialsFromName)
  constants/       routes.ts (single source of truth for every path)
```

## 3. Layering rule

```
Page component
  -> hook (TanStack Query: useQuery / useMutation)
    -> service (plain async function, talks to Supabase, maps snake_case -> camelCase)
      -> Supabase (Postgres + RLS)
```

Pages never call `supabase` directly. Hooks never contain business logic beyond query
keys and cache invalidation. Services never import React. This is consistent across
every phase (Company/Store -> Employee -> Role -> KPI) and is what makes each new
module "reuse existing architecture" rather than invent its own pattern.

## 4. Multi-tenancy model

Every company-scoped table carries `company_id`. Two conventions recur everywhere:

- **System vs. custom records**: `company_id = null` means a system-provided default
  (master designations, default roles, default KPIs, default performance ratings) that
  every company sees; a non-null `company_id` scopes a custom record to one company.
  Enforced by RLS, not application code - the client can't accidentally leak another
  company's data even with a bug in a query.
- **Soft-delete via partial unique indexes**: nothing in the operational layer
  (`employee_roles`, `role_kpi_mapping`, `employee_kpi_assignment`) hard-deletes;
  everything sets `is_active = false` or `removed_at = now()`. Uniqueness constraints
  are always partial (`WHERE is_active = true` / `WHERE removed_at IS NULL`) so a
  removed record can be re-added later without hitting a stale unique-constraint
  conflict - and full history is preserved for `employee_role_history`, transfer/
  promotion history, and `kpi_weightage` versioning.

## 5. Auto-derivation, not manual entry

Three places compute one field from another so the UI never asks the user to keep two
things in sync manually:

1. **Store provisioning** (`0003`): inserting a store copies the entire master org
   template into store-scoped tables via trigger.
2. **Employee org hierarchy** (`0006`): setting `employees.store_designation_id`
   auto-derives `store_team_id` / `store_department_id` via trigger - the Employee
   Import auto-mapping feature relies on this.
3. **Role/KPI sync**: `employeeKpiService.syncFromRole()` reads `role_kpi_mapping` for
   a role an employee holds and materializes `employee_kpi_assignment` rows - exposed
   as an explicit "Sync from Roles" action on the Employee Profile's KPIs tab (not a
   silent trigger), so a Company Admin always sees what changed and when.

## 6. Additive-only extension across phases

Every phase after Part 1 followed the same rule: **new tables and new files, plus
small, explicit, additive edits to a short list of already-completed files** (Sidebar
nav array, DashboardPage sections, one new Employee Profile tab, routes.ts). No
completed page, service, or hook was rewritten. This is why, five phases in, Company/
Store/Employee management still behave exactly as they did after Part 1 - every
delivery in this project's history re-verified that with an automated import/export
consistency scan before shipping.

Storage follows the same additive rule: `employee-documents` (Phase 1 Part 2) and
`task-attachments` (Phase 1 Part 5) are two independent private Supabase Storage
buckets, each with its own RLS policies scoped by a `{company_id}/...` path prefix —
adding the second bucket required no changes to the first.

Phase 1 Part 6 (Performance Data Collection Engine) is deliberately a pure
**collection** layer: `performance_entries` and its supporting tables only capture
data — no service function in this phase computes a score, a rating, or a rollup.
Where a table name from this phase's spec collided conceptually with an existing
table (`performance_cycles` vs. the Part 4 `performance_cycle`), both were kept as
separate tables with separate purposes rather than merging them, since merging would
have required modifying a completed module's schema. See `DATABASE.md` §6.1 for the
full reasoning.

## 7. Where each future module plugs in

| Future module | Reads from |
|---|---|
| Performance Management System | `performance_summary`, `kpi_result`, `performance_cycle`, `task_score`, `performance_entries`, `metric_target` |
| Appraisal | `performance_summary.overall_rating_id`, `future_performance_history`, `future_task_performance_mapping`, `future_ai_metrics` |
| Promotion | `employee_role_history`, `performance_summary`, `future_performance_history` |
| Training | `kpi_master` where `category_id` = Training, `employee_kpi_assignment`, `task_categories` where `name` = Training, `metric_master` where `category` = training |
| Incentive | `kpi_result.weighted_score`, `performance_summary.overall_score`, `task_score.final_score`, `metric_actual` |
| Attendance | `employee_task_assignment.due_date`/`due_time`, `task_submission.completion_time`, `metric_master` where `category` = attendance, `performance_entries` |
| Payroll | `performance_entries` (Present/Absent/Late Coming/Leave metrics), `employee_daily_metrics` |
| Audit | `task_verification`, `task_history`, `audit_logs`, `metric_master` where `category` = audit |
| AI Recommendation Engine | all of the above, plus `future_performance_history.payload`, `future_task_performance_mapping.payload`, and `future_ai_metrics.payload` (all jsonb, open-ended) |

None of these are implemented; the schema is shaped so they can be built as new
services/pages without altering anything documented here.
