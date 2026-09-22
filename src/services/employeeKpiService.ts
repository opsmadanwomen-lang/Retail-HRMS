import { supabase } from "@/lib/supabaseClient";
import type { EmployeeKpiAssignmentRow, KpiActualRow, KpiTargetRow } from "@/types/database.types";
import type {
  EmployeeKpiAssignment,
  KpiActualEntry,
  KpiActualFormValues,
  KpiTarget,
  KpiTargetFormValues,
} from "@/types/kpi";

const ASSIGNMENT_SELECT = `
  *,
  kpi_master ( kpi_name, kpi_code, kpi_categories ( name ) ),
  roles ( role_name )
`;

type AssignmentJoinRow = EmployeeKpiAssignmentRow & {
  kpi_master: { kpi_name: string; kpi_code: string; kpi_categories: { name: string } | null } | null;
  roles: { role_name: string } | null;
};

function mapAssignmentRow(row: AssignmentJoinRow): EmployeeKpiAssignment {
  return {
    id: row.id,
    employeeId: row.employee_id,
    kpiId: row.kpi_id,
    kpiName: row.kpi_master?.kpi_name,
    kpiCode: row.kpi_master?.kpi_code,
    categoryName: row.kpi_master?.kpi_categories?.name,
    roleId: row.role_id,
    roleName: row.roles?.role_name,
    storeId: row.store_id,
    source: row.source,
    isActive: row.is_active,
    assignedAt: row.assigned_at,
  };
}

function mapTargetRow(row: KpiTargetRow): KpiTarget {
  return {
    id: row.id,
    kpiId: row.kpi_id,
    storeId: row.store_id,
    departmentId: row.department_id,
    roleId: row.role_id,
    employeeId: row.employee_id,
    targetValue: Number(row.target_value),
    effectiveDate: row.effective_date,
    expiryDate: row.expiry_date,
    isActive: row.is_active,
  };
}

