import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/common/LoadingState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMonthlyAttendance } from "@/hooks/useAttendance";
import { useWeeklyOffHistory, useWeeklyOffOverrides } from "@/hooks/useWeeklyOff";
import { useNightDutyApprovalsRange } from "@/hooks/useExtendedAttendanceRules";
import { useLeaveAttendanceEffects } from "@/hooks/useLeave";
import { formatDate } from "@/lib/utils";
import { currentMonthKey, firstDateOfMonth, lastDateOfMonth } from "@/lib/dateRange";
import { exportAttendanceToExcel, exportAttendanceToPdf, SINGLE_EMPLOYEE_ATTENDANCE_COLUMNS } from "@/lib/attendanceExport";
import { buildAttendanceSummary, buildMonthlyAttendanceRows, formatDateTime, formatMinutes, nightDutyExportFields } from "@/modules/attendance/utils";
import { ATTENDANCE_STATUS_LABELS } from "@/constants/attendance";
import { AttendanceStatusBadge, NightDutyCell, SummaryCard } from "./shared";

export interface MonthlyDialogEmployee {
  id: string;
  fullName: string;
  employeeCode: string | null;
  storeName: string | null;
  departmentName: string | null;
}

interface MonthlyAttendanceDialogProps {
  employee: MonthlyDialogEmployee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Employee Monthly Attendance popup — reused by both the Admin View "View month" action and the
 * Super Admin Staff View "View Month" action (Part 7: one implementation, only the caller differs).
 */
export function MonthlyAttendanceDialog({ employee, open, onOpenChange }: MonthlyAttendanceDialogProps) {
  const [month, setMonth] = useState(() => currentMonthKey());

  // Always open on the current month for whichever employee was just selected.
  useEffect(() => {
    if (open) setMonth(currentMonthKey());
  }, [open, employee?.id]);

  const [year, monthNumber] = useMemo(() => {
    const [y, m] = month.split("-");
    return [Number(y), Number(m)];
  }, [month]);

  const monthlyQuery = useMonthlyAttendance(employee?.id, year, monthNumber);
  const weeklyOffHistoryQuery = useWeeklyOffHistory(employee?.id);
  const weeklyOffOverridesQuery = useWeeklyOffOverrides(employee?.id);
  const nightDutyApprovalsQuery = useNightDutyApprovalsRange(employee?.id, firstDateOfMonth(year, monthNumber), lastDateOfMonth(year, monthNumber));
  // Phase 5 — approved-Leave dates merged into the calendar at display time exactly like Weekly Off
  // already is (modules/attendance/utils.ts toAttendanceRow()); never written into attendance_records.
  const leaveEffectsQuery = useLeaveAttendanceEffects(employee?.id, firstDateOfMonth(year, monthNumber), lastDateOfMonth(year, monthNumber));

  const rows = useMemo(
    () =>
      buildMonthlyAttendanceRows(
        monthlyQuery.data ?? [],
        year,
        monthNumber,
        weeklyOffHistoryQuery.data ?? [],
        weeklyOffOverridesQuery.data ?? [],
        nightDutyApprovalsQuery.data ?? [],
        leaveEffectsQuery.data ?? []
      ),
    [monthlyQuery.data, year, monthNumber, weeklyOffHistoryQuery.data, weeklyOffOverridesQuery.data, nightDutyApprovalsQuery.data, leaveEffectsQuery.data]
  );
  const summary = useMemo(() => buildAttendanceSummary(rows), [rows]);

  const monthLabel = useMemo(
    () => new Date(year, monthNumber - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    [year, monthNumber]
  );

  const buildExportRequest = () => {
    const metaLines = [
      `Employee Name: ${employee?.fullName ?? "—"}`,
      `Employee Code: ${employee?.employeeCode ?? "—"}`,
      `Store: ${employee?.storeName ?? "—"}`,
      `Department: ${employee?.departmentName ?? "—"}`,
      `Month: ${monthLabel}`,
      "",
      `Total Overtime Minutes: ${summary.overtimeMinutes}`,
      `Total Night OT Minutes: ${summary.nightOtMinutes}`,
      `Total Night Duty Days: ${summary.nightDutyPayable}`,
      `Total Night Duty Payable: ${summary.nightDutyPayable}`,
    ];

    const exportRows = rows.map((row) =>
      row.isFuture
        ? {
            date: formatDate(row.date),
            day: row.day,
            punchIn: "—",
            punchOut: "—",
            totalWorking: "—",
            breakDeduction: "—",
            workingHours: "—",
            late: "—",
            overtime: "—",
            earlyGoing: "—",
            nightDuty: "—",
            nightDutyStatus: "—",
            nightOt: "—",
            nightDutyPayable: "—",
            status: "Upcoming",
          }
        : {
            date: formatDate(row.date),
            day: row.day,
            punchIn: row.punchInAt ? formatDateTime(row.punchInAt) : "—",
            punchOut: row.punchOutAt ? formatDateTime(row.punchOutAt) : "—",
            totalWorking: formatMinutes(row.totalWorkingMinutes ?? 0),
            breakDeduction: formatMinutes(row.breakDeductionMinutes ?? 0),
            workingHours: formatMinutes(row.workingMinutes ?? 0),
            late: row.lateMinutes ?? "—",
            overtime: row.overtimeMinutes ?? "—",
            earlyGoing: row.earlyGoingMinutes ?? "—",
            ...nightDutyExportFields(row),
            status: ATTENDANCE_STATUS_LABELS[row.status],
          }
    );

    return {
      fileNameBase: `attendance-${(employee?.employeeCode ?? employee?.id ?? "employee").toString().replace(/\s+/g, "-")}-${month}`,
      reportTitle: "Employee Monthly Attendance",
      metaLines,
      columns: SINGLE_EMPLOYEE_ATTENDANCE_COLUMNS,
      rows: exportRows,
    };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Employee Monthly Attendance</DialogTitle>
          <DialogDescription>Review the selected employee's monthly attendance details.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-start gap-2">
              <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Employee Name</p>
                <p className="text-sm font-medium">{employee?.fullName ?? "—"}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Employee Code</p>
              <p className="text-sm font-medium">{employee?.employeeCode ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Store</p>
              <p className="text-sm font-medium">{employee?.storeName ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Department</p>
              <p className="text-sm font-medium">{employee?.departmentName ?? "—"}</p>
            </div>
          </div>

          <div className="grid items-end gap-4 sm:grid-cols-[1fr_220px]">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportAttendanceToExcel(buildExportRequest())}
                disabled={rows.length === 0}
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportAttendanceToPdf(buildExportRequest())}
                disabled={rows.length === 0}
              >
                <FileText className="mr-2 h-4 w-4" />
                Export PDF
              </Button>
            </div>
            <div>
              <Label>Month</Label>
              <Input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                max={currentMonthKey()}
              />
            </div>
          </div>

          {!employee ? null : monthlyQuery.isLoading ? (
            <LoadingState />
          ) : monthlyQuery.error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              Unable to load employee monthly attendance.
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard label="Present" value={summary.present} />
                <SummaryCard label="Absent" value={summary.absent} />
                <SummaryCard label="Leave" value={summary.leave} />
                <SummaryCard label="Weekly Off" value={summary.weeklyOff} />
                <SummaryCard label="Half Days" value={summary.halfDay} />
                <SummaryCard label="Late Days" value={summary.lateDays} />
                <SummaryCard label="Late Minutes" value={summary.lateMinutes} />
                <SummaryCard label="Overtime Minutes" value={summary.overtimeMinutes} />
                <SummaryCard label="Early Going Minutes" value={summary.earlyGoingMinutes} />
                <SummaryCard label="Night Duty Payable" value={summary.nightDutyPayable} />
              </div>

              <Table containerClassName="max-h-[45vh] rounded-lg border">
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>Punch In</TableHead>
                    <TableHead>Punch Out</TableHead>
                    <TableHead>Total Working</TableHead>
                    <TableHead>Break Deduction</TableHead>
                    <TableHead>Final Working</TableHead>
                    <TableHead>Late</TableHead>
                    <TableHead>Overtime</TableHead>
                    <TableHead>Early Going</TableHead>
                    <TableHead>Night Duty</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) =>
                    row.isFuture ? (
                      <TableRow key={row.date} className="text-muted-foreground">
                        <TableCell>{formatDate(row.date)}</TableCell>
                        <TableCell>{row.day}</TableCell>
                        <TableCell colSpan={10}>Upcoming</TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.date}>
                        <TableCell>{formatDate(row.date)}</TableCell>
                        <TableCell>{row.day}</TableCell>
                        <TableCell>{row.punchInAt ? formatDateTime(row.punchInAt) : "—"}</TableCell>
                        <TableCell>{row.punchOutAt ? formatDateTime(row.punchOutAt) : "—"}</TableCell>
                        <TableCell>{formatMinutes(row.totalWorkingMinutes ?? 0)}</TableCell>
                        <TableCell>{formatMinutes(row.breakDeductionMinutes ?? 0)}</TableCell>
                        <TableCell>{formatMinutes(row.workingMinutes ?? 0)}</TableCell>
                        <TableCell>{row.lateMinutes ?? "—"}</TableCell>
                        <TableCell>{row.overtimeMinutes ?? "—"}</TableCell>
                        <TableCell>{row.earlyGoingMinutes ?? "—"}</TableCell>
                        <TableCell>
                          <NightDutyCell status={row.nightDutyStatus} days={row.nightDutyDays} nightOtMinutes={row.nightOtMinutes} />
                        </TableCell>
                        <TableCell>
                          <AttendanceStatusBadge status={row.status} />
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
