import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { kpiActualFormSchema, type KpiActualFormSchema } from "../schema";
import { useLogEmployeeKpiActual } from "@/hooks/useEmployeeKpi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import type { EmployeeKpiAssignment } from "@/types/kpi";

interface KpiActualDialogProps {
  assignment: EmployeeKpiAssignment | null;
  storeId: string;
  companyId: string;
  onOpenChange: (open: boolean) => void;
}

export function KpiActualDialog({ assignment, storeId, companyId, onOpenChange }: KpiActualDialogProps) {
  const { user } = useAuth();
  const logActual = useLogEmployeeKpiActual();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<KpiActualFormSchema>({
    resolver: zodResolver(kpiActualFormSchema),
  });

  const onSubmit = async (values: KpiActualFormSchema) => {
    if (!assignment) return;
    try {
      await logActual.mutateAsync({
        kpiId: assignment.kpiId,
        employeeId: assignment.employeeId,
        storeId,
        companyId,
        values,
        enteredBy: user?.id,
      });
      toast({ title: "Actual logged", variant: "success" });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not log actual",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={Boolean(assignment)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Actual — {assignment?.kpiName}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Actual Value <span className="text-destructive">*</span>
            </Label>
            <Input type="number" step="0.01" {...register("actualValue")} />
            {errors.actualValue && <p className="text-xs text-destructive">{errors.actualValue.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Period Start <span className="text-destructive">*</span>
              </Label>
              <Input type="date" {...register("periodStart")} />
              {errors.periodStart && <p className="text-xs text-destructive">{errors.periodStart.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>
                Period End <span className="text-destructive">*</span>
              </Label>
              <Input type="date" {...register("periodEnd")} />
              {errors.periodEnd && <p className="text-xs text-destructive">{errors.periodEnd.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea placeholder="Optional context for this entry…" {...register("notes")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Log Actual"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
