import { Navigate, Route, Routes } from "react-router-dom";

import { AuthLayout } from "@/layouts/AuthLayout";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { ProtectedRoute } from "./ProtectedRoute";
import { AdminOnlyRoute } from "./AdminOnlyRoute";
import { RequireModulePermission } from "./RequireModulePermission";

// Auth
import { LoginPage } from "@/pages/auth/LoginPage";
import { ForgotPasswordPage } from "@/pages/auth/ForgotPasswordPage";
import { ChangePasswordPage } from "@/pages/auth/ChangePasswordPage";

// Dashboard
import { DashboardPage } from "@/pages/dashboard/DashboardPage";

// Companies
import { CompaniesPage } from "@/modules/companies/pages/CompaniesPage";
import { CompanyFormPage } from "@/modules/companies/pages/CompanyFormPage";

// Stores
import { StoresPage } from "@/modules/stores/pages/StoresPage";
import { StoreFormPage } from "@/modules/stores/pages/StoreFormPage";

// Employees
import { EmployeesPage } from "@/modules/employees/pages/EmployeesPage";
import { EmployeeFormPage } from "@/modules/employees/pages/EmployeeFormPage";
import { EmployeeProfilePage } from "@/modules/employees/pages/EmployeeProfilePage";
import { EmployeeImportPage } from "@/modules/employees/pages/EmployeeImportPage";
import { EmployeeDocumentsPage } from "@/modules/employees/pages/EmployeeDocumentsPage";
import { ExitRequestsPage } from "@/modules/employees/pages/ExitRequestsPage";
import { EmployeeTransfersPage } from "@/modules/employees/pages/EmployeeTransfersPage";

// Roles
import { RolesPage } from "@/modules/roles/pages/RolesPage";
import { RoleFormPage } from "@/modules/roles/pages/RoleFormPage";
import { RoleAssignmentPage } from "@/modules/roles/pages/RoleAssignmentPage";

// KPI
import { KpiCategoriesPage } from "@/modules/kpi/pages/KpiCategoriesPage";
import { KpiMasterPage } from "@/modules/kpi/pages/KpiMasterPage";
import { KpiFormPage } from "@/modules/kpi/pages/KpiFormPage";
import { RoleKpiPage } from "@/modules/kpi/pages/RoleKpiPage";
import { PerformanceSummaryPage } from "@/modules/kpi/pages/PerformanceSummaryPage";

// Tasks
import { TaskCategoriesPage } from "@/modules/tasks/pages/TaskCategoriesPage";
import { TaskMasterPage } from "@/modules/tasks/pages/TaskMasterPage";
import { TaskFormPage } from "@/modules/tasks/pages/TaskFormPage";
import { TaskTemplatesPage } from "@/modules/tasks/pages/TaskTemplatesPage";
import { RoleTaskPage } from "@/modules/tasks/pages/RoleTaskPage";
import { TaskAssignmentPage } from "@/modules/tasks/pages/TaskAssignmentPage";
import { ChecklistsPage } from "@/modules/tasks/pages/ChecklistsPage";
import { TaskDashboardPage } from "@/modules/tasks/pages/TaskDashboardPage";

// Performance
import { MetricsPage } from "@/modules/performance-data/pages/MetricsPage";
import { MetricFormPage } from "@/modules/performance-data/pages/MetricFormPage";
import { PerformanceDataPage } from "@/modules/performance-data/pages/PerformanceDataPage";
import { DailyEntryPage } from "@/modules/performance-data/pages/DailyEntryPage";
import { ApprovalsPage } from "@/modules/performance-data/pages/ApprovalsPage";
import { PerformanceDashboardPage } from "@/modules/performance-data/pages/PerformanceDashboardPage";

// Organization
import { OrganizationPage } from "@/modules/organization/pages/OrganizationPage";

// Attendance
import { AttendancePage } from "@/modules/attendance/pages/AttendancePage";
import { AttendanceImportPage } from "@/modules/attendance/pages/AttendanceImportPage";

