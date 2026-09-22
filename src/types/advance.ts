// ============================================================================
// Advance Management — Phase 1 view models (camelCase), mirrored from the
// migration 0132/0133 schema + RPC return shapes. Kept deliberately close to
// src/types/leave.ts in style.
// ============================================================================

export type AdvancePolicyStatus = "draft" | "active" | "archived";
export type AdvanceRequestStatus =
  | "manager_pending"
  | "boss_pending"
  | "approved"
  | "rejected"
  | "sent_back"
  | "cancelled"
  // Phase 2 — HR Process Execution (Boss Approved -> HR -> Ready for Finance).
  // 'hr_pending' is only ever reached by advance_hr_resume() undoing a Hold/Send-Back — a fresh
  // Boss approval stays 'approved' until HR acts (advance_boss_decide is untouched by Phase 2).
  | "hr_pending"
  | "hr_on_hold"
  | "hr_sent_back"
  | "finance_pending"
  // Phase 3 — Finance Payment / Disbursement (finance_pending -> finance_processing -> paid).
  | "finance_processing"
  | "paid"
  | "finance_on_hold"
  // Phase 4 — Payroll Recovery (paid -> recovery_pending -> recovering -> settled? -> closed).
  | "recovery_pending"
  | "recovering"
  | "settled"
  | "closed";

/** advance_hr_processes.status — the HR execution record's own lifecycle, separate from (but kept
 *  in step with) advance_requests.status above. */
export type HrProcessStatus = "pending" | "processed" | "on_hold" | "sent_back";

/** advance_finance_payments.status — the Finance disbursement record's own lifecycle. */
export type FinancePaymentStatus = "processing" | "paid" | "on_hold";

/** advance_recovery_plans.status */
export type RecoveryPlanStatus = "recovery_pending" | "recovering" | "settled" | "closed";
export type RecoveryMethod = "fixed_installments" | "fixed_monthly" | "custom" | "full";
export type PayrollPeriodStatus = "draft" | "finalized" | "reversed";
export type AdvanceScopeType =
  | "employee"
  | "store"
  | "store_designation"
  | "store_department"
  | "grade"
  | "category"
  | "employment_type"
  | "company";
/** advance_policy_configs.existing_outstanding_rule (migration 0155). */
export type ExistingOutstandingRule = "not_allowed" | "allowed_within_limit" | "allowed_unrestricted";
export type AdvanceDecision = "approved" | "rejected" | "sent_back";
export type RecoveryStartRule = "next_payroll" | "same_payroll" | "specific_date" | "specific_month" | "manual";

export interface AdvanceType {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  requiresDocument: boolean;
  allowsMultiple: boolean;
  remark: string | null;
}

export interface AdvancePolicy {
  id: string;
  companyId: string;
  name: string;
  code: string;
  description: string | null;
  status: AdvancePolicyStatus;
  versionNumber: number;
  previousVersionId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  remark: string | null;
  createdAt: string;
}

export interface AdvancePolicyConfig {
  id: string;
  policyId: string;
  companyId: string;
  maxAmount: number | null;
  maxPctOfSalary: number | null;
  minServiceMonths: number;
  maxActiveAdvances: number;
  maxInstallments: number;
  minInstallmentAmount: number | null;
  allowMultipleAdvances: boolean;
  allowEarlySettlement: boolean;
  allowPartialPayment: boolean;
  allowPartialRecovery: boolean;
  managerApprovalRequired: boolean;
  bossFinalApprovalRequired: boolean;
  bossCanModifyAmount: boolean;
  bossCanIncreaseAmount: boolean;
  maxBossApprovalLimit: number | null;
  modificationReasonMandatory: boolean;
  recoveryStartRule: RecoveryStartRule;
  // Phase 4 — recovery config (additive)
  recoveryEnabled: boolean;
  recoveryMethod: RecoveryMethod;
  recoveryInstallmentCount: number | null;
  recoveryMonthlyAmount: number | null;
  recoveryStartSpecific: string | null;
  // Migration 0155 — policy configuration completion (additive)
  minAmount: number | null;
  existingOutstandingRule: ExistingOutstandingRule;
  maxTotalOutstandingLimit: number | null;
  remark: string | null;
}

