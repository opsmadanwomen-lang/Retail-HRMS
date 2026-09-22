import { supabase } from "@/lib/supabaseClient";
import type { RoleKpiMappingRow } from "@/types/database.types";
import type { RoleKpiMapping } from "@/types/kpi";

const MAPPING_SELECT = `
  *,
  roles ( role_name ),
  kpi_master ( kpi_name, kpi_code, calculation_type, target_type, kpi_categories ( name ) ),
  kpi_weightage ( weightage, is_active )
`;

type MappingJoinRow = RoleKpiMappingRow & {
  roles: { role_name: string } | null;
  kpi_master: {
    kpi_name: string;
    kpi_code: string;
    calculation_type: string;
    target_type: string;
    kpi_categories: { name: string } | null;
  } | null;
  kpi_weightage: Array<{ weightage: number; is_active: boolean }> | null;
};

function mapRow(row: MappingJoinRow): RoleKpiMapping {
  const activeWeightage = (row.kpi_weightage ?? []).find((w) => w.is_active);
  return {
    id: row.id,
    roleId: row.role_id,
    roleName: row.roles?.role_name,
    kpiId: row.kpi_id,
    kpiName: row.kpi_master?.kpi_name,
    kpiCode: row.kpi_master?.kpi_code,
    categoryName: row.kpi_master?.kpi_categories?.name,
    calculationType: row.kpi_master?.calculation_type as RoleKpiMapping["calculationType"],
    targetType: row.kpi_master?.target_type as RoleKpiMapping["targetType"],
    isActive: row.is_active,
    currentWeightage: activeWeightage ? Number(activeWeightage.weightage) : null,
  };
}

export const roleKpiService = {
  async listForRole(roleId: string): Promise<RoleKpiMapping[]> {
    const { data, error } = await supabase
      .from("role_kpi_mapping")
      .select(MAPPING_SELECT)
      .eq("role_id", roleId)
      .eq("is_active", true)
      .order("created_at");
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as MappingJoinRow));
  },

  async listForKpi(kpiId: string): Promise<RoleKpiMapping[]> {
    const { data, error } = await supabase
      .from("role_kpi_mapping")
      .select(MAPPING_SELECT)
      .eq("kpi_id", kpiId)
      .eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as MappingJoinRow));
  },

  /** Sum of currently-active weightages assigned to a role. Should equal 100. */
  async getWeightageTotal(roleId: string): Promise<number> {
    const mappings = await this.listForRole(roleId);
    return mappings.reduce((sum, m) => sum + (m.currentWeightage ?? 0), 0);
  },

  /** Adds a KPI to a role. Rejects duplicate mapping and inactive KPIs. */
  async addKpiToRole(params: {
    roleId: string;
    kpiId: string;
    companyId: string | null;
    weightage: number;
    userId?: string;
  }): Promise<RoleKpiMapping> {
    const { roleId, kpiId, companyId, weightage, userId } = params;

    const { count: existingCount, error: existingError } = await supabase
      .from("role_kpi_mapping")
      .select("id", { count: "exact", head: true })
      .eq("role_id", roleId)
      .eq("kpi_id", kpiId)
      .eq("is_active", true);
    if (existingError) throw existingError;
    if ((existingCount ?? 0) > 0) throw new Error("This KPI is already mapped to this role.");

    const { data: kpi, error: kpiError } = await supabase
      .from("kpi_master")
      .select("id, is_active")
      .eq("id", kpiId)
      .maybeSingle();
    if (kpiError) throw kpiError;
    if (!kpi) throw new Error("KPI not found.");
    if (!kpi.is_active) throw new Error("This KPI is inactive and cannot be assigned.");

    const { data: mapping, error: mappingError } = await supabase
      .from("role_kpi_mapping")
      .insert({ role_id: roleId, kpi_id: kpiId, company_id: companyId, created_by: userId ?? null, updated_by: userId ?? null })
      .select("id")
      .single();
    if (mappingError) throw mappingError;

    const { error: weightageError } = await supabase
      .from("kpi_weightage")
      .insert({ role_kpi_mapping_id: mapping.id, company_id: companyId, weightage, created_by: userId ?? null });
    if (weightageError) throw weightageError;

    const { data: created, error: fetchError } = await supabase
      .from("role_kpi_mapping")
      .select(MAPPING_SELECT)
      .eq("id", mapping.id)
      .single();
    if (fetchError) throw fetchError;
    return mapRow(created as unknown as MappingJoinRow);
  },

  async removeFromRole(mappingId: string): Promise<void> {
    const { error } = await supabase.from("role_kpi_mapping").update({ is_active: false }).eq("id", mappingId);
    if (error) throw error;
  },

  /** Closes the current weightage row and opens a new one — keeps full history. */
  async setWeightage(roleKpiMappingId: string, weightage: number, companyId: string | null, userId?: string): Promise<void> {
    const { error: closeError } = await supabase
      .from("kpi_weightage")
      .update({ is_active: false, expiry_date: new Date().toISOString().slice(0, 10) })
      .eq("role_kpi_mapping_id", roleKpiMappingId)
      .eq("is_active", true);
    if (closeError) throw closeError;

    const { error: insertError } = await supabase
      .from("kpi_weightage")
      .insert({ role_kpi_mapping_id: roleKpiMappingId, company_id: companyId, weightage, created_by: userId ?? null });
    if (insertError) throw insertError;
  },

  /**
   * Saves every KPI's weightage for a role in one batch, enforcing that
   * they sum to exactly 100% before writing anything.
   */
  async saveWeightageBatch(params: {
    roleId: string;
    entries: Array<{ roleKpiMappingId: string; weightage: number }>;
    companyId: string | null;
    userId?: string;
  }): Promise<void> {
    const total = params.entries.reduce((sum, e) => sum + e.weightage, 0);
    if (Math.round(total * 100) / 100 !== 100) {
      throw new Error(`Total weightage must equal 100%. Currently ${total.toFixed(2)}%.`);
    }
    for (const entry of params.entries) {
      await this.setWeightage(entry.roleKpiMappingId, entry.weightage, params.companyId, params.userId);
    }
  },
};
