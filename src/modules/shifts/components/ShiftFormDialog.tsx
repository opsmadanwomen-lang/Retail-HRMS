import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCreateShift, useShiftStoreAssociations, useUpdateShift } from "@/hooks/useShifts";
import { useStores } from "@/hooks/useStores";
import { shiftService, type ShiftFormValues } from "@/services/shiftService";
import type { AttendanceShift } from "@/types/attendance";

interface ShiftFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: AttendanceShift | null;
}

function defaultValues(): ShiftFormValues {
  return {
    name: "",
    shiftCode: "",
    startTime: "09:30",
    endTime: "18:30",
    lateEligible: true,
    overtimeEnabled: true,
    description: "",
    isActive: true,
    storeIds: [],
  };
}

export function ShiftFormDialog({ open, onOpenChange, shift }: ShiftFormDialogProps) {
  const { user } = useAuth();
  const isEditing = Boolean(shift);
  const [values, setValues] = useState<ShiftFormValues>(defaultValues());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const storesQuery = useStores(user?.companyId ?? undefined);
  const storeAssociationsQuery = useShiftStoreAssociations(shift?.id);
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();

  useEffect(() => {
    if (!open) return;
    if (shift) {
      setValues({
        name: shift.name,
        shiftCode: shift.shiftCode ?? "",
        startTime: shift.startTime.slice(0, 5),
        endTime: shift.endTime.slice(0, 5),
        lateEligible: shift.lateEligible,
        overtimeEnabled: shift.overtimeEnabled,
        description: shift.description ?? "",
        isActive: shift.isActive,
        storeIds: [],
      });
    } else {
      setValues(defaultValues());
    }
  }, [open, shift]);

  useEffect(() => {
    if (storeAssociationsQuery.data) {
      setValues((prev) => ({ ...prev, storeIds: storeAssociationsQuery.data }));
    }
  }, [storeAssociationsQuery.data]);

  const toggleStore = (storeId: string) => {
    setValues((prev) => ({
      ...prev,
      storeIds: prev.storeIds.includes(storeId) ? prev.storeIds.filter((id) => id !== storeId) : [...prev.storeIds, storeId],
    }));
  };

  const handleSubmit = async () => {
    if (!user?.companyId) return;
    if (!values.name.trim() || !values.shiftCode.trim()) {
      toast({ title: "Shift Name and Shift Code are required.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const codeTaken = await shiftService.isCodeTaken(user.companyId, values.shiftCode, shift?.id);
      if (codeTaken) {
        toast({ title: "This Shift Code is already in use.", variant: "destructive" });
        return;
      }

      const payload: ShiftFormValues = { ...values, startTime: `${values.startTime}:00`, endTime: `${values.endTime}:00` };

      if (isEditing && shift) {
        await updateShift.mutateAsync({ id: shift.id, values: payload, userId: user.id });
        toast({ title: "Shift updated", variant: "success" });
      } else {
        await createShift.mutateAsync({ companyId: user.companyId, values: payload, userId: user.id });
        toast({ title: "Shift created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not save shift",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Shift" : "New Shift"}</DialogTitle>
          <DialogDescription>
            A Shift defines Scheduled Start/End Time and eligibility only. Late and Overtime calculation rules are
            configured separately under Attendance Rule Management.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Shift Name</Label>
              <Input value={values.name} onChange={(e) => setValues((p) => ({ ...p, name: e.target.value }))} placeholder="Morning Shift" />
            </div>
            <div className="space-y-1.5">
              <Label>Shift Code</Label>
              <Input
                className="font-mono uppercase"
                value={values.shiftCode}
                onChange={(e) => setValues((p) => ({ ...p, shiftCode: e.target.value.toUpperCase() }))}
                placeholder="MORN"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Start Time</Label>
              <Input type="time" value={values.startTime} onChange={(e) => setValues((p) => ({ ...p, startTime: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>End Time</Label>
              <Input type="time" value={values.endTime} onChange={(e) => setValues((p) => ({ ...p, endTime: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Late Eligible</Label>
              <Select
                value={values.lateEligible ? "yes" : "no"}
                onValueChange={(v) => setValues((p) => ({ ...p, lateEligible: v === "yes" }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Overtime Eligible</Label>
              <Select
                value={values.overtimeEnabled ? "yes" : "no"}
                onValueChange={(v) => setValues((p) => ({ ...p, overtimeEnabled: v === "yes" }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={values.isActive ? "active" : "inactive"} onValueChange={(v) => setValues((p) => ({ ...p, isActive: v === "active" }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description / Remark</Label>
            <Textarea
              value={values.description}
              onChange={(e) => setValues((p) => ({ ...p, description: e.target.value }))}
              placeholder="Optional notes about this shift"
            />
          </div>

          <div className="space-y-2">
            <Label>Available At Stores</Label>
            <p className="text-xs text-muted-foreground">Leave all unchecked to make this shift available company-wide.</p>
            <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-3">
              {(storesQuery.data ?? []).map((store) => (
                <label key={store.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={values.storeIds.includes(store.id)} onChange={() => toggleStore(store.id)} />
                  {store.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isEditing ? "Save Changes" : "Create Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
