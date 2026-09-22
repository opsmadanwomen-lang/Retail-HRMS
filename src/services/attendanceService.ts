import { supabase } from "@/lib/supabaseClient";
import type { Employee } from "@/types/employee";
import type { AttendanceMonthlySummary, AttendanceRecord, AttendanceRuleExplanation, AttendanceShift } from "@/types/attendance";
import { firstDateOfMonth, lastDateOfMonth } from "@/lib/dateRange";

const ATTENDANCE_RECORDS = "attendance_records";
const ATTENDANCE_SHIFT_ASSIGNMENTS = "employee_shift_assignments";
const ATTENDANCE_SHIFTS = "attendance_shifts";

function mapAttendanceRecord(row: any): AttendanceRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    storeId: row.store_id,
    attendanceDate: row.attendance_date,
    shiftId: row.shift_id,
    punchInAt: row.punch_in_at,
    punchOutAt: row.punch_out_at,
    totalWorkingMinutes: row.total_working_minutes ?? null,
    breakDeductionMinutes: row.break_deduction_minutes ?? null,
    workingMinutes: row.working_minutes,
    lateMinutes: row.late_minutes,
    overtimeMinutes: row.overtime_minutes,
    usedInformation: row.used_information ?? false,
    halfDayReason: row.half_day_reason ?? null,
    penaltyMinutes: row.penalty_minutes ?? null,
    earlyGoingMinutes: row.early_going_minutes ?? null,
    // numeric columns (extra_duty_value/payable_extra_duty_value support fractional Night Duty
    // days, e.g. 0.5) come back from PostgREST as JSON strings, not numbers — Number(...) here
    // matches the same coercion mapNightDutyApproval() already applies to the equivalent
    // attendance_night_duty_approvals column, so arithmetic (summing into Night Duty Payable)
    // doesn't silently become string concatenation.
    extraDutyValue: row.extra_duty_value === null || row.extra_duty_value === undefined ? null : Number(row.extra_duty_value),
    nightOtMinutes: row.night_ot_minutes ?? null,
    nightDutyApprovalId: row.night_duty_approval_id ?? null,
    payableWorkingMinutes: row.payable_working_minutes ?? null,
    payableOvertimeMinutes: row.payable_overtime_minutes ?? null,
    payableExtraDutyValue:
      row.payable_extra_duty_value === null || row.payable_extra_duty_value === undefined ? null : Number(row.payable_extra_duty_value),
    status: row.status,
    remarks: row.remarks,
    source: row.source,
    isDemo: row.is_demo ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function mapEmployeeRow(data: any): Employee {
  return {
    id: data.id,
    companyId: data.company_id,
    storeId: data.store_id,
    employeeScope: data.employee_scope,
    storeTeamId: data.store_team_id,
    storeDepartmentId: data.store_department_id,
    storeDesignationId: data.store_designation_id,
    reportingManagerId: data.reporting_manager_id,
    employeeCode: data.employee_code,
    authUserId: data.auth_user_id,
    firstName: data.first_name,
    middleName: data.middle_name,
    lastName: data.last_name,
    fullName: data.full_name,
    gender: data.gender,
    dateOfBirth: data.date_of_birth,
    bloodGroup: data.blood_group,
    mobile: data.mobile,
    alternateMobile: data.alternate_mobile,
    email: data.email,
    photoUrl: data.photo_url,
    joiningDate: data.joining_date,
    confirmationDate: data.confirmation_date,
    leavingDate: data.leaving_date ?? null,
    exitReason: data.exit_reason ?? null,
    exitStatus: data.exit_status ?? null,
    gradeId: data.grade_id ?? null,
    categoryId: data.category_id ?? null,
    employmentType: data.employment_type,
    salaryType: data.salary_type,
    status: data.status,
    isActive: data.is_active,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    storeName: null,
    teamName: null,
    departmentName: null,
    designationTitle: null,
    reportingManagerName: null,
  };
}

