import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";

export interface DashboardStats {
  totalStores: number;
  totalEmployees: number;
  frontendEmployees: number;
  backendEmployees: number;
}

async function fetchStats(): Promise<DashboardStats> {
  const [{ count: totalStores }, { count: totalEmployees }, frontendResult, backendResult] = await Promise.all([
    supabase.from("stores").select("id", { count: "exact", head: true }),
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("employees")
      .select("id, store_designations!inner(store_departments!inner(store_teams!inner(category)))", {
        count: "exact",
        head: true,
      })
      .eq("is_active", true)
      .eq("store_designations.store_departments.store_teams.category", "frontend"),
    supabase
      .from("employees")
      .select("id, store_designations!inner(store_departments!inner(store_teams!inner(category)))", {
        count: "exact",
        head: true,
      })
      .eq("is_active", true)
      .eq("store_designations.store_departments.store_teams.category", "backend"),
  ]);

  return {
    totalStores: totalStores ?? 0,
    totalEmployees: totalEmployees ?? 0,
    frontendEmployees: frontendResult.count ?? 0,
    backendEmployees: backendResult.count ?? 0,
  };
}

export function useDashboardStats() {
  return useQuery({ queryKey: ["dashboard-stats"], queryFn: fetchStats });
}