export interface AdvancePolicyAssignment {
  id: string;
  companyId: string;
  policyId: string;
  scopeType: AdvanceScopeType;
  employeeId: string | null;
  storeId: string | null;
  storeDesignationId: string | null;
  storeDepartmentId: string | null;
  gradeId: string | null;
  categoryId: string | null;
  employmentType: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  remark: string | null;
}

/** advance_policy_types (migration 0155) — a Policy restricted to specific Advance Types. Zero
 *  rows for a policy = applies to every (active) Advance Type, exactly the pre-0155 behavior. */
export interface AdvancePolicyTypeLink {
  id: string;
  policyId: string;
  advanceTypeId: string;
}

/** advance_validate_policy() row — the §13 activation checklist. */
export interface AdvancePolicyValidationItem {
  checkKey: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface AdvanceFinalApprover {
  id: string;
  companyId: string;
  employeeId: string;
  isActive: boolean;
  maxApprovalLimit: number | null;
  canModifyAmount: boolean;
  canIncreaseAmount: boolean;
  backupApproverEmployeeId: string | null;
  remark: string | null;
}

export interface AdvanceProcessor {
  id: string;
  companyId: string;
  employeeId: string;
  isActive: boolean;
  remark: string | null;
}

export interface AdvanceNotificationSetting {
  id: string;
  companyId: string;
  eventType: string;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
}

export interface AdvanceApplyContext {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  policyId: string | null;
  policyName: string | null;
  policyVersion: number | null;
  serviceMonths: number;
  activeAdvanceCount: number;
  reportingManagerConfigured: boolean;
  bossConfigured: boolean;
  maxAmount: number | null;
  maxPctOfSalary: number | null;
  maxAllowedAmount: number | null;
  minServiceMonths: number | null;
  maxActiveAdvances: number | null;
  allowMultipleAdvances: boolean | null;
  managerApprovalRequired: boolean | null;
  bossFinalApprovalRequired: boolean | null;
  // Migration 0157 — installment selection is a policy authority, never hard-coded.
  maxInstallments: number | null;
  defaultInstallmentCount: number | null;
  minInstallmentAmount: number | null;
  eligible: boolean;
  ineligibleReason: string | null;
}

export interface MyAdvanceRequest {
  id: string;
  companyId: string;
  employeeId: string;
  advanceTypeId: string;
  advanceTypeName: string;
  policyId: string;
  policyName: string;
  policyVersion: number;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  bossModificationReason: string | null;
  reason: string;
  remarks: string | null;
  status: AdvanceRequestStatus;
  currentStep: number;
  requestedAt: string;
  decidedAt: string | null;
  decisionRemark: string | null;
  // Phase 3 — populated once Finance records a payment (status 'paid').
  paidAmount: number | null;
  paymentDate: string | null;
  paymentModeLabel: string | null;
  // Migration 0157 — requested / manager-recommended / Boss-final installment counts, mirroring
  // the existing amount fields. Only bossFinalInstallmentCount is ever consulted by the recovery engine.
  requestedInstallmentCount: number | null;
  managerRecommendedInstallmentCount: number | null;
  bossFinalInstallmentCount: number | null;
}

export interface AdvanceManagerPendingRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  requestedAmount: number;
  reason: string;
  requestedAt: string;
  status: AdvanceRequestStatus;
  requestedInstallmentCount: number | null;
}

export interface AdvanceBossPendingRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  reason: string;
  requestedAt: string;
  status: AdvanceRequestStatus;
  requestedInstallmentCount: number | null;
  managerRecommendedInstallmentCount: number | null;
}

/** advance_recovery_installment_adjustments row (migration 0157) — HR's pre-payroll-lock schedule
 *  adjustment audit trail (§15). Immutable; a correction is a new row, never an edit. */
export interface AdvanceRecoveryInstallmentAdjustment {
  batchId: string;
  adjustmentScope: "target_period" | "future_redistribution";
  installmentNumber: number | null;
  dueMonth: string | null;
  oldScheduledAmount: number;
  newScheduledAmount: number;
  adjustmentType: "increase" | "decrease" | "redistribute" | "no_change";
  reason: string;
  processedByName: string | null;
  payrollLockStatusAtTime: string | null;
  createdAt: string;
}

export interface AdvanceMyDecisionRow {
  id: string;
  advanceRequestId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  status: AdvanceRequestStatus;
  myRole: "reporting_manager" | "boss";
  myAction: string;
  myOldAmount: number | null;
  myNewAmount: number | null;
  myRemark: string | null;
  actedAt: string;
  requestedAt: string;
}

