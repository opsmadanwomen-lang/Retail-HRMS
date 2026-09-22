// Leave Management — Phase 1 types (Financial Year, Leave Type Master, Policy + Versioning,
// Policy-Type Config, Policy Assignment, Accrual Periods, Probation, Pro-Rata, Preview).
// No Ledger/Application/Approval types yet — those are Phase 2/3.

export type LeaveFinancialYearStatus = "draft" | "active" | "closed" | "archived";

export interface LeaveFinancialYear {
  id: string;
  companyId: string;
  label: string;
  startDate: string;
  endDate: string;
  status: LeaveFinancialYearStatus;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveType {
  id: string;
  companyId: string;
  code: string;
  name: string;
  isActive: boolean;
  isPaid: boolean;
  halfDayAllowed: boolean;
  quarterDayAllowed: boolean;
  minimumUnit: number;
  documentRequired: boolean;
  requiresReason: boolean;
  remark: string | null;
}

export type LeavePolicyStatus = "draft" | "pending_approval" | "approved" | "active" | "closed" | "archived";

export interface LeavePolicy {
  id: string;
  companyId: string;
  financialYearId: string;
  name: string;
  code: string;
  description: string | null;
  status: LeavePolicyStatus;
  versionNumber: number;
  previousVersionId: string | null;
  changeReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  remark: string | null;
  createdAt: string;
  // Joined for display
  financialYearLabel?: string | null;
}

export type LeaveAccrualFrequency = "monthly" | "quarterly" | "half_yearly" | "yearly" | "custom";
export type LeaveCarryForwardExpiryType = "no_expiry" | "months" | "specific_date" | "fy_end" | "custom";

export interface LeavePolicyTypeConfig {
  id: string;
  policyId: string;
  leaveTypeId: string;
  accrualEnabled: boolean;
  accrualFrequency: LeaveAccrualFrequency;
  probationEligible: boolean;
  carryForwardAllowed: boolean;
  carryForwardMaxDays: number | null;
  carryForwardExpiryType: LeaveCarryForwardExpiryType;
  carryForwardExpiryMonths: number | null;
  encashmentAllowed: boolean;
  lapseAllowed: boolean;
  negativeBalanceAllowed: boolean;
  remark: string | null;
  // Joined for display
  leaveTypeName?: string;
  leaveTypeCode?: string;
}

export interface LeaveAccrualPeriod {
  id: string;
  policyTypeConfigId: string;
  periodStartMonth: number;
  periodEndMonth: number;
  accrualAmount: number;
  sortOrder: number;
  remark: string | null;
}

export type LeavePostProbationStartRule = "same_month" | "next_month" | "specific_date" | "pro_rata" | "full_entitlement" | "custom";

export interface LeaveProbationRule {
  id: string;
  policyId: string;
  durationValue: number;
  durationUnit: "months" | "days";
  extraLeaveDuringProbation: number;
  weeklyOffDuringProbation: boolean;
  postProbationStartRule: LeavePostProbationStartRule;
  specificStartDate: string | null;
  remark: string | null;
}

export type LeaveProRataBasis = "joining_date" | "eligibility_date" | "month" | "actual_days" | "payroll_cycle" | "custom";

export interface LeaveProRataRule {
  id: string;
  policyTypeConfigId: string;
  enabled: boolean;
  basis: LeaveProRataBasis;
  remark: string | null;
}

export type LeavePolicyAssignmentScopeType = "employee" | "store" | "store_designation" | "store_department" | "employment_type" | "company";

export interface LeavePolicyAssignment {
  id: string;
  companyId: string;
  policyId: string;
  scopeType: LeavePolicyAssignmentScopeType;
  employeeId: string | null;
  storeId: string | null;
  storeDesignationId: string | null;
  storeDepartmentId: string | null;
  employmentType: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  remark: string | null;
  // Joined for display
  policyName?: string;
  scopeLabel?: string;
}

// ---------------------------------------------------------------------------
// Phase 2 — Ledger, Applications, Documents
// ---------------------------------------------------------------------------

export interface LeaveBalance {
  earned: number;
  used: number;
  pending: number;
  available: number;
}

// Phase 3 — Manager is ALWAYS step one (manager_pending); "long" leave (per the policy-driven
// threshold in leave_short_long_rules) additionally routes through super_manager_pending before
// it can reach approved. There is exactly one status field — no parallel "approval step" enum.
export type LeaveApplicationStatus = "manager_pending" | "super_manager_pending" | "approved" | "rejected" | "cancelled";
export type LeaveShortOrLong = "short" | "long";
export type LeaveHalfDaySession = "first_half" | "second_half";
export type LeaveApprovalDecision = "approved" | "rejected";
export type LeaveApproverRole = "direct_manager" | "super_manager";

export interface LeaveApplication {
  id: string;
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  financialYearId: string;
  policyId: string;
  fromDate: string;
  toDate: string;
  isHalfDay: boolean;
  halfDaySession: LeaveHalfDaySession | null;
  totalDays: number;
  reason: string | null;
  remarks: string | null;
  status: LeaveApplicationStatus;
  shortOrLong: LeaveShortOrLong | null;
  currentStep: number;
  appliedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionRemark: string | null;
  createdAt: string;
  // Joined for display
  leaveTypeName?: string;
  // Paid-leave allocation (Migration 0131) — only meaningful once approved; 0 otherwise.
  approvedEffectDays?: number;
  paidDays?: number;
  unpaidDays?: number;
}

// One chargeable date of an approved leave, for the "Manage Paid Leave" screen
// (leave_get_paid_day_selection()).
export interface LeavePaidDayRow {
  effectId: string;
  attendanceDate: string;
  isHalfDay: boolean;
  halfDaySession: LeaveHalfDaySession | null;
  paidStatus: "unassigned" | "paid" | "unpaid";
  paidUnits: number;
  payrollLocked: boolean;
}

export interface LeavePaidDaysResult {
  approvedDays: number;
  paidDays: number;
  unpaidDays: number;
  availablePaidBalance: number;
}

// Phase 3 — one immutable row per Manager/Super Manager decision. Never updated after insert;
// leave_manager_decide()/leave_super_manager_decide() only ever INSERT here.
export interface LeaveApprovalAction {
  stepOrder: number;
  approverRole: LeaveApproverRole;
  approverEmployeeId: string;
  approverName: string;
  action: LeaveApprovalDecision;
  remark: string | null;
  actedAt: string;
}

// Phase 3 — one row of a Manager's or Super Manager's approval queue (leave_list_manager_pending()/
// leave_list_super_manager_pending()) — the RPC itself joins Employee/Leave Type names server-side
// (see migration 0103) since a plain Direct Manager has no RLS-granted read access to arbitrary
// employees rows to join client-side.
export interface LeaveApprovalQueueRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  shortOrLong: LeaveShortOrLong | null;
  status: LeaveApplicationStatus;
  reason: string | null;
  appliedAt: string;
}

