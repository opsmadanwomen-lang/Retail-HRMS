import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { metricApprovalFormSchema, type MetricApprovalFormSchema } from "../schema";
import { useDecideMetricApproval } from "@/hooks/useMetricApproval";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import type { PerformanceEntry } from "@/types/performance";

interface ApprovalDialogProps {
  entry: PerformanceEntry | null;
  onOpenChange: (open: boolean) => void;
}

export function ApprovalDialog({ entry, onOpenChange }: ApprovalDialogProps) {
  const { user } = useAuth();
  const decide = useDecideMetricApproval();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<MetricApprovalFormSchema>({
    resolver: zodResolver(metricApprovalFormSchema),
    defaultValues: { decision: "approved" },
  });

  if (!entry) return null;

  const onSubmit = async (values: MetricApprovalFormSchema) => {
    try {
      await decide.mutateAsync({ entryId: entry.id, values, verifierId: user?.id });
      toast({ title: values.decision === "approved" ? "Entry approved" : "Entry rejected", variant: "success" });
      reset({ decision: "approved" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not record decision",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Review — {entry.metricName} ({entry.employeeName ?? entry.storeName})
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Value: <span className="font-medium text-foreground">{entry.entryValue}</span> {entry.measurementUnit}
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label>Decision</Label>
            <Controller
              name="decision"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approve (locks the entry)</SelectItem>
                    <SelectItem value="rejected">Reject</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Textarea placeholder="Optional notes for this decision…" {...register("remarks")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Submit Decision"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
