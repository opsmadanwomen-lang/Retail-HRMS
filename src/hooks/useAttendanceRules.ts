import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { attendanceRuleService } from "@/services/attendanceRuleService";
import type { RuleAssignment } from "@/types/attendanceRules";

const RULES_KEY = ["attendance-rules"] as const;

export function useLateRules(companyId?: string) {
  return useQuery({
    queryKey: [...RULES_KEY, "late", companyId],
    queryFn: () => attendanceRuleService.listLateRulesCurrent(companyId as string),
    enabled: Boolean(companyId),
  });
}

export function useLateRuleHistory(companyId?: string, ruleCode?: string) {
  return useQuery({
    queryKey: [...RULES_KEY, "late-history", companyId, ruleCode],
    queryFn: () => attendanceRuleService.getLateRuleHistory(companyId as string, ruleCode as string),
    enabled: Boolean(companyId && ruleCode),
  });
}

export function useLateRuleThresholds(lateRuleId?: string) {
  return useQuery({
    queryKey: [...RULES_KEY, "late-thresholds", lateRuleId],
    queryFn: () => attendanceRuleService.getLateRuleThresholds(lateRuleId as string),
    enabled: Boolean(lateRuleId),
  });
}

export function useOvertimeRules(companyId?: string) {
  return useQuery({
    queryKey: [...RULES_KEY, "overtime", companyId],
    queryFn: () => attendanceRuleService.listOvertimeRulesCurrent(companyId as string),
    enabled: Boolean(companyId),
  });
}

export function useOvertimeRuleHistory(companyId?: string, ruleCode?: string) {
  return useQuery({
    queryKey: [...RULES_KEY, "overtime-history", companyId, ruleCode],
    queryFn: () => attendanceRuleService.getOvertimeRuleHistory(companyId as string, ruleCode as string),
    enabled: Boolean(companyId && ruleCode),
  });
}

export function useOvertimeRuleThresholds(overtimeRuleId?: string) {
  return useQuery({
    queryKey: [...RULES_KEY, "overtime-thresholds", overtimeRuleId],
    queryFn: () => attendanceRuleService.getOvertimeRuleThresholds(overtimeRuleId as string),
    enabled: Boolean(overtimeRuleId),
  });
}

export function useRuleAssignments(companyId?: string) {
  return useQuery({
    queryKey: [...RULES_KEY, "assignments", companyId],
    queryFn: () => attendanceRuleService.getAssignments(companyId as string),
    enabled: Boolean(companyId),
  });
}

/** Resolves the Employee/Shift/Store/Company scope on each assignment to a display label. */
export function useScopeLabels(assignments: RuleAssignment[]) {
  return useQuery({
    queryKey: [...RULES_KEY, "scope-labels", assignments.map((a) => `${a.scopeType}:${a.scopeId ?? ""}`).sort().join(",")],
    queryFn: () => attendanceRuleService.getScopeLabels(assignments),
    enabled: assignments.length > 0,
  });
}

function useInvalidateRules() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: RULES_KEY });
}

export function useCreateLateRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (params: Parameters<typeof attendanceRuleService.createLateRule>) => attendanceRuleService.createLateRule(...params),
    onSuccess: invalidate,
  });
}

export function useUpdateLateRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    // Must be called via the `attendanceRuleService.` call-site (not passed as a bare method
    // reference) — updateLateRule() internally calls `this.replaceLateRuleThresholds(...)`, and a
    // detached reference loses that `this` binding, throwing "this.replaceLateRuleThresholds is
    // not a function" once React Query invokes it standalone.
    mutationFn: (params: Parameters<typeof attendanceRuleService.updateLateRule>[0]) => attendanceRuleService.updateLateRule(params),
    onSuccess: invalidate,
  });
}

export function useDuplicateLateRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (params: Parameters<typeof attendanceRuleService.duplicateLateRule>) => attendanceRuleService.duplicateLateRule(...params),
    onSuccess: invalidate,
  });
}

export function useSetLateRuleActive() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (params: Parameters<typeof attendanceRuleService.setLateRuleActive>) => attendanceRuleService.setLateRuleActive(...params),
    onSuccess: invalidate,
  });
}

export function useCreateOvertimeRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (params: Parameters<typeof attendanceRuleService.createOvertimeRule>) => attendanceRuleService.createOvertimeRule(...params),
    onSuccess: invalidate,
  });
}

export function useUpdateOvertimeRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    // Same fix as useUpdateLateRule() above — updateOvertimeRule() internally calls
    // `this.replaceOvertimeRuleThresholds(...)`, which needs the `attendanceRuleService.` call-site
    // binding preserved. This was the identical latent bug, not yet hit because no Overtime Rule
    // had been edited through the UI.
    mutationFn: (params: Parameters<typeof attendanceRuleService.updateOvertimeRule>[0]) => attendanceRuleService.updateOvertimeRule(params),
    onSuccess: invalidate,
  });
}

export function useDuplicateOvertimeRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (params: Parameters<typeof attendanceRuleService.duplicateOvertimeRule>) => attendanceRuleService.duplicateOvertimeRule(...params),
    onSuccess: invalidate,
  });
}

export function useSetOvertimeRuleActive() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (params: Parameters<typeof attendanceRuleService.setOvertimeRuleActive>) => attendanceRuleService.setOvertimeRuleActive(...params),
    onSuccess: invalidate,
  });
}

export function useAssignRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: attendanceRuleService.assignRule,
    onSuccess: invalidate,
  });
}

/** Store x Employee scope assignment (migration 0062, extended to all 8 rule kinds in 0063) — All/
 *  Selected Stores x All/Selected Employees. Each pair now also triggers automatic recalculation
 *  of existing in-scope attendance (migration 0064) via a single atomic RPC per pair. See
 *  attendanceRuleService.assignRuleScoped for the exact pair-expansion and recalculation rules. */
export function useAssignRuleScoped() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: attendanceRuleService.assignRuleScoped,
    onSuccess: invalidate,
  });
}

/** Store/Employee display labels for scope_type='store_employee' rows, keyed by assignment id. */
export function useStoreEmployeeLabels(assignments: RuleAssignment[]) {
  return useQuery({
    queryKey: [...RULES_KEY, "store-employee-labels", assignments.filter((a) => a.scopeType === "store_employee").map((a) => a.id).sort().join(",")],
    queryFn: () => attendanceRuleService.getStoreEmployeeLabels(assignments),
    enabled: assignments.some((a) => a.scopeType === "store_employee"),
  });
}

export function useUnassignRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (params: Parameters<typeof attendanceRuleService.unassignRule>) => attendanceRuleService.unassignRule(...params),
    onSuccess: invalidate,
  });
}

/** Super Admin "start fresh" option — deactivates every Late Rule, Overtime Rule, and Rule
 *  Assignment for the company. Never touches employees/attendance/shifts/stores. */
export function useResetLateOvertimeRules() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (companyId: string) => attendanceRuleService.resetLateOvertimeRules(companyId),
    onSuccess: invalidate,
  });
}
