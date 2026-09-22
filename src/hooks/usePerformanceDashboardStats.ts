import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import type { PerformanceDashboardStats } from "@/types/performance";

async function fetchPerformanceDashboardStats(companyId?: string): Promise<PerformanceDashboardStats> {
  const today = new Date().toISOString().slice(0, 10);

  let query = supabase
    .from("performance_entries")
    .select("id, entry_date, status, stores ( id, name ), master_departments ( id, name ), roles ( id, role_name )");
  if (companyId) query = query.eq("company_id", companyId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as any[];

  let todaysEntries = 0;
  let pendingEntries = 0;
  let approvedEntries = 0;
  let rejectedEntries = 0;

  const storeCounts = new Map<string, { name: string; count: number }>();
  const departmentCounts = new Map<string, { name: string; count: number }>();
  const roleCounts = new Map<string, { name: string; count: number }>();

  for (const row of rows) {
    if (row.entry_date === today) todaysEntries += 1;
    if (row.status === "submitted" || row.status === "draft") pendingEntries += 1;
    if (row.status === "approved" || row.status === "locked") approvedEntries += 1;
    if (row.status === "rejected") rejectedEntries += 1;

    const store = row.stores;
    if (store) {
      const entry = storeCounts.get(store.id) ?? { name: store.name, count: 0 };
      entry.count += 1;
      storeCounts.set(store.id, entry);
    }
    const department = row.master_departments;
    if (department) {
      const entry = departmentCounts.get(department.id) ?? { name: department.name, count: 0 };
      entry.count += 1;
      departmentCounts.set(department.id, entry);
    }
    const role = row.roles;
    if (role) {
      const entry = roleCounts.get(role.id) ?? { name: role.role_name, count: 0 };
      entry.count += 1;
      roleCounts.set(role.id, entry);
    }
  }

  return {
    todaysEntries,
    pendingEntries,
    approvedEntries,
    rejectedEntries,
    storeWise: Array.from(storeCounts.entries())
      .map(([storeId, v]) => ({ storeId, storeName: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    departmentWise: Array.from(departmentCounts.entries())
      .map(([departmentId, v]) => ({ departmentId, departmentName: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    roleWise: Array.from(roleCounts.entries())
      .map(([roleId, v]) => ({ roleId, roleName: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };
}

export function usePerformanceDashboardStats(companyId?: string) {
  return useQuery({
    queryKey: ["performance-dashboard-stats", companyId ?? "all"],
    queryFn: () => fetchPerformanceDashboardStats(companyId),
  });
}
