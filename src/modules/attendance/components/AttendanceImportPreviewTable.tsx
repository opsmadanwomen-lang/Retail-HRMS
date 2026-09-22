import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { formatMinutes } from "@/modules/attendance/utils";
import type { AttendanceImportPreviewRow } from "@/types/attendanceImport";

const STATE_CONFIG: Record<
  AttendanceImportPreviewRow["state"],
  { label: string; icon: string; variant: "success" | "warning" | "destructive" | "default"; rowClass: string }
> = {
  valid: { label: "New", icon: "✓", variant: "success", rowClass: "" },
  update: { label: "Update", icon: "↻", variant: "default", rowClass: "bg-blue-500/5" },
  warning: { label: "Warning", icon: "⚠", variant: "warning", rowClass: "bg-amber-500/5" },
  error: { label: "Error", icon: "✕", variant: "destructive", rowClass: "bg-destructive/5" },
};

function dayTag(row: AttendanceImportPreviewRow): string {
  if (row.weeklyOff) return "Weekly Off";
  if (row.holiday) return "Holiday";
  if (row.leave) return "Leave";
  return "—";
}

export function AttendanceImportPreviewTable({ rows }: { rows: AttendanceImportPreviewRow[] }) {
  return (
    <div className="overflow-x-auto">
      <Table containerClassName="max-h-[55vh]">
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow>
            <TableHead className="w-[1%]">Row</TableHead>
            <TableHead>Staff ID</TableHead>
            <TableHead>Staff Name</TableHead>
            <TableHead>Match</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Punch In</TableHead>
            <TableHead>Punch Out</TableHead>
            <TableHead>Shift</TableHead>
            <TableHead>Off / Holiday / Leave</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Late</TableHead>
            <TableHead>Early Going</TableHead>
            <TableHead>Total Working</TableHead>
            <TableHead>Break</TableHead>
            <TableHead>Final Working</TableHead>
            <TableHead>Overtime</TableHead>
            <TableHead>Validation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const config = STATE_CONFIG[row.state];
            const ot = (row.overtimeMinutes ?? 0) + (row.nightOtMinutes ?? 0);
            return (
              <TableRow key={row.rowNumber} className={cn(config.rowClass)}>
                <TableCell className="text-sm text-muted-foreground">{row.rowNumber}</TableCell>
                <TableCell className="font-medium">{row.staffId || row.raw.staffId || "—"}</TableCell>
                <TableCell>{row.employeeName ?? row.staffName ?? row.raw.staffName ?? "—"}</TableCell>
                <TableCell>
                  {row.employeeId ? (
                    row.nameMatch ? (
                      <Badge variant="success" className="text-[10px]">By Staff ID</Badge>
                    ) : (
                      <Badge variant="warning" className="text-[10px]">Name differs</Badge>
                    )
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">Not found</Badge>
                  )}
                </TableCell>
                <TableCell>{row.date ? formatDate(row.date) : row.raw.date || "—"}</TableCell>
                <TableCell>{row.punchIn ?? (row.raw.punchIn || "—")}</TableCell>
                <TableCell>{row.punchOut ?? (row.raw.punchOut || "—")}</TableCell>
                <TableCell className="text-xs">{row.shiftName ?? "—"}</TableCell>
                <TableCell className="text-xs">{dayTag(row)}</TableCell>
                <TableCell className="capitalize">{row.calcStatus ? row.calcStatus.replace("_", " ") : "—"}</TableCell>
                <TableCell>{row.lateMinutes ? formatMinutes(row.lateMinutes) : "—"}</TableCell>
                <TableCell>{row.earlyGoingMinutes ? formatMinutes(row.earlyGoingMinutes) : "—"}</TableCell>
                <TableCell>{formatMinutes(row.totalWorkingMinutes ?? 0)}</TableCell>
                <TableCell>{formatMinutes(row.breakDeductionMinutes ?? 0)}</TableCell>
                <TableCell>{formatMinutes(row.workingMinutes ?? 0)}</TableCell>
                <TableCell>{ot ? formatMinutes(ot) : "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={config.variant} className="w-fit">
                      {config.icon} {config.label}
                    </Badge>
                    {row.errors.length > 0 ? (
                      <p className="max-w-xs text-xs text-destructive">{row.errors.join(" ")}</p>
                    ) : null}
                    {row.warnings.length > 0 ? (
                      <p className="max-w-xs text-xs text-amber-600">{row.warnings.join(" ")}</p>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
