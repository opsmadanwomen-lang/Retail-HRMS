import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { performanceService } from "@/services/performanceService";
import type { KpiDashboardStats } from "@/types/kpi";

async function fetchKpiDashboardStats(companyId?: string): Promise<KpiDashboardStats> {
  let kpiQuery = supabase.from("kpi_master").select("id", { count: "exact" }).eq("is_active", true);
  if (companyId) kpiQuery = kpiQuery.or(`company_id.is.null,company_id.eq.${companyId}`);

  let mappingQuery = supabase.from("role_kpi_mapping").select("kpi_id").eq("is_active", true);
  if (companyId) mappingQuery = mappingQuery.or(`company_id.is.null,company_id.eq.${companyId}`);

  let resultQuery = supabase
    .from("kpi_result")
    .select("kpi_id, role_id, score, achievement_percentage, kpi_master ( kpi_name ), roles ( role_name )");
  if (companyId) resultQuery = resultQuery.eq("company_id", companyId);

  const [{ count: totalKpi, error: kpiError }, { data: mappings, error: mappingsError }, { data: results, error: resultsError }, activeCycle] =
    await Promise.all([kpiQuery, mappingQuery, resultQuery, performanceService.getActiveCycle(companyId)]);

  if (kpiError) throw kpiError;
  if (mappingsError) throw mappingsError;
  if (resultsError) throw resultsError;

  const mappedKpiIds = new Set((mappings ?? []).map((m: any) => m.kpi_id));

  const roleAgg = new Map<string, { roleName: string; total: number; count: number }>();
  const kpiAgg = new Map<string, { kpiName: string; total: number; count: number }>();

  for (const row of (results ?? []) as any[]) {
    if (row.score !== null && row.role_id) {
      const key = row.role_id;
      const roleName = row.roles?.role_name ?? "Unknown Role";
      const entry = roleAgg.get(key) ?? { roleName, total: 0, count: 0 };
      entry.total += (Number(row.score) / 5) * 100;
      entry.count += 1;
      roleAgg.set(key, entry);
    }
    if (row.achievement_percentage !== null) {
      const key = row.kpi_id;
      const kpiName = row.kpi_master?.kpi_name ?? "Unknown KPI";
      const entry = kpiAgg.get(key) ?? { kpiName, total: 0, count: 0 };
      entry.total += Number(row.achievement_percentage);
      entry.count += 1;
      kpiAgg.set(key, entry);
    }
  }

  return {
    totalKpi: totalKpi ?? 0,
    mappedKpi: mappedKpiIds.size,
    pendingKpi: Math.max((totalKpi ?? 0) - mappedKpiIds.size, 0),
    activeCycleName: activeCycle?.name ?? null,
    topPerformingRoles: Array.from(roleAgg.entries())
      .map(([roleId, v]) => ({ roleId, roleName: v.roleName, averageScore: Math.round((v.total / v.count) * 100) / 100 }))
      .sort((a, b) => b.averageScore - a.averageScore)
      .slice(0, 5),
    topPerformingKpi: Array.from(kpiAgg.entries())
      .map(([kpiId, v]) => ({ kpiId, kpiName: v.kpiName, averageAchievement: Math.round((v.total / v.count) * 100) / 100 }))
      .sort((a, b) => b.averageAchievement - a.averageAchievement)
      .slice(0, 5),
  };
}

export function useKpiDashboardStats(companyId?: string) {
  return useQuery({
    queryKey: ["kpi-dashboard-stats", companyId ?? "all"],
    queryFn: () => fetchKpiDashboardStats(companyId),
  });
}
