import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/common/LoadingState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useStores } from "@/hooks/useStores";
import { useMonthlyAttendance } from "@/hooks/useAttendance";
import { useCurrentShiftAssignment, useShiftAssignmentHistory } from "@/hooks/useShifts";
import { useCurrentWeeklyOff, useWeeklyOffHistory, useWeeklyOffOverrides } from "@/hooks/useWeeklyOff";
import { useNightDutyApprovalsRange } from "@/hooks/useExtendedAttendanceRules";
import { useLeaveAttendanceEffects } from "@/hooks/useLeave";
import { employeeService } from "@/services/employeeService";
import type { Employee } from "@/types/employee";
import { formatDate } from "@/lib/utils";
import { currentMonthKey, firstDateOfMonth, lastDateOfMonth, todayDateKey } from "@/lib/dateRange";
import { resolveShiftOnDate } from "@/lib/shiftResolver";
import { WEEKDAY_LABELS } from "@/lib/weeklyOffResolver";
import { buildAttendanceSummary, buildMonthlyAttendanceRows, formatDateTime, formatMinutes, type MonthlyAttendanceRow } from "@/modules/attendance/utils";
import { AttendanceStatusBadge, NightDutyCell, SummaryCard } from "@/modules/attendance/components/shared";
import { EditAttendanceDialog } from "@/modules/attendance/components/EditAttendanceDialog";

/**
 * Manual Staff Attendance — Super Admin only. Search/select any employee, pick a month, see their
 * complete attendance for that month (reusing the exact same row-building/summary logic as every
 * other attendance screen — buildMonthlyAttendanceRows/buildAttendanceSummary from
 * modules/attendance/utils.ts, so Weekly Off/future-date/Late/Overtime handling is identical
 * everywhere), and edit any date up to and including today. Future dates are always rendered
 * "Upcoming" and locked client-side; attendance_admin_upsert() also rejects them server-side using
 * the database's own current_date, so this is not just a UI restriction.
 *
 * Caller is responsible for the isSuperAdmin gate (this component assumes it is already scoped to
 * Super Admin — see AttendancePage.tsx's renderAdminDashboardBody()).
 */
