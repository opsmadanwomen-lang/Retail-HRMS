import { supabase } from "@/lib/supabaseClient";
import type { RoleRow } from "@/types/database.types";
import type { Role, RoleFilters, RoleFormValues } from "@/types/role";

const ROLE_SELECT = `
  *,
  role_categories ( name ),
  master_departments ( name )
`;

type RoleJoinRow = RoleRow & {
  role_categories: { name: string } | null;
  master_departments: { name: string } | null;
};

function mapRow(row: RoleJoinRow): Role {
  return {
    id: row.id,
    companyId: row.company_id,
    roleName: row.role_name,
    roleCode: row.role_code,
    categoryId: row.category_id,
    categoryName: row.role_categories?.name,
    description: row.description,
    roleType: row.role_type,
    departmentId: row.department_id,
    departmentName: row.master_departments?.name,
    isSystemRole: row.is_system_role,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

export const roleService = {
  /**
   * Lists roles visible to the caller (system defaults + the caller's own
   * company's custom roles, enforced by RLS), with live assigned-employee
   * counts merged in — computed client-side from currently-open
   * employee_roles rows rather than a heavier SQL aggregate, matching the
   * pattern used by the Employee dashboard stats.
   */
  async list(filters: RoleFilters = {}): Promise<Role[]> {
    let query = supabase.from("roles").select(ROLE_SELECT).order("display_order");

    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    if (filters.departmentId) query = query.eq("department_id", filters.departmentId);
    if (filters.roleType) query = query.eq("role_type", filters.roleType);
    if (filters.isActive !== undefined) query = query.eq("is_active", filters.isActive);
    if (filters.search) {
      const term = filters.search.trim();
      query = query.or(`role_name.ilike.%${term}%,role_code.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const roles = (data ?? []).map((row) => mapRow(row as unknown as RoleJoinRow));

    let countsQuery = supabase.from("employee_roles").select("id, role_id, store_id").is("removed_at", null);
    if (filters.storeId) countsQuery = countsQuery.eq("store_id", filters.storeId);
    if (filters.employeeId) countsQuery = countsQuery.eq("employee_id", filters.employeeId);
    if (filters.companyId) countsQuery = countsQuery.eq("company_id", filters.companyId);

    const { data: openAssignments, error: countsError } = await countsQuery;
    if (countsError) throw countsError;

    const countByRole = new Map<string, number>();
    for (const row of (openAssignments ?? []) as Array<{ role_id: string }>) {
      countByRole.set(row.role_id, (countByRole.get(row.role_id) ?? 0) + 1);
    }

    let result = roles.map((role) => ({ ...role, assignedEmployeeCount: countByRole.get(role.id) ?? 0 }));

    // If filtering to roles held by a specific employee/store, only keep
    // roles that actually have an open assignment matching that scope.
    if (filters.employeeId || filters.storeId) {
      result = result.filter((role) => (role.assignedEmployeeCount ?? 0) > 0);
    }

    return result;
  },

  async getById(id: string): Promise<Role | null> {
    const { data, error } = await supabase.from("roles").select(ROLE_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as unknown as RoleJoinRow) : null;
  },

  async create(values: RoleFormValues, companyId: string | null, userId?: string): Promise<Role> {
    const { data, error } = await supabase
      .from("roles")
      .insert({
        company_id: companyId,
        role_name: values.roleName,
        role_code: values.roleCode,
        category_id: values.categoryId || null,
        description: values.description || null,
        role_type: values.roleType,
        department_id: values.departmentId || null,
        is_active: values.isActive,
        display_order: values.displayOrder ?? 0,
        is_system_role: companyId === null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    const created = await this.getById(data.id);
    if (!created) throw new Error("Role was created but could not be reloaded.");
    return created;
  },

  async update(id: string, values: Partial<RoleFormValues>, userId?: string): Promise<Role> {
    const patch: Record<string, unknown> = { updated_by: userId ?? null };
    if (values.roleName !== undefined) patch.role_name = values.roleName;
    if (values.roleCode !== undefined) patch.role_code = values.roleCode;
    if (values.categoryId !== undefined) patch.category_id = values.categoryId || null;
    if (values.description !== undefined) patch.description = values.description || null;
    if (values.roleType !== undefined) patch.role_type = values.roleType;
    if (values.departmentId !== undefined) patch.department_id = values.departmentId || null;
    if (values.isActive !== undefined) patch.is_active = values.isActive;
    if (values.displayOrder !== undefined) patch.display_order = values.displayOrder;

    const { error } = await supabase.from("roles").update(patch).eq("id", id);
    if (error) throw error;
    const updated = await this.getById(id);
    if (!updated) throw new Error("Role was updated but could not be reloaded.");
    return updated;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("roles").delete().eq("id", id);
    if (error) throw error;
  },

  async isCodeTaken(roleCode: string, companyId: string | null, excludeId?: string): Promise<boolean> {
    let query = supabase.from("roles").select("id", { count: "exact", head: true }).eq("role_code", roleCode);
    query = companyId === null ? query.is("company_id", null) : query.eq("company_id", companyId);
    if (excludeId) query = query.neq("id", excludeId);
    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};
