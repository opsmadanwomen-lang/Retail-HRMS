# Retail HRMS

Enterprise Retail Store Management & HRMS — a multi-company, multi-store,
database-driven platform covering organization structure, employee
lifecycle, attendance, leave, staff advances, payroll, and role-based access
control.

This project has grown well beyond its original foundation and is now in
active **Phase 5** development. The sections below describe the system as it
currently exists in this repository — nothing here is aspirational.

---

## 1. Project Overview

Retail HRMS is built around a Master Organization Template: a company
defines its Team → Department → Designation structure once, and every new
store it creates is automatically provisioned with that same structure by a
database trigger — no manual per-store setup. On top of that organizational
foundation, the application layers a full employee lifecycle (onboarding,
documents, transfers, exits), Attendance, Leave, Staff Advances, Payroll, and
a database-enforced, dynamically configurable permission system.

## 2. Technology Stack

React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui-style components ·
Supabase (Postgres + Auth + Storage + Row-Level Security) · TanStack Query ·
React Hook Form + Zod · React Router · Recharts · Lucide React

**Architecture**: `Page component → hook (TanStack Query) → service (Supabase
data access) → Supabase (Postgres + RLS)`. Every company-scoped table carries
`company_id`, enforced by Row-Level Security — not just filtered in the UI.

**Project structure**:
```
src/
  modules/     # One folder per business module (companies, stores, organization,
               # employees, roles, kpi, tasks, performance-data, shifts,
               # attendanceRules, attendance, leave, payroll, advance, settings, staff)
  pages/       # Route-level screens not owned by a single module (auth, dashboard, reports)
  hooks/       # TanStack Query hooks, one file per domain
  services/    # Supabase data-access layer, one file per table/domain
  components/  # ui/ (shadcn-style primitives) + common/ (shared page pieces)
  lib/         # Supabase client, query client, utilities
  types/       # database.types.ts + domain types
  router/      # AppRouter + route guards
supabase/
  migrations/  # Numbered SQL migrations, applied in strict numeric order (185 files currently)
  functions/   # Supabase Edge Functions
```

Full architectural detail lives in `ARCHITECTURE.md` and `DATABASE.md`.
Those two files were last fully refreshed earlier in the project's history;
`CHANGELOG.md` and `MODULE.md` are the currently maintained references for
what has shipped since.

## 3. Authentication / Roles & Permissions

Authentication is handled by Supabase Auth. The application defines five
roles (`app_role`): **Super Admin**, **Company Admin**, **Store Manager**,
**Department Manager**, and **Staff**.

- **Super Admin** — full cross-company access; manages the Master
  Organization Template and all system configuration.
- **Company Admin** — scoped to their own company: stores, organization,
  employees, and most module configuration.
- **Store Manager / Department Manager** — scoped operational roles for
  store- and department-level management.
- **Staff** — a separate, simplified Staff Panel: personal Dashboard,
  Attendance, Leave, Advances, Payslips & Documents, Profile, and (for those
  holding an operational responsibility such as Operations Manager or Night
  Duty approver) their own approval inboxes.

On top of these base roles, a **Dynamic Role & Permission System** lets a
Super Admin configure, per role or per individual user, which modules, tabs,
actions, and sensitive fields are accessible. This is enforced server-side by
RESTRICTIVE Row-Level Security policies on the database — not just hidden in
the UI — so a denied action is rejected even if someone reaches the route
directly.

## 4. Employee Management

- Employee master record with a tabbed Profile screen (Profile, Employment,
  Documents, Reporting, Timeline, Activity, Notes, and more added by later
  phases)
- Employee Import (CSV/XLSX) with auto-mapping against a store's existing
  organization structure, a manual mapping fallback, and import history
- Search & filters by store, department, designation, status, and joining
  date
- Reporting structure (manager / direct reports)
- Employee Transfers, Promotions, and Exit Requests, each with their own
  history trail
- Role Assignment — an independent "Additional Roles" responsibility system
  on top of an employee's primary designation, with full assignment history

## 5. Store / Organization Structure

- Company and Store management (CRUD)
- Master Organization Template: Teams, Departments, and Designations,
  defined once and data-driven (never hardcoded in the UI)
- Automatic store provisioning — creating a store triggers a database
  function that copies the current master template into that store's own
  Team/Department/Designation structure, with zero manual setup
- Organization Tree — an expandable view of any store's resulting structure

## 6. Employee Documents

Per-employee document upload, download, and management, stored in a private
Supabase Storage bucket (`employee-documents`) scoped by company through
Storage-level RLS policies. A second, independent bucket (`task-attachments`)
backs file attachments on the Task module.

## 7. Attendance

- Attendance tracking with Paytime and mobile attendance capture, plus
  attendance import
