import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MonthlyAttendanceRow } from "@/modules/attendance/utils";

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function statusColor(row: MonthlyAttendanceRow): string {
  if (row.isFuture) return "bg-transparent";
  if (row.status === "weekly_off") return "bg-muted-foreground/20";
  if (row.status === "absent") return "bg-destructive/15 text-destructive";
  // Half Day Leave keeps the existing 'half_day' status value (never a full-day Leave conversion) —
  // shown with its own colour so it's visually distinct from a half-day Present.
  if (row.status === "leave") return "bg-blue-600/15 text-blue-700 dark:text-blue-400";
  if ((row.lateMinutes ?? 0) > 0) return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
  if (row.status === "present" || row.status === "half_day") return "bg-green-600/15 text-green-700 dark:text-green-400";
  return "bg-transparent";
}

/**
 * Monthly attendance calendar — a pure alternate VISUALIZATION of the SAME rows the Monthly
 * Attendance table below already renders (buildMonthlyAttendanceRows()) — reads status/lateMinutes
 * exactly as already resolved, never recalculates anything.
 */
export function AttendanceCalendarCard({ rows, selectedDate }: { rows: MonthlyAttendanceRow[]; selectedDate: string }) {
  // Rows are 01 -> last day of month, in order. Pad the front so the grid aligns Monday-first.
  const firstDow = rows.length > 0 ? new Date(rows[0].date).getDay() : 1; // 0=Sun..6=Sat
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance Calendar</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground sm:gap-1.5">
          {WEEKDAY_HEADERS.map((d) => (
            <div key={d} className="py-0.5">
              {d}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1 sm:gap-1.5">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {rows.map((row) => {
            const isSelected = row.date === selectedDate;
            const dayNumber = Number(row.date.slice(-2));
            return (
              <div
                key={row.date}
                title={`${row.date} · ${row.status.replace("_", " ")}${row.lateMinutes ? ` · Late ${row.lateMinutes} min` : ""}`}
                className={cn(
                  "flex h-8 flex-col items-center justify-center rounded-md border text-xs leading-none sm:h-9 sm:text-sm",
                  statusColor(row),
                  isSelected && "border-primary ring-1 ring-primary"
                )}
              >
                {dayNumber}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-green-600/60" /> Present
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-500/60" /> Late
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" /> Absent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-600/60" /> Leave
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" /> Weekly Off
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-primary" /> Selected / Today
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