export interface AdvanceApprovalHistoryRow {
  stepOrder: number;
  actorRole: "reporting_manager" | "boss";
  actorEmployeeId: string;
  actorName: string;
  action: string;
  oldAmount: number | null;
  newAmount: number | null;
  remark: string | null;
  actedAt: string;
}

// ============================================================================
// Phase 2 — HR Process Execution
// ============================================================================

/** HR Pending queue row — advance_list_hr_pending(). Company-scoped server-side from the
 *  CALLER's own advance_hr_processors row; never client-supplied. */
export interface AdvanceHrPendingRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  reason: string;
  requestedAt: string;
  approvalCompletedAt: string | null;
  status: AdvanceRequestStatus;
}

/** The full HR detail-drawer bundle for one request — advance_get_hr_process(). */
export interface AdvanceHrProcessDetail {
  advanceRequestId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  policyName: string;
  policyVersion: number;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  reason: string;
  remarks: string | null;
  requestStatus: AdvanceRequestStatus;
  requestedAt: string;
  approvalCompletedAt: string | null;
  documentCount: number;
  hrProcessId: string | null;
  hrStatus: HrProcessStatus | null;
  holdReason: string | null;
  sendBackReason: string | null;
  processRemarks: string | null;
  verificationStatus: string | null;
  processedByName: string | null;
  processedAt: string | null;
}

/** On Hold / Sent Back / Processed (Ready for Finance) queue row — advance_list_hr_history(). Same
 *  security model as AdvanceHrPendingRow (company resolved server-side from the caller's own
 *  advance_hr_processors row); a different status filter, not a different authority model. */
export interface AdvanceHrHistoryRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  reason: string;
  requestedAt: string;
  approvalCompletedAt: string | null;
  status: AdvanceRequestStatus;
  hrStatus: HrProcessStatus | null;
  holdReason: string | null;
  sendBackReason: string | null;
  processedAt: string | null;
}

/** Immutable HR process history row — advance_list_hr_process_actions(), the HR-side counterpart
 *  of AdvanceApprovalHistoryRow. */
export interface AdvanceHrProcessActionRow {
  action: "processed" | "on_hold" | "sent_back" | "resumed" | "commented";
  actorEmployeeId: string;
  actorName: string;
  remark: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  actedAt: string;
}

// ============================================================================
// Phase 3 — Finance Payment
// ============================================================================

/** Configurable Payment Mode master row — advance_payment_modes. */
export interface AdvancePaymentMode {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  requiresReference: boolean;
  sortOrder: number;
}

/** Finance Pending queue row — advance_list_finance_pending(). Company resolved server-side from
 *  the caller's own advance_finance_processors row. */
export interface AdvanceFinancePendingRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  hrProcessedAt: string | null;
  reason: string;
  requestedAt: string;
  status: AdvanceRequestStatus;
}

/** Processing / On Hold / Paid queue row — advance_list_finance_history(). */
export interface AdvanceFinanceHistoryRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  status: AdvanceRequestStatus;
  financeStatus: FinancePaymentStatus | null;
  paymentAmount: number | null;
  paymentDate: string | null;
  paymentMode: string | null;
  paymentModeLabel: string | null;
  transactionReference: string | null;
  utrNumber: string | null;
  bankReference: string | null;
  holdReason: string | null;
  processedByName: string | null;
  processedAt: string | null;
}

/** Full Finance detail-drawer bundle — advance_get_finance_payment(). */
export interface AdvanceFinancePaymentDetail {
  advanceRequestId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  policyName: string;
  policyVersion: number;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  maxPayableAmount: number | null;
  allowPartialPayment: boolean;
  reason: string;
  remarks: string | null;
  requestStatus: AdvanceRequestStatus;
  requestedAt: string;
  documentCount: number;
  hrProcessedAmount: number | null;
  hrProcessedAt: string | null;
  hrProcessRemarks: string | null;
  hrProcessedByName: string | null;
  financePaymentId: string | null;
  financeStatus: FinancePaymentStatus | null;
  paymentAmount: number | null;
  paymentDate: string | null;
  paymentMode: string | null;
  paymentModeLabel: string | null;
  transactionReference: string | null;
  utrNumber: string | null;
  bankReference: string | null;
  paymentProofPath: string | null;
  paymentRemarks: string | null;
  holdReason: string | null;
  processedByName: string | null;
  processedAt: string | null;
}

