import { Pencil, Trash2, Network } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskActiveBadge, TaskPriorityBadge } from "./TaskStatusBadge";
import type { Task } from "@/types/task";

interface TaskTableProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskTable({ tasks, onEdit, onDelete }: TaskTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Task Code</TableHead>
          <TableHead>Task Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Frequency</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Mapped Roles</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="text-sm text-muted-foreground">{task.taskCode}</TableCell>
            <TableCell>
              <p className="font-medium">{task.taskName}</p>
              {task.isSystemTask && <p className="text-xs text-muted-foreground">System</p>}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{task.categoryName ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{task.frequencyLabel ?? "—"}</TableCell>
            <TableCell>
              <TaskPriorityBadge priority={task.priority} />
            </TableCell>
            <TableCell>
              <TaskActiveBadge isActive={task.isActive} />
            </TableCell>
            <TableCell>
              <Badge variant="secondary" className="gap-1">
                <Network className="h-3 w-3" />
                {task.mappedRoleCount ?? 0}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" title="Edit" onClick={() => onEdit(task)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete"
                  onClick={() => onDelete(task)}
                  disabled={task.isSystemTask}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
