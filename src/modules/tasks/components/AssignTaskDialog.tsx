import { useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignTaskFormSchema, type AssignTaskFormSchema, TASK_PRIORITY_OPTIONS } from "../schema";
import { useTasks } from "@/hooks/useTasks";
import { useTaskStatuses } from "@/hooks/useTaskLookups";
import { useEmployeeTasks, useAssignTask } from "@/hooks/useEmployeeTask";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

interface AssignTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  roleId: string | null;
  storeId: string;
  companyId: string;
}

export function AssignTaskDialog({ open, onOpenChange, employeeId, roleId, storeId, companyId }: AssignTaskDialogProps) {
  const { user } = useAuth();
  const { data: tasks } = useTasks({ companyId, isActive: true });
  const { data: statuses } = useTaskStatuses();
  const { data: existingAssignments } = useEmployeeTasks(employeeId);
  const assignTask = useAssignTask();

  const assignedTaskIds = useMemo(() => new Set((existingAssignments ?? []).map((a) => a.taskId)), [existingAssignments]);
  const availableTasks = (tasks ?? []).filter((t) => !assignedTaskIds.has(t.id));

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignTaskFormSchema>({
    resolver: zodResolver(assignTaskFormSchema),
    defaultValues: { priority: "medium", dueDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: AssignTaskFormSchema) => {
    try {
      await assignTask.mutateAsync({ employeeId, roleId, storeId, companyId, values, assignedBy: user?.id });
      toast({ title: "Task assigned", variant: "success" });
      reset({ priority: "medium", dueDate: new Date().toISOString().slice(0, 10) });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not assign task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a Task</DialogTitle>
          <DialogDescription>Assign a task to this employee with a due date and priority.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Task <span className="text-destructive">*</span>
            </Label>
            <Controller
              name="taskId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a task" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTasks.map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.taskName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.taskId && <p className="text-xs text-destructive">{errors.taskId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>
              Status <span className="text-destructive">*</span>
            </Label>
            <Controller
              name="statusId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                  <SelectContent>
                    {(statuses ?? []).map((status) => (
                      <SelectItem key={status.id} value={status.id}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.statusId && <p className="text-xs text-destructive">{errors.statusId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Controller
              name="priority"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Due Date <span className="text-destructive">*</span>
              </Label>
              <Input type="date" {...register("dueDate")} />
              {errors.dueDate && <p className="text-xs text-destructive">{errors.dueDate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Due Time</Label>
              <Input type="time" {...register("dueTime")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || availableTasks.length === 0}>
              {isSubmitting ? "Saving…" : "Assign Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
