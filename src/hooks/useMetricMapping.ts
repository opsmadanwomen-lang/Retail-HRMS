import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { metricMappingService } from "@/services/metricMappingService";
import type { MetricMappingFormValues } from "@/types/performance";

export function useMetricMappings(filters: Parameters<typeof metricMappingService.list>[0] = {}) {
  return useQuery({
    queryKey: ["metric-mapping", filters],
    queryFn: () => metricMappingService.list(filters),
  });
}

export function useCreateMetricMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      values,
      companyId,
      userId,
    }: {
      values: MetricMappingFormValues;
      companyId: string | null;
      userId?: string;
    }) => metricMappingService.create(values, companyId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["metric-mapping"] }),
  });
}

export function useRemoveMetricMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) => metricMappingService.remove(mappingId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["metric-mapping"] }),
  });
}
