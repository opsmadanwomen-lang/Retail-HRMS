import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { advanceService } from "@/services/advanceService";
import type { AdvanceLedgerFilters } from "@/types/advance";

const ADVANCE_KEY = ["advance"] as const;

// ---------------- Masters ----------------
export function useAdvanceTypes(companyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "types", companyId],
    queryFn: () => advanceService.listTypes(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useUpsertAdvanceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.upsertType>[0]) => advanceService.upsertType(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "types"] }),
  });
}

// ---------------- Policies + config ----------------
export function useAdvancePolicies(companyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "policies", companyId],
    queryFn: () => advanceService.listPolicies(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useCreateAdvancePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.createPolicy>[0]) => advanceService.createPolicy(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "policies"] }),
  });
}
export function useSetAdvancePolicyStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { policyId: string; status: string; userId?: string | null }) =>
      advanceService.setPolicyStatus(params.policyId, params.status, params.userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "policies"] }),
  });
}
export function useAdvancePolicyConfig(policyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "config", policyId],
    queryFn: () => advanceService.getConfig(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function useUpsertAdvancePolicyConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.upsertConfig>[0]) => advanceService.upsertConfig(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "config"] }),
  });
}

// ---------------- Assignments ----------------
export function useAdvanceAssignments(companyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "assignments", companyId],
    queryFn: () => advanceService.listAssignments(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useCreateAdvanceAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.createAssignment>[0]) => advanceService.createAssignment(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "assignments"] }),
  });
}
export function useSetAdvanceAssignmentActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; isActive: boolean; userId?: string | null }) =>
      advanceService.setAssignmentActive(params.id, params.isActive, params.userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "assignments"] }),
  });
}

// ---------------- Policy -> Advance Type restriction + activation (migration 0155) ----------------
export function useAdvancePolicyTypes(policyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "policy-types", policyId],
    queryFn: () => advanceService.listPolicyTypes(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function useSetAdvancePolicyTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.setPolicyTypes>[0]) => advanceService.setPolicyTypes(params),
    onSuccess: (_data, params) => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "policy-types", params.policyId] }),
  });
}
export function useValidateAdvancePolicy(policyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "policy-validate", policyId],
    queryFn: () => advanceService.validatePolicy(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function useActivateAdvancePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { policyId: string; changeReason?: string | null }) => advanceService.activatePolicy(params.policyId, params.changeReason),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "policies"] }),
  });
}

// ---------------- Boss / HR / Finance rosters ----------------
export function useAdvanceFinalApprovers(companyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "final-approvers", companyId],
    queryFn: () => advanceService.listFinalApprovers(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useUpsertAdvanceFinalApprover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.upsertFinalApprover>[0]) => advanceService.upsertFinalApprover(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "final-approvers"] }),
  });
}
export function useRemoveAdvanceFinalApprover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => advanceService.removeFinalApprover(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "final-approvers"] }),
  });
}
type ProcessorTable = "advance_hr_processors" | "advance_finance_processors";
export function useAdvanceProcessors(table: ProcessorTable, companyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "processors", table, companyId],
    queryFn: () => advanceService.listProcessors(table, companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useAddAdvanceProcessor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { table: ProcessorTable; companyId: string; employeeId: string; remark?: string | null; userId?: string | null }) =>
      advanceService.addProcessor(params.table, params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "processors"] }),
  });
}
export function useSetAdvanceProcessorActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { table: ProcessorTable; id: string; isActive: boolean; userId?: string | null }) =>
      advanceService.setProcessorActive(params.table, params.id, params.isActive, params.userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "processors"] }),
  });
}
export function useRemoveAdvanceProcessor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { table: ProcessorTable; id: string }) => advanceService.removeProcessor(params.table, params.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "processors"] }),
  });
}

// ---------------- Notification settings ----------------
export function useAdvanceNotificationSettings(companyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "notification-settings", companyId],
    queryFn: () => advanceService.listNotificationSettings(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useUpsertAdvanceNotificationSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.upsertNotificationSetting>[0]) =>
      advanceService.upsertNotificationSetting(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "notification-settings"] }),
  });
}

