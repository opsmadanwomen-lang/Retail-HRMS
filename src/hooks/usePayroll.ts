import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { payrollService } from "@/services/payrollService";
import type { SalaryStructure } from "@/types/payroll";

const PAYROLL_KEY = ["payroll"] as const;

export function usePayrollAdmin(companyId?: string) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, "am-admin", companyId],
    queryFn: () => payrollService.amIPayrollAdmin(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function usePayrollPeriods(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, "periods", companyId],
    queryFn: () => payrollService.listPeriods(companyId as string),
    enabled: Boolean(companyId) && enabled,
  });
}
export function usePayrollRunResults(runId?: string) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, "run-results", runId],
    queryFn: () => payrollService.listRunResults(runId as string),
    enabled: Boolean(runId),
  });
}
export function usePayrollEmployeeResult(resultId?: string) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, "result", resultId],
    queryFn: () => payrollService.getEmployeeResult(resultId as string),
    enabled: Boolean(resultId),
  });
}
export function usePayrollResultLines(resultId?: string) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, "result-lines", resultId],
    queryFn: () => payrollService.listResultLines(resultId as string),
    enabled: Boolean(resultId),
  });
}
export function useMyPayslips() {
  return useQuery({ queryKey: [...PAYROLL_KEY, "my-payslips"], queryFn: () => payrollService.listMyPayslips() });
}
export function usePayslip(resultId?: string) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, "payslip", resultId],
    queryFn: () => payrollService.getPayslip(resultId as string),
    enabled: Boolean(resultId),
  });
}
export function usePayrollAdvanceRecoveryReport(runId?: string) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, "advrec-report", runId],
    queryFn: () => payrollService.reportAdvanceRecovery(runId as string),
    enabled: Boolean(runId),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: PAYROLL_KEY });
}
export function useCreatePayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { companyId: string; periodMonth: string; label?: string | null }) => payrollService.createPeriod(p.companyId, p.periodMonth, p.label),
    onSuccess: () => invalidate(qc),
  });
}
export function useStartPayrollRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (periodId: string) => payrollService.startRun(periodId), onSuccess: () => invalidate(qc) });
}
export function useCalculatePayrollRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (runId: string) => payrollService.calculateRun(runId), onSuccess: () => invalidate(qc) });
}
export function useFinalizePayrollRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (runId: string) => payrollService.finalizeRun(runId), onSuccess: () => invalidate(qc) });
}
export function useLockPayrollRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (runId: string) => payrollService.lockRun(runId), onSuccess: () => invalidate(qc) });
}
export function useReversePayrollRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: { runId: string; reason: string }) => payrollService.reverseRun(p.runId, p.reason), onSuccess: () => invalidate(qc) });
}

// ---- config ----
export function usePayrollComponents(companyId?: string) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, "components", companyId],
    queryFn: () => payrollService.listComponents(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useUpsertPayrollComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof payrollService.upsertComponent>[0]) => payrollService.upsertComponent(p),
    onSuccess: () => invalidate(qc),
  });
}
export function usePayrollPolicy(companyId?: string) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, "policy", companyId],
    queryFn: () => payrollService.getPolicy(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useUpsertPayrollPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof payrollService.upsertPolicy>[0]) => payrollService.upsertPolicy(p),
    onSuccess: () => invalidate(qc),
  });
}

// ---- Phase 5A: dynamic salary bifurcation ----
const SALARY_KEY = ["salary-structures"] as const;
function invalidateSalary(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: SALARY_KEY });
  qc.invalidateQueries({ queryKey: PAYROLL_KEY });
}

