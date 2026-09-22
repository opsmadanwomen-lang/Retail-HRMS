import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { leaveService } from "@/services/leaveService";

const LEAVE_KEY = ["leave"] as const;

// ---------------- Financial Years ----------------
export function useLeaveFinancialYears(companyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "financial-years", companyId],
    queryFn: () => leaveService.listFinancialYears(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useCreateLeaveFinancialYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.createFinancialYear>[0]) => leaveService.createFinancialYear(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "financial-years"] }),
  });
}
/** Admin "Activate" action for an existing Financial Year. */
export function useActivateLeaveFinancialYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (financialYearId: string) => leaveService.activateFinancialYear(financialYearId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "financial-years"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "active-financial-year"] });
    },
  });
}
/** Authoritative active FY resolver (leave_get_active_financial_year) — works for Staff regardless
 *  of leave_financial_years table RLS. */
export function useActiveLeaveFinancialYear(enabled = true) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "active-financial-year"],
    queryFn: () => leaveService.getActiveFinancialYear(),
    enabled,
  });
}
/** Live "Leave Duration" for the Apply Leave form — server-side leave_compute_total_days(). */
export function useLeavePreviewTotalDays(params: { leaveTypeId?: string; fromDate?: string; toDate?: string; isHalfDay?: boolean } | null) {
  const ready = Boolean(params?.leaveTypeId && params?.fromDate && params?.toDate);
  return useQuery({
    queryKey: [...LEAVE_KEY, "preview-total-days", params?.leaveTypeId, params?.fromDate, params?.toDate, params?.isHalfDay],
    queryFn: () =>
      leaveService.previewTotalDays({
        leaveTypeId: params!.leaveTypeId as string,
        fromDate: params!.fromDate as string,
        toDate: params!.toDate as string,
        isHalfDay: Boolean(params?.isHalfDay),
      }),
    enabled: ready,
  });
}

// ---------------- Leave Types ----------------
export function useLeaveTypes(companyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "types", companyId],
    queryFn: () => leaveService.listLeaveTypes(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useCreateLeaveType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.createLeaveType>[0]) => leaveService.createLeaveType(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "types"] }),
  });
}

// ---------------- Policies ----------------
export function useLeavePolicies(companyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "policies", companyId],
    queryFn: () => leaveService.listPolicies(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useCreateLeavePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.createPolicy>[0]) => leaveService.createPolicy(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "policies"] }),
  });
}
export function useCloneLeavePolicyVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.cloneNewVersion>[0]) => leaveService.cloneNewVersion(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY] }),
  });
}
export function useSetLeavePolicyStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { policyId: string; status: string; userId?: string }) => leaveService.setPolicyStatus(params.policyId, params.status, params.userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "policies"] }),
  });
}

// ---------------- Policy-Type Config ----------------
export function useLeaveTypeConfigs(policyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "type-configs", policyId],
    queryFn: () => leaveService.listTypeConfigs(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function useCreateLeaveTypeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.createTypeConfig>[0]) => leaveService.createTypeConfig(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "type-configs"] }),
  });
}

// ---------------- Accrual Periods ----------------
export function useLeaveAccrualPeriods(policyTypeConfigId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "accrual-periods", policyTypeConfigId],
    queryFn: () => leaveService.listAccrualPeriods(policyTypeConfigId as string),
    enabled: Boolean(policyTypeConfigId),
  });
}
export function useCreateLeaveAccrualPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.createAccrualPeriod>[0]) => leaveService.createAccrualPeriod(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "accrual-periods"] }),
  });
}
export function useDeleteLeaveAccrualPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => leaveService.deleteAccrualPeriod(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "accrual-periods"] }),
  });
}

// ---------------- Probation / Pro-Rata ----------------
export function useLeaveProbationRule(policyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "probation-rule", policyId],
    queryFn: () => leaveService.getProbationRule(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function useUpsertLeaveProbationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.upsertProbationRule>[0]) => leaveService.upsertProbationRule(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "probation-rule"] }),
  });
}
export function useUpsertLeaveProRataRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.upsertProRataRule>[0]) => leaveService.upsertProRataRule(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "type-configs"] }),
  });
}

// ---------------- Policy Assignment ----------------
export function useLeavePolicyAssignments(companyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "assignments", companyId],
    queryFn: () => leaveService.listAssignments(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useCreateLeavePolicyAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.createAssignment>[0]) => leaveService.createAssignment(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "assignments"] }),
  });
}

