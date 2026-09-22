import { supabase } from "@/lib/supabaseClient";
import type {
  LeaveFinancialYear,
  LeaveType,
  LeavePolicy,
  LeavePolicyTypeConfig,
  LeaveAccrualPeriod,
  LeaveProbationRule,
  LeaveProRataRule,
  LeavePolicyAssignment,
  LeavePreviewRow,
  LeaveBalance,
  LeaveApplication,
  LeaveApplicationDocument,
  LeaveApprovalAction,
  LeaveApprovalDecision,
  LeaveApprovalQueueRow,
  LeaveApproverHistoryRow,
  StaffLeaveHistoryRow,
  LeavePaidDayRow,
  LeavePaidDaysResult,
  EmployeeSalaryComponent,
  LeaveEncashmentRule,
  LeavePriorNoticeRule,
  LeavePriorNoticeException,
  LeaveNotification,
  LeaveNotificationSetting,
  LeaveFyClosingBatch,
  LeaveFyClosingLine,
  PayrollLeaveTransaction,
} from "@/types/leave";

function mapFinancialYear(row: any): LeaveFinancialYear {
  return {
    id: row.id,
    companyId: row.company_id,
    label: row.label,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLeaveType(row: any): LeaveType {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    isPaid: row.is_paid,
    halfDayAllowed: row.half_day_allowed,
    quarterDayAllowed: row.quarter_day_allowed,
    minimumUnit: Number(row.minimum_unit),
    documentRequired: row.document_required,
    requiresReason: row.requires_reason,
    remark: row.remark,
  };
}

function mapPolicy(row: any): LeavePolicy {
  return {
    id: row.id,
    companyId: row.company_id,
    financialYearId: row.financial_year_id,
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status,
    versionNumber: row.version_number,
    previousVersionId: row.previous_version_id,
    changeReason: row.change_reason,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    remark: row.remark,
    createdAt: row.created_at,
    financialYearLabel: row.leave_financial_years?.label ?? null,
  };
}

function mapTypeConfig(row: any): LeavePolicyTypeConfig {
  return {
    id: row.id,
    policyId: row.policy_id,
    leaveTypeId: row.leave_type_id,
    accrualEnabled: row.accrual_enabled,
    accrualFrequency: row.accrual_frequency,
    probationEligible: row.probation_eligible,
    carryForwardAllowed: row.carry_forward_allowed,
    carryForwardMaxDays: row.carry_forward_max_days === null ? null : Number(row.carry_forward_max_days),
    carryForwardExpiryType: row.carry_forward_expiry_type,
    carryForwardExpiryMonths: row.carry_forward_expiry_months,
    encashmentAllowed: row.encashment_allowed,
    lapseAllowed: row.lapse_allowed,
    negativeBalanceAllowed: row.negative_balance_allowed,
    remark: row.remark,
    leaveTypeName: row.leave_types?.name,
    leaveTypeCode: row.leave_types?.code,
  };
}

function mapAccrualPeriod(row: any): LeaveAccrualPeriod {
  return {
    id: row.id,
    policyTypeConfigId: row.policy_type_config_id,
    periodStartMonth: row.period_start_month,
    periodEndMonth: row.period_end_month,
    accrualAmount: Number(row.accrual_amount),
    sortOrder: row.sort_order,
    remark: row.remark,
  };
}

function mapProbationRule(row: any): LeaveProbationRule {
  return {
    id: row.id,
    policyId: row.policy_id,
    durationValue: row.duration_value,
    durationUnit: row.duration_unit,
    extraLeaveDuringProbation: Number(row.extra_leave_during_probation),
    weeklyOffDuringProbation: row.weekly_off_during_probation,
    postProbationStartRule: row.post_probation_start_rule,
    specificStartDate: row.specific_start_date,
    remark: row.remark,
  };
}

function mapProRataRule(row: any): LeaveProRataRule {
  return {
    id: row.id,
    policyTypeConfigId: row.policy_type_config_id,
    enabled: row.enabled,
    basis: row.basis,
    remark: row.remark,
  };
}

function mapApplication(row: any): LeaveApplication {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    leaveTypeId: row.leave_type_id,
    financialYearId: row.financial_year_id,
    policyId: row.policy_id,
    fromDate: row.from_date,
    toDate: row.to_date,
    isHalfDay: row.is_half_day,
    halfDaySession: row.half_day_session,
    totalDays: Number(row.total_days),
    reason: row.reason,
    remarks: row.remarks,
    status: row.status,
    shortOrLong: row.short_or_long,
    currentStep: row.current_step,
    appliedAt: row.applied_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionRemark: row.decision_remark,
    createdAt: row.created_at,
    leaveTypeName: row.leave_types?.name,
  };
}

function mapApprovalAction(row: any): LeaveApprovalAction {
  return {
    stepOrder: row.step_order,
    approverRole: row.approver_role,
    approverEmployeeId: row.approver_employee_id,
    approverName: row.approver_name,
    action: row.action,
    remark: row.remark,
    actedAt: row.acted_at,
  };
}

function mapApprovalQueueRow(row: any): LeaveApprovalQueueRow {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeCode: row.employee_code,
    leaveTypeId: row.leave_type_id,
    leaveTypeName: row.leave_type_name,
    fromDate: row.from_date,
    toDate: row.to_date,
    totalDays: Number(row.total_days),
    shortOrLong: row.short_or_long,
    status: row.status,
    reason: row.reason,
    appliedAt: row.applied_at,
  };
}

function mapSalaryComponent(row: any): EmployeeSalaryComponent {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    basicSalary: Number(row.basic_salary),
    da: Number(row.da),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEncashmentRule(row: any): LeaveEncashmentRule {
  return {
    id: row.id,
    policyId: row.policy_id,
    enabled: row.enabled,
    salaryBaseType: row.salary_base_type,
    divisorType: row.divisor_type,
    divisorCustomValue: row.divisor_custom_value === null ? null : Number(row.divisor_custom_value),
    thresholdBaseType: row.threshold_base_type,
    salaryThreshold: row.salary_threshold === null ? null : Number(row.salary_threshold),
    thresholdComparison: row.threshold_comparison,
    remark: row.remark,
  };
}

function mapPriorNoticeRule(row: any): LeavePriorNoticeRule {
  return {
    id: row.id,
    policyId: row.policy_id,
    required: row.required,
    noticeDays: row.notice_days,
    exceptionBehavior: row.exception_behavior,
    remark: row.remark,
  };
}

function mapPriorNoticeException(row: any): LeavePriorNoticeException {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    leaveApplicationId: row.leave_application_id,
    exceptionBehavior: row.exception_behavior,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionRemark: row.decision_remark,
    fromDate: row.from_date,
    toDate: row.to_date,
    leaveTypeId: row.leave_type_id,
    employeeName: row.employees?.full_name,
    leaveTypeName: row.leave_types?.name,
  };
}

