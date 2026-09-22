# Retail HRMS — Phase 1 Part 1

Enterprise Retail Store Management & HRMS foundation. Multi-company, multi-store,
database-driven organization structure with automatic store provisioning.

This delivery covers **only** Phase 1 Part 1, per the specification:

- Project setup & folder structure
- Supabase authentication
- Database foundation (companies, stores, master template, store structure, employees, audit logs)
- Company module (CRUD)
- Store module (CRUD)
- Master Organization Template (fully data-driven, seeded via SQL)
- Automatic Store Structure Creation (Postgres trigger, zero manual setup)
- Dashboard layout with stats, recent stores, quick actions
- Organization Tree (expand/collapse, Team → Department → Designation)

Staff Management, KPI, Attendance, Leave, Payroll, Incentives, Performance, Tasks,
and Reports are intentionally **not** included — they are scoped for Phase 1 Part 2 onward.

---

## 1. Tech Stack

React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui-style components ·
Supabase (Postgres + Auth + Storage + Realtime) · TanStack Query · React Hook Form + Zod ·
React Router · Recharts · Lucide React

## 2. Folder Structure

```
src/
  components/       # ui/ (shadcn-style primitives) + common/ (PageHeader, EmptyState, ConfirmDialog…)
  layouts/          # DashboardLayout, AuthLayout + Sidebar/Header/Breadcrumbs
  pages/            # Route-level screens that aren't a dedicated module (login, dashboard, settings)
  modules/          # Independent, self-contained feature modules
    companies/       (schema, components, pages)
    stores/          (schema, components, pages)
    organization/    (components, pages)
  hooks/            # TanStack Query hooks per domain
  services/         # Supabase data-access layer (one file per table/domain)
  lib/              # supabase client, query client, cn() utility
  types/            # Hand-authored types mirroring the DB schema + domain types
  constants/        # Route path constants
  contexts/         # AuthContext
  providers/        # AppProviders (Query/Router/Auth/Toaster composition), AuthProvider
  router/           # AppRouter + ProtectedRoute
supabase/
  migrations/       # Numbered, idempotent-order SQL migrations (schema → seed → provisioning → audit → RLS)
```

Every module is independent: a module's pages only import its own `components/` and `schema.ts`,
plus shared `hooks/`, `services/`, and `components/ui`.

## 3. Database Schema

Run the migrations in `supabase/migrations/` **in order**:

| File | Purpose |
|---|---|
| `0001_init_schema.sql` | Tables, enums, indexes, FKs, `updated_at` triggers |
| `0002_seed_master_template.sql` | Seeds the Master Organization Template (Frontend/Backend teams, departments, designations) exactly as specified — nothing is hardcoded in the UI |
| `0003_auto_store_provisioning.sql` | `provision_store_organization()` trigger: fires `AFTER INSERT` on `stores` and copies the entire master template into `store_teams` / `store_departments` / `store_designations`. Also exposes `get_store_organization_tree(store_id)` RPC used by the Organization Tree screen |
| `0004_audit_logging.sql` | Generic `write_audit_log()` trigger attached to `companies`, `stores`, `employees` |
| `0005_row_level_security.sql` | RLS enabled on every table; `super_admin` sees everything, `company_admin` is scoped to their own `company_id` |

### How automatic store provisioning works

```
INSERT INTO stores (...)
        │
        ▼ (AFTER INSERT trigger)
provision_store_organization()
        │
        ├─ copy every active master_team   → store_teams
        ├─ copy every active master_department → store_departments
        └─ copy every active master_designation → store_designations
        │
        ▼
store.status → 'active', store.provisioned_at → now()
```

No application code performs this copy — it is guaranteed at the database level,
so it happens identically whether the store is created from the UI, the API, or a script.

## 4. Setup Instructions

### 4.1 Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run each file in `supabase/migrations/` **in numeric order** (0001 → 0005).
   Alternatively, if you use the Supabase CLI:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. Create your first user in **Authentication → Users**, then insert a matching profile:
   ```sql
   insert into public.profiles (id, full_name, email, role, company_id)
   values ('<auth-user-uuid>', 'Your Name', 'you@company.com', 'super_admin', null);
   ```
   (Use `role = 'company_admin'` and a real `company_id` for company-scoped users.)

### 4.2 Frontend

```bash
npm install
cp .env.example .env
# edit .env with your Supabase project URL + anon key
npm run dev
```

The app runs at `http://localhost:5173`. Unauthenticated visitors are redirected to `/login`.

### 4.3 Type generation (optional, recommended once linked)

```bash
supabase gen types typescript --linked > src/types/database.types.ts
```
This repo ships a hand-written `database.types.ts` sufficient to build against; regenerating
against your live project keeps types perfectly in sync as the schema evolves in later phases.

## 5. Roles (Phase 1 Part 1)

- **Super Admin** — full cross-company access, manages the Master Organization Template.
- **Company Admin** — scoped to their own company: manages that company's stores, organization, and (in later phases) employees.

## 6. What's intentionally deferred to Phase 1 Part 2+

