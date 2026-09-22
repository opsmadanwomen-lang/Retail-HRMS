import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userManagementService } from "@/services/userManagementService";
import type { UserManagementRole } from "@/types/userManagement";

const USER_MANAGEMENT_KEY = ["user-management"] as const;

export function useManagedUsers(companyId?: string) {
  return useQuery({
    queryKey: [...USER_MANAGEMENT_KEY, "list", companyId],
    queryFn: () => userManagementService.list(companyId as string),
    enabled: Boolean(companyId),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { employeeId: string; email: string; password: string; role: UserManagementRole; storeId: string | null; isActive: boolean }) =>
      userManagementService.createUser(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: USER_MANAGEMENT_KEY }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { userId: string; fullName?: string; email?: string; role?: UserManagementRole; storeId?: string | null; isActive?: boolean }) =>
      userManagementService.updateUser(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: USER_MANAGEMENT_KEY }),
  });
}

/** Controlled "Relink Employee" -- the only supported way to change a login's employee linkage. */
export function useRelinkEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { userId: string; employeeId: string }) => userManagementService.relinkEmployee(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USER_MANAGEMENT_KEY });
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useResetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { userId: string; password: string }) => userManagementService.resetPassword(params.userId, params.password),
    onSuccess: () => qc.invalidateQueries({ queryKey: USER_MANAGEMENT_KEY }),
  });
}

export function useSetUserActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { userId: string; isActive: boolean }) => userManagementService.setActive(params.userId, params.isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: USER_MANAGEMENT_KEY }),
  });
}
