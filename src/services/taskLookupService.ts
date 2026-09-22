import { supabase } from "@/lib/supabaseClient";
import type { TaskFrequencyRow, TaskStatusRow } from "@/types/database.types";
import type { TaskFrequencyOption, TaskStatusOption } from "@/types/task";

export const taskFrequencyService = {
  async list(): Promise<TaskFrequencyOption[]> {
    const { data, error } = await supabase
      .from("task_frequency")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return (data ?? []).map((row: TaskFrequencyRow) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      displayOrder: row.display_order,
    }));
  },
};

export const taskStatusService = {
  async list(): Promise<TaskStatusOption[]> {
    const { data, error } = await supabase
      .from("task_status")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return (data ?? []).map((row: TaskStatusRow) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      displayOrder: row.display_order,
    }));
  },
};
