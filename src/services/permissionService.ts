import { supabase } from "@/lib/supabaseClient";
import type {
  PermissionModule,
  PermissionAction,
  PermissionField,
  DynamicRole,
  RolePermission,
  RoleFieldPermission,
  UserPermissionOverride,
  PermissionAuditEntry,
  RoleModuleScope,
  EffectivePermissionRow,
  ScopeType,
  PermissionTab,
  RoleTabPermission,
  UserTabPermissionOverride,
  EffectiveActionRow,
} from "@/types/permission";

function mapModule(r: any): PermissionModule {
  return { id: r.id, code: r.code, label: r.label, category: r.category ?? null, displayOrder: Number(r.display_order), isActive: r.is_active };
}
function mapAction(r: any): PermissionAction {
  return { id: r.id, code: r.code, label: r.label, displayOrder: Number(r.display_order) };
}
function mapField(r: any): PermissionField {
  return { id: r.id, moduleCode: r.module_code, fieldCode: r.field_code, label: r.label, isSensitive: r.is_sensitive, displayOrder: Number(r.display_order) };
}
function mapRole(r: any): DynamicRole {
  return { id: r.id, companyId: r.company_id, code: r.code, name: r.name, description: r.description ?? null, isActive: r.is_active, displayOrder: r.display_order ?? 100 };
}
function mapRolePermission(r: any): RolePermission {
  return { id: r.id, dynamicRoleId: r.dynamic_role_id, moduleCode: r.module_code, actionCode: r.action_code, isAllowed: r.is_allowed };
}
function mapRoleFieldPermission(r: any): RoleFieldPermission {
  return { id: r.id, dynamicRoleId: r.dynamic_role_id, moduleCode: r.module_code, fieldCode: r.field_code, isAllowed: r.is_allowed };
}
function mapUserOverride(r: any): UserPermissionOverride {
  return { id: r.id, userId: r.user_id, moduleCode: r.module_code, actionCode: r.action_code, isAllowed: r.is_allowed };
}
function mapAudit(r: any): PermissionAuditEntry {
  return { id: r.id, tableName: r.table_name, recordId: r.record_id, action: r.action, changedData: r.changed_data, performedByName: r.performed_by_name ?? null, performedAt: r.performed_at };
}
function mapRoleScope(r: any): RoleModuleScope {
  return { id: r.id, dynamicRoleId: r.dynamic_role_id, moduleCode: r.module_code, scopeType: r.scope_type, storeIds: r.store_ids ?? null };
}
function mapEffectiveRow(r: any): EffectivePermissionRow {
  return {
    moduleCode: r.module_code,
    moduleLabel: r.module_label,
    access: Boolean(r.access),
    scopeType: r.scope_type,
    allowedActions: r.allowed_actions ?? [],
    deniedActions: r.denied_actions ?? [],
  };
}
function mapTab(r: any): PermissionTab {
  return { id: r.id, moduleCode: r.module_code, tabCode: r.tab_code, label: r.label, displayOrder: Number(r.display_order) };
}
function mapRoleTabPermission(r: any): RoleTabPermission {
  return { id: r.id, dynamicRoleId: r.dynamic_role_id, moduleCode: r.module_code, tabCode: r.tab_code, actionCode: r.action_code, isAllowed: r.is_allowed };
}
function mapUserTabOverride(r: any): UserTabPermissionOverride {
  return { id: r.id, userId: r.user_id, moduleCode: r.module_code, tabCode: r.tab_code, actionCode: r.action_code, isAllowed: r.is_allowed };
}
function mapEffectiveAction(r: any): EffectiveActionRow {
  return { actionCode: r.action_code, label: r.label, isAllowed: Boolean(r.is_allowed), source: r.source };
}

