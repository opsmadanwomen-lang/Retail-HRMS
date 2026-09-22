/**
 * Timezone-safe date helpers for attendance date arithmetic.
 *
 * IMPORTANT: never build a "YYYY-MM-DD" key via `new Date(y, m, d).toISOString()`.
 * `toISOString()` converts to UTC — in timezones ahead of UTC (e.g. IST, UTC+5:30),
 * local midnight rolls back to the previous day (e.g. 01 Aug local -> 31 Jul UTC).
 * All date-key construction here stays in local-calendar arithmetic and formats the
 * key directly from year/month/day, so it is immune to that shift.
 */

export interface CalendarDay {
  dateKey: string;
  day: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Number of days in the given month (month is 1-indexed). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function firstDateOfMonth(year: number, month: number): string {
  return toDateKey(year, month, 1);
}

export function lastDateOfMonth(year: number, month: number): string {
  return toDateKey(year, month, daysInMonth(year, month));
}

function weekdayShort(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", { weekday: "short" });
}

/** Every calendar day of the given month, in order — 01 -> last day, never spilling into the previous month. */
export function enumerateMonthDates(year: number, month: number): CalendarDay[] {
  const total = daysInMonth(year, month);
  const days: CalendarDay[] = [];
  for (let day = 1; day <= total; day += 1) {
    days.push({ dateKey: toDateKey(year, month, day), day: weekdayShort(year, month, day) });
  }
  return days;
}

/** Every calendar day from fromDate to toDate inclusive (both "YYYY-MM-DD"). */
export function enumerateDateRange(fromDate: string, toDate: string): CalendarDay[] {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);

  const days: CalendarDay[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push({
      dateKey: toDateKey(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()),
      day: cursor.toLocaleDateString("en-IN", { weekday: "short" }),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function weekdayFromDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return weekdayShort(y, m, d);
}

export function todayDateKey(): string {
  const now = new Date();
  return toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}
