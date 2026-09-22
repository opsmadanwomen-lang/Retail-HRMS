import { supabase } from "@/lib/supabaseClient";
import type { AttendanceStatus, Database } from "@/types/database.types";
import type {
  AttendanceAdminDailyRow,
  AttendanceAdminFilters,
  AttendanceAdminSummary,
  StoreAttendanceSummaryRow,
} from "@/types/attendanceAdmin";
import { enumerateDateRange, toDateKey, todayDateKey } from "@/lib/dateRange";
import { computeAttendanceFacts, istWallClockToUtcIso, parseTimeToMinutesOfDay, type ShiftWindow } from "@/lib/attendanceCalculation";
import { attendanceService } from "@/services/attendanceService";
import { weeklyOffService } from "@/services/weeklyOffService";
import { isWeeklyOffOnDate } from "@/lib/weeklyOffResolver";
import { extendedAttendanceRuleService } from "@/services/extendedAttendanceRuleService";
import { resolveNightDutyFacts } from "@/modules/attendance/utils";
import type { NightDutyApproval } from "@/types/attendanceRules";

const ATTENDANCE_RECORDS = "attendance_records";
const ATTENDANCE_SHIFTS = "attendance_shifts";
const EMPLOYEES = "employees";
const STORES = "stores";
const STORE_DEPARTMENTS = "store_departments";

type AttendanceRecordInsert = Database["public"]["Tables"]["attendance_records"]["Insert"];

interface ScopedEmployeeRow {
  id: string;
  company_id: string;
  /** Nullable since migration 0061 — NULL for a Company Wide employee (e.g. Super Manager). */
  store_id: string | null;
  employee_code: string | null;
  full_name: string;
  mobile: string | null;
  store_department_id: string | null;
  is_active: boolean;
}

interface ScopedEmployee {
  id: string;
  companyId: string;
  /** Nullable since migration 0061 — NULL for a Company Wide employee (e.g. Super Manager). */
  storeId: string | null;
  employeeCode: string | null;
  fullName: string;
  storeDepartmentId: string | null;
}

interface AttendanceRecordRowLite {
  id: string;
  employee_id: string;
  attendance_date: string;
  punch_in_at: string | null;
  punch_out_at: string | null;
  total_working_minutes: number | null;
  break_deduction_minutes: number | null;
  working_minutes: number | null;
  late_minutes: number | null;
  overtime_minutes: number | null;
  early_going_minutes: number | null;
  status: AttendanceStatus;
  is_demo: boolean;
  // Night Duty magnitude source columns — see modules/attendance/utils.ts resolveNightDutyFacts()
  // module note: the LIVE attendance_records value, never attendance_night_duty_approvals' own
  // (potentially stale) snapshot.
  night_ot_minutes: number | null;
  extra_duty_value: number | null;
  payable_extra_duty_value: number | null;
  payable_overtime_minutes: number | null;
}