Staff Management & Import, KPI, Attendance, Leave, Payroll, Incentives, Performance,
Tasks, Reports, global search, notifications, and theme toggling are stubbed as
disabled/placeholder UI only, and are out of scope for this delivery.

---

## 7. Phase 1 Part 2 — Employee Management Foundation

Builds on Phase 1 Part 1 without modifying any completed module. New migrations only
ALTER/extend existing tables and add new ones; no existing column was dropped or renamed.

### 7.1 New migrations

| File | Purpose |
|---|---|
| `0006_employee_master.sql` | Extends `employees` with full HR fields (name parts, gender, DOB, blood group, mobile numbers, photo, employment/salary type, joining/confirmation dates, reporting manager) plus the `employee_status` enum. Adds the **auto-mapping trigger** (`sync_employee_org_hierarchy`) that derives `store_team_id`/`store_department_id` from `store_designation_id` automatically, and a compatibility trigger that keeps the legacy `is_active` boolean in sync with the new `status` enum so every Phase 1 Part 1 query keeps working unmodified. |
| `0007_employee_documents_transfers_promotions.sql` | `employee_documents` (metadata pointer to Supabase Storage), `employee_transfers` and `employee_promotions` (history tables — data foundation only, no workflow), `employee_import_batches` (import run summaries), the `employee-documents` private Storage bucket, and RLS for all of the above. |
| `0008_employee_notes.sql` | `employee_notes`, backing the Notes tab on the Employee Profile screen. |

Run these after `0001`–`0005`, in order, the same way as before (SQL Editor or `supabase db push`).

### 7.2 What was added to the frontend

- **Employee Master** — `src/modules/employees` (list, create/edit form, profile)
- **Employee Import** — CSV/XLSX upload, validation, auto-mapping against each store's
  existing organization structure, a manual mapping screen for anything that can't be
  auto-resolved, and an import summary (`src/services/employeeImportService.ts`)
- **Employee Profile** — tabs for Profile, Employment, Documents, Reporting, Timeline,
  Activity, and Notes
- **Employee Documents** — upload/download/delete via the private `employee-documents`
  Storage bucket, scoped by company via Storage RLS
- **Search & Filters** — by code/name/mobile/email, and by store/department/designation/
  status/joining date
- **Reporting Structure** — self-referencing `reporting_manager_id`; the Reporting tab
  shows both the manager and direct reports, ready to power a future Org Chart
- **Transfer / Promotion Foundations** — history tables and record-and-move services
  only; no approval workflow, per spec
- **Dashboard** — additive `useEmployeeDashboardStats` hook powers new Active/Inactive,
  Store-wise, Department-wise, and Recently Joined sections appended to the existing
  dashboard layout (nothing already there was redesigned)

Not built in this phase (as specified): Attendance, Leave, Payroll, Role Management,
Performance, KPI, Tasks, Notifications, Reports.

### 7.3 New dependencies

`papaparse` (CSV parsing), `xlsx` (Excel parsing), `@radix-ui/react-tabs` and
`@radix-ui/react-avatar` (Employee Profile UI). Run `npm install` again after pulling
this update.

---

## 8. Phase 1 Part 3 — Role Management Engine

This is a **responsibility** system, not a permissions system. An employee's existing
Primary Designation (`employees.store_designation_id`, from Part 1) is untouched — this
phase adds an independent, unlimited set of **Additional Roles** an employee can hold at
the same time, each one intended to later carry its own KPI, Performance, Tasks, and
Workflow (foundation only; none of those are implemented yet).

### 8.1 New migrations

