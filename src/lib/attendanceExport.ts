import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Shared Excel/PDF export engine for the Attendance module.
 *
 * Callers pass already-formatted display strings (the same values rendered on screen), so
 * exports never recompute attendance facts — they only re-present the data already shown.
 */

export interface ExportColumn {
  header: string;
  key: string;
}

export interface ExportRequest {
  fileNameBase: string;
  reportTitle: string;
  metaLines: string[];
  columns: ExportColumn[];
  rows: Record<string, string | number>[];
  landscape?: boolean;
}

/**
 * Night Duty columns — shared suffix appended to both column sets below. Values must always come
 * from resolveNightDutyFacts() (modules/attendance/utils.ts), the same authoritative merge used
 * on-screen everywhere — exports never recompute Night Duty/Night OT themselves.
 */
const NIGHT_DUTY_ATTENDANCE_COLUMNS: ExportColumn[] = [
  { header: "Night Duty", key: "nightDuty" },
  { header: "Night Duty Status", key: "nightDutyStatus" },
  { header: "Night OT", key: "nightOt" },
  { header: "Night Duty Payable", key: "nightDutyPayable" },
];

/** Columns for a single employee's date-wise attendance (identity goes in metaLines instead). */
export const SINGLE_EMPLOYEE_ATTENDANCE_COLUMNS: ExportColumn[] = [
  { header: "Date", key: "date" },
  { header: "Day", key: "day" },
  { header: "Punch In", key: "punchIn" },
  { header: "Punch Out", key: "punchOut" },
  { header: "Total Working", key: "totalWorking" },
  { header: "Break Deduction", key: "breakDeduction" },
  { header: "Final Working", key: "workingHours" },
  { header: "Late", key: "late" },
  { header: "Overtime", key: "overtime" },
  { header: "Early Going", key: "earlyGoing" },
  ...NIGHT_DUTY_ATTENDANCE_COLUMNS,
  { header: "Status", key: "status" },
];

/** Columns for a multi-employee attendance register (identity repeated per row). */
export const MULTI_EMPLOYEE_ATTENDANCE_COLUMNS: ExportColumn[] = [
  { header: "Employee Code", key: "employeeCode" },
  { header: "Staff Name", key: "staffName" },
  { header: "Store", key: "store" },
  { header: "Department", key: "department" },
  { header: "Date", key: "date" },
  { header: "Day", key: "day" },
  { header: "Punch In", key: "punchIn" },
  { header: "Punch Out", key: "punchOut" },
  { header: "Total Working", key: "totalWorking" },
  { header: "Break Deduction", key: "breakDeduction" },
  { header: "Final Working", key: "workingHours" },
  { header: "Late", key: "late" },
  { header: "Overtime", key: "overtime" },
  { header: "Early Going", key: "earlyGoing" },
  ...NIGHT_DUTY_ATTENDANCE_COLUMNS,
  { header: "Status", key: "status" },
];

function timestampSuffix(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function exportAttendanceToExcel(request: ExportRequest): void {
  const { fileNameBase, reportTitle, metaLines, columns, rows } = request;

  const sheetData: (string | number)[][] = [[reportTitle]];
  metaLines.forEach((line) => sheetData.push([line]));
  sheetData.push([]);
  sheetData.push(columns.map((column) => column.header));
  rows.forEach((row) => sheetData.push(columns.map((column) => row[column.key] ?? "")));

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet["!cols"] = columns.map(() => ({ wch: 18 }));
  if (columns.length > 1) {
    worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } }];
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
  XLSX.writeFile(workbook, `${fileNameBase}-${timestampSuffix()}.xlsx`);
}

export function exportAttendanceToPdf(request: ExportRequest): void {
  const { fileNameBase, reportTitle, metaLines, columns, rows, landscape } = request;

  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });

  doc.setFontSize(14);
  doc.text(reportTitle, 40, 40);

  doc.setFontSize(9);
  doc.setTextColor(90);
  let cursorY = 58;
  metaLines.forEach((line) => {
    doc.text(line, 40, cursorY);
    cursorY += 13;
  });
  doc.setTextColor(0);

  autoTable(doc, {
    startY: cursorY + 8,
    head: [columns.map((column) => column.header)],
    body: rows.map((row) => columns.map((column) => String(row[column.key] ?? ""))),
    styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 40, right: 40 },
    // jspdf-autotable repeats the `head` row automatically on every page.
  });

  doc.save(`${fileNameBase}-${timestampSuffix()}.pdf`);
}
