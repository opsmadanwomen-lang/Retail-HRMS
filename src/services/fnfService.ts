import { supabase } from "@/lib/supabaseClient";
import type {
  FnfSettlement, FnfDetail, FnfLine, FnfAdjustment, FnfPayment, FnfEvent, FnfListRow, FnfRegisterRow,
} from "@/types/fnf";

const n = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

function mapSettlement(r: any): FnfSettlement {
  return {
    id: r.id, companyId: r.company_id, employeeId: r.employee_id,
    employeeName: r.employee_name ?? null, employeeCode: r.employee_code ?? null,
    store: r.store ?? null, department: r.department ?? null, designation: r.designation ?? null,
    joiningDate: r.joining_date ?? null,
    version: n(r.version), reversesSettlementId: r.reverses_settlement_id ?? null,
    exitType: r.exit_type, leavingDate: r.leaving_date, status: r.status,
    noticeRequiredDays: n(r.notice_required_days), noticeServedDays: n(r.notice_served_days),
    noticeShortfallDays: n(r.notice_shortfall_days), noticeWaived: Boolean(r.notice_waived),
    leavePolicyId: r.leave_policy_id ?? null, encashableLeaveDays: n(r.encashable_leave_days),
    payrollPolicyId: r.payroll_policy_id ?? null, salaryStructureId: r.salary_structure_id ?? null,
    basicSnapshot: nn(r.basic_snapshot), daSnapshot: nn(r.da_snapshot),
    grossEarnings: n(r.gross_earnings), totalDeductions: n(r.total_deductions),
    employerContributionTotal: n(r.employer_contribution_total),
    advanceRecovered: n(r.advance_recovered), advanceRemaining: n(r.advance_remaining),
    netSettlement: n(r.net_settlement), amountPaid: n(r.amount_paid),
    hasNegativeNet: Boolean(r.has_negative_net), needsReview: Boolean(r.needs_review),
    reviewNotes: r.review_notes ?? null, snapshot: r.snapshot ?? null,
    monthsComputed: r.months_computed ?? null, monthsConsumed: r.months_consumed ?? null,
    calculatedAt: r.calculated_at ?? null, submittedAt: r.submitted_at ?? null,
    approvedAt: r.approved_at ?? null, approvedBy: r.approved_by ?? null, closedAt: r.closed_at ?? null,
    createdAt: r.created_at,
  };
}
const mapLine = (r: any): FnfLine => ({
  id: r.id, lineType: r.line_type, code: r.code, name: r.name,
  quantity: nn(r.quantity), rate: nn(r.rate), amount: n(r.amount),
  source: r.source ?? null, calcType: r.calc_type ?? null, calcNote: r.calc_note ?? null,
  isAdjustment: Boolean(r.is_adjustment), isProtected: Boolean(r.is_protected), sortOrder: n(r.sort_order),
});
const mapAdj = (r: any): FnfAdjustment => ({
  id: r.id, lineType: r.line_type, code: r.code, name: r.name, amount: n(r.amount), reason: r.reason, createdAt: r.created_at,
});
const mapPay = (r: any): FnfPayment => ({
  id: r.id, amount: n(r.amount), paymentDate: r.payment_date, paymentMode: r.payment_mode ?? null,
  transactionReference: r.transaction_reference ?? null, bankDetails: r.bank_details ?? null,
  notes: r.notes ?? null, createdAt: r.created_at,
});
const mapEvent = (r: any): FnfEvent => ({
  id: r.id, event: r.event, fromStatus: r.from_status ?? null, toStatus: r.to_status ?? null,
  actor: r.actor ?? null, reason: r.reason ?? null, meta: r.meta ?? null, createdAt: r.created_at,
});

function mapDetail(d: any): FnfDetail {
  return {
    settlement: mapSettlement(d.settlement),
    lines: (d.lines ?? []).map(mapLine),
    adjustments: (d.adjustments ?? []).map(mapAdj),
    payments: (d.payments ?? []).map(mapPay),
    events: (d.events ?? []).map(mapEvent),
  };
}

