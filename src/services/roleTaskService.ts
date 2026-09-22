import { supabase } from "@/lib/supabaseClient";
import type { RoleTaskMappingRow } from "@/types/database.types";
import type { RoleTaskMapping } from "@/types/task";

const MAPPING_SELECT = `
  *,
  roles ( role_name ),
  task_master ( task_name, task_code, priority, task_categories ( name ), task_frequency ( label ) )
`;

type MappingJoinRow = RoleTaskMappingRow & {
  roles: { role_name: string } | null;
  task_master: {
    task_name: string;
    task_code: string;
    priority: RoleTaskMapping["priority"];
    task_categories: { name: string } | null;
    task_frequency: { label: string } | null;
  } | null;
};

function mapRow(row: MappingJoinRow): RoleTaskMapping {
  return {
    id: row.id,
    roleId: row.role_id,
    roleName: row.roles?.role_name,
    taskId: row.task_id,
    taskName: row.task_master?.task_name,
    taskCode: row.task_master?.task_code,
    categoryName: row.task_master?.task_categories?.name,
    frequencyLabel: row.task_master?.task_frequency?.label,
    priority: row.task_master?.priority,
    isActive: row.is_active,
  };
}

export const roleTaskService = {
  async listForRole(roleId: string): Promise<RoleTaskMapping[]> {
    const { data, error } = await supabase
      .from("role_task_mapping")
      .select(MAPPING_SELECT)
      .eq("role_id", roleId)
      .eq("is_active", true)
      .order("created_at");
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as MappingJoinRow));
  },

  async listForTask(taskId: string): Promise<RoleTaskMapping[]> {
    const { data, error } = await supabase
      .from("role_task_mapping")
      .select(MAPPING_SELECT)
      .eq("task_id", taskId)
      .eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as MappingJoinRow));
  },

  async addTaskToRole(params: { roleId: string; taskId: string; companyId: string | null; userId?: string }): Promise<RoleTaskMapping> {
    const { roleId, taskId, companyId, userId } = params;

    const { count: existingCount, error: existingError } = await supabase
      .from("role_task_mapping")
      .select("id", { count: "exact", head: true })
      .eq("role_id", roleId)
      .eq("task_id", taskId)
      .eq("is_active", true);
    if (existingError) throw existingError;
    if ((existingCount ?? 0) > 0) throw new Error("This task is already mapped to this role.");

    const { data: task, error: taskError } = await supabase
      .from("task_master")
      .select("id, is_active")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) throw taskError;
    if (!task) throw new Error("Task not found.");
    if (!task.is_active) throw new Error("This task is inactive and cannot be assigned.");

    const { data, error } = await supabase
      .from("role_task_mapping")
      .insert({ role_id: roleId, task_id: taskId, company_id: companyId, created_by: userId ?? null, updated_by: userId ?? null })
      .select("id")
      .single();
    if (error) throw error;

    const { data: created, error: fetchError } = await supabase
      .from("role_task_mapping")
      .select(MAPPING_SELECT)
      .eq("id", data.id)
      .single();
    if (fetchError) throw fetchError;
    return mapRow(created as unknown as MappingJoinRow);
  },

  async removeFromRole(mappingId: string): Promise<void> {
    const { error } = await supabase.from("role_task_mapping").update({ is_active: false }).eq("id", mappingId);
    if (error) throw error;
  },
};
