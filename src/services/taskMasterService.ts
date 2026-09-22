import { supabase } from "@/lib/supabaseClient";
import type { TaskMasterRow } from "@/types/database.types";
import type { Task, TaskFilters, TaskFormValues } from "@/types/task";

const TASK_SELECT = `
  *,
  task_categories ( name ),
  task_frequency ( label ),
  task_templates ( template_name )
`;

type TaskJoinRow = TaskMasterRow & {
  task_categories: { name: string } | null;
  task_frequency: { label: string } | null;
  task_templates: { template_name: string } | null;
};

function mapRow(row: TaskJoinRow): Task {
  return {
    id: row.id,
    companyId: row.company_id,
    taskCode: row.task_code,
    taskName: row.task_name,
    categoryId: row.category_id,
    categoryName: row.task_categories?.name,
    frequencyId: row.frequency_id,
    frequencyLabel: row.task_frequency?.label,
    templateId: row.template_id,
    templateName: row.task_templates?.template_name,
    priority: row.priority,
    description: row.description,
    estimatedTimeMinutes: row.estimated_time_minutes,
    requiresVerification: row.requires_verification,
    allowPhotoUpload: row.allow_photo_upload,
    allowDocumentUpload: row.allow_document_upload,
    allowRemarks: row.allow_remarks,
    allowGpsPlaceholder: row.allow_gps_placeholder,
    allowQrPlaceholder: row.allow_qr_placeholder,
    weightage: Number(row.weightage),
    isSystemTask: row.is_system_task,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

export const taskMasterService = {
  async list(filters: TaskFilters = {}): Promise<Task[]> {
    let query = supabase.from("task_master").select(TASK_SELECT).order("display_order");

    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    if (filters.frequencyId) query = query.eq("frequency_id", filters.frequencyId);
    if (filters.priority) query = query.eq("priority", filters.priority);
    if (filters.isActive !== undefined) query = query.eq("is_active", filters.isActive);
    if (filters.search) {
      const term = filters.search.trim();
      query = query.or(`task_name.ilike.%${term}%,task_code.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const tasks = (data ?? []).map((row) => mapRow(row as unknown as TaskJoinRow));

    let mappingQuery = supabase.from("role_task_mapping").select("task_id, role_id").eq("is_active", true);
    if (filters.roleId) mappingQuery = mappingQuery.eq("role_id", filters.roleId);
    if (filters.companyId) mappingQuery = mappingQuery.or(`company_id.is.null,company_id.eq.${filters.companyId}`);

    const { data: mappings, error: mappingsError } = await mappingQuery;
    if (mappingsError) throw mappingsError;

    const countByTask = new Map<string, number>();
    for (const row of (mappings ?? []) as Array<{ task_id: string }>) {
      countByTask.set(row.task_id, (countByTask.get(row.task_id) ?? 0) + 1);
    }

    let result = tasks.map((task) => ({ ...task, mappedRoleCount: countByTask.get(task.id) ?? 0 }));

    if (filters.roleId) {
      result = result.filter((task) => (task.mappedRoleCount ?? 0) > 0);
    }

    return result;
  },

  async getById(id: string): Promise<Task | null> {
    const { data, error } = await supabase.from("task_master").select(TASK_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as unknown as TaskJoinRow) : null;
  },

  async create(values: TaskFormValues, companyId: string | null, userId?: string): Promise<Task> {
    const { data, error } = await supabase
      .from("task_master")
      .insert({
        company_id: companyId,
        task_code: values.taskCode,
        task_name: values.taskName,
        category_id: values.categoryId || null,
        frequency_id: values.frequencyId || null,
        template_id: values.templateId || null,
        priority: values.priority,
        description: values.description || null,
        estimated_time_minutes: values.estimatedTimeMinutes ?? null,
        requires_verification: values.requiresVerification,
        allow_photo_upload: values.allowPhotoUpload,
        allow_document_upload: values.allowDocumentUpload,
        allow_remarks: values.allowRemarks,
        allow_gps_placeholder: values.allowGpsPlaceholder,
        allow_qr_placeholder: values.allowQrPlaceholder,
        weightage: values.weightage ?? 0,
        is_active: values.isActive,
        display_order: values.displayOrder ?? 0,
        is_system_task: companyId === null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    const created = await this.getById(data.id);
    if (!created) throw new Error("Task was created but could not be reloaded.");
    return created;
  },

  async update(id: string, values: Partial<TaskFormValues>, userId?: string): Promise<Task> {
    const patch: Record<string, unknown> = { updated_by: userId ?? null };
    if (values.taskCode !== undefined) patch.task_code = values.taskCode;
    if (values.taskName !== undefined) patch.task_name = values.taskName;
    if (values.categoryId !== undefined) patch.category_id = values.categoryId || null;
    if (values.frequencyId !== undefined) patch.frequency_id = values.frequencyId || null;
    if (values.templateId !== undefined) patch.template_id = values.templateId || null;
    if (values.priority !== undefined) patch.priority = values.priority;
    if (values.description !== undefined) patch.description = values.description || null;
    if (values.estimatedTimeMinutes !== undefined) patch.estimated_time_minutes = values.estimatedTimeMinutes;
    if (values.requiresVerification !== undefined) patch.requires_verification = values.requiresVerification;
    if (values.allowPhotoUpload !== undefined) patch.allow_photo_upload = values.allowPhotoUpload;
    if (values.allowDocumentUpload !== undefined) patch.allow_document_upload = values.allowDocumentUpload;
    if (values.allowRemarks !== undefined) patch.allow_remarks = values.allowRemarks;
    if (values.allowGpsPlaceholder !== undefined) patch.allow_gps_placeholder = values.allowGpsPlaceholder;
    if (values.allowQrPlaceholder !== undefined) patch.allow_qr_placeholder = values.allowQrPlaceholder;
    if (values.weightage !== undefined) patch.weightage = values.weightage;
    if (values.isActive !== undefined) patch.is_active = values.isActive;
    if (values.displayOrder !== undefined) patch.display_order = values.displayOrder;

    const { error } = await supabase.from("task_master").update(patch).eq("id", id);
    if (error) throw error;
    const updated = await this.getById(id);
    if (!updated) throw new Error("Task was updated but could not be reloaded.");
    return updated;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("task_master").delete().eq("id", id);
    if (error) throw error;
  },

  async isCodeTaken(taskCode: string, companyId: string | null, excludeId?: string): Promise<boolean> {
    let query = supabase.from("task_master").select("id", { count: "exact", head: true }).eq("task_code", taskCode);
    query = companyId === null ? query.is("company_id", null) : query.eq("company_id", companyId);
    if (excludeId) query = query.neq("id", excludeId);
    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};
