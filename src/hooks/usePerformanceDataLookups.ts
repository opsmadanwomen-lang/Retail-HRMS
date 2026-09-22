import { useQuery } from "@tanstack/react-query";
import { performanceDataCycleService, performanceDataSourceService } from "@/services/performanceDataLookupService";

export function usePerformanceDataCycles(companyId?: string) {
  return useQuery({
    queryKey: ["performance-data-cycles", companyId ?? "all"],
    queryFn: () => performanceDataCycleService.list(companyId),
  });
}

export function usePerformanceDataSources() {
  return useQuery({ queryKey: ["performance-data-sources"], queryFn: () => performanceDataSourceService.list() });
}
