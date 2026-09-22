import { supabase } from "@/lib/supabaseClient";
import { employeeService } from "@/services/employeeService";
import type {
  LateRule,
  LateRuleFormValues,
  OvertimeRule,
  OvertimeRuleFormValues,
  RuleAssignment,
  RuleScopeType,
  RuleThresholdRecord,
} from "@/types/attendanceRules";

const LATE_RULES = "attendance_late_rules";
const LATE_THRESHOLDS = "attendance_late_rule_thresholds";
const OVERTIME_RULES = "attendance_overtime_rules";
const OVERTIME_THRESHOLDS = "attendance_overtime_rule_thresholds";
const ASSIGNMENTS = "attendance_rule_assignments";
const SHIFTS = "attendance_shifts";
const STORES = "stores";

/** Key used by getScopeLabels()'s returned map — one label per distinct (scopeType, scopeId). */
export function scopeLabelKey(scopeType: RuleScopeType, scopeId: string | null): string {
  return `${scopeType}:${scopeId ?? ""}`;
}

function mapLateRule(row: any): LateRule {
  return {
    id: row.id,
    companyId: row.company_id,
    ruleCode: row.rule_code,
    ruleName: row.rule_name,
    description: row.description,
    calculationMethod: row.calculation_method,
    roundingMethod: row.rounding_method,
    customRoundingMinutes: row.custom_rounding_minutes,
    minimumLateMinutes: row.minimum_late_minutes,
    maximumLateMinutes: row.maximum_late_minutes,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOvertimeRule(row: any): OvertimeRule {
  return {
    id: row.id,
    companyId: row.company_id,
    ruleCode: row.rule_code,
    ruleName: row.rule_name,
    description: row.description,
    calculationMethod: row.calculation_method,
    minimumOvertimeMinutes: row.minimum_overtime_minutes,
    maximumOvertimeMinutes: row.maximum_overtime_minutes,
    roundingMethod: row.rounding_method,
    customRoundingMinutes: row.custom_rounding_minutes,
    weeklyOffOvertimeAllowed: row.weekly_off_overtime_allowed,
    holidayOvertimeAllowed: row.holiday_overtime_allowed,
    leaveOvertimeAllowed: row.leave_overtime_allowed,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapThreshold(row: any): RuleThresholdRecord {
  return {
    id: row.id,
    fromMinutes: row.from_minutes,
    toMinutes: row.to_minutes,
    calculatedMinutes: row.calculated_minutes,
    sortOrder: row.sort_order,
  };
}

function mapAssignment(row: any): RuleAssignment {
  return {
    id: row.id,
    companyId: row.company_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    storeId: row.store_id ?? null,
    employeeId: row.employee_id ?? null,
    lateRuleId: row.late_rule_id,
    overtimeRuleId: row.overtime_rule_id,
    informationRuleId: row.information_rule_id ?? null,
    weeklyOffLateRuleId: row.weekly_off_late_rule_id ?? null,
    penaltyRuleId: row.penalty_rule_id ?? null,
    halfDayRuleId: row.half_day_rule_id ?? null,
    earlyGoingRuleId: row.early_going_rule_id ?? null,
    extendedDutyRuleId: row.extended_duty_rule_id ?? null,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isActive: row.is_active,
    remark: row.remark,
    createdAt: row.created_at,
  };
}

/** Random short code so a duplicated/versioned rule always gets a distinct rule_code when needed. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function dayBefore(dateKey: string): string {
  const d = new Date(dateKey);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const attendanceRuleService = {
  // -------------------------------------------------------------------------
  // Late Rules — versioned via the same "close old open-ended row, insert new
  // row with the same rule_code" pattern as employee_shift_assignments /
  // employee_weekly_off_history. The row with effective_to IS NULL for a given
  // rule_code is always its current/latest version.
  // -------------------------------------------------------------------------

  async listLateRulesCurrent(companyId: string): Promise<LateRule[]> {
    const { data, error } = await supabase
      .from(LATE_RULES)
      .select("*")
      .eq("company_id", companyId)
      .is("effective_to", null)
      .order("rule_name", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapLateRule);
  },

  async getLateRuleHistory(companyId: string, ruleCode: string): Promise<LateRule[]> {
    const { data, error } = await supabase
      .from(LATE_RULES)
      .select("*")
      .eq("company_id", companyId)
      .eq("rule_code", ruleCode)
      .order("effective_from", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapLateRule);
  },

  async getLateRuleThresholds(lateRuleId: string): Promise<RuleThresholdRecord[]> {
    const { data, error } = await supabase.from(LATE_THRESHOLDS).select("*").eq("late_rule_id", lateRuleId).order("sort_order");
    if (error) throw error;
    return (data ?? []).map(mapThreshold);
  },

  async createLateRule(companyId: string, values: LateRuleFormValues, effectiveFrom: string, userId?: string): Promise<LateRule> {
    const { data, error } = await supabase
      .from(LATE_RULES)
      .insert({
        company_id: companyId,
        rule_code: values.ruleCode.trim() || `LATE-${randomSuffix()}`,
        rule_name: values.ruleName,
        description: values.description.trim() || null,
        calculation_method: values.calculationMethod,
        rounding_method: values.roundingMethod,
        custom_rounding_minutes: values.customRoundingMinutes,
        minimum_late_minutes: values.minimumLateMinutes,
        maximum_late_minutes: values.maximumLateMinutes,
        is_active: values.isActive,
        effective_from: effectiveFrom,
        effective_to: null,
        remark: values.remark.trim() || null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    await this.replaceLateRuleThresholds(data.id, values.thresholds);
    return mapLateRule(data);
  },

  async replaceLateRuleThresholds(lateRuleId: string, thresholds: LateRuleFormValues["thresholds"]): Promise<void> {
    const { error: deleteError } = await supabase.from(LATE_THRESHOLDS).delete().eq("late_rule_id", lateRuleId);
    if (deleteError) throw deleteError;
    if (thresholds.length === 0) return;

    const { data: rule, error: ruleError } = await supabase.from(LATE_RULES).select("company_id").eq("id", lateRuleId).single();
    if (ruleError) throw ruleError;

    const { error: insertError } = await supabase.from(LATE_THRESHOLDS).insert(
      thresholds.map((t, index) => ({
        company_id: rule.company_id,
        late_rule_id: lateRuleId,
        from_minutes: t.fromMinutes,
        to_minutes: t.toMinutes,
        calculated_minutes: t.calculatedMinutes,
        sort_order: index,
      }))
    );
    if (insertError) throw insertError;
  },

  /**
   * Edits a Late Rule by VERSIONING it (never overwrites the currently-open row in place unless
   * it hasn't taken effect yet): closes the current open-ended row with effective_to = the day
   * before the new effective date, then inserts a new row sharing the same rule_code. Any
   * attendance already calculated with the old version keeps pointing at that exact row via
   * attendance_records.late_rule_id — nothing historical is rewritten.
   */
  async updateLateRule(params: {
    currentRuleId: string;
    companyId: string;
    values: LateRuleFormValues;
    effectiveFrom: string;
    userId?: string;
  }): Promise<LateRule> {
    const { currentRuleId, companyId, values, effectiveFrom, userId } = params;

    const { data: current, error: currentError } = await supabase
      .from(LATE_RULES)
      .select("rule_code, effective_from")
      .eq("id", currentRuleId)
      .single();
    if (currentError) throw currentError;

    // If the current version hasn't taken effect yet (its own effective_from is still in the
    // future), just update it in place — versioning a rule that was never live yet would leave an
    // orphaned, pointless historical row.
    if (current.effective_from >= effectiveFrom) {
      const { data, error } = await supabase
        .from(LATE_RULES)
        .update({
          rule_name: values.ruleName,
          description: values.description.trim() || null,
          calculation_method: values.calculationMethod,
          rounding_method: values.roundingMethod,
          custom_rounding_minutes: values.customRoundingMinutes,
          minimum_late_minutes: values.minimumLateMinutes,
          maximum_late_minutes: values.maximumLateMinutes,
          is_active: values.isActive,
          effective_from: effectiveFrom,
          remark: values.remark.trim() || null,
          updated_by: userId ?? null,
        })
        .eq("id", currentRuleId)
        .select("*")
        .single();
      if (error) throw error;
      await this.replaceLateRuleThresholds(currentRuleId, values.thresholds);
      return mapLateRule(data);
    }

    await supabase.from(LATE_RULES).update({ effective_to: dayBefore(effectiveFrom), updated_by: userId ?? null }).eq("id", currentRuleId);

    const { data: created, error: createError } = await supabase
      .from(LATE_RULES)
      .insert({
        company_id: companyId,
        rule_code: current.rule_code,
        rule_name: values.ruleName,
        description: values.description.trim() || null,
        calculation_method: values.calculationMethod,
        rounding_method: values.roundingMethod,
        custom_rounding_minutes: values.customRoundingMinutes,
        minimum_late_minutes: values.minimumLateMinutes,
        maximum_late_minutes: values.maximumLateMinutes,
        is_active: values.isActive,
        effective_from: effectiveFrom,
        effective_to: null,
        remark: values.remark.trim() || null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("*")
      .single();
    if (createError) throw createError;

    await this.replaceLateRuleThresholds(created.id, values.thresholds);
    return mapLateRule(created);
  },

  async duplicateLateRule(ruleId: string, companyId: string, newRuleName: string, userId?: string): Promise<LateRule> {
    const { data: source, error: sourceError } = await supabase.from(LATE_RULES).select("*").eq("id", ruleId).single();
    if (sourceError) throw sourceError;
    const thresholds = await this.getLateRuleThresholds(ruleId);

    return this.createLateRule(
      companyId,
      {
        ruleName: newRuleName,
        ruleCode: `${source.rule_code}-COPY-${randomSuffix()}`,
        description: source.description ?? "",
        calculationMethod: source.calculation_method as LateRuleFormValues["calculationMethod"],
        roundingMethod: source.rounding_method as LateRuleFormValues["roundingMethod"],
        customRoundingMinutes: source.custom_rounding_minutes,
        minimumLateMinutes: source.minimum_late_minutes,
        maximumLateMinutes: source.maximum_late_minutes,
        isActive: false, // duplicated rules start inactive so they must be reviewed before use
        remark: `Duplicated from ${source.rule_name}`,
        thresholds: thresholds.map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes })),
      },
      new Date().toISOString().slice(0, 10),
      userId
    );
  },

  async setLateRuleActive(ruleId: string, isActive: boolean, userId?: string): Promise<void> {
    const { error } = await supabase.from(LATE_RULES).update({ is_active: isActive, updated_by: userId ?? null }).eq("id", ruleId);
    if (error) throw error;
  },

  // -------------------------------------------------------------------------
  // Overtime Rules — identical shape/pattern to Late Rules above.
  // -------------------------------------------------------------------------

  async listOvertimeRulesCurrent(companyId: string): Promise<OvertimeRule[]> {
    const { data, error } = await supabase
      .from(OVERTIME_RULES)
      .select("*")
      .eq("company_id", companyId)
      .is("effective_to", null)
      .order("rule_name", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapOvertimeRule);
  },

  async getOvertimeRuleHistory(companyId: string, ruleCode: string): Promise<OvertimeRule[]> {
    const { data, error } = await supabase
      .from(OVERTIME_RULES)
      .select("*")
      .eq("company_id", companyId)
      .eq("rule_code", ruleCode)
      .order("effective_from", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapOvertimeRule);
  },

  async getOvertimeRuleThresholds(overtimeRuleId: string): Promise<RuleThresholdRecord[]> {
    const { data, error } = await supabase.from(OVERTIME_THRESHOLDS).select("*").eq("overtime_rule_id", overtimeRuleId).order("sort_order");
    if (error) throw error;
    return (data ?? []).map(mapThreshold);
  },

  async createOvertimeRule(companyId: string, values: OvertimeRuleFormValues, effectiveFrom: string, userId?: string): Promise<OvertimeRule> {
    const { data, error } = await supabase
      .from(OVERTIME_RULES)
      .insert({
        company_id: companyId,
        rule_code: values.ruleCode.trim() || `OT-${randomSuffix()}`,
        rule_name: values.ruleName,
        description: values.description.trim() || null,
        calculation_method: values.calculationMethod,
        minimum_overtime_minutes: values.minimumOvertimeMinutes,
        maximum_overtime_minutes: values.maximumOvertimeMinutes,
        rounding_method: values.roundingMethod,
        custom_rounding_minutes: values.customRoundingMinutes,
        weekly_off_overtime_allowed: values.weeklyOffOvertimeAllowed,
        holiday_overtime_allowed: values.holidayOvertimeAllowed,
        leave_overtime_allowed: values.leaveOvertimeAllowed,
        is_active: values.isActive,
        effective_from: effectiveFrom,
        effective_to: null,
        remark: values.remark.trim() || null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    await this.replaceOvertimeRuleThresholds(data.id, values.thresholds);
    return mapOvertimeRule(data);
  },

  async replaceOvertimeRuleThresholds(overtimeRuleId: string, thresholds: OvertimeRuleFormValues["thresholds"]): Promise<void> {
    const { error: deleteError } = await supabase.from(OVERTIME_THRESHOLDS).delete().eq("overtime_rule_id", overtimeRuleId);
    if (deleteError) throw deleteError;
    if (thresholds.length === 0) return;

    const { data: rule, error: ruleError } = await supabase.from(OVERTIME_RULES).select("company_id").eq("id", overtimeRuleId).single();
    if (ruleError) throw ruleError;

    const { error: insertError } = await supabase.from(OVERTIME_THRESHOLDS).insert(
      thresholds.map((t, index) => ({
        company_id: rule.company_id,
        overtime_rule_id: overtimeRuleId,
        from_minutes: t.fromMinutes,
        to_minutes: t.toMinutes,
        calculated_minutes: t.calculatedMinutes,
        sort_order: index,
      }))
    );
    if (insertError) throw insertError;
  },

  async updateOvertimeRule(params: {
    currentRuleId: string;
    companyId: string;
    values: OvertimeRuleFormValues;
    effectiveFrom: string;
    userId?: string;
  }): Promise<OvertimeRule> {
    const { currentRuleId, companyId, values, effectiveFrom, userId } = params;

    const { data: current, error: currentError } = await supabase
      .from(OVERTIME_RULES)
      .select("rule_code, effective_from")
      .eq("id", currentRuleId)
      .single();
    if (currentError) throw currentError;

    if (current.effective_from >= effectiveFrom) {
      const { data, error } = await supabase
        .from(OVERTIME_RULES)
        .update({
          rule_name: values.ruleName,
          description: values.description.trim() || null,
          calculation_method: values.calculationMethod,
          minimum_overtime_minutes: values.minimumOvertimeMinutes,
          maximum_overtime_minutes: values.maximumOvertimeMinutes,
          rounding_method: values.roundingMethod,
          custom_rounding_minutes: values.customRoundingMinutes,
          weekly_off_overtime_allowed: values.weeklyOffOvertimeAllowed,
          holiday_overtime_allowed: values.holidayOvertimeAllowed,
          leave_overtime_allowed: values.leaveOvertimeAllowed,
          is_active: values.isActive,
          effective_from: effectiveFrom,
          remark: values.remark.trim() || null,
          updated_by: userId ?? null,
        })
        .eq("id", currentRuleId)
        .select("*")
        .single();
      if (error) throw error;
      await this.replaceOvertimeRuleThresholds(currentRuleId, values.thresholds);
      return mapOvertimeRule(data);
    }

    await supabase.from(OVERTIME_RULES).update({ effective_to: dayBefore(effectiveFrom), updated_by: userId ?? null }).eq("id", currentRuleId);

    const { data: created, error: createError } = await supabase
      .from(OVERTIME_RULES)
      .insert({
        company_id: companyId,
        rule_code: current.rule_code,
        rule_name: values.ruleName,
        description: values.description.trim() || null,
        calculation_method: values.calculationMethod,
        minimum_overtime_minutes: values.minimumOvertimeMinutes,
        maximum_overtime_minutes: values.maximumOvertimeMinutes,
        rounding_method: values.roundingMethod,
        custom_rounding_minutes: values.customRoundingMinutes,
        weekly_off_overtime_allowed: values.weeklyOffOvertimeAllowed,
        holiday_overtime_allowed: values.holidayOvertimeAllowed,
        leave_overtime_allowed: values.leaveOvertimeAllowed,
        is_active: values.isActive,
        effective_from: effectiveFrom,
        effective_to: null,
        remark: values.remark.trim() || null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("*")
      .single();
    if (createError) throw createError;

    await this.replaceOvertimeRuleThresholds(created.id, values.thresholds);
    return mapOvertimeRule(created);
  },

  async duplicateOvertimeRule(ruleId: string, companyId: string, newRuleName: string, userId?: string): Promise<OvertimeRule> {
    const { data: source, error: sourceError } = await supabase.from(OVERTIME_RULES).select("*").eq("id", ruleId).single();
    if (sourceError) throw sourceError;
    const thresholds = await this.getOvertimeRuleThresholds(ruleId);

    return this.createOvertimeRule(
      companyId,
      {
        ruleName: newRuleName,
        ruleCode: `${source.rule_code}-COPY-${randomSuffix()}`,
        description: source.description ?? "",
        calculationMethod: source.calculation_method as OvertimeRuleFormValues["calculationMethod"],
        minimumOvertimeMinutes: source.minimum_overtime_minutes,
        maximumOvertimeMinutes: source.maximum_overtime_minutes,
        roundingMethod: source.rounding_method as OvertimeRuleFormValues["roundingMethod"],
        customRoundingMinutes: source.custom_rounding_minutes,
        weeklyOffOvertimeAllowed: source.weekly_off_overtime_allowed,
        holidayOvertimeAllowed: source.holiday_overtime_allowed,
        leaveOvertimeAllowed: source.leave_overtime_allowed,
        isActive: false,
        remark: `Duplicated from ${source.rule_name}`,
        thresholds: thresholds.map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes })),
      },
      new Date().toISOString().slice(0, 10),
      userId
    );
  },

  async setOvertimeRuleActive(ruleId: string, isActive: boolean, userId?: string): Promise<void> {
    const { error } = await supabase.from(OVERTIME_RULES).update({ is_active: isActive, updated_by: userId ?? null }).eq("id", ruleId);
    if (error) throw error;
  },

  // -------------------------------------------------------------------------
  // Rule assignment — Employee / Shift / Store / Company Default, resolved by
  // priority (highest first) in the same order server-side (resolve_attendance_rule).
  // -------------------------------------------------------------------------

  async getAssignments(companyId: string): Promise<RuleAssignment[]> {
    const { data, error } = await supabase
      .from(ASSIGNMENTS)
      .select("*")
      .eq("company_id", companyId)
      .is("effective_to", null)
      .order("scope_type", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapAssignment);
  },

  /**
   * Resolves Employee/Shift/Store scope ids on a set of assignments to human-readable labels for
   * display — "APARNA DUTT — TR-A11041125", "Shift 1 — 10:00 AM–08:00 PM", "MW STORE", "Company
   * Default". Storage/IDs are never changed by this — display-only, one batched query per scope
   * type (never N+1). Keyed by scopeLabelKey(scopeType, scopeId).
   */
  async getScopeLabels(assignments: RuleAssignment[]): Promise<Map<string, string>> {
    const labels = new Map<string, string>();

    const employeeIds = Array.from(new Set(assignments.filter((a) => a.scopeType === "employee" && a.scopeId).map((a) => a.scopeId as string)));
    const shiftIds = Array.from(new Set(assignments.filter((a) => a.scopeType === "shift" && a.scopeId).map((a) => a.scopeId as string)));
    const storeIds = Array.from(new Set(assignments.filter((a) => a.scopeType === "store" && a.scopeId).map((a) => a.scopeId as string)));

    const [employeeMap, shiftRows, storeRows] = await Promise.all([
      employeeIds.length ? employeeService.getByIds(employeeIds) : Promise.resolve(new Map<string, { fullName: string; employeeCode: string | null; storeName: string | null }>()),
      shiftIds.length
        ? supabase.from(SHIFTS).select("id, name, start_time, end_time").in("id", shiftIds)
        : Promise.resolve({ data: [] as { id: string; name: string; start_time: string; end_time: string }[], error: null }),
      storeIds.length
        ? supabase.from(STORES).select("id, name").in("id", storeIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    ]);

    for (const [id, employee] of employeeMap) {
      labels.set(scopeLabelKey("employee", id), `${employee.fullName} — ${employee.employeeCode ?? "—"}`);
    }
    for (const shift of shiftRows.data ?? []) {
      labels.set(scopeLabelKey("shift", shift.id), `${shift.name} — ${shift.start_time.slice(0, 5)} to ${shift.end_time.slice(0, 5)}`);
    }
    for (const store of storeRows.data ?? []) {
      labels.set(scopeLabelKey("store", store.id), store.name);
    }
    labels.set(scopeLabelKey("company", null), "Company Default");

    return labels;
  },

  /**
   * Store/Employee display labels for scope_type='store_employee' rows (migration 0062) — keyed
   * by the assignment's own id (these rows have no single scope_id to key by the way the
   * employee/shift/store/company rows do). "All Stores"/"All Employees" for a NULL store_id/
   * employee_id respectively.
   */
  async getStoreEmployeeLabels(assignments: RuleAssignment[]): Promise<Map<string, { storeLabel: string; employeeLabel: string }>> {
    const rows = assignments.filter((a) => a.scopeType === "store_employee");
    const storeIds = Array.from(new Set(rows.map((a) => a.storeId).filter((id): id is string => Boolean(id))));
    const employeeIds = Array.from(new Set(rows.map((a) => a.employeeId).filter((id): id is string => Boolean(id))));

    const [storeRows, employeeMap] = await Promise.all([
      storeIds.length ? supabase.from(STORES).select("id, name").in("id", storeIds) : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
      employeeIds.length ? employeeService.getByIds(employeeIds) : Promise.resolve(new Map<string, { fullName: string; employeeCode: string | null; storeName: string | null }>()),
    ]);
    const storeMap = new Map((storeRows.data ?? []).map((s) => [s.id, s.name]));

    const labels = new Map<string, { storeLabel: string; employeeLabel: string }>();
    for (const a of rows) {
      const storeLabel = a.storeId ? storeMap.get(a.storeId) ?? "—" : "All Stores";
      const employeeLabel = a.employeeId
        ? (() => {
            const emp = employeeMap.get(a.employeeId as string);
            return emp ? `${emp.fullName} — ${emp.employeeCode ?? "—"}` : "—";
          })()
        : "All Employees";
      labels.set(a.id, { storeLabel, employeeLabel });
    }
    return labels;
  },

  /**
   * Assigns a Late/Overtime rule (either or both) to a scope, effective from a date. Any existing
   * OPEN assignment for the exact same (scope_type, scope_id) is closed first — never overwritten
   * — so past attendance keeps resolving to whichever rule was assigned when it was calculated.
   */
  async assignRule(params: {
    companyId: string;
    scopeType: RuleScopeType;
    scopeId: string | null;
    lateRuleId: string | null;
    overtimeRuleId: string | null;
    effectiveFrom: string;
    remark?: string;
    userId?: string;
  }): Promise<void> {
    const { companyId, scopeType, scopeId, lateRuleId, overtimeRuleId, effectiveFrom, remark, userId } = params;

    let existingQuery = supabase
      .from(ASSIGNMENTS)
      .select("id")
      .eq("company_id", companyId)
      .eq("scope_type", scopeType)
      .is("effective_to", null);
    existingQuery = scopeId ? existingQuery.eq("scope_id", scopeId) : existingQuery.is("scope_id", null);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      await supabase.from(ASSIGNMENTS).update({ effective_to: dayBefore(effectiveFrom), updated_by: userId ?? null }).eq("id", existing.id);
    }

    const { error } = await supabase.from(ASSIGNMENTS).insert({
      company_id: companyId,
      scope_type: scopeType,
      scope_id: scopeId,
      late_rule_id: lateRuleId,
      overtime_rule_id: overtimeRuleId,
      effective_from: effectiveFrom,
      effective_to: null,
      is_active: true,
      remark: remark ?? null,
      created_by: userId ?? null,
      updated_by: userId ?? null,
    });
    if (error) throw error;
  },

  /**
   * Assigns a Late/Overtime rule using the Store x Employee scope model (migration 0062) —
   * All Stores / Selected Store(s) x All Employees / Selected Employee(s). Creates ONE
   * scope_type='store_employee' row per resolved (store_id, employee_id) pair (NULL = "All" for
   * either). "Selected Employees" always carries each employee's OWN store_id, so the stored row
   * literally reads as e.g. "MW STORE + Aparna Dutt" per the spec's examples. Any existing OPEN
   * assignment for the exact same (store_id, employee_id) key is closed first — versioned, never
   * overwritten — same pattern as assignRule()/every other rule table in this app, so past
   * attendance keeps resolving to whichever rule was assigned when it was calculated.
   */
  /**
   * Writes/versions the assignment AND, in the same server-side transaction, recalculates every
   * EXISTING attendance record the new/changed assignment now covers (migration 0064) — bounded to
   * this exact (store, employee, effective_from..effective_to) scope, through the same
   * authoritative compute_extended_attendance_facts() engine attendance_admin_upsert() uses. No
   * client-side calculation, no second engine. Each (store, employee) pair is one atomic RPC call:
   * either the assignment write AND its scoped recalculation both happen, or neither does.
   *
   * LIMITATION: when a caller selects MULTIPLE stores/employees, each pair's call is individually
   * atomic, but the pairs are NOT wrapped in one cross-pair transaction (Postgres RPC calls are
   * each their own transaction) — if pair 3 of 5 fails, pairs 1–2 have already been committed. This
   * method stops on the first error and throws immediately (never swallows a failure); the error
   * message reports how many pairs had already succeeded so the caller can see the partial state
   * rather than assume nothing happened.
   */
  async assignRuleScoped(params: {
    companyId: string;
    storeScope: "all" | "selected";
    storeIds: string[];
    employeeScope: "all" | "selected";
    employees: { id: string; storeId: string }[];
    /**
     * Each of the 8 rule-id fields is OPTIONAL and independent: omit a field entirely (leave it
     * `undefined`) to mean "Not Assigned / Keep Existing" — this NEVER touches whatever that rule
     * kind already resolves to for this scope (the existing row's value for that column, if any,
     * is carried forward unchanged into the new/updated row, server-side). Pass an explicit id (or
     * `null` to actively clear it) only for the rule kind(s) the admin is deliberately changing.
     * This is what makes "assign only Penalty to MW Store" leave Late/Weekly-Off/Information/
     * Half-Day/Early-Going/Overtime/Extended-Duty completely untouched for that same scope.
     */
    lateRuleId?: string | null;
    overtimeRuleId?: string | null;
    informationRuleId?: string | null;
    weeklyOffLateRuleId?: string | null;
    penaltyRuleId?: string | null;
    halfDayRuleId?: string | null;
    earlyGoingRuleId?: string | null;
    extendedDutyRuleId?: string | null;
    effectiveFrom: string;
    effectiveTo?: string | null;
    remark?: string;
    userId?: string;
  }): Promise<{ created: number; recalculated: number }> {
    const { companyId, storeScope, storeIds, employeeScope, employees, effectiveFrom, effectiveTo, remark, userId } = params;

    const pairs: { storeId: string | null; employeeId: string | null }[] =
      storeScope === "all"
        ? [{ storeId: null, employeeId: null }]
        : employeeScope === "all"
        ? storeIds.map((storeId) => ({ storeId, employeeId: null }))
        : employees.map((e) => ({ storeId: e.storeId, employeeId: e.id }));

    const touch = (id: string | null | undefined) => id !== undefined;
    const value = (id: string | null | undefined) => id ?? null;

    let created = 0;
    let recalculated = 0;

    for (const pair of pairs) {
      const { data, error } = await supabase.rpc("attendance_rule_assignment_upsert", {
        p_company_id: companyId,
        p_store_id: pair.storeId,
        p_employee_id: pair.employeeId,
        p_touch_late: touch(params.lateRuleId), p_late_rule_id: value(params.lateRuleId),
        p_touch_overtime: touch(params.overtimeRuleId), p_overtime_rule_id: value(params.overtimeRuleId),
        p_touch_information: touch(params.informationRuleId), p_information_rule_id: value(params.informationRuleId),
        p_touch_weekly_off_late: touch(params.weeklyOffLateRuleId), p_weekly_off_late_rule_id: value(params.weeklyOffLateRuleId),
        p_touch_penalty: touch(params.penaltyRuleId), p_penalty_rule_id: value(params.penaltyRuleId),
        p_touch_half_day: touch(params.halfDayRuleId), p_half_day_rule_id: value(params.halfDayRuleId),
        p_touch_early_going: touch(params.earlyGoingRuleId), p_early_going_rule_id: value(params.earlyGoingRuleId),
        p_touch_extended_duty: touch(params.extendedDutyRuleId), p_extended_duty_rule_id: value(params.extendedDutyRuleId),
        p_effective_from: effectiveFrom,
        p_effective_to: effectiveTo ?? null,
        p_remark: remark ?? null,
        p_user_id: userId ?? null,
      });

      if (error) {
        throw new Error(
          `Rule assignment failed for ${pair.storeId ?? "All Stores"} / ${pair.employeeId ?? "All Employees"} ` +
            `after ${created} of ${pairs.length} scope(s) already succeeded (${recalculated} attendance record(s) already recalculated): ${error.message}`
        );
      }

      const row = Array.isArray(data) ? data[0] : data;
      created += 1;
      recalculated += (row?.recalculated_count as number | undefined) ?? 0;
    }

    return { created, recalculated };
  },

  async unassignRule(assignmentId: string, userId?: string): Promise<void> {
    const { error } = await supabase
      .from(ASSIGNMENTS)
      .update({ effective_to: new Date().toISOString().slice(0, 10), is_active: false, updated_by: userId ?? null })
      .eq("id", assignmentId);
    if (error) throw error;
  },

  /**
   * Super Admin "start fresh" option: deactivates (never physically deletes) every Late Rule,
   * Overtime Rule, and Rule Assignment for the company via attendance_reset_late_overtime_rules().
   * Employees, attendance_records, shifts, and stores are never touched — the RPC re-verifies
   * is_super_admin() server-side regardless of this page's gate. Historical attendance rows keep
   * pointing at the now-inactive rule ids they were actually calculated with.
   */
  async resetLateOvertimeRules(companyId: string): Promise<{ lateRulesDeactivated: number; overtimeRulesDeactivated: number; assignmentsDeactivated: number }> {
    const { data, error } = await supabase.rpc("attendance_reset_late_overtime_rules", { p_company_id: companyId });
    if (error) throw error;
    return data as { lateRulesDeactivated: number; overtimeRulesDeactivated: number; assignmentsDeactivated: number };
  },
};