export const attendanceService = {
  /**
   * Resolves the employee record for the logged-in user. Employees with a Staff login (created via
   * the staff-account edge function) are linked robustly via auth_user_id — the authoritative,
   * server-verified identity, never trusted from anything the frontend could tamper with beyond
   * "this is my own session". Falls back to email matching only for older employees/admin accounts
   * that predate that link.
   */
  async getCurrentEmployee(
    companyId: string | null | undefined,
    email: string | null | undefined,
    userId?: string | null
  ): Promise<Employee | null> {
    if (!companyId) return null;

    if (userId) {
      const { data: byAuthId, error: authIdError } = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId)
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (authIdError) throw authIdError;
      if (byAuthId) return mapEmployeeRow(byAuthId);
    }

    if (!email) return null;
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("company_id", companyId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return mapEmployeeRow(data);
  },

  async getEmployeeShift(employeeId: string, date: string): Promise<AttendanceShift | null> {
    const { data, error } = await supabase
      .from(ATTENDANCE_SHIFT_ASSIGNMENTS)
      .select(`${ATTENDANCE_SHIFTS} (*)`)
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .lte("effective_from", date)
      .or(`effective_to.is.null,effective_to.gte.${date}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const shift = data?.[ATTENDANCE_SHIFTS] ?? null;
    if (!shift) {
      return null;
    }
    return mapShift(shift);
  },

  async getTodayAttendance(employeeId: string): Promise<AttendanceRecord | null> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from(ATTENDANCE_RECORDS)
      .select("*")
      .eq("employee_id", employeeId)
      .eq("attendance_date", today)
      .maybeSingle();

    if (error) throw error;
    return data ? mapAttendanceRecord(data) : null;
  },

  async getAttendanceByDate(employeeId: string, date: string): Promise<AttendanceRecord | null> {
    const { data, error } = await supabase
      .from(ATTENDANCE_RECORDS)
      .select("*")
      .eq("employee_id", employeeId)
      .eq("attendance_date", date)
      .maybeSingle();

    if (error) throw error;
    return data ? mapAttendanceRecord(data) : null;
  },

  async getMonthlyAttendance(employeeId: string, year: number, month: number): Promise<AttendanceRecord[]> {
    return this.getAttendanceRange(employeeId, firstDateOfMonth(year, month), lastDateOfMonth(year, month));
  },

  /**
   * Attendance records by their own ids — used to resolve the LIVE attendance_records Night Duty
   * columns (night_ot_minutes / extra_duty_value / payable_extra_duty_value) for a small, possibly
   * date-scattered set of records, e.g. the "Night Duty" card's 5 most recent requests. See
   * modules/attendance/utils.ts resolveNightDutyFacts() module note on why these must come from
   * attendance_records, never from attendance_night_duty_approvals' own (potentially stale) columns.
   */
  async getRecordsByIds(ids: string[]): Promise<AttendanceRecord[]> {
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from(ATTENDANCE_RECORDS).select("*").in("id", ids);
    if (error) throw error;
    return (data ?? []).map(mapAttendanceRecord);
  },

  /** Attendance records for an employee within [fromDate, toDate] inclusive ("YYYY-MM-DD" each). */
  async getAttendanceRange(employeeId: string, fromDate: string, toDate: string): Promise<AttendanceRecord[]> {
    const { data, error } = await supabase
      .from(ATTENDANCE_RECORDS)
      .select("*")
      .eq("employee_id", employeeId)
      .gte("attendance_date", fromDate)
      .lte("attendance_date", toDate)
      .order("attendance_date", { ascending: true });

    if (error) throw error;
    return (data ?? []).map(mapAttendanceRecord);
  },

  async getMonthlySummary(employeeId: string, year: number, month: number): Promise<AttendanceMonthlySummary> {
    const records = await this.getMonthlyAttendance(employeeId, year, month);
    const summary: AttendanceMonthlySummary = {
      present: 0,
      absent: 0,
      leave: 0,
      weeklyOff: 0,
      halfDay: 0,
      lateDays: 0,
      lateMinutes: 0,
      overtimeMinutes: 0,
      earlyGoingMinutes: 0,
    };

    for (const record of records) {
      switch (record.status) {
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

      if (record.lateMinutes && record.lateMinutes > 0) {
        summary.lateDays += 1;
        summary.lateMinutes += record.lateMinutes;
      }

      if (record.overtimeMinutes && record.overtimeMinutes > 0) {
        summary.overtimeMinutes += record.overtimeMinutes;
      }

      if (record.earlyGoingMinutes && record.earlyGoingMinutes > 0) {
        summary.earlyGoingMinutes += record.earlyGoingMinutes;
      }
    }

    return summary;
  },

  /** `useInformation: true` consumes one of the employee's monthly Information/Intimation
   *  opportunities (if any remain) and applies the Information-day noon cutoff instead of the
   *  normal Shift-Start-based late calculation — enforced/validated server-side, not just a UI flag. */
  async punchIn(useInformation = false): Promise<AttendanceRecord> {
    const { data, error } = await supabase.rpc("attendance_punch_in", { p_use_information: useInformation });
    if (error) throw error;
    return mapAttendanceRecord(data);
  },

  async punchOut(): Promise<AttendanceRecord> {
    const { data, error } = await supabase.rpc("attendance_punch_out");
    if (error) throw error;
    return mapAttendanceRecord(data);
  },

  /**
   * Super Admin manual Punch In/Out on behalf of another employee. The role check
   * (is_super_admin()) is enforced INSIDE attendance_admin_punch() — a non-super-admin
   * calling this still gets rejected by Postgres even if they bypass this UI entirely.
   * Same shift resolution + late/working/overtime formulas as the self-service RPCs;
   * always uses the server's now(), never a caller-supplied timestamp.
   */
  async adminPunch(employeeId: string, type: "punch_in" | "punch_out", remark?: string): Promise<AttendanceRecord> {
    const { data, error } = await supabase.rpc("attendance_admin_punch", {
      p_employee_id: employeeId,
      p_type: type,
      p_remark: remark && remark.trim().length > 0 ? remark.trim() : null,
    });
    if (error) throw error;
    return mapAttendanceRecord(data);
  },

  /**
   * Super Admin create/edit attendance for ANY date <= today (historical or today) — status, punch
   * in/out wall-clock times, and a remark. attendance_admin_upsert() re-checks is_super_admin() and
   * rejects attendance_date > the server's current_date server-side; the shift used for Late/Working
   * /Overtime is the one that was actually assigned to the employee ON attendanceDate, never today's
   * current shift. Distinct from adminPunch() above, which is only for "punch now" on today.
   */
  async adminUpsert(params: {
    employeeId: string;
    attendanceDate: string; // "YYYY-MM-DD"
    status: string;
    punchInTime?: string | null; // "HH:MM" or "HH:MM:SS", IST wall-clock on attendanceDate
    punchOutTime?: string | null;
    remark?: string;
    useInformation?: boolean;
  }): Promise<AttendanceRecord> {
    const { data, error } = await supabase.rpc("attendance_admin_upsert", {
      p_employee_id: params.employeeId,
      p_attendance_date: params.attendanceDate,
      p_status: params.status,
      p_punch_in_time: params.punchInTime && params.punchInTime.trim().length > 0 ? params.punchInTime : null,
      p_punch_out_time: params.punchOutTime && params.punchOutTime.trim().length > 0 ? params.punchOutTime : null,
      p_remark: params.remark && params.remark.trim().length > 0 ? params.remark.trim() : null,
      p_use_information: params.useInformation ?? false,
    });
    if (error) throw error;
    return mapAttendanceRecord(data);
  },

  /**
   * Super Admin approves or disallows a pending Night Duty. Disallowing requires the manager-
   * confirmed payable Out Time — the RPC rejects the call without it and validates it falls
   * between Punch In and the actual Punch Out. The actual punch is never modified either way;
   * payable_working_minutes/payable_overtime_minutes/payable_extra_duty_value on the attendance
   * record are what change.
   */
  async nightDutyDecide(params: {
    approvalId: string;
    decision: "approved" | "disallowed";
    managerPayableOutTime?: string | null; // ISO timestamp, required when decision = "disallowed"
    remark?: string;
  }) {
    const { data, error } = await supabase.rpc("attendance_night_duty_decide", {
      p_approval_id: params.approvalId,
      p_decision: params.decision,
      p_manager_payable_out_time: params.managerPayableOutTime ?? null,
      p_remark: params.remark && params.remark.trim().length > 0 ? params.remark.trim() : null,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Operations Manager decision — approve, disallow, or carry forward to Super Manager. The RPC
   * enforces server-side that the caller is an active OM assigned to the request's store, is not
   * the employee the request is about, and that the request is still `pending_om` (an atomic
   * UPDATE...WHERE guard makes a race between two OMs on the same store impossible to double-act).
   */
  async nightDutyOmDecide(params: {
    approvalId: string;
    decision: "approved" | "disallowed" | "carry_forward";
    managerPayableOutTime?: string | null; // ISO timestamp, required when decision = "disallowed"
    remark?: string;
  }) {
    const { data, error } = await supabase.rpc("attendance_night_duty_om_decide", {
      p_approval_id: params.approvalId,
      p_decision: params.decision,
      p_manager_payable_out_time: params.managerPayableOutTime ?? null,
      p_remark: params.remark && params.remark.trim().length > 0 ? params.remark.trim() : null,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Super Manager FINAL decision on a request an OM carried forward. Server-side enforces the
   * caller is an active Super Manager, is not the employee the request is about, and that the
   * request is still `pending_super_manager` — the same atomic guard prevents a second Super
   * Manager from overriding an already-finalized decision.
   */
  async nightDutySuperManagerDecide(params: {
    approvalId: string;
    decision: "approved" | "disallowed";
    managerPayableOutTime?: string | null;
    remark?: string;
  }) {
    const { data, error } = await supabase.rpc("attendance_night_duty_super_manager_decide", {
      p_approval_id: params.approvalId,
      p_decision: params.decision,
      p_manager_payable_out_time: params.managerPayableOutTime ?? null,
      p_remark: params.remark && params.remark.trim().length > 0 ? params.remark.trim() : null,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Read-only rule-resolution explanation for the Edit Attendance dialog's "Applied Attendance
   * Rules" section (migration 0067). Calls attendance_explain_rules(), which itself only ever
   * calls resolve_attendance_rule() and compute_extended_attendance_facts()/compute_late_and_
   * penalty_facts() — the exact same authoritative chain attendance_admin_upsert() uses. This
   * method never recalculates anything client-side; it purely maps the RPC's rows.
   */
  async explainRules(params: {
    companyId: string;
    employeeId: string;
    shiftId: string;
    storeId: string;
    attendanceDate: string;
    punchInAt: string | null;
    punchOutAt: string | null;
    useInformation?: boolean;
  }): Promise<AttendanceRuleExplanation[]> {
    const { data, error } = await supabase.rpc("attendance_explain_rules", {
      p_company_id: params.companyId,
      p_employee_id: params.employeeId,
      p_shift_id: params.shiftId,
      p_store_id: params.storeId,
      p_attendance_date: params.attendanceDate,
      p_punch_in_at: params.punchInAt,
      p_punch_out_at: params.punchOutAt,
      p_use_information: params.useInformation ?? false,
    });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      kind: row.kind,
      ruleId: row.rule_id ?? null,
      isAssigned: row.is_assigned,
      triggered: row.triggered,
      scopeSource: row.scope_source ?? null,
      resolvedStoreId: row.resolved_store_id ?? null,
      resolvedEmployeeId: row.resolved_employee_id ?? null,
      effectiveFrom: row.effective_from ?? null,
      effectiveTo: row.effective_to ?? null,
      config: row.config ?? null,
      resultValue: row.result_value === null || row.result_value === undefined ? null : Number(row.result_value),
      resultNote: row.result_note ?? null,
    }));
  },

  /**
   * Super Admin manual "Use Information" action (migrations 0072/0073). One atomic RPC: validates
   * permission/eligibility/quota, creates the usage record through the EXISTING
   * employee_information_usage system, and recalculates via the EXISTING
   * compute_extended_attendance_facts()/compute_late_and_penalty_facts() chain — this method never
   * computes Late/Penalty/Information itself, it only sends the one record id and maps the RPC's
   * returned (already-recalculated) attendance_records row back.
   */
  async useInformation(attendanceRecordId: string, remark?: string): Promise<AttendanceRecord> {
    const { data, error } = await supabase.rpc("attendance_use_information", {
      p_attendance_record_id: attendanceRecordId,
      p_remark: remark?.trim() || null,
    });
    if (error) throw error;
    return mapAttendanceRecord(data);
  },
};
