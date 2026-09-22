import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, CheckCircle2, Wallet } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/common/LoadingState";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee, useAttendanceRange, useTodayAttendance } from "@/hooks/useAttendance";
import { useEmployee } from "@/hooks/useEmployees";
import { useCurrentShiftAssignment } from "@/hooks/useShifts";
import { useWeeklyOffHistory, useWeeklyOffOverrides } from "@/hooks/useWeeklyOff";
import { useMyNightDutyApprovals } from "@/hooks/useExtendedAttendanceRules";
import { useMyLeaveApplications } from "@/hooks/useLeave";
import { collapseNightDutyStatus, formatTime } from "@/modules/attendance/utils";
import { isWeeklyOffOnDate } from "@/lib/weeklyOffResolver";
import { enumerateDateRange, toDateKey, todayDateKey } from "@/lib/dateRange";
import { ROUTES } from "@/constants/routes";
import { cn, formatDate } from "@/lib/utils";

/** Monday..Sunday of the week containing `date` — never assumes a specific weekly-off day, purely
 *  calendar arithmetic for the "This Week's Schedule" strip. */
function currentWeekRange(date: Date): { from: string; to: string } {
  const day = date.getDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: toDateKey(monday.getFullYear(), monday.getMonth() + 1, monday.getDate()),
    to: toDateKey(sunday.getFullYear(), sunday.getMonth() + 1, sunday.getDate()),
  };
}

/**
 * Staff Panel — personal dashboard. Every figure here is read directly off the SAME existing
 * services/hooks the Attendance page and Night Duty Approvals page already use (useTodayAttendance,
 * useAttendanceRange, useCurrentShiftAssignment, useCurrentWeeklyOff, useMyNightDutyApprovals) —
 * nothing here recalculates Late/Overtime/Night Duty/Penalty, it only displays what those already
 * resolved. Leave Balance and Latest Payslip show an honest "Coming Soon" state — no Leave/Payroll
 * backend exists yet in this project (confirmed by investigation), so nothing here is fabricated.
 */
