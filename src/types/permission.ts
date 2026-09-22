// ============================================================================
// Dynamic Role & Permission System (migration 0161) — an ADDITIVE fine-grained
// layer on top of the existing profiles.role / roster-table authorization.
// Nothing here replaces the existing auth model; see the migration header for
// the full rationale. Every check defaults to ALLOW when unconfigured
// (fail-open), so applying this never changes existing behavior by itself —
// only explicit Super Admin configuration does.
// ============================================================================

export interface PermissionModule {
  id: string;
  code: string;
  label: string;
  category: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface PermissionAction {
  id: string;
  code: string;
  label: string;
  displayOrder: number;
}

export interface PermissionField {
  id: string;
  moduleCode: string;
  fieldCode: string;
  label: string;
  isSensitive: boolean;
  displayOrder: number;
}

export interface DynamicRole {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** Migration 0172 — pure display ordering for role dropdowns/lists; never a permission input. */
  displayOrder: number;
}

export interface RolePermission {
  id: string;
  dynamicRoleId: string;
  moduleCode: string;
  actionCode: string;
  isAllowed: boolean;
}

export interface RoleFieldPermission {
  id: string;
  dynamicRoleId: string;
  moduleCode: string;
  fieldCode: string;
  isAllowed: boolean;
}

export interface UserPermissionOverride {
  id: string;
  userId: string;
  moduleCode: string;
  actionCode: string;
  isAllowed: boolean;
}

export interface UserFieldPermissionOverride {
  id: string;
  userId: string;
  moduleCode: string;
  fieldCode: string;
  isAllowed: boolean;
}

export interface PermissionAuditEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: "insert" | "update" | "delete";
  changedData: unknown;
  performedByName: string | null;
  performedAt: string;
}

// ============================================================================
// Production-ready scope + effective-permission additions (migration 0164).
// 'team'/'custom' are accepted values but not yet enforced beyond
// company-wide scope by has_dynamic_scope_access() — see that function's own
// comment. Every other scope type is genuinely enforced server-side.
// ============================================================================
export type ScopeType = "company" | "store" | "multi_store" | "department" | "own" | "reporting" | "team" | "custom";

export interface RoleModuleScope {
  id: string;
  dynamicRoleId: string;
  moduleCode: string;
  scopeType: ScopeType;
  storeIds: string[] | null;
}

/** One row per module for permission_effective_summary() — the Users tab's read-only
 *  "Effective Permissions" view for an arbitrary target user. */
export interface EffectivePermissionRow {
  moduleCode: string;
  moduleLabel: string;
  access: boolean;
  scopeType: ScopeType;
  allowedActions: string[];
  deniedActions: string[];
}

// ============================================================================
// Sub-Category / Tab dimension (migration 0169) — Module -> Tab -> Action, one
// level deeper than the module-level tables above. Absence of a tab-level row
// falls back to the existing module-level resolution (has_dynamic_permission),
// never a new default.
// ============================================================================
export interface PermissionTab {
  id: string;
  moduleCode: string;
  tabCode: string;
  label: string;
  displayOrder: number;
}

export interface RoleTabPermission {
  id: string;
  dynamicRoleId: string;
  moduleCode: string;
  tabCode: string;
  actionCode: string;
  isAllowed: boolean;
}

export interface UserTabPermissionOverride {
  id: string;
  userId: string;
  moduleCode: string;
  tabCode: string;
  actionCode: string;
  isAllowed: boolean;
}

/** One action row from permission_effective_actions() — the Users tab's Effective/Source table. */
/** Migration 0173 — "role_inactive" is a DENY caused by the user's assigned role having been
 *  deactivated, distinct from "default" (nothing configured at all) so the Effective/Source view
 *  never mislabels a security-relevant denial as an ordinary unconfigured default. */
export type PermissionSource = "super_admin" | "user_tab_override" | "role_tab" | "user_module_override" | "role_inactive" | "role_module" | "default";

export interface EffectiveActionRow {
  actionCode: string;
  label: string;
  isAllowed: boolean;
  source: PermissionSource;
}
