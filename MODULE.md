# MODULE.md — Leave → Attendance Integration + Leave Reports (Phase 5)

> This file documents the most recently delivered module. For the cross-phase
> table/relationship reference see DATABASE.md; for app architecture see
> ARCHITECTURE.md; for the phase-by-phase changelog see CHANGELOG.md.
>
> Phases between "Phase 1 Part 6" and here (Attendance / Night Duty engine,
> Leave Management Phases 1–4) were delivered without updating these four
> markdown files. Phase 5 documents itself here and in CHANGELOG.md only.

## 1. Objective

1. Make a **FINAL APPROVED** leave (and only a final-approved leave) visible to
   the Attendance system for its chargeable dates — additively, with zero change
   to any Attendance or Night Duty calculation, RPC, threshold, or workflow.
2. Deliver the complete 15-report Leave Reports module.

## 2. Attendance integration design

**Nothing is ever written into `attendance_records` and no Attendance RPC is
touched.** `attendance_records` has no row per calendar day — the Staff
Attendance Calendar (`src/modules/attendance/utils.ts`) already synthesises the
missing days client-side with a precedence chain (real record → Weekly Off →
Absent) and its `MonthlyAttendanceRow.status` union + `buildAttendanceSummary()`
already had a fully-wired `"leave"` branch that nothing fed. Phase 5 feeds it.

```
leave_manager_decide() / leave_super_manager_decide()
  └─ (only) on the branch that sets status = 'approved'
       └─ leave_materialize_attendance_dates(application_id)
            └─ for each date from_date..to_date:
                 skip if Weekly Off / Holiday AND the policy's
                   weekly_off_count_rule / holiday_count_rule ≠ 'count'
                   (the SAME rule leave_compute_total_days() applied when
                    total_days was first computed — reused, not reimplemented)
                 else INSERT leave_attendance_effects (…date…)
                   ON CONFLICT (employee_id, attendance_date)
                     WHERE status='active' DO NOTHING      ← idempotent
       half-day application → a single effect row, is_half_day = true

Attendance Calendar (display only)
  useLeaveAttendanceEffects(employee, from, to)
    → leave_list_attendance_effects()  (RLS-scoped)
      → buildMonthlyAttendanceRows / buildDateRangeRows (leaveEffects arg)
        → toAttendanceRow() precedence:
             real attendance_records row  >  approved Leave  >  Weekly Off  >  Absent
             half-day Leave → existing 'half_day' status; full day → 'leave'
```

Surfaces that received the `leaveEffects` argument: employee's own Monthly
Attendance (`AttendancePage`), Admin/Super-Admin Staff-View date-range table,
`MonthlyAttendanceDialog`, `ManualStaffAttendanceCard`. `AttendanceCalendarCard`
already styled `status === "leave"`.

