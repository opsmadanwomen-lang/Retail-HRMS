// ============================================================================
// Phase 5 — Payroll Engine view models (camelCase).
// ============================================================================

export type PayrollStatus = "draft" | "processing" | "calculated" | "finalized" | "locked" | "reversed";

export interface PayrollPeriodRow {
  id: string;
  periodMonth: string;
  periodStartDate: string;
  periodEndDate: string;
  label: string | null;
  status: PayrollStatus;
  currentRunId: string | null;
  runStatus: PayrollStatus | null;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  advanceRecoveryTotal: number;
  netTotal: number;
  finalizedAt: string | null;
  lockedAt: string | null;
}

export interface PayrollRunResult {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  department: string | null;
  designation: string | null;
  store: string | null;
  basic: number;
  da: number;
  paidDays: number;
  unpaidDays: number;
  lwpDays: number;
  grossEarnings: number;
  totalDeductions: number;
  advanceRecoveryAmount: number;
  netSalary: number;
  employerContributionTotal: number;
  salaryStructureId: string | null;
  grossFromStructure: number | null;
  structureReconciled: boolean | null;
  hasNegativeNet: boolean;
  needsReview: boolean;
  reviewNotes: string | null;
  status: "calculated" | "finalized" | "reversed";
}

export interface PayrollEmployeeResultDetail {
  resultId: string;
  payrollRunId: string;
  runStatus: PayrollStatus;
  periodMonth: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  department: string | null;
  designation: string | null;
  store: string | null;
  salaryEffectiveFrom: string | null;
  basic: number;
  da: number;
  calendarDays: number;
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  lwpDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  absentDays: number;
  paidDays: number;
  unpaidDays: number;
  grossEarnings: number;
  totalDeductions: number;
  advanceRecoveryAmount: number;
  netSalary: number;
  employerContributionTotal: number;
  salaryStructureId: string | null;
  structureName: string | null;
  grossFromStructure: number | null;
  structureReconciled: boolean | null;
  payrollPolicyId: string | null;
  policySnapshot: Record<string, unknown> | null;
  prorationFactor: number | null;
  lwpDeductionAmount: number;
  statutoryDeductionTotal: number;
  storeCalendarId: string | null;
  storeCalendarSnapshot: Record<string, unknown> | null;
  exitProrationAmount: number;
  eligibleDays: number | null;
  salaryStructureScope: string | null;
  payrollPolicyScope: string | null;
  leavingDateSnapshot: string | null;
  hasNegativeNet: boolean;
  needsReview: boolean;
  reviewNotes: string | null;
  status: "calculated" | "finalized" | "reversed";
}

export interface PayrollLine {
  lineType: "earning" | "deduction" | "employer_contribution";
  code: string;
  name: string;
  quantity: number | null;
  rate: number | null;
  amount: number;
  source: string | null;
  calcType: string | null;
  calcBase: string | null;
  calcRate: number | null;
  calcFormula: string | null;
  calculationRef: string | null;
  isReversal: boolean;
  sortOrder: number;
}

export interface MyPayslipRow {
  resultId: string;
  payslipId: string | null;
  payslipNumber: string | null;
  periodMonth: string;
  runStatus: PayrollStatus;
  grossEarnings: number;
  totalDeductions: number;
  advanceRecoveryAmount: number;
  netSalary: number;
  status: "calculated" | "finalized" | "reversed";
}

export interface PayslipSnapshot {
  company: { name: string; city: string | null; state: string | null };
  employee: { code: string | null; name: string | null; department: string | null; designation: string | null; store: string | null };
  period: { month: string; start: string; end: string };
  days: { calendar: number; working: number; paid: number; unpaid: number; paid_leave: number; lwp: number };
  salary_structure_id?: string | null;
  gross_from_structure?: number | null;
  structure_reconciled?: boolean | null;
  earnings: Array<PayslipLine>;
  deductions: Array<PayslipLine>;
  employer_contributions?: Array<PayslipLine>;
  gross_earnings: number;
  total_deductions: number;
  employer_contribution_total?: number;
  advance_recovery: number;
  net_salary: number;
}

export interface PayslipLine {
  code: string;
  name: string;
  qty: number | null;
  rate: number | null;
  amount: number;
  calc_type?: string | null;
  calc_base?: string | null;
  calc_rate?: number | null;
  calc_formula?: string | null;
}

export interface PayrollAdvanceRecoveryReportRow {
  employeeName: string;
  employeeCode: string | null;
  advanceTypeName: string;
  actualPaidAmount: number;
  recoveredThisPeriod: number;
  totalRecovered: number;
  outstandingAmount: number;
  periodMonth: string;
}

