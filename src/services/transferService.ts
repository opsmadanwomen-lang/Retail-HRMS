import { supabase } from "@/lib/supabaseClient";
import type { TransferListRow, TransferDetail, TransferRegisterRow } from "@/types/transfer";

const n = (v: any): number => (v === null || v === undefined ? 0 : Number(v));

export const transferService = {
  async listApprovers(companyId: string) {
    const { data, error } = await supabase.from("transfer_approvers").select("*").eq("company_id", companyId).order("stage_no");
    if (error) throw error;
    return (data ?? []) as any[];
  },
  async addApprover(companyId: string, employeeId: string, stageNo: number, userId?: string | null) {
    const { error } = await supabase.from("transfer_approvers").upsert({
      company_id: companyId, employee_id: employeeId, stage_no: stageNo, is_active: true, created_by: userId ?? null,
    }, { onConflict: "company_id,employee_id" });
    if (error) throw error;
  },
  async setApproverActive(id: string, isActive: boolean) {
    const { error } = await supabase.from("transfer_approvers").update({ is_active: isActive }).eq("id", id);
    if (error) throw error;
  },

  async list(companyId: string): Promise<TransferListRow[]> {
    const { data, error } = await supabase.rpc("transfer_request_list", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, employeeCode: r.employee_code ?? null,
      oldStore: r.old_store ?? null, newStore: r.new_store ?? null, oldDepartment: r.old_department ?? null, newDepartment: r.new_department ?? null,
      oldDesignation: r.old_designation ?? null, newDesignation: r.new_designation ?? null, effectiveDate: r.effective_date,
      reason: r.reason ?? null, status: r.status, currentStep: n(r.current_step), decidedBy: r.decided_by ?? null, createdAt: r.created_at,
    }));
  },
  async get(id: string): Promise<TransferDetail> {
    const { data, error } = await supabase.rpc("transfer_request_get", { p_id: id });
    if (error) throw error;
    const d = data as any;
    return {
      id: d.id, companyId: d.company_id, employeeId: d.employee_id, employeeName: d.employee_name, employeeCode: d.employee_code ?? null,
      effectiveDate: d.effective_date, reason: d.reason ?? null, status: d.status, currentStep: n(d.current_step), maxStage: n(d.max_stage),
      applied_at: d.applied_at ?? null,
      newStoreId: d.new_store_id ?? null, newStoreDepartmentId: d.new_store_department_id ?? null, newStoreDesignationId: d.new_store_designation_id ?? null,
      newStoreTeamId: d.new_store_team_id ?? null, newGradeId: d.new_grade_id ?? null, newCategoryId: d.new_category_id ?? null,
      newReportingManagerId: d.new_reporting_manager_id ?? null, newSuperManagerId: d.new_super_manager_id ?? null,
      newEmploymentType: d.new_employment_type ?? null, newSalaryStructureId: d.new_salary_structure_id ?? null, newShiftId: d.new_shift_id ?? null,
      decisions: (d.decisions ?? []).map((x: any) => ({ id: x.id, stepNo: n(x.step_no), action: x.action, actor: x.actor ?? null, remark: x.remark ?? null, decidedAt: x.decided_at })),
    };
  },
  async create(p: {
    companyId: string; employeeId: string; effectiveDate: string; reason?: string;
    newStoreId?: string | null; newStoreDepartmentId?: string | null; newStoreDesignationId?: string | null; newStoreTeamId?: string | null;
    newGradeId?: string | null; newCategoryId?: string | null; newReportingManagerId?: string | null; newSuperManagerId?: string | null;
    newEmploymentType?: string | null; newSalaryStructureId?: string | null; newShiftId?: string | null;
  }): Promise<{ id: string }> {
    const { data, error } = await supabase.rpc("transfer_request_create", {
      p_company_id: p.companyId, p_employee_id: p.employeeId, p_effective_date: p.effectiveDate, p_reason: p.reason ?? null,
      p_new_store_id: p.newStoreId ?? null, p_new_store_department_id: p.newStoreDepartmentId ?? null, p_new_store_designation_id: p.newStoreDesignationId ?? null,
      p_new_store_team_id: p.newStoreTeamId ?? null, p_new_grade_id: p.newGradeId ?? null, p_new_category_id: p.newCategoryId ?? null,
      p_new_reporting_manager_id: p.newReportingManagerId ?? null, p_new_super_manager_id: p.newSuperManagerId ?? null,
      p_new_employment_type: p.newEmploymentType ?? null, p_new_salary_structure_id: p.newSalaryStructureId ?? null, p_new_shift_id: p.newShiftId ?? null,
    });
    if (error) throw error;
    return data as any;
  },
  async submit(id: string): Promise<void> { const { error } = await supabase.rpc("transfer_request_submit", { p_id: id }); if (error) throw error; },
  async decide(id: string, action: "approve" | "reject", remark?: string): Promise<void> {
    const { error } = await supabase.rpc("transfer_request_decide", { p_id: id, p_action: action, p_remark: remark ?? null });
    if (error) throw error;
  },
  async cancel(id: string, reason: string): Promise<void> { const { error } = await supabase.rpc("transfer_request_cancel", { p_id: id, p_reason: reason }); if (error) throw error; },
  async applyDue(companyId: string): Promise<number> {
    const { data, error } = await supabase.rpc("transfer_apply_due_effective", { p_company_id: companyId });
    if (error) throw error;
    return n(data);
  },
  async register(p: { companyId: string; from?: string | null; to?: string | null; employeeId?: string | null; status?: string | null }): Promise<TransferRegisterRow[]> {
    const { data, error } = await supabase.rpc("transfer_register", {
      p_company_id: p.companyId, p_from: p.from ?? null, p_to: p.to ?? null, p_employee_id: p.employeeId ?? null, p_status: p.status ?? null,
    });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      staffId: r.staff_id ?? null, employeeName: r.employee_name, oldStore: r.old_store ?? null, newStore: r.new_store ?? null,
      oldDepartment: r.old_department ?? null, newDepartment: r.new_department ?? null, oldDesignation: r.old_designation ?? null, newDesignation: r.new_designation ?? null,
      effectiveDate: r.effective_date, reason: r.reason ?? null, status: r.status, approvedBy: r.approved_by ?? null,
    }));
  },
};
