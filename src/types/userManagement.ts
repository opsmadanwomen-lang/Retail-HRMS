/**
 * User Management (Settings -> User Management, Super Admin only). "Role" here is a richer,
 * UI-facing concept than the raw profiles.role column: "Operations Manager (SOM)" and "Super
 * Manager" are stored as profiles.role = 'staff' (see supabase/functions/user-account) with real
 * approval authority coming from the EXISTING attendance_operations_manager_assignments /
 * attendance_super_managers tables — never a second, parallel role system. `effectiveRole` below
 * is a pure, read-only label computed from those same tables, exactly like Header.tsx/Sidebar.tsx
 * already do for the signed-in user.
 */
export type UserManagementRole =
  | "super_admin"
  | "company_admin"
  | "operations_manager"
  | "super_manager"
  | "store_manager"
  | "department_manager"
  | "staff";

export const USER_MANAGEMENT_ROLE_LABELS: Record<UserManagementRole, string> = {
  super_admin: "Super Admin",
  company_admin: "Company Admin",
  operations_manager: "Operations Manager (SOM)",
  super_manager: "Super Manager",
  store_manager: "Store Manager",
  department_manager: "Department Manager",
  staff: "Staff",
};

/** Roles selectable in the Create/Edit User form, per this task's exact required role list. */
export const CREATABLE_ROLES: UserManagementRole[] = [
  "super_admin",
  "operations_manager",
  "super_manager",
  "store_manager",
  "department_manager",
  "staff",
];

export interface ManagedUser {
  id: string;
  fullName: string;
  email: string;
  /** The raw stored profiles.role value. */
  storedRole: "super_admin" | "company_admin" | "store_manager" | "department_manager" | "staff";
  /** null = All Stores. */
  storeId: string | null;
  storeName: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  /** The Role actually shown/selected in the UI -- storedRole enriched with the Operations
   *  Manager / Super Manager derived label when applicable. */
  effectiveRole: UserManagementRole;
  /** Non-empty only when effectiveRole === 'operations_manager'. */
  operationsManagerStoreNames: string[];
  /**
   * The employee (employees.id) this login is linked to via employees.auth_user_id -- the master
   * record. Null only for logins with no linked employee (legacy accounts, or a role that was
   * never bridged). Employee is never created/matched here -- see EmployeeSearchSelect /
   * "Relink Employee".
   */
  linkedEmployeeId: string | null;
  linkedEmployeeCode: string | null;
  linkedEmployeeStoreName: string | null;
}

/** A single searchable-dropdown option -- an existing employees row, never a free-text entry. */
export interface AssignableEmployee {
  id: string;
  fullName: string;
  employeeCode: string | null;
  storeId: string | null;
  storeName: string | null;
  email: string | null;
  status: string;
  /** Set when this employee already has a login -- shown disabled in the picker. */
  authUserId: string | null;
}
