import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useKpis } from "@/hooks/useKpis";
import { useAssignKpiToEmployee } from "@/hooks/useEmployeeKpi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import type { EmployeeKpiAssignment } from "@/types/kpi";

interface AssignKpiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  storeId: string;
  companyId: string;
  existingAssignments: EmployeeKpiAssignment[];
}

export function AssignKpiDialog({ open, onOpenChange, employeeId, storeId, companyId, existingAssignments }: AssignKpiDialogProps) {
  const { user } = useAuth();
  const { data: kpis } = useKpis({ companyId, isActive: true });
  const assignKpi = useAssignKpiToEmployee();
  const [kpiId, setKpiId] = useState("");

  const assignedIds = new Set(existingAssignments.map((a) => a.kpiId));
  const availableKpis = (kpis ?? []).filter((k) => !assignedIds.has(k.id));

  const handleSubmit = async () => {
    if (!kpiId) return;
    try {
      await assignKpi.mutateAsync({
        employeeId,
        kpiId,
        roleId: null,
        storeId,
        companyId,
        source: "manual",
        assignedBy: user?.id,
      });
      toast({ title: "KPI assigned", variant: "success" });
      setKpiId("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not assign KPI",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a KPI</DialogTitle>
          <DialogDescription>Manually assign a KPI to this employee, outside of their role mapping.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>KPI</Label>
          <Select value={kpiId} onValueChange={setKpiId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a KPI" />
            </SelectTrigger>
            <SelectContent>
              {availableKpis.map((kpi) => (
                <SelectItem key={kpi.id} value={kpi.id}>
                  {kpi.kpiName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!kpiId || assignKpi.isPending}>
            {assignKpi.isPending ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
