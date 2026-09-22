/**
 * Single shared source of truth for attendance time-of-day math (late/overtime/working minutes)
 * used by demo-data generation and attendance import. Real staff Punch In/Punch Out continues to
 * go through the database RPCs (`attendance_punch_in` / `attendance_punch_out`) — those are the
 * authoritative, transaction-safe calculation for live punches and are not duplicated here.
 *
 * IST (Asia/Kolkata, a fixed UTC+05:30 offset with no daylight-saving) is the application's
 * operating timezone — this HRMS targets Indian retail stores and there is no per-company
 * timezone configuration in the schema. All "local wall-clock minutes" values in this module
 * (shift start/end, punch in/out) are IST minutes-from-midnight; only `istWallClockToUtcIso`
 * crosses into actual UTC, and it does so using `Date.UTC` arithmetic only — never a locally
 * constructed `Date` — so it is correct regardless of the machine running the code.
 */

export const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * A Shift is scheduled timing + eligibility only — never a Late/Overtime calculation rule itself
 * (Shift/Late-Rule/Overtime-Rule separation). `graceMinutes` / `requiredWorkingMinutes` were
 * removed from this interface: Late is always punch-in minus startMinutes with no grace gate, and
 * Overtime (when enabled) is always punch-out minus endMinutes — mirroring the SQL engine's
 * calculate_extended_duty(), which has always been Shift-End-based, never Required-Working-Hours-
 * based. `breakMinutes` is kept: it still legitimately reduces Working Minutes, an independent
 * calculation from Late/Overtime.
 */
export interface ShiftWindow {
  startMinutes: number;
  endMinutes: number;
  /** Minutes deducted from raw elapsed time to get Working Minutes — independent of Late/Overtime. */
  breakMinutes: number;
  lateEligible: boolean;
  overtimeEnabled: boolean;
}

