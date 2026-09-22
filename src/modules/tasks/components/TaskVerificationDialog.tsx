import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { taskVerificationFormSchema, type TaskVerificationFormSchema } from "../schema";
import { useVerifyTask } from "@/hooks/useEmployeeTask";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import type { EmployeeTaskAssignment, TaskSubmission } from "@/types/task";

interface TaskVerificationDialogProps {
  assignment: EmployeeTaskAssignment | null;
  submission: TaskSubmission | null;
  onOpenChange: (open: boolean) => void;
}

export function TaskVerificationDialog({ assignment, submission, onOpenChange }: TaskVerificationDialogProps) {
  const { user } = useAuth();
  const verifyTask = useVerifyTask();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TaskVerificationFormSchema>({
    resolver: zodResolver(taskVerificationFormSchema),
    defaultValues: { decision: "approved" },
  });

  if (!assignment) return null;

  const onSubmit = async (values: TaskVerificationFormSchema) => {
    if (!submission) {
      toast({
        title: "Cannot verify an incomplete task",
        description: "This task has no submission yet.",
        variant: "destructive",
      });
      return;
    }
    try {
      await verifyTask.mutateAsync({ submission, assignmentId: assignment.id, values, verifiedBy: user?.id });
      toast({ title: values.decision === "approved" ? "Task verified" : "Task rejected", variant: "success" });
      reset({ decision: "approved" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not verify task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={Boolean(assignment)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify — {assignment.taskName}</DialogTitle>
        </DialogHeader>

        {!submission ? (
          <p className="text-sm text-muted-foreground">
            This task hasn&apos;t been submitted yet, so it can&apos;t be verified.
          </p>
        ) : (
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
                      <SelectItem value="approved">Approve</SelectItem>
                      <SelectItem value="rejected">Reject</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Score (0-100)</Label>
              <Input type="number" min={0} max={100} step="0.01" {...register("score")} />
              {errors.score && <p className="text-xs text-destructive">{errors.score.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Remarks</Label>
              <Textarea placeholder="Feedback for this submission…" {...register("remarks")} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save Verification"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
