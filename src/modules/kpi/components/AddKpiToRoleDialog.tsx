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
import { useAddKpiToRole } from "@/hooks/useRoleKpi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import type { RoleKpiMapping } from "@/types/kpi";

interface AddKpiToRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleId: string;
  companyId: string | null;
  existingMappings: RoleKpiMapping[];
}

export function AddKpiToRoleDialog({ open, onOpenChange, roleId, companyId, existingMappings }: AddKpiToRoleDialogProps) {
  const { user } = useAuth();
  const { data: kpis } = useKpis({ companyId: companyId ?? undefined, isActive: true });
  const addKpi = useAddKpiToRole();
  const [kpiId, setKpiId] = useState<string>("");

  const mappedKpiIds = new Set(existingMappings.map((m) => m.kpiId));
  const availableKpis = (kpis ?? []).filter((k) => !mappedKpiIds.has(k.id));

  const handleSubmit = async () => {
    if (!kpiId) return;
    try {
      await addKpi.mutateAsync({ roleId, kpiId, companyId, weightage: 0, userId: user?.id });
      toast({ title: "KPI mapped", description: "Set its weightage below so the total still equals 100%.", variant: "success" });
      setKpiId("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not map KPI",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a KPI to this Role</DialogTitle>
          <DialogDescription>You'll set its weightage right after adding it.</DialogDescription>
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
          {availableKpis.length === 0 && (
            <p className="text-xs text-muted-foreground">Every active KPI is already mapped to this role.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!kpiId || addKpi.isPending}>
            {addKpi.isPending ? "Adding…" : "Add KPI"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