function mapActualRow(row: KpiActualRow): KpiActualEntry {
  return {
    id: row.id,
    kpiId: row.kpi_id,
    employeeId: row.employee_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    actualValue: Number(row.actual_value),
    dataSource: row.data_source,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export const employeeKpiService = {
  async listForEmployee(employeeId: string): Promise<EmployeeKpiAssignment[]> {
    const { data, error } = await supabase
      .from("employee_kpi_assignment")
      .select(ASSIGNMENT_SELECT)
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .order("assigned_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapAssignmentRow(row as unknown as AssignmentJoinRow));
  },

  async hasActiveAssignment(employeeId: string, kpiId: string): Promise<boolean> {
    const { count, error } = await supabase
      .from("employee_kpi_assignment")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", employeeId)
      .eq("kpi_id", kpiId)
      .eq("is_active", true);
    if (error) throw error;
    return (count ?? 0) > 0;
  },

  async assign(params: {
    employeeId: string;
    kpiId: string;
    roleId: string | null;
    storeId: string;
    companyId: string;
    source?: "role" | "manual";
    assignedBy?: string;
  }): Promise<EmployeeKpiAssignment> {
    const alreadyActive = await this.hasActiveAssignment(params.employeeId, params.kpiId);
    if (alreadyActive) throw new Error("This KPI is already assigned to this employee.");

    const { data: kpi, error: kpiError } = await supabase
      .from("kpi_master")
      .select("id, is_active")
      .eq("id", params.kpiId)
      .maybeSingle();
    if (kpiError) throw kpiError;
    if (!kpi) throw new Error("KPI not found.");
    if (!kpi.is_active) throw new Error("This KPI is inactive and cannot be assigned.");

    const { data, error } = await supabase
      .from("employee_kpi_assignment")
      .insert({
        employee_id: params.employeeId,
        kpi_id: params.kpiId,
        role_id: params.roleId,
        store_id: params.storeId,
        company_id: params.companyId,
        source: params.source ?? "manual",
        assigned_by: params.assignedBy ?? null,
        created_by: params.assignedBy ?? null,
        updated_by: params.assignedBy ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: created, error: fetchError } = await supabase
      .from("employee_kpi_assignment")
      .select(ASSIGNMENT_SELECT)
      .eq("id", data.id)
      .single();
    if (fetchError) throw fetchError;
    return mapAssignmentRow(created as unknown as AssignmentJoinRow);
  },

  async removeAssignment(assignmentId: string): Promise<void> {
    const { error } = await supabase.from("employee_kpi_assignment").update({ is_active: false }).eq("id", assignmentId);
    if (error) throw error;
  },

  /**
   * Syncs every KPI mapped to a role (via role_kpi_mapping) onto an
   * employee who holds that role — either their Primary Designation's
   * role-equivalent or an Additional Role from the Role Management
   * module. Skips KPIs already actively assigned. Returns how many were
   * newly created.
   */
  async syncFromRole(params: {
    employeeId: string;
    roleId: string;
    storeId: string;
    companyId: string;
    assignedBy?: string;
  }): Promise<number> {
    const { data: mappings, error } = await supabase
      .from("role_kpi_mapping")
      .select("kpi_id")
      .eq("role_id", params.roleId)
      .eq("is_active", true);
    if (error) throw error;

    let created = 0;
    for (const mapping of (mappings ?? []) as Array<{ kpi_id: string }>) {
      const alreadyActive = await this.hasActiveAssignment(params.employeeId, mapping.kpi_id);
      if (alreadyActive) continue;
      await this.assign({
        employeeId: params.employeeId,
        kpiId: mapping.kpi_id,
        roleId: params.roleId,
        storeId: params.storeId,
        companyId: params.companyId,
        source: "role",
        assignedBy: params.assignedBy,
      });
      created += 1;
    }
    return created;
  },

  // -- KPI Target -------------------------------------------------------------

  async getLatestTargetForEmployee(kpiId: string, employeeId: string): Promise<KpiTarget | null> {
    const { data, error } = await supabase
      .from("kpi_target")
      .select("*")
      .eq("kpi_id", kpiId)
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTargetRow(data) : null;
  },

  async setEmployeeTarget(params: {
    kpiId: string;
    employeeId: string;
    storeId: string;
    companyId: string;
    values: KpiTargetFormValues;
    userId?: string;
  }): Promise<KpiTarget> {
    await supabase
      .from("kpi_target")
      .update({ is_active: false, expiry_date: new Date().toISOString().slice(0, 10) })
      .eq("kpi_id", params.kpiId)
      .eq("employee_id", params.employeeId)
      .eq("is_active", true);

    const { data, error } = await supabase
      .from("kpi_target")
      .insert({
        kpi_id: params.kpiId,
        employee_id: params.employeeId,
        store_id: params.storeId,
        company_id: params.companyId,
        target_value: params.values.targetValue,
        effective_date: params.values.effectiveDate,
        expiry_date: params.values.expiryDate || null,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapTargetRow(data);
  },

  // -- KPI Actual -------------------------------------------------------------

  async listActualsForEmployee(kpiId: string, employeeId: string): Promise<KpiActualEntry[]> {
    const { data, error } = await supabase
      .from("kpi_actual")
      .select("*")
      .eq("kpi_id", kpiId)
      .eq("employee_id", employeeId)
      .order("period_start", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapActualRow);
  },

  async logActual(params: {
    kpiId: string;
    employeeId: string;
    storeId: string;
    companyId: string;
    values: KpiActualFormValues;
    enteredBy?: string;
  }): Promise<KpiActualEntry> {
    const { data, error } = await supabase
      .from("kpi_actual")
      .insert({
        kpi_id: params.kpiId,
        employee_id: params.employeeId,
        store_id: params.storeId,
        company_id: params.companyId,
        period_start: params.values.periodStart,
        period_end: params.values.periodEnd,
        actual_value: params.values.actualValue,
        notes: params.values.notes || null,
        entered_by: params.enteredBy ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapActualRow(data);
  },
};
