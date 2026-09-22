import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingState } from "@/components/common/LoadingState";
import { useShiftAssignmentHistory } from "@/hooks/useShifts";
import { useWeeklyOffHistory } from "@/hooks/useWeeklyOff";
import { formatDate } from "@/lib/utils";
import { WEEKDAY_LABELS } from "@/lib/weeklyOffResolver";

interface ScheduleHistoryDialogProps {
  employeeId: string | null;
  employeeName: string;
  onClose: () => void;
}

/** Shift History + Weekly Off History for one employee — nothing here is ever overwritten by a later change. */
export function ScheduleHistoryDialog({ employeeId, employeeName, onClose }: ScheduleHistoryDialogProps) {
  const shiftHistory = useShiftAssignmentHistory(employeeId ?? undefined);
  const weeklyOffHistory = useWeeklyOffHistory(employeeId ?? undefined);

  return (
    <Dialog open={Boolean(employeeId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Schedule History</DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-6 overflow-y-auto">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Shift History</h3>
            {shiftHistory.isLoading ? (
              <LoadingState />
            ) : (shiftHistory.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No shift assignments yet.</p>
            ) : (
              <Table containerClassName="max-h-64">
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead>Shift</TableHead>
                    <TableHead>Timing</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Remark</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(shiftHistory.data ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.shift.name}</TableCell>
                      <TableCell>
                        {row.shift.startTime.slice(0, 5)}–{row.shift.endTime.slice(0, 5)}
                      </TableCell>
                      <TableCell>{formatDate(row.effectiveFrom)}</TableCell>
                      <TableCell>{row.effectiveTo ? formatDate(row.effectiveTo) : "Current"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.remark ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Weekly Off History</h3>
            {weeklyOffHistory.isLoading ? (
              <LoadingState />
            ) : (weeklyOffHistory.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No weekly off assigned yet.</p>
            ) : (
              <Table containerClassName="max-h-64">
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead>Weekly Off</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Remark</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...(weeklyOffHistory.data ?? [])].reverse().map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{WEEKDAY_LABELS[row.weeklyOffDay]}</TableCell>
                      <TableCell>{formatDate(row.effectiveFrom)}</TableCell>
                      <TableCell>{row.effectiveTo ? formatDate(row.effectiveTo) : "Current"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.remark ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