// One leave application the logged-in approver has approved or rejected (leave_list_my_approval_history()).
// Sourced from the immutable leave_approval_actions log — `status` is the application's CURRENT overall
// status; actedAt/approverRole/stepOrder/remark describe THIS approver's own action.
export interface LeaveApproverHistoryRow {
  id: string; // leave_approval_actions.id
  leaveApplicationId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  shortOrLong: LeaveShortOrLong | null;
  status: LeaveApplicationStatus;
  reason: string | null;
  appliedAt: string;
  actedAt: string;
  approverRole: LeaveApproverRole;
  stepOrder: number;
  approverEmployeeId: string;
  approverName: string;
  remark: string | null;
}

// The Staff self-view of "Approvals → Leave Approval": one of the logged-in employee's OWN leave
// applications plus a summary of its terminal decision (leave_list_my_leave_history()). Strictly
// scoped to current_user_employee_id() server-side.
export interface StaffLeaveHistoryRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  isHalfDay: boolean;
  shortOrLong: LeaveShortOrLong | null;
  reason: string | null;
  status: LeaveApplicationStatus;
  currentStep: number;
  appliedAt: string;
  decidedAction: LeaveApprovalDecision | null;
  decidedByName: string | null;
  decidedRole: LeaveApproverRole | null;
  decidedStep: number | null;
  decidedAt: string | null;
  decisionRemark: string | null;
  approvedEffectDays: number;
  paidDays: number;
  unpaidDays: number;
}

export interface LeaveApplicationDocument {
  id: string;
  leaveApplicationId: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
}