/** Immutable Finance history row — advance_list_finance_payment_actions(). */
export interface AdvanceFinancePaymentActionRow {
  action: "started" | "paid" | "on_hold" | "resumed" | "commented";
  actorEmployeeId: string;
  actorName: string;
  oldStatus: string | null;
  newStatus: string | null;
  oldPaymentAmount: number | null;
  newPaymentAmount: number | null;
  remark: string | null;
  actedAt: string;
}

// ============================================================================
// Phase 4 — Payroll Recovery
// ============================================================================

/** Staff self-view recovery summary — advance_list_my_recoveries(). */
export interface MyAdvanceRecovery {
  advanceRequestId: string;
  advanceTypeName: string;
  actualPaidAmount: number;
  totalRecovered: number;
  totalSettled: number;
  outstandingAmount: number;
  recoveryMethod: RecoveryMethod;
  installmentCount: number | null;
  monthlyAmount: number | null;
  recoveryStartDate: string;
  nextDueMonth: string | null;
  completedInstallments: number;
  totalInstallments: number;
  status: RecoveryPlanStatus;
  closedReason: string | null;
}

/** Admin/HR/Finance recovery list row — advance_recovery_list_plans(). */
export interface AdvanceRecoveryPlanRow {
  advanceRequestId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  actualPaidAmount: number;
  totalRecovered: number;
  totalSettled: number;
  outstandingAmount: number;
  recoveryMethod: RecoveryMethod;
  installmentCount: number | null;
  monthlyAmount: number | null;
  recoveryStartDate: string;
  nextDueMonth: string | null;
  status: RecoveryPlanStatus;
  closedReason: string | null;
}

/** Full recovery detail bundle — advance_get_recovery_detail(). */
export interface AdvanceRecoveryDetail {
  advanceRequestId: string;
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  policyName: string;
  policyVersion: number;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  actualPaidAmount: number;
  paymentDate: string | null;
  totalRecovered: number;
  totalSettled: number;
  totalReversed: number;
  outstandingAmount: number;
  recoveryMethod: RecoveryMethod;
  installmentCount: number | null;
  monthlyAmount: number | null;
  recoveryStartDate: string;
  nextDueMonth: string | null;
  lastDeductionDate: string | null;
  status: RecoveryPlanStatus;
  closedReason: string | null;
  recoveryEnabled: boolean;
  allowEarlySettlement: boolean;
}

export interface AdvanceRecoveryInstallmentRow {
  installmentNumber: number;
  dueMonth: string;
  scheduledAmount: number;
  recoveredAmount: number;
  outstandingAfter: number | null;
  status: "scheduled" | "processed" | "partially_processed" | "cancelled";
  processedAt: string | null;
}

export interface AdvanceRecoveryTransactionRow {
  kind: "deduction" | "reversal" | "settlement";
  periodMonth: string | null;
  installmentNumber: number | null;
  scheduledAmount: number | null;
  amount: number;
  openingOutstanding: number;
  closingOutstanding: number;
  txnDate: string | null;
  actorName: string | null;
  remark: string | null;
  actedAt: string;
}

// ============================================================================
// Advance Management Ledger (migration 0154) — operational, staff-wise view.
// Distinct from the Phase 1 config types above (Settings -> Advance Settings).
// ============================================================================

/** Derived, display-only employee-level status — never a stored column (spec: prefer derived
 *  status over a duplicate DB field). */
export type AdvanceLedgerDerivedStatus =
  | "no_advance"
  | "pending"
  | "active"
  | "partially_recovered"
  | "fully_recovered"
  | "closed";

export interface AdvanceLedgerStoreOption {
  id: string;
  name: string;
}

/** One staff-wise ledger row — advance_ledger_list(). Total Approved / Paid / Recovered /
 *  Outstanding are always the combined totals across every advance the employee has (never a
 *  single advance's numbers), per spec item 7. */
export interface AdvanceLedgerRow {
  employeeId: string;
  employeeCode: string | null;
  fullName: string;
  mobile: string | null;
  email: string | null;
  storeId: string | null;
  storeName: string | null;
  departmentName: string | null;
  designationTitle: string | null;
  advanceCount: number;
  totalApproved: number;
  totalPaid: number;
  totalRecovered: number;
  totalOutstanding: number;
  status: AdvanceLedgerDerivedStatus;
}

