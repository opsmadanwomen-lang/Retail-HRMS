import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskCategoryService } from "@/services/taskCategoryService";

export function useTaskCategories() {
  return useQuery({ queryKey: ["task-categories"], queryFn: () => taskCategoryService.list() });
}

export function useAllTaskCategories() {
  return useQuery({ queryKey: ["task-categories", "all"], queryFn: () => taskCategoryService.listAll() });
}

export function useCreateTaskCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, displayOrder, userId }: { name: string; displayOrder?: number; userId?: string }) =>
      taskCategoryService.create(name, displayOrder, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-categories"] }),
  });
}

export function useSetTaskCategoryActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive, userId }: { id: string; isActive: boolean; userId?: string }) =>
      taskCategoryService.setActive(id, isActive, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-categories"] }),
  });
}