export function StaffDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const employeeId = currentEmployeeQuery.data?.id;
  const employeeQuery = useEmployee(employeeId);
  const employee = employeeQuery.data;

  const todayAttendanceQuery = useTodayAttendance(employeeId);
  const today = todayAttendanceQuery.data;
  const shiftQuery = useCurrentShiftAssignment(employeeId);
  const shift = shiftQuery.data?.shift;
  const weeklyOffHistoryQuery = useWeeklyOffHistory(employeeId);
  const weeklyOffOverridesQuery = useWeeklyOffOverrides(employeeId);
  const nightDutyQuery = useMyNightDutyApprovals(employeeId);
  const myLeaveApplicationsQuery = useMyLeaveApplications();

  const { from: weekFrom, to: weekTo } = useMemo(() => currentWeekRange(new Date()), []);
  const weekAttendanceQuery = useAttendanceRange(employeeId, weekFrom, weekTo);

  const isLoading = currentEmployeeQuery.isLoading || employeeQuery.isLoading;

  const hasPunchedIn = Boolean(today?.punchInAt);
  const hasPunchedOut = Boolean(today?.punchOutAt);

  const pendingNightDuty = (nightDutyQuery.data ?? []).filter((a) => collapseNightDutyStatus(a.approvalStatus) === "pending");
  // Kept as its OWN distinct count — never merged with pendingNightDuty above, per "Pending Leave
  // Approvals separately from Pending Night Duty Approvals, never combined into a misleading single
  // count".
  const pendingLeave = (myLeaveApplicationsQuery.data ?? []).filter((a) => a.status === "manager_pending" || a.status === "super_manager_pending");

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  const firstName = employee?.firstName || employee?.fullName?.split(" ")[0] || "there";
  const now = new Date();
  const dayLabel = now.toLocaleDateString("en-IN", { weekday: "long" });
  const dateLabel = formatDate(todayDateKey());

  const weekDays = useMemo(() => enumerateDateRange(weekFrom, weekTo), [weekFrom, weekTo]);
  const attendanceByDate = useMemo(() => {
    const map = new Map<string, { status: string; lateMinutes: number | null }>();
    for (const r of weekAttendanceQuery.data ?? []) {
      map.set(r.attendanceDate, { status: r.status, lateMinutes: r.lateMinutes });
    }
    return map;
  }, [weekAttendanceQuery.data]);

  if (isLoading) {
    return <LoadingState />;
  }

  if (!employeeId) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Your account is not linked to an employee profile. Contact your administrator.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {greeting}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {dayLabel}, {dateLabel}
          {employee?.storeName ? ` · ${employee.storeName}` : ""}
          {employee?.departmentName ? ` · ${employee.departmentName}` : ""}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="space-y-1.5 p-4">
            <p className="text-sm text-muted-foreground">Attendance Today</p>
            <p className="text-xl font-semibold text-foreground">
              {hasPunchedOut ? "Punched Out" : hasPunchedIn ? "Punched In" : "Not Punched In"}
            </p>
            <p className="text-xs text-muted-foreground">
              {hasPunchedIn && today?.punchInAt
                ? `Since ${formatTime(new Date(today.punchInAt))}${shift ? ` · Shift ends ${shift.endTime.slice(0, 5)}` : ""}`
                : shift
                ? `Shift starts ${shift.startTime.slice(0, 5)}`
                : "No shift assigned"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1.5 p-4">
            <p className="text-sm text-muted-foreground">Leave Balance</p>
            <p className="text-xl font-semibold text-muted-foreground">Coming Soon</p>
            <p className="text-xs text-muted-foreground">Leave management is not yet available.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1.5 p-4">
            <p className="text-sm text-muted-foreground">Pending Night Duty Approvals</p>
            <p className="text-xl font-semibold text-foreground">{pendingNightDuty.length}</p>
            <p className="text-xs text-muted-foreground">
              {pendingNightDuty.length > 0 ? `${pendingNightDuty.length} Night Duty request(s) pending` : "No pending approvals"}
            </p>
          </CardContent>
        </Card>

        {/* Deliberately a SEPARATE card from Night Duty above, never a combined count — see module
            note. */}
        <Card>
          <CardContent className="space-y-1.5 p-4">
            <p className="text-sm text-muted-foreground">Pending Leave Approvals</p>
            <p className="text-xl font-semibold text-foreground">{pendingLeave.length}</p>
            <p className="text-xs text-muted-foreground">
              {pendingLeave.length > 0 ? `${pendingLeave.length} leave request(s) awaiting approval` : "No pending leave approvals"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1.5 p-4">
            <p className="text-sm text-muted-foreground">Latest Payslip</p>
            <p className="text-xl font-semibold text-muted-foreground">Coming Soon</p>
            <p className="text-xs text-muted-foreground">Payslip generation is not yet available.</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" disabled={!hasPunchedIn || hasPunchedOut} onClick={() => navigate(ROUTES.attendance)}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Punch Out
        </Button>
        <Button variant="outline" onClick={() => navigate(ROUTES.leave)}>
          <CalendarDays className="mr-2 h-4 w-4" />
          Apply Leave
        </Button>
        <Button variant="outline" onClick={() => navigate(ROUTES.payslip)}>
          <Wallet className="mr-2 h-4 w-4" />
          View Payslip
        </Button>
      </div>

      {/* This Week's Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>This Week&apos;s Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {weekDays.map((d) => {
              const isToday = d.dateKey === todayDateKey();
              const isFuture = d.dateKey > todayDateKey();
              const isWeeklyOff = isWeeklyOffOnDate(d.dateKey, weeklyOffHistoryQuery.data ?? [], weeklyOffOverridesQuery.data ?? []);
              const record = attendanceByDate.get(d.dateKey);

              let dotColor = "bg-muted-foreground/30";
              let label = "";
              if (isFuture && !isToday) {
                label = "";
              } else if (isWeeklyOff) {
                dotColor = "bg-muted-foreground/50";
                label = "OFF";
              } else if (record) {
                if (record.status === "absent") {
                  dotColor = "bg-destructive";
                  label = "";
                } else if ((record.lateMinutes ?? 0) > 0) {
                  dotColor = "bg-orange-500";
                  label = "";
                } else if (record.status === "present" || record.status === "half_day") {
                  dotColor = "bg-green-600";
                  label = "";
                }
              }

              return (
                <div
                  key={d.dateKey}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center",
                    isToday && "border-primary bg-primary/5"
                  )}
                >
                  <span className="text-xs font-medium text-muted-foreground">{d.day.slice(0, 3).toUpperCase()}</span>
                  <span className="text-sm font-semibold text-foreground">{Number(d.dateKey.slice(-2))}</span>
                  {isToday ? (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      TODAY
                    </Badge>
                  ) : label ? (
                    <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
                  ) : (
                    <span className={cn("h-2 w-2 rounded-full", dotColor)} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const records = [...(weekAttendanceQuery.data ?? [])].sort((a, b) => (b.punchInAt ?? "").localeCompare(a.punchInAt ?? ""));
            const activities: { label: string; when: string }[] = [];
            for (const r of records) {
              if (r.punchOutAt) {
                activities.push({ label: `Punched out at ${formatTime(new Date(r.punchOutAt))}`, when: formatDate(r.attendanceDate) });
              }
              if (r.punchInAt) {
                activities.push({ label: `Punched in at ${formatTime(new Date(r.punchInAt))}`, when: formatDate(r.attendanceDate) });
              }
              if (activities.length >= 5) break;
            }

            if (activities.length === 0) {
              return <p className="text-sm text-muted-foreground">No recent activity this week.</p>;
            }

            return (
              <ul className="space-y-3">
                {activities.slice(0, 5).map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <div>
                      <p className="font-medium text-foreground">{a.label}</p>
                      <p className="text-xs text-muted-foreground">{a.when}</p>
                    </div>
                  </li>
                ))}
              </ul>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