export interface PayrollSalaryComponent {
  id: string;
  companyId: string;
  code: string;
  name: string;
  componentType: "earning" | "deduction";
  calculationMethod: string;
  source: string | null;
  isTaxable: boolean;
  isStatutory: boolean;
  isActive: boolean;
  sortOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PayrollPolicy {
  id: string;
  companyId: string;
  payFrequency: string;
  lwpDivisor: number | null;
  lwpDivisorBasis: string | null;
  prorationMethod: string | null;
  overtimeHourlyRate: number | null;
  nightDutyDayRate: number | null;
  deductionCapPct: number | null;
  allowNegativeNet: boolean;
  rounding: string;
}

// ============================================================================
// Phase 5A — Dynamic Salary Bifurcation view models.
// ============================================================================

export type SalaryCalculationType =
  | "fixed"
  | "pct_of_gross"
  | "pct_of_basic"
  | "pct_of_component"
  | "formula"
  | "balance"
  | "advance_recovery"
  // Migration 0175 — per-employee/per-period amount from payroll_component_amounts (Manual entry
  // or Excel import), reusing the SAME table/RPCs PF/ESI already use. Never valid for code = 'OT'.
  | "manual";
export type SalaryComponentCategory = "earning" | "employee_deduction" | "employer_contribution";
export type SalaryStructureStatus = "draft" | "active" | "inactive" | "archived";

export interface SalaryStructure {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  status: SalaryStructureStatus;
  grossBalanced: boolean;
  allowNegativeBalance: boolean;
  rounding: "none" | "nearest_rupee" | "round_2";
  effectiveFrom: string;
  effectiveTo: string | null;
  previousVersionId: string | null;
}

/** Result of salary_structure_delete_check() — Super Admin only. `blockCode` matches the RPC's error hint. */
export type SalaryStructureDeleteBlockCode = "ACTIVE" | "EMPLOYEE_ASSIGNED" | "PAYROLL_USED" | "PROTECTED_HISTORY";
export interface SalaryStructureDeleteCheck {
  id: string;
  code: string;
  name: string;
  status: SalaryStructureStatus;
  componentCount: number;
  slabCount: number;
  ruleAssignmentCount: number;
  employeeAssignmentCount: number;
  payrollUseCount: number;
  protectedReferenceCount: number;
  isAssignedToEmployees: boolean;
  usedInPayroll: boolean;
  canDelete: boolean;
  blockCode: SalaryStructureDeleteBlockCode | null;
  blockMessage: string | null;
}

export interface SalaryStructureComponent {
  id: string;
  salaryStructureId: string;
  code: string;
  name: string;
  category: SalaryComponentCategory;
  calculationType: SalaryCalculationType;
  fixedAmount: number | null;
  percentage: number | null;
  baseComponentCode: string | null;
  formulaExpression: string | null;
  isBasic: boolean;
  includedInGross: boolean;
  includedInCtc: boolean;
  isTaxable: boolean;
  isStatutory: boolean;
  statutoryKind: string | null;
  statutoryBase: string | null;
  statutoryRate: number | null;
  statutoryCeiling: number | null;
  rounding: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface SalaryBifurcationLine {
  code: string;
  name: string;
  category: string;
  calculationType: string;
  calcBase: string | null;
  calcRate: number | null;
  calcFormula: string | null;
  amount: number;
  includedInGross: boolean;
  isStatutory: boolean;
}

export interface EmployeeSalaryAssignment {
  id: string;
  grossSalary: number;
  salaryStructureId: string | null;
  structureName: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  remark: string | null;
  createdAt: string;
  // Migration 0178 — what the system resolved from the Gross (slab -> structure) and what it replaced.
  previousGross: number | null;
  previousStructureName: string | null;
  resolvedStructureId: string | null;
  resolvedStructureName: string | null;
  resolvedStructureCode: string | null;
  assignedByName: string | null;
}

export interface SalaryResolveResult {
  grossSalary: number;
  salaryStructureId: string | null;
  structureName: string | null;
  source: string | null;
  ambiguous: boolean;
  resolveNote: string | null;
}

// ============================================================================
// Phase 6 — Payroll Policy Engine view models.
// ============================================================================

export type PayrollPolicyStatus = "draft" | "active" | "inactive" | "archived";

/** The full versioned Payroll Policy row (every unresolved rule is null/false = inert). */
export interface PayrollPolicyV2 {
  id: string;
  companyId: string;
  policyName: string | null;
  code: string | null;
  versionNo: number;
  status: PayrollPolicyStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  previousPolicyId: string | null;
  payFrequency: string;
  currencyPrecision: number;
  rounding: string;
  // proration
  prorationMethod: string | null;
  prorationBasis: string | null;
  prorationCustomDivisor: number | null;
  prorationCustomFormula: string | null;
  workingDaysMethod: string | null;
  // LWP
  lwpEnabled: boolean;
  lwpBasis: string | null;
  lwpDivisor: number | null;
  lwpDivisorBasis: string | null;
  lwpProrationMethod: string | null;
  lwpHalfDaySupported: boolean;
  lwpRounding: string | null;
  lwpCustomFormula: string | null;
  // overtime
  otEnabled: boolean;
  otRateType: string | null;
  otRate: number | null;
  otBasis: string | null;
  otStdHoursPerDay: number | null;
  otMinHours: number | null;
  otMaxHours: number | null;
  otRounding: string | null;
  otApprovalRequired: boolean;
  otCustomFormula: string | null;
  overtimeHourlyRate: number | null;
  // OT/Late hourly basis (migration 0185) — CONFIGURATION, not hard-coded. Late always shares these same fields (one basis, no
  // duplicate engine); hours/day is the SAME otStdHoursPerDay field used above.
  otLateBasis: "basic" | "da" | "basic_da" | "gross" | "component" | "custom" | null;
  otLateBasisComponentCode: string | null;
  otLateBasisFormula: string | null;
  otLateDivisorMethod: "calendar_days" | "working_days" | "custom" | null;
  otLateDivisorCustom: number | null;
  // late (migration 0184) — hours/day is the SAME otStdHoursPerDay field
  lateDeductionEnabled: boolean;
  // night duty
  ndEarningEnabled: boolean;
  ndRateType: string | null;
  ndRate: number | null;
  ndBasis: string | null;
  ndRounding: string | null;
  ndCustomFormula: string | null;
  nightDutyDayRate: number | null;
  // deduction cap + negative net
  deductionCapMode: string;
  deductionCapValue: number | null;
  deductionCapFormula: string | null;
  deductionCapPct: number | null;
  negativeNetPolicy: "allow" | "block" | "warn";
  allowNegativeNet: boolean;
  // Phase 7
  exitDatePayable: boolean | null;
}

// ============================================================================
// Phase 7 — master enhancement view models.
// ============================================================================

export interface EmployeeGrade {
  id: string;
  companyId: string;
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}
export interface EmployeeCategory {
  id: string;
  companyId: string;
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}
export interface PayrollPolicyAssignment {
  id: string;
  payrollPolicyId: string;
  scopeType: string;
  employeeId: string | null;
  gradeId: string | null;
  categoryId: string | null;
  storeDesignationId: string | null;
  storeDepartmentId: string | null;
  storeId: string | null;
  employmentType: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  isActive: boolean;
}
export interface StorePayrollCalendar {
  id: string;
  companyId: string;
  storeId: string | null;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  weeklyOffDays: number[];
  alternateSaturdayOff: boolean;
  alternateSaturdayReference: string | null;
  holidaySource: "company_holidays" | "none";
  status: "draft" | "active" | "archived";
}
export interface StoreCalendarPreview {
  period_days: number;
  working_days: number | null;
  weekly_off_days: number[];
  alternate_saturday_off: boolean;
  holiday_source: string;
}
export interface TdsPolicy {
  id: string;
  companyId: string;
  name: string;
  code: string;
  versionNo: number;
  status: "draft" | "active" | "inactive" | "archived";
  taxRegime: string | null;
  financialYearStart: string | null;
  financialYearEnd: string | null;
  annualizationMethod: string | null;
  standardDeduction: number | null;
  rebateLimit: number | null;
  rebateAmount: number | null;
  cessPct: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface TdsSlab {
  id: string;
  tdsPolicyId: string;
  minIncome: number;
  maxIncome: number | null;
  rate: number;
  fixedComponent: number;
  label: string | null;
}

/**
 * How a PF/ESI (statutory) amount is determined for the payroll period.
 * OT is NOT a statutory rule and never uses these — OT comes only from the
 * Attendance Overtime / OT Rules.
 */
export type PayrollStatutoryCalcMethod =
  | "pct_of_base"       // calc_base x employee_rate %
  | "fixed_amount"      // flat employee_amount / employer_amount ₹
  | "pct_of_component"  // ref_component_code amount x rate %
  | "formula"           // base_formula / employer_formula -> ₹
  | "manual";           // per employee + period amount from payroll_component_amounts

export interface PayrollStatutoryRule {
  id: string;
  payrollPolicyId: string;
  kind: "pf" | "esi" | "pt" | "tds" | "gratuity" | "other";
  enabled: boolean;
  calcMethod: PayrollStatutoryCalcMethod;
  calcBase: string | null;
  baseFormula: string | null;
  employerFormula: string | null;
  employeeRate: number | null;
  employerRate: number | null;
  employeeAmount: number | null;
  employerAmount: number | null;
  refComponentCode: string | null;
  wageCeiling: number | null;
  rounding: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
  // Migration 0178 — a kind='other' rule with a componentCode is a named Common Payroll Component
  // (Medical Fund, Incentive, ...). PF/ESI/PT/TDS/Gratuity leave these null.
  componentCode: string | null;
  componentName: string | null;
  componentType: "earning" | "deduction" | null;
  // Migration 0181 — reusable eligibility: 'always' (default) or 'after_months' (N completed months of service from the joining date).
  eligibilityType: "always" | "after_months";
  eligibilityMonths: number | null;
}

/** A per-employee / per-payroll-period manual or imported PF/ESI amount. */
export interface PayrollComponentAmount {
  id: string;
  payrollPeriodId: string;
  employeeId: string;
  componentCode: string;
  employeeAmount: number | null;   // null = blank / not supplied ; 0 = intentional zero
  employerAmount: number | null;
  source: "manual" | "excel_import";
  importBatchId: string | null;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface PayrollComponentImportPreviewRow {
  rowNumber: number;
  staffId: string;
  staffName: string;
  employeeId: string | null;
  matchedName: string | null;
  matchedCode: string | null;
  state: "valid" | "warning" | "error";
  messages: string[];
  components: Record<string, { raw: string | null; value: number | null; supplied: boolean; zero: boolean }>;
}

export interface PayrollComponentImportPreview {
  period: { id: string; status: PayrollStatus; editable: boolean };
  componentCodes: string[];
  summary: { total_rows: number; valid: number; warnings: number; errors: number; employee_amount_total: number; employer_amount_total: number };
  rows: PayrollComponentImportPreviewRow[];
}

export interface PayrollComponentImportResult {
  batchId: string;
  imported: number;
  updated: number;
  skippedBlank: number;
  employeeAmountTotal: number;
  componentCodes: string[];
  note: string;
}

export interface PayrollPtSlab {
  id: string;
  payrollPolicyId: string;
  minSalary: number;
  maxSalary: number | null;
  amount: number;
  label: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PayrollDeductionOrderRow {
  id: string;
  payrollPolicyId: string;
  deductionCode: string;
  priority: number;
  isActive: boolean;
}

/**
 * Migration 0184 (+ 0185 — basis/divisor made CONFIGURABLE) — the company OT / Late hourly basis exactly as the
 * server (payroll_ot_late_basis) computed it: wage basis ÷ day divisor ÷ standard hours/day, all three read from
 * the payroll policy. Display only — nothing in the UI calculates it.
 * Amounts / minutes are null-or-zero unless the preview was given OT / Late minutes (and the policy enables the line).
 */
export interface OtLateBasis {
  period_month: string; period_start: string; period_end: string;
  basic: number; da: number; wage_base: number;
  basis_method: "basic" | "da" | "basic_da" | "gross" | "component" | "custom";
  divisor_method: "calendar_days" | "working_days" | "custom";
  divisor: number | null;
  calendar_days: number; std_hours_per_day: number | null;
  daily_rate: number | null; hourly_rate: number | null;
  ot_enabled: boolean; ot_minutes: number; ot_hours: number; ot_amount: number | null;
  ot_multiplier: number | null; ot_multiplier_note: string;
  late_enabled: boolean; late_minutes: number; late_hours: number; late_amount: number | null;
}

export interface PayrollPolicyPreview {
  /** Migration 0184 — OT / Late hourly basis for this preview's month (absent until 0184 is deployed). */
  ot_late_basis?: OtLateBasis;
  /** Migration 0178 — the structure the resolver picked for the Gross used in this preview (slab / scope rules). */
  /** Migration 0180 — component-specific problems (e.g. an invalid formula), reported WITHOUT hiding the structure above. */
  issues?: Array<{ code: string; name: string; line_type: string; note: string | null }>;
  /** Migration 0181 — per-line explanation keyed by component code (e.g. "Not applicable - 12 months of service complete on 01 Oct 2026."). */
  line_notes?: Record<string, string | null>;
  /** Migration 0180 — unexpected failures while computing the common components (structure is still returned). */
  errors?: string[];
  salary_structure?: { id: string | null; code: string | null; name: string | null; source: string | null; ambiguous: boolean; note: string | null; gross: number };
  policy: { id: string; code: string | null; name: string | null; version_no: number; effective_from: string; effective_to: string | null };
  gross: number;
  earnings: Array<{ code: string; name: string; amount: number; calc_type?: string; note?: string | null; unresolved?: boolean }>;
  deductions: Array<{ code: string; name?: string; amount: number; priority?: number; calc_type?: string; note?: string | null; unresolved?: boolean; capped?: boolean }>;
  employer_contributions: Array<{ code: string; name: string; amount: number; note?: string | null }>;
  total_deductions: number;
  net_salary: number;
  cap: number | null;
  cap_reduction: number;
  negative_net_policy: string;
  negative_flag: boolean;
  priority_configured: boolean;
}
