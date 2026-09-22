import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { extendedAttendanceRuleService } from "@/services/extendedAttendanceRuleService";
import { attendanceService } from "@/services/attendanceService";

const EXT_RULES_KEY = ["extended-attendance-rules"] as const;
const NIGHT_DUTY_KEY = ["night-duty-approvals"] as const;

/** Every variant of a singleton-pattern rule for this company (migration 0063) — used to populate
 *  the Rule Assignment dialog's pickers, since these tables can now have more than one
 *  simultaneously-open row per company (one per Store/Employee scope). */
export function useListInformationRules(companyId?: string) {
  return useQuery({ queryKey: [...EXT_RULES_KEY, "information-list", companyId], queryFn: () => extendedAttendanceRuleService.listInformationRules(companyId as string), enabled: Boolean(companyId) });
}
export function useListWeeklyOffLateRules(companyId?: string) {
  return useQuery({ queryKey: [...EXT_RULES_KEY, "weekly-off-late-list", companyId], queryFn: () => extendedAttendanceRuleService.listWeeklyOffLateRules(companyId as string), enabled: Boolean(companyId) });
}
export function useListPenaltyRules(companyId?: string) {
  return useQuery({ queryKey: [...EXT_RULES_KEY, "penalty-list", companyId], queryFn: () => extendedAttendanceRuleService.listPenaltyRules(companyId as string), enabled: Boolean(companyId) });
}
export function useListHalfDayRules(companyId?: string) {
  return useQuery({ queryKey: [...EXT_RULES_KEY, "half-day-list", companyId], queryFn: () => extendedAttendanceRuleService.listHalfDayRules(companyId as string), enabled: Boolean(companyId) });
}
export function useListEarlyGoingRules(companyId?: string) {
  return useQuery({ queryKey: [...EXT_RULES_KEY, "early-going-list", companyId], queryFn: () => extendedAttendanceRuleService.listEarlyGoingRules(companyId as string), enabled: Boolean(companyId) });
}
export function useListExtendedDutyRules(companyId?: string) {
  return useQuery({ queryKey: [...EXT_RULES_KEY, "extended-duty-list", companyId], queryFn: () => extendedAttendanceRuleService.listExtendedDutyRules(companyId as string), enabled: Boolean(companyId) });
}

/** Creates a genuinely NEW, independent rule row (not a version of the company default) — for
 *  assigning a distinct configuration to a specific Store/Employee scope (migration 0063). */
function useInvalidateExtRules() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: EXT_RULES_KEY });
}
export function useCreateInformationRuleVariant() {
  const invalidate = useInvalidateExtRules();
  return useMutation({ mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.createInformationRuleVariant>) => extendedAttendanceRuleService.createInformationRuleVariant(...p), onSuccess: invalidate });
}
export function useCreateWeeklyOffLateRuleVariant() {
  const invalidate = useInvalidateExtRules();
  return useMutation({ mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.createWeeklyOffLateRuleVariant>) => extendedAttendanceRuleService.createWeeklyOffLateRuleVariant(...p), onSuccess: invalidate });
}
export function useCreatePenaltyRuleVariant() {
  const invalidate = useInvalidateExtRules();
  return useMutation({ mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.createPenaltyRuleVariant>) => extendedAttendanceRuleService.createPenaltyRuleVariant(...p), onSuccess: invalidate });
}
export function useCreateHalfDayRuleVariant() {
  const invalidate = useInvalidateExtRules();
  return useMutation({ mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.createHalfDayRuleVariant>) => extendedAttendanceRuleService.createHalfDayRuleVariant(...p), onSuccess: invalidate });
}
export function useCreateEarlyGoingRuleVariant() {
  const invalidate = useInvalidateExtRules();
  return useMutation({ mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.createEarlyGoingRuleVariant>) => extendedAttendanceRuleService.createEarlyGoingRuleVariant(...p), onSuccess: invalidate });
}
export function useCreateExtendedDutyRuleVariant() {
  const invalidate = useInvalidateExtRules();
  return useMutation({ mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.createExtendedDutyRuleVariant>) => extendedAttendanceRuleService.createExtendedDutyRuleVariant(...p), onSuccess: invalidate });
}

export function useCurrentInformationRule(companyId?: string) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "information", companyId],
    queryFn: () => extendedAttendanceRuleService.getCurrentInformationRule(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useSaveInformationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.saveInformationRule>) => extendedAttendanceRuleService.saveInformationRule(...p),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXT_RULES_KEY }),
  });
}

export function useCurrentWeeklyOffLateRule(companyId?: string) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "weekly-off-late", companyId],
    queryFn: () => extendedAttendanceRuleService.getCurrentWeeklyOffLateRule(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useSaveWeeklyOffLateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.saveWeeklyOffLateRule>) => extendedAttendanceRuleService.saveWeeklyOffLateRule(...p),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXT_RULES_KEY }),
  });
}

