import { supabase } from "@/lib/supabaseClient";
import type { EmployeePromotionRow } from "@/types/database.types";
import type { EmployeePromotion } from "@/types/employee";

function mapRow(row: EmployeePromotionRow): EmployeePromotion {
  return {
    id: row.id,
    employeeId: row.employee_id,
    fromStoreDesignationId: row.from_store_designation_id,
    toStoreDesignationId: row.to_store_designation_id,
    promotionDate: row.promotion_date,
    remarks: row.remarks,
    createdAt: row.created_at,
  };
}

export const employeePromotionService = {
  async listForEmployee(employeeId: string): Promise<EmployeePromotion[]> {
    const { data, error } = await supabase
      .from("employee_promotions")
      .select("*")
      .eq("employee_id", employeeId)
      .order("promotion_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  /**
   * Records a promotion and updates the employee's active designation.
   * Data foundation only — no approval workflow in this phase (see spec:
   * "Promotion Foundation").
   */
  async record(params: {
    employeeId: string;
    companyId: string;
    fromStoreDesignationId: string | null;
    toStoreDesignationId: string;
    promotionDate: string;
    remarks?: string;
    createdBy?: string;
  }): Promise<EmployeePromotion> {
    const { data, error } = await supabase
      .from("employee_promotions")
      .insert({
        employee_id: params.employeeId,
        company_id: params.companyId,
        from_store_designation_id: params.fromStoreDesignationId,
        to_store_designation_id: params.toStoreDesignationId,
        promotion_date: params.promotionDate,
        remarks: params.remarks || null,
        created_by: params.createdBy ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    const { error: updateError } = await supabase
      .from("employees")
      .update({ store_designation_id: params.toStoreDesignationId })
      .eq("id", params.employeeId);
    if (updateError) throw updateError;

    return mapRow(data);
  },
};
