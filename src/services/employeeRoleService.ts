import { supabase } from "@/lib/supabaseClient";
import type { EmployeeRoleHistoryRow, EmployeeRoleRow } from "@/types/database.types";
import type { AssignRoleFormValues, EmployeeRole, EmployeeRoleHistoryEntry } from "@/types/role";
import { roleStatusService } from "@/services/roleStatusService";

const EMPLOYEE_ROLE_SELECT = `
  *,
  employees ( full_name ),
  roles ( role_name, role_categories ( name ) ),
  stores ( name ),
  role_status ( code, label ),
  assigned_by_profile:profiles!employee_roles_assigned_by_fkey ( full_name )
`;

type EmployeeRoleJoinRow = EmployeeRoleRow & {
  employees: { full_name: string } | null;
  roles: { role_name: string; role_categories: { name: string } | null } | null;
  stores: { name: string } | null;
  role_status: { code: string; label: string } | null;
  assigned_by_profile: { full_name: string } | null;
};

function mapRow(row: EmployeeRoleJoinRow): EmployeeRole {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employees?.full_name,
    roleId: row.role_id,
    roleName: row.roles?.role_name,
    categoryName: row.roles?.role_categories?.name,
    storeId: row.store_id,
    storeName: row.stores?.name,
    statusId: row.status_id,
    statusCode: row.role_status?.code,
    statusLabel: row.role_status?.label,
    effectiveDate: row.effective_date,
    endDate: row.end_date,
    remarks: row.remarks,
    assignedBy: row.assigned_by,
    assignedByName: row.assigned_by_profile?.full_name,
    assignedAt: row.assigned_at,
    removedBy: row.removed_by,
    removedAt: row.removed_at,
    reason: row.reason,
  };
}

function mapHistoryRow(row: EmployeeRoleHistoryRow & { roles: { role_name: string } | null; role_status: { label: string } | null }): EmployeeRoleHistoryEntry {
  return {
    id: row.id,
    action: row.action as EmployeeRoleHistoryEntry["action"],
    roleName: row.roles?.role_name,
    statusLabel: row.role_status?.label,
    assignedDate: row.assigned_date,
    removedDate: row.removed_date,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export const employeeRoleService = {
  /** All additional-role assignments for an employee, current + past. */
  async listForEmployee(employeeId: string): Promise<EmployeeRole[]> {
    const { data, error } = await supabase
      .from("employee_roles")
      .select(EMPLOYEE_ROLE_SELECT)
      .eq("employee_id", employeeId)
      .order("assigned_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as EmployeeRoleJoinRow));
  },

  /** Only the currently-open (not-yet-removed) assignments for an employee. */
  async listActiveForEmployee(employeeId: string): Promise<EmployeeRole[]> {
    const { data, error } = await supabase
      .from("employee_roles")
      .select(EMPLOYEE_ROLE_SELECT)
      .eq("employee_id", employeeId)
      .is("removed_at", null)
      .order("assigned_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as EmployeeRoleJoinRow));
  },

  async listForRole(roleId: string): Promise<EmployeeRole[]> {
    const { data, error } = await supabase
      .from("employee_roles")
      .select(EMPLOYEE_ROLE_SELECT)
      .eq("role_id", roleId)
      .is("removed_at", null)
      .order("assigned_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as EmployeeRoleJoinRow));
  },

  async historyForEmployee(employeeId: string): Promise<EmployeeRoleHistoryEntry[]> {
    const { data, error } = await supabase
      .from("employee_role_history")
      .select("*, roles ( role_name ), role_status ( label )")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapHistoryRow(row as any));
  },

  /** True if this employee already holds this role in an open (non-removed) assignment. */
  async hasActiveAssignment(employeeId: string, roleId: string): Promise<boolean> {
    const { count, error } = await supabase
      .from("employee_roles")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", employeeId)
      .eq("role_id", roleId)
      .is("removed_at", null);
    if (error) throw error;
    return (count ?? 0) > 0;
  },

  /**
   * Assigns an Additional Role to an employee. Rejects duplicate active
   * assignments of the same role (also enforced at the database level by
   * a partial unique index) and rejects assigning an inactive role.
   */
  async assign(params: {
    employeeId: string;
    storeId: string;
    companyId: string;
    values: AssignRoleFormValues;
    assignedBy?: string;
  }): Promise<EmployeeRole> {
    const { employeeId, storeId, companyId, values, assignedBy } = params;

    const alreadyActive = await this.hasActiveAssignment(employeeId, values.roleId);
    if (alreadyActive) {
      throw new Error("This employee already has an active assignment for this role.");
    }

    const { data: role, error: roleError } = await supabase
      .from("roles")
      .select("id, is_active")
      .eq("id", values.roleId)
      .maybeSingle();
    if (roleError) throw roleError;
    if (!role) throw new Error("Role not found.");
    if (!role.is_active) throw new Error("This role is inactive and cannot be assigned.");

    const { data, error } = await supabase
      .from("employee_roles")
      .insert({
        employee_id: employeeId,
        role_id: values.roleId,
        store_id: storeId,
        company_id: companyId,
        status_id: values.statusId,
        effective_date: values.effectiveDate,
        end_date: values.endDate || null,
        remarks: values.remarks || null,
        assigned_by: assignedBy ?? null,
        created_by: assignedBy ?? null,
        updated_by: assignedBy ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: created, error: fetchError } = await supabase
      .from("employee_roles")
      .select(EMPLOYEE_ROLE_SELECT)
      .eq("id", data.id)
      .single();
    if (fetchError) throw fetchError;
    return mapRow(created as unknown as EmployeeRoleJoinRow);
  },

  /** Removes (ends) an assignment and records who removed it and why. */
  async remove(employeeRoleId: string, reason: string | undefined, removedBy?: string): Promise<void> {
    const statuses = await roleStatusService.list();
    const inactiveStatus = statuses.find((s) => s.code === "inactive");

    const { error } = await supabase
      .from("employee_roles")
      .update({
        removed_at: new Date().toISOString(),
        removed_by: removedBy ?? null,
        end_date: new Date().toISOString().slice(0, 10),
        reason: reason || null,
        status_id: inactiveStatus?.id,
        updated_by: removedBy ?? null,
      })
      .eq("id", employeeRoleId);
    if (error) throw error;
  },
};
