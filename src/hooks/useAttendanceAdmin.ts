import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { attendanceAdminService } from "@/services/attendanceAdminService";
import { attendanceService } from "@/services/attendanceService";
import type { AttendanceAdminFilters } from "@/types/attendanceAdmin";

const ATTENDANCE_ADMIN_KEY = ["attendance-admin"] as const;
const ATTENDANCE_KEY = ["attendance"] as const;

export function useAdminDailyAttendance(filters: AttendanceAdminFilters) {
  return useQuery({
    queryKey: [...ATTENDANCE_ADMIN_KEY, "daily", filters],
    queryFn: () => attendanceAdminService.getAdminDailyAttendance(filters),
    enabled: Boolean(filters.companyId || filters.dateFrom || filters.storeId || filters.departmentId || filters.employeeId || filters.search || filters.status),
  });
}

export function useAttendanceAdminSummary(filters: AttendanceAdminFilters) {
  return useQuery({
    queryKey: [...ATTENDANCE_ADMIN_KEY, "summary", filters],
    queryFn: () => attendanceAdminService.getAttendanceSummary(filters),
    enabled: Boolean(filters.companyId || filters.dateFrom || filters.storeId || filters.departmentId || filters.employeeId || filters.search || filters.status),
  });
}

export function useStoreAttendanceSummary(filters: AttendanceAdminFilters) {
  return useQuery({
    queryKey: [...ATTENDANCE_ADMIN_KEY, "store-summary", filters],
    queryFn: () => attendanceAdminService.getStoreAttendanceSummary(filters),
    enabled: Boolean(filters.companyId || filters.dateFrom || filters.storeId || filters.departmentId || filters.employeeId || filters.search || filters.status),
  });
}

export function useDemoAttendanceCount(companyId?: string) {
  return useQuery({
    queryKey: [...ATTENDANCE_ADMIN_KEY, "demo-count", companyId],
    queryFn: () => attendanceAdminService.getDemoAttendanceCount(companyId as string),
    enabled: Boolean(companyId),
  });
}

export function useGenerateDemoAttendance(companyId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => attendanceAdminService.generateDemoAttendance(companyId as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_ADMIN_KEY });
    },
  });
}

export function useClearDemoAttendance(companyId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => attendanceAdminService.clearDemoAttendance(companyId as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_ADMIN_KEY });
    },
  });
}

/**
 * Super Admin manual Punch In/Out for a selected employee. Invalidates both the
 * admin views (daily/summary/store-summary) AND the plain "attendance" cache so
 * the affected employee's own Staff Panel (today/monthly) reflects it immediately.
 * The is_super_admin() gate lives in the RPC itself — this hook has no special
 * client-side permission logic to bypass.
 */
export function useAdminPunch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, type, remark }: { employeeId: string; type: "punch_in" | "punch_out"; remark?: string }) =>
      attendanceService.adminPunch(employeeId, type, remark),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_ADMIN_KEY });
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY });
    },
  });
}

/**
 * Super Admin create/edit attendance for any date <= today. Same cache invalidation as
 * useAdminPunch() — the edited employee's own Staff Panel (today/monthly/range) and every admin
 * view must reflect the correction immediately.
 */
export function useAdminUpsertAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      employeeId: string;
      attendanceDate: string;
      status: string;
      punchInTime?: string | null;
      punchOutTime?: string | null;
      remark?: string;
    }) => attendanceService.adminUpsert(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_ADMIN_KEY });
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY });
    },
  });
}

/**
 * Super Admin manual "Use Information" (migrations 0072/0073) — an independent action, separate
 * from useAdminUpsertAttendance/the Save button. Same cache invalidation as every other admin
 * attendance mutation, PLUS the "explain-rules" query specifically (queryFn key includes
 * "explain-rules" under ATTENDANCE_KEY, so the broad ATTENDANCE_KEY invalidation above already
 * covers it) so the Applied Attendance Rules panel reflects the new Information/Penalty result
 * immediately without a page reload.
 */
export function useAttendanceUseInformation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attendanceRecordId, remark }: { attendanceRecordId: string; remark?: string }) =>
      attendanceService.useInformation(attendanceRecordId, remark),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_ADMIN_KEY });
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY });
    },
  });
}
