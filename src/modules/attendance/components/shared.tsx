import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_VARIANTS } from "@/constants/attendance";
import type { AttendanceStatus } from "@/types/database.types";
import type { NightDutyDisplayStatus } from "@/modules/attendance/utils";

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  return (
    <Badge variant={ATTENDANCE_STATUS_VARIANTS[status] ?? "default"} className="capitalize">
      {ATTENDANCE_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * The "Night Duty" cell/column — used everywhere a per-day attendance row is shown (Monthly
 * Attendance, Staff View date range, the Monthly Attendance popup, the Admin Daily Attendance
 * Records table). Reads only what modules/attendance/utils.ts already resolved from the Night
 * Duty approval — never a second calculation.
 */
export function NightDutyCell({ status, days, nightOtMinutes }: { status: NightDutyDisplayStatus; days: number; nightOtMinutes: number }) {
  if (status === "none") return <span className="text-muted-foreground">—</span>;

  const label = status === "approved" ? "Approved" : status === "disallowed" ? "Disallowed" : "Pending";
  const variant = status === "approved" ? "default" : status === "disallowed" ? "destructive" : "secondary";

  return (
    <div className="space-y-0.5 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{days} Day{days === 1 ? "" : "s"}</span>
        <Badge variant={variant} className="text-[10px]">{label}</Badge>
      </div>
      {status === "approved" ? <div className="text-xs text-muted-foreground">Night OT: {nightOtMinutes} min</div> : null}
    </div>
  );
}

export function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
