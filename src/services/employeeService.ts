import { supabase } from "@/lib/supabaseClient";
import type { EmployeeRow } from "@/types/database.types";
import type { Employee, EmployeeFilters, EmployeeFormValues, EmployeeScope, EmployeeSummary } from "@/types/employee";
import { generateEmployeeCodeCandidate } from "@/lib/employeeCode";

const UNIQUE_VIOLATION = "23505";
const MAX_CODE_GENERATION_ATTEMPTS = 8;

const EMPLOYEE_SELECT = `*`;

type EmployeeJoinRow = EmployeeRow;

function mapRow(row: EmployeeJoinRow): Employee {
  return {
    id: row.id,
    companyId: row.company_id,
    storeId: row.store_id,
    employeeScope: row.employee_scope as EmployeeScope,
    storeTeamId: row.store_team_id,
    storeDepartmentId: row.store_department_id,
    storeDesignationId: row.store_designation_id,
    reportingManagerId: row.reporting_manager_id,
    employeeCode: row.employee_code,
    authUserId: row.auth_user_id,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    fullName: row.full_name,
    gender: row.gender,
    dateOfBirth: row.date_of_birth,
    bloodGroup: row.blood_group,
    mobile: row.mobile,
    alternateMobile: row.alternate_mobile,
    email: row.email,
    photoUrl: row.photo_url,
    joiningDate: row.joining_date,
    confirmationDate: row.confirmation_date,
    leavingDate: (row as Record<string, unknown>).leaving_date as string | null ?? null,
    exitReason: (row as Record<string, unknown>).exit_reason as string | null ?? null,
    exitStatus: (row as Record<string, unknown>).exit_status as string | null ?? null,
    gradeId: (row as Record<string, unknown>).grade_id as string | null ?? null,
    categoryId: (row as Record<string, unknown>).category_id as string | null ?? null,
    employmentType: row.employment_type,
    salaryType: row.salary_type,
    status: row.status,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storeName: null,
    teamName: null,
    departmentName: null,
    designationTitle: null,
    reportingManagerName: null,
  };
}

