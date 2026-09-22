import type { AttendanceStatus } from "./database.types";
import type { NightDutyDisplayStatus } from "@/modules/attendance/utils";

export interface AttendanceAdminFilters {
  companyId?: string;
  /** Inclusive range start ("YYYY-MM-DD"). Defaults to today when omitted. */
  dateFrom?: string;
  /** Inclusive range end ("YYYY-MM-DD"). Defaults to dateFrom when omitted. */
  dateTo?: string;
  storeId?: string;
  departmentId?: string;
  employeeId?: string;
  search?: string;
  status?: AttendanceStatus;
  isDemo?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AttendanceAdminSummary {
  totalStaff: number;
  present: number;
  absent: number;
  leave: number;
  weeklyOff: number;
  halfDay: number;
  late: number;
  overtime: number;
}

export interface AttendanceAdminDailyRow {
  id: string;
  /** "YYYY-MM-DD" — the specific day this row represents (rows span every day in the filtered range). */
  date: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  /** Null for a Company Wide employee (e.g. Super Manager) — migration 0061. */
  storeId: string | null;
  storeName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  shiftName: string | null;
  punchInAt: string | null;
  punchOutAt: string | null;
  totalWorkingMinutes: number | null;
  breakDeductionMinutes: number | null;
  workingMinutes: number | null;
  lateMinutes: number | null;
  /** The ONE authoritative Overtime figure — existing Overtime PLUS approved Night OT when this
   *  day's Night Duty is Final Approved. See modules/attendance/utils.ts resolveNightDutyFacts(). */
  overtimeMinutes: number | null;
  earlyGoingMinutes: number | null;
  status: AttendanceStatus;
  isDemo: boolean;
  nightDutyStatus: NightDutyDisplayStatus;
  /** 1 when this day's Night Duty is Final Approved, else 0. */
  nightDutyDays: number;
  /** Approved Night OT minutes for this day — 0 unless nightDutyStatus === 'approved'. */
  nightOtMinutes: number;
}

export interface StoreAttendanceSummaryRow {
  /** Null bucket = Company Wide employees (e.g. Super Manager) with no individual store. */
  storeId: string | null;
  storeName: string;
  totalStaff: number;
  present: number;
  absent: number;
  leave: number;
  weeklyOff: number;
  late: number;
  overtime: number;
}

export interface AttendanceCorrectionDetail {
  id: string;
  attendanceRecordId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  storeName: string | null;
  date: string;
  currentPunchIn: string | null;
  currentPunchOut: string | null;
  requestedPunchIn: string | null;
  requestedPunchOut: string | null;
  reason: string | null;
  requestedBy: string | null;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
}

export interface AttendanceEmployeeDetail {
  id: string;
  employeeCode: string;
  fullName: string;
  storeName: string | null;
  departmentName: string | null;
  designationTitle: string | null;
  reportingManagerName: string | null;
  shiftName: string | null;
  todayAttendance: {
    punchInAt: string | null;
    punchOutAt: string | null;
    workingMinutes: number | null;
    lateMinutes: number | null;
    overtimeMinutes: number | null;
    earlyGoingMinutes: number | null;
    status: AttendanceStatus;
  } | null;
}

export interface AttendanceExportRow {
  employeeCode: string;
  employeeName: string;
  storeName: string | null;
  departmentName: string | null;
  date: string;
  shiftName: string | null;
  punchInAt: string | null;
  punchOutAt: string | null;
  totalWorkingMinutes: number | null;
  breakDeductionMinutes: number | null;
  workingMinutes: number | null;
  lateMinutes: number | null;
  overtimeMinutes: number | null;
  earlyGoingMinutes: number | null;
  status: AttendanceStatus;
}