export const fnfService = {
  async amIApprover(companyId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("fnf_can_approve", { p_company_id: companyId });
    if (error) throw error;
    return Boolean(data);
  },
  async list(companyId: string): Promise<FnfListRow[]> {
    const { data, error } = await supabase.rpc("fnf_list", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, employeeCode: r.employee_code ?? null,
      store: r.store ?? null, exitType: r.exit_type, leavingDate: r.leaving_date, status: r.status,
      grossEarnings: n(r.gross_earnings), totalDeductions: n(r.total_deductions),
      advanceRecovered: n(r.advance_recovered), netSettlement: n(r.net_settlement), amountPaid: n(r.amount_paid),
      version: n(r.version), createdAt: r.created_at, calculatedAt: r.calculated_at ?? null, approvedAt: r.approved_at ?? null,
    }));
  },
  async get(id: string): Promise<FnfDetail> {
    const { data, error } = await supabase.rpc("fnf_get", { p_fnf_id: id });
    if (error) throw error;
    return mapDetail(data as any);
  },
  async create(p: {
    companyId: string; employeeId: string; exitType: string; leavingDate: string;
    noticeServedDays?: number; noticeWaived?: boolean; encashableLeaveDays?: number; leavePolicyId?: string | null;
  }): Promise<FnfSettlement> {
    const { data, error } = await supabase.rpc("fnf_create", {
      p_company_id: p.companyId, p_employee_id: p.employeeId, p_exit_type: p.exitType, p_leaving_date: p.leavingDate,
      p_notice_served_days: p.noticeServedDays ?? 0, p_notice_waived: p.noticeWaived ?? false,
      p_encashable_leave_days: p.encashableLeaveDays ?? 0, p_leave_policy_id: p.leavePolicyId ?? null,
    });
    if (error) throw error;
    return mapSettlement(data as any);
  },
  async addAdjustment(p: { id: string; lineType: "earning" | "deduction"; code: string; name: string; amount: number; reason: string }): Promise<void> {
    const { error } = await supabase.rpc("fnf_add_adjustment", {
      p_fnf_id: p.id, p_line_type: p.lineType, p_code: p.code, p_name: p.name, p_amount: p.amount, p_reason: p.reason,
    });
    if (error) throw error;
  },
  async calculate(id: string): Promise<FnfDetail> {
    const { data, error } = await supabase.rpc("fnf_calculate", { p_fnf_id: id });
    if (error) throw error;
    return mapDetail(data as any);
  },
  async submit(id: string): Promise<void> { const { error } = await supabase.rpc("fnf_submit", { p_fnf_id: id }); if (error) throw error; },
  async approve(id: string, note?: string): Promise<void> { const { error } = await supabase.rpc("fnf_approve", { p_fnf_id: id, p_note: note ?? null }); if (error) throw error; },
  async reject(id: string, reason: string): Promise<void> { const { error } = await supabase.rpc("fnf_reject", { p_fnf_id: id, p_reason: reason }); if (error) throw error; },
  async sendBack(id: string, reason: string): Promise<void> { const { error } = await supabase.rpc("fnf_send_back", { p_fnf_id: id, p_reason: reason }); if (error) throw error; },
  async pay(p: {
    id: string; amount: number; paymentDate: string; paymentMode?: string; transactionReference?: string; bankDetails?: string; notes?: string;
  }): Promise<void> {
    const { error } = await supabase.rpc("fnf_pay", {
      p_fnf_id: p.id, p_amount: p.amount, p_payment_date: p.paymentDate, p_payment_mode: p.paymentMode ?? null,
      p_transaction_reference: p.transactionReference ?? null, p_bank_details: p.bankDetails ?? null, p_notes: p.notes ?? null,
    });
    if (error) throw error;
  },
  async reverse(id: string, reason: string): Promise<void> { const { error } = await supabase.rpc("fnf_reverse", { p_fnf_id: id, p_reason: reason }); if (error) throw error; },
  async register(companyId: string, from?: string | null, to?: string | null): Promise<FnfRegisterRow[]> {
    const { data, error } = await supabase.rpc("fnf_register", { p_company_id: companyId, p_from: from ?? null, p_to: to ?? null });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      employeeName: r.employee_name, staffId: r.staff_id ?? null, store: r.store ?? null, department: r.department ?? null,
      joiningDate: r.joining_date ?? null, leavingDate: r.leaving_date, exitType: r.exit_type,
      totalEarnings: n(r.total_earnings), totalDeductions: n(r.total_deductions), advanceRecovery: n(r.advance_recovery),
      leaveEncashment: n(r.leave_encashment), netFnf: n(r.net_fnf), status: r.status, paymentDate: r.payment_date ?? null,
    }));
  },

  // ---- exit / F&F configuration ----
  async getSettings(companyId: string) {
    const { data } = await supabase.from("fnf_settings").select("*").eq("company_id", companyId).maybeSingle();
    return data as any;
  },
  async saveSettings(p: { companyId: string; advanceRecoveryMode: string; autoInactivateOnClose: boolean; userId?: string | null }) {
    const { error } = await supabase.from("fnf_settings").upsert({
      company_id: p.companyId, advance_recovery_mode: p.advanceRecoveryMode, auto_inactivate_on_close: p.autoInactivateOnClose, updated_by: p.userId ?? null,
    }, { onConflict: "company_id" });
    if (error) throw error;
  },
  async listApprovers(companyId: string) {
    const { data, error } = await supabase.from("exit_approvers").select("*").eq("company_id", companyId);
    if (error) throw error;
    return (data ?? []) as any[];
  },
  async addApprover(companyId: string, employeeId: string, userId?: string | null, stageNo = 1) {
    const { error } = await supabase.from("exit_approvers").upsert({
      company_id: companyId, employee_id: employeeId, stage_no: stageNo, is_active: true, created_by: userId ?? null,
    }, { onConflict: "company_id,employee_id" });
    if (error) throw error;
  },
  async setApproverActive(id: string, isActive: boolean) {
    const { error } = await supabase.from("exit_approvers").update({ is_active: isActive }).eq("id", id);
    if (error) throw error;
  },
  async listNoticePolicies(companyId: string) {
    const { data, error } = await supabase.from("exit_notice_policies").select("*").eq("company_id", companyId).order("effective_from", { ascending: false });
    if (error) throw error;
    return (data ?? []) as any[];
  },
  async saveNoticePolicy(p: any) {
    const payload = {
      company_id: p.companyId, notice_days: p.noticeDays, recovery_enabled: p.recoveryEnabled,
      recovery_basis: p.recoveryBasis ?? null, recovery_component_code: p.recoveryComponentCode ?? null,
      recovery_divisor_type: p.recoveryDivisorType, recovery_divisor_custom: p.recoveryDivisorCustom ?? null,
      shortfall_recovery: p.shortfallRecovery, waiver_allowed: p.waiverAllowed,
      effective_from: p.effectiveFrom, remark: p.remark ?? null, updated_by: p.userId ?? null,
    };
    if (p.id) {
      const { error } = await supabase.from("exit_notice_policies").update(payload).eq("id", p.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("exit_notice_policies").insert({ ...payload, created_by: p.userId ?? null });
      if (error) throw error;
    }
  },
};
