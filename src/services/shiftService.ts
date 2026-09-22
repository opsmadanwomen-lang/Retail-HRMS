import { supabase } from "@/lib/supabaseClient";
import type { AttendanceShift, EmployeeShiftAssignment } from "@/types/attendance";

const SHIFTS = "attendance_shifts";
const SHIFT_STORES = "attendance_shift_stores";
const SHIFT_ASSIGNMENTS = "employee_shift_assignments";

/**
 * A Shift now defines ONLY scheduled timing + eligibility flags — Break Duration, Grace Period,
 * and Required Working Hours are no longer part of Create/Edit Shift (see AttendanceShift's own
 * doc comment for why breakMinutes still exists server-side but is absent here).
 */
export interface ShiftFormValues {
  name: string;
  shiftCode: string;
  startTime: string;
  endTime: string;
  lateEligible: boolean;
  overtimeEnabled: boolean;
  description?: string;
  isActive: boolean;
  storeIds: string[];
}

function mapShift(row: any): AttendanceShift {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    shiftCode: row.shift_code ?? null,
    startTime: row.start_time,
    endTime: row.end_time,
    breakMinutes: row.break_minutes ?? 0,
    lateEligible: row.late_eligible ?? true,
    overtimeEnabled: row.overtime_enabled,
    description: row.description ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssignment(row: any): EmployeeShiftAssignment {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    shiftId: row.shift_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isActive: row.is_active,
    remark: row.remark ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const shiftService = {
  async list(companyId: string): Promise<AttendanceShift[]> {
    const { data, error } = await supabase.from(SHIFTS).select("*").eq("company_id", companyId).order("name");
    if (error) throw error;
    return (data ?? []).map(mapShift);
  },

  async getById(id: string): Promise<AttendanceShift | null> {
    const { data, error } = await supabase.from(SHIFTS).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapShift(data) : null;
  },

  async isCodeTaken(companyId: string, shiftCode: string, excludeId?: string): Promise<boolean> {
    if (!shiftCode.trim()) return false;
    let query = supabase
      .from(SHIFTS)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("shift_code", shiftCode.trim());
    if (excludeId) query = query.neq("id", excludeId);
    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },

  async create(companyId: string, values: ShiftFormValues, userId?: string): Promise<AttendanceShift> {
    const { data, error } = await supabase
      .from(SHIFTS)
      .insert({
        company_id: companyId,
        name: values.name,
        shift_code: values.shiftCode.trim() || null,
        start_time: values.startTime,
        end_time: values.endTime,
        late_eligible: values.lateEligible,
        overtime_enabled: values.overtimeEnabled,
        description: values.description?.trim() || null,
        is_active: values.isActive,
        created_by: userId ?? null,
        updated_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    await this.setStoreAssociations(data.id, values.storeIds);
    return mapShift(data);
  },

  async update(id: string, values: ShiftFormValues, userId?: string): Promise<AttendanceShift> {
    const { data, error } = await supabase
      .from(SHIFTS)
      .update({
        name: values.name,
        shift_code: values.shiftCode.trim() || null,
        start_time: values.startTime,
        end_time: values.endTime,
        late_eligible: values.lateEligible,
        overtime_enabled: values.overtimeEnabled,
        description: values.description?.trim() || null,
        is_active: values.isActive,
        updated_by: userId ?? null,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;

    await this.setStoreAssociations(id, values.storeIds);
    return mapShift(data);
  },

  async getStoreAssociations(shiftId: string): Promise<string[]> {
    const { data, error } = await supabase.from(SHIFT_STORES).select("store_id").eq("shift_id", shiftId);
    if (error) throw error;
    return (data ?? []).map((r) => r.store_id);
  },

  /** Replaces the full set of stores this shift is available at. Empty = available company-wide. */
  async setStoreAssociations(shiftId: string, storeIds: string[]): Promise<void> {
    const { error: deleteError } = await supabase.from(SHIFT_STORES).delete().eq("shift_id", shiftId);
    if (deleteError) throw deleteError;
    if (storeIds.length === 0) return;
    const { error: insertError } = await supabase
      .from(SHIFT_STORES)
      .insert(storeIds.map((storeId) => ({ shift_id: shiftId, store_id: storeId })));
    if (insertError) throw insertError;
  },

  /** Shifts available at this store: explicitly linked, OR company-wide (linked to no store at all). */
  async getShiftsForStore(companyId: string, storeId: string): Promise<AttendanceShift[]> {
    const allShifts = await this.list(companyId);
    if (allShifts.length === 0) return [];

    const { data: links, error } = await supabase.from(SHIFT_STORES).select("shift_id, store_id");
    if (error) throw error;

    const shiftsWithAnyStore = new Set((links ?? []).map((l) => l.shift_id));
    const shiftsForThisStore = new Set((links ?? []).filter((l) => l.store_id === storeId).map((l) => l.shift_id));

    return allShifts.filter((shift) => shiftsForThisStore.has(shift.id) || !shiftsWithAnyStore.has(shift.id));
  },

  // -------------------------------------------------------------------------
  // Employee shift assignment (history-preserving — mirrors weeklyOffService.assign)
  // -------------------------------------------------------------------------

  /** Bulk lookup for a schedule table — one query instead of one-per-employee. */
  async getCurrentAssignmentsForEmployees(
    employeeIds: string[]
  ): Promise<Map<string, EmployeeShiftAssignment & { shift: AttendanceShift }>> {
    if (employeeIds.length === 0) return new Map();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from(SHIFT_ASSIGNMENTS)
      .select("*, attendance_shifts(*)")
      .in("employee_id", employeeIds)
      .eq("is_active", true)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order("effective_from", { ascending: false });
    if (error) throw error;

    const map = new Map<string, EmployeeShiftAssignment & { shift: AttendanceShift }>();
    for (const row of (data ?? []) as any[]) {
      if (!map.has(row.employee_id)) {
        map.set(row.employee_id, { ...mapAssignment(row), shift: mapShift(row.attendance_shifts) });
      }
    }
    return map;
  },

  async getCurrentAssignment(employeeId: string): Promise<(EmployeeShiftAssignment & { shift: AttendanceShift }) | null> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from(SHIFT_ASSIGNMENTS)
      .select("*, attendance_shifts(*)")
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { ...mapAssignment(data), shift: mapShift(data.attendance_shifts) };
  },

  async getAssignmentHistory(employeeId: string): Promise<(EmployeeShiftAssignment & { shift: AttendanceShift })[]> {
    const { data, error } = await supabase
      .from(SHIFT_ASSIGNMENTS)
      .select("*, attendance_shifts(*)")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({ ...mapAssignment(row), shift: mapShift(row.attendance_shifts) }));
  },

  /**
   * Changes an employee's shift effective from a given date. The previous open-ended assignment
   * (if any) is closed with effective_to = the day before — never overwritten, so any attendance
   * date under the old shift keeps resolving to it (attendance_punch_in/out already does
   * date-aware lookup; this only changes what's returned going forward).
   */
  async changeShift(params: {
    employeeId: string;
    companyId: string;
    shiftId: string;
    effectiveFrom: string;
    remark?: string;
    userId?: string;
  }): Promise<void> {
    const { employeeId, companyId, shiftId, effectiveFrom, remark, userId } = params;

    const { data: current } = await supabase
      .from(SHIFT_ASSIGNMENTS)
      .select("id")
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .is("effective_to", null)
      .maybeSingle();

    if (current) {
      const dayBefore = new Date(effectiveFrom);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const effectiveTo = dayBefore.toISOString().slice(0, 10);
      await supabase.from(SHIFT_ASSIGNMENTS).update({ effective_to: effectiveTo, updated_by: userId ?? null }).eq("id", current.id);
    }

    const { error } = await supabase.from(SHIFT_ASSIGNMENTS).insert({
      company_id: companyId,
      employee_id: employeeId,
      shift_id: shiftId,
      effective_from: effectiveFrom,
      effective_to: null,
      is_active: true,
      remark: remark ?? null,
      created_by: userId ?? null,
      updated_by: userId ?? null,
    });
    if (error) throw error;
  },

  async bulkAssignShift(params: {
    employeeIds: string[];
    companyId: string;
    shiftId: string;
    effectiveFrom: string;
    remark?: string;
    userId?: string;
  }): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;
    for (const employeeId of params.employeeIds) {
      try {
        await this.changeShift({ ...params, employeeId });
        updated += 1;
      } catch {
        failed += 1;
      }
    }
    return { updated, failed };
  },
};
