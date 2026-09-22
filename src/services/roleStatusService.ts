import { supabase } from "@/lib/supabaseClient";
import type { RoleStatusRow } from "@/types/database.types";
import type { RoleStatusOption } from "@/types/role";

function mapRow(row: RoleStatusRow): RoleStatusOption {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    displayOrder: row.display_order,
  };
}

export const roleStatusService = {
  async list(): Promise<RoleStatusOption[]> {
    const { data, error } = await supabase
      .from("role_status")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },
};