export const employeeService = {
  async list(filters: EmployeeFilters = {}): Promise<Employee[]> {
  let query = supabase
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .order("created_at", { ascending: false });

  if (filters.companyId) query = query.eq("company_id", filters.companyId);
  if (filters.storeId) query = query.eq("store_id", filters.storeId);
  if (filters.storeTeamId) query = query.eq("store_team_id", filters.storeTeamId);
  if (filters.storeDepartmentId) query = query.eq("store_department_id", filters.storeDepartmentId);
  if (filters.storeDesignationId) query = query.eq("store_designation_id", filters.storeDesignationId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.joiningFrom) query = query.gte("joining_date", filters.joiningFrom);
  if (filters.joiningTo) query = query.lte("joining_date", filters.joiningTo);

  if (filters.search) {
    const term = filters.search.trim();
    query = query.or(
      `full_name.ilike.%${term}%,employee_code.ilike.%${term}%,mobile.ilike.%${term}%,email.ilike.%${term}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  // Master Tables
  const [
  { data: stores },
  { data: departments },
  { data: designations },
  { data: _teams },
  { data: managers },
] = await Promise.all([
  supabase.from("stores").select("id,name"),
  supabase.from("store_departments").select("id,name"),
  supabase.from("store_designations").select("id,title"),
  supabase.from("store_teams").select("id,name"),
  supabase.from("employees").select("id,full_name"),
]);

  const storeMap = new Map((stores ?? []).map((x) => [x.id, x.name]));
  const departmentMap = new Map((departments ?? []).map((x) => [x.id, x.name]));
  const designationMap = new Map((designations ?? []).map((x) => [x.id, x.title]));
  const managerMap = new Map(
  (managers ?? []).map((x) => [x.id, x.full_name])
);

  return (data ?? []).map((row) => {
    const emp = mapRow(row as EmployeeJoinRow);

    emp.storeName = emp.storeId ? storeMap.get(emp.storeId) ?? null : null;
    emp.departmentName = emp.storeDepartmentId
      ? departmentMap.get(emp.storeDepartmentId) ?? null
      : null;

    emp.designationTitle = emp.storeDesignationId
      ? designationMap.get(emp.storeDesignationId) ?? null
      : null;

    emp.reportingManagerName = emp.reportingManagerId
      ? managerMap.get(emp.reportingManagerId) ?? null
      : null;

    return emp;
  });
},

  async getById(id: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const emp = mapRow(data as EmployeeJoinRow);

  const [
    { data: stores },
    { data: departments },
    { data: designations },
    { data: teams },
    { data: managers },
  ] = await Promise.all([
    supabase.from("stores").select("id,name"),
    supabase.from("store_departments").select("id,name"),
    supabase.from("store_designations").select("id,title"),
    supabase.from("store_teams").select("id,name"),
    supabase.from("employees").select("id,full_name"),
  ]);

  const storeMap = new Map(
    (stores ?? []).map((x: any) => [x.id, x.name])
  );

  const departmentMap = new Map(
    (departments ?? []).map((x: any) => [x.id, x.name])
  );

  const designationMap = new Map(
    (designations ?? []).map((x: any) => [x.id, x.title])
  );

  const teamMap = new Map(
    (teams ?? []).map((x: any) => [x.id, x.name])
  );

  const managerMap = new Map(
    (managers ?? []).map((x: any) => [x.id, x.full_name])
  );

  emp.storeName = storeMap.get(emp.storeId) ?? null;

  emp.departmentName = emp.storeDepartmentId
    ? departmentMap.get(emp.storeDepartmentId) ?? null
    : null;

  emp.designationTitle = emp.storeDesignationId
    ? designationMap.get(emp.storeDesignationId) ?? null
    : null;

  emp.teamName = emp.storeTeamId
  ? String(teamMap.get(emp.storeTeamId) ?? "")
  : null;

  emp.reportingManagerName = emp.reportingManagerId
    ? managerMap.get(emp.reportingManagerId) ?? null
    : null;

  return emp;
},

  /**
   * Lean bulk lookup by id — just name/code/store, no department/designation/manager joins.
   * Used to resolve Employee-scope rule assignments to a readable label without an N+1 fetch or
   * the heavier full-employee-list join used by list()/getById().
   */
  async getByIds(ids: string[]): Promise<Map<string, { fullName: string; employeeCode: string | null; storeName: string | null }>> {
    const map = new Map<string, { fullName: string; employeeCode: string | null; storeName: string | null }>();
    if (ids.length === 0) return map;

    const { data, error } = await supabase.from("employees").select("id, full_name, employee_code, store_id").in("id", ids);
    if (error) throw error;

    const storeIds = Array.from(new Set((data ?? []).map((row: any) => row.store_id).filter(Boolean)));
    const { data: stores } = storeIds.length
      ? await supabase.from("stores").select("id, name").in("id", storeIds)
      : { data: [] as { id: string; name: string }[] };
    const storeMap = new Map((stores ?? []).map((s: any) => [s.id, s.name]));

    for (const row of (data ?? []) as any[]) {
      map.set(row.id, { fullName: row.full_name, employeeCode: row.employee_code, storeName: storeMap.get(row.store_id) ?? null });
    }
    return map;
  },

  /**
   * Active employees eligible to be linked to a User Management login -- the "Employee *"
   * searchable dropdown on Create User / Relink Employee. Lean, single-purpose query (no
   * department/designation joins) since the picker only ever shows name/code/store/link-status.
   * Employees who already hold a login (auth_user_id set) are still returned -- the UI shows them
   * disabled with their existing login, rather than hiding them and leaving the admin wondering
   * where a person went — but callers must never let one be selected.
   */
  async listAssignable(companyId: string): Promise<
    Array<{ id: string; fullName: string; employeeCode: string | null; storeId: string | null; storeName: string | null; email: string | null; status: string; authUserId: string | null }>
  > {
    const { data, error } = await supabase
      .from("employees")
      .select("id, full_name, employee_code, store_id, email, status, auth_user_id")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("full_name");
    if (error) throw error;

    const storeIds = Array.from(new Set((data ?? []).map((row: any) => row.store_id).filter(Boolean)));
    const { data: stores } = storeIds.length
      ? await supabase.from("stores").select("id, name").in("id", storeIds)
      : { data: [] as { id: string; name: string }[] };
    const storeMap = new Map((stores ?? []).map((s: any) => [s.id, s.name]));

    return (data ?? []).map((row: any) => ({
      id: row.id,
      fullName: row.full_name,
      employeeCode: row.employee_code,
      storeId: row.store_id,
      storeName: row.store_id ? storeMap.get(row.store_id) ?? null : null,
      email: row.email,
      status: row.status,
      authUserId: row.auth_user_id,
    }));
  },

  /** Employees eligible to be picked as a Reporting Manager for a given store. */
  async listForStore(storeId: string): Promise<Array<{ id: string; fullName: string }>> {
    const { data, error } = await supabase
      .from("employees")
      .select("id, full_name")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .order("full_name");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, fullName: r.full_name }));
  },

  /** Employees whose reporting_manager_id points to this employee — the Reporting tab. */
  async listDirectReports(employeeId: string): Promise<EmployeeSummary[]> {
    const { data, error } = await supabase
      .from("employees")
      .select("id, full_name, employee_code, status, store_designations(title)")
      .eq("reporting_manager_id", employeeId)
      .order("full_name");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      fullName: r.full_name,
      employeeCode: r.employee_code,
      status: r.status,
      designationTitle: r.store_designations?.title,
    }));
  },

  /**
   * Creates an employee with an auto-generated Employee Code — STORE_CODE-XXXX-XXXX for Store
   * Specific employees (unchanged), or CW-XXXX-XXXX for Company Wide employees (storeId null) —
   * never derived from name/DOB/DOJ/mobile either way. The code is never taken from client input;
   * any `values.employeeCode` is ignored. Retries on a rare unique-index collision — the
   * database's GLOBAL unique index on employee_code (migration 0025, spans every company/store)
   * is the actual source of truth for uniqueness, this is just an optimistic pre-generation that
   * self-heals if two employees are created at once.
   */
  async create(companyId: string, storeId: string | null, values: EmployeeFormValues, userId?: string): Promise<Employee> {
    const fullName = [values.firstName, values.middleName, values.lastName].filter(Boolean).join(" ");

    let codePrefix = "CW";
    if (storeId) {
      const { data: store, error: storeError } = await supabase.from("stores").select("code").eq("id", storeId).single();
      if (storeError) throw storeError;
      codePrefix = store.code;
    }

    const basePayload = {
      company_id: companyId,
      store_id: storeId,
      employee_scope: values.employeeScope,
      store_designation_id: values.storeDesignationId || null,
      reporting_manager_id: values.reportingManagerId || null,
      first_name: values.firstName,
      middle_name: values.middleName || null,
      last_name: values.lastName,
      full_name: fullName,
      gender: values.gender || null,
      date_of_birth: values.dateOfBirth || null,
      blood_group: values.bloodGroup || null,
      mobile: values.mobile || null,
      alternate_mobile: values.alternateMobile || null,
      email: values.email || null,
      joining_date: values.joiningDate || null,
      confirmation_date: values.confirmationDate || null,
      leaving_date: values.leavingDate || null,
      exit_reason: values.exitReason || null,
      exit_status: values.exitStatus || null,
      grade_id: values.gradeId || null,
      category_id: values.categoryId || null,
      employment_type: values.employmentType || null,
      salary_type: values.salaryType || null,
      status: values.status,
      created_by: userId ?? null,
      updated_by: userId ?? null,
    };

    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const employeeCode = generateEmployeeCodeCandidate(codePrefix);
      const { data, error } = await supabase
        .from("employees")
        .insert({ ...basePayload, employee_code: employeeCode })
        .select("id")
        .single();

      if (!error) {
        const created = await this.getById(data.id);
        if (!created) throw new Error("Employee was created but could not be reloaded.");
        return created;
      }

      lastError = error;
      if (error.code !== UNIQUE_VIOLATION) throw error;
      // Unique violation on employee_code — regenerate and retry.
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Could not generate a unique Employee Code after several attempts. Please try again.");
  },

  async update(id: string, values: Partial<EmployeeFormValues>, userId?: string): Promise<Employee> {
    const patch: Record<string, unknown> = { updated_by: userId ?? null };

    if (values.storeDesignationId !== undefined) patch.store_designation_id = values.storeDesignationId;
    if (values.reportingManagerId !== undefined) patch.reporting_manager_id = values.reportingManagerId || null;
    if (values.employeeCode !== undefined) patch.employee_code = values.employeeCode || null;
    if (values.firstName !== undefined) patch.first_name = values.firstName;
    if (values.middleName !== undefined) patch.middle_name = values.middleName || null;
    if (values.lastName !== undefined) patch.last_name = values.lastName;
    if (values.firstName || values.middleName || values.lastName) {
      patch.full_name = [values.firstName, values.middleName, values.lastName].filter(Boolean).join(" ");
    }
    if (values.gender !== undefined) patch.gender = values.gender || null;
    if (values.dateOfBirth !== undefined) patch.date_of_birth = values.dateOfBirth || null;
    if (values.bloodGroup !== undefined) patch.blood_group = values.bloodGroup || null;
    if (values.mobile !== undefined) patch.mobile = values.mobile || null;
    if (values.alternateMobile !== undefined) patch.alternate_mobile = values.alternateMobile || null;
    if (values.email !== undefined) patch.email = values.email || null;
    if (values.joiningDate !== undefined) patch.joining_date = values.joiningDate || null;
    if (values.confirmationDate !== undefined) patch.confirmation_date = values.confirmationDate || null;
    if (values.leavingDate !== undefined) patch.leaving_date = values.leavingDate || null;
    if (values.exitReason !== undefined) patch.exit_reason = values.exitReason || null;
    if (values.exitStatus !== undefined) patch.exit_status = values.exitStatus || null;
    if (values.gradeId !== undefined) patch.grade_id = values.gradeId || null;
    if (values.categoryId !== undefined) patch.category_id = values.categoryId || null;
    if (values.employmentType !== undefined) patch.employment_type = values.employmentType || null;
    if (values.salaryType !== undefined) patch.salary_type = values.salaryType || null;
    if (values.status !== undefined) patch.status = values.status;

    const { error } = await supabase.from("employees").update(patch).eq("id", id);
    if (error) throw error;

    const updated = await this.getById(id);
    if (!updated) throw new Error("Employee was updated but could not be reloaded.");
    return updated;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) throw error;
  },

  async isCodeTaken(companyId: string, code: string, excludeId?: string): Promise<boolean> {
    if (!code) return false;
    let query = supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("employee_code", code);
    if (excludeId) query = query.neq("id", excludeId);
    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },

  async isEmailTaken(companyId: string, email: string, excludeId?: string): Promise<boolean> {
    if (!email) return false;
    let query = supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("email", email.toLowerCase());
    if (excludeId) query = query.neq("id", excludeId);
    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};
