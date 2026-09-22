import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  Search,
  Upload,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import {
  useAttendanceByDate,
  useAttendanceRange,
  useMonthlyAttendance,
  useCurrentEmployee,
  useExplainAttendanceRules,
  usePunchIn,
  usePunchOut,
  useTodayAttendance,
} from "@/hooks/useAttendance";
import { useLeaveAttendanceEffects } from "@/hooks/useLeave";
import {
  useAdminDailyAttendance,
  useAttendanceAdminSummary,
  useStoreAttendanceSummary,
  useDemoAttendanceCount,
  useGenerateDemoAttendance,
  useClearDemoAttendance,
} from "@/hooks/useAttendanceAdmin";
import { useStores } from "@/hooks/useStores";
import { useMasterDepartments } from "@/hooks/useMasterDepartments";
import { attendanceAdminService } from "@/services/attendanceAdminService";
import { employeeService } from "@/services/employeeService";
import type { Employee } from "@/types/employee";
import { ATTENDANCE_STATUS_LABELS } from "@/constants/attendance";
import { ROUTES } from "@/constants/routes";
import { formatDate } from "@/lib/utils";
import { firstDateOfMonth, lastDateOfMonth, todayDateKey, weekdayFromDateKey } from "@/lib/dateRange";
import {
  exportAttendanceToExcel,
  exportAttendanceToPdf,
  MULTI_EMPLOYEE_ATTENDANCE_COLUMNS,
  SINGLE_EMPLOYEE_ATTENDANCE_COLUMNS,
} from "@/lib/attendanceExport";
import {
  buildAttendanceSummary,
  buildDateRangeRows,
  buildMonthlyAttendanceRows,
  formatDateTime,
  formatMinutes,
  formatTime,
  nightDutyExportFields,
  resolveNightDutyFacts,
} from "@/modules/attendance/utils";
import { AttendanceStatusBadge, NightDutyCell, SummaryCard } from "@/modules/attendance/components/shared";
import { AttendanceFiltersCard, type AttendanceFilterDraft } from "@/modules/attendance/components/AttendanceFiltersCard";
import { MonthlyAttendanceDialog, type MonthlyDialogEmployee } from "@/modules/attendance/components/MonthlyAttendanceDialog";
import { ManualStaffAttendanceCard } from "@/modules/attendance/components/ManualStaffAttendanceCard";
import { AttendanceCalendarCard } from "@/modules/attendance/components/AttendanceCalendarCard";
import { useCurrentShiftAssignment } from "@/hooks/useShifts";
import { useCurrentWeeklyOff, useWeeklyOffHistory, useWeeklyOffOverrides } from "@/hooks/useWeeklyOff";
import { WEEKDAY_LABELS } from "@/lib/weeklyOffResolver";
import { useCurrentInformationRule, useInformationUsageThisMonth, useMyNightDutyApprovals, useNightDutyApprovalsRange } from "@/hooks/useExtendedAttendanceRules";
import { Checkbox } from "@/components/ui/checkbox";

function defaultFilterDraft(): AttendanceFilterDraft {
  const today = todayDateKey();
  return { storeId: undefined, departmentId: undefined, search: "", fromDate: today, toDate: today };
}

