import { supabase } from "@/lib/supabaseClient";
import type { ExitType, ExitRequestListRow, ExitRequestDetail, ExitRegisterRow } from "@/types/exit";

const n = (v: any): number => (v === null || v === undefined ? 0 : Number(v));

export const exitService = {
  async listTypes(companyId: string): Promise<ExitType[]> {
    const { data, error } = await supabase.from("exit_types").select("*").eq("company_id", companyId).order("display_order");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id, companyId: r.company_id, code: r.code, name: r.name, isActive: r.is_active, displayOrder: r.display_order,
    }));
  },
  async upsertType(p: { id?: string; companyId: string; code: string; name: string; isActive?: boolean; displayOrder?: number; userId?: string | null }): Promise<void> {
    const payload = { company_id: p.companyId, code: p.code, name: p.name, is_active: p.isActive ?? true, display_order: p.displayOrder ?? 100, updated_by: p.userId ?? null };
    const { error } = p.id
      ? await supabase.from("exit_types").update(payload).eq("id", p.id)
      : await supabase.from("exit_types").insert({ ...payload, created_by: p.userId ?? null });
    if (error) throw error;
  },
  // Exit / F&F approver roster (exit_approvers) management lives in fnfService —
  // this workflow and F&F Core share the SAME roster (see 0147's design notes).

  async list(companyId: string): Promise<ExitRequestListRow[]> {
    const { data, error } = await supabase.rpc("exit_request_list", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, employeeCode: r.employee_code ?? null,
      store: r.store ?? null, department: r.department ?? null, joiningDate: r.joining_date ?? null,
      exitType: r.exit_type, requestedLeavingDate: r.requested_leaving_date, effectiveLeavingDate: r.effective_leaving_date ?? null,
      status: r.status, currentStep: n(r.current_step), fnfSettlementId: r.fnf_settlement_id ?? null, createdAt: r.created_at,
    }));
  },
  async get(id: string): Promise<ExitRequestDetail> {
    const { data, error } = await supabase.rpc("exit_request_get", { p_id: id });
    if (error) throw error;
    const d = data as any;
    return {
      id: d.id, companyId: d.company_id, employeeId: d.employee_id, employeeName: d.employee_name, employeeCode: d.employee_code ?? null,
      store: d.store ?? null, department: d.department ?? null, designation: d.designation ?? null, joiningDate: d.joining_date ?? null,
      exitTypeId: d.exit_type_id, exitType: d.exit_type ? { id: d.exit_type.id, companyId: d.exit_type.company_id, code: d.exit_type.code, name: d.exit_type.name, isActive: d.exit_type.is_active, displayOrder: d.exit_type.display_order } : null,
      reason: d.reason ?? null, notes: d.notes ?? null, requestedLeavingDate: d.requested_leaving_date,
      noticePeriodDays: n(d.notice_period_days), noticeServedDays: n(d.notice_served_days), expectedLastWorkingDate: d.expected_last_working_date ?? null,
      status: d.status, currentStep: n(d.current_step), maxStage: n(d.max_stage), effectiveLeavingDate: d.effective_leaving_date ?? null,
      fnfSettlementId: d.fnf_settlement_id ?? null,
      decisions: (d.decisions ?? []).map((x: any) => ({ id: x.id, stepNo: n(x.step_no), action: x.action, actor: x.actor ?? null, remark: x.remark ?? null, decidedAt: x.decided_at })),
    };
  },
  async create(p: {
    companyId: string; employeeId: string; exitTypeId: string; requestedLeavingDate: string; reason?: string; notes?: string;
    noticePeriodDays?: number; noticeServedDays?: number; expectedLastWorkingDate?: string;
  }): Promise<{ id: string }> {
    const { data, error } = await supabase.rpc("exit_request_create", {
      p_company_id: p.companyId, p_employee_id: p.employeeId, p_exit_type_id: p.exitTypeId, p_requested_leaving_date: p.requestedLeavingDate,
      p_reason: p.reason ?? null, p_notes: p.notes ?? null, p_notice_period_days: p.noticePeriodDays ?? 0,
      p_notice_served_days: p.noticeServedDays ?? 0, p_expected_last_working_date: p.expectedLastWorkingDate ?? null,
    });
    if (error) throw error;
    return data as any;
  },
  async submit(id: string): Promise<void> { const { error } = await supabase.rpc("exit_request_submit", { p_id: id }); if (error) throw error; },
  async decide(id: string, action: "approve" | "reject" | "send_back", remark?: string): Promise<void> {
    const { error } = await supabase.rpc("exit_request_decide", { p_id: id, p_action: action, p_remark: remark ?? null });
    if (error) throw error;
  },
  async cancel(id: string, reason: string): Promise<void> { const { error } = await supabase.rpc("exit_request_cancel", { p_id: id, p_reason: reason }); if (error) throw error; },
  async correctLeavingDate(id: string, newDate: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc("exit_request_correct_leaving_date", { p_id: id, p_new_leaving_date: newDate, p_reason: reason });
    if (error) throw error;
  },
  async createFnf(exitRequestId: string): Promise<{ id: string }> {
    const { data, error } = await supabase.rpc("fnf_create_from_exit_request", { p_exit_request_id: exitRequestId });
    if (error) throw error;
    return data as any;
  },
  async register(companyId: string, from?: string | null, to?: string | null): Promise<ExitRegisterRow[]> {
    const { data, error } = await supabase.rpc("exit_register", { p_company_id: companyId, p_from: from ?? null, p_to: to ?? null });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      staffId: r.staff_id ?? null, employeeName: r.employee_name, store: r.store ?? null, department: r.department ?? null,
      joiningDate: r.joining_date ?? null, leavingDate: r.leaving_date, exitType: r.exit_type, reason: r.reason ?? null,
      exitStatus: r.exit_status ?? null, fnfStatus: r.fnf_status, fnfAmount: r.fnf_amount == null ? null : n(r.fnf_amount), paymentStatus: r.payment_status,
    }));
  },
};