export function useSalaryStructures(companyId?: string) {
  return useQuery({
    queryKey: [...SALARY_KEY, "list", companyId],
    queryFn: () => payrollService.listStructures(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useSalaryStructureComponents(structureId?: string) {
  return useQuery({
    queryKey: [...SALARY_KEY, "components", structureId],
    queryFn: () => payrollService.listStructureComponents(structureId as string),
    enabled: Boolean(structureId),
  });
}
export function useSalaryPreview(structureId?: string, gross?: number) {
  return useQuery({
    queryKey: [...SALARY_KEY, "preview", structureId, gross],
    queryFn: () => payrollService.preview(structureId as string, gross as number),
    enabled: Boolean(structureId) && typeof gross === "number" && gross > 0,
  });
}
export function useSalarySlabRules(companyId?: string) {
  return useQuery({
    queryKey: [...SALARY_KEY, "slabs", companyId],
    queryFn: () => payrollService.listSlabRules(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useEmployeeSalaryAssignments(employeeId?: string) {
  return useQuery({
    queryKey: [...SALARY_KEY, "employee-assignments", employeeId],
    queryFn: () => payrollService.listEmployeeAssignments(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useCreateSalaryStructure() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.createStructure>[0]) => payrollService.createStructure(p), onSuccess: () => invalidateSalary(qc) });
}
export function useUpdateSalaryStructure() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: { id: string; values: Record<string, unknown>; userId?: string | null }) => payrollService.updateStructure(p.id, p.values, p.userId), onSuccess: () => invalidateSalary(qc) });
}
export function useActivateSalaryStructure() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => payrollService.activateStructure(id), onSuccess: () => invalidateSalary(qc) });
}
export function useCloneSalaryStructure() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: { id: string; newCode: string; newName: string }) => payrollService.cloneStructure(p.id, p.newCode, p.newName), onSuccess: () => invalidateSalary(qc) });
}
/** Eligibility + counts for the delete confirmation. Never cached: it must reflect the DB at the moment of confirmation. */
export function useSalaryStructureDeleteCheck(structureId?: string) {
  return useQuery({
    queryKey: [...SALARY_KEY, "delete-check", structureId],
    queryFn: () => payrollService.getStructureDeleteCheck(structureId as string),
    enabled: Boolean(structureId),
    staleTime: 0, gcTime: 0, retry: false,
  });
}
export function useDeleteSalaryStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => payrollService.deleteStructure(id),
    onSuccess: (_d, id) => {
      // Drop the row from every cached structures list immediately, purge its dependent caches, then refetch from the server.
      qc.setQueriesData<SalaryStructure[]>({ queryKey: [...SALARY_KEY, "list"] }, (old) => old?.filter((s) => s.id !== id));
      for (const k of ["components", "preview", "delete-check"]) qc.removeQueries({ queryKey: [...SALARY_KEY, k, id] });
      invalidateSalary(qc);
    },
  });
}
export function useValidateSalaryStructure() {
  return useMutation({ mutationFn: (id: string) => payrollService.validateStructure(id) });
}
export function useUpsertSalaryStructureComponent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.upsertStructureComponent>[0]) => payrollService.upsertStructureComponent(p), onSuccess: () => invalidateSalary(qc) });
}
export function useDeleteSalaryStructureComponent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => payrollService.deleteStructureComponent(id), onSuccess: () => invalidateSalary(qc) });
}
export function useAddSalarySlabRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.addSlabRule>[0]) => payrollService.addSlabRule(p), onSuccess: () => invalidateSalary(qc) });
}
export function useDeleteSalarySlabRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => payrollService.deleteSlabRule(id), onSuccess: () => invalidateSalary(qc) });
}
export function useAssignEmployeeSalary() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.assignEmployeeSalary>[0]) => payrollService.assignEmployeeSalary(p), onSuccess: () => invalidateSalary(qc) });
}

// ---- Phase 6: payroll policy engine ----
const POLICY_KEY = ["payroll-policies"] as const;
function invalidatePolicy(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: POLICY_KEY });
  qc.invalidateQueries({ queryKey: PAYROLL_KEY });
}