// ---------------- Phase 2: Balance, Applications, Documents ----------------
export function useLeaveBalance(params: { employeeId?: string; leaveTypeId?: string; financialYearId?: string } | null) {
  const ready = Boolean(params?.employeeId && params?.leaveTypeId && params?.financialYearId);
  return useQuery({
    queryKey: [...LEAVE_KEY, "balance", params?.employeeId, params?.leaveTypeId, params?.financialYearId],
    queryFn: () =>
      leaveService.getBalance({ employeeId: params!.employeeId as string, leaveTypeId: params!.leaveTypeId as string, financialYearId: params!.financialYearId as string }),
    enabled: ready,
  });
}

export function useMyLeaveApplications() {
  return useQuery({
    queryKey: [...LEAVE_KEY, "my-applications"],
    queryFn: () => leaveService.listMyApplications(),
  });
}

export function useLeaveApplicationDocuments(applicationId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "application-documents", applicationId],
    queryFn: () => leaveService.listApplicationDocuments(applicationId as string),
    enabled: Boolean(applicationId),
  });
}

export function useApplyLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.applyLeave>[0]) => leaveService.applyLeave(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-applications"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-leave-history"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "balance"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-ledger"] });
    },
  });
}

export function useCancelLeaveApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { applicationId: string; remark?: string }) => leaveService.cancelApplication(params.applicationId, params.remark),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-applications"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-leave-history"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "balance"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-ledger"] });
    },
  });
}

export function useLeaveApprovalHistory(applicationId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "approval-history", applicationId],
    queryFn: () => leaveService.listApprovalHistory(applicationId as string),
    enabled: Boolean(applicationId),
  });
}

/** The logged-in approver's own Approved / Rejected leave history (leave_list_my_approval_history). */
export function useMyApprovalHistory(action: "approved" | "rejected") {
  return useQuery({
    queryKey: [...LEAVE_KEY, "my-approval-history", action],
    queryFn: () => leaveService.listMyApprovalHistory(action),
  });
}

/** The logged-in employee's OWN leave applications + approval status/history — Staff self-view of
 *  the Leave Approvals page (leave_list_my_leave_history). */
export function useMyLeaveHistory() {
  return useQuery({
    queryKey: [...LEAVE_KEY, "my-leave-history"],
    queryFn: () => leaveService.listMyLeaveHistory(),
  });
}

/** Date-wise paid/unpaid view of one approved leave (Manage Paid Leave). */
export function usePaidDaySelection(applicationId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "paid-day-selection", applicationId],
    queryFn: () => leaveService.getPaidDaySelection(applicationId as string),
    enabled: Boolean(applicationId),
  });
}

/** Save the full paid-day selection for one approved leave. Only THIS consumes paid-leave balance. */
export function useSetPaidDays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.setPaidDays>[0]) => leaveService.setPaidDays(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "paid-day-selection"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-applications"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-leave-history"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "balance"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-ledger"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "report-applications"] });
    },
  });
}

// ---------------- Phase 3: Approval workflow ----------------
export function useAmILeaveManager(employeeId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "am-i-a-manager", employeeId],
    queryFn: () => leaveService.amIALeaveManager(),
    enabled: Boolean(employeeId),
  });
}

export function useManagerPendingLeaveApplications() {
  return useQuery({
    queryKey: [...LEAVE_KEY, "manager-pending"],
    queryFn: () => leaveService.listManagerPendingApplications(),
  });
}

export function useSuperManagerPendingLeaveApplications() {
  return useQuery({
    queryKey: [...LEAVE_KEY, "super-manager-pending"],
    queryFn: () => leaveService.listSuperManagerPendingApplications(),
  });
}

function invalidateAfterLeaveDecision(qc: ReturnType<typeof useQueryClient>) {
  // A decision can change: the applicant's own list/balance, both approval queues (forward moves a
  // row from one queue to the other), and the approval-history panel — never assume just one.
  qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-applications"] });
  qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "balance"] });
  qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "manager-pending"] });
  qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "super-manager-pending"] });
  qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "approval-history"] });
  qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-approval-history"] });
  qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-leave-history"] });
}

export function useManagerDecideLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { applicationId: string; decision: "approved" | "rejected"; remark?: string }) =>
      leaveService.managerDecide(params.applicationId, params.decision, params.remark),
    onSuccess: () => invalidateAfterLeaveDecision(qc),
  });
}