// Staff Panel
import { StaffDashboardPage } from "@/modules/staff/pages/StaffDashboardPage";
import { StaffApprovalsPage } from "@/modules/staff/pages/StaffApprovalsPage";
import { StaffNightDutyApprovalPage } from "@/modules/staff/pages/StaffNightDutyApprovalPage";
import { StaffLeavePage } from "@/modules/staff/pages/StaffLeavePage";
import { StaffPayslipDocumentsPage } from "@/modules/staff/pages/StaffPayslipDocumentsPage";
import { StaffProfilePage } from "@/modules/staff/pages/StaffProfilePage";

// Shift & Weekly Off Management
import { ShiftMasterPage } from "@/modules/shifts/pages/ShiftMasterPage";
import { EmployeeSchedulePage } from "@/modules/shifts/pages/EmployeeSchedulePage";
import { AttendanceRuleManagementPage } from "@/modules/attendanceRules/pages/AttendanceRuleManagementPage";
import { NightDutyApprovalsPage } from "@/modules/attendanceRules/pages/NightDutyApprovalsPage";
import { NightDutyManagerAccessPage } from "@/modules/attendanceRules/pages/NightDutyManagerAccessPage";

// Leave Management
import { LeavePolicyManagementPage } from "@/modules/leave/pages/LeavePolicyManagementPage";
import { LeaveApprovalsPage } from "@/modules/leave/pages/LeaveApprovalsPage";
import { LeaveSettlementPage } from "@/modules/leave/pages/LeaveSettlementPage";
import { LeaveReportsPage } from "@/modules/leave/pages/LeaveReportsPage";

// Advance Management (Phase 1)
import { AdvanceManagementPage } from "@/modules/advance/pages/AdvanceManagementPage";
import { StaffAdvanceRequestPage } from "@/modules/advance/pages/StaffAdvanceRequestPage";
import { StaffMyAdvancesPage } from "@/modules/advance/pages/StaffMyAdvancesPage";
import { AdvanceApprovalsPage } from "@/modules/advance/pages/AdvanceApprovalsPage";
import { HrAdvanceProcessingPage } from "@/modules/advance/pages/HrAdvanceProcessingPage";
import { FinanceAdvancePaymentPage } from "@/modules/advance/pages/FinanceAdvancePaymentPage";
import { AdvanceRecoveryPage } from "@/modules/advance/pages/AdvanceRecoveryPage";
import { AdvanceLedgerPage } from "@/modules/advance/pages/AdvanceLedgerPage";
import { AdvanceWorkflowPage } from "@/modules/advance/pages/AdvanceWorkflowPage";

// Payroll (Phase 5)
import { PayrollPage } from "@/modules/payroll/pages/PayrollPage";
import { PayrollComponentAmountsPage } from "@/modules/payroll/pages/PayrollComponentAmountsPage";
import { FnfPage } from "@/modules/payroll/pages/FnfPage";
import { FnfDetailPage } from "@/modules/payroll/pages/FnfDetailPage";
import { ExitFnfSettingsPage } from "@/modules/payroll/pages/ExitFnfSettingsPage";
import { PayrollSettingsPage } from "@/modules/payroll/pages/PayrollSettingsPage";

// Settings
import { SettingsPage } from "@/pages/dashboard/SettingsPage";
import { UserManagementPage } from "@/modules/settings/pages/UserManagementPage";
import { PermissionManagementPage } from "@/modules/settings/pages/PermissionManagementPage";

// Reports (operational reporting hub)
import { ReportsPage } from "@/pages/dashboard/ReportsPage";