| File | Purpose |
|---|---|
| `0009_role_management_schema.sql` | `role_categories`, `role_status` (a lookup table, not a hardcoded enum — new statuses can be added with a plain INSERT), `roles` (the Role Master; `company_id = null` means a system default available to every company, set means a company's own custom role), `employee_roles` (current assignments, with a partial unique index that blocks a duplicate *active* assignment of the same role to the same employee), `employee_role_history` (auto-populated by trigger on every assign/remove/status-change — no app code can forget to log it), `role_notes`, and the two explicitly-requested foundation tables `role_permissions_placeholder` and `future_role_kpi_mapping` (structure only, unused by the app). Full RLS on every table. |
| `0010_seed_roles.sql` | Seeds the 4 `role_status` values (Active/Inactive/Temporary/Permanent), the 11 `role_categories`, and all 21 default system roles from the spec. |

Run after `0001`–`0008`, in order.

### 8.2 What was added to the frontend

- **Role Master** (`/roles`) — searchable, filterable data table (Category, Department,
  Store, Status, Employee filters) with a live "Assigned Employees" count per role
- **Role Categories & Role Status** — both database-driven lookups, never hardcoded in
  the UI, consistent with the Master Organization Template from Phase 1 Part 1
- **Role Assignment** (`/roles/assignment`) — pick an employee, then Role → Effective
  Date → End Date (optional) → Status → Save, exactly as specified; also reachable
  inline from the Employee Profile's new **Responsibilities** tab
- **Role History** — every assign/remove/status-change is recorded automatically and
  shown on the Responsibilities tab
- **Validation** — rejects a duplicate active assignment of the same role (enforced at
  both the UI and the database level) and rejects assigning an inactive role
- **Role Dashboard** — additive `useRoleDashboardStats` hook powers new Total/Assigned/
  Unassigned/Temporary/Permanent/Most-Assigned sections appended to the existing
  dashboard (nothing already there was redesigned)

Not built in this phase (as specified): Role Permissions, Role KPI, Role Performance,
Role Task, Role Audit, Role Checklist, Role Training, Role Incentive, Role Approval
Workflow, Attendance, Leave, Payroll, Reports, AI. Their database relationships are
prepared (`role_permissions_placeholder`, `future_role_kpi_mapping`) but nothing reads
from or writes to them yet.

---

## 9. Phase 1 Part 4 — KPI Management Engine

This is the foundation for Performance, Promotion, Training, Appraisal, Incentive, and
a future AI Recommendation Engine — not just KPI tracking. See the new **DATABASE.md**,
**ARCHITECTURE.md**, and **MODULE.md** for full detail; this section is a short pointer.

- **New migrations**: `0011_kpi_management_schema.sql`, `0012_seed_kpi.sql` — run after
  `0001`–`0010`, in order.
- **New pages**: KPI Categories, KPI Master, Role KPI (weightage editor), Performance
  Summary — all in the sidebar. A new **KPIs** tab was added to the Employee Profile
  (alongside the existing Responsibilities tab from Part 3) for per-employee KPI
  assignment, targets, and actuals.
- **Dashboard**: Total/Mapped/Pending KPI, active Performance Cycle, Top Performing
  Roles/KPI — appended below the existing sections, nothing already there was changed.
- **Not built** (schema-only, as specified): Attendance, Payroll, Leave, Appraisal,
  Promotion, Training, Incentive, AI, Notifications, Reports. `future_performance_history`
  is the landing table those future modules can read from without new tables of their own.

See `CHANGELOG.md` for the full list of files touched in this phase.

---

## 10. Phase 1 Part 5 — Task, SOP & Checklist Engine

The operational backbone: Role → Task → SOP (Checklist) → Verification → Completion →
Performance Contribution. See `DATABASE.md`, `ARCHITECTURE.md`, and `MODULE.md` for
full detail; this section is a short pointer. This is Phase 1 Part 5, continuing
directly from Phase 1 Part 4 (KPI Management Engine) above.

- **New migrations**: `0013_task_engine_schema.sql`, `0014_seed_tasks.sql` — run after
  `0001`–`0012`, in order.
- **New pages**: Task Categories, Task Master, Task Templates, Task Assignment,
  Checklist, Task Dashboard — all in the sidebar, plus a Role Task Mapping page
  (linked from Task Master). Four new tabs — **Tasks, SOP, Checklist, History** — were
  added to the Employee Profile.
- **New UI primitive**: `Checkbox` (`@radix-ui/react-checkbox`), used for checklist
  item completion — no other new dependency was needed.
- **Dashboard**: Today's/Pending/Completed/Overdue Tasks, appended below the existing
  sections, with a link through to the full Task Dashboard.
- **Not built** (schema-only, as specified): Attendance, Leave, Payroll, Performance
  Calculation, Audit Engine, Training, Promotion, Incentive, AI, Notifications, Reports.
  `future_task_performance_mapping` is the landing table those future modules can read
  from without new tables of their own.

See `CHANGELOG.md` for the full list of files touched in this phase.

---

## 11. Phase 1 Part 6 — Performance Data Collection Engine

The central data collection system. Every future module (Attendance, Payroll, Leave,
Performance Calculation, Promotion, Training, Audit, Incentive, AI Analytics) reads
from here. **This phase does not calculate performance — it only collects structured
operational data.** See `DATABASE.md`, `ARCHITECTURE.md`, and `MODULE.md` for full
detail; this section is a short pointer.

- **New migrations**: `0015_performance_data_engine_schema.sql`,
  `0016_seed_performance_data.sql` — run after `0001`–`0014`, in order. Reuses the
  existing `performance_cycle` (singular) table from Phase 1 Part 4 where the concepts
  overlap, and adds a distinct `performance_cycles` (plural) table for raw
  data-collection periods — see `DATABASE.md` for why these are deliberately separate.
- **New pages**: Performance Data (metric mapping), Metrics, Daily Entry (manual +
  bulk), Approvals, Performance Dashboard — all in the sidebar.
- **New Employee Profile tab**: **Performance** (Daily Entries + Metric History).
- **New Role Profile addition**: Performance Metrics, on the Role edit screen.
- **New Store Profile addition**: Store Metrics, on the Store edit screen.
- **Dashboard**: Today's/Pending/Approved/Rejected Entries, appended below the
  existing sections, with a link to the full Performance Dashboard.
- **Validation enforced**: no duplicate entry for the same employee/metric/date, no
  future-dated entries, no editing or deleting locked (approved) entries.
- **Not built** (as specified): Attendance, Payroll, Leave, Performance Calculation,
  Promotion, Training, Audit, Incentive, AI, Reports, Notifications.
  `future_ai_metrics` is the landing table those future modules can read from without
  new tables of their own.

See `CHANGELOG.md` for the full list of files touched in this phase.