export function useSuperManagerDecideLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { applicationId: string; decision: "approved" | "rejected"; remark?: string }) =>
      leaveService.superManagerDecide(params.applicationId, params.decision, params.remark),
    onSuccess: () => invalidateAfterLeaveDecision(qc),
  });
}

// ---------------- Preview ----------------
export function useLeavePreviewCalculation(params: { employeeId?: string; leaveTypeId?: string; financialYearId?: string } | null) {
  const ready = Boolean(params?.employeeId && params?.leaveTypeId && params?.financialYearId);
  return useQuery({
    queryKey: [...LEAVE_KEY, "preview", params?.employeeId, params?.leaveTypeId, params?.financialYearId],
    queryFn: () =>
      leaveService.previewCalculation({
        employeeId: params!.employeeId as string,
        leaveTypeId: params!.leaveTypeId as string,
        financialYearId: params!.financialYearId as string,
      }),
    enabled: ready,
  });
}

// ---------------- Phase 4: Salary Components ----------------
export function useEmployeeSalaryComponents(employeeId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "salary-components", employeeId],
    queryFn: () => leaveService.listSalaryComponents(employeeId as string),
    enabled: Boolean(employeeId),
  });
}
export function useAddSalaryComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.addSalaryComponent>[0]) => leaveService.addSalaryComponent(params),
    onSuccess: (_data, params) => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "salary-components", params.employeeId] }),
  });
}

// ---------------- Phase 4: Encashment Rule ----------------
export function useLeaveEncashmentRule(policyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "encashment-rule", policyId],
    queryFn: () => leaveService.getEncashmentRule(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function useUpsertLeaveEncashmentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.upsertEncashmentRule>[0]) => leaveService.upsertEncashmentRule(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "encashment-rule"] }),
  });
}

// ---------------- Monthly Accrual Posting ----------------
export function useAccrualPreview(params: { financialYearId?: string; policyId?: string; leaveTypeId?: string; upToMonth?: string } | null) {
  const ready = Boolean(params?.financialYearId && params?.policyId && params?.leaveTypeId);
  return useQuery({
    queryKey: [...LEAVE_KEY, "accrual-preview", params?.financialYearId, params?.policyId, params?.leaveTypeId, params?.upToMonth],
    queryFn: () =>
      leaveService.runAccrual({
        financialYearId: params!.financialYearId as string,
        policyId: params!.policyId as string,
        leaveTypeId: params!.leaveTypeId as string,
        upToMonth: params?.upToMonth,
        dryRun: true,
      }),
    enabled: ready,
  });
}
export function useRunAccrual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { financialYearId: string; policyId: string; leaveTypeId: string; upToMonth?: string }) =>
      leaveService.runAccrual({ ...params, dryRun: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "accrual-preview"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "balance"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "my-ledger"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "report-ledger"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "report-balances"] });
    },
  });
}

// ---------------- Approval Hierarchy threshold (leave_short_long_rules) ----------------
export function useLeaveApprovalThresholdRule(policyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "approval-threshold-rule", policyId],
    queryFn: () => leaveService.getApprovalThresholdRule(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function useUpsertLeaveApprovalThresholdRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.upsertApprovalThresholdRule>[0]) => leaveService.upsertApprovalThresholdRule(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "approval-threshold-rule"] }),
  });
}

// ---------------- Phase 4: Prior Notice Rule ----------------
export function useLeavePriorNoticeRule(policyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "prior-notice-rule", policyId],
    queryFn: () => leaveService.getPriorNoticeRule(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function useUpsertLeavePriorNoticeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.upsertPriorNoticeRule>[0]) => leaveService.upsertPriorNoticeRule(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "prior-notice-rule"] }),
  });
}

// ---------------- Phase 4: Prior Notice Exceptions ----------------
export function useRequestPriorNoticeException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.requestPriorNoticeException>[0]) => leaveService.requestPriorNoticeException(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "pending-prior-notice-exceptions"] }),
  });
}
export function usePendingPriorNoticeExceptions() {
  return useQuery({
    queryKey: [...LEAVE_KEY, "pending-prior-notice-exceptions"],
    queryFn: () => leaveService.listPendingPriorNoticeExceptions(),
  });
}
export function useDecidePriorNoticeException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { exceptionId: string; decision: "approved" | "rejected"; remark?: string }) =>
      leaveService.decidePriorNoticeException(params.exceptionId, params.decision, params.remark),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "pending-prior-notice-exceptions"] }),
  });
}