export const permissionService = {
  // ================= Catalogs (read) =================
  async listModules(): Promise<PermissionModule[]> {
    const { data, error } = await supabase.rpc("permission_list_modules");
    if (error) throw error;
    return (data ?? []).map(mapModule);
  },
  async listActions(): Promise<PermissionAction[]> {
    const { data, error } = await supabase.rpc("permission_list_actions");
    if (error) throw error;
    return (data ?? []).map(mapAction);
  },
  async listFields(moduleCode: string): Promise<PermissionField[]> {
    const { data, error } = await supabase.rpc("permission_list_fields", { p_module_code: moduleCode });
    if (error) throw error;
    return (data ?? []).map(mapField);
  },

  // ================= Roles =================
  async listRoles(companyId: string): Promise<DynamicRole[]> {
    const { data, error } = await supabase.rpc("permission_list_roles", { p_company_id: companyId });
    if (error) throw error;
    return (data ?? []).map(mapRole);
  },
  async createRole(params: { companyId: string; code: string; name: string; description?: string | null; displayOrder?: number }): Promise<DynamicRole> {
    const { data, error } = await supabase.rpc("permission_create_role", {
      p_company_id: params.companyId, p_code: params.code, p_name: params.name, p_description: params.description ?? undefined,
      p_display_order: params.displayOrder ?? undefined,
    });
    if (error) throw error;
    return mapRole(data);
  },
  async setRoleStatus(roleId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.rpc("permission_set_role_status", { p_role_id: roleId, p_is_active: isActive });
    if (error) throw error;
  },
  async updateRole(params: { roleId: string; name: string; description?: string | null; displayOrder?: number }): Promise<DynamicRole> {
    const { data, error } = await supabase.rpc("permission_update_role", {
      p_role_id: params.roleId, p_name: params.name, p_description: params.description ?? undefined, p_display_order: params.displayOrder ?? undefined,
    });
    if (error) throw error;
    return mapRole(data);
  },

  // ================= Role action permissions =================
  async listRolePermissions(roleId: string): Promise<RolePermission[]> {
    const { data, error } = await supabase.rpc("permission_list_role_permissions", { p_role_id: roleId });
    if (error) throw error;
    return (data ?? []).map(mapRolePermission);
  },
  async setRolePermission(params: { roleId: string; moduleCode: string; actionCode: string; isAllowed: boolean }): Promise<void> {
    const { error } = await supabase.rpc("permission_set_role_permission", {
      p_role_id: params.roleId, p_module_code: params.moduleCode, p_action_code: params.actionCode, p_is_allowed: params.isAllowed,
    });
    if (error) throw error;
  },
  async clearRolePermission(params: { roleId: string; moduleCode: string; actionCode: string }): Promise<void> {
    const { error } = await supabase.rpc("permission_clear_role_permission", { p_role_id: params.roleId, p_module_code: params.moduleCode, p_action_code: params.actionCode });
    if (error) throw error;
  },

  // ================= Role field permissions =================
  async listRoleFieldPermissions(roleId: string): Promise<RoleFieldPermission[]> {
    const { data, error } = await supabase.rpc("permission_list_role_field_permissions", { p_role_id: roleId });
    if (error) throw error;
    return (data ?? []).map(mapRoleFieldPermission);
  },
  async setRoleFieldPermission(params: { roleId: string; moduleCode: string; fieldCode: string; isAllowed: boolean }): Promise<void> {
    const { error } = await supabase.rpc("permission_set_role_field_permission", {
      p_role_id: params.roleId, p_module_code: params.moduleCode, p_field_code: params.fieldCode, p_is_allowed: params.isAllowed,
    });
    if (error) throw error;
  },

  // ================= User assignment + overrides =================
  async getUserDynamicRole(userId: string): Promise<{ dynamicRoleId: string; roleName: string } | null> {
    const { data, error } = await supabase.rpc("permission_get_user_role", { p_user_id: userId });
    if (error) throw error;
    const row: any = (data ?? [])[0];
    return row ? { dynamicRoleId: row.dynamic_role_id, roleName: row.role_name } : null;
  },
  async setUserDynamicRole(userId: string, roleId: string | null): Promise<void> {
    const { error } = await supabase.rpc("permission_set_user_dynamic_role", { p_user_id: userId, p_role_id: roleId ?? undefined });
    if (error) throw error;
  },
  async listUserOverrides(userId: string): Promise<UserPermissionOverride[]> {
    const { data, error } = await supabase.rpc("permission_list_user_overrides", { p_user_id: userId });
    if (error) throw error;
    return (data ?? []).map(mapUserOverride);
  },
  async setUserOverride(params: { userId: string; moduleCode: string; actionCode: string; isAllowed: boolean }): Promise<void> {
    const { error } = await supabase.rpc("permission_set_user_override", {
      p_user_id: params.userId, p_module_code: params.moduleCode, p_action_code: params.actionCode, p_is_allowed: params.isAllowed,
    });
    if (error) throw error;
  },
  async clearUserOverride(params: { userId: string; moduleCode: string; actionCode: string }): Promise<void> {
    const { error } = await supabase.rpc("permission_clear_user_override", { p_user_id: params.userId, p_module_code: params.moduleCode, p_action_code: params.actionCode });
    if (error) throw error;
  },
  async setUserFieldOverride(params: { userId: string; moduleCode: string; fieldCode: string; isAllowed: boolean }): Promise<void> {
    const { error } = await supabase.rpc("permission_set_user_field_override", {
      p_user_id: params.userId, p_module_code: params.moduleCode, p_field_code: params.fieldCode, p_is_allowed: params.isAllowed,
    });
    if (error) throw error;
  },

  // ================= Effective-permission checks (what the app actually consults) =================
  async myPermission(moduleCode: string, actionCode: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("my_dynamic_permission", { p_module_code: moduleCode, p_action_code: actionCode });
    if (error) throw error;
    return Boolean(data);
  },
  async myFieldPermission(moduleCode: string, fieldCode: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("my_field_permission", { p_module_code: moduleCode, p_field_code: fieldCode });
    if (error) throw error;
    return Boolean(data);
  },
  /** Self-check against the tab dimension (migration 0169), falling back to module-level when no
   *  tab-specific config exists — the same chain has_dynamic_tab_permission() resolves server-side. */
  async myTabPermission(moduleCode: string, tabCode: string, actionCode: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("my_dynamic_tab_permission", { p_module_code: moduleCode, p_tab_code: tabCode, p_action_code: actionCode });
    if (error) throw error;
    return Boolean(data);
  },
  async myPermissionsBulk(moduleCodes?: string[]): Promise<Record<string, Record<string, boolean>>> {
    const { data, error } = await supabase.rpc("my_permissions_bulk", { p_module_codes: moduleCodes ?? undefined });
    if (error) throw error;
    const result: Record<string, Record<string, boolean>> = {};
    for (const row of data ?? []) {
      const r: any = row;
      (result[r.module_code] ??= {})[r.action_code] = Boolean(r.is_allowed);
    }
    return result;
  },

  // ================= Audit =================
  async auditHistory(limit = 100): Promise<PermissionAuditEntry[]> {
    const { data, error } = await supabase.rpc("permission_audit_history", { p_limit: limit });
    if (error) throw error;
    return (data ?? []).map(mapAudit);
  },

  // ================= Scope (migration 0164) =================
  async listRoleScopes(roleId: string): Promise<RoleModuleScope[]> {
    const { data, error } = await supabase.rpc("permission_list_role_scopes", { p_role_id: roleId });
    if (error) throw error;
    return (data ?? []).map(mapRoleScope);
  },
  async setRoleScope(params: { roleId: string; moduleCode: string; scopeType: ScopeType; storeIds?: string[] | null }): Promise<void> {
    const { error } = await supabase.rpc("permission_set_role_scope", {
      p_role_id: params.roleId, p_module_code: params.moduleCode, p_scope_type: params.scopeType, p_store_ids: params.storeIds ?? undefined,
    });
    if (error) throw error;
  },

  // ================= Effective permissions + bulk role ops (migration 0164) =================
  async effectiveSummary(userId: string): Promise<EffectivePermissionRow[]> {
    const { data, error } = await supabase.rpc("permission_effective_summary", { p_user_id: userId });
    if (error) throw error;
    return (data ?? []).map(mapEffectiveRow);
  },
  async copyRole(sourceRoleId: string, targetRoleId: string): Promise<void> {
    const { error } = await supabase.rpc("permission_copy_role", { p_source_role_id: sourceRoleId, p_target_role_id: targetRoleId });
    if (error) throw error;
  },

  // ================= Sub-Category / Tab permissions (migration 0169) =================
  async listTabs(moduleCode: string): Promise<PermissionTab[]> {
    const { data, error } = await supabase.rpc("permission_list_tabs", { p_module_code: moduleCode });
    if (error) throw error;
    return (data ?? []).map(mapTab);
  },
  async listRoleTabPermissions(roleId: string): Promise<RoleTabPermission[]> {
    const { data, error } = await supabase.rpc("permission_list_role_tab_permissions", { p_role_id: roleId });
    if (error) throw error;
    return (data ?? []).map(mapRoleTabPermission);
  },
  async setRoleTabPermission(params: { roleId: string; moduleCode: string; tabCode: string; actionCode: string; isAllowed: boolean }): Promise<void> {
    const { error } = await supabase.rpc("permission_set_role_tab_permission", {
      p_role_id: params.roleId, p_module_code: params.moduleCode, p_tab_code: params.tabCode, p_action_code: params.actionCode, p_is_allowed: params.isAllowed,
    });
    if (error) throw error;
  },
  async clearRoleTabPermission(params: { roleId: string; moduleCode: string; tabCode: string; actionCode: string }): Promise<void> {
    const { error } = await supabase.rpc("permission_clear_role_tab_permission", {
      p_role_id: params.roleId, p_module_code: params.moduleCode, p_tab_code: params.tabCode, p_action_code: params.actionCode,
    });
    if (error) throw error;
  },
  async listUserTabOverrides(userId: string): Promise<UserTabPermissionOverride[]> {
    const { data, error } = await supabase.rpc("permission_list_user_tab_overrides", { p_user_id: userId });
    if (error) throw error;
    return (data ?? []).map(mapUserTabOverride);
  },
  async setUserTabOverride(params: { userId: string; moduleCode: string; tabCode: string; actionCode: string; isAllowed: boolean }): Promise<void> {
    const { error } = await supabase.rpc("permission_set_user_tab_override", {
      p_user_id: params.userId, p_module_code: params.moduleCode, p_tab_code: params.tabCode, p_action_code: params.actionCode, p_is_allowed: params.isAllowed,
    });
    if (error) throw error;
  },
  async clearUserTabOverride(params: { userId: string; moduleCode: string; tabCode: string; actionCode: string }): Promise<void> {
    const { error } = await supabase.rpc("permission_clear_user_tab_override", {
      p_user_id: params.userId, p_module_code: params.moduleCode, p_tab_code: params.tabCode, p_action_code: params.actionCode,
    });
    if (error) throw error;
  },
  /** The single authoritative resolution (User Tab Override -> Role Tab -> User Module Override ->
   *  Role Module -> default) for the Users tab's Effective/Source display. Pass tabCode=null to
   *  resolve at module level only. */
  async effectiveActions(userId: string, moduleCode: string, tabCode?: string | null): Promise<EffectiveActionRow[]> {
    const { data, error } = await supabase.rpc("permission_effective_actions", { p_user_id: userId, p_module_code: moduleCode, p_tab_code: tabCode ?? undefined });
    if (error) throw error;
    return (data ?? []).map(mapEffectiveAction);
  },
};
