import { supabase } from "@/lib/supabaseClient";
import type { EmployeeTransferRow } from "@/types/database.types";
import type { EmployeeTransfer } from "@/types/employee";

function mapRow(row: EmployeeTransferRow): EmployeeTransfer {
  return {
    id: row.id,
    employeeId: row.employee_id,
    fromStoreId: row.from_store_id,
    toStoreId: row.to_store_id,
    fromStoreDesignationId: row.from_store_designation_id,
    toStoreDesignationId: row.to_store_designation_id,
    transferDate: row.transfer_date,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export const employeeTransferService = {
  async listForEmployee(employeeId: string): Promise<EmployeeTransfer[]> {
    const { data, error } = await supabase
      .from("employee_transfers")
      .select("*")
      .eq("employee_id", employeeId)
      .order("transfer_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  /**
   * Records a transfer and moves the employee's active store/designation.
   * This is the data foundation only — no approval workflow is implemented
   * in this phase (see spec: "Transfer Foundation").
   */
  async record(params: {
    employeeId: string;
    companyId: string;
    fromStoreId: string | null;
    toStoreId: string;
    fromStoreDesignationId: string | null;
    toStoreDesignationId: string;
    transferDate: string;
    reason?: string;
    createdBy?: string;
  }): Promise<EmployeeTransfer> {
    const { data, error } = await supabase
      .from("employee_transfers")
      .insert({
        employee_id: params.employeeId,
        company_id: params.companyId,
        from_store_id: params.fromStoreId,
        to_store_id: params.toStoreId,
        from_store_designation_id: params.fromStoreDesignationId,
        to_store_designation_id: params.toStoreDesignationId,
        transfer_date: params.transferDate,
        reason: params.reason || null,
        created_by: params.createdBy ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    const { error: updateError } = await supabase
      .from("employees")
      .update({ store_id: params.toStoreId, store_designation_id: params.toStoreDesignationId })
      .eq("id", params.employeeId);
    if (updateError) throw updateError;

    return mapRow(data);
  },
};