// ---------------- Staff — request + my advances ----------------
export function useAdvanceApplyContext(enabled = true) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "apply-context"],
    queryFn: () => advanceService.getApplyContext(),
    enabled,
  });
}
export function useApplyAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.apply>[0]) => advanceService.apply(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "my-requests"] });
      qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "apply-context"] });
    },
  });
}
export function useMyAdvanceRequests() {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "my-requests"],
    queryFn: () => advanceService.listMyRequests(),
  });
}
export function useCancelAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; remark?: string | null }) => advanceService.cancel(params.requestId, params.remark),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "my-requests"] });
      qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "apply-context"] });
    },
  });
}

// ---------------- Approvals ----------------
export function useAdvanceManagerPending() {
  return useQuery({ queryKey: [...ADVANCE_KEY, "manager-pending"], queryFn: () => advanceService.listManagerPending() });
}
export function useAdvanceBossPending() {
  return useQuery({ queryKey: [...ADVANCE_KEY, "boss-pending"], queryFn: () => advanceService.listBossPending() });
}
export function useAdvanceMyDecisions() {
  return useQuery({ queryKey: [...ADVANCE_KEY, "my-decisions"], queryFn: () => advanceService.listMyDecisions() });
}
export function useAdvanceApprovalHistory(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "approval-history", requestId],
    queryFn: () => advanceService.listApprovalHistory(requestId as string),
    enabled: Boolean(requestId),
  });
}
function invalidateApprovalQueues(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "manager-pending"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "boss-pending"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "my-decisions"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "my-requests"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "hr-workflow"] });
}
export function useAdvanceManagerDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.managerDecide>[0]) => advanceService.managerDecide(params),
    onSuccess: () => invalidateApprovalQueues(qc),
  });
}
export function useAdvanceBossDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.bossDecide>[0]) => advanceService.bossDecide(params),
    onSuccess: () => invalidateApprovalQueues(qc),
  });
}

// ---------------- Phase 2 — HR Process Execution ----------------
export function useAdvanceHrPending(enabled = true) {
  return useQuery({ queryKey: [...ADVANCE_KEY, "hr-pending"], queryFn: () => advanceService.listHrPending(), enabled });
}
export function useAdvanceHrHistory(enabled = true) {
  return useQuery({ queryKey: [...ADVANCE_KEY, "hr-history"], queryFn: () => advanceService.listHrHistory(), enabled });
}
export function useAdvanceHrProcess(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "hr-process", requestId],
    queryFn: () => advanceService.getHrProcess(requestId as string),
    enabled: Boolean(requestId),
  });
}
export function useAdvanceHrProcessActions(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "hr-process-actions", requestId],
    queryFn: () => advanceService.listHrProcessActions(requestId as string),
    enabled: Boolean(requestId),
  });
}
function invalidateHrQueues(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "hr-pending"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "hr-history"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "hr-process"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "hr-process-actions"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "my-requests"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "hr-workflow"] });
}
export function useAdvanceHrProcessAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; remarks?: string | null }) => advanceService.hrProcess(params.requestId, params.remarks),
    onSuccess: () => invalidateHrQueues(qc),
  });
}
export function useAdvanceHrHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; reason: string }) => advanceService.hrHold(params.requestId, params.reason),
    onSuccess: () => invalidateHrQueues(qc),
  });
}
export function useAdvanceHrSendBack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; reason: string }) => advanceService.hrSendBack(params.requestId, params.reason),
    onSuccess: () => invalidateHrQueues(qc),
  });
}
export function useAdvanceHrResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; remark?: string | null }) => advanceService.hrResume(params.requestId, params.remark),
    onSuccess: () => invalidateHrQueues(qc),
  });
}
export function useAmIAdvanceHr(employeeId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "am-i-hr", employeeId],
    queryFn: () => advanceService.amIHr(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

// ---------------- Phase 3 — Finance Payment ----------------
export function useAdvancePaymentModes(companyId?: string, activeOnly = false) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "payment-modes", companyId, activeOnly],
    queryFn: () => advanceService.listPaymentModes(companyId as string, activeOnly),
    enabled: Boolean(companyId),
  });
}
export function useUpsertAdvancePaymentMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.upsertPaymentMode>[0]) => advanceService.upsertPaymentMode(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "payment-modes"] }),
  });
}
export function useAdvanceFinancePending(enabled = true) {
  return useQuery({ queryKey: [...ADVANCE_KEY, "finance-pending"], queryFn: () => advanceService.listFinancePending(), enabled });
}
export function useAdvanceFinanceHistory(enabled = true) {
  return useQuery({ queryKey: [...ADVANCE_KEY, "finance-history"], queryFn: () => advanceService.listFinanceHistory(), enabled });
}
export function useAdvanceFinancePayment(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "finance-payment", requestId],
    queryFn: () => advanceService.getFinancePayment(requestId as string),
    enabled: Boolean(requestId),
  });
}
export function useAdvanceFinancePaymentActions(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "finance-payment-actions", requestId],
    queryFn: () => advanceService.listFinancePaymentActions(requestId as string),
    enabled: Boolean(requestId),
  });
}
function invalidateFinanceQueues(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "finance-pending"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "finance-history"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "finance-payment"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "finance-payment-actions"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "my-requests"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "hr-workflow"] });
}
export function useAdvanceFinanceStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => advanceService.financeStart(requestId),
    onSuccess: () => invalidateFinanceQueues(qc),
  });
}
export function useAdvanceFinancePay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.financePay>[0]) => advanceService.financePay(params),
    onSuccess: () => invalidateFinanceQueues(qc),
  });
}
export function useAdvanceFinanceHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; reason: string }) => advanceService.financeHold(params.requestId, params.reason),
    onSuccess: () => invalidateFinanceQueues(qc),
  });
}
export function useAdvanceFinanceResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; remark?: string | null }) => advanceService.financeResume(params.requestId, params.remark),
    onSuccess: () => invalidateFinanceQueues(qc),
  });
}
export function useAmIAdvanceFinance(employeeId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "am-i-finance", employeeId],
    queryFn: () => advanceService.amIFinance(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

// ---------------- Advance Payment Receipt Management (migration 0160) ----------------
export function useAdvancePaymentReceipt(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "payment-receipt", requestId],
    queryFn: () => advanceService.getPaymentReceipt(requestId as string),
    enabled: Boolean(requestId),
  });
}
export function usePaymentReceiptHistory(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "payment-receipt-history", requestId],
    queryFn: () => advanceService.listPaymentReceiptHistory(requestId as string),
    enabled: Boolean(requestId),
  });
}
function invalidateReceiptQueues(qc: ReturnType<typeof useQueryClient>, requestId?: string) {
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "payment-receipt", requestId] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "payment-receipt-history", requestId] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "hr-workflow"] });
}
export function useUploadPaymentReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.uploadPaymentReceipt>[0]) => advanceService.uploadPaymentReceipt(params),
    onSuccess: (_d, params) => invalidateReceiptQueues(qc, params.requestId),
  });
}
export function useReplacePaymentReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.replacePaymentReceipt>[0]) => advanceService.replacePaymentReceipt(params),
    onSuccess: (_d, params) => invalidateReceiptQueues(qc, params.requestId),
  });
}