/** Employees the current admin's filters resolve to, scoped to their own company. */
async function getScopedEmployees(filters: AttendanceAdminFilters): Promise<ScopedEmployee[]> {
  if (!filters.companyId) return [];

  let query = supabase
    .from(EMPLOYEES)
    .select("id, company_id, store_id, employee_code, full_name, mobile, store_department_id, is_active")
    .eq("company_id", filters.companyId)
    .eq("is_active", true);

  if (filters.storeId) query = query.eq("store_id", filters.storeId);
  if (filters.employeeId) query = query.eq("id", filters.employeeId);
  if (filters.search) {
    const term = filters.search.trim();
    query = query.or(`full_name.ilike.%${term}%,employee_code.ilike.%${term}%,mobile.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  let employees = (data ?? []) as ScopedEmployeeRow[];

  if (filters.departmentId) {
    const { data: departments, error: deptError } = await supabase
      .from(STORE_DEPARTMENTS)
      .select("id")
      .eq("master_department_id", filters.departmentId);
    if (deptError) throw deptError;
    const storeDepartmentIds = new Set((departments ?? []).map((d) => d.id));
    employees = employees.filter((e) => e.store_department_id && storeDepartmentIds.has(e.store_department_id));
  }

  return employees.map((e) => ({
    id: e.id,
    companyId: e.company_id,
    storeId: e.store_id,
    employeeCode: e.employee_code,
    fullName: e.full_name,
    storeDepartmentId: e.store_department_id,
  }));
}

async function getLookupMaps(employees: ScopedEmployee[]) {
  // ROOT CAUSE FIX (migration 0061 regression): Company Wide employees have storeId === null.
  // Passing an array containing null into `.in("id", storeIds)` makes PostgREST try to cast the
  // literal "null" to a uuid and fail the whole query (400) — which is exactly why the Attendance
  // Dashboard's daily/summary/store-summary queries all started erroring together the moment a
  // real Company Wide employee (store_id NULL) existed in the company. Filtering nulls out here is
  // the only change needed — Store Specific employees (the other 39) are completely unaffected.
  const storeIds = Array.from(new Set(employees.map((e) => e.storeId).filter((id): id is string => Boolean(id))));
  const departmentIds = Array.from(
    new Set(employees.map((e) => e.storeDepartmentId).filter((id): id is string => Boolean(id)))
  );

  const [storesResult, departmentsResult] = await Promise.all([
    storeIds.length
      ? supabase.from(STORES).select("id, name").in("id", storeIds)
      : Promise.resolve({ data: [], error: null }),
    departmentIds.length
      ? supabase.from(STORE_DEPARTMENTS).select("id, name").in("id", departmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (storesResult.error) throw storesResult.error;
  if (departmentsResult.error) throw departmentsResult.error;

  return {
    storeMap: new Map((storesResult.data ?? []).map((s: { id: string; name: string }) => [s.id, s.name])),
    departmentMap: new Map((departmentsResult.data ?? []).map((d: { id: string; name: string }) => [d.id, d.name])),
  };
}

/** Attendance rows for the given employees within [fromDate, toDate], restricted to real or demo data — never both mixed. */
async function getAttendanceRecordsInRange(
  employeeIds: string[],
  fromDate: string,
  toDate: string,
  wantDemo: boolean
): Promise<AttendanceRecordRowLite[]> {
  if (!employeeIds.length) return [];

  const { data, error } = await supabase
    .from(ATTENDANCE_RECORDS)
    .select(
      "id, employee_id, attendance_date, punch_in_at, punch_out_at, total_working_minutes, break_deduction_minutes, working_minutes, late_minutes, overtime_minutes, early_going_minutes, status, is_demo, night_ot_minutes, extra_duty_value, payable_extra_duty_value, payable_overtime_minutes"
    )
    .in("employee_id", employeeIds)
    .gte("attendance_date", fromDate)
    .lte("attendance_date", toDate)
    .eq("is_demo", wantDemo);

  if (error) throw error;
  return (data ?? []) as AttendanceRecordRowLite[];
}

/**
 * Builds the full (unpaginated) attendance rows — one row per employee per day in the selected
 * range — shared by the summary/daily/store-summary/export views. Defaults to "today" only when
 * the caller supplies no range, preserving the original single-day dashboard behaviour.
 */
async function buildDailyRows(filters: AttendanceAdminFilters): Promise<AttendanceAdminDailyRow[]> {
  const employees = await getScopedEmployees(filters);
  if (!employees.length) return [];

  const fromDate = filters.dateFrom ?? todayDateKey();
  const toDate = filters.dateTo ?? fromDate;
  const wantDemo = filters.isDemo === true;
  const dateList = enumerateDateRange(fromDate, toDate);

  const employeeIds = employees.map((e) => e.id);
  const [{ storeMap, departmentMap }, records, weeklyOffHistoryMap, weeklyOffOverridesMap, nightDutyApprovals] = await Promise.all([
    getLookupMaps(employees),
    getAttendanceRecordsInRange(employeeIds, fromDate, toDate, wantDemo),
    weeklyOffService.getHistoryForEmployees(employeeIds),
    weeklyOffService.getOverridesForEmployees(employeeIds),
    // Demo rows have no real attendance_record_id a Night Duty approval could reference, but the
    // fetch itself is harmless either way — skip it to avoid a pointless query on the demo path.
    wantDemo ? Promise.resolve([] as NightDutyApproval[]) : extendedAttendanceRuleService.getNightDutyApprovalsForEmployeesRange(employeeIds, fromDate, toDate),
  ]);

  const recordMap = new Map(records.map((r) => [`${r.employee_id}__${r.attendance_date}`, r]));
  const nightDutyByRecordId = new Map(nightDutyApprovals.map((a) => [a.attendanceRecordId, a]));

  const rows: AttendanceAdminDailyRow[] = [];
  for (const employee of employees) {
    const periods = weeklyOffHistoryMap.get(employee.id) ?? [];
    const overrides = weeklyOffOverridesMap.get(employee.id) ?? [];

    for (const { dateKey } of dateList) {
      const record = recordMap.get(`${employee.id}__${dateKey}`);

      // In demo view, only show employees that actually have a demo record for the day —
      // do not synthesize placeholder rows that would look like real "absent" data.
      if (wantDemo && !record) continue;

      const isWeeklyOff = !record && isWeeklyOffOnDate(dateKey, periods, overrides);
      const status: AttendanceStatus = record?.status ?? (isWeeklyOff ? "weekly_off" : "absent");
      if (filters.status && status !== filters.status) continue;

      const nightDuty = resolveNightDutyFacts(
        record
          ? {
              overtimeMinutes: record.overtime_minutes,
              nightOtMinutes: record.night_ot_minutes,
              // numeric columns come back from PostgREST as JSON strings — Number(...) here matches
              // the coercion attendanceService.mapAttendanceRecord() applies for the same reason.
              payableExtraDutyValue: record.payable_extra_duty_value === null ? null : Number(record.payable_extra_duty_value),
              extraDutyValue: record.extra_duty_value === null ? null : Number(record.extra_duty_value),
              payableOvertimeMinutes: record.payable_overtime_minutes,
            }
          : null,
        record ? nightDutyByRecordId.get(record.id) : undefined
      );

      rows.push({
        id: record?.id ?? `no-record-${employee.id}-${dateKey}`,
        date: dateKey,
        employeeId: employee.id,
        employeeCode: employee.employeeCode ?? "—",
        employeeName: employee.fullName,
        storeId: employee.storeId,
        storeName: employee.storeId ? storeMap.get(employee.storeId) ?? null : "Company Wide",
        departmentId: employee.storeDepartmentId,
        departmentName: employee.storeDepartmentId ? departmentMap.get(employee.storeDepartmentId) ?? null : null,
        shiftName: null,
        punchInAt: record?.punch_in_at ?? null,
        punchOutAt: record?.punch_out_at ?? null,
        totalWorkingMinutes: record?.total_working_minutes ?? null,
        breakDeductionMinutes: record?.break_deduction_minutes ?? null,
        workingMinutes: record?.working_minutes ?? null,
        lateMinutes: record?.late_minutes ?? null,
        overtimeMinutes: nightDuty.overtimeMinutes,
        earlyGoingMinutes: record?.early_going_minutes ?? null,
        status,
        isDemo: record?.is_demo ?? false,
        nightDutyStatus: nightDuty.status,
        nightDutyDays: nightDuty.days,
        nightOtMinutes: nightDuty.nightOtMinutes,
      });
    }
  }

  rows.sort((a, b) => (a.date === b.date ? a.employeeName.localeCompare(b.employeeName) : a.date.localeCompare(b.date)));
  return rows;
}

interface ResolvedShift extends ShiftWindow {
  id: string;
}

/** Reuses the company's active shift if one exists; otherwise provisions a sensible default so
 *  punch-in/out, demo generation, and import have a shift to work with. Never touches employee/company data. */
const SHIFT_COLUMNS = "id, start_time, end_time, break_minutes, late_eligible, overtime_enabled";

function toResolvedShift(row: {
  id: string;
  start_time: string;
  end_time: string;
  break_minutes: number | null;
  late_eligible: boolean | null;
  overtime_enabled: boolean | null;
}): ResolvedShift {
  return {
    id: row.id,
    startMinutes: parseTimeToMinutesOfDay(row.start_time),
    endMinutes: parseTimeToMinutesOfDay(row.end_time),
    breakMinutes: row.break_minutes ?? 0,
    lateEligible: row.late_eligible ?? true,
    overtimeEnabled: row.overtime_enabled ?? true,
  };
}

async function ensureCompanyShift(companyId: string): Promise<ResolvedShift> {
  const { data: existing, error } = await supabase
    .from(ATTENDANCE_SHIFTS)
    .select(SHIFT_COLUMNS)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (existing) return toResolvedShift(existing);

  const { data: created, error: createError } = await supabase
    .from(ATTENDANCE_SHIFTS)
    .insert({
      company_id: companyId,
      name: "General Shift",
      shift_code: "GEN",
      start_time: "09:00:00",
      end_time: "18:00:00",
      break_minutes: 60,
      late_eligible: true,
      overtime_enabled: true,
      is_active: true,
    })
    .select(SHIFT_COLUMNS)
    .single();

  if (createError) throw createError;
  return toResolvedShift(created);
}

/** The shift that actually applies to this employee on this date — their own assignment if any, else the company default. */
async function resolveShiftForEmployee(employeeId: string, companyId: string, date: string): Promise<ResolvedShift> {
  const assigned = await attendanceService.getEmployeeShift(employeeId, date);
  if (assigned) {
    return {
      id: assigned.id,
      startMinutes: parseTimeToMinutesOfDay(assigned.startTime),
      endMinutes: parseTimeToMinutesOfDay(assigned.endTime),
      breakMinutes: assigned.breakMinutes ?? 0,
      lateEligible: assigned.lateEligible ?? true,
      overtimeEnabled: assigned.overtimeEnabled ?? true,
    };
  }
  return ensureCompanyShift(companyId);
}

const DEMO_SCENARIOS = ["present", "late", "overtime", "absent", "leave", "half_day"] as const;
type DemoScenario = (typeof DEMO_SCENARIOS)[number] | "weekly_off";
const DEMO_WINDOW_DAYS = 14;

function buildDemoRow(
  scenario: DemoScenario,
  dateStr: string,
  shift: ResolvedShift,
  base: Pick<AttendanceRecordInsert, "company_id" | "employee_id" | "store_id" | "shift_id" | "attendance_date">
): AttendanceRecordInsert {
  const row: AttendanceRecordInsert = {
    ...base,
    source: "backend",
    is_demo: true,
    punch_in_at: null,
    punch_out_at: null,
    total_working_minutes: null,
    break_deduction_minutes: null,
    working_minutes: null,
    late_minutes: null,
    overtime_minutes: null,
    status: "absent",
  };

  const applyPunches = (punchInMinutes: number, punchOutMinutes: number, status: AttendanceStatus) => {
    const facts = computeAttendanceFacts(shift, punchInMinutes, punchOutMinutes, scenario === "weekly_off" ? "weekly_off" : "normal");
    row.punch_in_at = istWallClockToUtcIso(dateStr, punchInMinutes);
    row.punch_out_at = istWallClockToUtcIso(dateStr, punchOutMinutes);
    row.total_working_minutes = facts.totalWorkingMinutes;
    row.break_deduction_minutes = facts.breakDeductionMinutes;
    row.working_minutes = facts.workingMinutes;
    row.late_minutes = facts.lateMinutes;
    row.overtime_minutes = facts.overtimeMinutes;
    row.status = status;
  };

  switch (scenario) {
    case "present":
      applyPunches(shift.startMinutes + 5, shift.endMinutes + 2, "present");
      break;
    case "late":
      applyPunches(shift.startMinutes + 25, shift.endMinutes, "present");
      break;
    case "overtime":
      applyPunches(shift.startMinutes, shift.endMinutes + 90, "present");
      break;
    case "half_day":
      applyPunches(shift.startMinutes, shift.startMinutes + 240, "half_day");
      break;
    case "absent":
      row.status = "absent";
      break;
    case "leave":
      row.status = "leave";
      break;
    case "weekly_off":
    default:
      row.status = "weekly_off";
      break;
  }

  return row;
}

export const attendanceAdminService = {
  async getAdminDailyAttendance(
    filters: AttendanceAdminFilters
  ): Promise<{ data: AttendanceAdminDailyRow[]; total: number }> {
    const rows = await buildDailyRows(filters);
    const total = rows.length;
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 25;
    const start = (page - 1) * pageSize;
    return { data: rows.slice(start, start + pageSize), total };
  },

  async getAttendanceSummary(filters: AttendanceAdminFilters): Promise<AttendanceAdminSummary> {
    const rows = await buildDailyRows(filters);

    const summary: AttendanceAdminSummary = {
      totalStaff: rows.length,
      present: 0,
      absent: 0,
      leave: 0,
      weeklyOff: 0,
      halfDay: 0,
      late: 0,
      overtime: 0,
    };

    for (const row of rows) {
      switch (row.status) {
        case "present":
          summary.present += 1;
          break;
        case "absent":
          summary.absent += 1;
          break;
        case "leave":
          summary.leave += 1;
          break;
        case "weekly_off":
          summary.weeklyOff += 1;
          break;
        case "half_day":
          summary.halfDay += 1;
          break;
        default:
          break;
      }

      if (row.lateMinutes && row.lateMinutes > 0) summary.late += 1;
      if (row.overtimeMinutes && row.overtimeMinutes > 0) summary.overtime += 1;
    }

    return summary;
  },

  async getStoreAttendanceSummary(filters: AttendanceAdminFilters): Promise<StoreAttendanceSummaryRow[]> {
    const rows = await buildDailyRows(filters);
    // Keyed by storeId, which is null for Company Wide employees — Map supports a null key fine
    // (JS Map, unlike the SQL/PostgREST `.in()` filter above, has no special-casing issue with it).
    const buckets = new Map<string | null, StoreAttendanceSummaryRow>();

    for (const row of rows) {
      if (!buckets.has(row.storeId)) {
        buckets.set(row.storeId, {
          storeId: row.storeId,
          storeName: row.storeName ?? "Unassigned Store",
          totalStaff: 0,
          present: 0,
          absent: 0,
          leave: 0,
          weeklyOff: 0,
          late: 0,
          overtime: 0,
        });
      }

      const bucket = buckets.get(row.storeId) as StoreAttendanceSummaryRow;
      bucket.totalStaff += 1;

      switch (row.status) {
        case "present":
          bucket.present += 1;
          break;
        case "absent":
          bucket.absent += 1;
          break;
        case "leave":
          bucket.leave += 1;
          break;
        case "weekly_off":
          bucket.weeklyOff += 1;
          break;
        default:
          break;
      }

      if (row.lateMinutes && row.lateMinutes > 0) bucket.late += 1;
      if (row.overtimeMinutes && row.overtimeMinutes > 0) bucket.overtime += 1;
    }

    return Array.from(buckets.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
  },

  async getDemoAttendanceCount(companyId: string): Promise<number> {
    const { count, error } = await supabase
      .from(ATTENDANCE_RECORDS)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_demo", true);

    if (error) throw error;
    return count ?? 0;
  },

  /** Deletes ONLY rows marked is_demo = true for this company. Real attendance is never touched. */
  async clearDemoAttendance(companyId: string): Promise<void> {
    const { error } = await supabase
      .from(ATTENDANCE_RECORDS)
      .delete()
      .eq("company_id", companyId)
      .eq("is_demo", true);

    if (error) throw error;
  },

  /**
   * Generates demo attendance for the last DEMO_WINDOW_DAYS calendar days (ending yesterday, so
   * today's real punch data can never collide) for every existing active employee of the company.
   * Uses upsert with ignoreDuplicates so any date that already has a record (real or demo) is
   * skipped rather than overwritten — real attendance is never modified.
   */
  async generateDemoAttendance(companyId: string): Promise<{ inserted: number }> {
    const { data: employees, error } = await supabase
      .from(EMPLOYEES)
      .select("id, store_id")
      .eq("company_id", companyId)
      .eq("is_active", true)
      // Demo attendance is inherently store-based (attendance_records.store_id is required) —
      // Company Wide employees (e.g. Super Manager) have no store to punch in/out of, so they're
      // excluded here, same as they always would have been implicitly before Employee Scope existed.
      .not("store_id", "is", null);

    if (error) throw error;
    if (!employees || employees.length === 0) {
      throw new Error("No active employees found for this company. Add employees before generating demo attendance.");
    }

    const shift = await ensureCompanyShift(companyId);
    const today = new Date();
    const rows: AttendanceRecordInsert[] = [];

    employees.forEach((employee: { id: string; store_id: string | null }, employeeIndex: number) => {
      if (!employee.store_id) return; // excluded by the query above; guard keeps this branch type-safe
      const storeId = employee.store_id;
      for (let offset = 1; offset <= DEMO_WINDOW_DAYS; offset += 1) {
        const date = new Date(today);
        date.setDate(date.getDate() - offset);
        const dateStr = toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
        const isSunday = date.getDay() === 0;
        const scenario: DemoScenario = isSunday
          ? "weekly_off"
          : DEMO_SCENARIOS[(employeeIndex + offset) % DEMO_SCENARIOS.length];

        rows.push(
          buildDemoRow(scenario, dateStr, shift, {
            company_id: companyId,
            employee_id: employee.id,
            store_id: storeId,
            shift_id: shift.id,
            attendance_date: dateStr,
          })
        );
      }
    });

    const CHUNK_SIZE = 200;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { data, error: insertError } = await supabase
        .from(ATTENDANCE_RECORDS)
        .upsert(chunk, { onConflict: "employee_id,attendance_date", ignoreDuplicates: true })
        .select("id");

      if (insertError) throw insertError;
      inserted += data?.length ?? 0;
    }

    return { inserted };
  },

  /** Exposed for attendanceImportService: the shift (per-employee assignment, else company default) to use for a given employee/date. */
  resolveShiftForEmployee,
};