export function AppRouter() {
  return (
    <Routes>
      {/* Login */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/* Protected Application */}
      <Route element={<ProtectedRoute />}>
        {/* Outside DashboardLayout on purpose: a forced password change has no sidebar/nav access yet. */}
        <Route path="/change-password" element={<ChangePasswordPage />} />

        <Route element={<DashboardLayout />}>
          {/* Attendance — the ONLY area a 'staff' role account may reach. Deliberately outside
              the AdminOnlyRoute guard below. */}
          <Route path="/attendance" element={<AttendancePage />} />

          {/* Night Duty Approvals — deliberately OUTSIDE AdminOnlyRoute. Operations Managers and
              Super Managers are individual 'staff' role logins (see NightDutyManagerAccessPage);
              they must be able to reach this page. The page itself role-detects (OM store
              assignment / Super Manager designation / Super Admin oversight) and shows an
              access-denied state to anyone with none of those — and every decision RPC
              (attendance_night_duty_om_decide / _super_manager_decide) re-enforces authorization
              server-side regardless of what this route allows through. */}
          <Route path="/attendance/night-duty-approvals" element={<NightDutyApprovalsPage />} />

          {/* Leave Approvals — deliberately OUTSIDE AdminOnlyRoute, same reasoning as
              /attendance/night-duty-approvals above: Direct Manager authority is resolved from
              employees.reporting_manager_id and Super Manager authority from the SAME
              attendance_super_managers table Night Duty uses — both are individual 'staff' role
              logins. The page role-detects and shows an access-denied state to anyone with
              neither, and every decision RPC (leave_manager_decide / leave_super_manager_decide)
              re-enforces authorization server-side regardless of what this route allows through. */}
          <Route path="/leave/approvals" element={<LeaveApprovalsPage />} />

          {/* Advance Approval — deliberately OUTSIDE AdminOnlyRoute, same reasoning as
              /leave/approvals: Reporting-Manager authority is resolved from
              employees.reporting_manager_id and Final-Approver (Boss) authority from the
              advance_final_approvers roster — both are individual 'staff' role logins. The page
              role-detects and every decision RPC (advance_manager_decide / advance_boss_decide)
              re-enforces authorization server-side regardless of what this route allows through. */}
          <Route path="/advance/approvals" element={<AdvanceApprovalsPage />} />

          {/* HR Advance Processing (Phase 2) — deliberately OUTSIDE AdminOnlyRoute, same reasoning as
              /advance/approvals above: HR authority is held by individual 'staff' logins
              (advance_hr_processors) and every mutating RPC (advance_hr_process/_hold/_send_back)
              re-enforces it server-side. HR is NOT an approval level — this page has no
              Approve/Reject control anywhere. */}
          <Route path="/advance/hr-processing" element={<HrAdvanceProcessingPage />} />

          {/* Finance Advance Payment (Phase 3) — deliberately OUTSIDE AdminOnlyRoute, same reasoning
              as /advance/hr-processing: Finance authority is held by individual 'staff' logins
              (advance_finance_processors) and every mutating RPC (advance_finance_start/_pay/_hold/
              _resume) re-enforces it server-side. Finance is NOT an approval level — no Approve/
              Reject control anywhere on this page. */}
          <Route path="/advance/finance-payment" element={<FinanceAdvancePaymentPage />} />

          {/* Advance Recovery (Phase 4) — payroll recovery / installments / settlement / closure.
              Deliberately OUTSIDE AdminOnlyRoute, same reasoning as /advance/finance-payment: it
              reuses the advance_finance_processors roster and every mutating RPC
              (advance_recovery_generate_plan / _run_period / _settle / _close / ...) re-enforces
              authority server-side. */}
          <Route path="/advance/recovery" element={<AdvanceRecoveryPage />} />

          {/* HR Panel consolidation — ONE unified "Approvals -> Advance" workflow screen,
              replacing four separate Approvals cards (Advance Approval / HR Advance Processing /
              Finance Advance Payment / Advance Recovery) with one. Deliberately OUTSIDE
              AdminOnlyRoute, same reasoning as the four routes above: Manager/Boss/HR/Finance
              authority is held by individual 'staff' logins and every action still goes through
              the EXACT SAME existing RPCs those four pages call — this page only composes them. */}
          <Route path="/advance/workflow" element={<AdvanceWorkflowPage />} />

          {/* Staff Panel — Dashboard, Leave, Payslip & Documents, Profile. Deliberately OUTSIDE
              AdminOnlyRoute, same as /attendance above: every authenticated role (an Admin is also,
              personally, an employee) can reach their own personal pages here. Each page resolves
              "which employee" itself via useCurrentEmployee(user...) — never a URL/route param — so
              there is no way to view another employee's data through these routes. */}
          <Route path="/dashboard" element={<StaffDashboardPage />} />
          <Route path="/leave" element={<StaffLeavePage />} />
          <Route path="/advance/request" element={<StaffAdvanceRequestPage />} />
          <Route path="/advance/my-advances" element={<StaffMyAdvancesPage />} />
          <Route path="/payslip" element={<StaffPayslipDocumentsPage />} />
          <Route path="/profile" element={<StaffProfilePage />} />
          <Route path="/approvals" element={<StaffApprovalsPage />} />
          <Route path="/approvals/night-duty" element={<StaffNightDutyApprovalPage />} />

          {/* Everything else is admin-only, enforced at the router level, not just hidden in the UI. */}
          <Route element={<AdminOnlyRoute />}>
          {/* Dashboard */}
          <Route path="/" element={<DashboardPage />} />

          {/* Companies */}
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/new" element={<CompanyFormPage />} />
          <Route path="/companies/:id/edit" element={<CompanyFormPage />} />

          {/* Stores */}
          <Route path="/stores" element={<StoresPage />} />
          <Route path="/stores/new" element={<StoreFormPage />} />
          <Route path="/stores/:id/edit" element={<StoreFormPage />} />

          {/* Employees — module-gated (Dynamic Role & Permission System, migration 0161): a role/
              user with VIEW denied for 'employee' is redirected here even on a direct URL; the
              Sidebar link is hidden the same way, and RESTRICTIVE RLS (migration 0162) backs it
              up server-side regardless of what this route guard allows through. */}
          <Route element={<RequireModulePermission module="employee" />}>
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/employees/new" element={<EmployeeFormPage />} />
            <Route
              path="/employees/import"
              element={<EmployeeImportPage />}
            />
            <Route
              path="/employees/:id/edit"
              element={<EmployeeFormPage />}
            />
            <Route
              path="/employees/:id"
              element={<EmployeeProfilePage />}
            />
          </Route>
          <Route element={<RequireModulePermission module="employee_documents" />}>
            <Route path="/employees/documents" element={<EmployeeDocumentsPage />} />
          </Route>
          {/* Employee Exit Request workflow + Employee Transfer module (Phase 2) —
              Finance Processor / Super Admin, same authority as F&F Core. */}
          <Route element={<RequireModulePermission module="exit_request" />}>
            <Route path="/employees/exit-requests" element={<ExitRequestsPage />} />
          </Route>
          <Route element={<RequireModulePermission module="employee_transfer" />}>
            <Route path="/employees/transfers" element={<EmployeeTransfersPage />} />
          </Route>

          {/* Roles */}
          <Route path="/roles" element={<RolesPage />} />
          <Route path="/roles/new" element={<RoleFormPage />} />
          <Route
            path="/roles/assignment"
            element={<RoleAssignmentPage />}
          />
          <Route
            path="/roles/:id/edit"
            element={<RoleFormPage />}
          />

          {/* KPI */}
          <Route
            path="/kpi/categories"
            element={<KpiCategoriesPage />}
          />
          <Route
            path="/kpi/role-kpi"
            element={<RoleKpiPage />}
          />
          <Route
            path="/kpi/performance-summary"
            element={<PerformanceSummaryPage />}
          />
          <Route path="/kpi/new" element={<KpiFormPage />} />
          <Route
            path="/kpi/:id/edit"
            element={<KpiFormPage />}
          />
          <Route path="/kpi" element={<KpiMasterPage />} />

          {/* Tasks */}
          <Route
            path="/tasks/categories"
            element={<TaskCategoriesPage />}
          />
          <Route
            path="/tasks/templates"
            element={<TaskTemplatesPage />}
          />
          <Route
            path="/tasks/role-task"
            element={<RoleTaskPage />}
          />
          <Route
            path="/tasks/assignment"
            element={<TaskAssignmentPage />}
          />
          <Route
            path="/tasks/checklist"
            element={<ChecklistsPage />}
          />
          <Route
            path="/tasks/dashboard"
            element={<TaskDashboardPage />}
          />
          <Route path="/tasks/new" element={<TaskFormPage />} />
          <Route
            path="/tasks/:id/edit"
            element={<TaskFormPage />}
          />
          <Route path="/tasks" element={<TaskMasterPage />} />

          {/* Performance Data */}
          <Route
            path="/performance-data"
            element={<PerformanceDataPage />}
          />
          <Route
            path="/performance-data/metrics/new"
            element={<MetricFormPage />}
          />
          <Route
            path="/performance-data/metrics/:id/edit"
            element={<MetricFormPage />}
          />
          <Route
            path="/performance-data/metrics"
            element={<MetricsPage />}
          />
          <Route
            path="/performance-data/daily-entry"
            element={<DailyEntryPage />}
          />
          <Route
            path="/performance-data/approvals"
            element={<ApprovalsPage />}
          />
          <Route
            path="/performance-data/dashboard"
            element={<PerformanceDashboardPage />}
          />

          {/* Organization */}
          <Route
            path="/organization"
            element={<OrganizationPage />}
          />
          <Route
            path="/organization/:storeId"
            element={<OrganizationPage />}
          />

          {/* Attendance Import is admin-only (unlike /attendance itself, guarded above it) */}
          <Route path="/attendance/import" element={<AttendanceImportPage />} />

          {/* Shift & Weekly Off Management — module-gated per migration 0164. */}
          <Route element={<RequireModulePermission module="shift_management" />}>
            <Route path="/shifts" element={<ShiftMasterPage />} />
          </Route>
          <Route element={<RequireModulePermission module="employee_schedule" />}>
            <Route path="/schedule" element={<EmployeeSchedulePage />} />
          </Route>

          {/* Attendance Rule Management — Super Admin only; AdminOnlyRoute above excludes staff
              entirely, the page component itself further excludes company_admin (see the
              isSuperAdmin check inside AttendanceRuleManagementPage). Also module-gated
              ('attendance_rules') per migration 0164 — Attendance's own internal rule-engine RPCs
              are untouched, only this route's visibility is additionally permission-checked. */}
          <Route element={<RequireModulePermission module="attendance_rules" />}>
            <Route path="/settings/attendance-rules" element={<AttendanceRuleManagementPage />} />
          </Route>

          {/* Leave Management — Policy Engine configuration. Super Admin only, same pattern as
              Attendance Rule Management above. Module-gated ('leave_settings'). */}
          <Route element={<RequireModulePermission module="leave_settings" />}>
            <Route path="/settings/leave-policies" element={<LeavePolicyManagementPage />} />
          </Route>

          {/* Leave Settlement — Phase 4: Prior Notice, Encashment, Lapse, Notifications, Financial
              Year Closing. Super Admin only, same pattern as Leave Policies above. */}
          <Route element={<RequireModulePermission module="leave_settlement" />}>
            <Route path="/settings/leave-settlement" element={<LeaveSettlementPage />} />
          </Route>

          {/* Leave Reports — Phase 5: the complete 15-report Leave Reports module. Super Admin only. */}
          <Route element={<RequireModulePermission module="leave_reports" />}>
            <Route path="/settings/leave-reports" element={<LeaveReportsPage />} />
          </Route>

          {/* Advance Management — Phase 1: Advance Types, Policies (+ versioned config), 6-tier
              Assignment, Final Approver (Boss) roster, HR / Finance Processors, Notifications.
              Super Admin only, same pattern as Leave Policies above. Module-gated ('advance_settings'). */}
          <Route element={<RequireModulePermission module="advance_settings" />}>
            <Route path="/settings/advance-management" element={<AdvanceManagementPage />} />
          </Route>

          {/* Advance Management — operational, staff-wise Advance Ledger (MAIN sidebar module,
              distinct from the "Advance Settings" configuration page above). HR/Admin only
              (non-staff); advance_ledger_* RPCs re-enforce company + Store-scope authorization
              server-side regardless of what this route allows through. Consumes the EXISTING
              Advance Recovery engine (migration 0136) read-only — no parallel recovery logic. */}
          <Route element={<RequireModulePermission module="advance_management" />}>
            <Route path="/advance/ledger" element={<AdvanceLedgerPage />} />
          </Route>

          {/* Payroll (Phase 5) — real payroll engine: periods, runs, salary calculation, earnings,
              deductions, Advance Recovery, payslips, finalize / lock / reverse. Admin-only route;
              the page itself further requires an active Finance Processor (payroll_can_manage).
              Also module-gated ('payroll') per the Dynamic Role & Permission System (migration
              0161) — internal payroll calculation/RPCs are untouched, only this route's
              visibility is additionally permission-checked. */}
          <Route element={<RequireModulePermission module="payroll" />}>
            <Route path="/payroll" element={<PayrollPage />} />
            {/* PF / ESI Amount Input — per-employee, per-period manual + Excel amounts for a
                PF/ESI component set to "Manual / Excel Import". Admin-only; RPCs enforce payroll_can_manage. */}
            <Route path="/payroll/pf-esi-amounts" element={<PayrollComponentAmountsPage />} />
            {/* Full & Final Settlement — operational F&F for exiting employees (Finance Processor / Super Admin). */}
            <Route path="/payroll/fnf" element={<FnfPage />} />
            <Route path="/payroll/fnf/:id" element={<FnfDetailPage />} />
            {/* Payroll Settings — salary component master + payroll policy (Super Admin only). */}
            <Route path="/payroll/salary-structure" element={<PayrollSettingsPage />} />
          </Route>
          {/* Exit / F&F configuration — Super Admin only. */}
          <Route path="/settings/exit-fnf" element={<ExitFnfSettingsPage />} />

          {/* Night Duty Manager Access — Super Admin only (assigns OM/store + designates Super
              Manager). The Night Duty Approvals route itself lives outside this guard, above.
              Module-gated ('night_duty_manager_access') per migration 0164. */}
          <Route element={<RequireModulePermission module="night_duty_manager_access" />}>
            <Route path="/attendance/night-duty-managers" element={<NightDutyManagerAccessPage />} />
          </Route>

          {/* Reports — operational reporting hub. Was missing entirely, so the catch-all
              `<Route path="*">` redirected /reports -> / (Dashboard). Admin-only, matching the
              sidebar item's flag; the destination report pages keep their own gates. Also
              module-gated ('reports') per migration 0161. */}
          <Route element={<RequireModulePermission module="reports" />}>
            <Route path="/reports" element={<ReportsPage />} />
          </Route>

          {/* Settings — module-gated ('settings') per migration 0164. */}
          <Route element={<RequireModulePermission module="settings" />}>
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          {/* User Management — Super Admin only; AdminOnlyRoute above excludes staff entirely,
              the page component itself further excludes company_admin (see the isSuperAdmin
              check inside UserManagementPage), matching the Attendance Rule Management pattern.
              Module-gated ('user_management') per migration 0164. */}
          <Route element={<RequireModulePermission module="user_management" />}>
            <Route path="/settings/user-management" element={<UserManagementPage />} />
          </Route>

          {/* User & Role Permissions (migration 0161, Dynamic Role & Permission System) — Super
              Admin only, same pattern as User Management above. The permissions configured here
              are enforced server-side (has_dynamic_permission/has_field_permission + the
              RESTRICTIVE RLS policies in migrations 0162/0164), not just hidden by this route
              guard. Module-gated ('permission_management'). */}
          <Route element={<RequireModulePermission module="permission_management" />}>
            <Route path="/settings/permissions" element={<PermissionManagementPage />} />
          </Route>
          </Route>
        </Route>
      </Route>

      {/* Unknown URL */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}