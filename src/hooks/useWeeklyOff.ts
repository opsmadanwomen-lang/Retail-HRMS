import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { weeklyOffService } from "@/services/weeklyOffService";

const WEEKLY_OFF_KEY = ["weekly-off"] as const;

export function useWeeklyOffHistory(employeeId?: string) {
  return useQuery({
    queryKey: [...WEEKLY_OFF_KEY, "history", employeeId],
    queryFn: () => weeklyOffService.getHistory(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useCurrentWeeklyOff(employeeId?: string) {
  return useQuery({
    queryKey: [...WEEKLY_OFF_KEY, "current", employeeId],
    queryFn: () => weeklyOffService.getCurrent(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useWeeklyOffOverrides(employeeId?: string) {
  return useQuery({
    queryKey: [...WEEKLY_OFF_KEY, "overrides", employeeId],
    queryFn: () => weeklyOffService.getAllOverrides(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useAssignWeeklyOff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: weeklyOffService.assign,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_OFF_KEY, "history", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_OFF_KEY, "current", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employee-schedule"] });
    },
  });
}

export function useBulkAssignWeeklyOff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: weeklyOffService.bulkAssign,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-schedule"] }),
  });
}

export function useCreateWeeklyOffOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: weeklyOffService.createOverride,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_OFF_KEY, "overrides", variables.employeeId] });
    },
  });
}

export function useRemoveWeeklyOffOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: weeklyOffService.removeOverride,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...WEEKLY_OFF_KEY, "overrides"] }),
  });
}
