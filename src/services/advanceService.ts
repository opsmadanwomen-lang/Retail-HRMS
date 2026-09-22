import { supabase } from "@/lib/supabaseClient";
import type {
  AdvanceType,
  AdvancePolicy,
  AdvancePolicyConfig,
  AdvancePolicyAssignment,
  AdvanceFinalApprover,
  AdvanceProcessor,
  AdvanceNotificationSetting,
  AdvanceApplyContext,
  MyAdvanceRequest,
  AdvanceManagerPendingRow,
  AdvanceBossPendingRow,
  AdvanceMyDecisionRow,
  AdvanceApprovalHistoryRow,
  AdvanceDecision,
  AdvanceHrPendingRow,
  AdvanceHrHistoryRow,
  AdvanceHrProcessDetail,
  AdvanceHrProcessActionRow,
  AdvancePaymentMode,
  AdvanceFinancePendingRow,
  AdvanceFinanceHistoryRow,
  AdvanceFinancePaymentDetail,
  AdvanceFinancePaymentActionRow,
  MyAdvanceRecovery,
  AdvanceRecoveryPlanRow,
  AdvanceRecoveryDetail,
  AdvanceRecoveryInstallmentRow,
  AdvanceRecoveryTransactionRow,
  AdvancePayrollPeriod,
  AdvanceLedgerRow,
  AdvanceLedgerListResult,
  AdvanceLedgerSummary,
  AdvanceLedgerEmployeeAdvance,
  AdvanceLedgerStoreOption,
  AdvanceLedgerFilters,
  AdvancePolicyTypeLink,
  AdvancePolicyValidationItem,
  AdvanceRecoveryInstallmentAdjustment,
  AdvancePaymentReceipt,
  AdvancePaymentReceiptHistoryRow,
  AdvanceWorkflowRow,
} from "@/types/advance";