export interface LeavePreviewRow {
  monthStart: string;
  policyId: string | null;
  isProbation: boolean | null;
  isEligible: boolean;
  monthlyEntitlement: number;
  cumulativeEarned: number;
  used: number;
  pending: number;
  closingBalance: number;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Phase 4 — Prior Notice, Notifications, FY Closing, Encashment, Lapse,
// Payroll Integration
// ---------------------------------------------------------------------------

/** Minimal, versioned/effective-dated salary data — NOT a payroll system. Exists only so Leave
 *  Encashment has a real Basic Salary + DA to compute against. */
export interface EmployeeSalaryComponent {
  id: string;
  companyId: string;
  employeeId: string;
  basicSalary: number;
  da: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LeaveSalaryBaseType = "basic" | "basic_da" | "gross" | "gross_da" | "custom";
export type LeaveDivisorType = "26" | "30" | "calendar_days" | "custom";
export type LeaveThresholdComparison = "lt" | "lte" | "gt" | "gte";

export interface LeaveEncashmentRule {
  id: string;
  policyId: string;
  enabled: boolean;
  salaryBaseType: LeaveSalaryBaseType;
  divisorType: LeaveDivisorType;
  divisorCustomValue: number | null;
  thresholdBaseType: LeaveSalaryBaseType;
  salaryThreshold: number | null;
  thresholdComparison: LeaveThresholdComparison;
  remark: string | null;
}

export type LeavePriorNoticeExceptionBehavior = "reject" | "hr_approval_required" | "special_approval_required" | "emergency_exception" | "allow_with_reason" | "custom";

export interface LeavePriorNoticeRule {
  id: string;
  policyId: string;
  required: boolean;
  noticeDays: number;
  exceptionBehavior: LeavePriorNoticeExceptionBehavior;
  remark: string | null;
}

export interface LeavePriorNoticeException {
  id: string;
  companyId: string;
  employeeId: string;
  leaveApplicationId: string | null;
  exceptionBehavior: LeavePriorNoticeExceptionBehavior;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionRemark: string | null;
  fromDate: string;
  toDate: string;
  leaveTypeId: string;
  // Joined for display
  employeeName?: string;
  leaveTypeName?: string;
}

export type LeaveNotificationEventType =
  | "leave_applied"
  | "manager_approval_pending"
  | "super_manager_approval_pending"
  | "leave_approved"
  | "leave_rejected"
  | "leave_cancelled"
  | "leave_modified"
  | "long_leave_applied"
  | "prior_notice_exception"
  | "balance_low"
  | "leave_expiring"
  | "encashment_generated"
  | "lapse_generated"
  | "financial_year_closed";

export interface LeaveNotification {
  id: string;
  companyId: string;
  recipientEmployeeId: string;
  eventType: LeaveNotificationEventType;
  title: string;
  body: string | null;
  relatedTable: string | null;
  relatedId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface LeaveNotificationSetting {
  id: string;
  companyId: string;
  eventType: LeaveNotificationEventType;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
}

export type LeaveFyClosingBatchStatus = "preview" | "processing" | "closed";

export interface LeaveFyClosingBatch {
  id: string;
  companyId: string;
  financialYearId: string;
  nextFinancialYearId: string | null;
  status: LeaveFyClosingBatchStatus;
  initiatedBy: string;
  initiatedAt: string;
  closedBy: string | null;
  closedAt: string | null;
  remark: string | null;
}

export type LeaveFyClosingFinalStatus = "carry_forward_only" | "encashed" | "lapsed" | "mixed" | "no_action" | "partial_unresolved";

/** One employee/leave-type row from the SINGLE authoritative closing engine (leave_compute_fy_closing) —
 *  Preview and Confirm both return exactly this shape; nothing here is Preview-only or Confirm-only. */
export interface LeaveFyClosingLine {
  employeeId: string;
  leaveTypeId: string;
  policyId: string | null;
  policyVersion: number | null;
  opening: number;
  earned: number;
  used: number;
  pending: number;
  available: number;
  carryForwardDays: number;
  encashmentDays: number;
  lapseDays: number;
  basicSalarySnapshot: number | null;
  daSnapshot: number | null;
  salaryBaseSnapshot: number | null;
  divisorSnapshot: number | null;
  dailyRate: number | null;
  encashmentAmount: number | null;
  finalStatus: LeaveFyClosingFinalStatus;
  // Joined for display (client-side, from the employee/leave-type lookups the page already has)
  employeeName?: string;
  leaveTypeName?: string;
}

export type PayrollLeaveTransactionType = "encashment" | "lwp_deduction";
export type PayrollLeaveTransactionStatus = "pending" | "posted" | "processed" | "cancelled";

export interface PayrollLeaveTransaction {
  id: string;
  companyId: string;
  employeeId: string;
  financialYearId: string;
  leaveTypeId: string;
  transactionType: PayrollLeaveTransactionType;
  days: number;
  amount: number | null;
  source: string;
  status: PayrollLeaveTransactionStatus;
  fyClosingBatchId: string | null;
  createdAt: string;
  // Joined for display
  employeeName?: string;
  leaveTypeName?: string;
}