export function useCurrentPenaltyRule(companyId?: string) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "penalty", companyId],
    queryFn: () => extendedAttendanceRuleService.getCurrentPenaltyRule(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function usePenaltyThresholds(penaltyRuleId?: string) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "penalty-thresholds", penaltyRuleId],
    queryFn: () => extendedAttendanceRuleService.getPenaltyThresholds(penaltyRuleId as string),
    enabled: Boolean(penaltyRuleId),
  });
}
export function useSavePenaltyRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.savePenaltyRule>) => extendedAttendanceRuleService.savePenaltyRule(...p),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXT_RULES_KEY }),
  });
}

export function useCurrentHalfDayRule(companyId?: string) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "half-day", companyId],
    queryFn: () => extendedAttendanceRuleService.getCurrentHalfDayRule(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useSaveHalfDayRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.saveHalfDayRule>) => extendedAttendanceRuleService.saveHalfDayRule(...p),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXT_RULES_KEY }),
  });
}

export function useCurrentEarlyGoingRule(companyId?: string) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "early-going", companyId],
    queryFn: () => extendedAttendanceRuleService.getCurrentEarlyGoingRule(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useEarlyGoingThresholds(earlyGoingRuleId?: string) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "early-going-thresholds", earlyGoingRuleId],
    queryFn: () => extendedAttendanceRuleService.getEarlyGoingThresholds(earlyGoingRuleId as string),
    enabled: Boolean(earlyGoingRuleId),
  });
}
export function useSaveEarlyGoingRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.saveEarlyGoingRule>) => extendedAttendanceRuleService.saveEarlyGoingRule(...p),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXT_RULES_KEY }),
  });
}

export function useCurrentExtendedDutyRule(companyId?: string) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "extended-duty", companyId],
    queryFn: () => extendedAttendanceRuleService.getCurrentExtendedDutyRule(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useSaveExtendedDutyRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.saveExtendedDutyRule>) => extendedAttendanceRuleService.saveExtendedDutyRule(...p),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXT_RULES_KEY }),
  });
}

export function useCurrentNightDutyConfig(companyId?: string) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "night-duty-config", companyId],
    queryFn: () => extendedAttendanceRuleService.getCurrentNightDutyConfig(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useSaveNightDutyConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Parameters<typeof extendedAttendanceRuleService.saveNightDutyConfig>) => extendedAttendanceRuleService.saveNightDutyConfig(...p),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXT_RULES_KEY }),
  });
}

export function useInformationUsageThisMonth(employeeId?: string, year?: number, month?: number) {
  return useQuery({
    queryKey: [...EXT_RULES_KEY, "information-usage", employeeId, year, month],
    queryFn: () => extendedAttendanceRuleService.getInformationUsageThisMonth(employeeId as string, year as number, month as number),
    enabled: Boolean(employeeId && year && month),
  });
}

export function useNightDutyApprovals(companyId?: string, status?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "list", companyId, status],
    queryFn: () => extendedAttendanceRuleService.getNightDutyApprovals(companyId as string, status),
    enabled: Boolean(companyId),
  });
}

/** Requests visible to the current user as an Operations Manager (their assigned stores' pending
 *  requests + their own past decisions). Empty if they aren't an OM anywhere. */
export function useOmNightDutyApprovals(companyId?: string, omEmployeeId?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "om", companyId, omEmployeeId],
    queryFn: () => extendedAttendanceRuleService.getOmNightDutyApprovals(companyId as string, omEmployeeId as string),
    enabled: Boolean(companyId && omEmployeeId),
  });
}

/** Requests visible to the current user as a Super Manager (all pending_super_manager requests
 *  company-wide + their own past final decisions). */
export function useSuperManagerNightDutyApprovals(companyId?: string, superManagerEmployeeId?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "super-manager", companyId, superManagerEmployeeId],
    queryFn: () => extendedAttendanceRuleService.getSuperManagerNightDutyApprovals(companyId as string, superManagerEmployeeId as string),
    enabled: Boolean(companyId && superManagerEmployeeId),
  });
}

/** Store ids the current employee is an active Operations Manager for (empty = not an OM anywhere). */
export function useMyOperationsManagerStores(employeeId?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "my-om-stores", employeeId],
    queryFn: () => extendedAttendanceRuleService.getMyOperationsManagerStores(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

/** Is the current employee an active Super Manager? */
export function useAmISuperManager(employeeId?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "am-i-super-manager", employeeId],
    queryFn: () => extendedAttendanceRuleService.amISuperManager(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useOperationsManagerAssignments(companyId?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "om-assignments", companyId],
    queryFn: () => extendedAttendanceRuleService.listOperationsManagerAssignments(companyId as string),
    enabled: Boolean(companyId),
  });
}