function mapNotification(row: any): LeaveNotification {
  return {
    id: row.id,
    companyId: row.company_id,
    recipientEmployeeId: row.recipient_employee_id,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    relatedTable: row.related_table,
    relatedId: row.related_id,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

function mapNotificationSetting(row: any): LeaveNotificationSetting {
  return {
    id: row.id,
    companyId: row.company_id,
    eventType: row.event_type,
    inAppEnabled: row.in_app_enabled,
    pushEnabled: row.push_enabled,
    emailEnabled: row.email_enabled,
    smsEnabled: row.sms_enabled,
  };
}

function mapFyClosingBatch(row: any): LeaveFyClosingBatch {
  return {
    id: row.id,
    companyId: row.company_id,
    financialYearId: row.financial_year_id,
    nextFinancialYearId: row.next_financial_year_id,
    status: row.status,
    initiatedBy: row.initiated_by,
    initiatedAt: row.initiated_at,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    remark: row.remark,
  };
}

function mapFyClosingLine(row: any): LeaveFyClosingLine {
  return {
    employeeId: row.employee_id,
    leaveTypeId: row.leave_type_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    opening: Number(row.opening),
    earned: Number(row.earned),
    used: Number(row.used),
    pending: Number(row.pending),
    available: Number(row.available),
    carryForwardDays: Number(row.carry_forward_days),
    encashmentDays: Number(row.encashment_days),
    lapseDays: Number(row.lapse_days),
    basicSalarySnapshot: row.basic_salary_snapshot === null ? null : Number(row.basic_salary_snapshot),
    daSnapshot: row.da_snapshot === null ? null : Number(row.da_snapshot),
    salaryBaseSnapshot: row.salary_base_snapshot === null ? null : Number(row.salary_base_snapshot),
    divisorSnapshot: row.divisor_snapshot === null ? null : Number(row.divisor_snapshot),
    dailyRate: row.daily_rate === null ? null : Number(row.daily_rate),
    encashmentAmount: row.encashment_amount === null ? null : Number(row.encashment_amount),
    finalStatus: row.final_status,
  };
}

function mapPayrollTransaction(row: any): PayrollLeaveTransaction {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    financialYearId: row.financial_year_id,
    leaveTypeId: row.leave_type_id,
    transactionType: row.transaction_type,
    days: Number(row.days),
    amount: row.amount === null ? null : Number(row.amount),
    source: row.source,
    status: row.status,
    fyClosingBatchId: row.fy_closing_batch_id,
    createdAt: row.created_at,
  };
}

function mapApplicationDocument(row: any): LeaveApplicationDocument {
  return {
    id: row.id,
    leaveApplicationId: row.leave_application_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    createdAt: row.created_at,
  };
}

function mapAssignment(row: any): LeavePolicyAssignment {
  return {
    id: row.id,
    companyId: row.company_id,
    policyId: row.policy_id,
    scopeType: row.scope_type,
    employeeId: row.employee_id,
    storeId: row.store_id,
    storeDesignationId: row.store_designation_id,
    storeDepartmentId: row.store_department_id,
    employmentType: row.employment_type,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isActive: row.is_active,
    remark: row.remark,
    policyName: row.leave_policies?.name,
  };
}

export const leaveService = {
  // ---------------- Financial Years ----------------
  async listFinancialYears(companyId: string): Promise<LeaveFinancialYear[]> {
    const { data, error } = await supabase
      .from("leave_financial_years")
      .select("*")
      .eq("company_id", companyId)
      .order("start_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapFinancialYear);
  },

  /**
   * The ONE authoritative active Financial Year for the caller's company — the same row
   * leave_apply() resolves server-side. Used by the Staff Leave page so the Apply Leave form is
   * no longer gated on a direct leave_financial_years read (which RLS returned empty for Staff
   * before migration 0125). Returns null when no FY is marked active.
   */
  async getActiveFinancialYear(): Promise<LeaveFinancialYear | null> {
    const { data, error } = await supabase.rpc("leave_get_active_financial_year");
    if (error) throw error;
    if (!data || (data as { id?: string }).id == null) return null;
    return mapFinancialYear(data);
  },

  /**
   * "Leave Duration [automatically calculated]" for the Apply Leave form. Server resolves the
   * caller's employee -> assigned policy -> policy_type_config and returns leave_compute_total_days()
   * verbatim — no day-count/weekly-off/holiday/half-day/sandwich rule is reproduced client-side.
   * Returns null when the type/policy is not resolvable for this employee.
   */
  async previewTotalDays(params: { leaveTypeId: string; fromDate: string; toDate: string; isHalfDay: boolean }): Promise<number | null> {
    const { data, error } = await supabase.rpc("leave_preview_total_days", {
      p_leave_type_id: params.leaveTypeId,
      p_from_date: params.fromDate,
      p_to_date: params.toDate,
      p_is_half_day: params.isHalfDay,
    });
    if (error) throw error;
    return data == null ? null : Number(data);
  },

  /** Admin "Activate" action for an existing Financial Year — atomically demotes the company's
   *  current active FY and promotes this one (respects uidx_leave_financial_years_one_active).
   *  Super-Admin only, enforced inside the RPC. Never creates a new FY. */
  async activateFinancialYear(financialYearId: string): Promise<LeaveFinancialYear> {
    const { data, error } = await supabase.rpc("leave_activate_financial_year", { p_financial_year_id: financialYearId });
    if (error) throw error;
    return mapFinancialYear(data);
  },

  async createFinancialYear(params: { companyId: string; label: string; startDate: string; endDate: string; status: string; userId?: string }): Promise<LeaveFinancialYear> {
    const { data, error } = await supabase
      .from("leave_financial_years")
      .insert({
        company_id: params.companyId,
        label: params.label,
        start_date: params.startDate,
        end_date: params.endDate,
        status: params.status,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapFinancialYear(data);
  },

  // ---------------- Leave Types ----------------
  async listLeaveTypes(companyId: string): Promise<LeaveType[]> {
    const { data, error } = await supabase.from("leave_types").select("*").eq("company_id", companyId).order("name");
    if (error) throw error;
    return (data ?? []).map(mapLeaveType);
  },

  async createLeaveType(params: {
    companyId: string;
    code: string;
    name: string;
    isPaid: boolean;
    halfDayAllowed: boolean;
    quarterDayAllowed: boolean;
    minimumUnit: number;
    documentRequired: boolean;
    requiresReason: boolean;
    userId?: string;
  }): Promise<LeaveType> {
    const { data, error } = await supabase
      .from("leave_types")
      .insert({
        company_id: params.companyId,
        code: params.code,
        name: params.name,
        is_paid: params.isPaid,
        half_day_allowed: params.halfDayAllowed,
        quarter_day_allowed: params.quarterDayAllowed,
        minimum_unit: params.minimumUnit,
        document_required: params.documentRequired,
        requires_reason: params.requiresReason,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapLeaveType(data);
  },

  // ---------------- Policies ----------------
  async listPolicies(companyId: string): Promise<LeavePolicy[]> {
    const { data, error } = await supabase
      .from("leave_policies")
      .select("*, leave_financial_years(label)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapPolicy);
  },

  async createPolicy(params: {
    companyId: string;
    financialYearId: string;
    name: string;
    code: string;
    description?: string;
    status: string;
    userId?: string;
  }): Promise<LeavePolicy> {
    const { data, error } = await supabase
      .from("leave_policies")
      .insert({
        company_id: params.companyId,
        financial_year_id: params.financialYearId,
        name: params.name,
        code: params.code,
        description: params.description ?? null,
        status: params.status,
        version_number: 1,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      })
      .select("*, leave_financial_years(label)")
      .single();
    if (error) throw error;
    return mapPolicy(data);
  },

  /** Creates a NEW version of an existing policy family — never mutates the old version. */
  async cloneNewVersion(params: { policyId: string; changeReason: string; userId?: string }): Promise<LeavePolicy> {
    const { data: source, error: sourceError } = await supabase.from("leave_policies").select("*").eq("id", params.policyId).single();
    if (sourceError) throw sourceError;

    const { data, error } = await supabase
      .from("leave_policies")
      .insert({
        company_id: source.company_id,
        financial_year_id: source.financial_year_id,
        name: source.name,
        code: source.code,
        description: source.description,
        status: "draft",
        version_number: source.version_number + 1,
        previous_version_id: source.id,
        change_reason: params.changeReason,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      })
      .select("*, leave_financial_years(label)")
      .single();
    if (error) throw error;
    return mapPolicy(data);
  },

  async setPolicyStatus(policyId: string, status: string, userId?: string): Promise<void> {
    const { error } = await supabase.from("leave_policies").update({ status, updated_by: userId ?? null }).eq("id", policyId);
    if (error) throw error;
  },

  // ---------------- Policy-Type Config ----------------
  async listTypeConfigs(policyId: string): Promise<LeavePolicyTypeConfig[]> {
    const { data, error } = await supabase.from("leave_policy_type_configs").select("*, leave_types(name, code)").eq("policy_id", policyId);
    if (error) throw error;
    return (data ?? []).map(mapTypeConfig);
  },

  async createTypeConfig(params: {
    policyId: string;
    leaveTypeId: string;
    accrualEnabled: boolean;
    accrualFrequency: string;
    probationEligible: boolean;
    carryForwardAllowed: boolean;
    carryForwardMaxDays: number | null;
    carryForwardExpiryType: string;
    encashmentAllowed: boolean;
    lapseAllowed: boolean;
    negativeBalanceAllowed: boolean;
    userId?: string;
  }): Promise<LeavePolicyTypeConfig> {
    const { data, error } = await supabase
      .from("leave_policy_type_configs")
      .insert({
        policy_id: params.policyId,
        leave_type_id: params.leaveTypeId,
        accrual_enabled: params.accrualEnabled,
        accrual_frequency: params.accrualFrequency,
        probation_eligible: params.probationEligible,
        carry_forward_allowed: params.carryForwardAllowed,
        carry_forward_max_days: params.carryForwardMaxDays,
        carry_forward_expiry_type: params.carryForwardExpiryType,
        encashment_allowed: params.encashmentAllowed,
        lapse_allowed: params.lapseAllowed,
        negative_balance_allowed: params.negativeBalanceAllowed,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      })
      .select("*, leave_types(name, code)")
      .single();
    if (error) throw error;
    return mapTypeConfig(data);
  },

  // ---------------- Accrual Periods ----------------
  async listAccrualPeriods(policyTypeConfigId: string): Promise<LeaveAccrualPeriod[]> {
    const { data, error } = await supabase
      .from("leave_accrual_periods")
      .select("*")
      .eq("policy_type_config_id", policyTypeConfigId)
      .order("sort_order");
    if (error) throw error;
    return (data ?? []).map(mapAccrualPeriod);
  },

  async createAccrualPeriod(params: {
    policyTypeConfigId: string;
    periodStartMonth: number;
    periodEndMonth: number;
    accrualAmount: number;
    sortOrder: number;
    userId?: string;
  }): Promise<LeaveAccrualPeriod> {
    const { data, error } = await supabase
      .from("leave_accrual_periods")
      .insert({
        policy_type_config_id: params.policyTypeConfigId,
        period_start_month: params.periodStartMonth,
        period_end_month: params.periodEndMonth,
        accrual_amount: params.accrualAmount,
        sort_order: params.sortOrder,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapAccrualPeriod(data);
  },

  async deleteAccrualPeriod(id: string): Promise<void> {
    const { error } = await supabase.from("leave_accrual_periods").delete().eq("id", id);
    if (error) throw error;
  },

  // ---------------- Probation Rule (one per policy) ----------------
  async getProbationRule(policyId: string): Promise<LeaveProbationRule | null> {
    const { data, error } = await supabase.from("leave_probation_rules").select("*").eq("policy_id", policyId).maybeSingle();
    if (error) throw error;
    return data ? mapProbationRule(data) : null;
  },

  async upsertProbationRule(params: {
    policyId: string;
    durationValue: number;
    durationUnit: string;
    extraLeaveDuringProbation: number;
    weeklyOffDuringProbation: boolean;
    postProbationStartRule: string;
    specificStartDate?: string | null;
    userId?: string;
  }): Promise<LeaveProbationRule> {
    const existing = await this.getProbationRule(params.policyId);
    const payload = {
      policy_id: params.policyId,
      duration_value: params.durationValue,
      duration_unit: params.durationUnit,
      extra_leave_during_probation: params.extraLeaveDuringProbation,
      weekly_off_during_probation: params.weeklyOffDuringProbation,
      post_probation_start_rule: params.postProbationStartRule,
      specific_start_date: params.specificStartDate ?? null,
      updated_by: params.userId ?? null,
    };
    if (existing) {
      const { data, error } = await supabase.from("leave_probation_rules").update(payload).eq("id", existing.id).select("*").single();
      if (error) throw error;
      return mapProbationRule(data);
    }
    const { data, error } = await supabase
      .from("leave_probation_rules")
      .insert({ ...payload, created_by: params.userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return mapProbationRule(data);
  },

  // ---------------- Pro-Rata Rule (one per policy-type-config) ----------------
  async upsertProRataRule(params: { policyTypeConfigId: string; enabled: boolean; basis: string; userId?: string }): Promise<LeaveProRataRule> {
    const { data: existing } = await supabase.from("leave_pro_rata_rules").select("id").eq("policy_type_config_id", params.policyTypeConfigId).maybeSingle();
    const payload = { policy_type_config_id: params.policyTypeConfigId, enabled: params.enabled, basis: params.basis, updated_by: params.userId ?? null };
    if (existing) {
      const { data, error } = await supabase.from("leave_pro_rata_rules").update(payload).eq("id", existing.id).select("*").single();
      if (error) throw error;
      return mapProRataRule(data);
    }
    const { data, error } = await supabase
      .from("leave_pro_rata_rules")
      .insert({ ...payload, created_by: params.userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return mapProRataRule(data);
  },

  // ---------------- Policy Assignment ----------------
  async listAssignments(companyId: string): Promise<LeavePolicyAssignment[]> {
    const { data, error } = await supabase
      .from("leave_policy_assignments")
      .select("*, leave_policies(name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapAssignment);
  },

  async createAssignment(params: {
    companyId: string;
    policyId: string;
    scopeType: string;
    employeeId?: string | null;
    storeId?: string | null;
    storeDesignationId?: string | null;
    storeDepartmentId?: string | null;
    employmentType?: string | null;
    effectiveFrom: string;
    userId?: string;
  }): Promise<LeavePolicyAssignment> {
    const { data, error } = await supabase
      .from("leave_policy_assignments")
      .insert({
        company_id: params.companyId,
        policy_id: params.policyId,
        scope_type: params.scopeType,
        employee_id: params.employeeId ?? null,
        store_id: params.storeId ?? null,
        store_designation_id: params.storeDesignationId ?? null,
        store_department_id: params.storeDepartmentId ?? null,
        employment_type: params.employmentType ?? null,
        effective_from: params.effectiveFrom,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      })
      .select("*, leave_policies(name)")
      .single();
    if (error) throw error;
    return mapAssignment(data);
  },

  // ---------------- Phase 2: Balance, Applications, Documents ----------------
  /** Reads the SAME leave_get_balance() RPC every screen uses — never computed client-side. */
  async getBalance(params: { employeeId: string; leaveTypeId: string; financialYearId: string }): Promise<LeaveBalance> {
    const { data, error } = await supabase.rpc("leave_get_balance", {
      p_employee_id: params.employeeId,
      p_leave_type_id: params.leaveTypeId,
      p_financial_year_id: params.financialYearId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { earned: Number(row.earned), used: Number(row.used), pending: Number(row.pending), available: Number(row.available) };
  },

  /** The Staff's own applications — RLS already scopes this to "self" server-side; this method
   *  never accepts or needs an employeeId parameter for a Staff caller (current auth identity only). */
  /** The caller's OWN leave applications only. Uses leave_list_my_applications() (identity =
   *  current_user_employee_id() server-side) — a direct `select * from leave_applications` here
   *  would, for a staff user who is also a Manager/Super Manager, return their reports' /
   *  company-wide applications too (leave_applications RLS, migration 0100). */
  async listMyApplications(): Promise<LeaveApplication[]> {
    const { data, error } = await supabase.rpc("leave_list_my_applications");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      companyId: r.company_id,
      employeeId: r.employee_id,
      leaveTypeId: r.leave_type_id,
      financialYearId: r.financial_year_id,
      policyId: r.policy_id,
      fromDate: r.from_date,
      toDate: r.to_date,
      isHalfDay: r.is_half_day,
      halfDaySession: r.half_day_session,
      totalDays: Number(r.total_days),
      reason: r.reason,
      remarks: r.remarks,
      status: r.status,
      shortOrLong: r.short_or_long,
      currentStep: r.current_step,
      appliedAt: r.applied_at,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      decisionRemark: r.decision_remark,
      createdAt: r.created_at,
      leaveTypeName: r.leave_type_name,
      approvedEffectDays: Number(r.approved_effect_days ?? 0),
      paidDays: Number(r.paid_days ?? 0),
      unpaidDays: Number(r.unpaid_days ?? 0),
    }));
  },

  /** Date-wise paid/unpaid view of one approved leave — powers the Manage Paid Leave screen. */
  async getPaidDaySelection(applicationId: string): Promise<LeavePaidDayRow[]> {
    const { data, error } = await supabase.rpc("leave_get_paid_day_selection", { p_application_id: applicationId });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      effectId: r.effect_id,
      attendanceDate: r.attendance_date,
      isHalfDay: r.is_half_day,
      halfDaySession: r.half_day_session,
      paidStatus: r.paid_status,
      paidUnits: Number(r.paid_units ?? 0),
      payrollLocked: r.payroll_locked,
    }));
  },

  /** Save the FULL desired paid-day selection for one APPROVED leave. Server reconciles against the
   *  current allocation (writes only the delta), enforces selected <= available paid balance, and
   *  never blocks the approved leave itself. Identity is server-side (current_user_employee_id()). */
  async setPaidDays(params: { applicationId: string; fullPaidDates: string[]; halfPaidDates: string[] }): Promise<LeavePaidDaysResult> {
    const { data, error } = await supabase.rpc("leave_set_paid_days", {
      p_application_id: params.applicationId,
      p_paid_full_dates: params.fullPaidDates,
      p_paid_half_dates: params.halfPaidDates,
    });
    if (error) throw error;
    const row: any = Array.isArray(data) ? data[0] : data;
    return {
      approvedDays: Number(row?.approved_days ?? 0),
      paidDays: Number(row?.paid_days ?? 0),
      unpaidDays: Number(row?.unpaid_days ?? 0),
      availablePaidBalance: Number(row?.available_paid_balance ?? 0),
    };
  },

  /** The logged-in employee's OWN leave applications + terminal-decision summary — for the Staff
   *  self-view of the Leave Approvals page. Self-scoped server-side (current_user_employee_id()). */
  async listMyLeaveHistory(): Promise<StaffLeaveHistoryRow[]> {
    const { data, error } = await supabase.rpc("leave_list_my_leave_history");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      employeeCode: r.employee_code,
      leaveTypeId: r.leave_type_id,
      leaveTypeName: r.leave_type_name,
      fromDate: r.from_date,
      toDate: r.to_date,
      totalDays: Number(r.total_days),
      isHalfDay: r.is_half_day,
      shortOrLong: r.short_or_long,
      reason: r.reason,
      status: r.status,
      currentStep: r.current_step,
      appliedAt: r.applied_at,
      decidedAction: r.decided_action,
      decidedByName: r.decided_by_name,
      decidedRole: r.decided_role,
      decidedStep: r.decided_step,
      decidedAt: r.decided_at,
      decisionRemark: r.decision_remark,
      approvedEffectDays: Number(r.approved_effect_days ?? 0),
      paidDays: Number(r.paid_days ?? 0),
      unpaidDays: Number(r.unpaid_days ?? 0),
    }));
  },

  /** Every leave application the logged-in approver has approved / rejected, from the immutable
   *  leave_approval_actions log — scoped to this approver only (never a global query). */
  async listMyApprovalHistory(action: "approved" | "rejected"): Promise<LeaveApproverHistoryRow[]> {
    const { data, error } = await supabase.rpc("leave_list_my_approval_history", { p_action: action });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      leaveApplicationId: r.leave_application_id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      employeeCode: r.employee_code,
      leaveTypeId: r.leave_type_id,
      leaveTypeName: r.leave_type_name,
      fromDate: r.from_date,
      toDate: r.to_date,
      totalDays: Number(r.total_days),
      shortOrLong: r.short_or_long,
      status: r.status,
      reason: r.reason,
      appliedAt: r.applied_at,
      actedAt: r.acted_at,
      approverRole: r.approver_role,
      stepOrder: r.step_order,
      approverEmployeeId: r.approver_employee_id,
      approverName: r.approver_name,
      remark: r.remark,
    }));
  },

  async listApplicationDocuments(leaveApplicationId: string): Promise<LeaveApplicationDocument[]> {
    const { data, error } = await supabase.from("leave_application_documents").select("*").eq("leave_application_id", leaveApplicationId);
    if (error) throw error;
    return (data ?? []).map(mapApplicationDocument);
  },

  /** Uploads the file to the leave-documents bucket (same private-bucket + signed-URL pattern as
   *  employeeDocumentService) — the actual DB row referencing it is created by leave_apply() itself,
   *  atomically with the application, not by a second insert here. */
  async uploadApplicationFile(params: { companyId: string; employeeId: string; file: File }): Promise<{ storagePath: string; fileName: string; mimeType: string | null; fileSizeBytes: number }> {
    const safeName = params.file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const storagePath = `${params.companyId}/${params.employeeId}/${Date.now()}_${safeName}`;
    const { error } = await supabase.storage.from("leave-documents").upload(storagePath, params.file, { contentType: params.file.type || undefined, upsert: false });
    if (error) throw error;
    return { storagePath, fileName: params.file.name, mimeType: params.file.type || null, fileSizeBytes: params.file.size };
  },

  async getDocumentSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await supabase.storage.from("leave-documents").createSignedUrl(storagePath, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  },

  /** The single application entry point — employee identity is resolved server-side by the RPC
   *  itself (current_user_employee_id()); there is deliberately no employeeId parameter here or in
   *  the RPC, so no client value can ever target another employee's leave. */
  async applyLeave(params: {
    leaveTypeId: string;
    fromDate: string;
    toDate: string;
    isHalfDay?: boolean;
    halfDaySession?: string;
    reason?: string;
    remarks?: string;
    document?: { storagePath: string; fileName: string; mimeType: string | null; fileSizeBytes: number };
    /** Only consulted server-side when the resolved Leave Policy's Prior Notice rule requires it for
     *  LONG leave and notice is insufficient — see leave_apply()'s own Prior Notice block. Passing it
     *  when it isn't needed is harmless (ignored). */
    priorNoticeReason?: string;
  }): Promise<LeaveApplication> {
    const { data, error } = await supabase.rpc("leave_apply", {
      p_leave_type_id: params.leaveTypeId,
      p_from_date: params.fromDate,
      p_to_date: params.toDate,
      p_is_half_day: params.isHalfDay ?? false,
      p_half_day_session: params.halfDaySession ?? undefined,
      p_reason: params.reason ?? undefined,
      p_remarks: params.remarks ?? undefined,
      p_document_storage_path: params.document?.storagePath ?? undefined,
      p_document_file_name: params.document?.fileName ?? undefined,
      p_document_mime_type: params.document?.mimeType ?? undefined,
      p_document_file_size_bytes: params.document?.fileSizeBytes ?? undefined,
      p_prior_notice_reason: params.priorNoticeReason ?? undefined,
    });
    if (error) throw error;
    return mapApplication(data);
  },

  async cancelApplication(applicationId: string, remark?: string): Promise<LeaveApplication> {
    const { data, error } = await supabase.rpc("leave_cancel", { p_application_id: applicationId, p_remark: remark ?? undefined });
    if (error) throw error;
    return mapApplication(data);
  },

  /** Full immutable Step 1 -> Step 2 approval history for one application (Staff detail view and
   *  the Manager/Super Manager queue's history panel share this one call). */
  async listApprovalHistory(applicationId: string): Promise<LeaveApprovalAction[]> {
    const { data, error } = await supabase.rpc("leave_list_approval_history", { p_application_id: applicationId });
    if (error) throw error;
    return (data ?? []).map(mapApprovalAction);
  },

  // ---------------- Phase 3: Approval workflow ----------------
  /** Is the current employee anyone's Direct Manager at all? Independent of whether they currently
   *  have zero or several pending applications — used only to decide whether to show the Manager
   *  tab in the Leave Approvals UI. */
  async amIALeaveManager(): Promise<boolean> {
    const { data, error } = await supabase.rpc("leave_am_i_a_manager");
    if (error) throw error;
    return Boolean(data);
  },

  /** Server-filtered to exactly the applications requiring the CALLER's action as Direct Manager —
   *  never "select all and filter in the browser". */
  async listManagerPendingApplications(): Promise<LeaveApprovalQueueRow[]> {
    const { data, error } = await supabase.rpc("leave_list_manager_pending");
    if (error) throw error;
    return (data ?? []).map(mapApprovalQueueRow);
  },

  /** Server-filtered to exactly the applications requiring the CALLER's action as an active Super
   *  Manager for the company (any active Super Manager may act — first-come-first-served, same
   *  authorization model Night Duty already uses). */
  async listSuperManagerPendingApplications(): Promise<LeaveApprovalQueueRow[]> {
    const { data, error } = await supabase.rpc("leave_list_super_manager_pending");
    if (error) throw error;
    return (data ?? []).map(mapApprovalQueueRow);
  },

  /** Direct Manager decision. For SHORT leave this is FINAL (approved/rejected). For LONG leave,
   *  'approved' can only FORWARD to Super Manager — the backend enforces this; there is no
   *  frontend-selectable "final approve" for long leave, by construction. */
  async managerDecide(applicationId: string, decision: LeaveApprovalDecision, remark?: string): Promise<LeaveApplication> {
    const { data, error } = await supabase.rpc("leave_manager_decide", {
      p_application_id: applicationId,
      p_decision: decision,
      p_remark: remark ?? undefined,
    });
    if (error) throw error;
    return mapApplication(data);
  },

  /** Super Manager decision — always final (approved/rejected). Only reachable once an application
   *  is super_manager_pending; the backend re-verifies this regardless of what the UI shows. */
  async superManagerDecide(applicationId: string, decision: LeaveApprovalDecision, remark?: string): Promise<LeaveApplication> {
    const { data, error } = await supabase.rpc("leave_super_manager_decide", {
      p_application_id: applicationId,
      p_decision: decision,
      p_remark: remark ?? undefined,
    });
    if (error) throw error;
    return mapApplication(data);
  },

  // ---------------- Policy Preview (the ONE engine, read-only) ----------------
  async previewCalculation(params: { employeeId: string; leaveTypeId: string; financialYearId: string }): Promise<LeavePreviewRow[]> {
    const { data, error } = await supabase.rpc("leave_preview_calculation", {
      p_employee_id: params.employeeId,
      p_leave_type_id: params.leaveTypeId,
      p_financial_year_id: params.financialYearId,
    });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      monthStart: row.month_start,
      policyId: row.policy_id,
      isProbation: row.is_probation,
      isEligible: row.is_eligible,
      monthlyEntitlement: Number(row.monthly_entitlement),
      cumulativeEarned: Number(row.cumulative_earned),
      used: Number(row.used),
      pending: Number(row.pending),
      closingBalance: Number(row.closing_balance),
      note: row.note,
    }));
  },

  // ---------------- Phase 4: Salary Components (minimal — Encashment's only need) ----------------
  async listSalaryComponents(employeeId: string): Promise<EmployeeSalaryComponent[]> {
    const { data, error } = await supabase.from("employee_salary_components").select("*").eq("employee_id", employeeId).order("effective_from", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapSalaryComponent);
  },

  async addSalaryComponent(params: { companyId: string; employeeId: string; basicSalary: number; da: number; effectiveFrom: string; effectiveTo?: string; remark?: string; userId?: string }): Promise<EmployeeSalaryComponent> {
    const { data, error } = await supabase
      .from("employee_salary_components")
      .insert({
        company_id: params.companyId,
        employee_id: params.employeeId,
        basic_salary: params.basicSalary,
        da: params.da,
        effective_from: params.effectiveFrom,
        effective_to: params.effectiveTo ?? null,
        remark: params.remark ?? null,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapSalaryComponent(data);
  },

  // ---------------- Phase 4: Encashment Rule (one per policy) ----------------
  async getEncashmentRule(policyId: string): Promise<LeaveEncashmentRule | null> {
    const { data, error } = await supabase.from("leave_encashment_rules").select("*").eq("policy_id", policyId).maybeSingle();
    if (error) throw error;
    return data ? mapEncashmentRule(data) : null;
  },

  async upsertEncashmentRule(params: {
    policyId: string;
    enabled: boolean;
    salaryBaseType: string;
    divisorType: string;
    divisorCustomValue?: number | null;
    thresholdBaseType: string;
    salaryThreshold?: number | null;
    thresholdComparison: string;
    userId?: string;
  }): Promise<LeaveEncashmentRule> {
    const existing = await this.getEncashmentRule(params.policyId);
    const payload = {
      policy_id: params.policyId,
      enabled: params.enabled,
      salary_base_type: params.salaryBaseType,
      divisor_type: params.divisorType,
      divisor_custom_value: params.divisorCustomValue ?? null,
      threshold_base_type: params.thresholdBaseType,
      salary_threshold: params.salaryThreshold ?? null,
      threshold_comparison: params.thresholdComparison,
      updated_by: params.userId ?? null,
    };
    if (existing) {
      const { data, error } = await supabase.from("leave_encashment_rules").update(payload).eq("id", existing.id).select("*").single();
      if (error) throw error;
      return mapEncashmentRule(data);
    }
    const { data, error } = await supabase.from("leave_encashment_rules").insert({ ...payload, created_by: params.userId ?? null }).select("*").single();
    if (error) throw error;
    return mapEncashmentRule(data);
  },

  // ---------------- Monthly Accrual Posting ----------------
  /** Dry-run (preview) or commit the monthly accrual into leave_ledger. Reuses the existing
   *  leave_preview_calculation() engine per employee — no calculation happens here or in the UI.
   *  Idempotent: re-posting the same period is a no-op (partial unique index + in-function check). */
  async runAccrual(params: {
    financialYearId: string;
    policyId: string;
    leaveTypeId: string;
    upToMonth?: string;
    dryRun: boolean;
  }): Promise<Array<{
    employeeId: string; employeeName: string; employeeCode: string; eligible: boolean;
    entitlementDays: number; alreadyPostedDays: number; toPostDays: number; toPostMonths: number; posted: boolean;
  }>> {
    const { data, error } = await supabase.rpc("leave_accrual_run", {
      p_financial_year_id: params.financialYearId,
      p_policy_id: params.policyId,
      p_leave_type_id: params.leaveTypeId,
      p_up_to_month: params.upToMonth ?? undefined,
      p_dry_run: params.dryRun,
    });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      employeeCode: r.employee_code,
      eligible: r.eligible,
      entitlementDays: Number(r.entitlement_days),
      alreadyPostedDays: Number(r.already_posted_days),
      toPostDays: Number(r.to_post_days),
      toPostMonths: Number(r.to_post_months),
      posted: r.posted,
    }));
  },

  // ---------------- Approval Hierarchy threshold (one per policy) ----------------
  /** The SAME `leave_short_long_rules` row leave_apply()/leave_manager_decide() already use to
   *  decide whether a leave is Direct-Manager-final ("short") or needs Super Manager ("long").
   *  This is the APPROVAL threshold — completely separate from the Prior Notice notice period. */
  async getApprovalThresholdRule(policyId: string): Promise<{ id: string; policyId: string; thresholdDays: number; thresholdOperator: string } | null> {
    const { data, error } = await supabase.from("leave_short_long_rules").select("*").eq("policy_id", policyId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { id: data.id, policyId: data.policy_id, thresholdDays: Number(data.threshold_days), thresholdOperator: data.threshold_operator };
  },

  async upsertApprovalThresholdRule(params: { policyId: string; thresholdDays: number; thresholdOperator?: string; userId?: string }): Promise<void> {
    const existing = await this.getApprovalThresholdRule(params.policyId);
    const payload = {
      policy_id: params.policyId,
      threshold_days: params.thresholdDays,
      threshold_operator: params.thresholdOperator ?? "short_lte",
      updated_by: params.userId ?? null,
    };
    if (existing) {
      const { error } = await supabase.from("leave_short_long_rules").update(payload).eq("id", existing.id);
      if (error) throw error;
      return;
    }
    const { error } = await supabase.from("leave_short_long_rules").insert({ ...payload, created_by: params.userId ?? null });
    if (error) throw error;
  },

  // ---------------- Phase 4: Prior Notice Rule (one per policy) ----------------
  async getPriorNoticeRule(policyId: string): Promise<LeavePriorNoticeRule | null> {
    const { data, error } = await supabase.from("leave_prior_notice_rules").select("*").eq("policy_id", policyId).maybeSingle();
    if (error) throw error;
    return data ? mapPriorNoticeRule(data) : null;
  },

  async upsertPriorNoticeRule(params: { policyId: string; required: boolean; noticeDays: number; exceptionBehavior: string; userId?: string }): Promise<LeavePriorNoticeRule> {
    const existing = await this.getPriorNoticeRule(params.policyId);
    const payload = {
      policy_id: params.policyId,
      required: params.required,
      notice_days: params.noticeDays,
      exception_behavior: params.exceptionBehavior,
      updated_by: params.userId ?? null,
    };
    if (existing) {
      const { data, error } = await supabase.from("leave_prior_notice_rules").update(payload).eq("id", existing.id).select("*").single();
      if (error) throw error;
      return mapPriorNoticeRule(data);
    }
    const { data, error } = await supabase.from("leave_prior_notice_rules").insert({ ...payload, created_by: params.userId ?? null }).select("*").single();
    if (error) throw error;
    return mapPriorNoticeRule(data);
  },

  // ---------------- Phase 4: Prior Notice Exceptions ----------------
  /** Standalone request — its own RPC call/transaction, so the pending row genuinely persists even
   *  though leave_apply() itself must still reject the application until this is approved (see
   *  migration 0120's header note on why these were split). */
  async requestPriorNoticeException(params: { leaveTypeId: string; fromDate: string; toDate: string; reason: string }): Promise<LeavePriorNoticeException> {
    const { data, error } = await supabase.rpc("leave_request_prior_notice_exception", {
      p_leave_type_id: params.leaveTypeId,
      p_from_date: params.fromDate,
      p_to_date: params.toDate,
      p_reason: params.reason,
    });
    if (error) throw error;
    return mapPriorNoticeException(data);
  },

  async listPendingPriorNoticeExceptions(): Promise<LeavePriorNoticeException[]> {
    const { data, error } = await supabase.rpc("leave_list_pending_prior_notice_exceptions");
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) return [];
    const employeeIds = Array.from(new Set(rows.map((r: any) => r.employee_id)));
    const leaveTypeIds = Array.from(new Set(rows.map((r: any) => r.leave_type_id)));
    const [{ data: employees }, { data: leaveTypes }] = await Promise.all([
      supabase.from("employees").select("id, full_name").in("id", employeeIds),
      supabase.from("leave_types").select("id, name").in("id", leaveTypeIds),
    ]);
    const employeeMap = new Map((employees ?? []).map((e: any) => [e.id, e.full_name]));
    const leaveTypeMap = new Map((leaveTypes ?? []).map((t: any) => [t.id, t.name]));
    return rows.map((row: any) => ({
      ...mapPriorNoticeException(row),
      employeeName: employeeMap.get(row.employee_id),
      leaveTypeName: leaveTypeMap.get(row.leave_type_id),
    }));
  },

  async decidePriorNoticeException(exceptionId: string, decision: "approved" | "rejected", remark?: string): Promise<LeavePriorNoticeException> {
    const { data, error } = await supabase.rpc("leave_decide_prior_notice_exception", { p_exception_id: exceptionId, p_decision: decision, p_remark: remark ?? undefined });
    if (error) throw error;
    return mapPriorNoticeException(data);
  },

  // ---------------- Phase 4: Notifications ----------------
  async listMyNotifications(limit = 50): Promise<LeaveNotification[]> {
    const { data, error } = await supabase.rpc("leave_list_my_notifications", { p_limit: limit });
    if (error) throw error;
    return (data ?? []).map(mapNotification);
  },

  async unreadNotificationCount(): Promise<number> {
    const { data, error } = await supabase.rpc("leave_unread_notification_count");
    if (error) throw error;
    return Number(data ?? 0);
  },

  async markNotificationRead(notificationId: string): Promise<void> {
    const { error } = await supabase.rpc("leave_mark_notification_read", { p_notification_id: notificationId });
    if (error) throw error;
  },

  async markAllNotificationsRead(): Promise<void> {
    const { error } = await supabase.rpc("leave_mark_all_notifications_read");
    if (error) throw error;
  },

  async listNotificationSettings(companyId: string): Promise<LeaveNotificationSetting[]> {
    const { data, error } = await supabase.from("leave_notification_settings").select("*").eq("company_id", companyId).order("event_type");
    if (error) throw error;
    return (data ?? []).map(mapNotificationSetting);
  },

  async updateNotificationSetting(params: { id: string; inAppEnabled: boolean; pushEnabled: boolean; emailEnabled: boolean; smsEnabled: boolean; userId?: string }): Promise<LeaveNotificationSetting> {
    const { data, error } = await supabase
      .from("leave_notification_settings")
      .update({ in_app_enabled: params.inAppEnabled, push_enabled: params.pushEnabled, email_enabled: params.emailEnabled, sms_enabled: params.smsEnabled, updated_by: params.userId ?? null })
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return mapNotificationSetting(data);
  },

  // ---------------- Phase 4: Financial Year Closing (ONE engine — Preview and Confirm share it) ----------------
  async previewFyClosing(financialYearId: string): Promise<LeaveFyClosingLine[]> {
    const { data, error } = await supabase.rpc("leave_preview_fy_closing", { p_financial_year_id: financialYearId });
    if (error) throw error;
    return (data ?? []).map(mapFyClosingLine);
  },

  async confirmFyClosing(financialYearId: string, nextFinancialYearId?: string, remark?: string): Promise<LeaveFyClosingBatch> {
    const { data, error } = await supabase.rpc("leave_confirm_fy_closing", {
      p_financial_year_id: financialYearId,
      p_next_financial_year_id: nextFinancialYearId ?? undefined,
      p_remark: remark ?? undefined,
    });
    if (error) throw error;
    return mapFyClosingBatch(data);
  },

  async getFyClosingBatch(financialYearId: string): Promise<LeaveFyClosingBatch | null> {
    const { data, error } = await supabase.rpc("leave_get_fy_closing_batch", { p_financial_year_id: financialYearId });
    if (error) throw error;
    return data ? mapFyClosingBatch(data) : null;
  },

  async listFyClosingLines(batchId: string): Promise<LeaveFyClosingLine[]> {
    const { data, error } = await supabase.rpc("leave_list_fy_closing_lines", { p_batch_id: batchId });
    if (error) throw error;
    return (data ?? []).map(mapFyClosingLine);
  },

  // ---------------- Phase 4: Payroll Integration (read-only view — no payroll module exists to post into yet) ----------------
  async listPayrollLeaveTransactions(companyId: string): Promise<PayrollLeaveTransaction[]> {
    const { data, error } = await supabase.from("payroll_leave_transactions").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapPayrollTransaction);
  },

  /** The Staff's own raw Ledger — RLS already scopes leave_ledger to "self" for a staff caller
   *  (leave_ledger_select_scoped), so no employeeId parameter is needed or accepted here, same
   *  identity-resolution discipline as every other Staff-facing Leave method in this file. */
  async listMyLedger(financialYearId?: string): Promise<any[]> {
    let query = supabase.from("leave_ledger").select("*, leave_types(name)").order("created_at", { ascending: false });
    if (financialYearId) query = query.eq("financial_year_id", financialYearId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      leaveTypeName: r.leave_types?.name,
      transactionType: r.transaction_type,
      transactionDate: r.transaction_date,
      days: Number(r.days),
      remark: r.remark,
      createdAt: r.created_at,
    }));
  },

  // ---------------- Phase 5: Leave -> Attendance integration (read-only for the Calendar) ----------------
  /** ONLY approved-Leave dates already materialized by leave_manager_decide()/leave_super_manager_decide()
   *  — never recomputed here; the Attendance Calendar merges these in at display time exactly like it
   *  already merges Weekly Off, never touching attendance_records itself. */
  async listAttendanceEffects(employeeId: string, fromDate: string, toDate: string): Promise<{ date: string; isHalfDay: boolean }[]> {
    const { data, error } = await supabase.rpc("leave_list_attendance_effects", { p_employee_id: employeeId, p_from_date: fromDate, p_to_date: toDate });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({ date: row.attendance_date, isHalfDay: row.is_half_day }));
  },

  // ---------------- Phase 5: Reports ----------------
  /** The Employee Leave Ledger report reads the SAME leave_ledger table leave_get_balance() itself
   *  sums from — never a second balance calculation, just a raw row listing for display. RLS
   *  already scopes this to company-wide for non-staff roles (leave_ledger_select_scoped). */
  async reportLedger(companyId: string, financialYearId?: string): Promise<any[]> {
    let query = supabase
      .from("leave_ledger")
      .select("*, employees(full_name, employee_code), leave_types(name)")
      .eq("company_id", companyId)
      .order("employee_id")
      .order("created_at");
    if (financialYearId) query = query.eq("financial_year_id", financialYearId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employees?.full_name,
      employeeCode: r.employees?.employee_code,
      leaveTypeId: r.leave_type_id,
      leaveTypeName: r.leave_types?.name,
      financialYearId: r.financial_year_id,
      transactionType: r.transaction_type,
      transactionDate: r.transaction_date,
      days: Number(r.days),
      remark: r.remark,
      createdAt: r.created_at,
    }));
  },

  async reportApplications(fromDate?: string, toDate?: string): Promise<any[]> {
    const { data, error } = await supabase.rpc("leave_report_applications", { p_from_date: fromDate ?? undefined, p_to_date: toDate ?? undefined });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      employeeCode: r.employee_code,
      storeId: r.store_id,
      storeName: r.store_name,
      departmentId: r.department_id,
      departmentName: r.department_name,
      leaveTypeId: r.leave_type_id,
      leaveTypeName: r.leave_type_name,
      financialYearId: r.financial_year_id,
      fromDate: r.from_date,
      toDate: r.to_date,
      totalDays: Number(r.total_days),
      isHalfDay: r.is_half_day,
      shortOrLong: r.short_or_long,
      status: r.status,
      appliedAt: r.applied_at,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      decisionRemark: r.decision_remark,
      pendingWith: r.pending_with,
      paidDays: Number(r.paid_days ?? 0),
      unpaidDays: Number(r.unpaid_days ?? 0),
    }));
  },

  async reportBalances(financialYearId: string): Promise<any[]> {
    const { data, error } = await supabase.rpc("leave_report_balances", { p_financial_year_id: financialYearId });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      employeeCode: r.employee_code,
      leaveTypeId: r.leave_type_id,
      leaveTypeName: r.leave_type_name,
      earned: Number(r.earned),
      used: Number(r.used),
      pending: Number(r.pending),
      available: Number(r.available),
    }));
  },

  async reportProbation(companyId: string): Promise<any[]> {
    const { data, error } = await supabase.rpc("leave_report_probation", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      employeeCode: r.employee_code,
      joiningDate: r.joining_date,
      policyId: r.policy_id,
      probationDurationValue: r.probation_duration_value,
      probationDurationUnit: r.probation_duration_unit,
      postProbationStartRule: r.post_probation_start_rule,
      eligibilityStart: r.eligibility_start,
      isCurrentlyInProbation: r.is_currently_in_probation,
    }));
  },

  async listFyClosingBatchesForCompany(companyId: string): Promise<LeaveFyClosingBatch[]> {
    const { data, error } = await supabase.rpc("leave_list_fy_closing_batches_for_company", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapFyClosingBatch);
  },

  async reportPolicyChanges(companyId: string): Promise<any[]> {
    const { data, error } = await supabase.rpc("leave_report_policy_changes", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      policyId: r.policy_id,
      policyName: r.policy_name,
      versionNumber: r.version_number,
      previousVersionId: r.previous_version_id,
      status: r.status,
      changeReason: r.change_reason,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      createdAt: r.created_at,
      auditAction: r.audit_action,
      auditChangedData: r.audit_changed_data,
      auditPerformedBy: r.audit_performed_by,
      auditPerformedAt: r.audit_performed_at,
    }));
  },

  async reportAudit(companyId: string, fromDate?: string, toDate?: string): Promise<any[]> {
    const { data, error } = await supabase.rpc("leave_report_audit", { p_company_id: companyId, p_from_date: fromDate ?? undefined, p_to_date: toDate ?? undefined });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      tableName: r.table_name,
      recordId: r.record_id,
      action: r.action,
      changedData: r.changed_data,
      performedBy: r.performed_by,
      performedAt: r.performed_at,
    }));
  },
};
