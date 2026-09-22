import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { permissionService } from "@/services/permissionService";

const PERM_KEY = ["permission"] as const;

export function usePermissionModules() {
  return useQuery({ queryKey: [...PERM_KEY, "modules"], queryFn: () => permissionService.listModules() });
}
export function usePermissionActions() {
  return useQuery({ queryKey: [...PERM_KEY, "actions"], queryFn: () => permissionService.listActions() });
}
export function usePermissionFields(moduleCode?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "fields", moduleCode],
    queryFn: () => permissionService.listFields(moduleCode as string),
    enabled: Boolean(moduleCode),
  });
}

export function useDynamicRoles(companyId?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "roles", companyId],
    queryFn: () => permissionService.listRoles(companyId as string),
    enabled: Boolean(companyId),
  });
}
export function useCreateDynamicRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.createRole>[0]) => permissionService.createRole(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PERM_KEY, "roles"] }),
  });
}
export function useSetDynamicRoleStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { roleId: string; isActive: boolean }) => permissionService.setRoleStatus(params.roleId, params.isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PERM_KEY, "roles"] }),
  });
}
export function useUpdateDynamicRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.updateRole>[0]) => permissionService.updateRole(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PERM_KEY, "roles"] }),
  });
}

export function useRolePermissions(roleId?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "role-permissions", roleId],
    queryFn: () => permissionService.listRolePermissions(roleId as string),
    enabled: Boolean(roleId),
  });
}
export function useSetRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.setRolePermission>[0]) => permissionService.setRolePermission(params),
    onSuccess: (_d, params) => {
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "role-permissions", params.roleId] });
      // affects every user inheriting this role (unless individually overridden) — invalidate
      // the whole effective-actions cache rather than try to enumerate affected users.
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "effective-actions"] });
    },
  });
}
export function useClearRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.clearRolePermission>[0]) => permissionService.clearRolePermission(params),
    onSuccess: (_d, params) => {
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "role-permissions", params.roleId] });
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "effective-actions"] });
    },
  });
}

export function useRoleFieldPermissions(roleId?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "role-field-permissions", roleId],
    queryFn: () => permissionService.listRoleFieldPermissions(roleId as string),
    enabled: Boolean(roleId),
  });
}
export function useSetRoleFieldPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.setRoleFieldPermission>[0]) => permissionService.setRoleFieldPermission(params),
    onSuccess: (_d, params) => qc.invalidateQueries({ queryKey: [...PERM_KEY, "role-field-permissions", params.roleId] }),
  });
}

export function useUserDynamicRole(userId?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "user-role", userId],
    queryFn: () => permissionService.getUserDynamicRole(userId as string),
    enabled: Boolean(userId),
  });
}
export function useSetUserDynamicRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { userId: string; roleId: string | null }) => permissionService.setUserDynamicRole(params.userId, params.roleId),
    onSuccess: (_d, params) => qc.invalidateQueries({ queryKey: [...PERM_KEY, "user-role", params.userId] }),
  });
}

export function useUserPermissionOverrides(userId?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "user-overrides", userId],
    queryFn: () => permissionService.listUserOverrides(userId as string),
    enabled: Boolean(userId),
  });
}
export function useSetUserOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.setUserOverride>[0]) => permissionService.setUserOverride(params),
    onSuccess: (_d, params) => {
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "user-overrides", params.userId] });
      // a module-level override also affects the tab-level fallback chain (permission_effective_actions).
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "effective-actions", params.userId] });
    },
  });
}
export function useClearUserOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.clearUserOverride>[0]) => permissionService.clearUserOverride(params),
    onSuccess: (_d, params) => {
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "user-overrides", params.userId] });
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "effective-actions", params.userId] });
    },
  });
}
export function useSetUserFieldOverride() {
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.setUserFieldOverride>[0]) => permissionService.setUserFieldOverride(params),
  });
}

/** The hook the REST of the app should use to gate a button/action: "can the current user do
 *  <actionCode> in <moduleCode>?" Defaults to true (fail-open) while loading or unconfigured —
 *  never flashes a false-negative into a "not allowed" state before the real answer arrives. */
export function useHasPermission(moduleCode: string, actionCode: string) {
  const query = useQuery({
    queryKey: [...PERM_KEY, "my-permission", moduleCode, actionCode],
    queryFn: () => permissionService.myPermission(moduleCode, actionCode),
  });
  return { allowed: query.data ?? true, isLoading: query.isLoading };
}
/** Tab-scoped counterpart of useHasPermission — falls back to module-level when unconfigured.
 *  Defaults to true (fail-open) while loading, same convention as every other "my permission" hook. */
