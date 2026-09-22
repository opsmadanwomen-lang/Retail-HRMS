/**
 * Pure, date-aware weekly-off resolution — shared by every screen that needs to know "was this
 * date a weekly off for this employee". Priority (highest first):
 *   1. An override naming this exact date as the NEW off day       -> weekly off
 *   2. An override naming this exact date as the ORIGINAL off day  -> NOT weekly off (working)
 *   3. The recurring weekly-off pattern in effect on this date
 * Never assumes Sunday — each employee's own history decides which weekday (0=Sun..6=Sat) applies,
 * and a shift/weekly-off change never rewrites what was true for a past date.
 */

export interface WeeklyOffPeriodLite {
  weeklyOffDay: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface WeeklyOffOverrideLite {
  originalOffDate: string;
  newOffDate: string;
}

export function isWeeklyOffOnDate(
  dateKey: string,
  periods: WeeklyOffPeriodLite[],
  overrides: WeeklyOffOverrideLite[]
): boolean {
  if (overrides.some((o) => o.newOffDate === dateKey)) return true;
  if (overrides.some((o) => o.originalOffDate === dateKey)) return false;

  const period = periods.find((p) => p.effectiveFrom <= dateKey && (!p.effectiveTo || p.effectiveTo >= dateKey));
  if (!period) return false;

  const [year, month, day] = dateKey.split("-").map(Number);
  const dayOfWeek = new Date(year, month - 1, day).getDay();
  return dayOfWeek === period.weeklyOffDay;
}

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
