import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeeService } from "@/services/employeeService";
import type { EmployeeFilters, EmployeeFormValues } from "@/types/employee";

const EMPLOYEES_KEY = ["employees"] as const;

export function useEmployees(filters: EmployeeFilters = {}) {
  return useQuery({
    queryKey: [...EMPLOYEES_KEY, filters],
    queryFn: () => employeeService.list(filters),
  });
}

export function useEmployee(id?: string) {
  return useQuery({
    queryKey: [...EMPLOYEES_KEY, "detail", id],
    queryFn: () => employeeService.getById(id as string),
    enabled: Boolean(id),
  });
}

/** Active employees selectable in the User Management "Employee *" picker. */
export function useAssignableEmployees(companyId?: string) {
  return useQuery({
    queryKey: [...EMPLOYEES_KEY, "assignable", companyId],
    queryFn: () => employeeService.listAssignable(companyId as string),
    enabled: Boolean(companyId),
  });
}

export function useReportingManagerOptions(storeId?: string) {
  return useQuery({
    queryKey: [...EMPLOYEES_KEY, "for-store", storeId],
    queryFn: () => employeeService.listForStore(storeId as string),
    enabled: Boolean(storeId),
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      companyId,
      storeId,
      values,
      userId,
    }: {
      companyId: string;
      storeId: string | null;
      values: EmployeeFormValues;
      userId?: string;
    }) => employeeService.create(companyId, storeId, values, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMPLOYEES_KEY }),
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      values,
      userId,
    }: {
      id: string;
      values: Partial<EmployeeFormValues>;
      userId?: string;
    }) => employeeService.update(id, values, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMPLOYEES_KEY }),
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => employeeService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMPLOYEES_KEY }),
  });
}
