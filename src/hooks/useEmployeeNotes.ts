import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeeNoteService } from "@/services/employeeNoteService";
import { employeeService } from "@/services/employeeService";

export function useEmployeeNotes(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-notes", employeeId],
    queryFn: () => employeeNoteService.listForEmployee(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useAddEmployeeNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof employeeNoteService.add>[0]) => employeeNoteService.add(params),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["employee-notes", variables.employeeId] }),
  });
}

export function useDirectReports(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-direct-reports", employeeId],
    queryFn: () => employeeService.listDirectReports(employeeId as string),
    enabled: Boolean(employeeId),
  });
}
