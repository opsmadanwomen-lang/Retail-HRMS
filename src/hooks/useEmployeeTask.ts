import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeeTaskService } from "@/services/employeeTaskService";
import type { AssignTaskFormValues, TaskSubmissionFormValues, TaskVerificationFormValues } from "@/types/task";

export function useEmployeeTasks(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-tasks", employeeId],
    queryFn: () => employeeTaskService.listForEmployee(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useTaskAssignments(filters: Parameters<typeof employeeTaskService.list>[0] = {}) {
  return useQuery({
    queryKey: ["task-assignments", filters],
    queryFn: () => employeeTaskService.list(filters),
  });
}

export function useAssignTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      employeeId: string;
      roleId: string | null;
      storeId: string;
      companyId: string;
      values: AssignTaskFormValues;
      assignedBy?: string;
    }) => employeeTaskService.assign(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-tasks", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["task-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["task-dashboard-stats"] });
    },
  });
}

export function useCancelTaskAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, userId }: { assignmentId: string; employeeId: string; userId?: string }) =>
      employeeTaskService.cancel(assignmentId, userId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-tasks", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["task-assignments"] });
    },
  });
}

export function useTaskSubmissions(assignmentId?: string) {
  return useQuery({
    queryKey: ["task-submissions", assignmentId],
    queryFn: () => employeeTaskService.listSubmissions(assignmentId as string),
    enabled: Boolean(assignmentId),
  });
}

export function useSubmitTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      assignment: Parameters<typeof employeeTaskService.submit>[0]["assignment"];
      mandatoryItemIds: string[];
      values: TaskSubmissionFormValues;
      submittedBy?: string;
    }) => employeeTaskService.submit(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task-submissions", variables.assignment.id] });
      queryClient.invalidateQueries({ queryKey: ["employee-tasks", variables.assignment.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["task-history", variables.assignment.id] });
      queryClient.invalidateQueries({ queryKey: ["task-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["task-dashboard-stats"] });
    },
  });
}

export function useVerifyTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      submission: Parameters<typeof employeeTaskService.verify>[0]["submission"];
      assignmentId: string;
      values: TaskVerificationFormValues;
      verifiedBy?: string;
    }) => employeeTaskService.verify(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task-submissions", variables.assignmentId] });
      queryClient.invalidateQueries({ queryKey: ["task-history", variables.assignmentId] });
      queryClient.invalidateQueries({ queryKey: ["task-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["task-dashboard-stats"] });
    },
  });
}

export function useTaskComments(assignmentId?: string) {
  return useQuery({
    queryKey: ["task-comments", assignmentId],
    queryFn: () => employeeTaskService.listComments(assignmentId as string),
    enabled: Boolean(assignmentId),
  });
}

export function useAddTaskComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      comment,
      commentedBy,
    }: {
      assignmentId: string;
      comment: string;
      commentedBy?: string;
    }) => employeeTaskService.addComment(assignmentId, comment, commentedBy),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["task-comments", variables.assignmentId] }),
  });
}

export function useTaskHistory(assignmentId?: string) {
  return useQuery({
    queryKey: ["task-history", assignmentId],
    queryFn: () => employeeTaskService.listHistory(assignmentId as string),
    enabled: Boolean(assignmentId),
  });
}
