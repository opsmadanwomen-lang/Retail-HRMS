import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";

export interface StoreWiseCount {
  storeId: string;
  storeName: string;
  count: number;
}

export interface DepartmentWiseCount {
  departmentId: string;
  departmentName: string;
  count: number;
}

export interface RecentlyJoinedEmployee {
  id: string;
  fullName: string;
  storeName: string | null;
  designationTitle: string | null;
  joiningDate: string | null;
}

export interface EmployeeDashboardStats {
  activeEmployees: number;
  inactiveEmployees: number;
  storeWise: StoreWiseCount[];
  departmentWise: DepartmentWiseCount[];
  recentlyJoined: RecentlyJoinedEmployee[];
}

async function fetchEmployeeStats(companyId?: string): Promise<EmployeeDashboardStats> {
  let activeQuery = supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active");
  let inactiveQuery = supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "inactive");
  let storeGroupQuery = supabase
    .from("employees")
    .select("store_id, stores(name)")
    .eq("is_active", true);
  let deptGroupQuery = supabase
    .from("employees")
    .select("store_department_id, store_departments(name)")
    .eq("is_active", true)
    .not("store_department_id", "is", null);
  let recentQuery = supabase
    .from("employees")
    .select("id, full_name, joining_date, stores(name), store_designations(title)")
    .order("joining_date", { ascending: false, nullsFirst: false })
    .limit(5);

  if (companyId) {
    activeQuery = activeQuery.eq("company_id", companyId);
    inactiveQuery = inactiveQuery.eq("company_id", companyId);
    storeGroupQuery = storeGroupQuery.eq("company_id", companyId);
    deptGroupQuery = deptGroupQuery.eq("company_id", companyId);
    recentQuery = recentQuery.eq("company_id", companyId);
  }

  const [activeResult, inactiveResult, storeRows, deptRows, recentRows] = await Promise.all([
    activeQuery,
    inactiveQuery,
    storeGroupQuery,
    deptGroupQuery,
    recentQuery,
  ]);

  if (storeRows.error) throw storeRows.error;
  if (deptRows.error) throw deptRows.error;
  if (recentRows.error) throw recentRows.error;

  const storeCounts = new Map<string, StoreWiseCount>();
  for (const row of (storeRows.data ?? []) as any[]) {
    const key = row.store_id as string;
    const name = row.stores?.name ?? "Unknown Store";
    const existing = storeCounts.get(key);
    if (existing) existing.count += 1;
    else storeCounts.set(key, { storeId: key, storeName: name, count: 1 });
  }

  const deptCounts = new Map<string, DepartmentWiseCount>();
  for (const row of (deptRows.data ?? []) as any[]) {
    const key = row.store_department_id as string;
    const name = row.store_departments?.name ?? "Unknown Department";
    const existing = deptCounts.get(key);
    if (existing) existing.count += 1;
    else deptCounts.set(key, { departmentId: key, departmentName: name, count: 1 });
  }

  return {
    activeEmployees: activeResult.count ?? 0,
    inactiveEmployees: inactiveResult.count ?? 0,
    storeWise: Array.from(storeCounts.values()).sort((a, b) => b.count - a.count),
    departmentWise: Array.from(deptCounts.values()).sort((a, b) => b.count - a.count),
    recentlyJoined: ((recentRows.data ?? []) as any[]).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      storeName: row.stores?.name ?? null,
      designationTitle: row.store_designations?.title ?? null,
      joiningDate: row.joining_date,
    })),
  };
}

export function useEmployeeDashboardStats(companyId?: string) {
  return useQuery({
    queryKey: ["employee-dashboard-stats", companyId ?? "all"],
    queryFn: () => fetchEmployeeStats(companyId),
  });
}
