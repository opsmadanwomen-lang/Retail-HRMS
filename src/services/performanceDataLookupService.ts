import { supabase } from "@/lib/supabaseClient";
import type { PerformanceCyclesRow, PerformanceDataSourceRow } from "@/types/database.types";
import type { PerformanceDataCycle, PerformanceDataSource } from "@/types/performance";

function mapCycleRow(row: PerformanceCyclesRow): PerformanceDataCycle {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    cycleType: row.cycle_type,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active,
  };
}

export const performanceDataCycleService = {
  async list(companyId?: string): Promise<PerformanceDataCycle[]> {
    let query = supabase
      .from("performance_cycles")
      .select("*")
      .eq("is_active", true)
      .order("start_date", { ascending: false });
    if (companyId) query = query.or(`company_id.is.null,company_id.eq.${companyId}`);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapCycleRow);
  },
};

export const performanceDataSourceService = {
  async list(): Promise<PerformanceDataSource[]> {
    const { data, error } = await supabase
      .from("performance_data_sources")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return (data ?? []).map((row: PerformanceDataSourceRow) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      isAutomated: row.is_automated,
    }));
  },
};
