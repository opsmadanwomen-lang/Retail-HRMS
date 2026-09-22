import type { AttendanceStatus } from "@/types/database.types";
import type { AttendanceRecord } from "@/types/attendance";
import type { NightDutyApproval, NightDutyApprovalStatus } from "@/types/attendanceRules";
import { enumerateDateRange, enumerateMonthDates, todayDateKey } from "@/lib/dateRange";
import { isWeeklyOffOnDate, type WeeklyOffOverrideLite, type WeeklyOffPeriodLite } from "@/lib/weeklyOffResolver";

/**
 * Night Duty Approval -> Attendance integration — THE single authoritative place this merge
 * happens (Master Task: Night Duty Approval -> Attendance -> Night OT -> Payable). Every screen
 * that shows Overtime or Night Duty for a day (the employee's own Monthly Attendance, the Admin
 * Staff-View date range, the Monthly Attendance popup, and the Admin Daily Attendance Records
 * table — see attendanceAdminService.ts) MUST go through resolveNightDutyFacts() below rather than
 * reading attendance_records.overtime_minutes directly, so Approval -> Attendance is automatic and
 * identical everywhere, with zero duplicate calculation.
 *
 * Only a FINAL APPROVED Night Duty (approval_status = 'approved' | 'om_approved' |
 * 'super_manager_approved') ever contributes anything payable — pending and disallowed requests
 * contribute nothing, matching the OM/Super Manager decide RPCs (migrations 0047/0049), which only
 * ever write payable_overtime_minutes on those same three statuses.
 *
 * MAGNITUDE SOURCE (Aug 2026 bug fix): the day-value and Night OT minutes are read from
 * `attendance_records` (`payable_extra_duty_value`/`extra_duty_value`, `night_ot_minutes`) — NEVER
 * from `attendance_night_duty_approvals`' own `extra_duty_value`/`night_ot_minutes` columns.
 * That approval row only ever gets those two columns set ONCE, at creation (`ensure_night_duty_
 * approval`, migration 0045) — if the underlying punch is later corrected (e.g. via Manual Staff
 * Attendance / attendance_admin_upsert), `attendance_records` recomputes correctly but the
 * already-existing approval row's snapshot is never touched, silently going stale. The OM/Super
 * Manager decide RPCs already know this: they compute `payable_extra_duty_value`/`payable_
 * overtime_minutes` from the CURRENT `attendance_records` columns at the moment of decision, not
 * from the approval row — so reading `attendance_records` here (not the approval row) is what
 * keeps this function's output consistent with what the backend itself just approved as payable.
 * `approval` is consulted ONLY for `approvalStatus` (pending/approved/disallowed) — never for a
 * numeric value.
 */
export type NightDutyDisplayStatus = "none" | "pending" | "approved" | "disallowed";

export function collapseNightDutyStatus(status: NightDutyApprovalStatus | null | undefined): NightDutyDisplayStatus {
  if (!status) return "none";
  if (status === "approved" || status === "om_approved" || status === "super_manager_approved") return "approved";
  if (status === "disallowed" || status === "om_disallowed" || status === "super_manager_disallowed") return "disallowed";
  return "pending"; // 'pending' | 'pending_om' | 'pending_super_manager'
}

export interface NightDutyFacts {
  status: NightDutyDisplayStatus;
  /**
   * The configured Extended Duty day-value (from attendance_extended_duty_rules, e.g. 0.5 / 1 / 2 —
   * see calculate_extended_duty(), migration 0044) when this day's Night Duty is FINAL APPROVED,
   * else 0 — what "Night Duty Payable" sums. NEVER hardcoded to 1, and never read from the approval
   * row's own (potentially stale) snapshot — see the module-level note above.
   */
  days: number;
  /** Approved Night OT minutes for this day — 0 unless Approved (never Pending/Disallowed). */
  nightOtMinutes: number;
  /** The ONE authoritative payable Overtime figure for this day, by Night Duty state: no request at
   *  all -> ordinary Normal OT (untouched); Pending -> 0 (nothing payable yet); Approved -> the
   *  backend's payable_overtime_minutes (Normal OT + Night OT, except Night OT ONLY at the
   *  terminal 2-Day tier — migration 0082); Disallowed -> payable_overtime_minutes computed from
   *  the manager's Confirmed Payable Out Time, or 0 if that was never recorded. */
  overtimeMinutes: number | null;
}

/** Display label for `NightDutyDisplayStatus` — shared by exports and any future plain-text UI. */
export function nightDutyStatusLabel(status: NightDutyDisplayStatus): "Approved" | "Pending" | "Disallowed" | "None" {
  if (status === "approved") return "Approved";
  if (status === "pending") return "Pending";
  if (status === "disallowed") return "Disallowed";
  return "None";
}

