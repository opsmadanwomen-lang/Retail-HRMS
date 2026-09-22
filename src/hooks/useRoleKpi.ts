import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleKpiService } from "@/services/roleKpiService";

export function useRoleKpiMappings(roleId?: string) {
  return useQuery({
    queryKey: ["role-kpi-mapping", roleId],
    queryFn: () => roleKpiService.listForRole(roleId as string),
    enabled: Boolean(roleId),
  });
}

export function useAddKpiToRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof roleKpiService.addKpiToRole>[0]) => roleKpiService.addKpiToRole(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["role-kpi-mapping", variables.roleId] });
      queryClient.invalidateQueries({ queryKey: ["kpi"] });
      queryClient.invalidateQueries({ queryKey: ["kpi-dashboard-stats"] });
    },
  });
}

export function useRemoveKpiFromRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mappingId }: { mappingId: string; roleId: string }) => roleKpiService.removeFromRole(mappingId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["role-kpi-mapping", variables.roleId] });
      queryClient.invalidateQueries({ queryKey: ["kpi"] });
      queryClient.invalidateQueries({ queryKey: ["kpi-dashboard-stats"] });
    },
  });
}

export function useSaveWeightageBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof roleKpiService.saveWeightageBatch>[0]) => roleKpiService.saveWeightageBatch(params),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["role-kpi-mapping", variables.roleId] }),
  });
}
