import { supabase } from "@/lib/supabaseClient";

const WEEKLY_OFF_HISTORY = "employee_weekly_off_history";
const WEEKLY_OFF_OVERRIDES = "weekly_off_overrides";

export interface WeeklyOffPeriod {
  id: string;
  employeeId: string;
  weeklyOffDay: number; // 0=Sunday .. 6=Saturday
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  remark: string | null;
}

export interface WeeklyOffOverrideRecord {
  id: string;
  employeeId: string;
  originalOffDate: string;
  newOffDate: string;
  reason: string | null;
  approvedBy: string | null;
  createdAt: string;
}

function mapPeriod(row: any): WeeklyOffPeriod {
  return {
    id: row.id,
    employeeId: row.employee_id,
    weeklyOffDay: row.weekly_off_day,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isActive: row.is_active,
    remark: row.remark,
  };
}

function mapOverride(row: any): WeeklyOffOverrideRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    originalOffDate: row.original_off_date,
    newOffDate: row.new_off_date,
    reason: row.reason,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
  };
}

export const weeklyOffService = {
  /** Full weekly-off history for one employee, oldest first — never overwritten when the off day changes. */
  async getHistory(employeeId: string): Promise<WeeklyOffPeriod[]> {
    const { data, error } = await supabase
      .from(WEEKLY_OFF_HISTORY)
      .select("*")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapPeriod);
  },

  /** Full history for a set of employees, grouped — used wherever a date RANGE needs accurate
   *  resolution (a single "current" lookup isn't enough if the weekly off changed mid-range). */
  async getHistoryForEmployees(employeeIds: string[]): Promise<Map<string, WeeklyOffPeriod[]>> {
    const map = new Map<string, WeeklyOffPeriod[]>();
    if (employeeIds.length === 0) return map;
    const { data, error } = await supabase.from(WEEKLY_OFF_HISTORY).select("*").in("employee_id", employeeIds);
    if (error) throw error;
    for (const row of data ?? []) {
      const period = mapPeriod(row);
      const existing = map.get(period.employeeId) ?? [];
      existing.push(period);
      map.set(period.employeeId, existing);
    }
    return map;
  },

  async getOverridesForEmployees(employeeIds: string[]): Promise<Map<string, WeeklyOffOverrideRecord[]>> {
    const map = new Map<string, WeeklyOffOverrideRecord[]>();
    if (employeeIds.length === 0) return map;
    const { data, error } = await supabase.from(WEEKLY_OFF_OVERRIDES).select("*").in("employee_id", employeeIds);
    if (error) throw error;
    for (const row of data ?? []) {
      const record = mapOverride(row);
      const existing = map.get(record.employeeId) ?? [];
      existing.push(record);
      map.set(record.employeeId, existing);
    }
    return map;
  },

  /** Bulk lookup for a schedule table — one query instead of one-per-employee. */
  async getCurrentForEmployees(employeeIds: string[]): Promise<Map<string, WeeklyOffPeriod>> {
    if (employeeIds.length === 0) return new Map();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from(WEEKLY_OFF_HISTORY)
      .select("*")
      .in("employee_id", employeeIds)
      .eq("is_active", true)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order("effective_from", { ascending: false });
    if (error) throw error;

    const map = new Map<string, WeeklyOffPeriod>();
    for (const row of data ?? []) {
      if (!map.has(row.employee_id)) map.set(row.employee_id, mapPeriod(row));
    }
    return map;
  },

  /** The single period in effect right now (for "My Weekly Off" / schedule table display). */
  async getCurrent(employeeId: string): Promise<WeeklyOffPeriod | null> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from(WEEKLY_OFF_HISTORY)
      .select("*")
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPeriod(data) : null;
  },

  async getAllOverrides(employeeId: string): Promise<WeeklyOffOverrideRecord[]> {
    const { data, error } = await supabase
      .from(WEEKLY_OFF_OVERRIDES)
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapOverride);
  },

  /**
   * Assigns a new weekly off, effective from the given date. The previous active period (if any)
   * is closed with effective_to = the day before — never overwritten, never deleted, so any
   * attendance date under the old period keeps resolving to it.
   */
  async assign(params: {
    employeeId: string;
    companyId: string;
    weeklyOffDay: number;
    effectiveFrom: string;
    remark?: string;
    userId?: string;
  }): Promise<void> {
    const { employeeId, companyId, weeklyOffDay, effectiveFrom, remark, userId } = params;

    const { data: current } = await supabase
      .from(WEEKLY_OFF_HISTORY)
      .select("id, effective_from")
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .is("effective_to", null)
      .maybeSingle();

    if (current) {
      const dayBefore = new Date(effectiveFrom);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const effectiveTo = dayBefore.toISOString().slice(0, 10);
      await supabase.from(WEEKLY_OFF_HISTORY).update({ effective_to: effectiveTo, updated_by: userId ?? null }).eq("id", current.id);
    }

    const { error } = await supabase.from(WEEKLY_OFF_HISTORY).insert({
      company_id: companyId,
      employee_id: employeeId,
      weekly_off_day: weeklyOffDay,
      effective_from: effectiveFrom,
      effective_to: null,
      is_active: true,
      remark: remark ?? null,
      created_by: userId ?? null,
      updated_by: userId ?? null,
    });
    if (error) throw error;
  },

  async bulkAssign(params: {
    employeeIds: string[];
    companyId: string;
    weeklyOffDay: number;
    effectiveFrom: string;
    remark?: string;
    userId?: string;
  }): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;
    for (const employeeId of params.employeeIds) {
      try {
        await this.assign({ ...params, employeeId });
        updated += 1;
      } catch {
        failed += 1;
      }
    }
    return { updated, failed };
  },

  async createOverride(params: {
    employeeId: string;
    companyId: string;
    originalOffDate: string;
    newOffDate: string;
    reason?: string;
    approvedBy?: string;
    userId?: string;
  }): Promise<void> {
    const { employeeId, companyId, originalOffDate, newOffDate, reason, approvedBy, userId } = params;
    const { error } = await supabase.from(WEEKLY_OFF_OVERRIDES).insert({
      company_id: companyId,
      employee_id: employeeId,
      original_off_date: originalOffDate,
      new_off_date: newOffDate,
      reason: reason ?? null,
      approved_by: approvedBy ?? null,
      created_by: userId ?? null,
    });
    if (error) throw error;
  },

  async removeOverride(id: string): Promise<void> {
    const { error } = await supabase.from(WEEKLY_OFF_OVERRIDES).delete().eq("id", id);
    if (error) throw error;
  },
};
