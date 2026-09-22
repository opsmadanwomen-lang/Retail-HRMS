import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useBulkAssignShift, useChangeShift, useShifts } from "@/hooks/useShifts";
import { todayDateKey } from "@/lib/dateRange";

interface ChangeShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeIds: string[];
  employeeLabel: string;
  onDone?: () => void;
}

/** Handles both single-employee "Change Shift" and bulk assignment — same underlying call, one row per employee, others are never touched. */
export function ChangeShiftDialog({ open, onOpenChange, employeeIds, employeeLabel, onDone }: ChangeShiftDialogProps) {
  const { user } = useAuth();
  const shiftsQuery = useShifts(user?.companyId ?? undefined);
  const changeShift = useChangeShift();
  const bulkAssignShift = useBulkAssignShift();

  const [shiftId, setShiftId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");

  const isBulk = employeeIds.length > 1;
  const isPending = changeShift.isPending || bulkAssignShift.isPending;

  const handleSave = async () => {
    if (!user?.companyId || !shiftId || employeeIds.length === 0) {
      toast({ title: "Select a shift first.", variant: "destructive" });
      return;
    }

    try {
      if (isBulk) {
        const result = await bulkAssignShift.mutateAsync({
          employeeIds,
          companyId: user.companyId,
          shiftId,
          effectiveFrom,
          remark: remark.trim() || undefined,
          userId: user.id,
        });
        toast({ title: "Shift assigned", description: `${result.updated} updated, ${result.failed} failed.`, variant: "success" });
      } else {
        await changeShift.mutateAsync({
          employeeId: employeeIds[0],
          companyId: user.companyId,
          shiftId,
          effectiveFrom,
          remark: remark.trim() || undefined,
          userId: user.id,
        });
        toast({ title: "Shift changed", variant: "success" });
      }
      setShiftId("");
      setRemark("");
      onOpenChange(false);
      onDone?.();
    } catch (error) {
      toast({
        title: "Could not change shift",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isBulk ? `Change Shift for ${employeeIds.length} employees` : "Change Shift"}</DialogTitle>
          <DialogDescription>
            {employeeLabel}. Past attendance keeps using whichever shift was in effect on that date — this only changes what applies from the effective date onward.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>New Shift</Label>
            <Select value={shiftId} onValueChange={setShiftId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a shift" />
              </SelectTrigger>
              <SelectContent>
                {(shiftsQuery.data ?? [])
                  .filter((s) => s.isActive)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Effective From</Label>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Remark</Label>
            <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Shift changed as per store requirement." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
