/**
 * Pure, date-aware shift resolution — the read-side counterpart to `isWeeklyOffOnDate` in
 * weeklyOffResolver.ts. Given an employee's full shift assignment history (oldest and newest
 * periods alike) and a specific date, finds the period whose [effectiveFrom, effectiveTo] window
 * contains that date. Never assumes "today's shift" applies to a historical date — a shift change
 * effective from a later date must not affect how earlier dates are displayed or calculated.
 * Mirrors the identical effective_from/effective_to matching done server-side in
 * attendance_punch_in()/attendance_admin_punch()/attendance_admin_upsert().
 */

export interface ShiftAssignmentPeriodLite {
  effectiveFrom: string;
  effectiveTo: string | null;
}

export function resolveShiftOnDate<T extends ShiftAssignmentPeriodLite>(periods: T[], dateKey: string): T | null {
  // Multiple periods could technically match if data is malformed; the most recently started one
  // (matching the RPCs' `order by effective_from desc limit 1`) wins.
  let best: T | null = null;
  for (const period of periods) {
    if (period.effectiveFrom <= dateKey && (!period.effectiveTo || period.effectiveTo >= dateKey)) {
      if (!best || period.effectiveFrom > best.effectiveFrom) {
        best = period;
      }
    }
  }
  return best;
}
