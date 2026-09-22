import { supabase } from "@/lib/supabaseClient";
import type { TaskChecklistItemRow, TaskChecklistRow } from "@/types/database.types";
import type {
  TaskChecklist,
  TaskChecklistFormValues,
  TaskChecklistItem,
  TaskChecklistItemFormValues,
} from "@/types/task";

function mapItemRow(row: TaskChecklistItemRow): TaskChecklistItem {
  return {
    id: row.id,
    taskChecklistId: row.task_checklist_id,
    itemName: row.item_name,
    description: row.description,
    isMandatory: row.is_mandatory,
    weightage: Number(row.weightage),
    sequence: row.sequence,
    isActive: row.is_active,
  };
}

export const taskChecklistService = {
  /** All checklists (with items) for a task — the task's full SOP. */
  async listForTask(taskId: string): Promise<TaskChecklist[]> {
    const { data: checklists, error } = await supabase
      .from("task_checklists")
      .select("*")
      .eq("task_id", taskId)
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;

    const checklistIds = (checklists ?? []).map((c: TaskChecklistRow) => c.id);
    let items: TaskChecklistItemRow[] = [];
    if (checklistIds.length > 0) {
      const { data, error: itemsError } = await supabase
        .from("task_checklist_items")
        .select("*")
        .in("task_checklist_id", checklistIds)
        .eq("is_active", true)
        .order("sequence");
      if (itemsError) throw itemsError;
      items = data ?? [];
    }

    return (checklists ?? []).map((c: TaskChecklistRow) => ({
      id: c.id,
      taskId: c.task_id,
      name: c.name,
      description: c.description,
      isActive: c.is_active,
      displayOrder: c.display_order,
      items: items.filter((i) => i.task_checklist_id === c.id).map(mapItemRow),
    }));
  },

  async createChecklist(taskId: string, values: TaskChecklistFormValues, userId?: string): Promise<TaskChecklist> {
    const { data, error } = await supabase
      .from("task_checklists")
      .insert({
        task_id: taskId,
        name: values.name,
        description: values.description || null,
        display_order: values.displayOrder ?? 0,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return {
      id: data.id,
      taskId: data.task_id,
      name: data.name,
      description: data.description,
      isActive: data.is_active,
      displayOrder: data.display_order,
      items: [],
    };
  },

  async removeChecklist(checklistId: string): Promise<void> {
    const { error } = await supabase.from("task_checklists").update({ is_active: false }).eq("id", checklistId);
    if (error) throw error;
  },

  async addItem(checklistId: string, values: TaskChecklistItemFormValues, userId?: string): Promise<TaskChecklistItem> {
    const { data, error } = await supabase
      .from("task_checklist_items")
      .insert({
        task_checklist_id: checklistId,
        item_name: values.itemName,
        description: values.description || null,
        is_mandatory: values.isMandatory,
        weightage: values.weightage ?? 0,
        sequence: values.sequence ?? 0,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapItemRow(data);
  },

  async removeItem(itemId: string): Promise<void> {
    const { error } = await supabase.from("task_checklist_items").update({ is_active: false }).eq("id", itemId);
    if (error) throw error;
  },
};
