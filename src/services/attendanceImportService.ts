import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import type {
  AttendanceImportPreviewRow,
  AttendanceImportRawRow,
  AttendanceImportResult,
  AttendanceImportSummary,
} from "@/types/attendanceImport";

/**
 * Attendance Import — thin adapter over the server RPCs. The client ONLY reads the spreadsheet and
 * maps its columns; every attendance calculation (Status / Late / Early Going / Half Day / Working /
 * Break / Overtime / Night OT), employee matching, shift resolution, weekly-off / holiday / leave
 * resolution, duplicate detection, company isolation and finalized-payroll protection happen in
 * `attendance_import_preview` / `attendance_import_commit`, which reuse the SAME engine
 * (compute_extended_attendance_facts + attendance_admin_upsert) that manual Super-Admin corrections
 * use. There is no client-side attendance calculation here.
 */

const HEADER_MAP: Record<string, keyof AttendanceImportRawRow> = {
  "staff id": "staffId",
  "staff code": "staffId",
  "employee code": "staffId",
  "emp code": "staffId",
  code: "staffId",
  "staff name": "staffName",
  "employee name": "staffName",
  name: "staffName",
  date: "date",
  "attendance date": "date",
  "punch in": "punchIn",
  "punch-in": "punchIn",
  "in time": "punchIn",
  "punch out": "punchOut",
  "punch-out": "punchOut",
  "out time": "punchOut",
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function rowsFromObjects(objects: Record<string, unknown>[]): AttendanceImportRawRow[] {
  return objects.map((obj) => {
    const row: AttendanceImportRawRow = {};
    for (const [key, value] of Object.entries(obj)) {
      const mapped = HEADER_MAP[normalizeHeader(key)];
      if (mapped) {
        const text = cellToString(value);
        if (text) (row as Record<string, string>)[mapped] = text;
      }
    }
    return row;
  });
}

function toRpcRow(raw: AttendanceImportRawRow, rowNumber: number) {
  return {
    row_number: rowNumber,
    staff_id: raw.staffId ?? "",
    staff_name: raw.staffName ?? "",
    date_raw: raw.date ?? "",
    punch_in_raw: raw.punchIn ?? "",
    punch_out_raw: raw.punchOut ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPreviewRow(raw: AttendanceImportRawRow, r: any): AttendanceImportPreviewRow {
  return {
    rowNumber: Number(r.row_number),
    raw,
    state: (r.state ?? "error") as AttendanceImportPreviewRow["state"],
    errors: Array.isArray(r.errors) ? r.errors.map(String) : [],
    warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
    staffId: r.staff_id ?? "",
    staffName: r.staff_name ?? "",
    employeeId: r.employee_id ?? null,
    employeeName: r.employee_name ?? null,
    employeeCode: r.employee_code ?? null,
    nameMatch: Boolean(r.name_match),
    date: r.date ?? null,
    punchIn: r.punch_in ?? null,
    punchOut: r.punch_out ?? null,
    shiftName: r.shift_name ?? null,
    weeklyOff: Boolean(r.weekly_off),
    holiday: Boolean(r.holiday),
    leave: Boolean(r.leave),
    calcStatus: r.calc_status ?? null,
    lateMinutes: r.late_minutes ?? null,
    earlyGoingMinutes: r.early_going_minutes ?? null,
    totalWorkingMinutes: r.total_working_minutes ?? null,
    breakDeductionMinutes: r.break_deduction_minutes ?? null,
    workingMinutes: r.working_minutes ?? null,
    overtimeMinutes: r.overtime_minutes ?? null,
    nightOtMinutes: r.night_ot_minutes ?? null,
    halfDayReason: r.half_day_reason ?? null,
    isUpdate: Boolean(r.is_update),
  };
}

export const attendanceImportService = {
  /** Parses a .csv, .xlsx, or .xls file into raw import rows. */
  async parseFile(file: File): Promise<AttendanceImportRawRow[]> {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "csv" && extension !== "xlsx" && extension !== "xls") {
      throw new Error("Unsupported file type. Please upload a .csv, .xlsx, or .xls file.");
    }
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const objects = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
    return rowsFromObjects(objects);
  },

  /** Downloadable Excel template: raw punches only, plus a visible note that everything else is calculated. */
  downloadSampleTemplate(): void {
    const headers = ["Staff ID", "Staff Name", "Date", "Punch In", "Punch Out"];
    const sampleRows = [
      ["PR-V07780719", "VANDANA VERMA", "10/08/2026", "02:30 PM", "11:00 PM"],
      ["PR-A00112233", "RAHUL SINGH", "10/08/2026", "", ""],
    ];
    const noteRows = [
      [],
      ["Do not enter Present / Absent / Half Day / Weekly Off / Late / Overtime."],
      ["These values are calculated automatically by HRMS from the configured Shift, Schedule,"],
      ["Attendance Rules, Weekly Off, Holiday and Leave configuration."],
      ["Date format: DD/MM/YYYY. Punch times: 02:30 PM or 14:30. Overnight shifts are supported."],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sampleRows, ...noteRows]);
    worksheet["!cols"] = headers.map(() => ({ wch: 22 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance Import");
    XLSX.writeFile(workbook, "attendance-import-sample.xlsx");
  },

  /** Server-side validate + calculate every row (no writes). */
  async buildPreview(
    rawRows: AttendanceImportRawRow[],
    companyId: string,
  ): Promise<{ rows: AttendanceImportPreviewRow[]; summary: AttendanceImportSummary }> {
    const { data, error } = await supabase.rpc("attendance_import_preview", {
      p_company_id: companyId,
      p_rows: rawRows.map((raw, i) => toRpcRow(raw, i + 2)),
    });
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = data as any;
    const rpcRows: unknown[] = Array.isArray(payload?.rows) ? payload.rows : [];
    const rows = rpcRows.map((r, i) => mapPreviewRow(rawRows[i] ?? {}, r));
    const s = payload?.summary ?? {};
    const summary: AttendanceImportSummary = {
      total: Number(s.total ?? rows.length),
      valid: Number(s.valid ?? 0),
      new: Number(s.new ?? 0),
      updates: Number(s.updates ?? 0),
      warnings: Number(s.warnings ?? 0),
      errors: Number(s.errors ?? 0),
    };
    return { rows, summary };
  },

  /** Server-side commit — refuses the whole import if any row has an error. Writes via attendance_admin_upsert. */
  async commitImport(rows: AttendanceImportPreviewRow[], companyId: string): Promise<AttendanceImportResult> {
    const { data, error } = await supabase.rpc("attendance_import_commit", {
      p_company_id: companyId,
      p_rows: rows.map((row) => toRpcRow(row.raw, row.rowNumber)),
    });
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = data as any;
    return {
      imported: Number(payload?.imported ?? 0),
      updated: Number(payload?.updated ?? 0),
      skipped: Number(payload?.skipped ?? 0),
      affectedPeriods: Array.isArray(payload?.affected_periods) ? payload.affected_periods.map(String) : [],
      note: String(payload?.note ?? ""),
    };
  },
};