// ---------------- Phase 4 — Payroll Recovery ----------------
export function useMyAdvanceRecoveries() {
  return useQuery({ queryKey: [...ADVANCE_KEY, "my-recoveries"], queryFn: () => advanceService.listMyRecoveries() });
}
export function useAdvanceRecoveryPlans(status?: string | null, enabled = true) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "recovery-plans", status ?? "all"],
    queryFn: () => advanceService.listRecoveryPlans(status),
    enabled,
  });
}
export function useAdvanceRecoveryDetail(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "recovery-detail", requestId],
    queryFn: () => advanceService.getRecoveryDetail(requestId as string),
    enabled: Boolean(requestId),
  });
}
export function useAdvanceRecoveryInstallments(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "recovery-installments", requestId],
    queryFn: () => advanceService.listRecoveryInstallments(requestId as string),
    enabled: Boolean(requestId),
  });
}
export function useAdvanceRecoveryTransactions(requestId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "recovery-transactions", requestId],
    queryFn: () => advanceService.listRecoveryTransactions(requestId as string),
    enabled: Boolean(requestId),
  });
}
export function useAdvancePayrollPeriods(enabled = true) {
  return useQuery({ queryKey: [...ADVANCE_KEY, "payroll-periods"], queryFn: () => advanceService.listPayrollPeriods(), enabled });
}
function invalidateRecovery(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "my-recoveries"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "recovery-plans"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "recovery-detail"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "recovery-installments"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "recovery-transactions"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "payroll-periods"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "my-requests"] });
  qc.invalidateQueries({ queryKey: [...ADVANCE_KEY, "hr-workflow"] });
}
export function useGenerateRecoveryPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.generateRecoveryPlan>[0]) => advanceService.generateRecoveryPlan(params),
    onSuccess: () => invalidateRecovery(qc),
  });
}
export function useCreatePayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.createPayrollPeriod>[0]) => advanceService.createPayrollPeriod(params),
    onSuccess: () => invalidateRecovery(qc),
  });
}
export function useRunPayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { periodId: string; employeeId?: string | null }) => advanceService.runPayrollPeriod(params.periodId, params.employeeId),
    onSuccess: () => invalidateRecovery(qc),
  });
}
export function useFinalizePayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (periodId: string) => advanceService.finalizePayrollPeriod(periodId),
    onSuccess: () => invalidateRecovery(qc),
  });
}
export function useReversePayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { periodId: string; reason: string }) => advanceService.reversePayrollPeriod(params.periodId, params.reason),
    onSuccess: () => invalidateRecovery(qc),
  });
}
export function useSettleRecovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.settleRecovery>[0]) => advanceService.settleRecovery(params),
    onSuccess: () => invalidateRecovery(qc),
  });
}
export function useCloseRecovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; remark?: string | null }) => advanceService.closeRecovery(params.requestId, params.remark),
    onSuccess: () => invalidateRecovery(qc),
  });
}