/** Paginated list result — advance_ledger_list(), `totalCount` from the row-level window fn. */
export interface AdvanceLedgerListResult {
  rows: AdvanceLedgerRow[];
  totalCount: number;
}

/** The 5 summary cards — advance_ledger_summary(). Built from the exact same rows as the table
 *  (advance_ledger_rows internally), so the cards can never disagree with what's listed below. */
export interface AdvanceLedgerSummary {
  totalStaff: number;
  totalApproved: number;
  totalPaid: number;
  totalRecovered: number;
  totalOutstanding: number;
}

// ============================================================================
// Advance Payment Receipt Management (migration 0160) — the POST-payment
// signed employee receipt, distinct from the at-payment-time optional
// "payment proof" (advance_finance_payments.payment_proof_path, unchanged).
// ============================================================================
export type AdvanceReceiptDisplayStatus = "pending" | "uploaded";
export type AdvanceReceiptRowStatus = "active" | "replaced";

/** The CURRENT receipt for a payment — advance_get_payment_receipt(). */
export interface AdvancePaymentReceipt {
  receiptId: string | null;
  storagePath: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  uploadedByName: string | null;
  uploadedAt: string | null;
  receiptStatus: AdvanceReceiptDisplayStatus;
}

/** One row of the full (active + replaced) receipt audit trail — advance_list_payment_receipt_history(). */
export interface AdvancePaymentReceiptHistoryRow {
  id: string;
  fileName: string;
  storagePath: string;
  status: AdvanceReceiptRowStatus;
  uploadedByName: string | null;
  uploadedAt: string;
  replaceReason: string | null;
  replacedByReceiptId: string | null;
}

/** One advance inside the employee detail drawer — advance_ledger_employee_advances(). Recovery
 *  history for a given row's advanceRequestId is fetched via the EXISTING
 *  advance_get_recovery_detail/advance_list_recovery_installments/advance_list_recovery_transactions
 *  RPCs (Phase 4, migration 0136) — never duplicated here. */
export interface AdvanceLedgerEmployeeAdvance {
  advanceRequestId: string;
  advanceTypeName: string;
  requestDate: string;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  actualPaidAmount: number | null;
  paymentDate: string | null;
  recoveryStartDate: string | null;
  totalRecovered: number;
  outstandingAmount: number;
  status: AdvanceRequestStatus;
}

// ============================================================================
// HR Panel Advance Workflow consolidation (migration 0168) — ONE read-only row
// per advance_requests, for the unified "Approvals -> Advance" screen. Never
// used for any write — every mutation still goes through the existing
// manager/boss decide, HR process, Finance pay, receipt and recovery RPCs.
// ============================================================================
export type AdvanceWorkflowReceiptStatus = "pending" | "uploaded" | "not_applicable";

export interface AdvanceWorkflowRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  storeName: string | null;
  advanceTypeName: string;
  status: AdvanceRequestStatus;
  requestedAmount: number;
  managerRecommendedAmount: number | null;
  bossApprovedAmount: number | null;
  requestedInstallmentCount: number | null;
  managerRecommendedInstallmentCount: number | null;
  bossFinalInstallmentCount: number | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  hrProcessedAt: string | null;
  hrHoldReason: string | null;
  hrSendBackReason: string | null;
  paymentAmount: number | null;
  paymentDate: string | null;
  paymentModeLabel: string | null;
  financeHoldReason: string | null;
  receiptStatus: AdvanceWorkflowReceiptStatus;
  totalRecovered: number | null;
  outstandingAmount: number | null;
  recoveryStatus: string | null;
  // Migration 0170 — "Pending with Manager" visibility (view-only; grants no decide authority).
  reason: string;
  reportingManagerId: string | null;
  reportingManagerName: string | null;
}

export interface AdvanceLedgerFilters {
  storeId?: string | null;
  departmentId?: string | null;
  designationId?: string | null;
  employeeId?: string | null;
  status?: string | null;
  search?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  showAll?: boolean;
}

export interface AdvancePayrollPeriod {
  id: string;
  companyId: string;
  periodMonth: string;
  label: string | null;
  status: PayrollPeriodStatus;
  finalizedAt: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
  deductionCount: number;
  deductedTotal: number;
}
