import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { attendanceService } from "@/services/attendanceService";

const ATTENDANCE_KEY = ["attendance"] as const;

export function useCurrentEmployee(email?: string | null, companyId?: string | null, userId?: string | null) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "employee", email, companyId, userId],
    queryFn: () => attendanceService.getCurrentEmployee(companyId, email, userId),
    enabled: Boolean(companyId && (email || userId)),
  });
}

export function useEmployeeShift(employeeId?: string, attendanceDate?: string) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "shift", employeeId, attendanceDate],
    queryFn: () => attendanceService.getEmployeeShift(employeeId as string, attendanceDate as string),
    enabled: Boolean(employeeId && attendanceDate),
  });
}

export function useTodayAttendance(employeeId?: string) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "today", employeeId],
    queryFn: () => attendanceService.getTodayAttendance(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useAttendanceByDate(employeeId?: string, date?: string) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "date", employeeId, date],
    queryFn: () => attendanceService.getAttendanceByDate(employeeId as string, date as string),
    enabled: Boolean(employeeId && date),
  });
}

export function useMonthlyAttendance(employeeId?: string, year?: number, month?: number) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "monthly", employeeId, year, month],
    queryFn: () => attendanceService.getMonthlyAttendance(employeeId as string, year as number, month as number),
    enabled: Boolean(employeeId && year && month),
  });
}

/** Resolves the LIVE attendance_records Night Duty columns for a specific set of record ids —
 *  see attendanceService.getRecordsByIds(). */
export function useAttendanceRecordsByIds(ids: string[]) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "by-ids", ids],
    queryFn: () => attendanceService.getRecordsByIds(ids),
    enabled: ids.length > 0,
  });
}

export function useAttendanceRange(employeeId?: string, fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "range", employeeId, fromDate, toDate],
    queryFn: () => attendanceService.getAttendanceRange(employeeId as string, fromDate as string, toDate as string),
    enabled: Boolean(employeeId && fromDate && toDate),
  });
}

export function useAttendanceMonthlySummary(employeeId?: string, year?: number, month?: number) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "monthly-summary", employeeId, year, month],
    queryFn: () => attendanceService.getMonthlySummary(employeeId as string, year as number, month as number),
    enabled: Boolean(employeeId && year && month),
  });
}

/**
 * Read-only rule-resolution explanation for one attendance record — powers the Edit Attendance
 * dialog's "Applied Attendance Rules" section. Only enabled once every id it needs (company,
 * employee, shift, store) is known; a record with no resolvable shift simply never fires this.
 */
export function useExplainAttendanceRules(params: {
  companyId?: string;
  employeeId?: string;
  shiftId?: string;
  storeId?: string;
  attendanceDate?: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  useInformation?: boolean;
} | null) {
  const ready = Boolean(params?.companyId && params?.employeeId && params?.shiftId && params?.storeId && params?.attendanceDate);
  return useQuery({
    queryKey: [
      ...ATTENDANCE_KEY,
      "explain-rules",
      params?.companyId,
      params?.employeeId,
      params?.shiftId,
      params?.storeId,
      params?.attendanceDate,
      params?.punchInAt,
      params?.punchOutAt,
    ],
    queryFn: () =>
      attendanceService.explainRules({
        companyId: params!.companyId as string,
        employeeId: params!.employeeId as string,
        shiftId: params!.shiftId as string,
        storeId: params!.storeId as string,
        attendanceDate: params!.attendanceDate as string,
        punchInAt: params!.punchInAt,
        punchOutAt: params!.punchOutAt,
        useInformation: params?.useInformation,
      }),
    enabled: ready,
  });
}

export function usePunchIn(_employeeId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (useInformation?: boolean) => attendanceService.punchIn(useInformation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY });
    },
  });
}

export function usePunchOut(_employeeId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => attendanceService.punchOut(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY });
    },
  });
}
