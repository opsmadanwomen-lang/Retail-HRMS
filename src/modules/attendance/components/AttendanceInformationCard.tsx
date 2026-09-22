import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEmployee } from "@/hooks/useEmployees";
import { useCurrentShiftAssignment } from "@/hooks/useShifts";
import { useCurrentWeeklyOff } from "@/hooks/useWeeklyOff";
import { useExplainAttendanceRules } from "@/hooks/useAttendance";
import { useCurrentNightDutyConfig, useListExtendedDutyRules } from "@/hooks/useExtendedAttendanceRules";
import { WEEKDAY_LABELS } from "@/lib/weeklyOffResolver";
import { todayDateKey } from "@/lib/dateRange";
import type { AttendanceRuleExplanation } from "@/types/attendance";

/**
 * READ-ONLY display of the attendance configuration currently applicable to the logged-in
 * employee — used by the Staff Profile page's "Shift & Attendance Rules" section (title +
 * showEmployeeSection props let the same component/data serve that placement without a second
 * copy; it previously rendered inline on the Attendance page as "Attendance Information" before
 * that section was moved to Profile).
 *
 * DATA SOURCES (all pre-existing, nothing new resolved here — see the task's explicit "do not
 * create a second rule-resolution engine"):
 *  - Employee/Store/Department/Status: useEmployee() -> employeeService.getById() (already resolves
 *    store/department display names, unlike the lighter useCurrentEmployee() used elsewhere on this
 *    page for punch-in identity).
 *  - Shift/Shift Timing/Break/Overtime Eligible: useCurrentShiftAssignment() (same hook the "My
 *    Shift & Weekly Off" card above already uses).
 *  - Weekly Off: useCurrentWeeklyOff() (same hook already used above).
 *  - Late / Early Going / Half Day (cutoffs) / Overtime / Extended Duty rule + config: ONE call to
 *    attendance_explain_rules() via useExplainAttendanceRules() — the exact same
 *    resolve_attendance_rule() scope-hierarchy chain (Employee+Store -> Store-all-employees ->
 *    All-Stores-all-employees -> legacy) attendance_admin_upsert() itself uses, called here with
 *    today's date and no punch times (a pure "what applies to me" resolution, not a calculation).
 *  - Night Duty's third (Final OT Cutoff) threshold: not yet in explain_rules' extended_duty
 *    config, so looked up from the SAME resolved rule id via useListExtendedDutyRules() (existing
 *    admin-picker fetcher) — never a second/different rule, just one more field off the identical
 *    resolved row.
 *  - Night Duty Approval Required: useCurrentNightDutyConfig() (this table has no per-employee
 *    hierarchy at all by design — migration 0042 — so "current company config" IS the correct
 *    resolution).
 *
 * Nothing here recalculates Total Working/Break Deduction/Final Working/Late/Early Going/Normal
 * OT/Night OT/Night Duty Days — only their CONFIGURED rule values are displayed.
 */
