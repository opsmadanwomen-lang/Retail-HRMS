import { supabase } from "@/lib/supabaseClient";
import { employeeService } from "@/services/employeeService";
import type {
  EarlyGoingRule,
  ExtendedDutyRule,
  HalfDayRule,
  InformationRule,
  InformationUsageRecord,
  NightDutyApproval,
  NightDutyApprovalConfig,
  MyNightDutyRow,
  OperationsManagerAssignment,
  PenaltyApplicability,
  PenaltyRule,
  SuperManagerDesignation,
  WeeklyOffLateRule,
} from "@/types/attendanceRules";
import type { PenaltyMethod, RoundingMethod } from "@/lib/attendanceCalculation";

const INFORMATION_RULES = "attendance_information_rules";
const WEEKLY_OFF_LATE_RULES = "attendance_weekly_off_late_rules";
const PENALTY_RULES = "attendance_penalty_rules";
const PENALTY_THRESHOLDS = "attendance_penalty_rule_thresholds";
const HALF_DAY_RULES = "attendance_half_day_rules";
const EARLY_GOING_RULES = "attendance_early_going_rules";
const EARLY_GOING_THRESHOLDS = "attendance_early_going_rule_thresholds";
const EXTENDED_DUTY_RULES = "attendance_extended_duty_rules";
const NIGHT_DUTY_CONFIG = "attendance_night_duty_approval_config";
const INFORMATION_USAGE = "employee_information_usage";
const NIGHT_DUTY_APPROVALS = "attendance_night_duty_approvals";
const OM_ASSIGNMENTS = "attendance_operations_manager_assignments";
const SUPER_MANAGERS = "attendance_super_managers";
const STORES = "stores";

function dayBefore(dateKey: string): string {
  const d = new Date(dateKey);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function mapInformationRule(row: any): InformationRule {
  return {
    id: row.id,
    companyId: row.company_id,
    monthlyLimit: row.monthly_limit,
    cutoffTime: row.cutoff_time,
    applicableOnWeeklyOff: row.applicable_on_weekly_off,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
  };
}

function mapWeeklyOffLateRule(row: any): WeeklyOffLateRule {
  return {
    id: row.id,
    companyId: row.company_id,
    cutoffTime: row.cutoff_time,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
  };
}

function mapPenaltyRule(row: any): PenaltyRule {
  return {
    id: row.id,
    companyId: row.company_id,
    method: row.method,
    fixedMinutes: row.fixed_minutes,
    multiplier: row.multiplier,
    applicability: row.applicability,
    applyOnWeeklyOff: row.apply_on_weekly_off,
    applyOnInformationDay: row.apply_on_information_day,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
  };
}

function mapHalfDayRule(row: any): HalfDayRule {
  return {
    id: row.id,
    companyId: row.company_id,
    lateArrivalCutoffTime: row.late_arrival_cutoff_time,
    earlyGoingCutoffTime: row.early_going_cutoff_time,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
  };
}

function mapEarlyGoingRule(row: any): EarlyGoingRule {
  return {
    id: row.id,
    companyId: row.company_id,
    graceMinutes: row.grace_minutes,
    calculationMethod: row.calculation_method,
    roundingMethod: row.rounding_method,
    customRoundingMinutes: row.custom_rounding_minutes,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
  };
}

function mapExtendedDutyRule(row: any): ExtendedDutyRule {
  return {
    id: row.id,
    companyId: row.company_id,
    midnightThresholdTime: row.midnight_threshold_time,
    midnightExtraDutyValue: row.midnight_extra_duty_value,
    firstDaySalaryThresholdTime: row.first_day_salary_threshold_time,
    firstDayExtraDutyValue: row.first_day_extra_duty_value,
    secondDaySalaryThresholdTime: row.second_day_salary_threshold_time,
    secondDayExtraDutyValue: row.second_day_extra_duty_value,
    thirdDaySalaryThresholdTime: row.third_day_salary_threshold_time,
    hourlyOtRoundingMethod: row.hourly_ot_rounding_method,
    hourlyOtCustomRoundingMinutes: row.hourly_ot_custom_rounding_minutes,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
  };
}

function mapNightDutyConfig(row: any): NightDutyApprovalConfig {
  return {
    id: row.id,
    companyId: row.company_id,
    approvalRequired: row.approval_required,
    allowPayableOutOverride: row.allow_payable_out_override,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
  };
}

function mapNightDutyApproval(row: any): NightDutyApproval {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    attendanceRecordId: row.attendance_record_id,
    attendanceDate: row.attendance_date,
    shiftEndAt: row.shift_end_at,
    actualPunchOutAt: row.actual_punch_out_at,
    extraDutyValue: Number(row.extra_duty_value),
    nightOtMinutes: row.night_ot_minutes,
    approvalStatus: row.approval_status,
    storeId: row.store_id,
    omId: row.om_id,
    omAction: row.om_action,
    omActedAt: row.om_acted_at,
    omRemark: row.om_remark,
    superManagerId: row.super_manager_id,
    superManagerAction: row.super_manager_action,
    superManagerActedAt: row.super_manager_acted_at,
    superManagerRemark: row.super_manager_remark,
    managerConfirmedPayableOutAt: row.manager_confirmed_payable_out_at,
    managerRemark: row.manager_remark,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

function mapOmAssignment(row: any): OperationsManagerAssignment {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    storeId: row.store_id,
    isActive: row.is_active,
    remark: row.remark,
    createdAt: row.created_at,
  };
}

function mapSuperManager(row: any): SuperManagerDesignation {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    isActive: row.is_active,
    remark: row.remark,
    createdAt: row.created_at,
  };
}