export function resolveNightDutyFacts(
  record:
    | {
        overtimeMinutes: number | null;
        /** attendance_records.night_ot_minutes — the LIVE value, not the approval row's creation-time snapshot. */
        nightOtMinutes?: number | null;
        /** attendance_records.payable_extra_duty_value — set by the decide RPC at approval time from the
         *  (by-then-current) extra_duty_value; the authoritative "what was actually approved" day count. */
        payableExtraDutyValue?: number | null;
        /** attendance_records.extra_duty_value — fallback only for the rare case payable hasn't been set. */
        extraDutyValue?: number | null;
        /** attendance_records.payable_overtime_minutes — the backend's own final payable Overtime figure.
         *  Migration 0082: this is the ONLY place the "2-Day Night Duty suppresses Normal OT" business
         *  rule is applied (Normal OT + Night OT for the 0.5/1-Day tiers, Night OT ONLY at the terminal
         *  2-Day tier) — never re-derived here, so there is exactly one place that rule can drift.
         *  Migration 0081 keeps this fresh even after a Punch Out correction on an already-approved
         *  record, so it's safe to trust directly whenever the record is Approved. */
        payableOvertimeMinutes?: number | null;
      }
    | null
    | undefined,
  approval: Pick<NightDutyApproval, "approvalStatus"> | null | undefined
): NightDutyFacts {
  const status = collapseNightDutyStatus(approval?.approvalStatus);
  const isApproved = status === "approved";
  const nightOtMinutes = isApproved ? record?.nightOtMinutes ?? 0 : 0;

  // Payable Overtime by state (business rule):
  //   none      -> no Night Duty request at all this day -- ordinary Normal OT, untouched.
  //   pending   -> nothing is payable yet, not even the pre-existing Normal OT for this
  //                attendance -- OT = 0 until a manager decides.
  //   approved  -> the backend's own payable_overtime_minutes (migration 0082: Normal OT + Night
  //                OT for the 0.5/1-Day tiers, Night OT ONLY at the terminal 2-Day tier).
  //   disallowed -> the backend's payable_overtime_minutes computed from the manager's Confirmed
  //                Payable Out Time (calculate_extended_duty() evaluated at that time, migrations
  //                0047/0049) -- NOT the raw/actual-punch Normal OT. Falls back to 0 in the
  //                (schema-guarded, shouldn't normally happen) case no confirmed time was recorded.
  let overtimeMinutes: number | null;
  if (status === "pending") {
    overtimeMinutes = 0;
  } else if (status === "approved") {
    overtimeMinutes = record?.payableOvertimeMinutes ?? (nightOtMinutes > 0 ? (record?.overtimeMinutes ?? 0) + nightOtMinutes : record?.overtimeMinutes ?? 0);
  } else if (status === "disallowed") {
    overtimeMinutes = record?.payableOvertimeMinutes ?? 0;
  } else {
    overtimeMinutes = record?.overtimeMinutes ?? null;
  }

  // Pending/Disallowed contribute 0 regardless of what the configured ladder would otherwise say —
  // approval status and the day-value are separate concepts; only Approved ever counts.
  const days = isApproved ? record?.payableExtraDutyValue ?? record?.extraDutyValue ?? 0 : 0;
  return { status, days, nightOtMinutes, overtimeMinutes };
}

/**
 * Single shared shape + calculation logic for "one row per day" attendance views — used by the
 * employee's own Monthly Attendance table, the admin/Staff-View Monthly popup, and Staff View's
 * date-range table. Do not re-derive this per screen; always go through the builders below so
 * Present/Absent/Leave/Weekly Off/Half Day/Late/Overtime — and now future-date and weekly-off
 * handling — are computed identically everywhere.
 */
