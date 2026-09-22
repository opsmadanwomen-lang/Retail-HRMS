import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shiftService, type ShiftFormValues } from "@/services/shiftService";

const SHIFTS_KEY = ["shifts"] as const;

export function useShifts(companyId?: string) {
  return useQuery({
    queryKey: [...SHIFTS_KEY, companyId],
    queryFn: () => shiftService.list(companyId as string),
    enabled: Boolean(companyId),
  });
}

export function useShiftsForStore(companyId?: string, storeId?: string) {
  return useQuery({
    queryKey: [...SHIFTS_KEY, "for-store", companyId, storeId],
    queryFn: () => shiftService.getShiftsForStore(companyId as string, storeId as string),
    enabled: Boolean(companyId && storeId),
  });
}

export function useShiftStoreAssociations(shiftId?: string) {
  return useQuery({
    queryKey: [...SHIFTS_KEY, "stores", shiftId],
    queryFn: () => shiftService.getStoreAssociations(shiftId as string),
    enabled: Boolean(shiftId),
  });
}

export function useCreateShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, values, userId }: { companyId: string; values: ShiftFormValues; userId?: string }) =>
      shiftService.create(companyId, values, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SHIFTS_KEY }),
  });
}

export function useUpdateShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values, userId }: { id: string; values: ShiftFormValues; userId?: string }) =>
      shiftService.update(id, values, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SHIFTS_KEY }),
  });
}

export function useCurrentShiftAssignment(employeeId?: string) {
  return useQuery({
    queryKey: [...SHIFTS_KEY, "current-assignment", employeeId],
    queryFn: () => shiftService.getCurrentAssignment(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useShiftAssignmentHistory(employeeId?: string) {
  return useQuery({
    queryKey: [...SHIFTS_KEY, "assignment-history", employeeId],
    queryFn: () => shiftService.getAssignmentHistory(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useChangeShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: shiftService.changeShift,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...SHIFTS_KEY, "current-assignment", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: [...SHIFTS_KEY, "assignment-history", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employee-schedule"] });
    },
  });
}

export function useBulkAssignShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: shiftService.bulkAssignShift,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-schedule"] }),
  });
}