// ---------------------------------------------------------------------------
// mappers (snake_case row -> camelCase view model)
// ---------------------------------------------------------------------------
function mapType(r: any): AdvanceType {
  return {
    id: r.id,
    companyId: r.company_id,
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    isActive: r.is_active,
    requiresDocument: r.requires_document,
    allowsMultiple: r.allows_multiple,
    remark: r.remark ?? null,
  };
}
function mapPolicy(r: any): AdvancePolicy {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    code: r.code,
    description: r.description ?? null,
    status: r.status,
    versionNumber: r.version_number,
    previousVersionId: r.previous_version_id ?? null,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
    changeReason: r.change_reason ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    remark: r.remark ?? null,
    createdAt: r.created_at,
  };
}
function num(v: any): number | null {
  return v === null || v === undefined ? null : Number(v);
}
function mapConfig(r: any): AdvancePolicyConfig {
  return {
    id: r.id,
    policyId: r.policy_id,
    companyId: r.company_id,
    maxAmount: num(r.max_amount),
    maxPctOfSalary: num(r.max_pct_of_salary),
    minServiceMonths: Number(r.min_service_months),
    maxActiveAdvances: Number(r.max_active_advances),
    maxInstallments: Number(r.max_installments),
    minInstallmentAmount: num(r.min_installment_amount),
    allowMultipleAdvances: r.allow_multiple_advances,
    allowEarlySettlement: r.allow_early_settlement,
    allowPartialPayment: r.allow_partial_payment,
    allowPartialRecovery: r.allow_partial_recovery,
    managerApprovalRequired: r.manager_approval_required,
    bossFinalApprovalRequired: r.boss_final_approval_required,
    bossCanModifyAmount: r.boss_can_modify_amount,
    bossCanIncreaseAmount: r.boss_can_increase_amount,
    maxBossApprovalLimit: num(r.max_boss_approval_limit),
    modificationReasonMandatory: r.modification_reason_mandatory,
    recoveryStartRule: r.recovery_start_rule,
    recoveryEnabled: r.recovery_enabled ?? true,
    recoveryMethod: r.recovery_method ?? "fixed_installments",
    recoveryInstallmentCount: r.recovery_installment_count ?? null,
    recoveryMonthlyAmount: num(r.recovery_monthly_amount),
    recoveryStartSpecific: r.recovery_start_specific ?? null,
    minAmount: num(r.min_amount),
    existingOutstandingRule: r.existing_outstanding_rule ?? "allowed_unrestricted",
    maxTotalOutstandingLimit: num(r.max_total_outstanding_limit),
    remark: r.remark ?? null,
  };
}
function mapAssignment(r: any): AdvancePolicyAssignment {
  return {
    id: r.id,
    companyId: r.company_id,
    policyId: r.policy_id,
    scopeType: r.scope_type,
    employeeId: r.employee_id ?? null,
    storeId: r.store_id ?? null,
    storeDesignationId: r.store_designation_id ?? null,
    storeDepartmentId: r.store_department_id ?? null,
    gradeId: r.grade_id ?? null,
    categoryId: r.category_id ?? null,
    employmentType: r.employment_type ?? null,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
    isActive: r.is_active,
    remark: r.remark ?? null,
  };
}
function mapPolicyTypeLink(r: any): AdvancePolicyTypeLink {
  return { id: r.id, policyId: r.policy_id, advanceTypeId: r.advance_type_id };
}
function mapPolicyValidation(r: any): AdvancePolicyValidationItem {
  return { checkKey: r.check_key, label: r.label, passed: Boolean(r.passed), detail: r.detail };
}
function mapInstallmentAdjustment(r: any): AdvanceRecoveryInstallmentAdjustment {
  return {
    batchId: r.batch_id,
    adjustmentScope: r.adjustment_scope,
    installmentNumber: r.installment_number ?? null,
    dueMonth: r.due_month ?? null,
    oldScheduledAmount: Number(r.old_scheduled_amount),
    newScheduledAmount: Number(r.new_scheduled_amount),
    adjustmentType: r.adjustment_type,
    reason: r.reason,
    processedByName: r.processed_by_name ?? null,
    payrollLockStatusAtTime: r.payroll_lock_status_at_time ?? null,
    createdAt: r.created_at,
  };
}
function mapApprover(r: any): AdvanceFinalApprover {
  return {
    id: r.id,
    companyId: r.company_id,
    employeeId: r.employee_id,
    isActive: r.is_active,
    maxApprovalLimit: num(r.max_approval_limit),
    canModifyAmount: r.can_modify_amount,
    canIncreaseAmount: r.can_increase_amount,
    backupApproverEmployeeId: r.backup_approver_employee_id ?? null,
    remark: r.remark ?? null,
  };
}
function mapProcessor(r: any): AdvanceProcessor {
  return { id: r.id, companyId: r.company_id, employeeId: r.employee_id, isActive: r.is_active, remark: r.remark ?? null };
}
function mapNotificationSetting(r: any): AdvanceNotificationSetting {
  return {
    id: r.id,
    companyId: r.company_id,
    eventType: r.event_type,
    inAppEnabled: r.in_app_enabled,
    pushEnabled: r.push_enabled,
    emailEnabled: r.email_enabled,
    smsEnabled: r.sms_enabled,
  };
}
function mapApplyContext(r: any): AdvanceApplyContext {
  return {
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    policyId: r.policy_id ?? null,
    policyName: r.policy_name ?? null,
    policyVersion: r.policy_version ?? null,
    serviceMonths: Number(r.service_months ?? 0),
    activeAdvanceCount: Number(r.active_advance_count ?? 0),
    reportingManagerConfigured: Boolean(r.reporting_manager_configured),
    bossConfigured: Boolean(r.boss_configured),
    maxAmount: num(r.max_amount),
    maxPctOfSalary: num(r.max_pct_of_salary),
    maxAllowedAmount: num(r.max_allowed_amount),
    minServiceMonths: r.min_service_months === null || r.min_service_months === undefined ? null : Number(r.min_service_months),
    maxActiveAdvances: r.max_active_advances === null || r.max_active_advances === undefined ? null : Number(r.max_active_advances),
    allowMultipleAdvances: r.allow_multiple_advances ?? null,
    managerApprovalRequired: r.manager_approval_required ?? null,
    bossFinalApprovalRequired: r.boss_final_approval_required ?? null,
    maxInstallments: r.max_installments === null || r.max_installments === undefined ? null : Number(r.max_installments),
    defaultInstallmentCount: r.default_installment_count === null || r.default_installment_count === undefined ? null : Number(r.default_installment_count),
    minInstallmentAmount: num(r.min_installment_amount),
    eligible: Boolean(r.eligible),
    ineligibleReason: r.ineligible_reason ?? null,
  };
}
function mapMyRequest(r: any): MyAdvanceRequest {
  return {
    id: r.id,
    companyId: r.company_id,
    employeeId: r.employee_id,
    advanceTypeId: r.advance_type_id,
    advanceTypeName: r.advance_type_name,
    policyId: r.policy_id,
    policyName: r.policy_name,
    policyVersion: Number(r.policy_version),
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    bossModificationReason: r.boss_modification_reason ?? null,
    reason: r.reason,
    remarks: r.remarks ?? null,
    status: r.status,
    currentStep: Number(r.current_step),
    requestedAt: r.requested_at,
    decidedAt: r.decided_at ?? null,
    decisionRemark: r.decision_remark ?? null,
    paidAmount: num(r.paid_amount),
    paymentDate: r.payment_date ?? null,
    paymentModeLabel: r.payment_mode_label ?? null,
    requestedInstallmentCount: r.requested_installment_count ?? null,
    managerRecommendedInstallmentCount: r.manager_recommended_installment_count ?? null,
    bossFinalInstallmentCount: r.boss_final_installment_count ?? null,
  };
}
function mapManagerPending(r: any): AdvanceManagerPendingRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    requestedAmount: Number(r.requested_amount),
    reason: r.reason,
    requestedAt: r.requested_at,
    status: r.status,
    requestedInstallmentCount: r.requested_installment_count ?? null,
  };
}
function mapBossPending(r: any): AdvanceBossPendingRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    requestedInstallmentCount: r.requested_installment_count ?? null,
    managerRecommendedInstallmentCount: r.manager_recommended_installment_count ?? null,
    reason: r.reason,
    requestedAt: r.requested_at,
    status: r.status,
  };
}
function mapMyDecision(r: any): AdvanceMyDecisionRow {
  return {
    id: r.id,
    advanceRequestId: r.advance_request_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    status: r.status,
    myRole: r.my_role,
    myAction: r.my_action,
    myOldAmount: num(r.my_old_amount),
    myNewAmount: num(r.my_new_amount),
    myRemark: r.my_remark ?? null,
    actedAt: r.acted_at,
    requestedAt: r.requested_at,
  };
}
function mapHrPending(r: any): AdvanceHrPendingRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    reason: r.reason,
    requestedAt: r.requested_at,
    approvalCompletedAt: r.approval_completed_at ?? null,
    status: r.status,
  };
}
function mapPaymentMode(r: any): AdvancePaymentMode {
  return {
    id: r.id,
    companyId: r.company_id,
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    isActive: r.is_active,
    requiresReference: r.requires_reference,
    sortOrder: Number(r.sort_order),
  };
}
function mapFinancePending(r: any): AdvanceFinancePendingRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    hrProcessedAt: r.hr_processed_at ?? null,
    reason: r.reason,
    requestedAt: r.requested_at,
    status: r.status,
  };
}
function mapFinanceHistory(r: any): AdvanceFinanceHistoryRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    status: r.status,
    financeStatus: r.finance_status ?? null,
    paymentAmount: num(r.payment_amount),
    paymentDate: r.payment_date ?? null,
    paymentMode: r.payment_mode ?? null,
    paymentModeLabel: r.payment_mode_label ?? null,
    transactionReference: r.transaction_reference ?? null,
    utrNumber: r.utr_number ?? null,
    bankReference: r.bank_reference ?? null,
    holdReason: r.hold_reason ?? null,
    processedByName: r.processed_by_name ?? null,
    processedAt: r.processed_at ?? null,
  };
}
function mapFinancePaymentDetail(r: any): AdvanceFinancePaymentDetail {
  return {
    advanceRequestId: r.advance_request_id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    policyName: r.policy_name,
    policyVersion: Number(r.policy_version),
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    maxPayableAmount: num(r.max_payable_amount),
    allowPartialPayment: Boolean(r.allow_partial_payment),
    reason: r.reason,
    remarks: r.remarks ?? null,
    requestStatus: r.request_status,
    requestedAt: r.requested_at,
    documentCount: Number(r.document_count ?? 0),
    hrProcessedAmount: num(r.hr_processed_amount),
    hrProcessedAt: r.hr_processed_at ?? null,
    hrProcessRemarks: r.hr_process_remarks ?? null,
    hrProcessedByName: r.hr_processed_by_name ?? null,
    financePaymentId: r.finance_payment_id ?? null,
    financeStatus: r.finance_status ?? null,
    paymentAmount: num(r.payment_amount),
    paymentDate: r.payment_date ?? null,
    paymentMode: r.payment_mode ?? null,
    paymentModeLabel: r.payment_mode_label ?? null,
    transactionReference: r.transaction_reference ?? null,
    utrNumber: r.utr_number ?? null,
    bankReference: r.bank_reference ?? null,
    paymentProofPath: r.payment_proof_path ?? null,
    paymentRemarks: r.payment_remarks ?? null,
    holdReason: r.hold_reason ?? null,
    processedByName: r.processed_by_name ?? null,
    processedAt: r.processed_at ?? null,
  };
}
// Advance Payment Receipt Management (migration 0160) — the POST-payment signed employee
// receipt, distinct from paymentProofPath above (the at-payment-time optional proof).
function mapPaymentReceipt(r: any): AdvancePaymentReceipt {
  return {
    receiptId: r.receipt_id ?? null,
    storagePath: r.storage_path ?? null,
    fileName: r.file_name ?? null,
    mimeType: r.mime_type ?? null,
    fileSizeBytes: r.file_size_bytes ?? null,
    uploadedByName: r.uploaded_by_name ?? null,
    uploadedAt: r.uploaded_at ?? null,
    receiptStatus: r.receipt_status,
  };
}
function mapPaymentReceiptHistory(r: any): AdvancePaymentReceiptHistoryRow {
  return {
    id: r.id,
    fileName: r.file_name,
    storagePath: r.storage_path,
    status: r.status,
    uploadedByName: r.uploaded_by_name ?? null,
    uploadedAt: r.uploaded_at,
    replaceReason: r.replace_reason ?? null,
    replacedByReceiptId: r.replaced_by_receipt_id ?? null,
  };
}
function mapWorkflowRow(r: any): AdvanceWorkflowRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    storeName: r.store_name ?? null,
    advanceTypeName: r.advance_type_name,
    status: r.status,
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    requestedInstallmentCount: r.requested_installment_count ?? null,
    managerRecommendedInstallmentCount: r.manager_recommended_installment_count ?? null,
    bossFinalInstallmentCount: r.boss_final_installment_count ?? null,
    requestedAt: r.requested_at,
    decidedAt: r.decided_at ?? null,
    decidedByName: r.decided_by_name ?? null,
    hrProcessedAt: r.hr_processed_at ?? null,
    hrHoldReason: r.hr_hold_reason ?? null,
    hrSendBackReason: r.hr_send_back_reason ?? null,
    paymentAmount: num(r.payment_amount),
    paymentDate: r.payment_date ?? null,
    paymentModeLabel: r.payment_mode_label ?? null,
    financeHoldReason: r.finance_hold_reason ?? null,
    receiptStatus: r.receipt_status,
    totalRecovered: num(r.total_recovered),
    outstandingAmount: num(r.outstanding_amount),
    recoveryStatus: r.recovery_status ?? null,
    reason: r.reason ?? "",
    reportingManagerId: r.reporting_manager_id ?? null,
    reportingManagerName: r.reporting_manager_name ?? null,
  };
}
function mapMyRecovery(r: any): MyAdvanceRecovery {
  return {
    advanceRequestId: r.advance_request_id,
    advanceTypeName: r.advance_type_name,
    actualPaidAmount: Number(r.actual_paid_amount),
    totalRecovered: Number(r.total_recovered),
    totalSettled: Number(r.total_settled),
    outstandingAmount: Number(r.outstanding_amount),
    recoveryMethod: r.recovery_method,
    installmentCount: r.installment_count ?? null,
    monthlyAmount: num(r.monthly_amount),
    recoveryStartDate: r.recovery_start_date,
    nextDueMonth: r.next_due_month ?? null,
    completedInstallments: Number(r.completed_installments ?? 0),
    totalInstallments: Number(r.total_installments ?? 0),
    status: r.status,
    closedReason: r.closed_reason ?? null,
  };
}
function mapRecoveryPlanRow(r: any): AdvanceRecoveryPlanRow {
  return {
    advanceRequestId: r.advance_request_id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    actualPaidAmount: Number(r.actual_paid_amount),
    totalRecovered: Number(r.total_recovered),
    totalSettled: Number(r.total_settled),
    outstandingAmount: Number(r.outstanding_amount),
    recoveryMethod: r.recovery_method,
    installmentCount: r.installment_count ?? null,
    monthlyAmount: num(r.monthly_amount),
    recoveryStartDate: r.recovery_start_date,
    nextDueMonth: r.next_due_month ?? null,
    status: r.status,
    closedReason: r.closed_reason ?? null,
  };
}
function mapRecoveryDetail(r: any): AdvanceRecoveryDetail {
  return {
    advanceRequestId: r.advance_request_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    policyName: r.policy_name,
    policyVersion: Number(r.policy_version),
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    actualPaidAmount: Number(r.actual_paid_amount),
    paymentDate: r.payment_date ?? null,
    totalRecovered: Number(r.total_recovered),
    totalSettled: Number(r.total_settled),
    totalReversed: Number(r.total_reversed),
    outstandingAmount: Number(r.outstanding_amount),
    recoveryMethod: r.recovery_method,
    installmentCount: r.installment_count ?? null,
    monthlyAmount: num(r.monthly_amount),
    recoveryStartDate: r.recovery_start_date,
    nextDueMonth: r.next_due_month ?? null,
    lastDeductionDate: r.last_deduction_date ?? null,
    status: r.status,
    closedReason: r.closed_reason ?? null,
    recoveryEnabled: Boolean(r.recovery_enabled),
    allowEarlySettlement: Boolean(r.allow_early_settlement),
  };
}
function mapRecoveryInstallment(r: any): AdvanceRecoveryInstallmentRow {
  return {
    installmentNumber: Number(r.installment_number),
    dueMonth: r.due_month,
    scheduledAmount: Number(r.scheduled_amount),
    recoveredAmount: Number(r.recovered_amount),
    outstandingAfter: num(r.outstanding_after),
    status: r.status,
    processedAt: r.processed_at ?? null,
  };
}
function mapRecoveryTxn(r: any): AdvanceRecoveryTransactionRow {
  return {
    kind: r.kind,
    periodMonth: r.period_month ?? null,
    installmentNumber: r.installment_number ?? null,
    scheduledAmount: num(r.scheduled_amount),
    amount: Number(r.amount),
    openingOutstanding: Number(r.opening_outstanding),
    closingOutstanding: Number(r.closing_outstanding),
    txnDate: r.txn_date ?? null,
    actorName: r.actor_name ?? null,
    remark: r.remark ?? null,
    actedAt: r.acted_at,
  };
}
function mapPayrollPeriod(r: any): AdvancePayrollPeriod {
  return {
    id: r.id,
    companyId: r.company_id,
    periodMonth: r.period_month,
    label: r.label ?? null,
    status: r.status,
    finalizedAt: r.finalized_at ?? null,
    reversedAt: r.reversed_at ?? null,
    reverseReason: r.reverse_reason ?? null,
    deductionCount: Number(r.deduction_count ?? 0),
    deductedTotal: Number(r.deducted_total ?? 0),
  };
}
function mapFinanceAction(r: any): AdvanceFinancePaymentActionRow {
  return {
    action: r.action,
    actorEmployeeId: r.actor_employee_id,
    actorName: r.actor_name,
    oldStatus: r.old_status ?? null,
    newStatus: r.new_status ?? null,
    oldPaymentAmount: num(r.old_payment_amount),
    newPaymentAmount: num(r.new_payment_amount),
    remark: r.remark ?? null,
    actedAt: r.acted_at,
  };
}
function mapHrHistory(r: any): AdvanceHrHistoryRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    reason: r.reason,
    requestedAt: r.requested_at,
    approvalCompletedAt: r.approval_completed_at ?? null,
    status: r.status,
    hrStatus: r.hr_status ?? null,
    holdReason: r.hold_reason ?? null,
    sendBackReason: r.send_back_reason ?? null,
    processedAt: r.processed_at ?? null,
  };
}
function mapHrProcessDetail(r: any): AdvanceHrProcessDetail {
  return {
    advanceRequestId: r.advance_request_id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code ?? null,
    advanceTypeName: r.advance_type_name,
    policyName: r.policy_name,
    policyVersion: Number(r.policy_version),
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    reason: r.reason,
    remarks: r.remarks ?? null,
    requestStatus: r.request_status,
    requestedAt: r.requested_at,
    approvalCompletedAt: r.approval_completed_at ?? null,
    documentCount: Number(r.document_count ?? 0),
    hrProcessId: r.hr_process_id ?? null,
    hrStatus: r.hr_status ?? null,
    holdReason: r.hold_reason ?? null,
    sendBackReason: r.send_back_reason ?? null,
    processRemarks: r.process_remarks ?? null,
    verificationStatus: r.verification_status ?? null,
    processedByName: r.processed_by_name ?? null,
    processedAt: r.processed_at ?? null,
  };
}
function mapHrAction(r: any): AdvanceHrProcessActionRow {
  return {
    action: r.action,
    actorEmployeeId: r.actor_employee_id,
    actorName: r.actor_name,
    remark: r.remark ?? null,
    oldStatus: r.old_status ?? null,
    newStatus: r.new_status ?? null,
    actedAt: r.acted_at,
  };
}
function mapHistory(r: any): AdvanceApprovalHistoryRow {
  return {
    stepOrder: Number(r.step_order),
    actorRole: r.actor_role,
    actorEmployeeId: r.actor_employee_id,
    actorName: r.actor_name,
    action: r.action,
    oldAmount: num(r.old_amount),
    newAmount: num(r.new_amount),
    remark: r.remark ?? null,
    actedAt: r.acted_at,
  };
}

