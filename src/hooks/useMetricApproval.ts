import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { metricApprovalService, metricCommentService, metricHistoryService } from "@/services/metricApprovalService";
import type { MetricApprovalFormValues } from "@/types/performance";

export function useMetricApprovals(entryId?: string) {
  return useQuery({
    queryKey: ["metric-approval", entryId],
    queryFn: () => metricApprovalService.listForEntry(entryId as string),
    enabled: Boolean(entryId),
  });
}

export function useDecideMetricApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, values, verifierId }: { entryId: string; values: MetricApprovalFormValues; verifierId?: string }) =>
      metricApprovalService.decide(entryId, values, verifierId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["metric-approval", variables.entryId] });
      queryClient.invalidateQueries({ queryKey: ["metric-history", variables.entryId] });
      queryClient.invalidateQueries({ queryKey: ["performance-entries"] });
      queryClient.invalidateQueries({ queryKey: ["performance-dashboard-stats"] });
    },
  });
}

export function useMetricComments(entryId?: string) {
  return useQuery({
    queryKey: ["metric-comments", entryId],
    queryFn: () => metricCommentService.listForEntry(entryId as string),
    enabled: Boolean(entryId),
  });
}

export function useAddMetricComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, comment, commentedBy }: { entryId: string; comment: string; commentedBy?: string }) =>
      metricCommentService.add(entryId, comment, commentedBy),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["metric-comments", variables.entryId] }),
  });
}

export function useMetricHistory(entryId?: string) {
  return useQuery({
    queryKey: ["metric-history", entryId],
    queryFn: () => metricHistoryService.listForEntry(entryId as string),
    enabled: Boolean(entryId),
  });
}
