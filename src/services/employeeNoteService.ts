import { supabase } from "@/lib/supabaseClient";
import type { EmployeeNoteRow } from "@/types/database.types";
import type { EmployeeNote } from "@/types/employee";

function mapRow(row: EmployeeNoteRow): EmployeeNote {
  return {
    id: row.id,
    employeeId: row.employee_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

export const employeeNoteService = {
  async listForEmployee(employeeId: string): Promise<EmployeeNote[]> {
    const { data, error } = await supabase
      .from("employee_notes")
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async add(params: { employeeId: string; companyId: string; note: string; createdBy?: string }): Promise<EmployeeNote> {
    const { data, error } = await supabase
      .from("employee_notes")
      .insert({
        employee_id: params.employeeId,
        company_id: params.companyId,
        note: params.note,
        created_by: params.createdBy ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapRow(data);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("employee_notes").delete().eq("id", id);
    if (error) throw error;
  },
};
