import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAssignWeeklyOff, useBulkAssignWeeklyOff } from "@/hooks/useWeeklyOff";
import { todayDateKey } from "@/lib/dateRange";
import { WEEKDAY_LABELS } from "@/lib/weeklyOffResolver";

interface ChangeWeeklyOffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeIds: string[];
  employeeLabel: string;
  onDone?: () => void;
}

/** Handles both single-employee "Change Weekly Off" and bulk assignment. Never assumes Sunday — any weekday can be selected. */
export function ChangeWeeklyOffDialog({ open, onOpenChange, employeeIds, employeeLabel, onDone }: ChangeWeeklyOffDialogProps) {
  const { user } = useAuth();
  const assignWeeklyOff = useAssignWeeklyOff();
  const bulkAssignWeeklyOff = useBulkAssignWeeklyOff();

  const [weeklyOffDay, setWeeklyOffDay] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");

  const isBulk = employeeIds.length > 1;
  const isPending = assignWeeklyOff.isPending || bulkAssignWeeklyOff.isPending;

  const handleSave = async () => {
    if (!user?.companyId || employeeIds.length === 0) return;

    try {
      if (isBulk) {
        const result = await bulkAssignWeeklyOff.mutateAsync({
          employeeIds,
          companyId: user.companyId,
          weeklyOffDay: Number(weeklyOffDay),
          effectiveFrom,
          remark: remark.trim() || undefined,
          userId: user.id,
        });
        toast({ title: "Weekly off assigned", description: `${result.updated} updated, ${result.failed} failed.`, variant: "success" });
      } else {
        await assignWeeklyOff.mutateAsync({
          employeeId: employeeIds[0],
          companyId: user.companyId,
          weeklyOffDay: Number(weeklyOffDay),
          effectiveFrom,
          remark: remark.trim() || undefined,
          userId: user.id,
        });
        toast({ title: "Weekly off changed", variant: "success" });
      }
      setRemark("");
      onOpenChange(false);
      onDone?.();
    } catch (error) {
      toast({
        title: "Could not change weekly off",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isBulk ? `Change Weekly Off for ${employeeIds.length} employees` : "Change Weekly Off"}</DialogTitle>
          <DialogDescription>
            {employeeLabel}. Dates before the effective date keep using the previous weekly off — nothing in the past is recalculated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>New Weekly Off</Label>
            <Select value={weeklyOffDay} onValueChange={setWeeklyOffDay}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAY_LABELS.map((label, index) => (
                  <SelectItem key={label} value={String(index)}>
                    {label}
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
            <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Weekly off changed as per store requirement." />
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
