import { supabase } from "@/lib/supabaseClient";
import type { KpiMasterRow } from "@/types/database.types";
import type { Kpi, KpiFilters, KpiFormValues } from "@/types/kpi";

const KPI_SELECT = `
  *,
  kpi_categories ( name )
`;

type KpiJoinRow = KpiMasterRow & { kpi_categories: { name: string } | null };

function mapRow(row: KpiJoinRow): Kpi {
  return {
    id: row.id,
    companyId: row.company_id,
    kpiCode: row.kpi_code,
    kpiName: row.kpi_name,
    categoryId: row.category_id,
    categoryName: row.kpi_categories?.name,
    description: row.description,
    calculationType: row.calculation_type,
    targetType: row.target_type,
    measurementUnit: row.measurement_unit,
    dataSource: row.data_source,
    formulaType: row.formula_type,
    isSystemKpi: row.is_system_kpi,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

export const kpiMasterService = {
  async list(filters: KpiFilters = {}): Promise<Kpi[]> {
    let query = supabase.from("kpi_master").select(KPI_SELECT).order("display_order");

    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    if (filters.isActive !== undefined) query = query.eq("is_active", filters.isActive);
    if (filters.search) {
      const term = filters.search.trim();
      query = query.or(`kpi_name.ilike.%${term}%,kpi_code.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const kpis = (data ?? []).map((row) => mapRow(row as unknown as KpiJoinRow));

    let mappingQuery = supabase.from("role_kpi_mapping").select("id, kpi_id, role_id").eq("is_active", true);
    if (filters.roleId) mappingQuery = mappingQuery.eq("role_id", filters.roleId);
    if (filters.companyId) mappingQuery = mappingQuery.or(`company_id.is.null,company_id.eq.${filters.companyId}`);

    const { data: mappings, error: mappingsError } = await mappingQuery;
    if (mappingsError) throw mappingsError;

    const countByKpi = new Map<string, number>();
    for (const row of (mappings ?? []) as Array<{ kpi_id: string }>) {
      countByKpi.set(row.kpi_id, (countByKpi.get(row.kpi_id) ?? 0) + 1);
    }

    let result = kpis.map((kpi) => ({ ...kpi, mappedRoleCount: countByKpi.get(kpi.id) ?? 0 }));

    if (filters.roleId) {
      result = result.filter((kpi) => (kpi.mappedRoleCount ?? 0) > 0);
    }

    return result;
  },

  async getById(id: string): Promise<Kpi | null> {
    const { data, error } = await supabase.from("kpi_master").select(KPI_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as unknown as KpiJoinRow) : null;
  },

  async create(values: KpiFormValues, companyId: string | null, userId?: string): Promise<Kpi> {
    const { data, error } = await supabase
      .from("kpi_master")
      .insert({
        company_id: companyId,
        kpi_code: values.kpiCode,
        kpi_name: values.kpiName,
        category_id: values.categoryId || null,
        description: values.description || null,
        calculation_type: values.calculationType,
        target_type: values.targetType,
        measurement_unit: values.measurementUnit,
        data_source: values.dataSource,
        formula_type: values.formulaType,
        is_active: values.isActive,
        display_order: values.displayOrder ?? 0,
        is_system_kpi: companyId === null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    const created = await this.getById(data.id);
    if (!created) throw new Error("KPI was created but could not be reloaded.");
    return created;
  },

  async update(id: string, values: Partial<KpiFormValues>, userId?: string): Promise<Kpi> {
    const patch: Record<string, unknown> = { updated_by: userId ?? null };
    if (values.kpiCode !== undefined) patch.kpi_code = values.kpiCode;
    if (values.kpiName !== undefined) patch.kpi_name = values.kpiName;
    if (values.categoryId !== undefined) patch.category_id = values.categoryId || null;
    if (values.description !== undefined) patch.description = values.description || null;
    if (values.calculationType !== undefined) patch.calculation_type = values.calculationType;
    if (values.targetType !== undefined) patch.target_type = values.targetType;
    if (values.measurementUnit !== undefined) patch.measurement_unit = values.measurementUnit;
    if (values.dataSource !== undefined) patch.data_source = values.dataSource;
    if (values.formulaType !== undefined) patch.formula_type = values.formulaType;
    if (values.isActive !== undefined) patch.is_active = values.isActive;
    if (values.displayOrder !== undefined) patch.display_order = values.displayOrder;

    const { error } = await supabase.from("kpi_master").update(patch).eq("id", id);
    if (error) throw error;
    const updated = await this.getById(id);
    if (!updated) throw new Error("KPI was updated but could not be reloaded.");
    return updated;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("kpi_master").delete().eq("id", id);
    if (error) throw error;
  },

  async isCodeTaken(kpiCode: string, companyId: string | null, excludeId?: string): Promise<boolean> {
    let query = supabase.from("kpi_master").select("id", { count: "exact", head: true }).eq("kpi_code", kpiCode);
    query = companyId === null ? query.is("company_id", null) : query.eq("company_id", companyId);
    if (excludeId) query = query.neq("id", excludeId);
    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};
