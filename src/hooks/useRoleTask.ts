import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleTaskService } from "@/services/roleTaskService";

export function useRoleTaskMappings(roleId?: string) {
  return useQuery({
    queryKey: ["role-task-mapping", roleId],
    queryFn: () => roleTaskService.listForRole(roleId as string),
    enabled: Boolean(roleId),
  });
}

export function useAddTaskToRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof roleTaskService.addTaskToRole>[0]) => roleTaskService.addTaskToRole(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["role-task-mapping", variables.roleId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task-dashboard-stats"] });
    },
  });
}

export function useRemoveTaskFromRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mappingId }: { mappingId: string; roleId: string }) => roleTaskService.removeFromRole(mappingId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["role-task-mapping", variables.roleId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
