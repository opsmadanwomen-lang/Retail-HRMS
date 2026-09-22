import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskChecklistService } from "@/services/taskChecklistService";
import type { TaskChecklistFormValues, TaskChecklistItemFormValues } from "@/types/task";

export function useTaskChecklists(taskId?: string) {
  return useQuery({
    queryKey: ["task-checklists", taskId],
    queryFn: () => taskChecklistService.listForTask(taskId as string),
    enabled: Boolean(taskId),
  });
}

export function useCreateTaskChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, values, userId }: { taskId: string; values: TaskChecklistFormValues; userId?: string }) =>
      taskChecklistService.createChecklist(taskId, values, userId),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["task-checklists", variables.taskId] }),
  });
}

export function useRemoveTaskChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ checklistId }: { checklistId: string; taskId: string }) =>
      taskChecklistService.removeChecklist(checklistId),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["task-checklists", variables.taskId] }),
  });
}

export function useAddChecklistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      checklistId,
      values,
      userId,
    }: {
      checklistId: string;
      taskId: string;
      values: TaskChecklistItemFormValues;
      userId?: string;
    }) => taskChecklistService.addItem(checklistId, values, userId),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["task-checklists", variables.taskId] }),
  });
}

export function useRemoveChecklistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId }: { itemId: string; taskId: string }) => taskChecklistService.removeItem(itemId),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["task-checklists", variables.taskId] }),
  });
}
