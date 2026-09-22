export const ROUTES = {
  // Authentication
  login: "/login",
  forgotPassword: "/forgot-password",
  changePassword: "/change-password",

  // Dashboard
  dashboard: "/",
  /** Staff Panel's own personal dashboard — distinct from the Admin analytics dashboard above.
   *  Accessible to every authenticated role (an Admin is also, personally, an employee), but this
   *  is the landing page AdminOnlyRoute sends a 'staff' account to. */
  staffDashboard: "/dashboard",

  // Organization
  companies: "/companies",
  companyNew: "/companies/new",
  stores: "/stores",
  storeNew: "/stores/new",
  organization: "/organization",

  // Employees
  employees: "/employees",
  employeeNew: "/employees/new",
  employeeImport: "/employees/import",
  employeeDocuments: "/employees/documents",

  // Shift & Weekly Off Management
  shifts: "/shifts",
  employeeSchedule: "/schedule",
  attendanceRules: "/settings/attendance-rules",
  nightDutyApprovals: "/attendance/night-duty-approvals",
  nightDutyManagers: "/attendance/night-duty-managers",
  /** Staff Panel's own "Approvals -> Night Duty Approval" — a Staff viewing the status of THEIR
   *  OWN Night Duty requests. Distinct from nightDutyApprovals above, which is the
   *  Operations/Super Manager's page for DECIDING on other employees' requests. */
  staffApprovals: "/approvals",
  nightDutyStaffApproval: "/approvals/night-duty",

  // Attendance
  attendance: "/attendance",
  attendanceImport: "/attendance/import",
  paytimeAttendance: "/attendance/paytime",
  mobileAttendance: "/attendance/mobile",
  attendanceReports: "/attendance/reports",

  // Leave Management
  leave: "/leave",
  leaveRequests: "/leave/requests",
  leaveBalance: "/leave/balance",
  /** Admin/HR Leave Policy Engine configuration — Super Admin only, same pattern as
   *  ROUTES.attendanceRules. Distinct from the Staff-facing ROUTES.leave above. */
  leavePolicies: "/settings/leave-policies",
  /** Direct Manager / Super Manager decide page — deliberately OUTSIDE AdminOnlyRoute, same
   *  reasoning as ROUTES.nightDutyApprovals: Leave's Manager/Super Manager authority is held by
   *  individual 'staff' role logins, not an admin role, so they must be able to reach this route.
   *  The page itself role-detects and every decision RPC re-enforces authorization server-side. */
  leaveApprovals: "/leave/approvals",
  /** Phase 4 — Prior Notice / Encashment / Lapse / Notifications / Financial Year Closing config
   *  and workflow. Super Admin only, same pattern as ROUTES.leavePolicies — a separate page rather
   *  than another tab bolted onto the already-large Leave Policies page. */
  leaveSettlement: "/settings/leave-settlement",
  /** Phase 5 — the 15-report Leave Reports module. Super Admin only, same pattern as
   *  ROUTES.leaveSettlement/leavePolicies. */
  leaveReports: "/settings/leave-reports",

  // Payroll
  payroll: "/payroll",
  payrollComponentAmounts: "/payroll/pf-esi-amounts",
  fnf: "/payroll/fnf",
  fnfDetail: "/payroll/fnf/:id",
  exitFnfSettings: "/settings/exit-fnf",
  exitRequests: "/employees/exit-requests",
  employeeTransfers: "/employees/transfers",
  salaryStructure: "/payroll/salary-structure",
  monthlyPayroll: "/payroll/monthly",
  salarySlips: "/payroll/salary-slips",
  payrollReports: "/payroll/reports",

  // Advance Management (Phase 1) — Admin config + Staff request/approval flow.
  /** Super Admin only — Advance Types, Policies, 6-tier Assignment, Final Approver (Boss),
   *  HR / Finance Processors, Notification Settings. Same guard pattern as ROUTES.leavePolicies. */
  advanceManagement: "/settings/advance-management",
  /** Staff — submit a new advance request (advance_apply, self-scoped). */
  advanceRequest: "/advance/request",
  /** Staff — the status & full history of the caller's own advances (advance_list_my_requests). */
  myAdvances: "/advance/my-advances",
  /** Reporting Manager / Final Approver (Boss) decide inbox + history. Deliberately OUTSIDE
   *  AdminOnlyRoute — the same reasoning as ROUTES.leaveApprovals: this authority is held by
   *  individual 'staff' logins and every decision RPC re-enforces it server-side. */
  advanceApprovals: "/advance/approvals",
  /** Phase 2 — HR Process Execution. HR is NOT an approval level (no Approve/Reject here), only
   *  Process / Hold / Send Back on an already Boss-approved request. Deliberately OUTSIDE
   *  AdminOnlyRoute, same reasoning as advanceApprovals — HR authority is held by individual
   *  'staff' logins (advance_hr_processors) and every mutating RPC re-enforces it server-side. */
  advanceHrProcessing: "/advance/hr-processing",
  /** Phase 3 — Finance Payment / Disbursement. Finance is NOT an approval level (no Approve/Reject),
   *  only Start / Pay / Hold on an HR-processed request. Deliberately OUTSIDE AdminOnlyRoute, same
   *  reasoning — Finance authority is held by individual 'staff' logins (advance_finance_processors)
   *  and every mutating RPC re-enforces it server-side. */
  advanceFinancePayment: "/advance/finance-payment",
  /** Phase 4 — Payroll Recovery: installment schedule, payroll deduction runs, early settlement,
   *  closure. Reuses the Finance Processor roster (no new role). Deliberately OUTSIDE AdminOnlyRoute,
   *  same reasoning as advanceFinancePayment; every mutating RPC re-enforces authority server-side. */
  advanceRecovery: "/advance/recovery",
  /** Operational, staff-wise Advance Ledger — MAIN sidebar module, distinct from the configuration
   *  page above (ROUTES.advanceManagement, "Advance Settings"). HR/Admin only (non-staff); every
   *  RPC it calls re-enforces company + Store-scope authorization server-side regardless of what
   *  the UI shows. */
  advanceLedger: "/advance/ledger",
  /** HR Panel consolidation — ONE unified "Approvals -> Advance" screen (Boss-pending view,
   *  HR processing, Finance payment, receipt, recovery) replacing four separate destinations
   *  (advanceApprovals/advanceHrProcessing/advanceFinancePayment/advanceRecovery below, which stay
   *  registered as internal implementation routes but are no longer linked from Approvals).
   *  Deliberately OUTSIDE AdminOnlyRoute, same reasoning as those four — every action still goes
   *  through the same roster-authorized RPCs, re-enforced server-side regardless of this route. */
  advanceWorkflow: "/advance/workflow",

  // Reports
  reports: "/reports",

  // Settings
  settings: "/settings",
  userManagement: "/settings/user-management",
  /** Dynamic Role & Permission System (migration 0161) — Super Admin configures Role -> Module ->
   *  Action / Field permissions here. Super Admin only, same guard pattern as ROUTES.leavePolicies /
   *  ROUTES.advanceManagement. The permission checks it manages are enforced server-side
   *  (has_dynamic_permission / has_field_permission + the RESTRICTIVE RLS policies added in
   *  migration 0162) — this page is the configuration surface, not the enforcement point. */
  userPermissions: "/settings/permissions",
  profile: "/profile",
  /** Staff Panel's own "Payslip & Documents" page — distinct from the (not yet built) admin
   *  Payroll administration area above. */
  payslip: "/payslip",

  // OLD MODULES
  // अभी existing system को safe रखने के लिए रखे गए हैं
  roles: "/roles",
  roleNew: "/roles/new",
  roleAssignment: "/roles/assignment",

  kpiCategories: "/kpi/categories",
  kpi: "/kpi",
  kpiNew: "/kpi/new",
  roleKpi: "/kpi/role-kpi",
  performanceSummary: "/kpi/performance-summary",

  taskCategories: "/tasks/categories",
  tasks: "/tasks",
  taskNew: "/tasks/new",
  taskTemplates: "/tasks/templates",
  taskAssignment: "/tasks/assignment",
  roleTask: "/tasks/role-task",
  checklists: "/tasks/checklist",
  taskDashboard: "/tasks/dashboard",

  performanceData: "/performance-data",
  metrics: "/performance-data/metrics",
  metricNew: "/performance-data/metrics/new",
  dailyEntry: "/performance-data/daily-entry",
  approvals: "/performance-data/approvals",
  performanceDashboard: "/performance-data/dashboard",
} as const;