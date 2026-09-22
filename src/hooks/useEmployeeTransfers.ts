import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeeTransferService } from "@/services/employeeTransferService";

export function useEmployeeTransfers(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-transfers", employeeId],
    queryFn: () => employeeTransferService.listForEmployee(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useRecordEmployeeTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof employeeTransferService.record>[0]) =>
      employeeTransferService.record(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-transfers", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employees", "detail", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}