export function useHasTabPermission(moduleCode: string, tabCode: string, actionCode: string) {
  const query = useQuery({
    queryKey: [...PERM_KEY, "my-tab-permission", moduleCode, tabCode, actionCode],
    queryFn: () => permissionService.myTabPermission(moduleCode, tabCode, actionCode),
  });
  return { allowed: query.data ?? true, isLoading: query.isLoading };
}
export function useHasFieldPermission(moduleCode: string, fieldCode: string) {
  const query = useQuery({
    queryKey: [...PERM_KEY, "my-field-permission", moduleCode, fieldCode],
    queryFn: () => permissionService.myFieldPermission(moduleCode, fieldCode),
  });
  return { allowed: query.data ?? true, isLoading: query.isLoading };
}
export function useMyPermissionsBulk(moduleCodes?: string[]) {
  return useQuery({
    queryKey: [...PERM_KEY, "my-permissions-bulk", moduleCodes?.join(",")],
    queryFn: () => permissionService.myPermissionsBulk(moduleCodes),
  });
}

export function usePermissionAuditHistory(limit = 100) {
  return useQuery({ queryKey: [...PERM_KEY, "audit", limit], queryFn: () => permissionService.auditHistory(limit) });
}

// ================= Scope + Effective Permissions + bulk role ops (migration 0164) =================
export function useRoleScopes(roleId?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "role-scopes", roleId],
    queryFn: () => permissionService.listRoleScopes(roleId as string),
    enabled: Boolean(roleId),
  });
}
export function useSetRoleScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.setRoleScope>[0]) => permissionService.setRoleScope(params),
    onSuccess: (_d, params) => qc.invalidateQueries({ queryKey: [...PERM_KEY, "role-scopes", params.roleId] }),
  });
}
export function useEffectivePermissions(userId?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "effective-summary", userId],
    queryFn: () => permissionService.effectiveSummary(userId as string),
    enabled: Boolean(userId),
  });
}
export function useCopyRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { sourceRoleId: string; targetRoleId: string }) => permissionService.copyRole(params.sourceRoleId, params.targetRoleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "role-permissions"] });
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "role-field-permissions"] });
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "role-scopes"] });
    },
  });
}

// ================= Sub-Category / Tab permissions (migration 0169) =================
export function usePermissionTabs(moduleCode?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "tabs", moduleCode],
    queryFn: () => permissionService.listTabs(moduleCode as string),
    enabled: Boolean(moduleCode),
  });
}
export function useRoleTabPermissions(roleId?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "role-tab-permissions", roleId],
    queryFn: () => permissionService.listRoleTabPermissions(roleId as string),
    enabled: Boolean(roleId),
  });
}
export function useSetRoleTabPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.setRoleTabPermission>[0]) => permissionService.setRoleTabPermission(params),
    onSuccess: (_d, params) => qc.invalidateQueries({ queryKey: [...PERM_KEY, "role-tab-permissions", params.roleId] }),
  });
}
export function useClearRoleTabPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.clearRoleTabPermission>[0]) => permissionService.clearRoleTabPermission(params),
    onSuccess: (_d, params) => qc.invalidateQueries({ queryKey: [...PERM_KEY, "role-tab-permissions", params.roleId] }),
  });
}
export function useUserTabOverrides(userId?: string) {
  return useQuery({
    queryKey: [...PERM_KEY, "user-tab-overrides", userId],
    queryFn: () => permissionService.listUserTabOverrides(userId as string),
    enabled: Boolean(userId),
  });
}
export function useSetUserTabOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.setUserTabOverride>[0]) => permissionService.setUserTabOverride(params),
    onSuccess: (_d, params) => {
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "user-tab-overrides", params.userId] });
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "effective-actions"] });
    },
  });
}
export function useClearUserTabOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof permissionService.clearUserTabOverride>[0]) => permissionService.clearUserTabOverride(params),
    onSuccess: (_d, params) => {
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "user-tab-overrides", params.userId] });
      qc.invalidateQueries({ queryKey: [...PERM_KEY, "effective-actions"] });
    },
  });
}
/** The Users tab's Effective/Source table — one call resolves the full
 *  User Tab Override -> Role Tab -> User Module Override -> Role Module -> default chain
 *  server-side (permission_effective_actions()), so the UI never re-implements priority logic. */
export function useEffectiveActions(userId?: string, moduleCode?: string, tabCode?: string | null) {
  return useQuery({
    queryKey: [...PERM_KEY, "effective-actions", userId, moduleCode, tabCode],
    queryFn: () => permissionService.effectiveActions(userId as string, moduleCode as string, tabCode),
    enabled: Boolean(userId && moduleCode),
  });
}
