import { supabase } from "@/lib/supabaseClient";
import type { ManagedUser, UserManagementRole } from "@/types/userManagement";

async function invoke<T>(action: "create" | "update" | "reset_password" | "set_active" | "relink_employee", body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("user-account", {
    body: { action, ...body },
  });

  if (error) {
    // supabase-js wraps non-2xx responses in a generic error; try to surface the function's own message.
    const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (context?.json) {
      try {
        const parsed = await context.json();
        if (parsed?.error) throw new Error(parsed.error);
      } catch {
        // fall through to the generic error below
      }
    }
    throw new Error(error.message || "The request could not be completed.");
  }

  if (data?.error) throw new Error(data.error);
  return data as T;
}

interface LinkedEmployeeInfo {
  id: string;
  employeeCode: string | null;
  storeName: string | null;
}

function mapRow(
  row: any,
  storeNameById: Map<string, string>,
  linkedEmployeeByAuthUserId: Map<string, LinkedEmployeeInfo>,
  omStoreIdsByEmployeeId: Map<string, string[]>,
  superManagerEmployeeIds: Set<string>
): ManagedUser {
  const storedRole = row.role as ManagedUser["storedRole"];
  const linkedEmployee = linkedEmployeeByAuthUserId.get(row.id);
  const linkedEmployeeId = linkedEmployee?.id;
  const omStoreIds = linkedEmployeeId ? omStoreIdsByEmployeeId.get(linkedEmployeeId) : undefined;
  const isSuperManager = linkedEmployeeId ? superManagerEmployeeIds.has(linkedEmployeeId) : false;

  let effectiveRole: UserManagementRole = storedRole;
  if (storedRole === "staff" && isSuperManager) {
    effectiveRole = "super_manager";
  } else if (storedRole === "staff" && omStoreIds && omStoreIds.length > 0) {
    effectiveRole = "operations_manager";
  }

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    storedRole,
    storeId: row.store_id ?? null,
    storeName: row.store_id ? storeNameById.get(row.store_id) ?? null : null,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password ?? false,
    createdAt: row.created_at,
    effectiveRole,
    operationsManagerStoreNames: (omStoreIds ?? []).map((id) => storeNameById.get(id) ?? "—"),
    linkedEmployeeId: linkedEmployeeId ?? null,
    linkedEmployeeCode: linkedEmployee?.employeeCode ?? null,
    linkedEmployeeStoreName: linkedEmployee?.storeName ?? null,
  };
}

export const userManagementService = {
  /**
   * Lists every user profile for the company, enriched with the Operations Manager / Super
   * Manager derived label AND the linked employee (id/code/store) it resolves back to via
   * employees.auth_user_id -- the master record every login must show clearly, per User
   * Management's "employee is the master record" design. Reuses the EXISTING employees /
   * attendance_operations_manager_assignments / attendance_super_managers tables purely as a
   * read -- never a second source of truth.
   */
  async list(companyId: string): Promise<ManagedUser[]> {
    const [profilesRes, storesRes, employeesRes, omRes, smRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
      supabase.from("stores").select("id, name").eq("company_id", companyId),
      supabase.from("employees").select("id, auth_user_id, employee_code, store_id").eq("company_id", companyId).not("auth_user_id", "is", null),
      supabase.from("attendance_operations_manager_assignments").select("employee_id, store_id").eq("company_id", companyId).eq("is_active", true),
      supabase.from("attendance_super_managers").select("employee_id").eq("company_id", companyId).eq("is_active", true),
    ]);

    if (profilesRes.error) throw profilesRes.error;
    if (storesRes.error) throw storesRes.error;
    if (employeesRes.error) throw employeesRes.error;
    if (omRes.error) throw omRes.error;
    if (smRes.error) throw smRes.error;

    const storeNameById = new Map((storesRes.data ?? []).map((s: any) => [s.id as string, s.name as string]));
    const linkedEmployeeByAuthUserId = new Map<string, LinkedEmployeeInfo>(
      (employeesRes.data ?? [])
        .filter((e: any) => e.auth_user_id)
        .map((e: any) => [
          e.auth_user_id as string,
          { id: e.id as string, employeeCode: e.employee_code ?? null, storeName: e.store_id ? storeNameById.get(e.store_id) ?? null : null },
        ])
    );
    const omStoreIdsByEmployeeId = new Map<string, string[]>();
    for (const row of omRes.data ?? []) {
      const list = omStoreIdsByEmployeeId.get(row.employee_id) ?? [];
      list.push(row.store_id);
      omStoreIdsByEmployeeId.set(row.employee_id, list);
    }
    const superManagerEmployeeIds = new Set((smRes.data ?? []).map((row: any) => row.employee_id as string));

    return (profilesRes.data ?? []).map((row: any) => mapRow(row, storeNameById, linkedEmployeeByAuthUserId, omStoreIdsByEmployeeId, superManagerEmployeeIds));
  },

  /** employeeId is mandatory -- Create User only ever grants an EXISTING employee a login. */
  createUser(params: { employeeId: string; email: string; password: string; role: UserManagementRole; storeId: string | null; isActive: boolean }): Promise<{ userId: string; employeeId: string }> {
    return invoke("create", params);
  },

  updateUser(params: { userId: string; fullName?: string; email?: string; role?: UserManagementRole; storeId?: string | null; isActive?: boolean }): Promise<{ ok: boolean; warning?: string }> {
    return invoke("update", params);
  },

  /** The ONLY way to change which employee a login is linked to after creation -- a controlled, audited relink, never a silent side-effect of Edit User. */
  relinkEmployee(params: { userId: string; employeeId: string }): Promise<{ ok: boolean; employeeId: string; previousEmployeeId: string | null }> {
    return invoke("relink_employee", params);
  },

  resetPassword(userId: string, password: string): Promise<{ ok: boolean }> {
    return invoke("reset_password", { userId, password });
  },

  setActive(userId: string, isActive: boolean): Promise<{ ok: boolean; isActive: boolean }> {
    return invoke("set_active", { userId, isActive });
  },
};
