import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import type { TaskDashboardStats } from "@/types/task";

async function fetchTaskDashboardStats(companyId?: string): Promise<TaskDashboardStats> {
  const today = new Date().toISOString().slice(0, 10);

  let query = supabase
    .from("employee_task_assignment")
    .select("id, due_date, priority, task_status ( code ), task_master ( task_categories ( id, name ) ), roles ( id, role_name )")
    .eq("is_active", true);
  if (companyId) query = query.eq("company_id", companyId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as any[];

  let todayTasks = 0;
  let pendingTasks = 0;
  let completedTasks = 0;
  let verifiedTasks = 0;
  let rejectedTasks = 0;
  let overdueTasks = 0;

  const categoryCounts = new Map<string, { name: string; count: number }>();
  const roleCounts = new Map<string, { name: string; count: number }>();

  for (const row of rows) {
    const statusCode = row.task_status?.code;
    if (row.due_date === today) todayTasks += 1;
    if (statusCode === "pending" || statusCode === "in_progress") pendingTasks += 1;
    if (statusCode === "completed") completedTasks += 1;
    if (statusCode === "verified") verifiedTasks += 1;
    if (statusCode === "rejected") rejectedTasks += 1;
    if (row.due_date < today && statusCode !== "completed" && statusCode !== "verified" && statusCode !== "cancelled") {
      overdueTasks += 1;
    }

    const category = row.task_master?.task_categories;
    if (category) {
      const entry = categoryCounts.get(category.id) ?? { name: category.name, count: 0 };
      entry.count += 1;
      categoryCounts.set(category.id, entry);
    }

    const role = row.roles;
    if (role) {
      const entry = roleCounts.get(role.id) ?? { name: role.role_name, count: 0 };
      entry.count += 1;
      roleCounts.set(role.id, entry);
    }
  }

  return {
    todayTasks,
    pendingTasks,
    completedTasks,
    verifiedTasks,
    rejectedTasks,
    overdueTasks,
    categoryWise: Array.from(categoryCounts.entries())
      .map(([categoryId, v]) => ({ categoryId, categoryName: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    roleWise: Array.from(roleCounts.entries())
      .map(([roleId, v]) => ({ roleId, roleName: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };
}

export function useTaskDashboardStats(companyId?: string) {
  return useQuery({
    queryKey: ["task-dashboard-stats", companyId ?? "all"],
    queryFn: () => fetchTaskDashboardStats(companyId),
  });
}
