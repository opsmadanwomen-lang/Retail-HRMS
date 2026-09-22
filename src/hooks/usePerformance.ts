import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { performanceService } from "@/services/performanceService";

export function usePerformanceCycles(companyId?: string) {
  return useQuery({
    queryKey: ["performance-cycles", companyId ?? "all"],
    queryFn: () => performanceService.listCycles(companyId),
  });
}

export function usePerformanceRatings() {
  return useQuery({ queryKey: ["performance-ratings"], queryFn: () => performanceService.listRatings() });
}

export function usePerformanceSummary(employeeId?: string, cycleId?: string) {
  return useQuery({
    queryKey: ["performance-summary", employeeId, cycleId],
    queryFn: () => performanceService.getSummaryForEmployee(employeeId as string, cycleId as string),
    enabled: Boolean(employeeId && cycleId),
  });
}

export function useCalculatePerformanceSummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof performanceService.calculatePerformanceSummary>[0]) =>
      performanceService.calculatePerformanceSummary(params),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["performance-summary", variables.employeeId, variables.cycleId] }),
  });
}