export function usePayrollPolicies(companyId?: string) {
  return useQuery({
    queryKey: [...POLICY_KEY, "list", companyId],
    queryFn: () => payrollService.listPolicies(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function usePolicyStatutoryRules(policyId?: string) {
  return useQuery({
    queryKey: [...POLICY_KEY, "statutory", policyId],
    queryFn: () => payrollService.listStatutoryRules(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function usePolicyPtSlabs(policyId?: string) {
  return useQuery({
    queryKey: [...POLICY_KEY, "pt-slabs", policyId],
    queryFn: () => payrollService.listPtSlabs(policyId as string),
    enabled: Boolean(policyId),
  });
}
export function usePolicyDeductionOrder(policyId?: string) {
  return useQuery({
    queryKey: [...POLICY_KEY, "ded-order", policyId],
    queryFn: () => payrollService.listDeductionOrder(policyId as string),
    enabled: Boolean(policyId),
  });
}

export function useCreatePolicyVersion() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.createPolicyVersion>[0]) => payrollService.createPolicyVersion(p), onSuccess: () => invalidatePolicy(qc) });
}
export function useUpdatePolicyV2() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: { id: string; values: Record<string, unknown>; userId?: string | null }) => payrollService.updatePolicy(p.id, p.values, p.userId), onSuccess: () => invalidatePolicy(qc) });
}
export function useValidatePolicy() {
  return useMutation({ mutationFn: (id: string) => payrollService.validatePolicy(id) });
}
export function useActivatePolicy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => payrollService.activatePolicy(id), onSuccess: () => invalidatePolicy(qc) });
}
export function usePolicyPreview() {
  return useMutation({ mutationFn: (p: { employeeId: string; periodMonth: string; inputs: Record<string, unknown> }) => payrollService.previewPolicy(p.employeeId, p.periodMonth, p.inputs) });
}
/** The company's active payroll policy + its rules (PF/ESI/… and named Common Payroll Components). */
export function useCommonComponents(companyId?: string) {
  const polQ = usePayrollPolicies(companyId);
  const policy = (polQ.data ?? []).find((p) => p.status === "active") ?? polQ.data?.[0];
  const rulesQ = usePolicyStatutoryRules(policy?.id);
  return { policy, rules: rulesQ.data ?? [], isLoading: polQ.isLoading || rulesQ.isLoading };
}
/**
 * Live "what would Payroll do for this Gross?" — the SAME engine as the Payroll Run (payroll_policy_preview),
 * which resolves the salary structure from the typed Gross (slab / scope rules) and then applies the common
 * payroll components. Nothing is saved.
 */
export function useSalaryPreviewForGross(p: {
  employeeId?: string | null; companyId?: string; periodMonth?: string; gross?: number; joiningDate?: string | null;
}) {
  return useQuery({
    queryKey: [...POLICY_KEY, "gross-preview", p.employeeId ?? null, p.companyId, p.periodMonth, p.gross, p.joiningDate ?? null],
    // With an employeeId the server reads the employee (and ignores company_id); without one it runs the same engine as a read-only
    // "virtual employee" from company + Gross + optional test joining date. Joining date is only an override for the eligibility rule.
    queryFn: () => payrollService.previewPolicy(p.employeeId ?? null, p.periodMonth as string, {
      gross: p.gross, company_id: p.companyId, ...(p.joiningDate ? { joining_date: p.joiningDate } : {}),
    }),
    enabled: Boolean(p.companyId) && Boolean(p.periodMonth) && typeof p.gross === "number" && p.gross > 0,
    retry: false,
    staleTime: 0,
  });
}
export function useUpsertStatutoryRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.upsertStatutoryRule>[0]) => payrollService.upsertStatutoryRule(p), onSuccess: () => invalidatePolicy(qc) });
}
export function useTestPayrollComponent() {
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.testComponent>[0]) => payrollService.testComponent(p) });
}
export function useTestPayrollFormula() {
  return useMutation({ mutationFn: (p: { expr: string; gross: number; basic?: number | null; da?: number | null }) => payrollService.testFormula(p.expr, p.gross, p.basic, p.da) });
}
export function useDeleteStatutoryRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => payrollService.deleteStatutoryRule(id), onSuccess: () => invalidatePolicy(qc) });
}
export function useAddPtSlab() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.addPtSlab>[0]) => payrollService.addPtSlab(p), onSuccess: () => invalidatePolicy(qc) });
}
export function useDeletePtSlab() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => payrollService.deletePtSlab(id), onSuccess: () => invalidatePolicy(qc) });
}
export function useSetDeductionOrder() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.setDeductionOrder>[0]) => payrollService.setDeductionOrder(p), onSuccess: () => invalidatePolicy(qc) });
}

// ---- PF / ESI per-employee, per-period manual + Excel-imported amounts ----
const COMP_AMT_KEY = ["payroll-component-amounts"] as const;
export function useComponentAmounts(periodId?: string) {
  return useQuery({
    queryKey: [...COMP_AMT_KEY, periodId],
    queryFn: () => payrollService.listComponentAmounts(periodId as string),
    enabled: Boolean(periodId),
  });
}
/** Every component code eligible for Manual/Excel import in this company — never hard-coded. */
export function useComponentImportCodes(companyId?: string) {
  return useQuery({
    queryKey: [...COMP_AMT_KEY, "import-codes", companyId],
    queryFn: () => payrollService.listComponentImportCodes(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useSetComponentAmount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof payrollService.setComponentAmount>[0]) => payrollService.setComponentAmount(p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: COMP_AMT_KEY }); qc.invalidateQueries({ queryKey: PAYROLL_KEY }); },
  });
}
export function useBulkSetComponentAmounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { periodId: string; rows: Parameters<typeof payrollService.bulkSetComponentAmounts>[1] }) => payrollService.bulkSetComponentAmounts(p.periodId, p.rows),
    onSuccess: () => { qc.invalidateQueries({ queryKey: COMP_AMT_KEY }); qc.invalidateQueries({ queryKey: PAYROLL_KEY }); },
  });
}
export function usePreviewComponentImport() {
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.previewComponentImport>[0]) => payrollService.previewComponentImport(p) });
}
export function useCommitComponentImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof payrollService.commitComponentImport>[0]) => payrollService.commitComponentImport(p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: COMP_AMT_KEY }); qc.invalidateQueries({ queryKey: PAYROLL_KEY }); },
  });
}

