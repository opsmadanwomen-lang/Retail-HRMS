import { supabase } from "@/lib/supabaseClient";
import type { MetricMappingRow } from "@/types/database.types";
import type { MetricMapping, MetricMappingFormValues } from "@/types/performance";

const MAPPING_SELECT = `
  *,
  metric_master ( metric_name, metric_code ),
  roles ( role_name ),
  master_departments ( name ),
  stores ( name ),
  employees ( full_name )
`;

type MappingJoinRow = MetricMappingRow & {
  metric_master: { metric_name: string; metric_code: string } | null;
  roles: { role_name: string } | null;
  master_departments: { name: string } | null;
  stores: { name: string } | null;
  employees: { full_name: string } | null;
};

function mapRow(row: MappingJoinRow): MetricMapping {
  return {
    id: row.id,
    metricId: row.metric_id,
    metricName: row.metric_master?.metric_name,
    metricCode: row.metric_master?.metric_code,
    roleId: row.role_id,
    roleName: row.roles?.role_name,
    departmentId: row.department_id,
    departmentName: row.master_departments?.name,
    storeId: row.store_id,
    storeName: row.stores?.name,
    employeeId: row.employee_id,
    employeeName: row.employees?.full_name,
    isActive: row.is_active,
  };
}

export const metricMappingService = {
  async list(
    filters: { companyId?: string; metricId?: string; roleId?: string; storeId?: string } = {}
  ): Promise<MetricMapping[]> {
    let query = supabase.from("metric_mapping").select(MAPPING_SELECT).eq("is_active", true).order("created_at");
    if (filters.metricId) query = query.eq("metric_id", filters.metricId);
    if (filters.roleId) query = query.eq("role_id", filters.roleId);
    if (filters.storeId) query = query.eq("store_id", filters.storeId);
    if (filters.companyId) query = query.or(`company_id.is.null,company_id.eq.${filters.companyId}`);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as MappingJoinRow));
  },

  async create(values: MetricMappingFormValues, companyId: string | null, userId?: string): Promise<MetricMapping> {
    if (!values.roleId && !values.departmentId && !values.storeId && !values.employeeId) {
      throw new Error("Select at least one of Role, Department, Store, or Employee.");
    }

    const { data, error } = await supabase
      .from("metric_mapping")
      .insert({
        metric_id: values.metricId,
        role_id: values.roleId || null,
        department_id: values.departmentId || null,
        store_id: values.storeId || null,
        employee_id: values.employeeId || null,
        company_id: companyId,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: created, error: fetchError } = await supabase
      .from("metric_mapping")
      .select(MAPPING_SELECT)
      .eq("id", data.id)
      .single();
    if (fetchError) throw fetchError;
    return mapRow(created as unknown as MappingJoinRow);
  },

  async remove(mappingId: string): Promise<void> {
    const { error } = await supabase.from("metric_mapping").update({ is_active: false }).eq("id", mappingId);
    if (error) throw error;
  },
};
