import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import type { RoleDashboardStats } from "@/types/role";

async function fetchRoleDashboardStats(companyId?: string): Promise<RoleDashboardStats> {
  let rolesQuery = supabase.from("roles").select("id, role_name", { count: "exact" }).eq("is_active", true);
  if (companyId) rolesQuery = rolesQuery.or(`company_id.is.null,company_id.eq.${companyId}`);

  let assignmentsQuery = supabase
    .from("employee_roles")
    .select("role_id, roles ( role_name ), role_status ( code )")
    .is("removed_at", null);
  if (companyId) assignmentsQuery = assignmentsQuery.eq("company_id", companyId);

  const [{ data: roles, error: rolesError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    rolesQuery,
    assignmentsQuery,
  ]);

  if (rolesError) throw rolesError;
  if (assignmentsError) throw assignmentsError;

  const totalRoles = (roles ?? []).length;

  const countByRole = new Map<string, { roleName: string; count: number }>();
  let temporaryRoles = 0;
  let permanentRoles = 0;

  for (const row of (assignments ?? []) as any[]) {
    const existing = countByRole.get(row.role_id);
    const roleName = row.roles?.role_name ?? "Unknown Role";
    if (existing) existing.count += 1;
    else countByRole.set(row.role_id, { roleName, count: 1 });

    if (row.role_status?.code === "temporary") temporaryRoles += 1;
    if (row.role_status?.code === "permanent") permanentRoles += 1;
  }

  const assignedRoles = countByRole.size;

  return {
    totalRoles,
    assignedRoles,
    unassignedRoles: Math.max(totalRoles - assignedRoles, 0),
    temporaryRoles,
    permanentRoles,
    mostAssignedRoles: Array.from(countByRole.entries())
      .map(([roleId, v]) => ({ roleId, roleName: v.roleName, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

export function useRoleDashboardStats(companyId?: string) {
  return useQuery({
    queryKey: ["role-dashboard-stats", companyId ?? "all"],
    queryFn: () => fetchRoleDashboardStats(companyId),
  });
}
