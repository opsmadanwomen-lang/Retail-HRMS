import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { kpiCategoryService } from "@/services/kpiCategoryService";

export function useKpiCategories() {
  return useQuery({ queryKey: ["kpi-categories"], queryFn: () => kpiCategoryService.list() });
}

export function useAllKpiCategories() {
  return useQuery({ queryKey: ["kpi-categories", "all"], queryFn: () => kpiCategoryService.listAll() });
}

export function useCreateKpiCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, displayOrder, userId }: { name: string; displayOrder?: number; userId?: string }) =>
      kpiCategoryService.create(name, displayOrder, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kpi-categories"] }),
  });
}

export function useSetKpiCategoryActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive, userId }: { id: string; isActive: boolean; userId?: string }) =>
      kpiCategoryService.setActive(id, isActive, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kpi-categories"] }),
  });
}
