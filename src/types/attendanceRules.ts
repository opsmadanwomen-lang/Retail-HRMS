import type { RoundingMethod } from "@/lib/attendanceCalculation";

export type RuleCalculationMethod = "exact" | "slab";
export type RuleScopeType = "employee" | "shift" | "store" | "company" | "store_employee";

export interface RuleThresholdRecord {
  id: string;
  fromMinutes: number;
  toMinutes: number | null;
  calculatedMinutes: number;
  sortOrder: number;
}

export interface LateRule {
  id: string;
  companyId: string;
  ruleCode: string;
  ruleName: string;
  description: string | null;
  calculationMethod: RuleCalculationMethod;
  roundingMethod: RoundingMethod;
  customRoundingMinutes: number | null;
  minimumLateMinutes: number;
  maximumLateMinutes: number | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OvertimeRule {
  id: string;
  companyId: string;
  ruleCode: string;
  ruleName: string;
  description: string | null;
  calculationMethod: RuleCalculationMethod;
  minimumOvertimeMinutes: number;
  maximumOvertimeMinutes: number | null;
  roundingMethod: RoundingMethod;
  customRoundingMinutes: number | null;
  weeklyOffOvertimeAllowed: boolean;
  holidayOvertimeAllowed: boolean;
  leaveOvertimeAllowed: boolean;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleAssignment {
  id: string;
  companyId: string;
  scopeType: RuleScopeType;
  scopeId: string | null;
  scopeLabel?: string | null;
  /** Only meaningful when scopeType === "store_employee". NULL = All Stores. */
  storeId: string | null;
  /** Only meaningful when scopeType === "store_employee". NULL = All Employees. */
  employeeId: string | null;
  lateRuleId: string | null;
  overtimeRuleId: string | null;
  /** Migration 0063 — independently assignable alongside Late/Overtime. */
  informationRuleId: string | null;
  weeklyOffLateRuleId: string | null;
  penaltyRuleId: string | null;
  halfDayRuleId: string | null;
  earlyGoingRuleId: string | null;
  extendedDutyRuleId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  remark: string | null;
  createdAt: string;
}

export interface LateRuleFormValues {
  ruleName: string;
  ruleCode: string;
  description: string;
  calculationMethod: RuleCalculationMethod;
  roundingMethod: RoundingMethod;
  customRoundingMinutes: number | null;
  minimumLateMinutes: number;
  maximumLateMinutes: number | null;
  isActive: boolean;
  remark: string;
  thresholds: { fromMinutes: number; toMinutes: number | null; calculatedMinutes: number }[];
}

export interface OvertimeRuleFormValues {
  ruleName: string;
  ruleCode: string;
  description: string;
  calculationMethod: RuleCalculationMethod;
  minimumOvertimeMinutes: number;
  maximumOvertimeMinutes: number | null;
  roundingMethod: RoundingMethod;
  customRoundingMinutes: number | null;
  weeklyOffOvertimeAllowed: boolean;
  holidayOvertimeAllowed: boolean;
  leaveOvertimeAllowed: boolean;
  isActive: boolean;
  remark: string;
  thresholds: { fromMinutes: number; toMinutes: number | null; calculatedMinutes: number }[];
}

// ---------------------------------------------------------------------------
// Company-wide versioned rules (no Employee>Shift>Store>Company assignment
// hierarchy — one active configuration per company at a time, versioned via
// the same close-old-open-new pattern as Late/Overtime Rules).
// ---------------------------------------------------------------------------

export interface InformationRule {
  id: string;
  companyId: string;
  monthlyLimit: number;
  cutoffTime: string; // "HH:MM:SS"
  applicableOnWeeklyOff: boolean;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
}

/** Weekly Off Late Rule — deliberately independent storage from InformationRule (own table).
 *  Phase: unconditional cutoff only (punch <= cutoff -> 0, else punch - cutoff), no Information
 *  dependency. The Weekly-Off + Information interaction is a planned future phase, not this one. */
export interface WeeklyOffLateRule {
  id: string;
  companyId: string;
  cutoffTime: string; // "HH:MM:SS"
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
}

export type PenaltyApplicability =
  | "every_late"
  | "after_information_exhausted"
  | "normal_day_only"
  | "information_day_after_cutoff"
  | "weekly_off"
  | "half_day"
  | "other";

export interface PenaltyRule {
  id: string;
  companyId: string;
  method: import("@/lib/attendanceCalculation").PenaltyMethod;
  fixedMinutes: number | null;
  multiplier: number | null;
  applicability: PenaltyApplicability;
  /** Independent Penalty applicability switch for Weekly Off lateness (migration 0058). Never
   *  affects Weekly Off Late calculation — Late is always computed regardless of this setting. */
  applyOnWeeklyOff: boolean;
  /** Independent Penalty applicability switch for explicit Information Used Day lateness
   *  (migration 0058). Never affects Late calculation. */
  applyOnInformationDay: boolean;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
}

export interface HalfDayRule {
  id: string;
  companyId: string;
  lateArrivalCutoffTime: string;
  earlyGoingCutoffTime: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
}

export interface EarlyGoingRule {
  id: string;
  companyId: string;
  graceMinutes: number;
  calculationMethod: RuleCalculationMethod;
  roundingMethod: RoundingMethod;
  customRoundingMinutes: number | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
}

export interface ExtendedDutyRule {
  id: string;
  companyId: string;
  midnightThresholdTime: string;
  midnightExtraDutyValue: number;
  firstDaySalaryThresholdTime: string;
  firstDayExtraDutyValue: number;
  secondDaySalaryThresholdTime: string;
  secondDayExtraDutyValue: number;
  /** End of the second (08:00-onward) Night OT window — migration 0080. Read-only display field;
   *  not yet exposed on a Super Admin edit form, but already the live, authoritative value the
   *  backend's calculate_extended_duty() uses to cap Night OT. */
  thirdDaySalaryThresholdTime: string;
  hourlyOtRoundingMethod: RoundingMethod;
  hourlyOtCustomRoundingMinutes: number | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
}

export interface NightDutyApprovalConfig {
  id: string;
  companyId: string;
  approvalRequired: boolean;
  allowPayableOutOverride: boolean;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
}

export interface InformationUsageRecord {
  id: string;
  employeeId: string;
  attendanceDate: string;
  usedBy: string | null;
  remark: string | null;
  createdAt: string;
}

/**
 * State machine: pending_om -> (om_approved | om_disallowed | pending_super_manager) ->
 * (super_manager_approved | super_manager_disallowed). The legacy 'pending'/'approved'/
 * 'disallowed' values are kept in the DB CHECK constraint only so the pre-existing Super-Admin
 * emergency-access RPC (attendance_night_duty_decide, migration 0045) still functions — the normal
 * UI never produces those values anymore.
 */
export type NightDutyApprovalStatus =
  | "pending"
  | "approved"
  | "disallowed"
  | "pending_om"
  | "om_approved"
  | "om_disallowed"
  | "pending_super_manager"
  | "super_manager_approved"
  | "super_manager_disallowed";

export type NightDutyOmAction = "approved" | "disallowed" | "carried_forward";
export type NightDutySuperManagerAction = "approved" | "disallowed";

// One of the logged-in employee's OWN Night Duty requests + its terminal-decision summary
// (attendance_night_duty_list_mine()). Strictly scoped to current_user_employee_id() server-side.
// Reads only the existing attendance_night_duty_approvals row + live attendance_records figures —
// no new calculation, no workflow change.
export interface MyNightDutyRow {
  id: string;
  employeeId: string;
  employeeName: string;
  attendanceRecordId: string;
  attendanceDate: string;
  punchInAt: string | null;
  actualPunchOutAt: string;
  extraDutyValue: number;
  nightOtMinutes: number;
  payableExtraDutyValue: number | null;
  payableOvertimeMinutes: number | null;
  approvalStatus: NightDutyApprovalStatus;
  omId: string | null;
  omName: string | null;
  omAction: NightDutyOmAction | null;
  omActedAt: string | null;
  omRemark: string | null;
  superManagerId: string | null;
  superManagerName: string | null;
  superManagerAction: NightDutySuperManagerAction | null;
  superManagerActedAt: string | null;
  superManagerRemark: string | null;
  managerConfirmedPayableOutAt: string | null;
  managerRemark: string | null;
  createdAt: string;
  decidedStage: string | null; // "Operations Manager" | "Super Manager" | "Administrator" | null
  decidedByName: string | null;
  decidedAction: "approved" | "disallowed" | null;
  decidedAt: string | null;
  decidedRemark: string | null;
}

export interface NightDutyApproval {
  id: string;
  companyId: string;
  employeeId: string;
  attendanceRecordId: string;
  attendanceDate: string;
  shiftEndAt: string | null;
  punchInAt?: string | null;
  actualPunchOutAt: string;
  extraDutyValue: number;
  nightOtMinutes: number;
  approvalStatus: NightDutyApprovalStatus;
  storeId: string | null;
  omId: string | null;
  omAction: NightDutyOmAction | null;
  omActedAt: string | null;
  omRemark: string | null;
  superManagerId: string | null;
  superManagerAction: NightDutySuperManagerAction | null;
  superManagerActedAt: string | null;
  superManagerRemark: string | null;
  managerConfirmedPayableOutAt: string | null;
  managerRemark: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  // Joined for display
  employeeName?: string;
  employeeCode?: string | null;
  storeName?: string | null;
  omName?: string | null;
  superManagerName?: string | null;
}

export interface OperationsManagerAssignment {
  id: string;
  companyId: string;
  employeeId: string;
  storeId: string;
  isActive: boolean;
  remark: string | null;
  createdAt: string;
  // Joined for display
  employeeName?: string;
  employeeCode?: string | null;
  storeName?: string | null;
}

export interface SuperManagerDesignation {
  id: string;
  companyId: string;
  employeeId: string;
  isActive: boolean;
  remark: string | null;
  createdAt: string;
  // Joined for display
  employeeName?: string;
  employeeCode?: string | null;
}