export function AttendanceInformationCard({
  employeeId,
  companyId,
  title = "Attendance Information",
  showEmployeeSection = true,
}: {
  employeeId?: string;
  companyId?: string;
  /** Card heading — the Staff Profile page's own usage overrides this to "Shift & Attendance
   *  Rules" (same component, same data, just relocated per the Profile-page-restructuring task). */
  title?: string;
  /** The "Employee" group (Name/Code/Store/Department/Status) is redundant when this card is
   *  embedded on the Profile page, which already shows that identity in its own header — Profile's
   *  usage passes false. Attendance page usage (if ever restored) keeps the default true. */
  showEmployeeSection?: boolean;
}) {
  const employeeQuery = useEmployee(employeeId);
  const shiftQuery = useCurrentShiftAssignment(employeeId);
  const weeklyOffQuery = useCurrentWeeklyOff(employeeId);
  const nightDutyConfigQuery = useCurrentNightDutyConfig(companyId);
  const extendedDutyRulesQuery = useListExtendedDutyRules(companyId);

  const employee = employeeQuery.data;
  const shift = shiftQuery.data?.shift;
  const storeId = employee?.storeId ?? undefined;

  const explainQuery = useExplainAttendanceRules(
    companyId && employeeId && shift?.id && storeId
      ? {
          companyId,
          employeeId,
          shiftId: shift.id,
          storeId,
          attendanceDate: todayDateKey(),
          punchInAt: null,
          punchOutAt: null,
        }
      : null
  );

  const explanations = explainQuery.data ?? [];
  const findKind = (kind: AttendanceRuleExplanation["kind"]) => explanations.find((e) => e.kind === kind);
  const lateRule = findKind("late");
  const earlyGoingRule = findKind("early_going");
  const halfDayRule = findKind("half_day");
  const overtimeRule = findKind("overtime");
  const extendedDutyRule = findKind("extended_duty");

  // Same resolved extended_duty rule id explain_rules already picked — just reading one more field
  // (thirdDaySalaryThresholdTime) off that identical row, never a different/second lookup.
  const resolvedExtendedDutyRule = useMemo(
    () => (extendedDutyRule?.ruleId ? (extendedDutyRulesQuery.data ?? []).find((r) => r.id === extendedDutyRule.ruleId) : undefined),
    [extendedDutyRule?.ruleId, extendedDutyRulesQuery.data]
  );

  const isLoading =
    employeeQuery.isLoading || shiftQuery.isLoading || weeklyOffQuery.isLoading || nightDutyConfigQuery.isLoading || (Boolean(storeId) && explainQuery.isLoading);
  const hasError = employeeQuery.isError || shiftQuery.isError || weeklyOffQuery.isError;

  if (hasError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Attendance information could not be loaded.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const nothingConfigured =
    !employee?.storeName &&
    !shift &&
    !weeklyOffQuery.data &&
    !lateRule?.isAssigned &&
    !overtimeRule?.isAssigned &&
    !extendedDutyRule?.isAssigned &&
    !nightDutyConfigQuery.data;

  if (nothingConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Attendance rules are not configured for your profile.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {showEmployeeSection ? (
          <InfoGroup title="Employee">
            <InfoField label="Employee Name" value={employee?.fullName} />
            <InfoField label="Employee Code" value={employee?.employeeCode} />
            <InfoField label="Store" value={employee?.storeName ?? (employee ? "All Stores" : undefined)} />
            <InfoField label="Department" value={employee?.departmentName} />
            <InfoField label="Attendance Status" value={employee?.status ? capitalize(employee.status) : undefined} />
          </InfoGroup>
        ) : null}

        <InfoGroup title="Shift & Schedule">
          <InfoField label="Shift Name" value={shift?.name} />
          <InfoField label="Shift Timing" value={shift ? `${formatClockTime(shift.startTime)} – ${formatClockTime(shift.endTime)}` : undefined} />
          <InfoField label="Weekly Off" value={weeklyOffQuery.data ? WEEKDAY_LABELS[weeklyOffQuery.data.weeklyOffDay] : undefined} />
          <InfoField
            label="Overtime Eligible"
            value={shift ? <Badge variant={shift.overtimeEnabled ? "default" : "secondary"}>{shift.overtimeEnabled ? "Yes" : "No"}</Badge> : undefined}
          />
        </InfoGroup>

        <InfoGroup title="Late / Early Going">
          <InfoField label="Late Arrival Rule" value={lateRule?.isAssigned ? summarizeGraceRule(lateRule) : undefined} />
          <InfoField label="Late Arrival Cutoff" value={configTime(halfDayRule, "lateArrivalCutoffTime")} />
          <InfoField label="Early Going Rule" value={earlyGoingRule?.isAssigned ? summarizeGraceRule(earlyGoingRule) : undefined} />
          <InfoField label="Early Going Cutoff" value={configTime(halfDayRule, "earlyGoingCutoffTime")} />
        </InfoGroup>

        <InfoGroup title="Overtime">
          <InfoField label="Break Rule / Break Duration" value={shift ? `${shift.breakMinutes} min` : undefined} />
          <InfoField label="Normal Overtime Rule" value={overtimeRule?.isAssigned ? summarizeOvertimeRule(overtimeRule) : undefined} />
        </InfoGroup>

        <InfoGroup title="Night Duty">
          <InfoField
            label="Extended Duty / Night Duty Rule"
            value={extendedDutyRule?.isAssigned ? summarizeNightDutyLadder(extendedDutyRule, resolvedExtendedDutyRule?.thirdDaySalaryThresholdTime) : undefined}
          />
          <InfoField
            label="Night Duty Approval Required"
            value={
              nightDutyConfigQuery.data ? (
                <Badge variant={nightDutyConfigQuery.data.approvalRequired ? "default" : "secondary"}>
                  {nightDutyConfigQuery.data.approvalRequired ? "Required" : "Not Required"}
                </Badge>
              ) : undefined
            }
          />
          <InfoField
            label="Night Duty Approver"
            value={nightDutyConfigQuery.data?.approvalRequired ? "Operations Manager → Super Manager" : undefined}
          />
          <InfoField label="Night Duty First Threshold" value={configThresholdLabel(extendedDutyRule, "firstDaySalaryThresholdTime", "firstDayExtraDutyValue")} />
          <InfoField label="Night Duty Second Threshold" value={configThresholdLabel(extendedDutyRule, "secondDaySalaryThresholdTime", "secondDayExtraDutyValue")} />
          <InfoField label="Night Duty Final OT Cutoff" value={resolvedExtendedDutyRule ? formatClockTime(resolvedExtendedDutyRule.thirdDaySalaryThresholdTime) : undefined} />
          <InfoField
            label="Night OT Rule"
            value={extendedDutyRule?.isAssigned ? summarizeNightOtWindows(extendedDutyRule, resolvedExtendedDutyRule?.thirdDaySalaryThresholdTime) : undefined}
          />
        </InfoGroup>
      </CardContent>
    </Card>
  );
}

function InfoGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}