// ---- Phase 7: master enhancement ----
const P7_KEY = ["payroll-p7"] as const;
function invalidateP7(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: P7_KEY });
  qc.invalidateQueries({ queryKey: POLICY_KEY });
  qc.invalidateQueries({ queryKey: PAYROLL_KEY });
}

export function useEmployeeGrades(companyId?: string) {
  return useQuery({ queryKey: [...P7_KEY, "grades", companyId], queryFn: () => payrollService.listGrades(companyId as string), enabled: Boolean(companyId) });
}
export function useEmployeeCategories(companyId?: string) {
  return useQuery({ queryKey: [...P7_KEY, "categories", companyId], queryFn: () => payrollService.listCategories(companyId as string), enabled: Boolean(companyId) });
}
export function useUpsertGrade() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.upsertGrade>[0]) => payrollService.upsertGrade(p), onSuccess: () => invalidateP7(qc) });
}
export function useUpsertCategory() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.upsertCategory>[0]) => payrollService.upsertCategory(p), onSuccess: () => invalidateP7(qc) });
}
export function usePolicyAssignments(companyId?: string) {
  return useQuery({ queryKey: [...P7_KEY, "policy-assignments", companyId], queryFn: () => payrollService.listPolicyAssignments(companyId as string), enabled: Boolean(companyId) });
}
export function useAddPolicyAssignment() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.addPolicyAssignment>[0]) => payrollService.addPolicyAssignment(p), onSuccess: () => invalidateP7(qc) });
}
export function useDeletePolicyAssignment() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => payrollService.deletePolicyAssignment(id), onSuccess: () => invalidateP7(qc) });
}
export function useStoreCalendars(companyId?: string) {
  return useQuery({ queryKey: [...P7_KEY, "store-calendars", companyId], queryFn: () => payrollService.listStoreCalendars(companyId as string), enabled: Boolean(companyId) });
}
export function useUpsertStoreCalendar() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.upsertStoreCalendar>[0]) => payrollService.upsertStoreCalendar(p), onSuccess: () => invalidateP7(qc) });
}
export function usePreviewStoreCalendar() {
  return useMutation({ mutationFn: (p: { calendarId: string; start: string; end: string }) => payrollService.previewStoreCalendar(p.calendarId, p.start, p.end) });
}
export function useTdsPolicies(companyId?: string) {
  return useQuery({ queryKey: [...P7_KEY, "tds-policies", companyId], queryFn: () => payrollService.listTdsPolicies(companyId as string), enabled: Boolean(companyId) });
}
export function useTdsSlabs(policyId?: string) {
  return useQuery({ queryKey: [...P7_KEY, "tds-slabs", policyId], queryFn: () => payrollService.listTdsSlabs(policyId as string), enabled: Boolean(policyId) });
}
export function useCreateTdsPolicy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.createTdsPolicy>[0]) => payrollService.createTdsPolicy(p), onSuccess: () => invalidateP7(qc) });
}
export function useUpdateTdsPolicy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: { id: string; values: Record<string, unknown>; userId?: string | null }) => payrollService.updateTdsPolicy(p.id, p.values, p.userId), onSuccess: () => invalidateP7(qc) });
}
export function useAddTdsSlab() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof payrollService.addTdsSlab>[0]) => payrollService.addTdsSlab(p), onSuccess: () => invalidateP7(qc) });
}
export function useDeleteTdsSlab() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => payrollService.deleteTdsSlab(id), onSuccess: () => invalidateP7(qc) });
}
export function useComputeTds() {
  return useMutation({ mutationFn: (p: { policyId: string; annualTaxable: number }) => payrollService.computeTds(p.policyId, p.annualTaxable) });
}
