import type { RoleType } from "./database.types";

export type { RoleType };

export interface RoleCategory {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export interface RoleStatusOption {
  id: string;
  code: string;
  label: string;
  displayOrder: number;
}

export interface Role {
  id: string;
  companyId: string | null;
  roleName: string;
  roleCode: string;
  categoryId: string | null;
  categoryName?: string;
  description: string | null;
  roleType: RoleType;
  departmentId: string | null;
  departmentName?: string;
  isSystemRole: boolean;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;

  /** Populated by roleService.list() — number of currently-open assignments. */
  assignedEmployeeCount?: number;
}

export interface RoleFormValues {
  roleName: string;
  roleCode: string;
  categoryId?: string;
  description?: string;
  roleType: RoleType;
  departmentId?: string;
  isActive: boolean;
  displayOrder?: number;
}

export interface RoleFilters {
  companyId?: string;
  categoryId?: string;
  departmentId?: string;
  storeId?: string;
  roleType?: RoleType;
  isActive?: boolean;
  employeeId?: string;
  search?: string;
}

export interface EmployeeRole {
  id: string;
  employeeId: string;
  employeeName?: string;
  roleId: string;
  roleName?: string;
  categoryName?: string;
  storeId: string;
  storeName?: string;
  statusId: string;
  statusCode?: string;
  statusLabel?: string;
  effectiveDate: string;
  endDate: string | null;
  remarks: string | null;
  assignedBy: string | null;
  assignedByName?: string;
  assignedAt: string;
  removedBy: string | null;
  removedAt: string | null;
  reason: string | null;
}

export interface AssignRoleFormValues {
  roleId: string;
  statusId: string;
  effectiveDate: string;
  endDate?: string;
  remarks?: string;
}

export interface RemoveRoleFormValues {
  reason?: string;
}

export interface EmployeeRoleHistoryEntry {
  id: string;
  action: "assigned" | "removed" | "status_changed";
  roleName?: string;
  statusLabel?: string;
  assignedDate: string | null;
  removedDate: string | null;
  reason: string | null;
  createdAt: string;
}

export interface RoleDashboardStats {
  totalRoles: number;
  assignedRoles: number;
  unassignedRoles: number;
  temporaryRoles: number;
  permanentRoles: number;
  mostAssignedRoles: Array<{ roleId: string; roleName: string; count: number }>;
}