export function ManualStaffAttendanceCard() {
  const { user } = useAuth();
  const storesQuery = useStores(user?.companyId ?? undefined);

  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [month, setMonth] = useState(() => currentMonthKey());
  const [editRow, setEditRow] = useState<MonthlyAttendanceRow | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchDebounced(searchTerm.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const searchQuery = useQuery({
    queryKey: ["manual-attendance-employee-search", user?.companyId, storeId, searchDebounced],
    queryFn: () => employeeService.list({ companyId: user?.companyId ?? undefined, storeId, search: searchDebounced }),
    enabled: Boolean(user?.companyId) && (searchDebounced.length >= 2 || Boolean(storeId)),
  });

  const [year, monthNumber] = useMemo(() => {
    const [y, m] = month.split("-");
    return [Number(y), Number(m)];
  }, [month]);

  const currentShiftQuery = useCurrentShiftAssignment(employee?.id);
  const currentWeeklyOffQuery = useCurrentWeeklyOff(employee?.id);
  const monthlyQuery = useMonthlyAttendance(employee?.id, year, monthNumber);
  const weeklyOffHistoryQuery = useWeeklyOffHistory(employee?.id);
  const weeklyOffOverridesQuery = useWeeklyOffOverrides(employee?.id);
  const shiftHistoryQuery = useShiftAssignmentHistory(employee?.id);
  // Same authoritative Night Duty source every other Attendance view uses — see
  // modules/attendance/utils.ts resolveNightDutyFacts(). This card previously built rows without
  // it, which is exactly why the Super Admin "Manual Staff Attendance" view still showed the old,
  // un-merged Overtime and had no Night Duty column at all.
  const nightDutyApprovalsQuery = useNightDutyApprovalsRange(employee?.id, firstDateOfMonth(year, monthNumber), lastDateOfMonth(year, monthNumber));
  // Phase 5 — approved-Leave dates for this month, merged into the calendar at display time exactly
  // like Weekly Off already is (see modules/attendance/utils.ts toAttendanceRow()); never written
  // into attendance_records. A real attendance record for the day still always wins.
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
  const totalDays = useMemo(() => rows.filter((row) => !row.isFuture).length, [rows]);
  const totalWorkingMinutes = useMemo(
    () => rows.filter((row) => !row.isFuture).reduce((sum, row) => sum + (row.workingMinutes ?? 0), 0),
    [rows]
  );

  const handleSelectEmployee = (selected: Employee) => {
    setEmployee(selected);
    setSearchTerm("");
    setSearchDebounced("");
    setMonth(currentMonthKey());
  };

  const handleChangeEmployee = () => setEmployee(null);

  const handleEditRow = (row: MonthlyAttendanceRow) => {
    if (row.isFuture) return;
    setEditRow(row);
    setShowEditDialog(true);
  };

  const today = todayDateKey();

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle>Manual Staff Attendance</CardTitle>
        <p className="text-sm text-muted-foreground">
          Search any employee, pick a month, and create or correct attendance for any date up to and
          including today. Future dates are always locked — server date decides, not the browser.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          <div className="space-y-1.5">
            <Label>Store</Label>
            <Select value={storeId ?? "all"} onValueChange={(value) => setStoreId(value === "all" ? undefined : value)}>
              <SelectTrigger>
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {(storesQuery.data ?? []).map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-attendance-search">Employee</Label>
            {employee ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
                <div className="text-sm">
                  <p className="font-medium">{employee.fullName}</p>
                  <p className="text-muted-foreground">
                    {employee.employeeCode ?? "—"}
                    {employee.storeName ? ` · ${employee.storeName}` : ""}
                    {employee.departmentName ? ` · ${employee.departmentName}` : ""}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleChangeEmployee}>
                  Change Employee
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="manual-attendance-search"
                    className="pl-9"
                    placeholder="Search by Employee Name or Employee Code"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </div>
                {searchDebounced.length >= 2 || storeId ? (
                  searchQuery.isLoading ? (
                    <LoadingState />
                  ) : (searchQuery.data ?? []).length > 0 ? (
                    <div className="max-h-56 overflow-y-auto rounded-lg border">
                      {(searchQuery.data ?? []).slice(0, 20).map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50"
                          onClick={() => handleSelectEmployee(candidate)}
                        >
                          <span className="font-medium">{candidate.fullName}</span>
                          <span className="text-muted-foreground">
                            {candidate.employeeCode ?? "—"}
                            {candidate.storeName ? ` · ${candidate.storeName}` : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No employees found.</p>
                  )
                ) : null}
              </>
            )}
          </div>
        </div>

        {!employee ? (
          <p className="text-sm text-muted-foreground">
            Select a store and/or search for an employee above to manage their attendance.
          </p>
        ) : (
          <>
            <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Employee Name</p>
                <p className="text-sm font-medium">{employee.fullName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Employee Code</p>
                <p className="text-sm font-medium">{employee.employeeCode ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Store</p>
                <p className="text-sm font-medium">{employee.storeName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="text-sm font-medium">{employee.departmentName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Current Shift</p>
                <p className="text-sm font-medium">
                  {currentShiftQuery.data
                    ? `${currentShiftQuery.data.shift.name} (${currentShiftQuery.data.shift.startTime.slice(0, 5)}–${currentShiftQuery.data.shift.endTime.slice(0, 5)})`
                    : "Not assigned"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Current Weekly Off</p>
                <p className="text-sm font-medium">
                  {currentWeeklyOffQuery.data ? WEEKDAY_LABELS[currentWeeklyOffQuery.data.weeklyOffDay] : "Not set"}
                </p>
              </div>
            </div>

            <div className="flex items-end justify-between gap-4">
              <div className="space-y-1.5">
                <Label>Month</Label>
                <Input type="month" value={month} max={currentMonthKey()} onChange={(event) => setMonth(event.target.value)} />
              </div>
            </div>

            {monthlyQuery.isLoading ? (
              <LoadingState />
            ) : monthlyQuery.error ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                Unable to load attendance for this employee.
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard label="Total Days" value={totalDays} />
                  <SummaryCard label="Present" value={summary.present} />
                  <SummaryCard label="Absent" value={summary.absent} />
                  <SummaryCard label="Leave" value={summary.leave} />
                  <SummaryCard label="Weekly Off" value={summary.weeklyOff} />
                  <SummaryCard label="Half Day" value={summary.halfDay} />
                  <SummaryCard label="Late Days" value={summary.lateDays} />
                  <SummaryCard label="Late Minutes" value={summary.lateMinutes} />
                  <SummaryCard label="Overtime Minutes" value={summary.overtimeMinutes} />
                  <SummaryCard label="Early Going Minutes" value={summary.earlyGoingMinutes} />
                  <SummaryCard label="Total Working Hours" value={formatMinutes(totalWorkingMinutes)} />
                  <SummaryCard label="Night Duty Payable" value={summary.nightDutyPayable} />
                  <SummaryCard label="Night OT Minutes" value={summary.nightOtMinutes} />
                </div>

                <Table containerClassName="max-h-[55vh] rounded-lg border">
                  <TableHeader className="sticky top-0 z-10 bg-muted">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Day</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Shift Timing</TableHead>
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
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      if (row.isFuture) {
                        return (
                          <TableRow key={row.date} className="text-muted-foreground">
                            <TableCell>{formatDate(row.date)}</TableCell>
                            <TableCell>{row.day}</TableCell>
                            <TableCell colSpan={11}>Upcoming</TableCell>
                            <TableCell>
                              <Button size="sm" variant="outline" disabled>
                                Locked
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      }

                      const shiftPeriod = resolveShiftOnDate(shiftHistoryQuery.data ?? [], row.date);

                      return (
                        <TableRow key={row.date} className={row.date === today ? "bg-primary/5" : undefined}>
                          <TableCell>{formatDate(row.date)}</TableCell>
                          <TableCell>{row.day}</TableCell>
                          <TableCell>{shiftPeriod?.shift.name ?? "—"}</TableCell>
                          <TableCell>
                            {shiftPeriod
                              ? `${shiftPeriod.shift.startTime.slice(0, 5)}–${shiftPeriod.shift.endTime.slice(0, 5)}`
                              : "—"}
                          </TableCell>
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
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => handleEditRow(row)}>
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            )}
          </>
        )}
      </CardContent>

      <EditAttendanceDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        employee={employee ? { id: employee.id, fullName: employee.fullName, employeeCode: employee.employeeCode, storeId: employee.storeId } : null}
        row={editRow}
      />
    </Card>
  );
}