// ---------------- Phase 4: Notifications ----------------
export function useMyLeaveNotifications(limit?: number) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "notifications", limit],
    queryFn: () => leaveService.listMyNotifications(limit),
    refetchInterval: 60_000,
  });
}
export function useUnreadLeaveNotificationCount() {
  return useQuery({
    queryKey: [...LEAVE_KEY, "notifications-unread-count"],
    queryFn: () => leaveService.unreadNotificationCount(),
    refetchInterval: 60_000,
  });
}
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => leaveService.markNotificationRead(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "notifications"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "notifications-unread-count"] });
    },
  });
}
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => leaveService.markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "notifications"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "notifications-unread-count"] });
    },
  });
}
export function useLeaveNotificationSettings(companyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "notification-settings", companyId],
    queryFn: () => leaveService.listNotificationSettings(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useUpdateLeaveNotificationSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof leaveService.updateNotificationSetting>[0]) => leaveService.updateNotificationSetting(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "notification-settings"] }),
  });
}

// ---------------- Phase 4: Financial Year Closing ----------------
export function useFyClosingPreview(financialYearId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "fy-closing-preview", financialYearId],
    queryFn: () => leaveService.previewFyClosing(financialYearId as string),
    enabled: Boolean(financialYearId),
  });
}
export function useConfirmFyClosing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { financialYearId: string; nextFinancialYearId?: string; remark?: string }) =>
      leaveService.confirmFyClosing(params.financialYearId, params.nextFinancialYearId, params.remark),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "financial-years"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "fy-closing-preview"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "fy-closing-batch"] });
      qc.invalidateQueries({ queryKey: [...LEAVE_KEY, "payroll-transactions"] });
    },
  });
}
export function useFyClosingBatch(financialYearId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "fy-closing-batch", financialYearId],
    queryFn: () => leaveService.getFyClosingBatch(financialYearId as string),
    enabled: Boolean(financialYearId),
  });
}
export function useFyClosingLines(batchId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "fy-closing-lines", batchId],
    queryFn: () => leaveService.listFyClosingLines(batchId as string),
    enabled: Boolean(batchId),
  });
}

// ---------------- Phase 4: Payroll Integration ----------------
export function usePayrollLeaveTransactions(companyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "payroll-transactions", companyId],
    queryFn: () => leaveService.listPayrollLeaveTransactions(companyId as string),
    enabled: Boolean(companyId),
  });
}

export function useMyLeaveLedger(financialYearId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "my-ledger", financialYearId],
    queryFn: () => leaveService.listMyLedger(financialYearId),
  });
}

// ---------------- Phase 5: Leave -> Attendance integration ----------------
export function useLeaveAttendanceEffects(employeeId?: string, fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "attendance-effects", employeeId, fromDate, toDate],
    queryFn: () => leaveService.listAttendanceEffects(employeeId as string, fromDate as string, toDate as string),
    enabled: Boolean(employeeId && fromDate && toDate),
  });
}

// ---------------- Phase 5: Reports ----------------
export function useLeaveReportLedger(companyId?: string, financialYearId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "report-ledger", companyId, financialYearId],
    queryFn: () => leaveService.reportLedger(companyId as string, financialYearId),
    enabled: Boolean(companyId),
  });
}
export function useLeaveReportApplications(fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "report-applications", fromDate, toDate],
    queryFn: () => leaveService.reportApplications(fromDate, toDate),
  });
}
export function useLeaveReportBalances(financialYearId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "report-balances", financialYearId],
    queryFn: () => leaveService.reportBalances(financialYearId as string),
    enabled: Boolean(financialYearId),
  });
}
export function useLeaveReportProbation(companyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "report-probation", companyId],
    queryFn: () => leaveService.reportProbation(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useFyClosingBatchesForCompany(companyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "closing-batches", companyId],
    queryFn: () => leaveService.listFyClosingBatchesForCompany(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useLeaveReportPolicyChanges(companyId?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "report-policy-changes", companyId],
    queryFn: () => leaveService.reportPolicyChanges(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useLeaveReportAudit(companyId?: string, fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: [...LEAVE_KEY, "report-audit", companyId, fromDate, toDate],
    queryFn: () => leaveService.reportAudit(companyId as string, fromDate, toDate),
    enabled: Boolean(companyId),
  });
}
