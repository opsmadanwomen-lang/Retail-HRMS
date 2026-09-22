import { supabase } from "@/lib/supabaseClient";
import type { PerformanceEntryRow } from "@/types/database.types";
import type { PerformanceEntry, PerformanceEntryFilters, PerformanceEntryFormValues } from "@/types/performance";

const ENTRY_SELECT = `
  *,
  metric_master ( metric_name, metric_code, measurement_unit ),
  employees ( full_name ),
  stores ( name ),
  master_departments ( name ),
  roles ( role_name ),
  performance_data_sources ( label )
`;

type EntryJoinRow = PerformanceEntryRow & {
  metric_master: { metric_name: string; metric_code: string; measurement_unit: string } | null;
  employees: { full_name: string } | null;
  stores: { name: string } | null;
  master_departments: { name: string } | null;
  roles: { role_name: string } | null;
  performance_data_sources: { label: string } | null;
};

function mapRow(row: EntryJoinRow): PerformanceEntry {
  return {
    id: row.id,
    metricId: row.metric_id,
    metricName: row.metric_master?.metric_name,
    metricCode: row.metric_master?.metric_code,
    measurementUnit: row.metric_master?.measurement_unit,
    employeeId: row.employee_id,
    employeeName: row.employees?.full_name,
    storeId: row.store_id,
    storeName: row.stores?.name,
    departmentId: row.department_id,
    departmentName: row.master_departments?.name,
    roleId: row.role_id,
    roleName: row.roles?.role_name,
    sourceId: row.source_id,
    sourceLabel: row.performance_data_sources?.label,
    entryDate: row.entry_date,
    entryValue: Number(row.entry_value),
    remarks: row.remarks,
    status: row.status,
    isLocked: row.is_locked,
    createdAt: row.created_at,
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const performanceEntryService = {
  async list(filters: PerformanceEntryFilters = {}): Promise<PerformanceEntry[]> {
    let query = supabase.from("performance_entries").select(ENTRY_SELECT).order("entry_date", { ascending: false });

    if (filters.companyId) query = query.eq("company_id", filters.companyId);
    if (filters.storeId) query = query.eq("store_id", filters.storeId);
    if (filters.departmentId) query = query.eq("department_id", filters.departmentId);
    if (filters.roleId) query = query.eq("role_id", filters.roleId);
    if (filters.metricId) query = query.eq("metric_id", filters.metricId);
    if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.dateFrom) query = query.gte("entry_date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("entry_date", filters.dateTo);

    const { data, error } = await query;
    if (error) throw error;
    let results = (data ?? []).map((row) => mapRow(row as unknown as EntryJoinRow));

    if (filters.search) {
      const term = filters.search.trim().toLowerCase();
      results = results.filter(
        (e) =>
          e.employeeName?.toLowerCase().includes(term) ||
          e.storeName?.toLowerCase().includes(term) ||
          e.metricName?.toLowerCase().includes(term) ||
          e.roleName?.toLowerCase().includes(term)
      );
    }

    return results;
  },

  async getById(id: string): Promise<PerformanceEntry | null> {
    const { data, error } = await supabase.from("performance_entries").select(ENTRY_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as unknown as EntryJoinRow) : null;
  },

  /** "Prevent duplicate daily entry" for the same employee/metric/date. */
  async hasEntryForDate(metricId: string, entryDate: string, employeeId?: string, storeId?: string): Promise<boolean> {
    let query = supabase
      .from("performance_entries")
      .select("id", { count: "exact", head: true })
      .eq("metric_id", metricId)
      .eq("entry_date", entryDate);
    if (employeeId) query = query.eq("employee_id", employeeId);
    else if (storeId) query = query.eq("store_id", storeId).is("employee_id", null);
    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },

  /**
   * Creates a Daily Entry. Enforces: no duplicate entry for the same
   * employee/metric/date, and no future-dated entry.
   */
  async create(
    values: PerformanceEntryFormValues,
    companyId: string,
    sourceId: string | undefined,
    enteredBy?: string
  ): Promise<PerformanceEntry> {
    if (values.entryDate > todayIso()) {
      throw new Error("Entries cannot be dated in the future.");
    }
    const duplicate = await this.hasEntryForDate(values.metricId, values.entryDate, values.employeeId, values.storeId);
    if (duplicate) {
      throw new Error("An entry already exists for this employee/store, metric, and date.");
    }

    const { data, error } = await supabase
      .from("performance_entries")
      .insert({
        metric_id: values.metricId,
        employee_id: values.employeeId || null,
        store_id: values.storeId,
        department_id: values.departmentId || null,
        role_id: values.roleId || null,
        company_id: companyId,
        source_id: sourceId ?? null,
        entry_date: values.entryDate,
        entry_value: values.entryValue,
        remarks: values.remarks || null,
        entered_by: enteredBy ?? null,
        created_by: enteredBy ?? null,
        updated_by: enteredBy ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    const created = await this.getById(data.id);
    if (!created) throw new Error("Entry was created but could not be reloaded.");
    return created;
  },

  /** Bulk variant of create — one row per employee, same metric/date. Skips rows that fail validation. */
  async bulkCreate(params: {
    metricId: string;
    storeId: string;
    entryDate: string;
    companyId: string;
    sourceId?: string;
    enteredBy?: string;
    rows: Array<{ employeeId: string; entryValue: number }>;
  }): Promise<{ created: number; skipped: Array<{ employeeId: string; reason: string }> }> {
    let created = 0;
    const skipped: Array<{ employeeId: string; reason: string }> = [];

    for (const row of params.rows) {
      try {
        await this.create(
          {
            metricId: params.metricId,
            employeeId: row.employeeId,
            storeId: params.storeId,
            entryDate: params.entryDate,
            entryValue: row.entryValue,
          },
          params.companyId,
          params.sourceId,
          params.enteredBy
        );
        created += 1;
      } catch (err) {
        skipped.push({ employeeId: row.employeeId, reason: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    return { created, skipped };
  },

  /** "Prevent editing locked data." */
  async update(id: string, entryValue: number, remarks: string | undefined, userId?: string): Promise<PerformanceEntry> {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Entry not found.");
    if (existing.isLocked) throw new Error("This entry is locked and cannot be edited.");

    const { error } = await supabase
      .from("performance_entries")
      .update({ entry_value: entryValue, remarks: remarks || null, updated_by: userId ?? null })
      .eq("id", id);
    if (error) throw error;

    const updated = await this.getById(id);
    if (!updated) throw new Error("Entry was updated but could not be reloaded.");
    return updated;
  },

  async remove(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (existing?.isLocked) throw new Error("This entry is locked and cannot be deleted.");
    const { error } = await supabase.from("performance_entries").delete().eq("id", id);
    if (error) throw error;
  },
};
