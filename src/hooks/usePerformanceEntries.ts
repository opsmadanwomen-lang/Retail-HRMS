import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { performanceEntryService } from "@/services/performanceEntryService";
import type { PerformanceEntryFilters, PerformanceEntryFormValues } from "@/types/performance";

const ENTRIES_KEY = ["performance-entries"] as const;

export function usePerformanceEntries(filters: PerformanceEntryFilters = {}) {
  return useQuery({
    queryKey: [...ENTRIES_KEY, filters],
    queryFn: () => performanceEntryService.list(filters),
  });
}

export function usePerformanceEntry(id?: string) {
  return useQuery({
    queryKey: [...ENTRIES_KEY, "detail", id],
    queryFn: () => performanceEntryService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreatePerformanceEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      values,
      companyId,
      sourceId,
      enteredBy,
    }: {
      values: PerformanceEntryFormValues;
      companyId: string;
      sourceId?: string;
      enteredBy?: string;
    }) => performanceEntryService.create(values, companyId, sourceId, enteredBy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ENTRIES_KEY });
      queryClient.invalidateQueries({ queryKey: ["performance-dashboard-stats"] });
    },
  });
}

export function useBulkCreatePerformanceEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof performanceEntryService.bulkCreate>[0]) =>
      performanceEntryService.bulkCreate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ENTRIES_KEY });
      queryClient.invalidateQueries({ queryKey: ["performance-dashboard-stats"] });
    },
  });
}

export function useUpdatePerformanceEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      entryValue,
      remarks,
      userId,
    }: {
      id: string;
      entryValue: number;
      remarks?: string;
      userId?: string;
    }) => performanceEntryService.update(id, entryValue, remarks, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ENTRIES_KEY });
      queryClient.invalidateQueries({ queryKey: ["metric-history"] });
    },
  });
}

export function useDeletePerformanceEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => performanceEntryService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ENTRIES_KEY });
      queryClient.invalidateQueries({ queryKey: ["performance-dashboard-stats"] });
    },
  });
}