const CONFIG_EVENT_TYPES = [
  "advance_applied",
  "advance_manager_approval_required",
  "advance_boss_approval_required",
  "advance_manager_approved",
  "advance_manager_rejected",
  "advance_sent_back",
  "advance_boss_approved",
  "advance_boss_rejected",
  "advance_amount_modified",
  "advance_cancelled",
  // Phase 2 — HR
  "advance_hr_processing_required",
  "advance_hr_processed",
  "advance_hr_on_hold",
  "advance_hr_sent_back",
  "advance_ready_for_finance",
  // Phase 3 — Finance
  "advance_finance_processing_required",
  "advance_finance_processing",
  "advance_paid",
  "advance_finance_on_hold",
];

// ---------------------------------------------------------------------------
// Advance Management Ledger (migration 0154) — operational, staff-wise view.
// ---------------------------------------------------------------------------
function mapLedgerRow(r: any): AdvanceLedgerRow {
  return {
    employeeId: r.employee_id,
    employeeCode: r.employee_code ?? null,
    fullName: r.full_name,
    mobile: r.mobile ?? null,
    email: r.email ?? null,
    storeId: r.store_id ?? null,
    storeName: r.store_name ?? null,
    departmentName: r.department_name ?? null,
    designationTitle: r.designation_title ?? null,
    advanceCount: Number(r.advance_count),
    totalApproved: Number(r.total_approved),
    totalPaid: Number(r.total_paid),
    totalRecovered: Number(r.total_recovered),
    totalOutstanding: Number(r.total_outstanding),
    status: r.derived_status,
  };
}
function mapLedgerEmployeeAdvance(r: any): AdvanceLedgerEmployeeAdvance {
  return {
    advanceRequestId: r.advance_request_id,
    advanceTypeName: r.advance_type_name,
    requestDate: r.request_date,
    requestedAmount: Number(r.requested_amount),
    managerRecommendedAmount: num(r.manager_recommended_amount),
    bossApprovedAmount: num(r.boss_approved_amount),
    actualPaidAmount: num(r.actual_paid_amount),
    paymentDate: r.payment_date ?? null,
    recoveryStartDate: r.recovery_start_date ?? null,
    totalRecovered: Number(r.total_recovered),
    outstandingAmount: Number(r.outstanding_amount),
    status: r.status,
  };
}
/** Shared Args shape for advance_ledger_list / advance_ledger_summary — one filter set, one place
 *  it can drift from the other. */
