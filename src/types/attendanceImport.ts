/**
 * Attendance Import — Excel/CSV of raw punches only (Staff ID, Staff Name, Date, Punch In,
 * Punch Out). All attendance outcomes (Status, Late, Early Going, Half Day, Working, Break,
 * Overtime, Night OT) are calculated server-side by the EXISTING attendance engine
 * (compute_extended_attendance_facts + attendance_admin_upsert) via the attendance_import_preview /
 * attendance_import_commit RPCs — never by the client.
 */

/** One spreadsheet row, mapped from the file's columns (original cell strings, unparsed). */
export interface AttendanceImportRawRow {
  staffId?: string;
  staffName?: string;
  date?: string;
  punchIn?: string;
  punchOut?: string;
}

export type AttendanceImportRowState = "valid" | "warning" | "update" | "error";

export interface AttendanceImportPreviewRow {
  rowNumber: number;
  raw: AttendanceImportRawRow;
  state: AttendanceImportRowState;
  errors: string[];
  warnings: string[];

  staffId: string;
  staffName: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  nameMatch: boolean;

  date: string | null;
  punchIn: string | null;
  punchOut: string | null;

  shiftName: string | null;
  weeklyOff: boolean;
  holiday: boolean;
  leave: boolean;

  calcStatus: string | null;
  lateMinutes: number | null;
  earlyGoingMinutes: number | null;
  totalWorkingMinutes: number | null;
  breakDeductionMinutes: number | null;
  workingMinutes: number | null;
  overtimeMinutes: number | null;
  nightOtMinutes: number | null;
  halfDayReason: string | null;
  isUpdate: boolean;
}

export interface AttendanceImportSummary {
  total: number;
  valid: number;
  new: number;
  updates: number;
  warnings: number;
  errors: number;
}

export interface AttendanceImportResult {
  imported: number;
  updated: number;
  skipped: number;
  affectedPeriods: string[];
  note: string;
}