export function useAssignOperationsManager() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { companyId: string; employeeId: string; storeId: string; remark?: string; userId?: string }) =>
      extendedAttendanceRuleService.assignOperationsManager(params.companyId, params.employeeId, params.storeId, params.remark, params.userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: NIGHT_DUTY_KEY }),
  });
}

export function useSetOperationsManagerActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; isActive: boolean; userId?: string }) =>
      extendedAttendanceRuleService.setOperationsManagerActive(params.id, params.isActive, params.userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: NIGHT_DUTY_KEY }),
  });
}

export function useSuperManagers(companyId?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "super-managers", companyId],
    queryFn: () => extendedAttendanceRuleService.listSuperManagers(companyId as string),
    enabled: Boolean(companyId),
  });
}

export function useDesignateSuperManager() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { companyId: string; employeeId: string; remark?: string; userId?: string }) =>
      extendedAttendanceRuleService.designateSuperManager(params.companyId, params.employeeId, params.remark, params.userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: NIGHT_DUTY_KEY }),
  });
}

export function useSetSuperManagerActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; isActive: boolean; userId?: string }) =>
      extendedAttendanceRuleService.setSuperManagerActive(params.id, params.isActive, params.userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: NIGHT_DUTY_KEY }),
  });
}

export function useMyNightDutyApprovals(employeeId?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "mine", employeeId],
    queryFn: () => extendedAttendanceRuleService.getMyNightDutyApprovals(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

/** The logged-in employee's OWN Night Duty requests + approval history — secure & self-scoped
 *  (attendance_night_duty_list_mine, no client employee id). Under NIGHT_DUTY_KEY so the OM /
 *  Super Manager decide mutations auto-invalidate it. */
export function useMyNightDutyHistory() {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "my-history"],
    queryFn: () => extendedAttendanceRuleService.getMyNightDutyHistory(),
  });
}

/**
 * Every Night Duty approval for one employee within a date range — feeds the Monthly Attendance /
 * date-range Overtime + Night Duty Payable merge (modules/attendance/utils.ts). Shares the
 * `NIGHT_DUTY_KEY` prefix so the OM/Super Manager decide mutations below automatically invalidate
 * it — approving Night Duty immediately reflects here on next fetch, no manual refresh needed.
 */
export function useNightDutyApprovalsRange(employeeId?: string, fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "range", employeeId, fromDate, toDate],
    queryFn: () => extendedAttendanceRuleService.getNightDutyApprovalsForEmployeeRange(employeeId as string, fromDate as string, toDate as string),
    enabled: Boolean(employeeId && fromDate && toDate),
  });
}

/** Same as above, for multiple employees at once — the Admin Attendance Dashboard's Daily Attendance Records table. */
export function useNightDutyApprovalsForEmployees(employeeIds: string[], fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: [...NIGHT_DUTY_KEY, "range-multi", employeeIds, fromDate, toDate],
    queryFn: () => extendedAttendanceRuleService.getNightDutyApprovalsForEmployeesRange(employeeIds, fromDate as string, toDate as string),
    enabled: employeeIds.length > 0 && Boolean(fromDate && toDate),
  });
}

export function useNightDutyDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { approvalId: string; decision: "approved" | "disallowed"; managerPayableOutTime?: string | null; remark?: string }) =>
      attendanceService.nightDutyDecide(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NIGHT_DUTY_KEY });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["attendance-admin"] });
    },
  });
}

/** Operations Manager decision: approve (final), disallow (final, requires confirmed payable out
 *  time), or carry forward to Super Manager (not final). Server-side RPC enforces the OM is
 *  actively assigned to the request's store and did not raise the request themselves. */
export function useNightDutyOmDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { approvalId: string; decision: "approved" | "disallowed" | "carry_forward"; managerPayableOutTime?: string | null; remark?: string }) =>
      attendanceService.nightDutyOmDecide(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NIGHT_DUTY_KEY });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["attendance-admin"] });
    },
  });
}

/** Super Manager final decision on a carried-forward request: approve or disallow (requires
 *  confirmed payable out time). Server-side RPC enforces the caller is an active Super Manager and
 *  the request is currently pending_super_manager. */
export function useNightDutySuperManagerDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { approvalId: string; decision: "approved" | "disallowed"; managerPayableOutTime?: string | null; remark?: string }) =>
      attendanceService.nightDutySuperManagerDecide(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NIGHT_DUTY_KEY });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["attendance-admin"] });
    },
  });
}
