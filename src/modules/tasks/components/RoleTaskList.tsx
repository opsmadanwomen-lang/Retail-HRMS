import { Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TaskPriorityBadge } from "./TaskStatusBadge";
import type { RoleTaskMapping } from "@/types/task";

interface RoleTaskListProps {
  mappings: RoleTaskMapping[];
  onRemove: (mapping: RoleTaskMapping) => void;
}

export function RoleTaskList({ mappings, onRemove }: RoleTaskListProps) {
  if (mappings.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks mapped to this role yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Task</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Frequency</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mappings.map((mapping) => (
          <TableRow key={mapping.id}>
            <TableCell className="font-medium">{mapping.taskName}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{mapping.categoryName ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{mapping.frequencyLabel ?? "—"}</TableCell>
            <TableCell>{mapping.priority && <TaskPriorityBadge priority={mapping.priority} />}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="icon" title="Remove from role" onClick={() => onRemove(mapping)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
