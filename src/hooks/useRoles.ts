import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleService } from "@/services/roleService";
import type { RoleFilters, RoleFormValues } from "@/types/role";

const ROLES_KEY = ["roles"] as const;

export function useRoles(filters: RoleFilters = {}) {
  return useQuery({
    queryKey: [...ROLES_KEY, filters],
    queryFn: () => roleService.list(filters),
  });
}

export function useRole(id?: string) {
  return useQuery({
    queryKey: [...ROLES_KEY, "detail", id],
    queryFn: () => roleService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      values,
      companyId,
      userId,
    }: {
      values: RoleFormValues;
      companyId: string | null;
      userId?: string;
    }) => roleService.create(values, companyId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROLES_KEY }),
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values, userId }: { id: string; values: Partial<RoleFormValues>; userId?: string }) =>
      roleService.update(id, values, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROLES_KEY }),
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => roleService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROLES_KEY }),
  });
}
