import type { InformationRule, WeeklyOffLateRule, PenaltyRule, HalfDayRule, EarlyGoingRule, ExtendedDutyRule } from "@/types/attendanceRules";

/**
 * Shared short-label formatters for the 6 rule kinds that have no ruleName/ruleCode catalog
 * concept (Information, Weekly Off Late, Penalty, Half Day, Early Going, Extended Duty) — each
 * table can now hold multiple simultaneously-open "variant" rows per company (migration 0063),
 * so pickers/tables need a compact way to tell variants of the same rule kind apart. Used by both
 * RuleAssignmentDialog (picker options) and AttendanceRuleManagementPage (assignment table cells).
 */
export const shortRuleId = (id: string) => id.slice(0, 8);

export function informationRuleLabel(r: InformationRule) {
  return `${shortRuleId(r.id)} — Cutoff ${r.cutoffTime.slice(0, 5)}, Limit ${r.monthlyLimit}/mo${r.applicableOnWeeklyOff ? ", incl. Weekly Off" : ""}`;
}
export function weeklyOffLateRuleLabel(r: WeeklyOffLateRule) {
  return `${shortRuleId(r.id)} — Cutoff ${r.cutoffTime.slice(0, 5)}`;
}
export function penaltyRuleLabel(r: PenaltyRule) {
  const amount = r.method === "fixed" || r.method === "custom_fixed" ? `${r.fixedMinutes ?? 0} min` : r.multiplier ? `${r.multiplier}x` : r.method;
  return `${shortRuleId(r.id)} — ${r.method} (${amount}), ${r.applicability.replace(/_/g, " ")}`;
}
export function halfDayRuleLabel(r: HalfDayRule) {
  return `${shortRuleId(r.id)} — Late ≥ ${r.lateArrivalCutoffTime.slice(0, 5)}, Early ≤ ${r.earlyGoingCutoffTime.slice(0, 5)}`;
}
export function earlyGoingRuleLabel(r: EarlyGoingRule) {
  return `${shortRuleId(r.id)} — Grace ${r.graceMinutes} min`;
}
export function extendedDutyRuleLabel(r: ExtendedDutyRule) {
  return `${shortRuleId(r.id)} — Midnight cutoff ${r.midnightThresholdTime.slice(0, 5)}`;
}
