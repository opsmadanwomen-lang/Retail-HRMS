import { useQuery } from "@tanstack/react-query";
import { taskFrequencyService, taskStatusService } from "@/services/taskLookupService";

export function useTaskFrequencies() {
  return useQuery({ queryKey: ["task-frequency"], queryFn: () => taskFrequencyService.list() });
}

export function useTaskStatuses() {
  return useQuery({ queryKey: ["task-status"], queryFn: () => taskStatusService.list() });
}