- Shift Management and Employee Schedule configuration
- Configurable Attendance Rules: late coming, overtime, weekly off, half-day,
  early-going, extended duty, and night duty
- Night Duty approval workflow for Operations Managers / Super Managers
- Attendance Reports
- Configurable OT/Late wage basis and day-divisor — these are policy
  configuration, not hard-coded calculation constants

## 8. Leave Management

- Leave application, balance tracking, and a Manager / Super-Manager
  approval workflow
- Configurable Leave Policy Engine: financial years, leave types, accrual,
  probation rules, and carry-forward
- Leave Settlement: prior notice, encashment, lapse, and financial-year
  closing
- Additive integration with the Attendance Calendar — an approved leave is
  reflected on an employee's attendance view without writing into or
  altering any attendance record or calculation
- A 15-report Leave Reports module: ledger, balances, store-wise,
  department-wise, monthly, short/long leave, pending, approvals,
  encashment, lapse, financial-year closing, probation, policy changes, and
  an audit trail

## 9. Advance Management

- Staff-facing advance request submission and status/history tracking
- Multi-tier decision workflow: Reporting Manager / Final Approver decision,
  HR processing, Finance payment/disbursement, and payroll-linked recovery
  (installment schedule, early settlement, closure)
- An operational, staff-wise Advance Ledger and a unified Advance Workflow
  screen consolidating the HR/Finance panel views
- Configurable Advance Types, Policies, approval hierarchy, and HR/Finance
  processor rosters

## 10. Payroll

- Monthly Payroll run and Salary Slips
- PF/ESI component amount configuration
- Full & Final (F&F) settlement, with a configurable exit / notice-pay
  policy (period, recovery basis, divisor, waiver)
- Payroll Reports

## 11. Salary Structures / Salary Components / Employee Salary

- Salary Structures and reusable Salary Components, with policy-driven
  inheritance so common components don't need to be redefined per structure
- Per-employee Salary assignment, editable subject to permission
- Configurable OT/Late hourly wage basis and day-divisor policy (see
  Attendance above — the same configuration drives both attendance
  calculation and payroll)

## 12. Reports

- A central Reports hub linking into every module-specific report set
- Attendance Reports, the 15-report Leave Reports module, and Payroll
  Reports (see their respective sections above)

## 13. Deployment / Development Setup

### 13.1 Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Apply every file in `supabase/migrations/` in numeric order — either
   through the SQL Editor, or with the Supabase CLI:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. Create your first user in **Authentication → Users**, then insert a
   matching profile:
   ```sql
   insert into public.profiles (id, full_name, email, role, company_id)
   values ('<auth-user-uuid>', 'Your Name', 'you@company.com', 'super_admin', null);
   ```
   `role` accepts `super_admin`, `company_admin`, `staff`, `store_manager`,
   or `department_manager` — use a real `company_id` for any non-`super_admin`
   role.

### 13.2 Frontend

```bash
npm install
cp .env.example .env
# edit .env with your Supabase project URL + anon key
npm run dev
```

The app runs at `http://localhost:5173`. Unauthenticated visitors are
redirected to `/login`.

### 13.3 Type generation (optional, recommended once linked)

```bash
supabase gen types typescript --linked > src/types/database.types.ts
```
This repo ships a hand-written `database.types.ts` sufficient to build
against; regenerating against your live project keeps types in sync as the
schema evolves.

### 13.4 Build & Deployment

```bash
npm run build   # tsc -b && vite build
```

The repository includes a `vercel.json` with the SPA rewrite (`/(.*)` →
`/index.html`) required for client-side routing on Vercel. The frontend
reads its Supabase connection from two build-time environment variables,
which must be set in your deployment platform (e.g. Vercel Project Settings
→ Environment Variables) as standard, directly-valued variables:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Neither is included in this repository — `.env` is git-ignored, and no
credentials are hard-coded anywhere in source.

## 14. Current Project Status

Retail HRMS is in active, ongoing development (Phase 5). The system has
moved far past its original Company/Store foundation into a full
multi-module HRMS: Employee Lifecycle, Attendance, Leave (with reporting),
Advance Management, Payroll, and a Dynamic Role & Permission System are all
implemented in this repository today, not merely planned. A KPI / Task /
Performance-data foundation layer is also implemented, intended to support
future performance calculation, promotion, training, and incentive modules
that are not yet built.

- `CHANGELOG.md` — full phase-by-phase delivery history.
- `MODULE.md` — documents the most recently delivered module in detail.
- `ARCHITECTURE.md` / `DATABASE.md` — cross-cutting design and schema
  reference; accurate for the concepts they describe, though not refreshed
  for every migration added since (see `MODULE.md` for specifics).

No claim of production testing is made here. Verify your own build output,
environment configuration, and deployment before relying on any particular
environment.
