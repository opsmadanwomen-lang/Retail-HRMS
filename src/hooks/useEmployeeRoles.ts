import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeeRoleService } from "@/services/employeeRoleService";
import type { AssignRoleFormValues } from "@/types/role";

export function useEmployeeRoles(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-roles", employeeId],
    queryFn: () => employeeRoleService.listForEmployee(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useActiveEmployeeRoles(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-roles", "active", employeeId],
    queryFn: () => employeeRoleService.listActiveForEmployee(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useEmployeeRoleHistory(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-role-history", employeeId],
    queryFn: () => employeeRoleService.historyForEmployee(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useAssignRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      employeeId: string;
      storeId: string;
      companyId: string;
      values: AssignRoleFormValues;
      assignedBy?: string;
    }) => employeeRoleService.assign(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-roles", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employee-roles", "active", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employee-role-history", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      queryClient.invalidateQueries({ queryKey: ["role-dashboard-stats"] });
    },
  });
}

export function useRemoveRoleAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { employeeRoleId: string; employeeId: string; reason?: string; removedBy?: string }) =>
      employeeRoleService.remove(params.employeeRoleId, params.reason, params.removedBy),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-roles", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employee-roles", "active", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employee-role-history", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      queryClient.invalidateQueries({ queryKey: ["role-dashboard-stats"] });
    },
  });
}
