import { supabase } from "@/lib/supabaseClient";
import type { TaskTemplateRow } from "@/types/database.types";
import type { TaskTemplate, TaskTemplateFormValues } from "@/types/task";

const TEMPLATE_SELECT = `*, task_categories ( name )`;

type TemplateJoinRow = TaskTemplateRow & { task_categories: { name: string } | null };

function mapRow(row: TemplateJoinRow): TaskTemplate {
  return {
    id: row.id,
    companyId: row.company_id,
    templateCode: row.template_code,
    templateName: row.template_name,
    categoryId: row.category_id,
    categoryName: row.task_categories?.name,
    description: row.description,
    isSystemTemplate: row.is_system_template,
    isActive: row.is_active,
    displayOrder: row.display_order,
  };
}

export const taskTemplateService = {
  async list(companyId?: string): Promise<TaskTemplate[]> {
    let query = supabase.from("task_templates").select(TEMPLATE_SELECT).order("display_order");
    if (companyId) query = query.or(`company_id.is.null,company_id.eq.${companyId}`);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as TemplateJoinRow));
  },

  async getById(id: string): Promise<TaskTemplate | null> {
    const { data, error } = await supabase.from("task_templates").select(TEMPLATE_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as unknown as TemplateJoinRow) : null;
  },

  async create(values: TaskTemplateFormValues, companyId: string | null, userId?: string): Promise<TaskTemplate> {
    const { data, error } = await supabase
      .from("task_templates")
      .insert({
        company_id: companyId,
        template_code: values.templateCode,
        template_name: values.templateName,
        category_id: values.categoryId || null,
        description: values.description || null,
        is_active: values.isActive,
        display_order: values.displayOrder ?? 0,
        is_system_template: companyId === null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    const created = await this.getById(data.id);
    if (!created) throw new Error("Template was created but could not be reloaded.");
    return created;
  },

  async update(id: string, values: Partial<TaskTemplateFormValues>, userId?: string): Promise<TaskTemplate> {
    const patch: Record<string, unknown> = { updated_by: userId ?? null };
    if (values.templateCode !== undefined) patch.template_code = values.templateCode;
    if (values.templateName !== undefined) patch.template_name = values.templateName;
    if (values.categoryId !== undefined) patch.category_id = values.categoryId || null;
    if (values.description !== undefined) patch.description = values.description || null;
    if (values.isActive !== undefined) patch.is_active = values.isActive;
    if (values.displayOrder !== undefined) patch.display_order = values.displayOrder;

    const { error } = await supabase.from("task_templates").update(patch).eq("id", id);
    if (error) throw error;
    const updated = await this.getById(id);
    if (!updated) throw new Error("Template was updated but could not be reloaded.");
    return updated;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("task_templates").delete().eq("id", id);
    if (error) throw error;
  },

  async isCodeTaken(templateCode: string, companyId: string | null, excludeId?: string): Promise<boolean> {
    let query = supabase.from("task_templates").select("id", { count: "exact", head: true }).eq("template_code", templateCode);
    query = companyId === null ? query.is("company_id", null) : query.eq("company_id", companyId);
    if (excludeId) query = query.neq("id", excludeId);
    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};