function ledgerArgs(filters: AdvanceLedgerFilters) {
  return {
    p_store_id: filters.storeId ?? undefined,
    p_department_id: filters.departmentId ?? undefined,
    p_designation_id: filters.designationId ?? undefined,
    p_employee_id: filters.employeeId ?? undefined,
    p_status: filters.status ?? undefined,
    p_search: filters.search?.trim() || undefined,
    p_date_from: filters.dateFrom ?? undefined,
    p_date_to: filters.dateTo ?? undefined,
    p_show_all: filters.showAll ?? false,
  };
}

export const advanceService = {
  // ================= Masters =================
  async listTypes(companyId: string): Promise<AdvanceType[]> {
    const { data, error } = await supabase.from("advance_types").select("*").eq("company_id", companyId).order("name");
    if (error) throw error;
    return (data ?? []).map(mapType);
  },
  async upsertType(params: {
    id?: string;
    companyId: string;
    code: string;
    name: string;
    description?: string | null;
    isActive: boolean;
    requiresDocument: boolean;
    allowsMultiple: boolean;
    userId?: string | null;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      company_id: params.companyId,
      code: params.code,
      name: params.name,
      description: params.description ?? null,
      is_active: params.isActive,
      requires_document: params.requiresDocument,
      allows_multiple: params.allowsMultiple,
      updated_by: params.userId ?? null,
    };
    if (params.id) {
      const { error } = await supabase.from("advance_types").update(payload).eq("id", params.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("advance_types").insert({ ...payload, created_by: params.userId ?? null });
      if (error) throw error;
    }
  },

  // ================= Policies + Config =================
  async listPolicies(companyId: string): Promise<AdvancePolicy[]> {
    const { data, error } = await supabase
      .from("advance_policies")
      .select("*")
      .eq("company_id", companyId)
      .order("code")
      .order("version_number", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapPolicy);
  },
  async createPolicy(params: {
    companyId: string;
    name: string;
    code: string;
    description?: string | null;
    effectiveFrom: string;
    userId?: string | null;
  }): Promise<AdvancePolicy> {
    const { data, error } = await supabase
      .from("advance_policies")
      .insert({
        company_id: params.companyId,
        name: params.name,
        code: params.code,
        description: params.description ?? null,
        status: "draft",
        version_number: 1,
        effective_from: params.effectiveFrom,
        created_by: params.userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    // seed an (empty-ish) config row so the Configure form always has something to edit
    const { error: cfgError } = await supabase.from("advance_policy_configs").insert({
      company_id: params.companyId,
      policy_id: (data as any).id,
      created_by: params.userId ?? null,
    });
    if (cfgError) throw cfgError;
    return mapPolicy(data);
  },
  async setPolicyStatus(policyId: string, status: string, userId?: string | null): Promise<void> {
    const { error } = await supabase
      .from("advance_policies")
      .update({ status, updated_by: userId ?? null, approved_at: status === "active" ? new Date().toISOString() : null })
      .eq("id", policyId);
    if (error) throw error;
  },
  async getConfig(policyId: string): Promise<AdvancePolicyConfig | null> {
    const { data, error } = await supabase.from("advance_policy_configs").select("*").eq("policy_id", policyId).maybeSingle();
    if (error) throw error;
    return data ? mapConfig(data) : null;
  },
  async upsertConfig(params: {
    policyId: string;
    companyId: string;
    values: Partial<Record<string, unknown>>;
    userId?: string | null;
  }): Promise<void> {
    const { data: existing } = await supabase.from("advance_policy_configs").select("id").eq("policy_id", params.policyId).maybeSingle();
    const payload = { ...params.values, company_id: params.companyId, policy_id: params.policyId, updated_by: params.userId ?? null };
    if (existing) {
      const { error } = await supabase.from("advance_policy_configs").update(payload).eq("id", (existing as any).id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("advance_policy_configs").insert({ ...payload, created_by: params.userId ?? null });
      if (error) throw error;
    }
  },

  // ================= Assignments =================
  async listAssignments(companyId: string): Promise<AdvancePolicyAssignment[]> {
    const { data, error } = await supabase
      .from("advance_policy_assignments")
      .select("*")
      .eq("company_id", companyId)
      .order("scope_type")
      .order("effective_from", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapAssignment);
  },
  async createAssignment(params: Record<string, unknown> & { userId?: string | null }): Promise<void> {
    const { userId, ...rest } = params;
    const { error } = await supabase.from("advance_policy_assignments").insert({ ...rest, created_by: userId ?? null });
    if (error) throw error;
  },
  // ================= Policy -> Advance Type restriction (migration 0155) =================
  /** Zero rows for a policy = applies to every Advance Type (unchanged pre-0155 behavior). */
  async listPolicyTypes(policyId: string): Promise<AdvancePolicyTypeLink[]> {
    const { data, error } = await supabase.from("advance_policy_types").select("*").eq("policy_id", policyId);
    if (error) throw error;
    return (data ?? []).map(mapPolicyTypeLink);
  },
  /** Replaces the full restriction set for a policy atomically (delete-then-insert), matching the
   *  "set" semantics of a multi-select — not an incremental add/remove. */
  async setPolicyTypes(params: { policyId: string; companyId: string; advanceTypeIds: string[]; userId?: string | null }): Promise<void> {
    const { error: delError } = await supabase.from("advance_policy_types").delete().eq("policy_id", params.policyId);
    if (delError) throw delError;
    if (params.advanceTypeIds.length === 0) return;
    const { error: insError } = await supabase.from("advance_policy_types").insert(
      params.advanceTypeIds.map((advanceTypeId) => ({
        policy_id: params.policyId,
        company_id: params.companyId,
        advance_type_id: advanceTypeId,
        created_by: params.userId ?? null,
      }))
    );
    if (insError) throw insError;
  },

  // ================= Policy activation (migration 0155) =================
  /** Read-only §13 checklist — safe to call anytime, including while still Draft. */
  async validatePolicy(policyId: string): Promise<AdvancePolicyValidationItem[]> {
    const { data, error } = await supabase.rpc("advance_validate_policy", { p_policy_id: policyId });
    if (error) throw error;
    return (data ?? []).map(mapPolicyValidation);
  },
  /** The ONLY path that may set a policy to 'active' — validates server-side and archives the
   *  prior active version of the same code atomically. Throws with the exact missing items listed
   *  in the error message if validation fails. */
  async activatePolicy(policyId: string, changeReason?: string | null): Promise<AdvancePolicy> {
    const { data, error } = await supabase.rpc("advance_activate_policy", { p_policy_id: policyId, p_change_reason: changeReason ?? undefined });
    if (error) throw error;
    return mapPolicy(data);
  },

  async setAssignmentActive(id: string, isActive: boolean, userId?: string | null): Promise<void> {
    const { error } = await supabase.from("advance_policy_assignments").update({ is_active: isActive, updated_by: userId ?? null }).eq("id", id);
    if (error) throw error;
  },

  // ================= Boss / HR / Finance rosters =================
  async listFinalApprovers(companyId: string): Promise<AdvanceFinalApprover[]> {
    const { data, error } = await supabase.from("advance_final_approvers").select("*").eq("company_id", companyId).order("created_at");
    if (error) throw error;
    return (data ?? []).map(mapApprover);
  },
  async upsertFinalApprover(params: {
    id?: string;
    companyId: string;
    employeeId: string;
    isActive: boolean;
    maxApprovalLimit?: number | null;
    canModifyAmount: boolean;
    canIncreaseAmount: boolean;
    backupApproverEmployeeId?: string | null;
    remark?: string | null;
    userId?: string | null;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      company_id: params.companyId,
      employee_id: params.employeeId,
      is_active: params.isActive,
      max_approval_limit: params.maxApprovalLimit ?? null,
      can_modify_amount: params.canModifyAmount,
      can_increase_amount: params.canIncreaseAmount,
      backup_approver_employee_id: params.backupApproverEmployeeId ?? null,
      remark: params.remark ?? null,
      updated_by: params.userId ?? null,
    };
    if (params.id) {
      const { error } = await supabase.from("advance_final_approvers").update(payload).eq("id", params.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("advance_final_approvers").insert({ ...payload, created_by: params.userId ?? null });
      if (error) throw error;
    }
  },
  async removeFinalApprover(id: string): Promise<void> {
    const { error } = await supabase.from("advance_final_approvers").delete().eq("id", id);
    if (error) throw error;
  },

  async listProcessors(table: "advance_hr_processors" | "advance_finance_processors", companyId: string): Promise<AdvanceProcessor[]> {
    const { data, error } = await supabase.from(table).select("*").eq("company_id", companyId).order("created_at");
    if (error) throw error;
    return (data ?? []).map(mapProcessor);
  },
  async addProcessor(
    table: "advance_hr_processors" | "advance_finance_processors",
    params: { companyId: string; employeeId: string; remark?: string | null; userId?: string | null }
  ): Promise<void> {
    const { error } = await supabase.from(table).insert({
      company_id: params.companyId,
      employee_id: params.employeeId,
      is_active: true,
      remark: params.remark ?? null,
      created_by: params.userId ?? null,
    });
    if (error) throw error;
  },
  async setProcessorActive(
    table: "advance_hr_processors" | "advance_finance_processors",
    id: string,
    isActive: boolean,
    userId?: string | null
  ): Promise<void> {
    const { error } = await supabase.from(table).update({ is_active: isActive, updated_by: userId ?? null }).eq("id", id);
    if (error) throw error;
  },
  async removeProcessor(table: "advance_hr_processors" | "advance_finance_processors", id: string): Promise<void> {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
  },

  // ================= Notification settings =================
  async listNotificationSettings(companyId: string): Promise<AdvanceNotificationSetting[]> {
    const { data, error } = await supabase.from("advance_notification_settings").select("*").eq("company_id", companyId).order("event_type");
    if (error) throw error;
    return (data ?? []).map(mapNotificationSetting);
  },
  configEventTypes(): string[] {
    return [...CONFIG_EVENT_TYPES];
  },
  async upsertNotificationSetting(params: {
    companyId: string;
    eventType: string;
    inAppEnabled: boolean;
    pushEnabled: boolean;
    emailEnabled: boolean;
    smsEnabled: boolean;
    userId?: string | null;
  }): Promise<void> {
    const { data: existing } = await supabase
      .from("advance_notification_settings")
      .select("id")
      .eq("company_id", params.companyId)
      .eq("event_type", params.eventType)
      .maybeSingle();
    const payload: Record<string, unknown> = {
      company_id: params.companyId,
      event_type: params.eventType,
      in_app_enabled: params.inAppEnabled,
      push_enabled: params.pushEnabled,
      email_enabled: params.emailEnabled,
      sms_enabled: params.smsEnabled,
      updated_by: params.userId ?? null,
    };
    if (existing) {
      const { error } = await supabase.from("advance_notification_settings").update(payload).eq("id", (existing as any).id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("advance_notification_settings").insert({ ...payload, created_by: params.userId ?? null });
      if (error) throw error;
    }
  },

  // ================= Staff — request + my advances =================
  async getApplyContext(): Promise<AdvanceApplyContext | null> {
    const { data, error } = await supabase.rpc("advance_get_apply_context");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapApplyContext(row) : null;
  },
  async apply(params: {
    advanceTypeId: string;
    requestedAmount: number;
    reason: string;
    remarks?: string | null;
    installmentCount: number;
  }): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_apply", {
      p_advance_type_id: params.advanceTypeId,
      p_requested_amount: params.requestedAmount,
      p_reason: params.reason,
      p_remarks: params.remarks ?? undefined,
      p_installment_count: params.installmentCount,
    });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async listMyRequests(): Promise<MyAdvanceRequest[]> {
    const { data, error } = await supabase.rpc("advance_list_my_requests");
    if (error) throw error;
    return (data ?? []).map(mapMyRequest);
  },
  async cancel(requestId: string, remark?: string | null): Promise<void> {
    const { error } = await supabase.rpc("advance_cancel", { p_request_id: requestId, p_remark: remark ?? undefined });
    if (error) throw error;
  },

  // ================= Approvals =================
  async listManagerPending(): Promise<AdvanceManagerPendingRow[]> {
    const { data, error } = await supabase.rpc("advance_list_manager_pending");
    if (error) throw error;
    return (data ?? []).map(mapManagerPending);
  },
  async listBossPending(): Promise<AdvanceBossPendingRow[]> {
    const { data, error } = await supabase.rpc("advance_list_boss_pending");
    if (error) throw error;
    return (data ?? []).map(mapBossPending);
  },
  async listMyDecisions(): Promise<AdvanceMyDecisionRow[]> {
    const { data, error } = await supabase.rpc("advance_list_my_decisions");
    if (error) throw error;
    return (data ?? []).map(mapMyDecision);
  },
  async listApprovalHistory(requestId: string): Promise<AdvanceApprovalHistoryRow[]> {
    const { data, error } = await supabase.rpc("advance_list_approval_history", { p_request_id: requestId });
    if (error) throw error;
    return (data ?? []).map(mapHistory);
  },
  async managerDecide(params: {
    requestId: string;
    decision: AdvanceDecision;
    recommendedAmount?: number | null;
    remark?: string | null;
    recommendedInstallmentCount?: number | null;
  }): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_manager_decide", {
      p_request_id: params.requestId,
      p_decision: params.decision,
      p_recommended_amount: params.recommendedAmount ?? undefined,
      p_remark: params.remark ?? undefined,
      p_recommended_installment_count: params.recommendedInstallmentCount ?? undefined,
    });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async bossDecide(params: {
    requestId: string;
    decision: AdvanceDecision;
    approvedAmount?: number | null;
    modificationReason?: string | null;
    remark?: string | null;
    finalInstallmentCount?: number | null;
  }): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_boss_decide", {
      p_request_id: params.requestId,
      p_decision: params.decision,
      p_approved_amount: params.approvedAmount ?? undefined,
      p_modification_reason: params.modificationReason ?? undefined,
      p_remark: params.remark ?? undefined,
      p_final_installment_count: params.finalInstallmentCount ?? undefined,
    });
    if (error) throw error;
    return mapMyRequest(data);
  },

  // ================= Phase 2 — HR Process Execution =================
  async listHrPending(): Promise<AdvanceHrPendingRow[]> {
    const { data, error } = await supabase.rpc("advance_list_hr_pending");
    if (error) throw error;
    return (data ?? []).map(mapHrPending);
  },
  async listHrHistory(): Promise<AdvanceHrHistoryRow[]> {
    const { data, error } = await supabase.rpc("advance_list_hr_history");
    if (error) throw error;
    return (data ?? []).map(mapHrHistory);
  },
  async getHrProcess(requestId: string): Promise<AdvanceHrProcessDetail | null> {
    const { data, error } = await supabase.rpc("advance_get_hr_process", { p_advance_request_id: requestId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapHrProcessDetail(row) : null;
  },
  async listHrProcessActions(requestId: string): Promise<AdvanceHrProcessActionRow[]> {
    const { data, error } = await supabase.rpc("advance_list_hr_process_actions", { p_advance_request_id: requestId });
    if (error) throw error;
    return (data ?? []).map(mapHrAction);
  },
  async hrProcess(requestId: string, remarks?: string | null): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_hr_process", { p_advance_request_id: requestId, p_remarks: remarks ?? undefined });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async hrHold(requestId: string, reason: string): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_hr_hold", { p_advance_request_id: requestId, p_reason: reason });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async hrSendBack(requestId: string, reason: string): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_hr_send_back", { p_advance_request_id: requestId, p_reason: reason });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async hrResume(requestId: string, remark?: string | null): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_hr_resume", { p_advance_request_id: requestId, p_remark: remark ?? undefined });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async amIHr(employeeId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("advance_am_i_hr", { p_employee_id: employeeId });
    if (error) throw error;
    return Boolean(data);
  },

  // ================= Phase 3 — Finance Payment =================
  async listPaymentModes(companyId: string, activeOnly = false): Promise<AdvancePaymentMode[]> {
    let q = supabase.from("advance_payment_modes").select("*").eq("company_id", companyId).order("sort_order").order("name");
    if (activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(mapPaymentMode);
  },
  async upsertPaymentMode(params: {
    id?: string;
    companyId: string;
    code: string;
    name: string;
    description?: string | null;
    isActive: boolean;
    requiresReference: boolean;
    sortOrder: number;
    userId?: string | null;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      company_id: params.companyId,
      code: params.code,
      name: params.name,
      description: params.description ?? null,
      is_active: params.isActive,
      requires_reference: params.requiresReference,
      sort_order: params.sortOrder,
      updated_by: params.userId ?? null,
    };
    if (params.id) {
      const { error } = await supabase.from("advance_payment_modes").update(payload).eq("id", params.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("advance_payment_modes").insert({ ...payload, created_by: params.userId ?? null });
      if (error) throw error;
    }
  },

  async listFinancePending(): Promise<AdvanceFinancePendingRow[]> {
    const { data, error } = await supabase.rpc("advance_list_finance_pending");
    if (error) throw error;
    return (data ?? []).map(mapFinancePending);
  },
  async listFinanceHistory(): Promise<AdvanceFinanceHistoryRow[]> {
    const { data, error } = await supabase.rpc("advance_list_finance_history");
    if (error) throw error;
    return (data ?? []).map(mapFinanceHistory);
  },
  async getFinancePayment(requestId: string): Promise<AdvanceFinancePaymentDetail | null> {
    const { data, error } = await supabase.rpc("advance_get_finance_payment", { p_advance_request_id: requestId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapFinancePaymentDetail(row) : null;
  },
  async listFinancePaymentActions(requestId: string): Promise<AdvanceFinancePaymentActionRow[]> {
    const { data, error } = await supabase.rpc("advance_list_finance_payment_actions", { p_advance_request_id: requestId });
    if (error) throw error;
    return (data ?? []).map(mapFinanceAction);
  },
  async financeStart(requestId: string): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_finance_start", { p_advance_request_id: requestId });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async financePay(params: {
    requestId: string;
    paymentAmount: number;
    paymentDate: string;
    paymentModeId: string;
    transactionReference?: string | null;
    utrNumber?: string | null;
    bankReference?: string | null;
    paymentRemarks?: string | null;
    paymentProofPath?: string | null;
  }): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_finance_pay", {
      p_advance_request_id: params.requestId,
      p_payment_amount: params.paymentAmount,
      p_payment_date: params.paymentDate,
      p_payment_mode_id: params.paymentModeId,
      p_transaction_reference: params.transactionReference ?? undefined,
      p_utr_number: params.utrNumber ?? undefined,
      p_bank_reference: params.bankReference ?? undefined,
      p_payment_remarks: params.paymentRemarks ?? undefined,
      p_payment_proof_path: params.paymentProofPath ?? undefined,
    });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async financeHold(requestId: string, reason: string): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_finance_hold", { p_advance_request_id: requestId, p_reason: reason });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async financeResume(requestId: string, remark?: string | null): Promise<MyAdvanceRequest> {
    const { data, error } = await supabase.rpc("advance_finance_resume", { p_advance_request_id: requestId, p_remark: remark ?? undefined });
    if (error) throw error;
    return mapMyRequest(data);
  },
  async amIFinance(employeeId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("advance_am_i_finance", { p_employee_id: employeeId });
    if (error) throw error;
    return Boolean(data);
  },
  /** Uploads a payment proof to the private advance-payment-proofs bucket
   *  (path: company_id/advance_request_id/timestamp_filename) and returns the storage path. */
  async uploadPaymentProof(params: { companyId: string; advanceRequestId: string; file: File }): Promise<string> {
    const safeName = params.file.name.replace(/[^\w.\-]+/g, "_");
    const storagePath = `${params.companyId}/${params.advanceRequestId}/${Date.now()}_${safeName}`;
    const { error } = await supabase.storage
      .from("advance-payment-proofs")
      .upload(storagePath, params.file, { contentType: params.file.type || undefined, upsert: false });
    if (error) throw error;
    return storagePath;
  },
  async getPaymentProofSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await supabase.storage.from("advance-payment-proofs").createSignedUrl(storagePath, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  },

  // ================= Advance Payment Receipt Management (migration 0160) =================
  // Post-payment signed employee receipt — distinct from the at-payment-time payment proof
  // above. Reuses the SAME private bucket/path convention (company_id/advance_request_id/
  // timestamp_filename), never a second bucket.
  async uploadPaymentReceiptFile(params: { companyId: string; advanceRequestId: string; file: File }): Promise<string> {
    const safeName = params.file.name.replace(/[^\w.\-]+/g, "_");
    const storagePath = `${params.companyId}/${params.advanceRequestId}/${Date.now()}_${safeName}`;
    const { error } = await supabase.storage
      .from("advance-payment-proofs")
      .upload(storagePath, params.file, { contentType: params.file.type || undefined, upsert: false });
    if (error) throw error;
    return storagePath;
  },
  async uploadPaymentReceipt(params: {
    requestId: string;
    storagePath: string;
    fileName: string;
    mimeType?: string | null;
    fileSizeBytes?: number | null;
  }): Promise<void> {
    const { error } = await supabase.rpc("advance_finance_upload_receipt", {
      p_advance_request_id: params.requestId,
      p_storage_path: params.storagePath,
      p_file_name: params.fileName,
      p_mime_type: params.mimeType ?? undefined,
      p_file_size_bytes: params.fileSizeBytes ?? undefined,
    });
    if (error) throw error;
  },
  async replacePaymentReceipt(params: {
    requestId: string;
    storagePath: string;
    fileName: string;
    reason: string;
    mimeType?: string | null;
    fileSizeBytes?: number | null;
  }): Promise<void> {
    const { error } = await supabase.rpc("advance_finance_replace_receipt", {
      p_advance_request_id: params.requestId,
      p_storage_path: params.storagePath,
      p_file_name: params.fileName,
      p_reason: params.reason,
      p_mime_type: params.mimeType ?? undefined,
      p_file_size_bytes: params.fileSizeBytes ?? undefined,
    });
    if (error) throw error;
  },
  async getPaymentReceipt(requestId: string): Promise<AdvancePaymentReceipt | null> {
    const { data, error } = await supabase.rpc("advance_get_payment_receipt", { p_advance_request_id: requestId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapPaymentReceipt(row) : null;
  },
  async listPaymentReceiptHistory(requestId: string): Promise<AdvancePaymentReceiptHistoryRow[]> {
    const { data, error } = await supabase.rpc("advance_list_payment_receipt_history", { p_advance_request_id: requestId });
    if (error) throw error;
    return (data ?? []).map(mapPaymentReceiptHistory);
  },

  // ================= Phase 4 — Payroll Recovery =================
  async listMyRecoveries(): Promise<MyAdvanceRecovery[]> {
    const { data, error } = await supabase.rpc("advance_list_my_recoveries");
    if (error) throw error;
    return (data ?? []).map(mapMyRecovery);
  },
  async listRecoveryPlans(status?: string | null): Promise<AdvanceRecoveryPlanRow[]> {
    const { data, error } = await supabase.rpc("advance_recovery_list_plans", { p_status: status ?? undefined });
    if (error) throw error;
    return (data ?? []).map(mapRecoveryPlanRow);
  },
  async getRecoveryDetail(requestId: string): Promise<AdvanceRecoveryDetail | null> {
    const { data, error } = await supabase.rpc("advance_get_recovery_detail", { p_advance_request_id: requestId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapRecoveryDetail(row) : null;
  },
  async listRecoveryInstallments(requestId: string): Promise<AdvanceRecoveryInstallmentRow[]> {
    const { data, error } = await supabase.rpc("advance_list_recovery_installments", { p_advance_request_id: requestId });
    if (error) throw error;
    return (data ?? []).map(mapRecoveryInstallment);
  },
  async listRecoveryTransactions(requestId: string): Promise<AdvanceRecoveryTransactionRow[]> {
    const { data, error } = await supabase.rpc("advance_list_recovery_transactions", { p_advance_request_id: requestId });
    if (error) throw error;
    return (data ?? []).map(mapRecoveryTxn);
  },
  async listPayrollPeriods(): Promise<AdvancePayrollPeriod[]> {
    const { data, error } = await supabase.rpc("advance_recovery_list_periods");
    if (error) throw error;
    return (data ?? []).map(mapPayrollPeriod);
  },
  async generateRecoveryPlan(params: {
    requestId: string;
    startDate?: string | null;
    installmentCount?: number | null;
    monthlyAmount?: number | null;
  }): Promise<void> {
    const { error } = await supabase.rpc("advance_recovery_generate_plan", {
      p_advance_request_id: params.requestId,
      p_start_date: params.startDate ?? undefined,
      p_installment_count: params.installmentCount ?? undefined,
      p_monthly_amount: params.monthlyAmount ?? undefined,
    });
    if (error) throw error;
  },
  async createPayrollPeriod(params: { periodMonth: string; companyId?: string | null; label?: string | null }): Promise<void> {
    const { error } = await supabase.rpc("advance_recovery_create_period", {
      p_period_month: params.periodMonth,
      p_company_id: params.companyId ?? undefined,
      p_label: params.label ?? undefined,
    });
    if (error) throw error;
  },
  async runPayrollPeriod(
    periodId: string,
    employeeId?: string | null
  ): Promise<Array<{ advanceRequestId: string; employeeName: string; installmentNumber: number; deductedAmount: number; closingOutstanding: number; planStatus: string }>> {
    const { data, error } = await supabase.rpc("advance_recovery_run_period", { p_payroll_period_id: periodId, p_employee_id: employeeId ?? undefined });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      advanceRequestId: r.advance_request_id,
      employeeName: r.employee_name,
      installmentNumber: Number(r.installment_number),
      deductedAmount: Number(r.deducted_amount),
      closingOutstanding: Number(r.closing_outstanding),
      planStatus: r.plan_status,
    }));
  },
  async finalizePayrollPeriod(periodId: string): Promise<void> {
    const { error } = await supabase.rpc("advance_recovery_finalize_period", { p_payroll_period_id: periodId });
    if (error) throw error;
  },
  async reversePayrollPeriod(periodId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc("advance_recovery_reverse_period", { p_payroll_period_id: periodId, p_reason: reason });
    if (error) throw error;
  },
  async settleRecovery(params: {
    requestId: string;
    settlementAmount: number;
    settlementDate: string;
    paymentModeId?: string | null;
    transactionReference?: string | null;
    remarks?: string | null;
  }): Promise<void> {
    const { error } = await supabase.rpc("advance_recovery_settle", {
      p_advance_request_id: params.requestId,
      p_settlement_amount: params.settlementAmount,
      p_settlement_date: params.settlementDate,
      p_payment_mode_id: params.paymentModeId ?? undefined,
      p_transaction_reference: params.transactionReference ?? undefined,
      p_remarks: params.remarks ?? undefined,
    });
    if (error) throw error;
  },
  async closeRecovery(requestId: string, remark?: string | null): Promise<void> {
    const { error } = await supabase.rpc("advance_recovery_close", { p_advance_request_id: requestId, p_remark: remark ?? undefined });
    if (error) throw error;
  },

  // ================= HR Recovery Schedule Adjustment (migration 0157) =================
  /** Adjusts one still-unprocessed installment and redistributes the remainder across the
   *  remaining future periods. HR Processor only; blocked server-side once that month's payroll is
   *  finalized. Returns the resulting full schedule. */
  async adjustRecoveryInstallment(params: {
    advanceRequestId: string;
    installmentNumber: number;
    newAmount: number;
    reason: string;
    newFutureInstallmentCount?: number | null;
  }): Promise<Array<{ installmentNumber: number; dueMonth: string; scheduledAmount: number; status: string }>> {
    const { data, error } = await supabase.rpc("advance_recovery_adjust_installment", {
      p_advance_request_id: params.advanceRequestId,
      p_installment_number: params.installmentNumber,
      p_new_amount: params.newAmount,
      p_reason: params.reason,
      p_new_future_installment_count: params.newFutureInstallmentCount ?? undefined,
    });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      installmentNumber: Number(r.installment_number),
      dueMonth: r.due_month,
      scheduledAmount: Number(r.scheduled_amount),
      status: r.status,
    }));
  },
  async listRecoveryInstallmentAdjustments(requestId: string): Promise<AdvanceRecoveryInstallmentAdjustment[]> {
    const { data, error } = await supabase.rpc("advance_list_recovery_installment_adjustments", { p_advance_request_id: requestId });
    if (error) throw error;
    return (data ?? []).map(mapInstallmentAdjustment);
  },

  // ================= Assignment-scope lookups =================
  async listStores(companyId: string): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await supabase.from("stores").select("id, name").eq("company_id", companyId).order("name");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.name }));
  },
  async listStoreDepartments(companyId: string): Promise<Array<{ id: string; label: string }>> {
    const { data: stores, error: se } = await supabase.from("stores").select("id, name").eq("company_id", companyId);
    if (se) throw se;
    const storeName = new Map((stores ?? []).map((s: any) => [s.id, s.name]));
    const ids = (stores ?? []).map((s: any) => s.id);
    if (!ids.length) return [];
    const { data, error } = await supabase.from("store_departments").select("id, name, store_id").in("store_id", ids).order("name");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, label: `${r.name} — ${storeName.get(r.store_id) ?? "Store"}` }));
  },
  async listStoreDesignations(companyId: string): Promise<Array<{ id: string; label: string }>> {
    const { data: stores, error: se } = await supabase.from("stores").select("id, name").eq("company_id", companyId);
    if (se) throw se;
    const storeName = new Map((stores ?? []).map((s: any) => [s.id, s.name]));
    const ids = (stores ?? []).map((s: any) => s.id);
    if (!ids.length) return [];
    const { data, error } = await supabase.from("store_designations").select("id, title, store_id").in("store_id", ids).order("title");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, label: `${r.title} — ${storeName.get(r.store_id) ?? "Store"}` }));
  },

  // ================= Authority probes =================
  async amIManager(employeeId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("advance_am_i_manager", { p_employee_id: employeeId });
    if (error) throw error;
    return Boolean(data);
  },
  async amIBoss(employeeId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("advance_am_i_boss", { p_employee_id: employeeId });
    if (error) throw error;
    return Boolean(data);
  },

  // ================= Advance Management Ledger (migration 0154) =================
  /** Store dropdown — server-enforced: only stores the caller is authorized to see. */
  async listLedgerStores(): Promise<AdvanceLedgerStoreOption[]> {
    const { data, error } = await supabase.rpc("advance_ledger_stores");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.name }));
  },
  /** Departments/designations for a specific store — reuses the existing store_departments /
   *  store_designations tables directly (RLS already scopes them to the caller's company). */
  async listStoreDepartmentsForStore(storeId: string): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await supabase.from("store_departments").select("id, name").eq("store_id", storeId).order("name");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.name }));
  },
  async listStoreDesignationsForStore(storeId: string): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await supabase.from("store_designations").select("id, title").eq("store_id", storeId).order("title");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.title }));
  },
  async ledgerList(filters: AdvanceLedgerFilters, page: { limit: number; offset: number }): Promise<AdvanceLedgerListResult> {
    const { data, error } = await supabase.rpc("advance_ledger_list", {
      ...ledgerArgs(filters),
      p_limit: page.limit,
      p_offset: page.offset,
    });
    if (error) throw error;
    const rows = (data ?? []).map(mapLedgerRow);
    const totalCount = data && data.length > 0 ? Number((data[0] as any).total_count) : 0;
    return { rows, totalCount };
  },
  async ledgerSummary(filters: AdvanceLedgerFilters): Promise<AdvanceLedgerSummary> {
    const { data, error } = await supabase.rpc("advance_ledger_summary", ledgerArgs(filters));
    if (error) throw error;
    const r: any = (data ?? [])[0] ?? {};
    return {
      totalStaff: Number(r.total_staff ?? 0),
      totalApproved: Number(r.total_approved ?? 0),
      totalPaid: Number(r.total_paid ?? 0),
      totalRecovered: Number(r.total_recovered ?? 0),
      totalOutstanding: Number(r.total_outstanding ?? 0),
    };
  },
  async ledgerEmployeeAdvances(employeeId: string): Promise<AdvanceLedgerEmployeeAdvance[]> {
    const { data, error } = await supabase.rpc("advance_ledger_employee_advances", { p_employee_id: employeeId });
    if (error) throw error;
    return (data ?? []).map(mapLedgerEmployeeAdvance);
  },

  // ================= HR Panel Advance Workflow consolidation (migration 0168) =================
  /** ONE read-only row per advance request, for the unified "Approvals -> Advance" screen.
   *  View-only — every action still goes through the existing decide/process/pay/receipt/recovery
   *  RPCs used elsewhere in this file. */
  async listHrWorkflow(): Promise<AdvanceWorkflowRow[]> {
    const { data, error } = await supabase.rpc("advance_hr_workflow_list");
    if (error) throw error;
    return (data ?? []).map(mapWorkflowRow);
  },
};
