import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { kpiMasterService } from "@/services/kpiMasterService";
import type { KpiFilters, KpiFormValues } from "@/types/kpi";

const KPI_KEY = ["kpi"] as const;

export function useKpis(filters: KpiFilters = {}) {
  return useQuery({
    queryKey: [...KPI_KEY, filters],
    queryFn: () => kpiMasterService.list(filters),
  });
}

export function useKpi(id?: string) {
  return useQuery({
    queryKey: [...KPI_KEY, "detail", id],
    queryFn: () => kpiMasterService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateKpi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ values, companyId, userId }: { values: KpiFormValues; companyId: string | null; userId?: string }) =>
      kpiMasterService.create(values, companyId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KPI_KEY }),
  });
}

export function useUpdateKpi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values, userId }: { id: string; values: Partial<KpiFormValues>; userId?: string }) =>
      kpiMasterService.update(id, values, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KPI_KEY }),
  });
}

export function useDeleteKpi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => kpiMasterService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KPI_KEY }),
  });
}
