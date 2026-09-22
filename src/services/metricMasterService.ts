import { supabase } from "@/lib/supabaseClient";
import type { MetricMasterRow } from "@/types/database.types";
import type { Metric, MetricFilters, MetricFormValues } from "@/types/performance";

function mapRow(row: MetricMasterRow): Metric {
  return {
    id: row.id,
    companyId: row.company_id,
    metricCode: row.metric_code,
    metricName: row.metric_name,
    category: row.category,
    measurementUnit: row.measurement_unit,
    calculationType: row.calculation_type,
    isSystemMetric: row.is_system_metric,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

export const metricMasterService = {
  async list(filters: MetricFilters = {}): Promise<Metric[]> {
    let query = supabase.from("metric_master").select("*").order("display_order");

    if (filters.category) query = query.eq("category", filters.category);
    if (filters.isActive !== undefined) query = query.eq("is_active", filters.isActive);
    if (filters.search) {
      const term = filters.search.trim();
      query = query.or(`metric_name.ilike.%${term}%,metric_code.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const metrics = (data ?? []).map(mapRow);

    let mappingQuery = supabase.from("metric_mapping").select("metric_id").eq("is_active", true);
    if (filters.companyId) mappingQuery = mappingQuery.or(`company_id.is.null,company_id.eq.${filters.companyId}`);
    const { data: mappings, error: mappingsError } = await mappingQuery;
    if (mappingsError) throw mappingsError;

    const countByMetric = new Map<string, number>();
    for (const row of (mappings ?? []) as Array<{ metric_id: string }>) {
      countByMetric.set(row.metric_id, (countByMetric.get(row.metric_id) ?? 0) + 1);
    }

    return metrics.map((metric) => ({ ...metric, mappingCount: countByMetric.get(metric.id) ?? 0 }));
  },

  async getById(id: string): Promise<Metric | null> {
    const { data, error } = await supabase.from("metric_master").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : null;
  },

  async create(values: MetricFormValues, companyId: string | null, userId?: string): Promise<Metric> {
    const { data, error } = await supabase
      .from("metric_master")
      .insert({
        company_id: companyId,
        metric_code: values.metricCode,
        metric_name: values.metricName,
        category: values.category,
        measurement_unit: values.measurementUnit,
        calculation_type: values.calculationType,
        is_active: values.isActive,
        display_order: values.displayOrder ?? 0,
        is_system_metric: companyId === null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapRow(data);
  },

  async update(id: string, values: Partial<MetricFormValues>, userId?: string): Promise<Metric> {
    const patch: Record<string, unknown> = { updated_by: userId ?? null };
    if (values.metricCode !== undefined) patch.metric_code = values.metricCode;
    if (values.metricName !== undefined) patch.metric_name = values.metricName;
    if (values.category !== undefined) patch.category = values.category;
    if (values.measurementUnit !== undefined) patch.measurement_unit = values.measurementUnit;
    if (values.calculationType !== undefined) patch.calculation_type = values.calculationType;
    if (values.isActive !== undefined) patch.is_active = values.isActive;
    if (values.displayOrder !== undefined) patch.display_order = values.displayOrder;

    const { data, error } = await supabase.from("metric_master").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    return mapRow(data);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("metric_master").delete().eq("id", id);
    if (error) throw error;
  },

  async isCodeTaken(metricCode: string, companyId: string | null, excludeId?: string): Promise<boolean> {
    let query = supabase.from("metric_master").select("id", { count: "exact", head: true }).eq("metric_code", metricCode);
    query = companyId === null ? query.is("company_id", null) : query.eq("company_id", companyId);
    if (excludeId) query = query.neq("id", excludeId);
    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};