export interface MonthlyAttendanceRow {
  /** The underlying attendance_records row id — null when no record exists yet for this date (e.g.
   *  a future/absent day with nothing saved). Needed to target one specific record for actions like
   *  "Use Information", which operate on an existing record, never a synthesized day. */
  id: string | null;
  date: string;
  day: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  /** Punch Out - Punch In, before break deduction. */
  totalWorkingMinutes: number | null;
  /** The break duration deducted to arrive at workingMinutes. */
  breakDeductionMinutes: number | null;
  /** Final Working = totalWorkingMinutes - breakDeductionMinutes. */
  workingMinutes: number | null;
  lateMinutes: number | null;
  /** The ONE authoritative Overtime figure — existing normal Overtime PLUS approved Night OT when
   *  this day's Night Duty is Final Approved (see resolveNightDutyFacts()). Unchanged from the
   *  record's own overtime_minutes on any day with no approved Night Duty. */
  overtimeMinutes: number | null;
  earlyGoingMinutes: number | null;
  /** Whether this specific day's calculation consumed an Information/Intimation use. Staff-controlled
   *  (migration 0087) — reflects the Staff's own choice at Punch In (or an explicit Super Admin
   *  grant), never an automatic decision. Needed to re-explain (never re-trigger) the Information
   *  Rule's actual historical result for this day — see attendance_explain_rules(). */
  usedInformation: boolean;
  /** The record's own stored Penalty, independent of Late — 0 when Information was used or no
   *  Penalty applies, null when no record exists for this date. */
  penaltyMinutes: number | null;
  status: AttendanceStatus;
  /** True for any date after today — never counted as Absent/Present/etc, rendered as "Upcoming". */
  isFuture: boolean;
  /** none = no Night Duty request exists for this day. */
  nightDutyStatus: NightDutyDisplayStatus;
  /** 1 when this day's Night Duty is Final Approved, else 0 — what monthly "Night Duty Payable" counts. */
  nightDutyDays: number;
  /** Approved Night OT minutes for this day — 0 unless nightDutyStatus === 'approved'. Already
   *  included in `overtimeMinutes` above; kept separate too so the UI can show it distinctly. */
  nightOtMinutes: number;
}

export interface AttendanceRangeSummary {
  present: number;
  absent: number;
  leave: number;
  weeklyOff: number;
  halfDay: number;
  lateDays: number;
  lateMinutes: number;
  overtimeMinutes: number;
  earlyGoingMinutes: number;
  /** Count of FINAL APPROVED Night Duty days in the range/month — Section 8's exact definition. */
  nightDutyPayable: number;
  /** Sum of approved Night OT minutes in the range/month — already included inside `overtimeMinutes`
   *  above; kept separately so exports/summaries can show it as its own line without recomputation. */
  nightOtMinutes: number;
}

function toAttendanceRow(
  dateKey: string,
  day: string,
  record: AttendanceRecord | undefined,
  nightDutyApprovalByRecordId: Map<string, NightDutyApproval>,
  isWeeklyOff: boolean,
  isFuture: boolean,
  leaveEffectByDate?: Map<string, { isHalfDay: boolean }>
): MonthlyAttendanceRow {
  // A real attendance record (a punch, an imported row, an approved-leave entry, etc.) always wins
  // — priority order is: recorded status > Leave (Phase 5) > weekly off > absent. Never overrides an
  // actual punch — an employee who is on approved Leave but still has a real attendance_records row
  // for the day (e.g. an admin correction) keeps showing whatever that row actually says.
  const leaveEffect = leaveEffectByDate?.get(dateKey);
  const status: AttendanceStatus =
    record?.status ?? (leaveEffect ? (leaveEffect.isHalfDay ? "half_day" : "leave") : isWeeklyOff ? "weekly_off" : "absent");
  const approval = record?.id ? nightDutyApprovalByRecordId.get(record.id) : undefined;
  const nightDuty = resolveNightDutyFacts(record, approval);

  return {
    id: record?.id ?? null,
    date: dateKey,
    day,
    punchInAt: record?.punchInAt ?? null,
    punchOutAt: record?.punchOutAt ?? null,
    totalWorkingMinutes: record?.totalWorkingMinutes ?? null,
    breakDeductionMinutes: record?.breakDeductionMinutes ?? null,
    workingMinutes: record?.workingMinutes ?? null,
    lateMinutes: record?.lateMinutes ?? null,
    overtimeMinutes: nightDuty.overtimeMinutes,
    earlyGoingMinutes: record?.earlyGoingMinutes ?? null,
    usedInformation: record?.usedInformation ?? false,
    penaltyMinutes: record?.penaltyMinutes ?? null,
    status,
    isFuture,
    nightDutyStatus: nightDuty.status,
    nightDutyDays: nightDuty.days,
    nightOtMinutes: nightDuty.nightOtMinutes,
  };
}

function mapByAttendanceRecordId(approvals: NightDutyApproval[]): Map<string, NightDutyApproval> {
  return new Map(approvals.map((a) => [a.attendanceRecordId, a]));
}

/** One entry per approved-Leave-covered date (Phase 5) — see leave_list_attendance_effects(). */
export interface LeaveAttendanceEffectLite {
  date: string;
  isHalfDay: boolean;
}

function mapLeaveEffectsByDate(effects: LeaveAttendanceEffectLite[]): Map<string, { isHalfDay: boolean }> {
  return new Map(effects.map((e) => [e.date, { isHalfDay: e.isHalfDay }]));
}

