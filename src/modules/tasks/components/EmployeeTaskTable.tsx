import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TaskPriorityBadge, TaskStatusBadge } from "./TaskStatusBadge";
import { formatDate } from "@/lib/utils";
import type { EmployeeTaskAssignment } from "@/types/task";

interface EmployeeTaskTableProps {
  assignments: EmployeeTaskAssignment[];
  onSubmit: (assignment: EmployeeTaskAssignment) => void;
  onVerify: (assignment: EmployeeTaskAssignment) => void;
  onCancel: (assignment: EmployeeTaskAssignment) => void;
}

export function EmployeeTaskTable({ assignments, onSubmit, onVerify, onCancel }: EmployeeTaskTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Task</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.map((assignment) => {
          const canSubmit = assignment.statusCode === "pending" || assignment.statusCode === "in_progress";
          const canVerify = assignment.statusCode === "completed" && assignment.requiresVerification !== false;
          const canCancel = assignment.statusCode !== "verified" && assignment.statusCode !== "cancelled";
          return (
            <TableRow key={assignment.id}>
              <TableCell className="font-medium">{assignment.taskName}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{assignment.categoryName ?? "—"}</TableCell>
              <TableCell>
                <TaskPriorityBadge priority={assignment.priority} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(assignment.dueDate)}
                {assignment.dueTime && ` · ${assignment.dueTime}`}
              </TableCell>
              <TableCell>
                <TaskStatusBadge code={assignment.statusCode} label={assignment.statusLabel} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {canSubmit && (
                    <Button variant="ghost" size="icon" title="Complete task" onClick={() => onSubmit(assignment)}>
                      <CheckCircle2 className="h-4 w-4" />
                    </Button>
                  )}
                  {canVerify && (
                    <Button variant="ghost" size="icon" title="Verify task" onClick={() => onVerify(assignment)}>
                      <ShieldCheck className="h-4 w-4" />
                    </Button>
                  )}
                  {canCancel && (
                    <Button variant="ghost" size="icon" title="Cancel assignment" onClick={() => onCancel(assignment)}>
                      <XCircle className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
