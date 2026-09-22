import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { metricMasterService } from "@/services/metricMasterService";
import type { MetricFilters, MetricFormValues } from "@/types/performance";

const METRICS_KEY = ["metrics"] as const;

export function useMetrics(filters: MetricFilters = {}) {
  return useQuery({
    queryKey: [...METRICS_KEY, filters],
    queryFn: () => metricMasterService.list(filters),
  });
}

export function useMetric(id?: string) {
  return useQuery({
    queryKey: [...METRICS_KEY, "detail", id],
    queryFn: () => metricMasterService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateMetric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ values, companyId, userId }: { values: MetricFormValues; companyId: string | null; userId?: string }) =>
      metricMasterService.create(values, companyId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: METRICS_KEY }),
  });
}

export function useUpdateMetric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values, userId }: { id: string; values: Partial<MetricFormValues>; userId?: string }) =>
      metricMasterService.update(id, values, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: METRICS_KEY }),
  });
}

export function useDeleteMetric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => metricMasterService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: METRICS_KEY }),
  });
}
