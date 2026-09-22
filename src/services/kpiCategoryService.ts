import { supabase } from "@/lib/supabaseClient";
import type { KpiCategoryRow } from "@/types/database.types";
import type { KpiCategory } from "@/types/kpi";

function mapRow(row: KpiCategoryRow): KpiCategory {
  return {
    id: row.id,
    name: row.name,
    displayOrder: row.display_order,
    isActive: row.is_active,
  };
}

export const kpiCategoryService = {
  async list(): Promise<KpiCategory[]> {
    const { data, error } = await supabase
      .from("kpi_categories")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  /** Includes inactive categories — used by the KPI Categories management page. */
  async listAll(): Promise<KpiCategory[]> {
    const { data, error } = await supabase.from("kpi_categories").select("*").order("display_order");
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async create(name: string, displayOrder: number | undefined, userId?: string): Promise<KpiCategory> {
    const { data, error } = await supabase
      .from("kpi_categories")
      .insert({ name, display_order: displayOrder ?? 0, created_by: userId ?? null, updated_by: userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return mapRow(data);
  },

  async setActive(id: string, isActive: boolean, userId?: string): Promise<void> {
    const { error } = await supabase
      .from("kpi_categories")
      .update({ is_active: isActive, updated_by: userId ?? null })
      .eq("id", id);
    if (error) throw error;
  },
};
