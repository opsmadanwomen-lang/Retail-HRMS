import { useQuery } from "@tanstack/react-query";
import { roleCategoryService } from "@/services/roleCategoryService";
import { roleStatusService } from "@/services/roleStatusService";

export function useRoleCategories() {
  return useQuery({ queryKey: ["role-categories"], queryFn: () => roleCategoryService.list() });
}

export function useRoleStatuses() {
  return useQuery({ queryKey: ["role-statuses"], queryFn: () => roleStatusService.list() });
}
