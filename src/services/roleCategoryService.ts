import { supabase } from "@/lib/supabaseClient";
import type { RoleCategoryRow } from "@/types/database.types";
import type { RoleCategory } from "@/types/role";

function mapRow(row: RoleCategoryRow): RoleCategory {
  return {
    id: row.id,
    name: row.name,
    displayOrder: row.display_order,
    isActive: row.is_active,
  };
}

export const roleCategoryService = {
  async list(): Promise<RoleCategory[]> {
    const { data, error } = await supabase
      .from("role_categories")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },
};
