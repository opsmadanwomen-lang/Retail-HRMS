import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskAttachmentService } from "@/services/taskAttachmentService";
import { taskScoreService } from "@/services/taskScoreService";
import type { TaskAttachment, TaskAttachmentType } from "@/types/task";

export function useTaskAttachments(assignmentId?: string) {
  return useQuery({
    queryKey: ["task-attachments", assignmentId],
    queryFn: () => taskAttachmentService.listForAssignment(assignmentId as string),
    enabled: Boolean(assignmentId),
  });
}

export function useUploadTaskAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      companyId: string;
      assignmentId: string;
      submissionId?: string;
      attachmentType: TaskAttachmentType;
      file: File;
      uploadedBy?: string;
    }) => taskAttachmentService.upload(params),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["task-attachments", variables.assignmentId] }),
  });
}

export function useDeleteTaskAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attachment }: { attachment: TaskAttachment; assignmentId: string }) =>
      taskAttachmentService.remove(attachment),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["task-attachments", variables.assignmentId] }),
  });
}

export function useTaskScore(assignmentId?: string) {
  return useQuery({
    queryKey: ["task-score", assignmentId],
    queryFn: () => taskScoreService.getForAssignment(assignmentId as string),
    enabled: Boolean(assignmentId),
  });
}

export function useCalculateTaskScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, calculatedBy }: { assignmentId: string; calculatedBy?: string }) =>
      taskScoreService.calculate(assignmentId, calculatedBy),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["task-score", variables.assignmentId] }),
  });
}