/** Generic "current + versioned edit" pair shared by all six company-wide singleton rule types
 *  below — no Employee>Shift>Store>Company assignment matrix (an explicit, approved simplification
 *  for these rule types only; Late/Overtime Rules keep their existing hierarchy unchanged). */
// `supabase.from(table)` can't be type-narrowed when `table` is a runtime string variable (it's a
// generic helper reused across 6 different tables) — the client falls back to `never` column
// types. Cast to `any` at this one boundary only; every mapper function above still gives callers
// a fully-typed result, matching the same generic-table-name tradeoff used nowhere else in this
// codebase because nowhere else needs one function to serve 6 structurally-similar tables.
async function getCurrent<T>(table: string, companyId: string, mapper: (row: any) => T): Promise<T | null> {
  const { data, error } = await (supabase as any).from(table).select("*").eq("company_id", companyId).is("effective_to", null).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? mapper(data) : null;
}

/** Lists EVERY row ever created for this company (open and closed/historical), for the Rule
 *  Assignment dialog's rule pickers — these 6 tables can now have more than one simultaneously
 *  OPEN row per company (migration 0063: a Store/Employee-scoped assignment can point at a
 *  variant distinct from the company default), unlike getCurrent()'s single-row assumption. */
async function listAllVersions<T>(table: string, companyId: string, mapper: (row: any) => T): Promise<T[]> {
  const { data, error } = await (supabase as any).from(table).select("*").eq("company_id", companyId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapper);
}

/** Creates a genuinely NEW, independent row for one of the 6 singleton-pattern rule tables —
 *  a plain insert, deliberately NOT the "close the current open row" versioning that
 *  getCurrent()/versionedUpdate() use for editing THE company default. Used only when creating a
 *  distinct variant to assign to a specific Store/Employee scope (migration 0063) — the existing
 *  company-default row is left completely untouched. */
