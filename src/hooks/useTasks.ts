import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskMasterService } from "@/services/taskMasterService";
import type { TaskFilters, TaskFormValues } from "@/types/task";

const TASKS_KEY = ["tasks"] as const;

export function useTasks(filters: TaskFilters = {}) {
  return useQuery({
    queryKey: [...TASKS_KEY, filters],
    queryFn: () => taskMasterService.list(filters),
  });
}

export function useTask(id?: string) {
  return useQuery({
    queryKey: [...TASKS_KEY, "detail", id],
    queryFn: () => taskMasterService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ values, companyId, userId }: { values: TaskFormValues; companyId: string | null; userId?: string }) =>
      taskMasterService.create(values, companyId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values, userId }: { id: string; values: Partial<TaskFormValues>; userId?: string }) =>
      taskMasterService.update(id, values, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => taskMasterService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}
