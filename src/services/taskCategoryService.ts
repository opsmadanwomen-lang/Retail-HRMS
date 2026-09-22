import { supabase } from "@/lib/supabaseClient";
import type { TaskCategoryRow } from "@/types/database.types";
import type { TaskCategory } from "@/types/task";

function mapRow(row: TaskCategoryRow): TaskCategory {
  return {
    id: row.id,
    name: row.name,
    displayOrder: row.display_order,
    isActive: row.is_active,
  };
}

export const taskCategoryService = {
  async list(): Promise<TaskCategory[]> {
    const { data, error } = await supabase
      .from("task_categories")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async listAll(): Promise<TaskCategory[]> {
    const { data, error } = await supabase.from("task_categories").select("*").order("display_order");
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async create(name: string, displayOrder: number | undefined, userId?: string): Promise<TaskCategory> {
    const { data, error } = await supabase
      .from("task_categories")
      .insert({ name, display_order: displayOrder ?? 0, created_by: userId ?? null, updated_by: userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return mapRow(data);
  },

  async setActive(id: string, isActive: boolean, userId?: string): Promise<void> {
    const { error } = await supabase
      .from("task_categories")
      .update({ is_active: isActive, updated_by: userId ?? null })
      .eq("id", id);
    if (error) throw error;
  },
};
