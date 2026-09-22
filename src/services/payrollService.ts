import { supabase } from "@/lib/supabaseClient";
import type { Json } from "@/types/database.types";

import type {
  PayrollPeriodRow,
  PayrollRunResult,
  PayrollEmployeeResultDetail,
  PayrollLine,
  MyPayslipRow,
  PayslipSnapshot,
  PayrollAdvanceRecoveryReportRow,
  PayrollSalaryComponent,
  PayrollPolicy,
  SalaryStructure,
  SalaryStructureComponent,
  SalaryStructureDeleteCheck,
  SalaryBifurcationLine,
  EmployeeSalaryAssignment,
  SalaryResolveResult,
  PayrollPolicyV2,
  PayrollStatutoryRule,
  PayrollPtSlab,
  PayrollDeductionOrderRow,
  PayrollPolicyPreview,
  PayrollComponentAmount,
  PayrollComponentImportPreview,
  PayrollComponentImportResult,
  EmployeeGrade,
  EmployeeCategory,
  PayrollPolicyAssignment,
  StorePayrollCalendar,
  StoreCalendarPreview,
  TdsPolicy,
  TdsSlab,
} from "@/types/payroll";

/**
 * A raw PostgREST / RPC row. The payroll tables and RPC results are loosely typed in the generated database types (string-keyed),
 * so the mappers below read fields by name and coerce them (n / nn). ONE named alias keeps that single, deliberate looseness in one
 * place instead of an explicit-any annotation on every mapper.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function mapPeriod(r: DbRow): PayrollPeriodRow {
  return {
    id: r.id,
    periodMonth: r.period_month,
    periodStartDate: r.period_start_date,
    periodEndDate: r.period_end_date,
    label: r.label ?? null,
    status: r.status,
    currentRunId: r.current_run_id ?? null,
    runStatus: r.run_status ?? null,
    employeeCount: n(r.employee_count),
    grossTotal: n(r.gross_total),
    deductionTotal: n(r.deduction_total),
    advanceRecoveryTotal: n(r.advance_recovery_total),
    netTotal: n(r.net_total),
    finalizedAt: r.finalized_at ?? null,
    lockedAt: r.locked_at ?? null,
  };
}
function mapResult(r: DbRow): PayrollRunResult {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code ?? null,
    employeeName: r.employee_name ?? null,
    department: r.department ?? null,
    designation: r.designation ?? null,
    store: r.store ?? null,
    basic: n(r.basic),
    da: n(r.da),
    paidDays: n(r.paid_days),
    unpaidDays: n(r.unpaid_days),
    lwpDays: n(r.lwp_days),
    grossEarnings: n(r.gross_earnings),
    totalDeductions: n(r.total_deductions),
    advanceRecoveryAmount: n(r.advance_recovery_amount),
    netSalary: n(r.net_salary),
    employerContributionTotal: n(r.employer_contribution_total),
    salaryStructureId: r.salary_structure_id ?? null,
    grossFromStructure: nn(r.gross_from_structure),
    structureReconciled: r.structure_reconciled ?? null,
    hasNegativeNet: Boolean(r.has_negative_net),
    needsReview: Boolean(r.needs_review),
    reviewNotes: r.review_notes ?? null,
    status: r.status,
  };
}
function mapResultDetail(r: DbRow): PayrollEmployeeResultDetail {
  return {
    resultId: r.result_id,
    payrollRunId: r.payroll_run_id,
    runStatus: r.run_status,
    periodMonth: r.period_month,
    employeeId: r.employee_id,
    employeeCode: r.employee_code ?? null,
    employeeName: r.employee_name ?? null,
    department: r.department ?? null,
    designation: r.designation ?? null,
    store: r.store ?? null,
    salaryEffectiveFrom: r.salary_effective_from ?? null,
    basic: n(r.basic),
    da: n(r.da),
    calendarDays: n(r.calendar_days),
    workingDays: n(r.working_days),
    presentDays: n(r.present_days),
    paidLeaveDays: n(r.paid_leave_days),
    lwpDays: n(r.lwp_days),
    weeklyOffDays: n(r.weekly_off_days),
    holidayDays: n(r.holiday_days),
    absentDays: n(r.absent_days),
    paidDays: n(r.paid_days),
    unpaidDays: n(r.unpaid_days),
    grossEarnings: n(r.gross_earnings),
    totalDeductions: n(r.total_deductions),
    advanceRecoveryAmount: n(r.advance_recovery_amount),
    netSalary: n(r.net_salary),
    employerContributionTotal: n(r.employer_contribution_total),
    salaryStructureId: r.salary_structure_id ?? null,
    structureName: r.structure_name ?? null,
    grossFromStructure: nn(r.gross_from_structure),
    structureReconciled: r.structure_reconciled ?? null,
    payrollPolicyId: r.payroll_policy_id ?? null,
    policySnapshot: (r.policy_snapshot as Record<string, unknown> | null) ?? null,
    prorationFactor: nn(r.proration_factor),
    lwpDeductionAmount: n(r.lwp_deduction_amount),
    statutoryDeductionTotal: n(r.statutory_deduction_total),
    storeCalendarId: r.store_calendar_id ?? null,
    storeCalendarSnapshot: (r.store_calendar_snapshot as Record<string, unknown> | null) ?? null,
    exitProrationAmount: n(r.exit_proration_amount),
    eligibleDays: nn(r.eligible_days),
    salaryStructureScope: r.salary_structure_scope ?? null,
    payrollPolicyScope: r.payroll_policy_scope ?? null,
    leavingDateSnapshot: r.leaving_date_snapshot ?? null,
    hasNegativeNet: Boolean(r.has_negative_net),
    needsReview: Boolean(r.needs_review),
    reviewNotes: r.review_notes ?? null,
    status: r.status,
  };
}
function mapPolicyV2(r: DbRow): PayrollPolicyV2 {
  return {
    id: r.id, companyId: r.company_id, policyName: r.policy_name ?? null, code: r.code ?? null,
    versionNo: n(r.version_no), status: r.status, effectiveFrom: r.effective_from, effectiveTo: r.effective_to ?? null,
    previousPolicyId: r.previous_policy_id ?? null, payFrequency: r.pay_frequency,
    currencyPrecision: n(r.currency_precision), rounding: r.rounding,
    prorationMethod: r.proration_method ?? null, prorationBasis: r.proration_basis ?? null,
    prorationCustomDivisor: nn(r.proration_custom_divisor), prorationCustomFormula: r.proration_custom_formula ?? null,
    workingDaysMethod: r.working_days_method ?? null,
    lwpEnabled: Boolean(r.lwp_enabled), lwpBasis: r.lwp_basis ?? null, lwpDivisor: nn(r.lwp_divisor),
    lwpDivisorBasis: r.lwp_divisor_basis ?? null, lwpProrationMethod: r.lwp_proration_method ?? null,
    lwpHalfDaySupported: Boolean(r.lwp_half_day_supported), lwpRounding: r.lwp_rounding ?? null, lwpCustomFormula: r.lwp_custom_formula ?? null,
    otEnabled: Boolean(r.ot_enabled), otRateType: r.ot_rate_type ?? null, otRate: nn(r.ot_rate), otBasis: r.ot_basis ?? null,
    otStdHoursPerDay: nn(r.ot_std_hours_per_day), otMinHours: nn(r.ot_min_hours), otMaxHours: nn(r.ot_max_hours),
    otRounding: r.ot_rounding ?? null, otApprovalRequired: Boolean(r.ot_approval_required), otCustomFormula: r.ot_custom_formula ?? null,
    overtimeHourlyRate: nn(r.overtime_hourly_rate),
    otLateBasis: (r.ot_late_basis ?? null) as PayrollPolicyV2["otLateBasis"],
    otLateBasisComponentCode: r.ot_late_basis_component_code ?? null,
    otLateBasisFormula: r.ot_late_basis_formula ?? null,
    otLateDivisorMethod: (r.ot_late_divisor_method ?? null) as PayrollPolicyV2["otLateDivisorMethod"],
    otLateDivisorCustom: nn(r.ot_late_divisor_custom),
    lateDeductionEnabled: Boolean(r.late_deduction_enabled),
    ndEarningEnabled: Boolean(r.nd_earning_enabled), ndRateType: r.nd_rate_type ?? null, ndRate: nn(r.nd_rate),
    ndBasis: r.nd_basis ?? null, ndRounding: r.nd_rounding ?? null, ndCustomFormula: r.nd_custom_formula ?? null,
    nightDutyDayRate: nn(r.night_duty_day_rate),
    deductionCapMode: r.deduction_cap_mode ?? "none", deductionCapValue: nn(r.deduction_cap_value),
    deductionCapFormula: r.deduction_cap_formula ?? null, deductionCapPct: nn(r.deduction_cap_pct),
    negativeNetPolicy: r.negative_net_policy ?? "allow", allowNegativeNet: Boolean(r.allow_negative_net),
    exitDatePayable: r.exit_date_payable ?? null,
  };
}
function mapGrade(r: DbRow): EmployeeGrade {
  return { id: r.id, companyId: r.company_id, code: r.code, name: r.name, displayOrder: n(r.display_order), isActive: Boolean(r.is_active) };
}
function mapCategory(r: DbRow): EmployeeCategory {
  return { id: r.id, companyId: r.company_id, code: r.code, name: r.name, displayOrder: n(r.display_order), isActive: Boolean(r.is_active) };
}
function mapPolicyAssignment(r: DbRow): PayrollPolicyAssignment {
  return {
    id: r.id, payrollPolicyId: r.payroll_policy_id, scopeType: r.scope_type, employeeId: r.employee_id ?? null,
    gradeId: r.grade_id ?? null, categoryId: r.category_id ?? null, storeDesignationId: r.store_designation_id ?? null,
    storeDepartmentId: r.store_department_id ?? null, storeId: r.store_id ?? null, employmentType: r.employment_type ?? null,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to ?? null, priority: n(r.priority), isActive: Boolean(r.is_active),
  };
}
function mapCalendar(r: DbRow): StorePayrollCalendar {
  return {
    id: r.id, companyId: r.company_id, storeId: r.store_id ?? null, name: r.name, effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null, weeklyOffDays: (r.weekly_off_days ?? []) as number[], alternateSaturdayOff: Boolean(r.alternate_saturday_off),
    alternateSaturdayReference: r.alternate_saturday_reference ?? null, holidaySource: r.holiday_source, status: r.status,
  };
}
function mapTdsPolicy(r: DbRow): TdsPolicy {
  return {
    id: r.id, companyId: r.company_id, name: r.name, code: r.code, versionNo: n(r.version_no), status: r.status,
    taxRegime: r.tax_regime ?? null, financialYearStart: r.financial_year_start ?? null, financialYearEnd: r.financial_year_end ?? null,
    annualizationMethod: r.annualization_method ?? null, standardDeduction: nn(r.standard_deduction), rebateLimit: nn(r.rebate_limit),
    rebateAmount: nn(r.rebate_amount), cessPct: nn(r.cess_pct), effectiveFrom: r.effective_from, effectiveTo: r.effective_to ?? null,
  };
}
function mapTdsSlab(r: DbRow): TdsSlab {
  return { id: r.id, tdsPolicyId: r.tds_policy_id, minIncome: n(r.min_income), maxIncome: nn(r.max_income), rate: n(r.rate), fixedComponent: n(r.fixed_component), label: r.label ?? null };
}
function mapStatutoryRule(r: DbRow): PayrollStatutoryRule {
  return {
    id: r.id, payrollPolicyId: r.payroll_policy_id, kind: r.kind, enabled: Boolean(r.enabled),
    calcMethod: (r.calc_method ?? "pct_of_base") as PayrollStatutoryRule["calcMethod"],
    calcBase: r.calc_base ?? null, baseFormula: r.base_formula ?? null, employerFormula: r.employer_formula ?? null,
    employeeRate: nn(r.employee_rate), employerRate: nn(r.employer_rate),
    employeeAmount: nn(r.employee_amount), employerAmount: nn(r.employer_amount),
    refComponentCode: r.ref_component_code ?? null,
    wageCeiling: nn(r.wage_ceiling), rounding: r.rounding ?? null,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to ?? null, remark: r.remark ?? null,
    componentCode: r.component_code ?? null, componentName: r.component_name ?? null, componentType: r.component_type ?? null,
    eligibilityType: (r.eligibility_type ?? "always") as "always" | "after_months", eligibilityMonths: nn(r.eligibility_months),
  };
}
function mapComponentAmount(r: DbRow): PayrollComponentAmount {
  return {
    id: r.id, payrollPeriodId: r.payroll_period_id, employeeId: r.employee_id, componentCode: r.component_code,
    employeeAmount: nn(r.employee_amount), employerAmount: nn(r.employer_amount),
    source: r.source, importBatchId: r.import_batch_id ?? null, note: r.note ?? null,
    updatedBy: r.updated_by ?? null, updatedAt: r.updated_at ?? null,
  };
}
function mapPtSlab(r: DbRow): PayrollPtSlab {
  return {
    id: r.id, payrollPolicyId: r.payroll_policy_id, minSalary: n(r.min_salary), maxSalary: nn(r.max_salary),
    amount: n(r.amount), label: r.label ?? null, effectiveFrom: r.effective_from, effectiveTo: r.effective_to ?? null,
  };
}
function mapDeductionOrder(r: DbRow): PayrollDeductionOrderRow {
  return { id: r.id, payrollPolicyId: r.payroll_policy_id, deductionCode: r.deduction_code, priority: n(r.priority), isActive: Boolean(r.is_active) };
}
function mapLine(r: DbRow): PayrollLine {
  return {
    lineType: r.line_type,
    code: r.code,
    name: r.name,
    quantity: nn(r.quantity),
    rate: nn(r.rate),
    amount: n(r.amount),
    source: r.source ?? null,
    calcType: r.calc_type ?? null,
    calcBase: r.calc_base ?? null,
    calcRate: nn(r.calc_rate),
    calcFormula: r.calc_formula ?? null,
    calculationRef: r.calculation_ref ?? null,
    isReversal: Boolean(r.is_reversal),
    sortOrder: n(r.sort_order),
  };
}
function mapStructure(r: DbRow): SalaryStructure {
  return {
    id: r.id,
    companyId: r.company_id,
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    status: r.status,
    grossBalanced: Boolean(r.gross_balanced),
    allowNegativeBalance: Boolean(r.allow_negative_balance),
    rounding: r.rounding,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
    previousVersionId: r.previous_version_id ?? null,
  };
}
function mapStructureComponent(r: DbRow): SalaryStructureComponent {
  return {
    id: r.id,
    salaryStructureId: r.salary_structure_id,
    code: r.code,
    name: r.name,
    category: r.category,
    calculationType: r.calculation_type,
    fixedAmount: nn(r.fixed_amount),
    percentage: nn(r.percentage),
    baseComponentCode: r.base_component_code ?? null,
    formulaExpression: r.formula_expression ?? null,
    isBasic: Boolean(r.is_basic),
    includedInGross: Boolean(r.included_in_gross),
    includedInCtc: Boolean(r.included_in_ctc),
    isTaxable: Boolean(r.is_taxable),
    isStatutory: Boolean(r.is_statutory),
    statutoryKind: r.statutory_kind ?? null,
    statutoryBase: r.statutory_base ?? null,
    statutoryRate: nn(r.statutory_rate),
    statutoryCeiling: nn(r.statutory_ceiling),
    rounding: r.rounding ?? null,
    displayOrder: n(r.display_order),
    isActive: Boolean(r.is_active),
  };
}
function mapBifurcation(r: DbRow): SalaryBifurcationLine {
  return {
    code: r.code,
    name: r.name,
    category: r.category,
    calculationType: r.calculation_type,
    calcBase: r.calc_base ?? null,
    calcRate: nn(r.calc_rate),
    calcFormula: r.calc_formula ?? null,
    amount: n(r.amount),
    includedInGross: Boolean(r.included_in_gross),
    isStatutory: Boolean(r.is_statutory),
  };
}
function mapEmployeeAssignment(r: DbRow): EmployeeSalaryAssignment {
  return {
    id: r.id,
    grossSalary: n(r.gross_salary),
    salaryStructureId: r.salary_structure_id ?? null,
    structureName: r.structure_name ?? null,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
    reason: r.reason ?? null,
    remark: r.remark ?? null,
    createdAt: r.created_at,
    previousGross: nn(r.previous_gross),
    previousStructureName: r.previous_structure_name ?? null,
    resolvedStructureId: r.resolved_structure_id ?? null,
    resolvedStructureName: r.resolved_structure_name ?? null,
    resolvedStructureCode: r.resolved_structure_code ?? null,
    assignedByName: r.assigned_by_name ?? null,
  };
}
function mapMyPayslip(r: DbRow): MyPayslipRow {
  return {
    resultId: r.result_id,
    payslipId: r.payslip_id ?? null,
    payslipNumber: r.payslip_number ?? null,
    periodMonth: r.period_month,
    runStatus: r.run_status,
    grossEarnings: n(r.gross_earnings),
    totalDeductions: n(r.total_deductions),
    advanceRecoveryAmount: n(r.advance_recovery_amount),
    netSalary: n(r.net_salary),
    status: r.status,
  };
}
function mapComponent(r: DbRow): PayrollSalaryComponent {
  return {
    id: r.id,
    companyId: r.company_id,
    code: r.code,
    name: r.name,
    componentType: r.component_type,
    calculationMethod: r.calculation_method,
    source: r.source ?? null,
    isTaxable: Boolean(r.is_taxable),
    isStatutory: Boolean(r.is_statutory),
    isActive: Boolean(r.is_active),
    sortOrder: n(r.sort_order),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
  };
}
function mapPolicy(r: DbRow): PayrollPolicy {
  return {
    id: r.id,
    companyId: r.company_id,
    payFrequency: r.pay_frequency,
    lwpDivisor: nn(r.lwp_divisor),
    lwpDivisorBasis: r.lwp_divisor_basis ?? null,
    prorationMethod: r.proration_method ?? null,
    overtimeHourlyRate: nn(r.overtime_hourly_rate),
    nightDutyDayRate: nn(r.night_duty_day_rate),
    deductionCapPct: nn(r.deduction_cap_pct),
    allowNegativeNet: Boolean(r.allow_negative_net),
    rounding: r.rounding,
  };
}

export const payrollService = {
  async listPeriods(companyId: string): Promise<PayrollPeriodRow[]> {
    const { data, error } = await supabase.rpc("payroll_list_periods", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapPeriod);
  },
  async createPeriod(companyId: string, periodMonth: string, label?: string | null): Promise<void> {
    const { error } = await supabase.rpc("payroll_create_period", { p_company_id: companyId, p_period_month: periodMonth, p_label: label ?? undefined });
    if (error) throw error;
  },
  async startRun(periodId: string): Promise<{ id: string }> {
    const { data, error } = await supabase.rpc("payroll_start_run", { p_payroll_period_id: periodId });
    if (error) throw error;
    return { id: (data as DbRow).id };
  },
  async calculateRun(runId: string): Promise<void> {
    const { error } = await supabase.rpc("payroll_calculate_run", { p_payroll_run_id: runId });
    if (error) throw error;
  },
  async finalizeRun(runId: string): Promise<void> {
    const { error } = await supabase.rpc("payroll_finalize_run", { p_payroll_run_id: runId });
    if (error) throw error;
  },
  async lockRun(runId: string): Promise<void> {
    const { error } = await supabase.rpc("payroll_lock_run", { p_payroll_run_id: runId });
    if (error) throw error;
  },
  async reverseRun(runId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc("payroll_reverse_run", { p_payroll_run_id: runId, p_reason: reason });
    if (error) throw error;
  },
  async listRunResults(runId: string): Promise<PayrollRunResult[]> {
    const { data, error } = await supabase.rpc("payroll_list_run_results", { p_payroll_run_id: runId });
    if (error) throw error;
    return (data ?? []).map(mapResult);
  },
  async getEmployeeResult(resultId: string): Promise<PayrollEmployeeResultDetail | null> {
    const { data, error } = await supabase.rpc("payroll_get_employee_result", { p_result_id: resultId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapResultDetail(row) : null;
  },
  async listResultLines(resultId: string): Promise<PayrollLine[]> {
    const { data, error } = await supabase.rpc("payroll_list_employee_result_lines", { p_result_id: resultId });
    if (error) throw error;
    return (data ?? []).map(mapLine);
  },
  async listMyPayslips(): Promise<MyPayslipRow[]> {
    const { data, error } = await supabase.rpc("payroll_list_my_payslips");
    if (error) throw error;
    return (data ?? []).map(mapMyPayslip);
  },
  async getPayslip(resultId: string): Promise<PayslipSnapshot | null> {
    const { data, error } = await supabase.rpc("payroll_get_payslip", { p_result_id: resultId });
    if (error) throw error;
    return (data as unknown as PayslipSnapshot) ?? null;
  },
  async reportAdvanceRecovery(runId: string): Promise<PayrollAdvanceRecoveryReportRow[]> {
    const { data, error } = await supabase.rpc("payroll_report_advance_recovery", { p_payroll_run_id: runId });
    if (error) throw error;
    return (data ?? []).map((r: DbRow) => ({
      employeeName: r.employee_name,
      employeeCode: r.employee_code ?? null,
      advanceTypeName: r.advance_type_name,
      actualPaidAmount: n(r.actual_paid_amount),
      recoveredThisPeriod: n(r.recovered_this_period),
      totalRecovered: n(r.total_recovered),
      outstandingAmount: n(r.outstanding_amount),
      periodMonth: r.period_month,
    }));
  },
  async amIPayrollAdmin(companyId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("payroll_can_manage", { p_company_id: companyId });
    if (error) throw error;
    return Boolean(data);
  },

  // ---- config: salary components + policy (direct table, Super Admin write) ----
  async listComponents(companyId: string): Promise<PayrollSalaryComponent[]> {
    const { data, error } = await supabase.from("payroll_salary_components").select("*").eq("company_id", companyId).order("component_type").order("sort_order");
    if (error) throw error;
    return (data ?? []).map(mapComponent);
  },
  async upsertComponent(params: {
    id?: string;
    companyId: string;
    code: string;
    name: string;
    componentType: "earning" | "deduction";
    calculationMethod: string;
    source?: string | null;
    isTaxable: boolean;
    isStatutory: boolean;
    isActive: boolean;
    sortOrder: number;
    userId?: string | null;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      company_id: params.companyId,
      code: params.code,
      name: params.name,
      component_type: params.componentType,
      calculation_method: params.calculationMethod,
      source: params.source ?? null,
      is_taxable: params.isTaxable,
      is_statutory: params.isStatutory,
      is_active: params.isActive,
      sort_order: params.sortOrder,
      updated_by: params.userId ?? null,
    };
    if (params.id) {
      const { error } = await supabase.from("payroll_salary_components").update(payload).eq("id", params.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("payroll_salary_components").insert({ ...payload, created_by: params.userId ?? null });
      if (error) throw error;
    }
  },
  async getPolicy(companyId: string): Promise<PayrollPolicy | null> {
    const { data, error } = await supabase.from("payroll_policies").select("*").eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    return data ? mapPolicy(data) : null;
  },
  async upsertPolicy(params: { companyId: string; values: Record<string, unknown>; userId?: string | null }): Promise<void> {
    const { data: existing } = await supabase.from("payroll_policies").select("id").eq("company_id", params.companyId).maybeSingle();
    const payload = { ...params.values, company_id: params.companyId, updated_by: params.userId ?? null };
    if (existing) {
      const { error } = await supabase.from("payroll_policies").update(payload).eq("id", (existing as DbRow).id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("payroll_policies").insert({ ...payload, created_by: params.userId ?? null });
      if (error) throw error;
    }
  },

  // ======================================================================
  // Phase 5A — Dynamic Salary Bifurcation
  // ======================================================================
  async listStructures(companyId: string): Promise<SalaryStructure[]> {
    const { data, error } = await supabase.rpc("salary_list_structures", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapStructure);
  },
  async listStructureComponents(structureId: string): Promise<SalaryStructureComponent[]> {
    const { data, error } = await supabase.rpc("salary_list_structure_components", { p_structure_id: structureId });
    if (error) throw error;
    return (data ?? []).map(mapStructureComponent);
  },
  async preview(structureId: string, gross: number): Promise<SalaryBifurcationLine[]> {
    const { data, error } = await supabase.rpc("salary_preview", { p_structure_id: structureId, p_gross: gross });
    if (error) throw error;
    return (data ?? []).map(mapBifurcation);
  },
  async validateStructure(structureId: string): Promise<{ ok: boolean; error: string | null }> {
    const { data, error } = await supabase.rpc("salary_structure_validate", { p_structure_id: structureId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { ok: Boolean((row as DbRow).ok), error: (row as DbRow).error ?? null } : { ok: false, error: "No result." };
  },
  async activateStructure(structureId: string): Promise<void> {
    const { error } = await supabase.rpc("salary_structure_activate", { p_structure_id: structureId });
    if (error) throw error;
  },
  /** Read-only eligibility + counts for the delete confirmation (Super Admin only — enforced in the RPC). */
  async getStructureDeleteCheck(structureId: string): Promise<SalaryStructureDeleteCheck> {
    const { data, error } = await supabase.rpc("salary_structure_delete_check", { p_structure_id: structureId });
    if (error) throw error;
    const r = data as DbRow;
    return {
      id: r.id, code: r.code, name: r.name, status: r.status,
      componentCount: n(r.component_count), slabCount: n(r.slab_count), ruleAssignmentCount: n(r.rule_assignment_count),
      employeeAssignmentCount: n(r.employee_assignment_count), payrollUseCount: n(r.payroll_use_count), protectedReferenceCount: n(r.protected_reference_count),
      isAssignedToEmployees: Boolean(r.is_assigned_to_employees), usedInPayroll: Boolean(r.used_in_payroll),
      canDelete: Boolean(r.can_delete), blockCode: r.block_code ?? null, blockMessage: r.block_message ?? null,
    };
  },
  /** Permanent delete. Authorization + every protected-reference check are enforced in the RPC, not here. */
  async deleteStructure(structureId: string): Promise<void> {
    const { error } = await supabase.rpc("salary_structure_delete", { p_structure_id: structureId });
    if (error) throw error;
  },
  async cloneStructure(structureId: string, newCode: string, newName: string): Promise<void> {
    const { error } = await supabase.rpc("salary_structure_clone", { p_structure_id: structureId, p_new_code: newCode, p_new_name: newName });
    if (error) throw error;
  },
  async createStructure(params: {
    companyId: string; code: string; name: string; grossBalanced: boolean; allowNegativeBalance: boolean;
    rounding: string; effectiveFrom: string; description?: string | null; userId?: string | null;
  }): Promise<{ id: string }> {
    const { data, error } = await supabase.from("salary_structures").insert({
      company_id: params.companyId, code: params.code, name: params.name, description: params.description ?? null,
      status: "draft", gross_balanced: params.grossBalanced, allow_negative_balance: params.allowNegativeBalance,
      rounding: params.rounding, effective_from: params.effectiveFrom, created_by: params.userId ?? null, updated_by: params.userId ?? null,
    }).select("id").single();
    if (error) throw error;
    return { id: (data as DbRow).id };
  },
  async updateStructure(id: string, values: Record<string, unknown>, userId?: string | null): Promise<void> {
    const { error } = await supabase.from("salary_structures").update({ ...values, updated_by: userId ?? null }).eq("id", id);
    if (error) throw error;
  },
  async upsertStructureComponent(params: {
    id?: string; companyId: string; salaryStructureId: string; code: string; name: string;
    category: string; calculationType: string; fixedAmount?: number | null; percentage?: number | null;
    baseComponentCode?: string | null; formulaExpression?: string | null; isBasic: boolean;
    includedInGross: boolean; includedInCtc: boolean; isTaxable: boolean; isStatutory: boolean;
    statutoryKind?: string | null; statutoryBase?: string | null; statutoryRate?: number | null;
    statutoryCeiling?: number | null; rounding?: string | null; displayOrder: number; isActive: boolean; userId?: string | null;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      company_id: params.companyId, salary_structure_id: params.salaryStructureId, code: params.code, name: params.name,
      category: params.category, calculation_type: params.calculationType,
      fixed_amount: params.fixedAmount ?? null, percentage: params.percentage ?? null,
      base_component_code: params.baseComponentCode ?? null, formula_expression: params.formulaExpression ?? null,
      is_basic: params.isBasic, included_in_gross: params.includedInGross, included_in_ctc: params.includedInCtc,
      is_taxable: params.isTaxable, is_statutory: params.isStatutory, statutory_kind: params.statutoryKind ?? null,
      statutory_base: params.statutoryBase ?? null, statutory_rate: params.statutoryRate ?? null,
      statutory_ceiling: params.statutoryCeiling ?? null, rounding: params.rounding ?? null,
      display_order: params.displayOrder, is_active: params.isActive, updated_by: params.userId ?? null,
    };
    if (params.id) {
      const { error } = await supabase.from("salary_structure_components").update(payload).eq("id", params.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("salary_structure_components").insert({ ...payload, created_by: params.userId ?? null });
      if (error) throw error;
    }
  },
  async deleteStructureComponent(id: string): Promise<void> {
    const { error } = await supabase.from("salary_structure_components").delete().eq("id", id);
    if (error) throw error;
  },
  async listSlabRules(companyId: string): Promise<Array<{ id: string; salaryStructureId: string; minGross: number; maxGross: number | null; label: string | null; isActive: boolean }>> {
    const { data, error } = await supabase.from("salary_slab_rules").select("*").eq("company_id", companyId).order("min_gross");
    if (error) throw error;
    return (data ?? []).map((r: DbRow) => ({
      id: r.id, salaryStructureId: r.salary_structure_id, minGross: n(r.min_gross), maxGross: nn(r.max_gross), label: r.label ?? null, isActive: Boolean(r.is_active),
    }));
  },
  async addSlabRule(params: { companyId: string; salaryStructureId: string; minGross: number; maxGross: number | null; label?: string | null; userId?: string | null }): Promise<void> {
    const { error } = await supabase.from("salary_slab_rules").insert({
      company_id: params.companyId, salary_structure_id: params.salaryStructureId, min_gross: params.minGross,
      max_gross: params.maxGross, label: params.label ?? null, is_active: true, created_by: params.userId ?? null, updated_by: params.userId ?? null,
    });
    if (error) throw error;
  },
  async deleteSlabRule(id: string): Promise<void> {
    const { error } = await supabase.from("salary_slab_rules").delete().eq("id", id);
    if (error) throw error;
  },
  async listEmployeeAssignments(employeeId: string): Promise<EmployeeSalaryAssignment[]> {
    const { data, error } = await supabase.rpc("salary_list_employee_assignments", { p_employee_id: employeeId });
    if (error) throw error;
    return (data ?? []).map(mapEmployeeAssignment);
  },
  async assignEmployeeSalary(params: {
    employeeId: string; grossSalary: number; effectiveFrom: string; salaryStructureId?: string | null; reason?: string | null; remark?: string | null;
  }): Promise<void> {
    const { error } = await supabase.rpc("salary_assign_employee", {
      p_employee_id: params.employeeId, p_gross_salary: params.grossSalary, p_effective_from: params.effectiveFrom,
      p_salary_structure_id: params.salaryStructureId ?? null, p_reason: params.reason ?? null, p_remark: params.remark ?? null,
    });
    if (error) throw error;
  },
  async resolveForEmployee(employeeId: string, asOf: string): Promise<SalaryResolveResult | null> {
    // Guarded server-side (own salary, payroll manager, or same-company non-staff). The raw resolver is internal-only since 0179.
    const { data, error } = await supabase.rpc("salary_resolve_secure", { p_employee_id: employeeId, p_as_of: asOf });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      grossSalary: n((row as DbRow).gross_salary),
      salaryStructureId: (row as DbRow).salary_structure_id ?? null,
      structureName: (row as DbRow).structure_name ?? null,
      source: (row as DbRow).source ?? null,
      ambiguous: Boolean((row as DbRow).ambiguous),
      resolveNote: (row as DbRow).resolve_note ?? null,
    };
  },

  // ======================================================================
  // Phase 6 — Payroll Policy Engine
  // ======================================================================
  async listPolicies(companyId: string): Promise<PayrollPolicyV2[]> {
    const { data, error } = await supabase.rpc("payroll_policy_list", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapPolicyV2);
  },
  async resolvePolicy(companyId: string, asOf: string): Promise<PayrollPolicyV2 | null> {
    const { data, error } = await supabase.rpc("payroll_resolve_policy", { p_company_id: companyId, p_as_of: asOf });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row && (row as DbRow).id ? mapPolicyV2(row) : null;
  },
  async createPolicyVersion(params: { companyId: string; policyName: string; code: string; effectiveFrom: string; previousPolicyId?: string | null; userId?: string | null }): Promise<{ id: string }> {
    const src = params.previousPolicyId
      ? (await supabase.from("payroll_policies").select("*").eq("id", params.previousPolicyId).single()).data
      : null;
    const base = src ? { ...(src as Record<string, unknown>) } : {};
    delete (base as DbRow).id; delete (base as DbRow).created_at; delete (base as DbRow).updated_at;
    const maxV = (await supabase.from("payroll_policies").select("version_no").eq("company_id", params.companyId).order("version_no", { ascending: false }).limit(1)).data as DbRow[] | null;
    const { data, error } = await supabase.from("payroll_policies").insert({
      ...base,
      company_id: params.companyId, policy_name: params.policyName, code: params.code, effective_from: params.effectiveFrom,
      effective_to: null, status: "draft", version_no: (maxV?.[0]?.version_no ?? 1) + 1,
      previous_policy_id: params.previousPolicyId ?? null, created_by: params.userId ?? null, updated_by: params.userId ?? null,
    }).select("id").single();
    if (error) throw error;
    return { id: (data as DbRow).id };
  },
  async updatePolicy(id: string, values: Record<string, unknown>, userId?: string | null): Promise<void> {
    const { error } = await supabase.from("payroll_policies").update({ ...values, updated_by: userId ?? null }).eq("id", id);
    if (error) throw error;
  },
  async validatePolicy(policyId: string): Promise<{ ok: boolean; error: string | null }> {
    const { data, error } = await supabase.rpc("payroll_policy_validate", { p_policy_id: policyId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { ok: Boolean((row as DbRow).ok), error: (row as DbRow).error ?? null } : { ok: false, error: "No result." };
  },
  async activatePolicy(policyId: string): Promise<void> {
    const { error } = await supabase.rpc("payroll_policy_activate", { p_policy_id: policyId });
    if (error) throw error;
  },
  /** employeeId = null runs the SAME engine as a read-only "virtual employee" (Add Employee screen / Salary Structure Test): inputs need company_id + gross. */
  async previewPolicy(employeeId: string | null, periodMonth: string, inputs: Record<string, unknown>): Promise<PayrollPolicyPreview> {
    const { data, error } = await supabase.rpc("payroll_policy_preview", { p_employee_id: employeeId, p_period_month: periodMonth, p_inputs: inputs as Json });
    if (error) throw error;
    return data as unknown as PayrollPolicyPreview;
  },
  async listStatutoryRules(policyId: string): Promise<PayrollStatutoryRule[]> {
    const { data, error } = await supabase.from("payroll_statutory_rules").select("*").eq("payroll_policy_id", policyId).order("kind");
    if (error) throw error;
    return (data ?? []).map(mapStatutoryRule);
  },
  async upsertStatutoryRule(params: {
    id?: string; companyId: string; payrollPolicyId: string; kind: string; enabled: boolean; calcMethod?: string | null;
    calcBase?: string | null; baseFormula?: string | null; employerFormula?: string | null;
    employeeRate?: number | null; employerRate?: number | null; employeeAmount?: number | null; employerAmount?: number | null;
    refComponentCode?: string | null; wageCeiling?: number | null;
    rounding?: string | null; effectiveFrom: string; userId?: string | null;
    /** Migration 0178 — set all three (with kind "other") to define a named Common Payroll Component. */
    componentCode?: string | null; componentName?: string | null; componentType?: "earning" | "deduction" | null;
    /** Migration 0181 — omit to leave a rule 'always' applicable; 'after_months' needs eligibilityMonths (stored as data on the rule). */
    eligibilityType?: "always" | "after_months"; eligibilityMonths?: number | null;
  }): Promise<void> {
    const payload = {
      // Only written when the caller supplies it — other editors (PF / ESI rules) must never reset a rule's eligibility.
      ...(params.eligibilityType !== undefined
        ? { eligibility_type: params.eligibilityType, eligibility_months: params.eligibilityType === "after_months" ? (params.eligibilityMonths ?? null) : null }
        : {}),
      component_code: params.componentCode ?? null, component_name: params.componentName ?? null, component_type: params.componentType ?? null,
      company_id: params.companyId, payroll_policy_id: params.payrollPolicyId, kind: params.kind, enabled: params.enabled,
      calc_method: params.calcMethod ?? "pct_of_base",
      calc_base: params.calcBase ?? null, base_formula: params.baseFormula ?? null, employer_formula: params.employerFormula ?? null,
      employee_rate: params.employeeRate ?? null, employer_rate: params.employerRate ?? null,
      employee_amount: params.employeeAmount ?? null, employer_amount: params.employerAmount ?? null,
      ref_component_code: params.refComponentCode ?? null,
      wage_ceiling: params.wageCeiling ?? null, rounding: params.rounding ?? null,
      effective_from: params.effectiveFrom, updated_by: params.userId ?? null,
    };
    if (params.id) {
      const { error } = await supabase.from("payroll_statutory_rules").update(payload).eq("id", params.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("payroll_statutory_rules").insert({ ...payload, created_by: params.userId ?? null });
      if (error) throw error;
    }
  },
  /** Runs a Custom Formula through the SAME evaluator payroll uses (GROSS / BASIC / DA). Nothing is saved. */
  async testFormula(expr: string, gross: number, basic?: number | null, da?: number | null): Promise<{ ok: boolean; value?: number; error?: string }> {
    const { data, error } = await supabase.rpc("payroll_formula_test", { p_expr: expr, p_gross: gross, p_basic: basic ?? null, p_da: da ?? null });
    if (error) throw error;
    const r = data as { ok: boolean; value?: number | string; error?: string };
    return { ok: Boolean(r.ok), value: r.value == null ? undefined : Number(r.value), error: r.error };
  },
  /** Migration 0182 — tests the WHOLE component (amount formula + service eligibility) on the server. Test inputs only; nothing is saved or read. */
  async testComponent(p: {
    expr: string; gross: number; basic?: number | null; da?: number | null;
    eligibilityType: "always" | "after_months"; eligibilityMonths?: number | null; joiningDate?: string | null; payrollMonth?: string | null;
  }): Promise<{ ok: boolean; error?: string; applicable?: boolean; value?: number; amountIfEligible?: number; needsReview?: boolean; note?: string | null }> {
    const { data, error } = await supabase.rpc("payroll_component_test", {
      p_expr: p.expr, p_gross: p.gross, p_basic: p.basic ?? null, p_da: p.da ?? null,
      p_eligibility_type: p.eligibilityType, p_eligibility_months: p.eligibilityType === "after_months" ? (p.eligibilityMonths ?? null) : null,
      p_joining_date: p.joiningDate || null, p_payroll_month: p.payrollMonth || null,
    });
    if (error) throw error;
    const r = data as { ok: boolean; error?: string; applicable?: boolean; value?: number | string; amount_if_eligible?: number | string; needs_review?: boolean; note?: string | null };
    return {
      ok: Boolean(r.ok), error: r.error, applicable: r.applicable, value: r.value == null ? undefined : Number(r.value),
      amountIfEligible: r.amount_if_eligible == null ? undefined : Number(r.amount_if_eligible), needsReview: r.needs_review, note: r.note ?? null,
    };
  },
  /** Removes a Common Payroll Component rule (Super Admin — RLS). Only named components; PF/ESI/PT/TDS rules are disabled, not deleted. */
  async deleteStatutoryRule(id: string): Promise<void> {
    const { error } = await supabase.from("payroll_statutory_rules").delete().eq("id", id).not("component_code", "is", null);
    if (error) throw error;
  },
  async listPtSlabs(policyId: string): Promise<PayrollPtSlab[]> {
    const { data, error } = await supabase.from("payroll_pt_slabs").select("*").eq("payroll_policy_id", policyId).order("min_salary");
    if (error) throw error;
    return (data ?? []).map(mapPtSlab);
  },
  async addPtSlab(params: { companyId: string; payrollPolicyId: string; minSalary: number; maxSalary: number | null; amount: number; effectiveFrom: string; userId?: string | null }): Promise<void> {
    const { error } = await supabase.from("payroll_pt_slabs").insert({
      company_id: params.companyId, payroll_policy_id: params.payrollPolicyId, min_salary: params.minSalary,
      max_salary: params.maxSalary, amount: params.amount, effective_from: params.effectiveFrom,
      created_by: params.userId ?? null, updated_by: params.userId ?? null,
    });
    if (error) throw error;
  },
  async deletePtSlab(id: string): Promise<void> {
    const { error } = await supabase.from("payroll_pt_slabs").delete().eq("id", id);
    if (error) throw error;
  },

  // ======================================================================
  // PF / ESI per-employee, per-period manual + Excel-imported amounts
  // (calc_method = 'manual'). OT is never eligible here.
  // ======================================================================
  async listComponentAmounts(periodId: string): Promise<PayrollComponentAmount[]> {
    const { data, error } = await supabase.from("payroll_component_amounts").select("*").eq("payroll_period_id", periodId);
    if (error) throw error;
    return (data ?? []).map(mapComponentAmount);
  },
  /** Migration 0175 — every component code currently eligible for a Manual/Excel-import amount in
   *  this company (PF/ESI always, plus any component — e.g. Incentive — a Super Admin has set to
   *  "Manual / Excel Import" in Salary Components). Never hard-coded on the frontend. */
  async listComponentImportCodes(companyId: string): Promise<string[]> {
    const { data, error } = await supabase.rpc("payroll_component_import_codes", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []) as string[];
  },
  async setComponentAmount(params: {
    periodId: string; employeeId: string; componentCode: string;
    employeeAmount: number | null; employerAmount?: number | null; note?: string | null;
  }): Promise<void> {
    const { error } = await supabase.rpc("payroll_component_amount_set", {
      p_period_id: params.periodId, p_employee_id: params.employeeId, p_component_code: params.componentCode,
      p_employee_amount: params.employeeAmount, p_employer_amount: params.employerAmount ?? null, p_note: params.note ?? null,
    });
    if (error) throw error;
  },
  async bulkSetComponentAmounts(periodId: string, rows: Array<{ employeeId: string; componentCode: string; employeeAmount: number | null; employerAmount?: number | null; note?: string | null }>): Promise<{ saved: number; cleared: number }> {
    const { data, error } = await supabase.rpc("payroll_component_amounts_bulk_set", {
      p_period_id: periodId,
      p_rows: rows.map((r) => ({
        employee_id: r.employeeId, component_code: r.componentCode,
        employee_amount: r.employeeAmount == null ? "" : String(r.employeeAmount),
        employer_amount: r.employerAmount == null ? "" : String(r.employerAmount),
        note: r.note ?? null,
      })) as Json,
    });
    if (error) throw error;
    return (data ?? { saved: 0, cleared: 0 }) as { saved: number; cleared: number };
  },
  async previewComponentImport(params: {
    companyId: string; periodId: string; componentCodes: string[];
    rows: Array<{ rowNumber: number; staffId: string; staffName: string; amounts: Record<string, string> }>;
  }): Promise<PayrollComponentImportPreview> {
    const { data, error } = await supabase.rpc("payroll_component_import_preview", {
      p_company_id: params.companyId, p_period_id: params.periodId, p_component_codes: params.componentCodes,
      p_rows: params.rows.map((r) => ({ row_number: r.rowNumber, staff_id: r.staffId, staff_name: r.staffName, amounts: r.amounts })) as Json,
    });
    if (error) throw error;
    const d = data as DbRow;
    return {
      period: d.period,
      componentCodes: d.component_codes ?? [],
      summary: d.summary,
      rows: (d.rows ?? []).map((r: DbRow) => ({
        rowNumber: r.row_number, staffId: r.staff_id, staffName: r.staff_name,
        employeeId: r.employee_id ?? null, matchedName: r.matched_name ?? null, matchedCode: r.matched_code ?? null,
        state: r.state, messages: r.messages ?? [], components: r.components ?? {},
      })),
    };
  },
  async commitComponentImport(params: {
    companyId: string; periodId: string; componentCodes: string[]; fileName?: string | null;
    rows: Array<{ rowNumber: number; staffId: string; staffName: string; amounts: Record<string, string> }>;
  }): Promise<PayrollComponentImportResult> {
    const { data, error } = await supabase.rpc("payroll_component_import_commit", {
      p_company_id: params.companyId, p_period_id: params.periodId, p_component_codes: params.componentCodes,
      p_file_name: params.fileName ?? null,
      p_rows: params.rows.map((r) => ({ row_number: r.rowNumber, staff_id: r.staffId, staff_name: r.staffName, amounts: r.amounts })) as Json,
    });
    if (error) throw error;
    const d = data as DbRow;
    return {
      batchId: d.batch_id, imported: n(d.imported), updated: n(d.updated), skippedBlank: n(d.skipped_blank),
      employeeAmountTotal: n(d.employee_amount_total), componentCodes: d.component_codes ?? [], note: d.note ?? "",
    };
  },
  async listDeductionOrder(policyId: string): Promise<PayrollDeductionOrderRow[]> {
    const { data, error } = await supabase.from("payroll_deduction_order").select("*").eq("payroll_policy_id", policyId).order("priority");
    if (error) throw error;
    return (data ?? []).map(mapDeductionOrder);
  },
  async setDeductionOrder(params: { companyId: string; payrollPolicyId: string; rows: Array<{ code: string; priority: number }>; userId?: string | null }): Promise<void> {
    await supabase.from("payroll_deduction_order").delete().eq("payroll_policy_id", params.payrollPolicyId);
    if (params.rows.length === 0) return;
    const { error } = await supabase.from("payroll_deduction_order").insert(
      params.rows.map((x) => ({ company_id: params.companyId, payroll_policy_id: params.payrollPolicyId, deduction_code: x.code, priority: x.priority, is_active: true, created_by: params.userId ?? null, updated_by: params.userId ?? null })),
    );
    if (error) throw error;
  },

  // ======================================================================
  // Phase 7 — master enhancement
  // ======================================================================
  async listGrades(companyId: string): Promise<EmployeeGrade[]> {
    const { data, error } = await supabase.rpc("employee_grades_list", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapGrade);
  },
  async listCategories(companyId: string): Promise<EmployeeCategory[]> {
    const { data, error } = await supabase.rpc("employee_categories_list", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapCategory);
  },
  async upsertGrade(p: { id?: string; companyId: string; code: string; name: string; displayOrder?: number; isActive?: boolean; userId?: string | null }): Promise<void> {
    const payload = { company_id: p.companyId, code: p.code, name: p.name, display_order: p.displayOrder ?? 100, is_active: p.isActive ?? true, updated_by: p.userId ?? null };
    const { error } = p.id
      ? await supabase.from("employee_grades").update(payload).eq("id", p.id)
      : await supabase.from("employee_grades").insert({ ...payload, created_by: p.userId ?? null });
    if (error) throw error;
  },
  async upsertCategory(p: { id?: string; companyId: string; code: string; name: string; displayOrder?: number; isActive?: boolean; userId?: string | null }): Promise<void> {
    const payload = { company_id: p.companyId, code: p.code, name: p.name, display_order: p.displayOrder ?? 100, is_active: p.isActive ?? true, updated_by: p.userId ?? null };
    const { error } = p.id
      ? await supabase.from("employee_categories").update(payload).eq("id", p.id)
      : await supabase.from("employee_categories").insert({ ...payload, created_by: p.userId ?? null });
    if (error) throw error;
  },
  async listPolicyAssignments(companyId: string): Promise<PayrollPolicyAssignment[]> {
    const { data, error } = await supabase.rpc("payroll_policy_assignments_list", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapPolicyAssignment);
  },
  async addPolicyAssignment(p: {
    companyId: string; payrollPolicyId: string; scopeType: string; effectiveFrom: string; priority?: number;
    employeeId?: string | null; gradeId?: string | null; categoryId?: string | null; storeId?: string | null;
    storeDesignationId?: string | null; storeDepartmentId?: string | null; employmentType?: string | null; userId?: string | null;
  }): Promise<void> {
    const { error } = await supabase.from("payroll_policy_assignments").insert({
      company_id: p.companyId, payroll_policy_id: p.payrollPolicyId, scope_type: p.scopeType, effective_from: p.effectiveFrom,
      priority: p.priority ?? 100, employee_id: p.employeeId ?? null, grade_id: p.gradeId ?? null, category_id: p.categoryId ?? null,
      store_id: p.storeId ?? null, store_designation_id: p.storeDesignationId ?? null, store_department_id: p.storeDepartmentId ?? null,
      employment_type: p.employmentType ?? null, is_active: true, created_by: p.userId ?? null, updated_by: p.userId ?? null,
    });
    if (error) throw error;
  },
  async deletePolicyAssignment(id: string): Promise<void> {
    const { error } = await supabase.from("payroll_policy_assignments").delete().eq("id", id);
    if (error) throw error;
  },
  async listStoreCalendars(companyId: string): Promise<StorePayrollCalendar[]> {
    const { data, error } = await supabase.rpc("store_payroll_calendars_list", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapCalendar);
  },
  async upsertStoreCalendar(p: {
    id?: string; companyId: string; storeId: string | null; name: string; effectiveFrom: string; effectiveTo?: string | null;
    weeklyOffDays: number[]; alternateSaturdayOff?: boolean; alternateSaturdayReference?: string | null;
    holidaySource?: string; status?: string; userId?: string | null;
  }): Promise<void> {
    const payload = {
      company_id: p.companyId, store_id: p.storeId, name: p.name, effective_from: p.effectiveFrom, effective_to: p.effectiveTo ?? null,
      weekly_off_days: p.weeklyOffDays, alternate_saturday_off: p.alternateSaturdayOff ?? false,
      alternate_saturday_reference: p.alternateSaturdayReference ?? null, holiday_source: p.holidaySource ?? "company_holidays",
      status: p.status ?? "draft", updated_by: p.userId ?? null,
    };
    const { error } = p.id
      ? await supabase.from("store_payroll_calendars").update(payload).eq("id", p.id)
      : await supabase.from("store_payroll_calendars").insert({ ...payload, created_by: p.userId ?? null });
    if (error) throw error;
  },
  async previewStoreCalendar(calendarId: string, start: string, end: string): Promise<StoreCalendarPreview> {
    const { data, error } = await supabase.rpc("store_calendar_preview", { p_calendar_id: calendarId, p_start: start, p_end: end });
    if (error) throw error;
    return data as unknown as StoreCalendarPreview;
  },
  async listTdsPolicies(companyId: string): Promise<TdsPolicy[]> {
    const { data, error } = await supabase.rpc("tds_policies_list", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapTdsPolicy);
  },
  async listTdsSlabs(policyId: string): Promise<TdsSlab[]> {
    const { data, error } = await supabase.rpc("tds_slabs_list", { p_policy_id: policyId });
    if (error) throw error;
    return (data ?? []).map(mapTdsSlab);
  },
  async createTdsPolicy(p: { companyId: string; name: string; code: string; userId?: string | null }): Promise<{ id: string }> {
    const { data, error } = await supabase.from("tds_policies").insert({
      company_id: p.companyId, name: p.name, code: p.code, status: "draft", effective_from: new Date().toISOString().slice(0, 10),
      created_by: p.userId ?? null, updated_by: p.userId ?? null,
    }).select("id").single();
    if (error) throw error;
    return { id: (data as DbRow).id };
  },
  async updateTdsPolicy(id: string, values: Record<string, unknown>, userId?: string | null): Promise<void> {
    const { error } = await supabase.from("tds_policies").update({ ...values, updated_by: userId ?? null }).eq("id", id);
    if (error) throw error;
  },
  async addTdsSlab(p: { companyId: string; tdsPolicyId: string; minIncome: number; maxIncome: number | null; rate: number; userId?: string | null }): Promise<void> {
    const { error } = await supabase.from("tds_slabs").insert({
      company_id: p.companyId, tds_policy_id: p.tdsPolicyId, min_income: p.minIncome, max_income: p.maxIncome, rate: p.rate,
      created_by: p.userId ?? null, updated_by: p.userId ?? null,
    });
    if (error) throw error;
  },
  async deleteTdsSlab(id: string): Promise<void> {
    const { error } = await supabase.from("tds_slabs").delete().eq("id", id);
    if (error) throw error;
  },
  async computeTds(policyId: string, annualTaxable: number): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.rpc("tds_compute", { p_policy_id: policyId, p_annual_taxable: annualTaxable });
    if (error) throw error;
    return (data ?? {}) as Record<string, unknown>;
  },
  async assignEmployeePolicy(employeeId: string, policyId: string, effectiveFrom: string, reason?: string | null): Promise<void> {
    const { error } = await supabase.rpc("payroll_assign_policy", { p_employee_id: employeeId, p_payroll_policy_id: policyId, p_effective_from: effectiveFrom, p_reason: reason ?? null });
    if (error) throw error;
  },
};
