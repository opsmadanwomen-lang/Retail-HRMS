import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeePromotionService } from "@/services/employeePromotionService";

export function useEmployeePromotions(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-promotions", employeeId],
    queryFn: () => employeePromotionService.listForEmployee(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useRecordEmployeePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof employeePromotionService.record>[0]) =>
      employeePromotionService.record(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-promotions", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employees", "detail", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}