/** Every day of `month` (1-indexed), 01 -> last day — never spills into the previous/next month. */
export function buildMonthlyAttendanceRows(
  records: AttendanceRecord[],
  year: number,
  month: number,
  weeklyOffPeriods: WeeklyOffPeriodLite[] = [],
  weeklyOffOverrides: WeeklyOffOverrideLite[] = [],
  nightDutyApprovals: NightDutyApproval[] = [],
  leaveEffects: LeaveAttendanceEffectLite[] = []
): MonthlyAttendanceRow[] {
  const recordMap = new Map(records.map((record) => [record.attendanceDate, record]));
  const approvalMap = mapByAttendanceRecordId(nightDutyApprovals);
  const leaveEffectMap = mapLeaveEffectsByDate(leaveEffects);
  const today = todayDateKey();
  return enumerateMonthDates(year, month).map(({ dateKey, day }) => {
    const isFuture = dateKey > today;
    const isWeeklyOff = !isFuture && isWeeklyOffOnDate(dateKey, weeklyOffPeriods, weeklyOffOverrides);
    return toAttendanceRow(dateKey, day, recordMap.get(dateKey), approvalMap, isWeeklyOff, isFuture, leaveEffectMap);
  });
}

/** Every day from fromDate to toDate inclusive. */
export function buildDateRangeRows(
  records: AttendanceRecord[],
  fromDate: string,
  toDate: string,
  weeklyOffPeriods: WeeklyOffPeriodLite[] = [],
  weeklyOffOverrides: WeeklyOffOverrideLite[] = [],
  nightDutyApprovals: NightDutyApproval[] = [],
  leaveEffects: LeaveAttendanceEffectLite[] = []
): MonthlyAttendanceRow[] {
  const recordMap = new Map(records.map((record) => [record.attendanceDate, record]));
  const approvalMap = mapByAttendanceRecordId(nightDutyApprovals);
  const leaveEffectMap = mapLeaveEffectsByDate(leaveEffects);
  const today = todayDateKey();
  return enumerateDateRange(fromDate, toDate).map(({ dateKey, day }) => {
    const isFuture = dateKey > today;
    const isWeeklyOff = !isFuture && isWeeklyOffOnDate(dateKey, weeklyOffPeriods, weeklyOffOverrides);
    return toAttendanceRow(dateKey, day, recordMap.get(dateKey), approvalMap, isWeeklyOff, isFuture, leaveEffectMap);
  });
}

/** Future dates are never counted in any bucket — only dates up to today contribute to the summary. */
export function buildAttendanceSummary(rows: MonthlyAttendanceRow[]): AttendanceRangeSummary {
  return rows.reduce(
    (summary, row) => {
      if (row.isFuture) return summary;

      switch (row.status) {
        case "present":
          summary.present += 1;
          break;
        case "absent":
          summary.absent += 1;
          break;
        case "leave":
          summary.leave += 1;
          break;
        case "weekly_off":
          summary.weeklyOff += 1;
          break;
        case "half_day":
          summary.halfDay += 1;
          break;
        default:
          break;
      }

      if (row.lateMinutes && row.lateMinutes > 0) {
        summary.lateDays += 1;
        summary.lateMinutes += row.lateMinutes;
      }
      if (row.overtimeMinutes && row.overtimeMinutes > 0) {
        summary.overtimeMinutes += row.overtimeMinutes;
      }
      if (row.earlyGoingMinutes && row.earlyGoingMinutes > 0) {
        summary.earlyGoingMinutes += row.earlyGoingMinutes;
      }

      summary.nightDutyPayable += row.nightDutyDays;
      summary.nightOtMinutes += row.nightOtMinutes;

      return summary;
    },
    {
      present: 0,
      absent: 0,
      leave: 0,
      weeklyOff: 0,
      halfDay: 0,
      lateDays: 0,
      lateMinutes: 0,
      overtimeMinutes: 0,
      earlyGoingMinutes: 0,
      nightDutyPayable: 0,
      nightOtMinutes: 0,
    }
  );
}

/**
 * The four Night Duty export cell values (Excel + PDF), built once here so every export call site
 * renders identical text for identical underlying facts — never re-derived ad hoc per screen.
 * Source values (`nightDutyStatus`/`nightDutyDays`/`nightOtMinutes`) are always the output of
 * resolveNightDutyFacts(), never recomputed.
 */
export function nightDutyExportFields(row: {
  nightDutyStatus: NightDutyDisplayStatus;
  nightDutyDays: number;
  nightOtMinutes: number;
}): { nightDuty: string; nightDutyStatus: string; nightOt: number; nightDutyPayable: number } {
  return {
    nightDuty: row.nightDutyDays > 0 ? `${row.nightDutyDays} Day${row.nightDutyDays === 1 ? "" : "s"}` : "0",
    nightDutyStatus: nightDutyStatusLabel(row.nightDutyStatus),
    nightOt: row.nightOtMinutes,
    nightDutyPayable: row.nightDutyDays,
  };
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export function formatTime(value: Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(value);
}

export function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "—";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
