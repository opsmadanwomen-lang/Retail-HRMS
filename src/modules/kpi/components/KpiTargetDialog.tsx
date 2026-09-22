import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { kpiTargetFormSchema, type KpiTargetFormSchema } from "../schema";
import { useSetEmployeeKpiTarget } from "@/hooks/useEmployeeKpi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import type { EmployeeKpiAssignment } from "@/types/kpi";

interface KpiTargetDialogProps {
  assignment: EmployeeKpiAssignment | null;
  storeId: string;
  companyId: string;
  onOpenChange: (open: boolean) => void;
}

export function KpiTargetDialog({ assignment, storeId, companyId, onOpenChange }: KpiTargetDialogProps) {
  const { user } = useAuth();
  const setTarget = useSetEmployeeKpiTarget();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<KpiTargetFormSchema>({
    resolver: zodResolver(kpiTargetFormSchema),
    defaultValues: { effectiveDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: KpiTargetFormSchema) => {
    if (!assignment) return;
    try {
      await setTarget.mutateAsync({
        kpiId: assignment.kpiId,
        employeeId: assignment.employeeId,
        storeId,
        companyId,
        values,
        userId: user?.id,
      });
      toast({ title: "Target set", variant: "success" });
      reset({ effectiveDate: new Date().toISOString().slice(0, 10) });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not set target",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={Boolean(assignment)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set Target — {assignment?.kpiName}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Target Value <span className="text-destructive">*</span>
            </Label>
            <Input type="number" step="0.01" {...register("targetValue")} />
            {errors.targetValue && <p className="text-xs text-destructive">{errors.targetValue.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Effective Date <span className="text-destructive">*</span>
              </Label>
              <Input type="date" {...register("effectiveDate")} />
            </div>
            <div className="space-y-1.5">
              <Label>Expiry Date</Label>
              <Input type="date" {...register("expiryDate")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save Target"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