export function AttendancePage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const isCompanyAdmin = user?.role === "company_admin";
  const isAdmin = isSuperAdmin || isCompanyAdmin;

  // ---------------------------------------------------------------------
  // Employee self-view state
  // ---------------------------------------------------------------------
  const [selectedDate, setSelectedDate] = useState(() => todayDateKey());
  const [selectedMonth, setSelectedMonth] = useState(() => todayDateKey().slice(0, 7));
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const [selectedYear, selectedMonthNumber] = useMemo(() => {
    const [year, month] = selectedMonth.split("-");
    return [Number(year), Number(month)];
  }, [selectedMonth]);

  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const employeeId = currentEmployeeQuery.data?.id;
  const todayAttendanceQuery = useTodayAttendance(employeeId);
  const selectedAttendanceQuery = useAttendanceByDate(employeeId, selectedDate);
  const monthlyAttendanceQuery = useMonthlyAttendance(employeeId, selectedYear, selectedMonthNumber);
  const punchIn = usePunchIn(employeeId);
  const punchOut = usePunchOut(employeeId);
  const [showPunchInConfirm, setShowPunchInConfirm] = useState(false);
  const [showPunchOutConfirm, setShowPunchOutConfirm] = useState(false);

  const informationRuleQuery = useCurrentInformationRule(user?.companyId ?? undefined);
  const informationUsageQuery = useInformationUsageThisMonth(employeeId, new Date().getFullYear(), new Date().getMonth() + 1);
  // Still used below by resolveNightDutyFacts() for Today's/Selected Attendance's Overtime figure.
  // The inline "Night Duty" list that used to read this (plus useAttendanceRecordsByIds for its own
  // live-record correction) moved to its own page — Approvals -> Night Duty Approval
  // (src/modules/staff/pages/StaffNightDutyApprovalPage.tsx), which fetches those independently.
  const myNightDutyQuery = useMyNightDutyApprovals(employeeId);

  const isPunchInPending = punchIn.isPending || punchOut.isPending;
  const todayAttendance = todayAttendanceQuery.data;
  const selectedAttendance = selectedAttendanceQuery.data;
  const monthlyAttendance = monthlyAttendanceQuery.data ?? [];

  const currentShiftQuery = useCurrentShiftAssignment(employeeId);
  const currentWeeklyOffQuery = useCurrentWeeklyOff(employeeId);
  const weeklyOffHistoryQuery = useWeeklyOffHistory(employeeId);
  const weeklyOffOverridesQuery = useWeeklyOffOverrides(employeeId);

  // Staff-controlled Information/Intimation: a live "if I punched in right now, would I be late,
  // and would Information even be an option" preview — frozen at the moment the Punch In confirm
  // dialog opens (not the ticking clock) so it doesn't refetch every second. Uses the SAME
  // attendance_explain_rules() RPC / compute_extended_attendance_facts() chain every other panel on
  // this page already uses — never a second frontend calculation of Late/eligibility/cutoff/balance.
  const [punchInPreviewAt, setPunchInPreviewAt] = useState<string | null>(null);
  const [useInformationToday, setUseInformationToday] = useState(false);
  const punchInPreviewQuery = useExplainAttendanceRules(
    punchInPreviewAt && user?.companyId && employeeId && currentShiftQuery.data?.shift.id && currentEmployeeQuery.data?.storeId
      ? {
          companyId: user.companyId,
          employeeId,
          shiftId: currentShiftQuery.data.shift.id,
          storeId: currentEmployeeQuery.data.storeId,
          attendanceDate: todayDateKey(),
          punchInAt: punchInPreviewAt,
          punchOutAt: null,
        }
      : null
  );
  const punchInPreviewLate = punchInPreviewQuery.data?.find((e) => e.kind === "late");
  const punchInPreviewInfo = punchInPreviewQuery.data?.find((e) => e.kind === "information");
  const punchInIsLate = (punchInPreviewLate?.resultValue ?? 0) > 0;
  const punchInInfoEligible = Boolean(punchInPreviewInfo?.config?.eligibleNow);
  const punchInInfoMonthlyUsage = typeof punchInPreviewInfo?.config?.monthlyUsage === "number" ? punchInPreviewInfo.config.monthlyUsage : null;
  const punchInInfoMonthlyLimit = typeof punchInPreviewInfo?.config?.monthlyLimit === "number" ? punchInPreviewInfo.config.monthlyLimit : null;

  const monthNightDutyApprovalsQuery = useNightDutyApprovalsRange(
    employeeId,
    firstDateOfMonth(selectedYear, selectedMonthNumber),
    lastDateOfMonth(selectedYear, selectedMonthNumber)
  );
  // Phase 5 — approved Leave dates for the same month, merged into the calendar at display time
  // exactly like Weekly Off already is; never written into attendance_records.
  const monthLeaveEffectsQuery = useLeaveAttendanceEffects(
    employeeId,
    firstDateOfMonth(selectedYear, selectedMonthNumber),
    lastDateOfMonth(selectedYear, selectedMonthNumber)
  );

  const attendanceRows = useMemo(
    () =>
      buildMonthlyAttendanceRows(
        monthlyAttendance,
        selectedYear,
        selectedMonthNumber,
        weeklyOffHistoryQuery.data ?? [],
        weeklyOffOverridesQuery.data ?? [],
        monthNightDutyApprovalsQuery.data ?? [],
        monthLeaveEffectsQuery.data ?? []
      ),
    [monthlyAttendance, selectedYear, selectedMonthNumber, weeklyOffHistoryQuery.data, weeklyOffOverridesQuery.data, monthNightDutyApprovalsQuery.data, monthLeaveEffectsQuery.data]
  );
  const monthlyCounts = useMemo(() => buildAttendanceSummary(attendanceRows), [attendanceRows]);

  const todayIsWeeklyOff = currentWeeklyOffQuery.data?.weeklyOffDay === new Date().getDay();

  // ---------------------------------------------------------------------
  // Admin View: filters + daily/summary/store-summary + demo data
  // ---------------------------------------------------------------------
  const [filterDraft, setFilterDraft] = useState<AttendanceFilterDraft>(() => defaultFilterDraft());
  const [appliedFilters, setAppliedFilters] = useState<AttendanceFilterDraft>(() => defaultFilterDraft());
  const [dateRangeError, setDateRangeError] = useState<string | null>(null);
  const [showDemoOnly, setShowDemoOnly] = useState(false);
  const [showDemoGenerateDialog, setShowDemoGenerateDialog] = useState(false);
  const [showDemoExistsDialog, setShowDemoExistsDialog] = useState(false);
  const [showDemoClearDialog, setShowDemoClearDialog] = useState(false);
  const [dailyExportState, setDailyExportState] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });

  const handleFilterDraftChange = (patch: Partial<AttendanceFilterDraft>) =>
    setFilterDraft((prev) => ({ ...prev, ...patch }));

  const handleApplyFilters = () => {
    if (filterDraft.fromDate > filterDraft.toDate) {
      setDateRangeError("From Date cannot be later than To Date.");
      return;
    }
    setDateRangeError(null);
    setAppliedFilters(filterDraft);
  };

  const handleResetFilters = () => {
    const fresh = defaultFilterDraft();
    setFilterDraft(fresh);
    setAppliedFilters(fresh);
    setDateRangeError(null);
  };

  const storesQuery = useStores(user?.companyId ?? undefined);
  const departmentsQuery = useMasterDepartments();

  const adminFilters = useMemo(
    () => ({
      companyId: user?.companyId ?? undefined,
      dateFrom: appliedFilters.fromDate,
      dateTo: appliedFilters.toDate,
      storeId: appliedFilters.storeId,
      departmentId: appliedFilters.departmentId,
      search: appliedFilters.search.trim() || undefined,
      isDemo: showDemoOnly ? true : undefined,
      page: 1,
      pageSize: 100,
    }),
    [user?.companyId, appliedFilters, showDemoOnly]
  );

  const adminDailyAttendanceQuery = useAdminDailyAttendance(adminFilters);
  const adminSummaryQuery = useAttendanceAdminSummary(adminFilters);
  const storeAttendanceSummaryQuery = useStoreAttendanceSummary(adminFilters);
  const demoCountQuery = useDemoAttendanceCount(user?.companyId ?? undefined);
  const generateDemoAttendance = useGenerateDemoAttendance(user?.companyId ?? undefined);
  const clearDemoAttendance = useClearDemoAttendance(user?.companyId ?? undefined);

  const adminRows = adminDailyAttendanceQuery.data?.data ?? [];
  const adminTotal = adminDailyAttendanceQuery.data?.total ?? 0;
  const storeRows = storeAttendanceSummaryQuery.data ?? [];
  const demoCount = demoCountQuery.data ?? 0;
  const hasDemoAttendance = demoCount > 0;

  const isDemoViewActive = showDemoOnly;

  const handleGenerateDemoClick = () => {
    if (hasDemoAttendance) {
      setShowDemoExistsDialog(true);
    } else {
      setShowDemoGenerateDialog(true);
    }
  };

  const handleConfirmGenerateDemo = () => {
    setShowDemoGenerateDialog(false);
    generateDemoAttendance.mutate(undefined, {
      onSuccess: () => setShowDemoOnly(true),
    });
  };

  const handleClearDemo = () => setShowDemoClearDialog(true);

  const handleConfirmClearDemo = () => {
    setShowDemoClearDialog(false);
    clearDemoAttendance.mutate(undefined, {
      onSuccess: () => setShowDemoOnly(false),
    });
  };

  const handleViewDemoData = () => {
    setShowDemoOnly(true);
    setShowDemoExistsDialog(false);
  };

  const handleRegenerateDemoData = async () => {
    setShowDemoExistsDialog(false);
    try {
      await clearDemoAttendance.mutateAsync();
      await generateDemoAttendance.mutateAsync();
      setShowDemoOnly(true);
    } catch {
      // error states shown by mutations
    }
  };

  const storeLabel = appliedFilters.storeId
    ? storesQuery.data?.find((store) => store.id === appliedFilters.storeId)?.name ?? "Selected store"
    : "All Stores";
  const departmentLabel = appliedFilters.departmentId
    ? departmentsQuery.data?.find((department) => department.id === appliedFilters.departmentId)?.name ?? "Selected department"
    : "All Departments";
  const employeeFilterLabel = appliedFilters.search.trim() || "All Employees";

  const handleExportDaily = async (format: "excel" | "pdf") => {
    setDailyExportState({ loading: true, error: null });
    try {
      const fullResult = await attendanceAdminService.getAdminDailyAttendance({ ...adminFilters, page: 1, pageSize: 100000 });
      const exportRows = fullResult.data.map((record) => ({
        employeeCode: record.employeeCode,
        staffName: record.employeeName,
        store: record.storeName ?? "—",
        department: record.departmentName ?? "—",
        date: formatDate(record.date),
        day: weekdayFromDateKey(record.date),
        punchIn: record.punchInAt ? formatDateTime(record.punchInAt) : "—",
        punchOut: record.punchOutAt ? formatDateTime(record.punchOutAt) : "—",
        totalWorking: formatMinutes(record.totalWorkingMinutes ?? 0),
        breakDeduction: formatMinutes(record.breakDeductionMinutes ?? 0),
        workingHours: formatMinutes(record.workingMinutes ?? 0),
        late: record.lateMinutes ?? "—",
        overtime: record.overtimeMinutes ?? "—",
        earlyGoing: record.earlyGoingMinutes ?? "—",
        ...nightDutyExportFields(record),
        status: ATTENDANCE_STATUS_LABELS[record.status],
      }));

      // Summed directly from the already-fetched, already-merged rows above — no re-fetch, no
      // recalculation, same resolveNightDutyFacts() output every row already carries.
      const dailyTotals = fullResult.data.reduce(
        (acc, record) => {
          acc.overtimeMinutes += record.overtimeMinutes ?? 0;
          acc.nightOtMinutes += record.nightOtMinutes;
          acc.nightDutyDays += record.nightDutyDays;
          return acc;
        },
        { overtimeMinutes: 0, nightOtMinutes: 0, nightDutyDays: 0 }
      );

      const request = {
        fileNameBase: `daily-attendance-${appliedFilters.fromDate}-to-${appliedFilters.toDate}`,
        reportTitle: "Attendance Report",
        metaLines: [
          `Date Range: ${formatDate(appliedFilters.fromDate)} - ${formatDate(appliedFilters.toDate)}`,
          `Store: ${storeLabel}`,
          `Department: ${departmentLabel}`,
          `Employee Filter: ${employeeFilterLabel}`,
          "",
          `Total Overtime Minutes: ${dailyTotals.overtimeMinutes}`,
          `Total Night OT Minutes: ${dailyTotals.nightOtMinutes}`,
          `Total Night Duty Days: ${dailyTotals.nightDutyDays}`,
          `Total Night Duty Payable: ${dailyTotals.nightDutyDays}`,
        ],
        columns: MULTI_EMPLOYEE_ATTENDANCE_COLUMNS,
        rows: exportRows,
        landscape: true,
      };

      if (format === "excel") {
        exportAttendanceToExcel(request);
      } else {
        exportAttendanceToPdf(request);
      }
      setDailyExportState({ loading: false, error: null });
    } catch (error) {
      setDailyExportState({
        loading: false,
        error: error instanceof Error ? error.message : "Export failed. Please try again.",
      });
    }
  };

  // ---------------------------------------------------------------------
  // Monthly attendance popup — shared by Admin View and Staff View
  // ---------------------------------------------------------------------
  const [monthlyDialogEmployee, setMonthlyDialogEmployee] = useState<MonthlyDialogEmployee | null>(null);

  // ---------------------------------------------------------------------
  // Super Admin Staff View
  // ---------------------------------------------------------------------
  const [activeAdminView, setActiveAdminView] = useState<"admin" | "staff">("admin");
  const [staffSearchTerm, setStaffSearchTerm] = useState("");
  const [staffSearchDebounced, setStaffSearchDebounced] = useState("");
  const [staffSelectedEmployee, setStaffSelectedEmployee] = useState<Employee | null>(null);
  const [staffFromDate, setStaffFromDate] = useState(() => todayDateKey());
  const [staffToDate, setStaffToDate] = useState(() => todayDateKey());

  useEffect(() => {
    const timer = window.setTimeout(() => setStaffSearchDebounced(staffSearchTerm.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [staffSearchTerm]);

  const staffSearchQuery = useQuery({
    queryKey: ["attendance-staff-search", user?.companyId, staffSearchDebounced],
    queryFn: () => employeeService.list({ companyId: user?.companyId ?? undefined, search: staffSearchDebounced }),
    enabled: Boolean(user?.companyId) && staffSearchDebounced.length >= 2,
  });

  const staffDateRangeInvalid = staffFromDate > staffToDate;
  const staffRangeQuery = useAttendanceRange(
    staffSelectedEmployee?.id,
    staffDateRangeInvalid ? undefined : staffFromDate,
    staffDateRangeInvalid ? undefined : staffToDate
  );
  const staffCurrentShiftQuery = useCurrentShiftAssignment(staffSelectedEmployee?.id);
  const staffCurrentWeeklyOffQuery = useCurrentWeeklyOff(staffSelectedEmployee?.id);
  const staffWeeklyOffHistoryQuery = useWeeklyOffHistory(staffSelectedEmployee?.id);
  const staffWeeklyOffOverridesQuery = useWeeklyOffOverrides(staffSelectedEmployee?.id);
  const staffNightDutyApprovalsQuery = useNightDutyApprovalsRange(
    staffSelectedEmployee?.id,
    staffDateRangeInvalid ? undefined : staffFromDate,
    staffDateRangeInvalid ? undefined : staffToDate
  );
  // Phase 5 — approved-Leave dates for the selected employee/range, merged into the range table at
  // display time exactly like Weekly Off already is; never written into attendance_records.
  const staffLeaveEffectsQuery = useLeaveAttendanceEffects(
    staffSelectedEmployee?.id,
    staffDateRangeInvalid ? undefined : staffFromDate,
    staffDateRangeInvalid ? undefined : staffToDate
  );

  const staffRangeRows = useMemo(
    () =>
      staffSelectedEmployee && !staffDateRangeInvalid
        ? buildDateRangeRows(
            staffRangeQuery.data ?? [],
            staffFromDate,
            staffToDate,
            staffWeeklyOffHistoryQuery.data ?? [],
            staffWeeklyOffOverridesQuery.data ?? [],
            staffNightDutyApprovalsQuery.data ?? [],
            staffLeaveEffectsQuery.data ?? []
          )
        : [],
    [
      staffRangeQuery.data,
      staffSelectedEmployee,
      staffDateRangeInvalid,
      staffFromDate,
      staffToDate,
      staffWeeklyOffHistoryQuery.data,
      staffWeeklyOffOverridesQuery.data,
      staffNightDutyApprovalsQuery.data,
      staffLeaveEffectsQuery.data,
    ]
  );
  const staffSummary = useMemo(() => buildAttendanceSummary(staffRangeRows), [staffRangeRows]);

  const handleSelectStaffEmployee = (employee: Employee) => {
    setStaffSelectedEmployee(employee);
    setStaffSearchTerm("");
    setStaffSearchDebounced("");
  };

  const handleBackToAdminView = () => {
    setStaffSelectedEmployee(null);
    setActiveAdminView("admin");
  };

  const openMonthlyDialogForStaffEmployee = () => {
    if (!staffSelectedEmployee) return;
    setMonthlyDialogEmployee({
      id: staffSelectedEmployee.id,
      fullName: staffSelectedEmployee.fullName,
      employeeCode: staffSelectedEmployee.employeeCode,
      storeName: staffSelectedEmployee.storeName ?? null,
      departmentName: staffSelectedEmployee.departmentName ?? null,
    });
  };

  const handleExportStaff = (format: "excel" | "pdf") => {
    if (!staffSelectedEmployee) return;

    const exportRows = staffRangeRows.map((row) =>
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

    const summaryLines = [
      `Total Overtime Minutes: ${staffSummary.overtimeMinutes}`,
      `Total Night OT Minutes: ${staffSummary.nightOtMinutes}`,
      `Total Night Duty Days: ${staffSummary.nightDutyPayable}`,
      `Total Night Duty Payable: ${staffSummary.nightDutyPayable}`,
    ];

    const request = {
      fileNameBase: `attendance-${staffSelectedEmployee.employeeCode ?? staffSelectedEmployee.id}-${staffFromDate}-to-${staffToDate}`,
      reportTitle: "Employee Attendance Report",
      metaLines: [
        `Employee Name: ${staffSelectedEmployee.fullName}`,
        `Employee Code: ${staffSelectedEmployee.employeeCode ?? "—"}`,
        `Store: ${staffSelectedEmployee.storeName ?? "—"}`,
        `Department: ${staffSelectedEmployee.departmentName ?? "—"}`,
        `Date Range: ${formatDate(staffFromDate)} - ${formatDate(staffToDate)}`,
        "",
        ...summaryLines,
      ],
      columns: SINGLE_EMPLOYEE_ATTENDANCE_COLUMNS,
      rows: exportRows,
    };

    if (format === "excel") {
      exportAttendanceToExcel(request);
    } else {
      exportAttendanceToPdf(request);
    }
  };

  // ---------------------------------------------------------------------
  // Renderers
  // ---------------------------------------------------------------------
  const renderEmployeeContent = () => {
    if (currentEmployeeQuery.isLoading) {
      return <LoadingState />;
    }

    if (currentEmployeeQuery.error) {
      return (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          Unable to load your employee record. Please try again.
        </div>
      );
    }

    if (!employeeId) {
      return (
        <EmptyState
          icon={Clock}
          title="Employee record not found"
          description="Your account is not linked to an employee profile. Contact your administrator to enable attendance access."
        />
      );
    }

    const hasPunchedIn = Boolean(todayAttendance?.punchInAt);
    const hasPunchedOut = Boolean(todayAttendance?.punchOutAt);
    const isWorking = hasPunchedIn && !hasPunchedOut;
    const workingHoursDisplay = !todayAttendance ? "—" : isWorking ? "Working" : formatMinutes(todayAttendance.workingMinutes);

    // Overtime here is the SAME authoritative figure as everywhere else on this page — the day's
    // Overtime plus approved Night OT, when this day's Night Duty is Final Approved. See
    // resolveNightDutyFacts() in modules/attendance/utils.ts; myNightDutyQuery already has the
    // approval data (it also backs the "Night Duty" card above), never a second fetch/calculation.
    const todayNightDuty = resolveNightDutyFacts(
      todayAttendance,
      (myNightDutyQuery.data ?? []).find((a) => a.attendanceRecordId === todayAttendance?.id)
    );
    const selectedNightDuty = resolveNightDutyFacts(
      selectedAttendance,
      (myNightDutyQuery.data ?? []).find((a) => a.attendanceRecordId === selectedAttendance?.id)
    );

    const myShift = currentShiftQuery.data;
    const myWeeklyOff = currentWeeklyOffQuery.data;

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>My Shift &amp; Weekly Off</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Shift" value={myShift ? myShift.shift.name : "Not assigned"} />
            <SummaryCard
              label="Shift Timing"
              value={myShift ? `${myShift.shift.startTime.slice(0, 5)}–${myShift.shift.endTime.slice(0, 5)}` : "—"}
            />
            <SummaryCard label="Break" value={myShift ? `${myShift.shift.breakMinutes} min` : "—"} />
            <SummaryCard label="Late Eligible" value={myShift ? (myShift.shift.lateEligible ? "Yes" : "No") : "—"} />
            <SummaryCard label="Overtime Eligible" value={myShift ? (myShift.shift.overtimeEnabled ? "Yes" : "No") : "—"} />
            <SummaryCard label="Weekly Off" value={myWeeklyOff ? WEEKDAY_LABELS[myWeeklyOff.weeklyOffDay] : "Not set"} />
            <SummaryCard label="Today's Schedule" value={todayIsWeeklyOff ? "Weekly Off" : "Working Day"} />
            {informationRuleQuery.data ? (
              <>
                <SummaryCard
                  label="Information / Intimation"
                  value={`Used ${informationUsageQuery.data?.length ?? 0} / ${informationRuleQuery.data.monthlyLimit} · ${informationRuleQuery.data.monthlyLimit - (informationUsageQuery.data?.length ?? 0)} remaining`}
                />
                <SummaryCard label="Information Cutoff Time" value={informationRuleQuery.data.cutoffTime.slice(0, 5)} />
              </>
            ) : null}
          </CardContent>
        </Card>

        <AttendanceCalendarCard rows={attendanceRows} selectedDate={selectedDate} />

        {/* The "Attendance Information" configuration card that used to render here has moved to
            the Staff Profile page ("Shift & Attendance Rules" section) — same component
            (AttendanceInformationCard), same hooks/data, nothing recalculated. See
            src/modules/staff/pages/StaffProfilePage.tsx. */}

        {/* The standalone "Night Duty" card that used to render here has moved to its own page —
            Approvals -> Night Duty Approval (src/modules/staff/pages/StaffNightDutyApprovalPage.tsx,
            ROUTES.nightDutyStaffApproval). Same data (useMyNightDutyApprovals /
            useAttendanceRecordsByIds), same status derivation, nothing recalculated — this page just
            no longer displays it inline. myNightDutyQuery is still declared above and still used by
            resolveNightDutyFacts() for Today's/Selected Attendance's Overtime figure — only the big
            inline list (and its own dedicated live-record lookup) was removed. */}

        <Card>
          <CardHeader>
            <CardTitle>Today's Attendance</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard label="Date" value={formatDate(selectedDate)} />
                <SummaryCard label="Current Time" value={formatTime(currentTime)} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard label="Punch In" value={todayAttendance?.punchInAt ? formatDateTime(todayAttendance.punchInAt) : "Not Marked"} />
                <SummaryCard label="Punch Out" value={todayAttendance?.punchOutAt ? formatDateTime(todayAttendance.punchOutAt) : "Not Marked"} />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryCard label="Total Working" value={!todayAttendance ? "—" : isWorking ? "Working" : formatMinutes(todayAttendance.totalWorkingMinutes ?? 0)} />
                <SummaryCard label="Break Deduction" value={!todayAttendance ? "—" : isWorking ? "—" : formatMinutes(todayAttendance.breakDeductionMinutes ?? 0)} />
                <SummaryCard label="Final Working" value={workingHoursDisplay} />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryCard label="Late Minutes" value={todayAttendance?.lateMinutes ?? 0} />
                <SummaryCard label="Overtime Minutes" value={todayNightDuty.overtimeMinutes ?? 0} />
                <SummaryCard label="Early Going Minutes" value={todayAttendance?.earlyGoingMinutes ?? 0} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Status:</span>
                {todayAttendance ? (
                  isWorking ? (
                    <Badge variant="secondary">Working</Badge>
                  ) : (
                    <AttendanceStatusBadge status={todayAttendance.status} />
                  )
                ) : (
                  <Badge variant="outline">Not Marked</Badge>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Punch controls</p>
                <p className="text-sm text-muted-foreground">
                  Punch In/Out time is recorded from the server clock — it cannot be entered manually.
                </p>
              </div>

              {hasPunchedIn ? (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium">{hasPunchedOut ? "Punched Out" : "Punched In"}</p>
                  <p className="text-muted-foreground">{formatDate(selectedDate)}</p>
                  <p className="text-muted-foreground">
                    {formatTime(new Date(hasPunchedOut ? todayAttendance!.punchOutAt! : todayAttendance!.punchInAt!))}
                  </p>
                </div>
              ) : null}

              <div className="grid gap-3">
                <Button
                  onClick={() => {
                    setPunchInPreviewAt(new Date().toISOString());
                    setUseInformationToday(false);
                    setShowPunchInConfirm(true);
                  }}
                  disabled={isPunchInPending || !employeeId || hasPunchedIn}
                  variant="secondary"
                >
                  <Clock className="mr-2 h-4 w-4" />
                  {hasPunchedIn ? "Punched In" : "Punch In"}
                </Button>
                <Button
                  onClick={() => setShowPunchOutConfirm(true)}
                  disabled={isPunchInPending || !employeeId || !hasPunchedIn || hasPunchedOut}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {hasPunchedOut ? "Punched Out" : "Punch Out"}
                </Button>
              </div>

              {punchIn.isError || punchOut.isError ? (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                  {punchIn.error?.message ?? punchOut.error?.message}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Dialog
          open={showPunchInConfirm}
          onOpenChange={(open) => {
            setShowPunchInConfirm(open);
            if (!open) {
              setPunchInPreviewAt(null);
              setUseInformationToday(false);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Punch In</DialogTitle>
              <DialogDescription>
                {punchInIsLate
                  ? `You are arriving ${Math.round(punchInPreviewLate?.resultValue ?? 0)} minutes late.`
                  : "Are you sure you want to Punch In?"}
              </DialogDescription>
            </DialogHeader>
            {punchInIsLate && punchInInfoEligible ? (
              <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                <Checkbox checked={useInformationToday} onCheckedChange={(v) => setUseInformationToday(Boolean(v))} id="use-information-today" />
                <Label htmlFor="use-information-today" className="cursor-pointer font-normal">
                  Use Information / Intimation for today
                  {punchInInfoMonthlyUsage !== null && punchInInfoMonthlyLimit !== null
                    ? ` (${punchInInfoMonthlyLimit - punchInInfoMonthlyUsage} remaining this month)`
                    : null}
                </Label>
              </div>
            ) : punchInIsLate && informationRuleQuery.data ? (
              <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                Information/Intimation is not available for this Punch In (past the cutoff time or monthly limit reached).
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowPunchInConfirm(false)} disabled={punchIn.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  punchIn.mutate(useInformationToday, { onSuccess: () => setShowPunchInConfirm(false) });
                }}
                disabled={punchIn.isPending}
              >
                {punchIn.isPending ? "Punching In..." : "Yes, Punch In"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showPunchOutConfirm} onOpenChange={setShowPunchOutConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Punch Out</DialogTitle>
              <DialogDescription>Are you sure you want to Punch Out?</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowPunchOutConfirm(false)} disabled={punchOut.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  punchOut.mutate(undefined, { onSuccess: () => setShowPunchOutConfirm(false) });
                }}
                disabled={punchOut.isPending}
              >
                {punchOut.isPending ? "Punching Out..." : "Yes, Punch Out"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader>
            <CardTitle>Date Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid items-end gap-4 sm:grid-cols-[1fr_220px]">
              <div>
                <p className="text-sm text-muted-foreground">Inspect attendance for a specific date.</p>
              </div>
              <Input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                max={todayDateKey()}
              />
            </div>

            {selectedAttendanceQuery.isLoading ? (
              <LoadingState />
            ) : selectedAttendance ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard label="Status" value={ATTENDANCE_STATUS_LABELS[selectedAttendance.status]} />
                <SummaryCard label="Punch In" value={selectedAttendance.punchInAt ? formatDateTime(selectedAttendance.punchInAt) : "—"} />
                <SummaryCard label="Punch Out" value={selectedAttendance.punchOutAt ? formatDateTime(selectedAttendance.punchOutAt) : "—"} />
                <SummaryCard label="Total Working" value={selectedAttendance.totalWorkingMinutes ?? 0} />
                <SummaryCard label="Break Deduction" value={selectedAttendance.breakDeductionMinutes ?? 0} />
                <SummaryCard label="Final Working" value={selectedAttendance.workingMinutes ?? 0} />
                <SummaryCard label="Late Minutes" value={selectedAttendance.lateMinutes ?? 0} />
                <SummaryCard label="Overtime Minutes" value={selectedNightDuty.overtimeMinutes ?? 0} />
                <SummaryCard label="Early Going Minutes" value={selectedAttendance.earlyGoingMinutes ?? 0} />
                {selectedNightDuty.status !== "none" ? (
                  <SummaryCard
                    label="Night Duty"
                    value={selectedNightDuty.status === "approved" ? `${selectedNightDuty.days} Day (Approved)` : selectedNightDuty.status === "disallowed" ? "Disallowed" : "Pending"}
                  />
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="No attendance record"
                description="No attendance entry exists for the selected date."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly Attendance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid items-end gap-4 sm:grid-cols-[1fr_220px]">
              <div>
                <p className="text-sm text-muted-foreground">View attendance for the selected month.</p>
              </div>
              <Input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                max={todayDateKey().slice(0, 7)}
              />
            </div>

            {monthlyAttendanceQuery.isLoading ? (
              <LoadingState />
            ) : monthlyAttendanceQuery.error ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                Unable to load monthly attendance.
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard label="Present" value={monthlyCounts.present} />
                  <SummaryCard label="Absent" value={monthlyCounts.absent} />
                  <SummaryCard label="Leave" value={monthlyCounts.leave} />
                  <SummaryCard label="Weekly Off" value={monthlyCounts.weeklyOff} />
                  <SummaryCard label="Half Days" value={monthlyCounts.halfDay} />
                  <SummaryCard label="Late Days" value={monthlyCounts.lateDays} />
                  <SummaryCard label="Late Minutes" value={monthlyCounts.lateMinutes} />
                  <SummaryCard label="Overtime Minutes" value={monthlyCounts.overtimeMinutes} />
                  <SummaryCard label="Early Going Minutes" value={monthlyCounts.earlyGoingMinutes} />
                  <SummaryCard label="Night Duty Payable" value={monthlyCounts.nightDutyPayable} />
                </div>

                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Day</TableHead>
                        <TableHead>Punch In</TableHead>
                        <TableHead>Punch Out</TableHead>
                        <TableHead>Total Working</TableHead>
                        <TableHead>Break Deduction</TableHead>
                        <TableHead>Final Working</TableHead>
                        <TableHead>Late</TableHead>
                        <TableHead>Information</TableHead>
                        <TableHead>Penalty</TableHead>
                        <TableHead>Overtime</TableHead>
                        <TableHead>Early Going</TableHead>
                        <TableHead>Night Duty</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendanceRows.map((row) =>
                        row.isFuture ? (
                          <TableRow key={row.date} className="text-muted-foreground">
                            <TableCell>{formatDate(row.date)}</TableCell>
                            <TableCell>{row.day}</TableCell>
                            <TableCell colSpan={12}>Upcoming</TableCell>
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
                            <TableCell>
                              {row.id === null || !row.lateMinutes ? (
                                <Badge variant="outline">Not Applicable</Badge>
                              ) : (
                                <Badge variant={row.usedInformation ? "default" : "secondary"}>{row.usedInformation ? "Used" : "Not Used"}</Badge>
                              )}
                            </TableCell>
                            <TableCell>{row.penaltyMinutes ?? "—"}</TableCell>
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
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderAdminDashboardBody = () => {
    if (adminDailyAttendanceQuery.isLoading || adminSummaryQuery.isLoading || storeAttendanceSummaryQuery.isLoading) {
      return <LoadingState />;
    }

    if (adminDailyAttendanceQuery.error || adminSummaryQuery.error || storeAttendanceSummaryQuery.error) {
      return (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          Unable to load attendance dashboard. Please refresh and try again.
        </div>
      );
    }

    const summary = adminSummaryQuery.data;

    return (
      <div className="space-y-6">
        {/* Manual Staff Attendance — Super Admin only. renderAdminDashboardBody() is also the
            Company Admin's Attendance view (see the `!isSuperAdmin` fallback below), so this
            stays wrapped in `isSuperAdmin` — Company Admin and Staff never render it, never mind
            see it. attendance_admin_upsert() re-checks is_super_admin() server-side regardless. */}
        {isSuperAdmin ? <ManualStaffAttendanceCard /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Attendance Dashboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Total Records" value={summary?.totalStaff ?? 0} />
              <SummaryCard label="Present" value={summary?.present ?? 0} />
              <SummaryCard label="Absent" value={summary?.absent ?? 0} />
              <SummaryCard label="Leave" value={summary?.leave ?? 0} />
              <SummaryCard label="Weekly Off" value={summary?.weeklyOff ?? 0} />
              <SummaryCard label="Half Day" value={summary?.halfDay ?? 0} />
              <SummaryCard label="Late" value={summary?.late ?? 0} />
              <SummaryCard label="Overtime" value={summary?.overtime ?? 0} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Demo Attendance Testing</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Generate temporary attendance for all staff so you can test and explain the dashboard. Demo records can be removed after testing.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={handleGenerateDemoClick}
                  disabled={generateDemoAttendance.isPending || clearDemoAttendance.isPending}
                >
                  {generateDemoAttendance.isPending ? "Generating..." : hasDemoAttendance ? "Manage Demo Data" : "Generate Demo Attendance"}
                </Button>
                {hasDemoAttendance ? (
                  <>
                    <Button
                      variant={isDemoViewActive ? "default" : "outline"}
                      onClick={handleViewDemoData}
                      disabled={generateDemoAttendance.isPending || clearDemoAttendance.isPending}
                    >
                      {isDemoViewActive ? "Demo View Active" : "View Demo Data"}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleClearDemo}
                      disabled={clearDemoAttendance.isPending || generateDemoAttendance.isPending}
                    >
                      {clearDemoAttendance.isPending ? "Clearing..." : "Delete Demo Data"}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isDemoViewActive ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>Demo Mode is active.</strong> The dashboard is currently showing only demo attendance records. These records are for testing and can be deleted after everything is verified.
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {hasDemoAttendance
                  ? `${demoCount} demo attendance record${demoCount === 1 ? "" : "s"} already exist. You can view, regenerate, or delete them.`
                  : "No demo attendance records exist. Generate them when you are ready to test the attendance workflow."}
              </p>
            )}
          </CardContent>
        </Card>

        <AttendanceFiltersCard
          stores={storesQuery.data ?? []}
          departments={departmentsQuery.data ?? []}
          draft={filterDraft}
          onDraftChange={handleFilterDraftChange}
          onApply={handleApplyFilters}
          onReset={handleResetFilters}
          error={dateRangeError}
          maxDate={todayDateKey()}
        />

        {storeRows.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Store Attendance Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Store</TableHead>
                      <TableHead>Present</TableHead>
                      <TableHead>Absent</TableHead>
                      <TableHead>Leave</TableHead>
                      <TableHead>Weekly Off</TableHead>
                      <TableHead>Late</TableHead>
                      <TableHead>Overtime</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storeRows.map((store) => (
                      <TableRow key={store.storeId}>
                        <TableCell>{store.storeName}</TableCell>
                        <TableCell>{store.present}</TableCell>
                        <TableCell>{store.absent}</TableCell>
                        <TableCell>{store.leave}</TableCell>
                        <TableCell>{store.weeklyOff}</TableCell>
                        <TableCell>{store.late}</TableCell>
                        <TableCell>{store.overtime}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Daily Attendance Records</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => handleExportDaily("excel")} disabled={dailyExportState.loading || adminRows.length === 0}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExportDaily("pdf")} disabled={dailyExportState.loading || adminRows.length === 0}>
                  <FileText className="mr-2 h-4 w-4" />
                  Export PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {dailyExportState.error ? (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                {dailyExportState.error}
              </div>
            ) : null}
            {adminRows.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No attendance records"
                description="No records were found for the selected filters and date range."
              />
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee Code</TableHead>
                        <TableHead>Staff Name</TableHead>
                        <TableHead>Store</TableHead>
                        <TableHead>Department</TableHead>
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
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adminRows.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell>{record.employeeCode}</TableCell>
                          <TableCell>{record.employeeName}</TableCell>
                          <TableCell>{record.storeName ?? "—"}</TableCell>
                          <TableCell>{record.departmentName ?? "—"}</TableCell>
                          <TableCell>{formatDate(record.date)}</TableCell>
                          <TableCell>{weekdayFromDateKey(record.date)}</TableCell>
                          <TableCell>{record.punchInAt ? formatDateTime(record.punchInAt) : "—"}</TableCell>
                          <TableCell>{record.punchOutAt ? formatDateTime(record.punchOutAt) : "—"}</TableCell>
                          <TableCell>{formatMinutes(record.totalWorkingMinutes ?? 0)}</TableCell>
                          <TableCell>{formatMinutes(record.breakDeductionMinutes ?? 0)}</TableCell>
                          <TableCell>{formatMinutes(record.workingMinutes ?? 0)}</TableCell>
                          <TableCell>{record.lateMinutes ?? "—"}</TableCell>
                          <TableCell>{record.overtimeMinutes ?? "—"}</TableCell>
                          <TableCell>{record.earlyGoingMinutes ?? "—"}</TableCell>
                          <TableCell>
                            <NightDutyCell status={record.nightDutyStatus} days={record.nightDutyDays} nightOtMinutes={record.nightOtMinutes} />
                          </TableCell>
                          <TableCell>
                            <AttendanceStatusBadge status={record.status} />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setMonthlyDialogEmployee({
                                  id: record.employeeId,
                                  fullName: record.employeeName,
                                  employeeCode: record.employeeCode,
                                  storeName: record.storeName,
                                  departmentName: record.departmentName,
                                })
                              }
                            >
                              View month
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {adminTotal > adminRows.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing {adminRows.length} of {adminTotal} records. Narrow your filters or date range to see the rest.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Dialog open={showDemoGenerateDialog} onOpenChange={setShowDemoGenerateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate Demo Attendance?</DialogTitle>
              <DialogDescription>
                This will create temporary attendance records for the employees in the current company so the admin dashboard can be tested with realistic data.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              Demo records are marked as demo data and are intended only for testing. They can be deleted from this page after verification.
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowDemoGenerateDialog(false)} disabled={generateDemoAttendance.isPending}>
                Cancel
              </Button>
              <Button onClick={handleConfirmGenerateDemo} disabled={generateDemoAttendance.isPending}>
                {generateDemoAttendance.isPending ? "Generating..." : "Generate Demo Attendance"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showDemoExistsDialog} onOpenChange={setShowDemoExistsDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Demo Attendance Already Exists</DialogTitle>
              <DialogDescription>
                {demoCount} demo attendance record{demoCount === 1 ? "" : "s"} already exist. Choose whether to view the existing data or replace it with a fresh demo set.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => setShowDemoExistsDialog(false)} disabled={generateDemoAttendance.isPending || clearDemoAttendance.isPending}>
                Cancel
              </Button>
              <Button variant="outline" onClick={handleViewDemoData} disabled={generateDemoAttendance.isPending || clearDemoAttendance.isPending}>
                View Existing Demo
              </Button>
              <Button onClick={handleRegenerateDemoData} disabled={generateDemoAttendance.isPending || clearDemoAttendance.isPending}>
                {generateDemoAttendance.isPending || clearDemoAttendance.isPending ? "Regenerating..." : "Regenerate Demo"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showDemoClearDialog} onOpenChange={setShowDemoClearDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Demo Attendance?</DialogTitle>
              <DialogDescription>
                This will permanently remove the demo attendance records created for testing. Real attendance records will not be deleted.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              Please delete the demo data only after you have finished testing the attendance dashboard.
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowDemoClearDialog(false)} disabled={clearDemoAttendance.isPending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmClearDemo} disabled={clearDemoAttendance.isPending}>
                {clearDemoAttendance.isPending ? "Deleting..." : "Delete Demo Data"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  const renderStaffViewBody = () => {
    return (
      <div className="space-y-6">
        {staffSelectedEmployee ? (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <strong>Viewing as Super Admin</strong>
              <span className="ml-2">Employee: {staffSelectedEmployee.fullName}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleBackToAdminView}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Admin View
            </Button>
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Select Employee</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search Employee / Employee Code"
                value={staffSearchTerm}
                onChange={(event) => setStaffSearchTerm(event.target.value)}
              />
            </div>

            {staffSearchDebounced.length >= 2 && !staffSelectedEmployee ? (
              staffSearchQuery.isLoading ? (
                <LoadingState />
              ) : (staffSearchQuery.data ?? []).length > 0 ? (
                <div className="max-h-56 overflow-y-auto rounded-lg border">
                  {(staffSearchQuery.data ?? []).slice(0, 15).map((employee) => (
                    <button
                      key={employee.id}
                      type="button"
                      className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50"
                      onClick={() => handleSelectStaffEmployee(employee)}
                    >
                      <span className="font-medium">{employee.fullName}</span>
                      <span className="text-muted-foreground">{employee.employeeCode ?? "—"}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No employees found for "{staffSearchDebounced}".</p>
              )
            ) : null}
          </CardContent>
        </Card>

        {!staffSelectedEmployee ? (
          <EmptyState
            icon={Users}
            title="No employee selected"
            description="Search by name or employee code and select an employee to view their attendance dashboard."
          />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Employee Information</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <p className="text-xs text-muted-foreground">Employee Name</p>
                  <p className="text-sm font-medium">{staffSelectedEmployee.fullName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Employee Code</p>
                  <p className="text-sm font-medium">{staffSelectedEmployee.employeeCode ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Store</p>
                  <p className="text-sm font-medium">{staffSelectedEmployee.storeName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Department</p>
                  <p className="text-sm font-medium">{staffSelectedEmployee.departmentName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Designation</p>
                  <p className="text-sm font-medium">{staffSelectedEmployee.designationTitle ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Current Shift</p>
                  <p className="text-sm font-medium">
                    {staffCurrentShiftQuery.data
                      ? `${staffCurrentShiftQuery.data.shift.name} (${staffCurrentShiftQuery.data.shift.startTime.slice(0, 5)}–${staffCurrentShiftQuery.data.shift.endTime.slice(0, 5)})`
                      : "Not assigned"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Weekly Off</p>
                  <p className="text-sm font-medium">
                    {staffCurrentWeeklyOffQuery.data ? WEEKDAY_LABELS[staffCurrentWeeklyOffQuery.data.weeklyOffDay] : "Not set"}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle>Attendance Summary</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleExportStaff("excel")} disabled={staffRangeRows.length === 0}>
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Export Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleExportStaff("pdf")} disabled={staffRangeRows.length === 0}>
                      <FileText className="mr-2 h-4 w-4" />
                      Export PDF
                    </Button>
                    <Button size="sm" onClick={openMonthlyDialogForStaffEmployee}>
                      View Month
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label>From Date</Label>
                    <Input type="date" value={staffFromDate} max={todayDateKey()} onChange={(event) => setStaffFromDate(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>To Date</Label>
                    <Input type="date" value={staffToDate} max={todayDateKey()} onChange={(event) => setStaffToDate(event.target.value)} />
                  </div>
                </div>
                {staffDateRangeInvalid ? (
                  <p className="text-sm text-destructive">From Date cannot be later than To Date.</p>
                ) : staffRangeQuery.isLoading ? (
                  <LoadingState />
                ) : staffRangeQuery.error ? (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                    Unable to load employee attendance.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <SummaryCard label="Present" value={staffSummary.present} />
                      <SummaryCard label="Absent" value={staffSummary.absent} />
                      <SummaryCard label="Leave" value={staffSummary.leave} />
                      <SummaryCard label="Weekly Off" value={staffSummary.weeklyOff} />
                      <SummaryCard label="Half Days" value={staffSummary.halfDay} />
                      <SummaryCard label="Late Days" value={staffSummary.lateDays} />
                      <SummaryCard label="Late Minutes" value={staffSummary.lateMinutes} />
                      <SummaryCard label="Overtime Minutes" value={staffSummary.overtimeMinutes} />
                      <SummaryCard label="Early Going Minutes" value={staffSummary.earlyGoingMinutes} />
                      <SummaryCard label="Night Duty Payable" value={staffSummary.nightDutyPayable} />
                    </div>

                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
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
                          {staffRangeRows.map((row) =>
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
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  };

  const renderAdminContent = () => {
    if (!user?.companyId) {
      return (
        <EmptyState
          icon={Building2}
          title="Company access required"
          description="Admin attendance dashboards require a company context."
        />
      );
    }

    if (!isSuperAdmin) {
      // company_admin: unchanged Admin View, no view switcher.
      return renderAdminDashboardBody();
    }

    return (
      <div className="space-y-6">
        <Tabs value={activeAdminView} onValueChange={(value) => setActiveAdminView(value as "admin" | "staff")}>
          <TabsList>
            <TabsTrigger value="admin">Admin View</TabsTrigger>
            <TabsTrigger value="staff">Staff View</TabsTrigger>
          </TabsList>
        </Tabs>
        {activeAdminView === "admin" ? renderAdminDashboardBody() : renderStaffViewBody()}
      </div>
    );
  };

  // Import Attendance is a role permission (admin/super_admin) AND a view-state condition: it must
  // disappear the instant Super Admin switches into Staff View (view-only inspection mode), and
  // reappear when switching back — never CSS-hidden, only actually not rendered.
  const canImportAttendance = isAdmin;
  const isAdminViewActive = !isSuperAdmin || activeAdminView === "admin";
  const showImportAttendanceAction = isAdmin && canImportAttendance && isAdminViewActive;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description={isAdmin ? "View attendance across the company." : "Punch in/out securely and review your daily attendance."}
        actions={
          showImportAttendanceAction ? (
            <Button asChild variant="outline">
              <Link to={ROUTES.attendanceImport}>
                <Upload className="mr-2 h-4 w-4" />
                Import Attendance
              </Link>
            </Button>
          ) : undefined
        }
      />
      {isAdmin ? renderAdminContent() : renderEmployeeContent()}
      <MonthlyAttendanceDialog
        employee={monthlyDialogEmployee}
        open={Boolean(monthlyDialogEmployee)}
        onOpenChange={(open) => {
          if (!open) setMonthlyDialogEmployee(null);
        }}
      />
    </div>
  );
}