export interface AttendanceFacts {
  /** Punch Out - Punch In, before break deduction. Always populated for every day type. */
  totalWorkingMinutes: number;
  /** The break duration actually deducted. Always applied whenever both punches exist, for every
   *  day type (Normal, Weekly Off, Holiday, ...) — never skipped based on day type. */
  breakDeductionMinutes: number;
  /** Final Working = totalWorkingMinutes - breakDeductionMinutes (floored at 0). */
  workingMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

/** Parses a "HH:MM" or "HH:MM:SS" time-of-day string into minutes-from-midnight. */
export function parseTimeToMinutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Converts an IST wall-clock moment (calendar date + minutes-from-midnight, both local/IST) into
 * the correct UTC ISO timestamp for storage in a `timestamptz` column. Uses `Date.UTC` exclusively
 * so day-boundary rollovers (e.g. late-night IST punches) are handled correctly with no dependency
 * on the executing machine's timezone.
 */
export function istWallClockToUtcIso(dateKey: string, minutesFromMidnight: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcMinutes = minutesFromMidnight - IST_OFFSET_MINUTES;
  return new Date(Date.UTC(year, month - 1, day, 0, utcMinutes, 0, 0)).toISOString();
}

/**
 * The inverse of `istWallClockToUtcIso`: given a stored UTC timestamp, returns its IST time-of-day
 * as "HH:MM" (24-hour, zero-padded) — the shape a native `<input type="time">` expects. Used to
 * pre-fill the Super Admin Edit Attendance dialog from an existing record's punch_in_at/punch_out_at.
 */
export function utcIsoToIstHHMM(iso: string): string {
  const utcMinutesFromMidnight = (new Date(iso).getTime() / 60000) % 1440;
  const istMinutes = (((utcMinutesFromMidnight + IST_OFFSET_MINUTES) % 1440) + 1440) % 1440;
  const hours = Math.floor(istMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor(istMinutes % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Optional Weekly Off Late Rule context for computeAttendanceFacts()'s Weekly-Off handling
 *  (migration 0057 — independent of Information entirely). Omit when the caller has no rule data
 *  at hand (e.g. demo generation) — this correctly falls through to the plain Shift-Start formula,
 *  same as any day with no special rule configured. */
export interface WeeklyOffLateContext {
  weeklyOffLateRule?: PreviewWeeklyOffLateRule | null;
}

/**
 * Same math as the `attendance_punch_in`/`attendance_punch_out` RPCs (via
 * compute_late_and_penalty_facts / compute_extended_attendance_facts, migrations 0051-0056),
 * expressed for arbitrary employees (bulk/demo/import paths — used by attendanceAdminService's demo
 * generator and attendanceImportService's CSV/XLSX import; real live punches always go through the
 * SQL RPCs directly and never call this function). Delegates entirely to previewAttendanceFacts()
 * below — this is NOT a second formula, just a narrower, older-shaped return type for these two
 * simpler callers:
 *   totalWorkingMinutes   = max(0, punchOut - punchIn)                     [every day type]
 *   breakDeductionMinutes = shift.breakMinutes                             [ALWAYS applied whenever both punches exist — never skipped by day type]
 *   workingMinutes         = max(0, totalWorkingMinutes - breakDeductionMinutes)   [Final Working]
 *   lateMinutes            = punchIn - shiftStart (Normal/Case-2-Weekly-Off/no rule), OR the
 *                             Information/noon-cutoff outcome on Weekly Off when Information is
 *                             available (migration 0056) — always 0 on Holiday, no grace gate ever
 *   overtimeMinutes        = max(0, punchOut - shiftEnd)                   [0 if overtime disabled; day type never changes this formula]
 * `dayType` must be resolved the SAME way the SQL engine resolves it: 'holiday' only ever comes
 * from an explicit status (never auto-detected), and Weekly Off is always detected from the
 * employee's actual configured off day/overrides (see lib/weeklyOffResolver.ts's
 * isWeeklyOffOnDate, the exact TS mirror of the SQL is_weekly_off_on_date()) — never from a
 * manually-typed status string for Weekly Off specifically.
 */
export function computeAttendanceFacts(
  shift: ShiftWindow,
  punchInMinutes: number,
  punchOutMinutes: number,
  dayType: DayType = "normal",
  weeklyOffInfo?: WeeklyOffLateContext
): AttendanceFacts {
  const preview = previewAttendanceFacts({
    dayType,
    shift: { startMinutes: shift.startMinutes, endMinutes: shift.endMinutes, breakMinutes: shift.breakMinutes, lateEligible: shift.lateEligible, overtimeEnabled: shift.overtimeEnabled },
    punchInMinutes,
    punchOutMinutes,
    weeklyOffLateRule: weeklyOffInfo?.weeklyOffLateRule ?? null,
    // No explicit "use Information today" choice exists in this simpler path, and Weekly Off Late
    // is independent of Information entirely (migration 0057) — Information plays no role here.
    useInformationToday: false,
  });

  return {
    totalWorkingMinutes: preview.totalWorkingMinutes ?? 0,
    breakDeductionMinutes: preview.breakDeductionMinutes ?? 0,
    workingMinutes: preview.finalWorkingMinutes ?? 0,
    lateMinutes: preview.calculatedLateMinutes,
    overtimeMinutes: preview.calculatedOvertimeMinutes ?? 0,
  };
}

/**
 * Configurable Late Rule / Overtime Rule engine — the exact TypeScript mirror of the SQL functions
 * `apply_attendance_rounding` / `calculate_late_minutes` / `calculate_overtime_minutes` added in
 * migration 0039. Used by the Rule Test/Simulator dialog (so it runs the identical formula as real
 * attendance, per the "do not build a separate simulator formula" requirement) and anywhere else
 * that needs to preview a rule's effect without a round trip to the database. Real attendance
 * writes always go through the SQL functions directly — this is a read-only preview mirror, not a
 * second write path.
 */
export type RoundingMethod = "exact" | "round_down" | "round_up" | "nearest_5" | "nearest_10" | "nearest_15" | "nearest_30" | "custom";

export interface RuleThreshold {
  fromMinutes: number;
  toMinutes: number | null;
  calculatedMinutes: number;
}

export type DayType = "normal" | "weekly_off" | "holiday" | "leave";

export interface LateRuleConfig {
  calculationMethod: "exact" | "slab";
  roundingMethod: RoundingMethod;
  customRoundingMinutes: number | null;
  minimumLateMinutes: number;
  maximumLateMinutes: number | null;
  thresholds: RuleThreshold[];
}

export interface OvertimeRuleConfig {
  calculationMethod: "exact" | "slab";
  minimumOvertimeMinutes: number;
  maximumOvertimeMinutes: number | null;
  roundingMethod: RoundingMethod;
  customRoundingMinutes: number | null;
  weeklyOffOvertimeAllowed: boolean;
  holidayOvertimeAllowed: boolean;
  leaveOvertimeAllowed: boolean;
  thresholds: RuleThreshold[];
}

/** Mirrors SQL `apply_attendance_rounding` exactly — round_down/round_up/custom round to a
 *  multiple of customMinutes (falling back to 5 for round_down/round_up if unset); nearest_5/10/
 *  15/30 use their fixed unit. Matches the spec example: 17 actual minutes, unit 15 -> "Nearest 15"
 *  = 15, "Round Up" = 30. */
export function applyAttendanceRounding(minutes: number, method: RoundingMethod, customMinutes: number | null): number {
  let unit: number;
  switch (method) {
    case "exact":
      return minutes;
    case "round_down":
      unit = Math.max(1, customMinutes ?? 5);
      return Math.floor(minutes / unit) * unit;
    case "round_up":
      unit = Math.max(1, customMinutes ?? 5);
      return Math.ceil(minutes / unit) * unit;
    case "nearest_5":
      unit = 5;
      break;
    case "nearest_10":
      unit = 10;
      break;
    case "nearest_15":
      unit = 15;
      break;
    case "nearest_30":
      unit = 30;
      break;
    case "custom":
      unit = Math.max(1, customMinutes ?? 1);
      break;
    default:
      return minutes;
  }
  return Math.round(minutes / unit) * unit;
}

function matchThreshold(value: number, thresholds: RuleThreshold[]): number | null {
  const sorted = [...thresholds].sort((a, b) => b.fromMinutes - a.fromMinutes);
  const match = sorted.find((t) => t.fromMinutes <= value && (t.toMinutes == null || t.toMinutes >= value));
  return match ? match.calculatedMinutes : null;
}

/** Mirrors SQL `calculate_late_minutes` exactly (migration 0055). `rule: null` = no rule
 *  configured/assigned -> legacy behaviour (max(0, raw)), unchanged from before Rule Management
 *  existed. `minimumLateMinutes` is a THRESHOLD GATE, not a floor: at/under it, Late is 0; beyond
 *  it, the FULL raw value counts unreduced (never `Math.max(value, minimum)`, never
 *  `raw - minimum`). */
export function calculateLateMinutesWithRule(rawLateMinutes: number, rule: LateRuleConfig | null): number {
  if (!rule) return Math.max(0, rawLateMinutes);

  const raw = Math.max(0, rawLateMinutes);
  if (raw <= rule.minimumLateMinutes) return 0;

  let value = raw;
  if (rule.calculationMethod === "slab") {
    value = matchThreshold(value, rule.thresholds) ?? value;
  }

  value = applyAttendanceRounding(value, rule.roundingMethod, rule.customRoundingMinutes);
  if (rule.maximumLateMinutes != null) value = Math.min(value, rule.maximumLateMinutes);
  return Math.max(0, value);
}

/** Mirrors SQL `calculate_overtime_minutes` exactly. `rule: null` = legacy behaviour unchanged. */
export function calculateOvertimeMinutesWithRule(
  rawOvertimeMinutes: number,
  rule: OvertimeRuleConfig | null,
  dayType: DayType
): number {
  if (!rule) return Math.max(0, rawOvertimeMinutes);

  const allowed =
    dayType === "weekly_off" ? rule.weeklyOffOvertimeAllowed : dayType === "holiday" ? rule.holidayOvertimeAllowed : dayType === "leave" ? rule.leaveOvertimeAllowed : true;
  if (!allowed) return 0;

  let value = Math.max(0, rawOvertimeMinutes);
  if (rule.calculationMethod === "slab") {
    value = matchThreshold(value, rule.thresholds) ?? value;
  }

  if (value < rule.minimumOvertimeMinutes) return 0;

  value = applyAttendanceRounding(value, rule.roundingMethod, rule.customRoundingMinutes);
  if (rule.maximumOvertimeMinutes != null) value = Math.min(value, rule.maximumOvertimeMinutes);
  return Math.max(0, value);
}

export type PenaltyMethod = "none" | "actual" | "double" | "1.5x" | "2x" | "fixed" | "slab" | "custom_multiplier" | "custom_fixed";

export interface PenaltyRuleConfig {
  method: PenaltyMethod;
  fixedMinutes: number | null;
  multiplier: number | null;
  thresholds: RuleThreshold[];
}

/** Mirrors SQL `calculate_penalty_minutes` exactly. `rule: null` = 0 (no penalty concept existed
 *  before this feature — that is the true "nothing changes until configured" default). */
export function calculatePenaltyMinutesWithRule(actualLateMinutes: number, rule: PenaltyRuleConfig | null): number {
  if (actualLateMinutes <= 0) return 0;
  if (!rule) return 0;

  let value: number;
  switch (rule.method) {
    case "none":
      value = 0;
      break;
    case "actual":
      value = actualLateMinutes;
      break;
    case "double":
    case "2x":
      value = actualLateMinutes * 2;
      break;
    case "1.5x":
      value = Math.ceil(actualLateMinutes * 1.5);
      break;
    case "fixed":
    case "custom_fixed":
      value = rule.fixedMinutes ?? 0;
      break;
    case "custom_multiplier":
      value = Math.ceil(actualLateMinutes * (rule.multiplier ?? 1));
      break;
    case "slab":
      value = matchThreshold(actualLateMinutes, rule.thresholds) ?? actualLateMinutes;
      break;
    default:
      value = actualLateMinutes;
  }
  return Math.max(0, value);
}

export interface ExtendedDutyRuleConfig {
  midnightThresholdMinutes: number; // minutes-from-midnight, e.g. 0 for 00:00
  midnightExtraDutyValue: number;
  firstDaySalaryThresholdMinutes: number; // e.g. 120 for 02:00
  firstDayExtraDutyValue: number;
  secondDaySalaryThresholdMinutes: number; // e.g. 480 for 08:00
  secondDayExtraDutyValue: number;
  hourlyOtRoundingMethod: RoundingMethod;
  hourlyOtCustomRoundingMinutes: number | null;
}

export interface ExtendedDutyResult {
  normalOvertimeMinutes: number;
  extraDutyValue: number;
  nightOvertimeMinutes: number;
}

/**
 * Mirrors SQL `calculate_extended_duty` exactly (migration 0060 — TIME-BASED midnight cutoff,
 * supersedes 0059's unconditional zero). All inputs/outputs are expressed as "minutes since the
 * shift's own attendance-date midnight" (i.e. shiftEndMinutes and punchOutMinutes may both exceed
 * 1440 when punch-out crosses into the next calendar day — e.g. shift end 20:00 = 1200, punch-out
 * 00:30 the next day = 1440+30 = 1470). This already works for ANY shift because shiftEndMinutes
 * is a parameter — never hardcoded — and "midnight" (1440 + rule.midnightThresholdMinutes, almost
 * always exactly 1440) is always the next calendar midnight, completely independent of the shift's
 * own end time.
 *
 * Punch Out <  Midnight -> Normal OT = Punch Out − Shift End, normal, uncapped. Extra Duty = 0.
 * Punch Out >= Midnight -> Normal OT = 0. The Shift-End -> Midnight span folds into the Extra
 *                           Duty Value tier below (never re-counted as Normal OT); only time AFTER
 *                           midnight is eligible for the hourly Post-Midnight OT.
 * `rule === null` -> legacy, uncapped, Shift-End-based Normal OT, no Extended Duty — unchanged.
 */
export function calculateExtendedDuty(
  shiftEndMinutes: number,
  punchOutMinutes: number,
  rule: ExtendedDutyRuleConfig | null
): ExtendedDutyResult {
  if (!rule) {
    return { normalOvertimeMinutes: Math.max(0, punchOutMinutes - shiftEndMinutes), extraDutyValue: 0, nightOvertimeMinutes: 0 };
  }

  const midnightAt = 1440 + rule.midnightThresholdMinutes;
  const firstDayAt = 1440 + rule.firstDaySalaryThresholdMinutes;
  const secondDayAt = 1440 + rule.secondDaySalaryThresholdMinutes;

  let normalOvertimeMinutes: number;
  let extraDutyValue = 0;
  let nightOvertimeMinutes = 0;

  if (punchOutMinutes < midnightAt) {
    // BEFORE midnight: Normal OT works normally, no Extended Duty involvement at all.
    normalOvertimeMinutes = Math.max(0, punchOutMinutes - shiftEndMinutes);
  } else {
    // AT/AFTER midnight: Normal OT stops completely; Shift-End -> Midnight folds into Extra Duty
    // Value below (never Normal OT); only minutes AFTER midnight count as Post-Midnight OT.
    normalOvertimeMinutes = 0;

    if (punchOutMinutes < firstDayAt) {
      extraDutyValue = rule.midnightExtraDutyValue;
      nightOvertimeMinutes = Math.max(0, punchOutMinutes - midnightAt);
    } else if (punchOutMinutes < secondDayAt) {
      extraDutyValue = rule.firstDayExtraDutyValue;
      nightOvertimeMinutes = Math.max(0, punchOutMinutes - firstDayAt);
    } else {
      extraDutyValue = rule.secondDayExtraDutyValue;
      nightOvertimeMinutes = 0; // documented cap: no further hourly window defined past the second threshold
    }

    nightOvertimeMinutes = applyAttendanceRounding(nightOvertimeMinutes, rule.hourlyOtRoundingMethod, rule.hourlyOtCustomRoundingMinutes);
  }

  return { normalOvertimeMinutes, extraDutyValue, nightOvertimeMinutes };
}

// ===========================================================================
// Unified attendance preview engine — the SINGLE calculation used by every Test Rule simulator
// (Late, Overtime, Information, Penalty, Half Day, Early Going, Extended Duty). This is a
// line-for-line TypeScript port of the SQL engine's two functions
// (compute_late_and_penalty_facts + compute_extended_attendance_facts, migrations 0039-0054) —
// every branch, every override order, every zeroing rule is reproduced exactly, so no simulator
// can ever compute a different answer than a real punch would. Pure and read-only: never touches
// attendance_records, employee_information_usage, or any other table — callers pass in whatever
// rule configuration they want to preview (saved or still being edited) and get back a complete
// breakdown to render.
// ===========================================================================

export type PenaltyApplicability =
  | "every_late"
  | "after_information_exhausted"
  | "normal_day_only"
  | "information_day_after_cutoff"
  | "weekly_off"
  | "half_day"
  | "other";

export interface PreviewShift {
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  lateEligible: boolean;
  overtimeEnabled: boolean;
}

export interface PreviewInformationRule {
  monthlyLimit: number;
  cutoffMinutes: number;
  applicableOnWeeklyOff: boolean;
}

/** Weekly Off Late Rule — independent of Information (this phase). Punch In <= cutoffMinutes -> 0;
 *  Punch In > cutoffMinutes -> Punch In - cutoffMinutes, in full. Nothing else. */
export interface PreviewWeeklyOffLateRule {
  cutoffMinutes: number;
}

export interface PreviewHalfDayRule {
  lateArrivalCutoffMinutes: number;
  earlyGoingCutoffMinutes: number;
}

export interface PreviewEarlyGoingRule {
  graceMinutes: number;
  calculationMethod: "exact" | "slab";
  roundingMethod: RoundingMethod;
  customRoundingMinutes: number | null;
  thresholds: RuleThreshold[];
}

export interface PreviewPenaltyRule extends PenaltyRuleConfig {
  applicability: PenaltyApplicability;
  /** Independent Penalty applicability switches (migration 0058) — take priority over
   *  `applicability` for Weekly Off / explicit Information Used Day respectively. Half Day always
   *  overrides both (Penalty never applies there, not configurable). */
  applyOnWeeklyOff: boolean;
  applyOnInformationDay: boolean;
}

export interface AttendancePreviewInput {
  dayType: DayType;
  shift: PreviewShift;
  /** Minutes-from-midnight, or null if the employee hasn't punched in (e.g. a Leave preview). */
  punchInMinutes: number | null;
  /** Minutes-from-midnight, or null if the employee hasn't punched out yet. */
  punchOutMinutes: number | null;

  informationRule?: PreviewInformationRule | null;
  useInformationToday?: boolean;
  /** How many Information days this employee has already used this month, BEFORE today. */
  informationUsedThisMonth?: number;

  /** Weekly Off Late Rule (independent of Information, this phase). null/undefined -> Weekly Off
   *  falls back to the plain Shift-Start formula, same as any day with no special rule. */
  weeklyOffLateRule?: PreviewWeeklyOffLateRule | null;

  halfDayRule?: PreviewHalfDayRule | null;
  /** TEST-RULE-ONLY escape hatch: when true, treat this day as Half Day (Late Arrival) for
   *  Penalty-exclusion purposes even if Punch In did not actually cross halfDayRule's cutoff (or
   *  no halfDayRule is configured at all). Actual Late is NEVER altered by this flag — it is only
   *  recomputed from the Half Day cutoff when Punch In genuinely crosses it, exactly as real
   *  attendance does; otherwise Actual Late stays whatever the normal Shift Start / Weekly Off /
   *  Information cutoff branch already produced ("calculated normally"). Real attendance writes
   *  (computeAttendanceFacts, real punches) NEVER set this — it exists solely so the Test Penalty
   *  Rule simulator can deterministically exercise "what if this record IS Half Day" without
   *  depending on whether a real Half Day Rule happens to be configured/matched. */
  forceHalfDayLateArrival?: boolean;
  earlyGoingRule?: PreviewEarlyGoingRule | null;

  lateRule?: LateRuleConfig | null;
  overtimeRule?: OvertimeRuleConfig | null;
  penaltyRule?: PreviewPenaltyRule | null;
  extendedDutyRule?: ExtendedDutyRuleConfig | null;
}

export interface AttendancePreviewResult {
  isWeeklyOff: boolean;

  // Information / noon-rule
  usesNoonRule: boolean;
  noonRuleCutoffMinutes: number | null;
  informationExhausted: boolean;
  usedInformationToday: boolean;
  informationRemainingAfter: number | null;

  // Late
  lateBaseMinutes: number | null;
  lateBaseLabel: string;
  rawLateMinutes: number;
  calculatedLateMinutes: number;
  lateZeroedReason: string | null;

  // Half Day
  halfDayLateComing: boolean;
  halfDayEarlyGoing: boolean;
  isHalfDay: boolean;
  status: "present" | "half_day";

  // Penalty
  penaltyApplicable: boolean;
  penaltyReason: string;
  calculatedPenaltyMinutes: number;

  // Working / Break
  totalWorkingMinutes: number | null;
  breakDeductionMinutes: number | null;
  finalWorkingMinutes: number | null;

  // Early Going
  rawEarlyGoingMinutes: number | null;
  earlyGoingGraceApplied: boolean;
  calculatedEarlyGoingMinutes: number | null;

  // Overtime
  rawOvertimeMinutes: number | null;
  calculatedOvertimeMinutes: number | null;
  overtimeAllowed: boolean;
  overtimeDisallowedReason: string | null;

  // Extended Duty
  extendedDuty: ExtendedDutyResult | null;
}

/** Mirrors compute_late_and_penalty_facts()'s penalty-applicability block exactly (migration 0058)
 *  — the single source of truth for whether Penalty applies on a given day. Day-Type priority gate
 *  runs FIRST, before the `applicability` switch:
 *    1. Half Day (Late Arrival) -> Penalty NEVER applies. Not configurable, no exceptions.
 *    2. Weekly Off              -> dayTypeToggles.applyOnWeeklyOff alone decides.
 *    3. Information Used Day (explicit use only) -> dayTypeToggles.applyOnInformationDay alone
 *       decides.
 *    4. Otherwise (plain Normal Day) -> the `applicability` switch below, byte-for-byte unchanged
 *       from before migration 0058 ("do not change existing Normal Day Penalty logic"). */
export function resolvePenaltyApplicability(
  applicability: PenaltyApplicability,
  context: { usesNoonRule: boolean; isWeeklyOff: boolean; halfDayLateComing: boolean },
  dayTypeToggles: { applyOnWeeklyOff: boolean; applyOnInformationDay: boolean }
): boolean {
  if (context.halfDayLateComing) return false;
  if (context.isWeeklyOff) return dayTypeToggles.applyOnWeeklyOff;
  if (context.usesNoonRule) return dayTypeToggles.applyOnInformationDay;

  switch (applicability) {
    case "every_late":
      return true;
    case "after_information_exhausted":
      return !context.usesNoonRule;
    case "normal_day_only":
      return !context.usesNoonRule && !context.isWeeklyOff;
    case "information_day_after_cutoff":
      return context.usesNoonRule;
    case "weekly_off":
      return context.isWeeklyOff;
    case "half_day":
      return context.halfDayLateComing;
    default:
      return true;
  }
}

export const PENALTY_APPLICABILITY_LABELS: Record<PenaltyApplicability, string> = {
  every_late: "Every Late",
  after_information_exhausted: "After Information Exhausted (Normal Day)",
  normal_day_only: "Normal Working Day Only",
  information_day_after_cutoff: "Information Day, After Cutoff",
  weekly_off: "Weekly Off",
  half_day: "Half Day",
  other: "Other / Unconditional",
};

/**
 * Runs the full attendance calculation for one synthetic day, exactly mirroring
 * compute_late_and_penalty_facts() + compute_extended_attendance_facts() branch-for-branch. Never
 * reads or writes any table — every rule/usage figure is supplied by the caller.
 */
export function previewAttendanceFacts(input: AttendancePreviewInput): AttendancePreviewResult {
  const { dayType, shift, punchInMinutes, punchOutMinutes } = input;
  const isWeeklyOff = dayType === "weekly_off";

  const result: AttendancePreviewResult = {
    isWeeklyOff,
    usesNoonRule: false,
    noonRuleCutoffMinutes: null,
    informationExhausted: false,
    usedInformationToday: false,
    informationRemainingAfter: input.informationRule ? Math.max(0, input.informationRule.monthlyLimit - (input.informationUsedThisMonth ?? 0)) : null,
    lateBaseMinutes: null,
    lateBaseLabel: "",
    rawLateMinutes: 0,
    calculatedLateMinutes: 0,
    lateZeroedReason: null,
    halfDayLateComing: false,
    halfDayEarlyGoing: false,
    isHalfDay: false,
    status: "present",
    penaltyApplicable: false,
    penaltyReason: "No Penalty Rule configured.",
    calculatedPenaltyMinutes: 0,
    totalWorkingMinutes: null,
    breakDeductionMinutes: null,
    finalWorkingMinutes: null,
    rawEarlyGoingMinutes: null,
    earlyGoingGraceApplied: false,
    calculatedEarlyGoingMinutes: null,
    rawOvertimeMinutes: null,
    calculatedOvertimeMinutes: null,
    overtimeAllowed: true,
    overtimeDisallowedReason: null,
    extendedDuty: null,
  };

  if (punchInMinutes === null) {
    // Leave / no punch at all — every SQL output stays at its initialized default (0/false/null),
    // exactly matching a real Leave day with no punch_in_at.
    return result;
  }

  // ---------------------------------------------------------------------
  // Information / noon-rule — ORDINARY Information Day only (migration 0057). Weekly Off no longer
  // has any automatic Information-availability gate; see the Weekly Off Late Rule block below,
  // which is now completely independent of this section. Nothing in this block changed from before
  // migration 0056 introduced the (now-removed) automatic Weekly-Off coverage.
  // ---------------------------------------------------------------------
  const infoRule = input.informationRule ?? null;
  const infoUsedSoFar = input.informationUsedThisMonth ?? 0;
  if (infoRule) {
    result.informationExhausted = infoUsedSoFar >= infoRule.monthlyLimit;
    if (input.useInformationToday) {
      if (result.informationExhausted) {
        // Mirrors the SQL RAISE EXCEPTION — the real RPC would reject the punch entirely.
        result.usedInformationToday = false;
      } else {
        result.usedInformationToday = true;
        result.informationRemainingAfter = Math.max(0, infoRule.monthlyLimit - infoUsedSoFar - 1);
      }
    }
  }

  // CHANGED (migration 0057): usesNoonRule now reflects ONLY an explicit Information Day use —
  // Weekly Off never sets this anymore.
  result.usesNoonRule = Boolean(infoRule) && result.usedInformationToday;

  let rawLate: number;
  const weeklyOffLateRule = input.weeklyOffLateRule ?? null;
  if (isWeeklyOff && weeklyOffLateRule) {
    // Weekly Off Late Rule (migration 0057) — independent of Information entirely. Punch In <=
    // cutoff -> 0. Punch In > cutoff -> Punch In - cutoff, in full. Nothing is ever consumed here.
    result.lateBaseMinutes = weeklyOffLateRule.cutoffMinutes;
    result.lateBaseLabel = "Weekly Off Cutoff";
    rawLate = punchInMinutes <= weeklyOffLateRule.cutoffMinutes ? 0 : punchInMinutes - weeklyOffLateRule.cutoffMinutes;
  } else if (result.usesNoonRule && infoRule) {
    result.noonRuleCutoffMinutes = infoRule.cutoffMinutes;
    result.lateBaseMinutes = infoRule.cutoffMinutes;
    result.lateBaseLabel = "Information noon cutoff";
    rawLate = punchInMinutes <= infoRule.cutoffMinutes ? 0 : punchInMinutes - infoRule.cutoffMinutes;
  } else {
    // Normal day (or Weekly Off with no Weekly Off Late Rule configured) — Shift-Start based, full.
    result.lateBaseMinutes = shift.startMinutes;
    result.lateBaseLabel = "Shift Start";
    rawLate = Math.max(0, punchInMinutes - shift.startMinutes);
  }
  let rawLateForDisplay = rawLate;

  // ---------------------------------------------------------------------
  // Half Day — Late Arrival (overrides rawLate exactly like the SQL does; this comparison is the
  // REAL production derivation and is completely unchanged).
  // ---------------------------------------------------------------------
  const halfDayRule = input.halfDayRule ?? null;
  if (halfDayRule && punchInMinutes >= halfDayRule.lateArrivalCutoffMinutes) {
    result.halfDayLateComing = true;
    result.lateBaseMinutes = halfDayRule.lateArrivalCutoffMinutes;
    result.lateBaseLabel = "Half Day Late Arrival Cutoff";
    rawLate = Math.max(0, punchInMinutes - halfDayRule.lateArrivalCutoffMinutes);
    rawLateForDisplay = rawLate;
  } else if (input.forceHalfDayLateArrival) {
    // TEST-RULE-ONLY: mark as Half Day (for Penalty-exclusion purposes) without altering the
    // already-computed Actual Late — "Actual Late = calculated normally" per the Test Rule spec.
    result.halfDayLateComing = true;
  }
  result.rawLateMinutes = rawLateForDisplay;

  result.calculatedLateMinutes = calculateLateMinutesWithRule(rawLate, input.lateRule ?? null);

  // ---------------------------------------------------------------------
  // Penalty (derived from calculatedLateMinutes, always stored separately)
  // ---------------------------------------------------------------------
  const penaltyRule = input.penaltyRule ?? null;
  if (penaltyRule && result.calculatedLateMinutes > 0) {
    result.penaltyApplicable = resolvePenaltyApplicability(
      penaltyRule.applicability,
      { usesNoonRule: result.usesNoonRule, isWeeklyOff, halfDayLateComing: result.halfDayLateComing },
      { applyOnWeeklyOff: penaltyRule.applyOnWeeklyOff, applyOnInformationDay: penaltyRule.applyOnInformationDay }
    );
    // Day-Type priority reason first (matches the SQL's own priority order); falls through to the
    // existing applicability-label message only for the plain Normal Day case.
    if (result.halfDayLateComing) {
      result.penaltyReason = "Half Day (Late Arrival): Penalty is never applicable by company policy, regardless of Penalty Rule settings.";
    } else if (isWeeklyOff) {
      result.penaltyReason = result.penaltyApplicable
        ? "Applicable — Apply Penalty on Weekly Off = Yes."
        : "Not applicable — Apply Penalty on Weekly Off = No. (Late itself is unaffected.)";
    } else if (result.usesNoonRule) {
      result.penaltyReason = result.penaltyApplicable
        ? "Applicable — Apply Penalty on Information Used Day = Yes."
        : "Not applicable — Apply Penalty on Information Used Day = No. (Late itself is unaffected.)";
    } else {
      result.penaltyReason = result.penaltyApplicable
        ? `Applicable — condition "${PENALTY_APPLICABILITY_LABELS[penaltyRule.applicability]}" is met.`
        : `Not applicable — condition "${PENALTY_APPLICABILITY_LABELS[penaltyRule.applicability]}" is not met for this day.`;
    }
    if (result.penaltyApplicable) {
      result.calculatedPenaltyMinutes = calculatePenaltyMinutesWithRule(result.calculatedLateMinutes, penaltyRule);
    }
  } else if (!penaltyRule) {
    result.penaltyReason = "No Penalty Rule configured — Penalty is 0.";
  } else {
    result.penaltyReason = "Calculated Late is 0 — no lateness for Penalty to apply to.";
  }

  // ---------------------------------------------------------------------
  // Late Eligible / Holiday zero-out (mirrors the final gate in the SQL, migration 0056). Weekly
  // Off is INTENTIONALLY no longer in this list — its Late is now entirely determined by the
  // Case 1 (noon cutoff, Information available) / Case 2 (Shift Start, Information exhausted)
  // logic above, which may legitimately produce a nonzero Final Late.
  // ---------------------------------------------------------------------
  if (!shift.lateEligible) {
    result.calculatedLateMinutes = 0;
    result.halfDayLateComing = false;
    result.calculatedPenaltyMinutes = 0;
    result.penaltyApplicable = false;
    result.penaltyReason = "Late Eligible = No — nothing for Penalty to apply to.";
    result.lateZeroedReason = "This shift has Late Eligible = No.";
  } else if (dayType === "holiday") {
    result.calculatedLateMinutes = 0;
    result.halfDayLateComing = false;
    result.calculatedPenaltyMinutes = 0;
    result.penaltyApplicable = false;
    result.penaltyReason = "Late is always 0 on Holiday — nothing for Penalty to apply to.";
    result.lateZeroedReason = "Late is always 0 on Holiday.";
  }

  result.status = result.halfDayLateComing ? "half_day" : "present";

  if (punchOutMinutes === null) {
    // Still working / not punched out — Working/Overtime/Early Going/Extended Duty are all "not
    // yet known" (null), exactly like a real in-progress attendance_records row.
    return result;
  }

  // ---------------------------------------------------------------------
  // Half Day — Early Going (independent of Late Arrival; can also set half_day_reason)
  // ---------------------------------------------------------------------
  let isHalfDayEarly = false;
  if (halfDayRule && punchOutMinutes <= halfDayRule.earlyGoingCutoffMinutes) {
    isHalfDayEarly = true;
    result.halfDayEarlyGoing = true;
    result.status = "half_day";
  }
  result.isHalfDay = result.status === "half_day";

  // ---------------------------------------------------------------------
  // Total Working / Break Deduction / Final Working — ALWAYS computed the same way, every day type
  // ---------------------------------------------------------------------
  result.totalWorkingMinutes = Math.max(0, punchOutMinutes - punchInMinutes);
  result.breakDeductionMinutes = shift.breakMinutes;
  result.finalWorkingMinutes = Math.max(0, result.totalWorkingMinutes - result.breakDeductionMinutes);

  // ---------------------------------------------------------------------
  // Early Going Rule
  // ---------------------------------------------------------------------
  const earlyGoingRule = input.earlyGoingRule ?? null;
  if (earlyGoingRule) {
    let rawEarlyGoing: number;
    if (isHalfDayEarly && halfDayRule) {
      rawEarlyGoing = Math.max(0, halfDayRule.earlyGoingCutoffMinutes - punchOutMinutes);
    } else if (punchOutMinutes < shift.endMinutes) {
      const elapsed = shift.endMinutes - punchOutMinutes;
      rawEarlyGoing = elapsed;
      // Grace is a THRESHOLD only, never subtracted — punch-out landing EXACTLY on the grace
      // boundary (elapsed === grace) must also zero out (was `<`, now `<=`), matching the SQL
      // engine's compute_extended_attendance_facts() (migration 0065).
      if (elapsed <= earlyGoingRule.graceMinutes) {
        rawEarlyGoing = 0;
        result.earlyGoingGraceApplied = true;
      }
    } else {
      rawEarlyGoing = 0;
    }
    result.rawEarlyGoingMinutes = rawEarlyGoing;

    let calculated: number;
    if (earlyGoingRule.calculationMethod === "slab") {
      calculated = matchThreshold(rawEarlyGoing, earlyGoingRule.thresholds) ?? rawEarlyGoing;
    } else {
      calculated = rawEarlyGoing;
    }
    result.calculatedEarlyGoingMinutes = applyAttendanceRounding(calculated, earlyGoingRule.roundingMethod, earlyGoingRule.customRoundingMinutes);
  }

  // ---------------------------------------------------------------------
  // Extended Duty (Normal OT capped at midnight + hourly ladder beyond it)
  // ---------------------------------------------------------------------
  const ext = calculateExtendedDuty(shift.endMinutes, punchOutMinutes, input.extendedDutyRule ?? null);
  result.extendedDuty = ext;

  // ---------------------------------------------------------------------
  // Overtime — always Shift-End-based, never Working/Break/Late-derived
  // ---------------------------------------------------------------------
  if (shift.overtimeEnabled) {
    result.rawOvertimeMinutes = ext.normalOvertimeMinutes;
    if (input.overtimeRule) {
      result.overtimeAllowed =
        dayType === "weekly_off"
          ? input.overtimeRule.weeklyOffOvertimeAllowed
          : dayType === "holiday"
          ? input.overtimeRule.holidayOvertimeAllowed
          : dayType === "leave"
          ? input.overtimeRule.leaveOvertimeAllowed
          : true;
      if (!result.overtimeAllowed) {
        result.overtimeDisallowedReason = `The Overtime Rule does not allow Overtime on ${dayType === "weekly_off" ? "Weekly Off" : dayType === "holiday" ? "Holiday" : "Leave"}.`;
      }
    }
    result.calculatedOvertimeMinutes = calculateOvertimeMinutesWithRule(ext.normalOvertimeMinutes, input.overtimeRule ?? null, dayType);
  } else {
    result.rawOvertimeMinutes = 0;
    result.calculatedOvertimeMinutes = 0;
    result.overtimeAllowed = false;
    result.overtimeDisallowedReason = "Overtime Eligible = No on this shift.";
    result.extendedDuty = { normalOvertimeMinutes: 0, extraDutyValue: 0, nightOvertimeMinutes: 0 };
  }

  return result;
}
