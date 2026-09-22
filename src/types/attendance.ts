import type { AttendanceStatus, AttendanceSource } from "./database.types";

/**
 * A Shift defines ONLY scheduled timing and eligibility — never Late/Overtime calculation rules
 * themselves (those live entirely in Attendance Rule Management > Late Rules / Overtime Rules).
 * `breakMinutes` is kept because it is still legitimately used for an independent calculation
 * (Working Minutes = punch span − break), but it is no longer editable from the Shift UI — see
 * Part 1 of the Shift/Late/Overtime separation. `graceMinutes` / `minimumWorkMinutes` are
 * deliberately NOT exposed here anymore: the database columns still exist (for backward safety)
 * but nothing in this app reads them for calculation purposes any longer.
 */
export interface AttendanceShift {
  id: string;
  companyId: string;
  name: string;
  shiftCode: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  lateEligible: boolean;
  overtimeEnabled: boolean;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeShiftAssignment {
  id: string;
  companyId: string;
  employeeId: string;
  shiftId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceRecord {
  id: string;
  companyId: string;
  employeeId: string;
  storeId: string;
  attendanceDate: string;
  shiftId: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  /** Punch Out - Punch In, before any break deduction. Always populated whenever both punches
   *  exist, for every day type (Normal, Weekly Off, Holiday, ...). */
  totalWorkingMinutes: number | null;
  /** The break duration actually deducted to arrive at workingMinutes (Final Working). */
  breakDeductionMinutes: number | null;
  /** Final Working = totalWorkingMinutes - breakDeductionMinutes (floored at 0). Same figure this
   *  field has always held — Total/Break are the two new figures shown alongside it. */
  workingMinutes: number | null;
  lateMinutes: number | null;
  overtimeMinutes: number | null;
  usedInformation: boolean;
  halfDayReason: "late_coming" | "early_going" | null;
  penaltyMinutes: number | null;
  earlyGoingMinutes: number | null;
  extraDutyValue: number | null;
  nightOtMinutes: number | null;
  nightDutyApprovalId: string | null;
  payableWorkingMinutes: number | null;
  payableOvertimeMinutes: number | null;
  payableExtraDutyValue: number | null;
  status: AttendanceStatus;
  remarks: string | null;
  source: AttendanceSource;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceDailySummary {
  date: string;
  day: string;
  punchIn: string | null;
  punchOut: string | null;
  workingHours: string;
  late: string;
  overtime: string;
  status: AttendanceStatus;
}

export interface AttendanceMonthlySummary {
  present: number;
  absent: number;
  leave: number;
  weeklyOff: number;
  halfDay: number;
  lateDays: number;
  lateMinutes: number;
  overtimeMinutes: number;
  earlyGoingMinutes: number;
}

/**
 * One row per attendance rule kind, as actually resolved by resolve_attendance_rule() for one
 * specific attendance record — powers the Edit Attendance dialog's "Applied Attendance Rules"
 * section (migration 0067, attendance_explain_rules()). Never independently decided by the
 * frontend: every field here is read directly off the same authoritative resolver/calculation
 * chain attendance_admin_upsert() itself uses.
 */
export type AttendanceRuleKind = "late" | "weekly_off_late" | "information" | "penalty" | "half_day" | "early_going" | "overtime" | "extended_duty";
export type AttendanceRuleScopeSource = "employee_store" | "store_all_employees" | "all_stores_all_employees" | "legacy";

export interface AttendanceRuleExplanation {
  kind: AttendanceRuleKind;
  /** The resolved rule's own id (e.g. the specific attendance_late_rules row) — null = Not Assigned. */
  ruleId: string | null;
  /** A rule was resolved for this kind at all — distinct from `triggered` (it resolved but produced
   *  a zero/no-op result, e.g. Late Rule applied but punch was within grace). */
  isAssigned: boolean;
  /** The rule actually produced a non-zero/meaningful effect on this specific record. */
  triggered: boolean;
  scopeSource: AttendanceRuleScopeSource | null;
  /** Null = All Stores / All Employees for that tier; otherwise the exact store/employee id the
   *  assignment row was scoped to (only ever the store/employee this record itself belongs to). */
  resolvedStoreId: string | null;
  resolvedEmployeeId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** Rule-kind-specific configured values (grace minutes, cutoff time, monthly limit, ...), read
   *  directly from the resolved rule's own row — never hard-coded. */
  config: Record<string, unknown> | null;
  resultValue: number | null;
  resultNote: string | null;
}

export interface AttendanceCorrection {
  id: string;
  companyId: string;
  employeeId: string;
  attendanceRecordId: string;
  requestedPunchIn: string | null;
  requestedPunchOut: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  requestedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}
