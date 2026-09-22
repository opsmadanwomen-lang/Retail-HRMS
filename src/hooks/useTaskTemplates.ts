import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskTemplateService } from "@/services/taskTemplateService";
import type { TaskTemplateFormValues } from "@/types/task";

const TEMPLATES_KEY = ["task-templates"] as const;

export function useTaskTemplates(companyId?: string) {
  return useQuery({
    queryKey: [...TEMPLATES_KEY, companyId ?? "all"],
    queryFn: () => taskTemplateService.list(companyId),
  });
}

export function useTaskTemplate(id?: string) {
  return useQuery({
    queryKey: [...TEMPLATES_KEY, "detail", id],
    queryFn: () => taskTemplateService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateTaskTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      values,
      companyId,
      userId,
    }: {
      values: TaskTemplateFormValues;
      companyId: string | null;
      userId?: string;
    }) => taskTemplateService.create(values, companyId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

export function useUpdateTaskTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values, userId }: { id: string; values: Partial<TaskTemplateFormValues>; userId?: string }) =>
      taskTemplateService.update(id, values, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

export function useDeleteTaskTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => taskTemplateService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}