// ---------------- HR Recovery Schedule Adjustment (migration 0157) ----------------
export function useAdjustRecoveryInstallment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof advanceService.adjustRecoveryInstallment>[0]) => advanceService.adjustRecoveryInstallment(params),
    onSuccess: () => invalidateRecovery(qc),
  });
}
export function useRecoveryInstallmentAdjustments(requestId?: string | null) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "recovery-installment-adjustments", requestId],
    queryFn: () => advanceService.listRecoveryInstallmentAdjustments(requestId as string),
    enabled: Boolean(requestId),
  });
}

// ---------------- Assignment-scope lookups ----------------
export function useAdvanceStores(companyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "lookup-stores", companyId],
    queryFn: () => advanceService.listStores(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useAdvanceStoreDepartments(companyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "lookup-departments", companyId],
    queryFn: () => advanceService.listStoreDepartments(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useAdvanceStoreDesignations(companyId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "lookup-designations", companyId],
    queryFn: () => advanceService.listStoreDesignations(companyId as string),
    enabled: Boolean(companyId),
  });
}

// ---------------- Authority probes ----------------
export function useAmIAdvanceManager(employeeId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "am-i-manager", employeeId],
    queryFn: () => advanceService.amIManager(employeeId as string),
    enabled: Boolean(employeeId),
  });
}
export function useAmIAdvanceBoss(employeeId?: string) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "am-i-boss", employeeId],
    queryFn: () => advanceService.amIBoss(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

// ---------------- Advance Management Ledger (migration 0154) ----------------
export function useAdvanceLedgerStores(enabled: boolean = true) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "ledger-stores"],
    queryFn: () => advanceService.listLedgerStores(),
    enabled,
  });
}
export function useLedgerStoreDepartments(storeId?: string | null) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "ledger-departments", storeId],
    queryFn: () => advanceService.listStoreDepartmentsForStore(storeId as string),
    enabled: Boolean(storeId),
  });
}
export function useLedgerStoreDesignations(storeId?: string | null) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "ledger-designations", storeId],
    queryFn: () => advanceService.listStoreDesignationsForStore(storeId as string),
    enabled: Boolean(storeId),
  });
}
/** `enabled` gates the query on a Store having been picked first — the operational ledger never
 *  loads company-wide by accident. */
export function useAdvanceLedgerList(filters: AdvanceLedgerFilters, page: { limit: number; offset: number }, enabled: boolean) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "ledger-list", filters, page],
    queryFn: () => advanceService.ledgerList(filters, page),
    enabled,
    placeholderData: (prev) => prev,
  });
}
export function useAdvanceLedgerSummary(filters: AdvanceLedgerFilters, enabled: boolean) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "ledger-summary", filters],
    queryFn: () => advanceService.ledgerSummary(filters),
    enabled,
    placeholderData: (prev) => prev,
  });
}
export function useAdvanceLedgerEmployeeAdvances(employeeId?: string | null) {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "ledger-employee-advances", employeeId],
    queryFn: () => advanceService.ledgerEmployeeAdvances(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

// ---------------- HR Panel Advance Workflow consolidation (migration 0168) ----------------
export function useAdvanceHrWorkflow() {
  return useQuery({
    queryKey: [...ADVANCE_KEY, "hr-workflow"],
    queryFn: () => advanceService.listHrWorkflow(),
  });
}