async function createVariant<T>(table: string, companyId: string, values: Record<string, unknown>, effectiveFrom: string, userId?: string): Promise<T> {
  const { data, error } = await (supabase as any).from(table)
    .insert({ ...values, company_id: companyId, effective_from: effectiveFrom, effective_to: null, is_active: true, created_by: userId ?? null, updated_by: userId ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function versionedUpdate(table: string, currentId: string | undefined, companyId: string, values: Record<string, unknown>, effectiveFrom: string, userId?: string): Promise<any> {
  if (currentId) {
    const { data: current } = await (supabase as any).from(table).select("effective_from").eq("id", currentId).single();
    if (current && current.effective_from >= effectiveFrom) {
      const { data, error } = await (supabase as any).from(table).update({ ...values, effective_from: effectiveFrom, updated_by: userId ?? null }).eq("id", currentId).select("*").single();
      if (error) throw error;
      return data;
    }
    await (supabase as any).from(table).update({ effective_to: dayBefore(effectiveFrom), updated_by: userId ?? null }).eq("id", currentId);
  }

  const { data, error } = await (supabase as any).from(table)
    .insert({ ...values, company_id: companyId, effective_from: effectiveFrom, effective_to: null, created_by: userId ?? null, updated_by: userId ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export interface InformationRuleFormValues {
  monthlyLimit: number;
  cutoffTime: string;
  applicableOnWeeklyOff: boolean;
  isActive: boolean;
  remark: string;
}

export interface WeeklyOffLateRuleFormValues {
  cutoffTime: string;
  isActive: boolean;
  remark: string;
}

export interface PenaltyRuleFormValues {
  method: PenaltyMethod;
  fixedMinutes: number | null;
  multiplier: number | null;
  applicability: PenaltyApplicability;
  applyOnWeeklyOff: boolean;
  applyOnInformationDay: boolean;
  isActive: boolean;
  remark: string;
  thresholds: { fromMinutes: number; toMinutes: number | null; calculatedMinutes: number }[];
}

export interface HalfDayRuleFormValues {
  lateArrivalCutoffTime: string;
  earlyGoingCutoffTime: string;
  isActive: boolean;
  remark: string;
}

export interface EarlyGoingRuleFormValues {
  graceMinutes: number;
  calculationMethod: "exact" | "slab";
  roundingMethod: RoundingMethod;
  customRoundingMinutes: number | null;
  isActive: boolean;
  remark: string;
  thresholds: { fromMinutes: number; toMinutes: number | null; calculatedMinutes: number }[];
}

export interface ExtendedDutyRuleFormValues {
  midnightThresholdTime: string;
  midnightExtraDutyValue: number;
  firstDaySalaryThresholdTime: string;
  firstDayExtraDutyValue: number;
  secondDaySalaryThresholdTime: string;
  secondDayExtraDutyValue: number;
  hourlyOtRoundingMethod: RoundingMethod;
  hourlyOtCustomRoundingMinutes: number | null;
  isActive: boolean;
  remark: string;
}

export interface NightDutyConfigFormValues {
  approvalRequired: boolean;
  allowPayableOutOverride: boolean;
  isActive: boolean;
  remark: string;
}

export const extendedAttendanceRuleService = {
  // Information Rule
  getCurrentInformationRule: (companyId: string) => getCurrent(INFORMATION_RULES, companyId, mapInformationRule),
  async saveInformationRule(currentId: string | undefined, companyId: string, values: InformationRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await versionedUpdate(INFORMATION_RULES, currentId, companyId, {
      monthly_limit: values.monthlyLimit,
      cutoff_time: values.cutoffTime,
      applicable_on_weekly_off: values.applicableOnWeeklyOff,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);
    return mapInformationRule(row);
  },
  /** Every Information Rule variant for this company (migration 0063 — Rule Assignment can now
   *  point a Store/Employee scope at a variant distinct from the company default). */
  listInformationRules: (companyId: string) => listAllVersions(INFORMATION_RULES, companyId, mapInformationRule),
  async createInformationRuleVariant(companyId: string, values: InformationRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await createVariant(INFORMATION_RULES, companyId, {
      monthly_limit: values.monthlyLimit,
      cutoff_time: values.cutoffTime,
      applicable_on_weekly_off: values.applicableOnWeeklyOff,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);
    return mapInformationRule(row);
  },

  // Weekly Off Late Rule — independent of Information (this phase). Own table, own storage.
  getCurrentWeeklyOffLateRule: (companyId: string) => getCurrent(WEEKLY_OFF_LATE_RULES, companyId, mapWeeklyOffLateRule),
  async saveWeeklyOffLateRule(currentId: string | undefined, companyId: string, values: WeeklyOffLateRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await versionedUpdate(WEEKLY_OFF_LATE_RULES, currentId, companyId, {
      cutoff_time: values.cutoffTime,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);
    return mapWeeklyOffLateRule(row);
  },
  listWeeklyOffLateRules: (companyId: string) => listAllVersions(WEEKLY_OFF_LATE_RULES, companyId, mapWeeklyOffLateRule),
  async createWeeklyOffLateRuleVariant(companyId: string, values: WeeklyOffLateRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await createVariant(WEEKLY_OFF_LATE_RULES, companyId, {
      cutoff_time: values.cutoffTime,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);
    return mapWeeklyOffLateRule(row);
  },

  // Penalty Rule (+ thresholds)
  getCurrentPenaltyRule: (companyId: string) => getCurrent(PENALTY_RULES, companyId, mapPenaltyRule),
  async getPenaltyThresholds(penaltyRuleId: string) {
    const { data, error } = await supabase.from(PENALTY_THRESHOLDS).select("*").eq("penalty_rule_id", penaltyRuleId).order("sort_order");
    if (error) throw error;
    return (data ?? []).map((t: any) => ({ id: t.id, fromMinutes: t.from_minutes, toMinutes: t.to_minutes, calculatedMinutes: t.calculated_minutes, sortOrder: t.sort_order }));
  },
  async savePenaltyRule(currentId: string | undefined, companyId: string, values: PenaltyRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await versionedUpdate(PENALTY_RULES, currentId, companyId, {
      method: values.method,
      fixed_minutes: values.fixedMinutes,
      multiplier: values.multiplier,
      applicability: values.applicability,
      apply_on_weekly_off: values.applyOnWeeklyOff,
      apply_on_information_day: values.applyOnInformationDay,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);

    await supabase.from(PENALTY_THRESHOLDS).delete().eq("penalty_rule_id", row.id);
    if (values.thresholds.length > 0) {
      await supabase.from(PENALTY_THRESHOLDS).insert(
        values.thresholds.map((t, i) => ({ company_id: companyId, penalty_rule_id: row.id, from_minutes: t.fromMinutes, to_minutes: t.toMinutes, calculated_minutes: t.calculatedMinutes, sort_order: i }))
      );
    }
    return mapPenaltyRule(row);
  },
  listPenaltyRules: (companyId: string) => listAllVersions(PENALTY_RULES, companyId, mapPenaltyRule),
  async createPenaltyRuleVariant(companyId: string, values: PenaltyRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await createVariant(PENALTY_RULES, companyId, {
      method: values.method,
      fixed_minutes: values.fixedMinutes,
      multiplier: values.multiplier,
      applicability: values.applicability,
      apply_on_weekly_off: values.applyOnWeeklyOff,
      apply_on_information_day: values.applyOnInformationDay,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);

    if (values.thresholds.length > 0) {
      await supabase.from(PENALTY_THRESHOLDS).insert(
        values.thresholds.map((t, i) => ({ company_id: companyId, penalty_rule_id: (row as any).id, from_minutes: t.fromMinutes, to_minutes: t.toMinutes, calculated_minutes: t.calculatedMinutes, sort_order: i }))
      );
    }
    return mapPenaltyRule(row);
  },

  // Half Day Rule
  getCurrentHalfDayRule: (companyId: string) => getCurrent(HALF_DAY_RULES, companyId, mapHalfDayRule),
  async saveHalfDayRule(currentId: string | undefined, companyId: string, values: HalfDayRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await versionedUpdate(HALF_DAY_RULES, currentId, companyId, {
      late_arrival_cutoff_time: values.lateArrivalCutoffTime,
      early_going_cutoff_time: values.earlyGoingCutoffTime,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);
    return mapHalfDayRule(row);
  },
  listHalfDayRules: (companyId: string) => listAllVersions(HALF_DAY_RULES, companyId, mapHalfDayRule),
  async createHalfDayRuleVariant(companyId: string, values: HalfDayRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await createVariant(HALF_DAY_RULES, companyId, {
      late_arrival_cutoff_time: values.lateArrivalCutoffTime,
      early_going_cutoff_time: values.earlyGoingCutoffTime,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);
    return mapHalfDayRule(row);
  },

  // Early Going Rule (+ thresholds)
  getCurrentEarlyGoingRule: (companyId: string) => getCurrent(EARLY_GOING_RULES, companyId, mapEarlyGoingRule),
  async getEarlyGoingThresholds(earlyGoingRuleId: string) {
    const { data, error } = await supabase.from(EARLY_GOING_THRESHOLDS).select("*").eq("early_going_rule_id", earlyGoingRuleId).order("sort_order");
    if (error) throw error;
    return (data ?? []).map((t: any) => ({ id: t.id, fromMinutes: t.from_minutes, toMinutes: t.to_minutes, calculatedMinutes: t.calculated_minutes, sortOrder: t.sort_order }));
  },
  async saveEarlyGoingRule(currentId: string | undefined, companyId: string, values: EarlyGoingRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await versionedUpdate(EARLY_GOING_RULES, currentId, companyId, {
      grace_minutes: values.graceMinutes,
      calculation_method: values.calculationMethod,
      rounding_method: values.roundingMethod,
      custom_rounding_minutes: values.customRoundingMinutes,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);

    await supabase.from(EARLY_GOING_THRESHOLDS).delete().eq("early_going_rule_id", row.id);
    if (values.thresholds.length > 0) {
      await supabase.from(EARLY_GOING_THRESHOLDS).insert(
        values.thresholds.map((t, i) => ({ company_id: companyId, early_going_rule_id: row.id, from_minutes: t.fromMinutes, to_minutes: t.toMinutes, calculated_minutes: t.calculatedMinutes, sort_order: i }))
      );
    }
    return mapEarlyGoingRule(row);
  },
  listEarlyGoingRules: (companyId: string) => listAllVersions(EARLY_GOING_RULES, companyId, mapEarlyGoingRule),
  async createEarlyGoingRuleVariant(companyId: string, values: EarlyGoingRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await createVariant(EARLY_GOING_RULES, companyId, {
      grace_minutes: values.graceMinutes,
      calculation_method: values.calculationMethod,
      rounding_method: values.roundingMethod,
      custom_rounding_minutes: values.customRoundingMinutes,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);

    if (values.thresholds.length > 0) {
      await supabase.from(EARLY_GOING_THRESHOLDS).insert(
        values.thresholds.map((t, i) => ({ company_id: companyId, early_going_rule_id: (row as any).id, from_minutes: t.fromMinutes, to_minutes: t.toMinutes, calculated_minutes: t.calculatedMinutes, sort_order: i }))
      );
    }
    return mapEarlyGoingRule(row);
  },

  // Extended Duty Rule
  getCurrentExtendedDutyRule: (companyId: string) => getCurrent(EXTENDED_DUTY_RULES, companyId, mapExtendedDutyRule),
  async saveExtendedDutyRule(currentId: string | undefined, companyId: string, values: ExtendedDutyRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await versionedUpdate(EXTENDED_DUTY_RULES, currentId, companyId, {
      midnight_threshold_time: values.midnightThresholdTime,
      midnight_extra_duty_value: values.midnightExtraDutyValue,
      first_day_salary_threshold_time: values.firstDaySalaryThresholdTime,
      first_day_extra_duty_value: values.firstDayExtraDutyValue,
      second_day_salary_threshold_time: values.secondDaySalaryThresholdTime,
      second_day_extra_duty_value: values.secondDayExtraDutyValue,
      hourly_ot_rounding_method: values.hourlyOtRoundingMethod,
      hourly_ot_custom_rounding_minutes: values.hourlyOtCustomRoundingMinutes,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);
    return mapExtendedDutyRule(row);
  },
  listExtendedDutyRules: (companyId: string) => listAllVersions(EXTENDED_DUTY_RULES, companyId, mapExtendedDutyRule),
  async createExtendedDutyRuleVariant(companyId: string, values: ExtendedDutyRuleFormValues, effectiveFrom: string, userId?: string) {
    const row = await createVariant(EXTENDED_DUTY_RULES, companyId, {
      midnight_threshold_time: values.midnightThresholdTime,
      midnight_extra_duty_value: values.midnightExtraDutyValue,
      first_day_salary_threshold_time: values.firstDaySalaryThresholdTime,
      first_day_extra_duty_value: values.firstDayExtraDutyValue,
      second_day_salary_threshold_time: values.secondDaySalaryThresholdTime,
      second_day_extra_duty_value: values.secondDayExtraDutyValue,
      hourly_ot_rounding_method: values.hourlyOtRoundingMethod,
      hourly_ot_custom_rounding_minutes: values.hourlyOtCustomRoundingMinutes,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);
    return mapExtendedDutyRule(row);
  },

  // Night Duty Approval Config
  getCurrentNightDutyConfig: (companyId: string) => getCurrent(NIGHT_DUTY_CONFIG, companyId, mapNightDutyConfig),
  async saveNightDutyConfig(currentId: string | undefined, companyId: string, values: NightDutyConfigFormValues, effectiveFrom: string, userId?: string) {
    const row = await versionedUpdate(NIGHT_DUTY_CONFIG, currentId, companyId, {
      approval_required: values.approvalRequired,
      allow_payable_out_override: values.allowPayableOutOverride,
      is_active: values.isActive,
      remark: values.remark.trim() || null,
    }, effectiveFrom, userId);
    return mapNightDutyConfig(row);
  },

  // Information usage
  async getInformationUsageThisMonth(employeeId: string, year: number, month: number): Promise<InformationUsageRecord[]> {
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const to = new Date(year, month, 0).toISOString().slice(0, 10);
    const { data, error } = await supabase.from(INFORMATION_USAGE).select("*").eq("employee_id", employeeId).gte("attendance_date", from).lte("attendance_date", to).order("attendance_date");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, employeeId: r.employee_id, attendanceDate: r.attendance_date, usedBy: r.used_by, remark: r.remark, createdAt: r.created_at }));
  },

  // Night Duty approvals — legacy blanket listing (Super Admin emergency-access view only).
  async getNightDutyApprovals(companyId: string, status?: string): Promise<NightDutyApproval[]> {
    let query = supabase.from(NIGHT_DUTY_APPROVALS).select("*").eq("company_id", companyId).order("attendance_date", { ascending: false });
    if (status) query = query.eq("approval_status", status);
    const { data, error } = await query;
    if (error) throw error;
    return this.enrichNightDutyApprovals(data ?? []);
  },

  async getMyNightDutyApprovals(employeeId: string): Promise<NightDutyApproval[]> {
    const { data, error } = await supabase.from(NIGHT_DUTY_APPROVALS).select("*").eq("employee_id", employeeId).order("attendance_date", { ascending: false }).limit(10);
    if (error) throw error;
    return (data ?? []).map(mapNightDutyApproval);
  },

  /** The logged-in employee's OWN Night Duty requests + full approval history — the secure,
   *  self-scoped source for Approvals -> Night Duty Approval. Identity = current_user_employee_id()
   *  server-side; there is no employee-id parameter, so no client value can widen the result. Reads
   *  the existing attendance_night_duty_approvals row + live attendance_records figures only. */
  async getMyNightDutyHistory(): Promise<MyNightDutyRow[]> {
    const { data, error } = await supabase.rpc("attendance_night_duty_list_mine");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      attendanceRecordId: r.attendance_record_id,
      attendanceDate: r.attendance_date,
      punchInAt: r.punch_in_at,
      actualPunchOutAt: r.actual_punch_out_at,
      extraDutyValue: Number(r.extra_duty_value ?? 0),
      nightOtMinutes: Number(r.night_ot_minutes ?? 0),
      payableExtraDutyValue: r.payable_extra_duty_value == null ? null : Number(r.payable_extra_duty_value),
      payableOvertimeMinutes: r.payable_overtime_minutes == null ? null : Number(r.payable_overtime_minutes),
      approvalStatus: r.approval_status,
      omId: r.om_id,
      omName: r.om_name,
      omAction: r.om_action,
      omActedAt: r.om_acted_at,
      omRemark: r.om_remark,
      superManagerId: r.super_manager_id,
      superManagerName: r.super_manager_name,
      superManagerAction: r.super_manager_action,
      superManagerActedAt: r.super_manager_acted_at,
      superManagerRemark: r.super_manager_remark,
      managerConfirmedPayableOutAt: r.manager_confirmed_payable_out_at,
      managerRemark: r.manager_remark,
      createdAt: r.created_at,
      decidedStage: r.decided_stage,
      decidedByName: r.decided_by_name,
      decidedAction: r.decided_action,
      decidedAt: r.decided_at,
      decidedRemark: r.decided_remark,
    }));
  },

  /**
   * Every Night Duty approval for ONE employee within [fromDate, toDate] — the authoritative
   * source the Monthly Attendance / date-range views merge into Overtime/Night Duty Payable (see
   * modules/attendance/utils.ts resolveNightDutyFacts()). Unlike getMyNightDutyApprovals() (capped
   * at 10, for the small "Night Duty" card), this is not capped — a full month/range must never
   * silently drop older approvals.
   */
  async getNightDutyApprovalsForEmployeeRange(employeeId: string, fromDate: string, toDate: string): Promise<NightDutyApproval[]> {
    const { data, error } = await supabase
      .from(NIGHT_DUTY_APPROVALS)
      .select("*")
      .eq("employee_id", employeeId)
      .gte("attendance_date", fromDate)
      .lte("attendance_date", toDate)
      .order("attendance_date", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapNightDutyApproval);
  },

  /** Same as above, for MULTIPLE employees at once within one date range — used by the Admin
   *  Attendance Dashboard's Daily Attendance Records table (one query for every employee/date in
   *  the current filter, instead of one query per row). */
  async getNightDutyApprovalsForEmployeesRange(employeeIds: string[], fromDate: string, toDate: string): Promise<NightDutyApproval[]> {
    if (employeeIds.length === 0) return [];
    const { data, error } = await supabase
      .from(NIGHT_DUTY_APPROVALS)
      .select("*")
      .in("employee_id", employeeIds)
      .gte("attendance_date", fromDate)
      .lte("attendance_date", toDate);
    if (error) throw error;
    return (data ?? []).map(mapNightDutyApproval);
  },

  /** Requests visible to an Operations Manager: pending_om at any store they're actively assigned
   *  to, plus their own past decisions (approved/disallowed/carried-forward) for history/context. */
  async getOmNightDutyApprovals(companyId: string, omEmployeeId: string): Promise<NightDutyApproval[]> {
    const { data: assignments, error: assignmentError } = await supabase
      .from(OM_ASSIGNMENTS)
      .select("store_id")
      .eq("employee_id", omEmployeeId)
      .eq("is_active", true);
    if (assignmentError) throw assignmentError;
    const storeIds = (assignments ?? []).map((a: any) => a.store_id);
    if (storeIds.length === 0) return [];

    const { data, error } = await supabase
      .from(NIGHT_DUTY_APPROVALS)
      .select("*")
      .eq("company_id", companyId)
      .in("store_id", storeIds)
      .or(`approval_status.eq.pending_om,om_id.eq.${omEmployeeId}`)
      .order("attendance_date", { ascending: false });
    if (error) throw error;
    return this.enrichNightDutyApprovals(data ?? []);
  },

  /** Requests visible to a Super Manager: everything pending_super_manager (any store — Super
   *  Manager is company-wide, not store-scoped), plus their own past final decisions. */
  async getSuperManagerNightDutyApprovals(companyId: string, superManagerEmployeeId: string): Promise<NightDutyApproval[]> {
    const { data, error } = await supabase
      .from(NIGHT_DUTY_APPROVALS)
      .select("*")
      .eq("company_id", companyId)
      .or(`approval_status.eq.pending_super_manager,super_manager_id.eq.${superManagerEmployeeId}`)
      .order("attendance_date", { ascending: false });
    if (error) throw error;
    return this.enrichNightDutyApprovals(data ?? []);
  },

  async enrichNightDutyApprovals(rows: any[]): Promise<NightDutyApproval[]> {
    const approvals = rows.map(mapNightDutyApproval);
    const employeeIds = Array.from(
      new Set([...approvals.map((a) => a.employeeId), ...approvals.map((a) => a.omId).filter((x): x is string => Boolean(x)), ...approvals.map((a) => a.superManagerId).filter((x): x is string => Boolean(x))])
    );
    const storeIds = Array.from(new Set(approvals.map((a) => a.storeId).filter((x): x is string => Boolean(x))));
    const attendanceRecordIds = Array.from(new Set(approvals.map((a) => a.attendanceRecordId)));

    const [employeeMap, storeRows, recordRows] = await Promise.all([
      employeeIds.length ? employeeService.getByIds(employeeIds) : Promise.resolve(new Map<string, { fullName: string; employeeCode: string | null; storeName: string | null }>()),
      storeIds.length ? supabase.from(STORES).select("id, name").in("id", storeIds) : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
      attendanceRecordIds.length ? supabase.from("attendance_records").select("id, punch_in_at").in("id", attendanceRecordIds) : Promise.resolve({ data: [] as { id: string; punch_in_at: string | null }[], error: null }),
    ]);
    const storeMap = new Map((storeRows.data ?? []).map((s: any) => [s.id, s.name]));
    const punchInMap = new Map((recordRows.data ?? []).map((r: any) => [r.id, r.punch_in_at]));

    return approvals.map((a) => ({
      ...a,
      punchInAt: punchInMap.get(a.attendanceRecordId) ?? null,
      employeeName: employeeMap.get(a.employeeId)?.fullName,
      employeeCode: employeeMap.get(a.employeeId)?.employeeCode ?? null,
      storeName: a.storeId ? storeMap.get(a.storeId) ?? null : null,
      omName: a.omId ? employeeMap.get(a.omId)?.fullName ?? null : null,
      superManagerName: a.superManagerId ? employeeMap.get(a.superManagerId)?.fullName ?? null : null,
    }));
  },

  // -------------------------------------------------------------------------
  // Operations Manager <-> Store assignments, and Super Manager designation.
  // Managed by Super Admin (no Role & Permission Management system exists yet —
  // this is scoped strictly to Night Duty approval routing, per explicit instruction
  // not to build the full system now).
  // -------------------------------------------------------------------------

  async listOperationsManagerAssignments(companyId: string): Promise<OperationsManagerAssignment[]> {
    const { data, error } = await supabase.from(OM_ASSIGNMENTS).select("*").eq("company_id", companyId).order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []).map(mapOmAssignment);
    const employeeMap = await employeeService.getByIds(Array.from(new Set(rows.map((r) => r.employeeId))));
    const storeIds = Array.from(new Set(rows.map((r) => r.storeId)));
    const { data: storeRows } = storeIds.length ? await supabase.from(STORES).select("id, name").in("id", storeIds) : { data: [] as { id: string; name: string }[] };
    const storeMap = new Map((storeRows ?? []).map((s: any) => [s.id, s.name]));
    return rows.map((r) => ({
      ...r,
      employeeName: employeeMap.get(r.employeeId)?.fullName,
      employeeCode: employeeMap.get(r.employeeId)?.employeeCode ?? null,
      storeName: storeMap.get(r.storeId) ?? null,
    }));
  },

  async assignOperationsManager(companyId: string, employeeId: string, storeId: string, remark?: string, userId?: string): Promise<void> {
    const { error } = await supabase.from(OM_ASSIGNMENTS).upsert(
      { company_id: companyId, employee_id: employeeId, store_id: storeId, is_active: true, remark: remark ?? null, created_by: userId ?? null, updated_by: userId ?? null },
      { onConflict: "employee_id,store_id" }
    );
    if (error) throw error;
  },

  async setOperationsManagerActive(id: string, isActive: boolean, userId?: string): Promise<void> {
    const { error } = await supabase.from(OM_ASSIGNMENTS).update({ is_active: isActive, updated_by: userId ?? null }).eq("id", id);
    if (error) throw error;
  },

  async listSuperManagers(companyId: string): Promise<SuperManagerDesignation[]> {
    const { data, error } = await supabase.from(SUPER_MANAGERS).select("*").eq("company_id", companyId).order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []).map(mapSuperManager);
    const employeeMap = await employeeService.getByIds(Array.from(new Set(rows.map((r) => r.employeeId))));
    return rows.map((r) => ({ ...r, employeeName: employeeMap.get(r.employeeId)?.fullName, employeeCode: employeeMap.get(r.employeeId)?.employeeCode ?? null }));
  },

  async designateSuperManager(companyId: string, employeeId: string, remark?: string, userId?: string): Promise<void> {
    const { error } = await supabase.from(SUPER_MANAGERS).upsert(
      { company_id: companyId, employee_id: employeeId, is_active: true, remark: remark ?? null, created_by: userId ?? null, updated_by: userId ?? null },
      { onConflict: "employee_id" }
    );
    if (error) throw error;
  },

  async setSuperManagerActive(id: string, isActive: boolean, userId?: string): Promise<void> {
    const { error } = await supabase.from(SUPER_MANAGERS).update({ is_active: isActive, updated_by: userId ?? null }).eq("id", id);
    if (error) throw error;
  },

  /** Is this employee an active Operations Manager for at least one store? Returns the store ids. */
  async getMyOperationsManagerStores(employeeId: string): Promise<string[]> {
    const { data, error } = await supabase.from(OM_ASSIGNMENTS).select("store_id").eq("employee_id", employeeId).eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map((r: any) => r.store_id);
  },

  /** Is this employee an active Super Manager? */
  async amISuperManager(employeeId: string): Promise<boolean> {
    const { data, error } = await supabase.from(SUPER_MANAGERS).select("id").eq("employee_id", employeeId).eq("is_active", true).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  },
};
