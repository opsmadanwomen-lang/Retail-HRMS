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
import { useTasks } from "@/hooks/useTasks";
import { useAddTaskToRole } from "@/hooks/useRoleTask";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import type { RoleTaskMapping } from "@/types/task";

interface AddTaskToRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleId: string;
  companyId: string | null;
  existingMappings: RoleTaskMapping[];
}

export function AddTaskToRoleDialog({ open, onOpenChange, roleId, companyId, existingMappings }: AddTaskToRoleDialogProps) {
  const { user } = useAuth();
  const { data: tasks } = useTasks({ companyId: companyId ?? undefined, isActive: true });
  const addTask = useAddTaskToRole();
  const [taskId, setTaskId] = useState("");

  const mappedTaskIds = new Set(existingMappings.map((m) => m.taskId));
  const availableTasks = (tasks ?? []).filter((t) => !mappedTaskIds.has(t.id));

  const handleSubmit = async () => {
    if (!taskId) return;
    try {
      await addTask.mutateAsync({ roleId, taskId, companyId, userId: user?.id });
      toast({ title: "Task mapped", variant: "success" });
      setTaskId("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not map task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a Task to this Role</DialogTitle>
          <DialogDescription>Every employee holding this role can be assigned this task.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Task</Label>
          <Select value={taskId} onValueChange={setTaskId}>
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
          {availableTasks.length === 0 && (
            <p className="text-xs text-muted-foreground">Every active task is already mapped to this role.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!taskId || addTask.isPending}>
            {addTask.isPending ? "Adding…" : "Add Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