### Cancellation after approval
`leave_cancel()` now also accepts `approved` (§7). It writes one offsetting
`reversal` ledger row (nets the earlier `used` debit to zero — identical end
state to a rejected application) and sets every `leave_attendance_effects` row
for that application to `status='reversed'` (`reversed_at` / `reversed_by` set;
row never deleted — append-only, matching the Ledger's own convention). The
partial unique index is on `status='active'` only, so a reversed row never
blocks a later leave covering the same date. No payroll/attendance lock exists
in the codebase yet, so none is bypassed.

### Duplicate prevention
`unique index idx_leave_attendance_effects_one_active_per_date on
(employee_id, attendance_date) where status = 'active'` +
`insert … on conflict … do nothing` inside `leave_materialize_attendance_dates()`.
Re-running the materializer for the same application is a no-op.

## 3. Leave Reports

Route `/settings/leave-reports` (Super-Admin only; Sidebar "Leave Reports").
One page, a report `<Select>`, and only the filters each report actually uses.

| # | Report | Authoritative source |
|---|---|---|
| 1 | Employee Leave Ledger | `leave_ledger` rows (Summary §15 = group-by/sum by `transaction_type`) + `leave_get_balance()` (Pending/Closing) + FY-closing lines (Encashment/Lapse) |
| 2 | Employee Leave Balance | `leave_report_balances()` → `leave_get_balance()` per employee/type |
| 3 | Store-wise | `leave_report_applications()` grouped by store |
| 4 | Department-wise | `leave_report_applications()` grouped by department |
| 5 | Monthly | `leave_report_applications()` grouped by `from_date` month (no hard-coded FY range) |
| 6 | Short Leave | `leave_report_applications()` filtered `short_or_long = 'short'` (stored classification) |
| 7 | Long Leave | `leave_report_applications()` filtered `short_or_long = 'long'` |
| 8 | Pending | `leave_report_applications()` filtered pending statuses; `pending_with` computed server-side from status |
| 9 | Approval / Rejection | `leave_report_applications()` filtered `approved`/`rejected` + `decided_by`/`decided_at`/`decision_remark` |
| 10 | Leave Encashment | `leave_list_fy_closing_lines()` (confirmed batch), `encashment_days > 0` — Basic/DA/Divisor/Rate/Amount from the historical snapshot columns |
| 11 | Leave Lapse | `leave_list_fy_closing_lines()`, `lapse_days > 0` |
| 12 | Financial Year Closing | `leave_list_fy_closing_lines()` for the closed batch |
| 13 | Probation Employee | `leave_report_probation()` → `leave_resolve_eligibility()` (same resolver `leave_apply()` uses) |
| 14 | Policy Change | `leave_report_policy_changes()` → `leave_policies` versions + `audit_logs` |
| 15 | Leave Audit | `leave_report_audit()` → `audit_logs` where `table_name like 'leave\_%'` |

Store/Department/Monthly aggregation is a client-side group-by over
already-correct rows — not a second calculation engine.

**Export:** CSV via `src/lib/csvExport.ts` (no new dependency). `xlsx` / `jspdf`
already exist in the project but were not pulled into this module.

**Security:** page gated to `super_admin`; every reporting RPC re-checks
`is_super_admin()` / `current_user_role() <> 'staff'` + `company_id` inside its
SECURITY DEFINER body (RLS is bypassed inside DEFINER functions, so the check is
explicit). `leave_report_balances` raises for a `staff` caller.
`leave_attendance_effects` RLS mirrors `leave_applications` exactly; all writes
go through SECURITY DEFINER RPCs (RLS insert/update = Super-Admin-only,
defence-in-depth).

## 4. Files

**Migrations:** `0121_leave_attendance_effects_schema.sql`,
`0122_leave_decide_materialize_and_cancel_after_approval.sql`,
`0123_leave_reports_rpcs.sql`.

**New:** `src/modules/leave/pages/LeaveReportsPage.tsx`.

**Edited (additive):**
- `src/services/leaveService.ts` — 8 Phase 5 methods.
- `src/hooks/useLeave.ts` — `useLeaveAttendanceEffects` + `useLeaveReport*`.
- `src/modules/attendance/utils.ts` — `leaveEffects` arg on
  `toAttendanceRow` / `buildMonthlyAttendanceRows` / `buildDateRangeRows`
  (+ `LeaveAttendanceEffectLite`, `mapLeaveEffectsByDate`).
- `src/modules/attendance/pages/AttendancePage.tsx`,
  `src/modules/attendance/components/MonthlyAttendanceDialog.tsx`,
  `src/modules/attendance/components/ManualStaffAttendanceCard.tsx` — fetch &
  pass `leaveEffects`.
- `src/modules/attendance/components/AttendanceCalendarCard.tsx` — `leave` style
  (present from the prior session).
- `src/constants/routes.ts`, `src/router/AppRouter.tsx`,
  `src/layouts/components/Sidebar.tsx` — `leaveReports` route/nav.
- `src/types/database.types.ts` — Phase 5 RPC/table types on `LooseDatabase`.
- `src/modules/staff/pages/StaffLeavePage.tsx` — approved-leave cancel.

## 5. Not done / deferred

- **Live DB test matrix (prompt §40–42) NOT executed.** The linked Supabase
  project reports only migrations `0001`–`0016` as applied remotely; no
  service-role / DB credential is available and pushing ~107 pending migrations
  to that shared project is out of Phase 5 scope. Verification here is static
  (SQL-logic review + `npm run build`). No test is claimed as passed.
- `Balance Low` / `Leave Expiring` notifications — still need scheduler
  infrastructure; none added.
- `DATABASE.md` / `ARCHITECTURE.md` full refresh for migrations `0017`–`0123` —
  pre-existing documentation debt, not opened by Phase 5.
