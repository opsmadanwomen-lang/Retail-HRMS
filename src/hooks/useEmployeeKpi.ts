import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeeKpiService } from "@/services/employeeKpiService";

export function useEmployeeKpiAssignments(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-kpi-assignment", employeeId],
    queryFn: () => employeeKpiService.listForEmployee(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useAssignKpiToEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof employeeKpiService.assign>[0]) => employeeKpiService.assign(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-kpi-assignment", variables.employeeId] });
    },
  });
}

export function useRemoveEmployeeKpiAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId }: { assignmentId: string; employeeId: string }) =>
      employeeKpiService.removeAssignment(assignmentId),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["employee-kpi-assignment", variables.employeeId] }),
  });
}

export function useSyncKpiFromRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof employeeKpiService.syncFromRole>[0]) => employeeKpiService.syncFromRole(params),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["employee-kpi-assignment", variables.employeeId] }),
  });
}

export function useSetEmployeeKpiTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof employeeKpiService.setEmployeeTarget>[0]) => employeeKpiService.setEmployeeTarget(params),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["employee-kpi-target", variables.kpiId, variables.employeeId] }),
  });
}

export function useEmployeeKpiTarget(kpiId?: string, employeeId?: string) {
  return useQuery({
    queryKey: ["employee-kpi-target", kpiId, employeeId],
    queryFn: () => employeeKpiService.getLatestTargetForEmployee(kpiId as string, employeeId as string),
    enabled: Boolean(kpiId && employeeId),
  });
}

export function useEmployeeKpiActuals(kpiId?: string, employeeId?: string) {
  return useQuery({
    queryKey: ["employee-kpi-actuals", kpiId, employeeId],
    queryFn: () => employeeKpiService.listActualsForEmployee(kpiId as string, employeeId as string),
    enabled: Boolean(kpiId && employeeId),
  });
}

export function useLogEmployeeKpiActual() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof employeeKpiService.logActual>[0]) => employeeKpiService.logActual(params),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["employee-kpi-actuals", variables.kpiId, variables.employeeId] }),
  });
}