/** A single label/value pair — read-only, no edit affordance anywhere in this card. Missing/
 *  unconfigured values always show "Not Configured", never a guessed default. */
function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">
        {value === undefined || value === null || value === "" ? <span className="text-muted-foreground">Not Configured</span> : value}
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

/** "14:00:00" -> "02:00 PM". Pure display formatting of an already-resolved config value. */
function formatClockTime(time: string | null | undefined): string | undefined {
  if (!time) return undefined;
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function configTime(explanation: AttendanceRuleExplanation | undefined, key: string): string | undefined {
  if (!explanation?.isAssigned || !explanation.config) return undefined;
  const raw = explanation.config[key];
  return typeof raw === "string" ? formatClockTime(raw) : undefined;
}

function summarizeGraceRule(explanation: AttendanceRuleExplanation): string {
  const config = explanation.config ?? {};
  const grace = config.graceMinutes;
  const method = config.calculationMethod;
  const parts: string[] = [];
  if (typeof grace === "number") parts.push(`Grace ${grace} min`);
  if (typeof method === "string") parts.push(method === "slab" ? "Slab" : "Exact");
  return parts.length > 0 ? parts.join(" · ") : "Configured";
}

function summarizeOvertimeRule(explanation: AttendanceRuleExplanation): string {
  const config = explanation.config ?? {};
  const min = config.minimumOvertimeMinutes;
  const max = config.maximumOvertimeMinutes;
  const parts: string[] = [];
  if (typeof min === "number" && min > 0) parts.push(`Min ${min} min`);
  if (typeof max === "number") parts.push(`Max ${max} min`);
  if (config.weeklyOffOvertimeAllowed === false) parts.push("Weekly Off OT not allowed");
  if (config.holidayOvertimeAllowed === false) parts.push("Holiday OT not allowed");
  return parts.length > 0 ? parts.join(" · ") : "Configured (no minimum/maximum)";
}

function configThresholdLabel(explanation: AttendanceRuleExplanation | undefined, timeKey: string, valueKey: string): string | undefined {
  if (!explanation?.isAssigned || !explanation.config) return undefined;
  const time = explanation.config[timeKey];
  const value = explanation.config[valueKey];
  if (typeof time !== "string" || typeof value !== "number") return undefined;
  const days = value === 1 ? "1 Day" : `${value} Days`;
  return `${formatClockTime(time)} → ${days}`;
}

function summarizeNightDutyLadder(explanation: AttendanceRuleExplanation, thirdThreshold: string | undefined): string {
  const config = explanation.config ?? {};
  const rows: string[] = [];
  if (typeof config.midnightThresholdTime === "string" && typeof config.midnightExtraDutyValue === "number") {
    rows.push(`${formatClockTime(config.midnightThresholdTime)} → ${config.midnightExtraDutyValue} Day`);
  }
  if (typeof config.firstDaySalaryThresholdTime === "string" && typeof config.firstDayExtraDutyValue === "number") {
    rows.push(`${formatClockTime(config.firstDaySalaryThresholdTime)} → ${config.firstDayExtraDutyValue} Day`);
  }
  if (typeof config.secondDaySalaryThresholdTime === "string" && typeof config.secondDayExtraDutyValue === "number") {
    rows.push(`${formatClockTime(config.secondDaySalaryThresholdTime)} → ${config.secondDayExtraDutyValue} Days`);
  }
  void thirdThreshold; // the ladder itself has only 3 day-value tiers; the 3rd time marks Night OT's cutoff, shown in its own field.
  return rows.join(" · ");
}

function summarizeNightOtWindows(explanation: AttendanceRuleExplanation, thirdThreshold: string | undefined): string {
  const config = explanation.config ?? {};
  const midnight = typeof config.midnightThresholdTime === "string" ? formatClockTime(config.midnightThresholdTime) : undefined;
  const firstDay = typeof config.firstDaySalaryThresholdTime === "string" ? formatClockTime(config.firstDaySalaryThresholdTime) : undefined;
  const secondDay = typeof config.secondDaySalaryThresholdTime === "string" ? formatClockTime(config.secondDaySalaryThresholdTime) : undefined;
  const finalCutoff = thirdThreshold ? formatClockTime(thirdThreshold) : undefined;

  const rows: string[] = [];
  if (midnight && firstDay) rows.push(`${midnight}–${firstDay}: elapsed OT`);
  if (firstDay && secondDay) rows.push(`${firstDay}–${secondDay}: elapsed OT`);
  if (secondDay && finalCutoff) rows.push(`${secondDay}–${finalCutoff}: elapsed OT`);
  if (finalCutoff) rows.push(`After ${finalCutoff}: capped`);
  return rows.join(" · ");
}
