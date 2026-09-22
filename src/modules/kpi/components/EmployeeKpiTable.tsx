import { Target, TrendingUp, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EmployeeKpiAssignment } from "@/types/kpi";

interface EmployeeKpiTableProps {
  assignments: EmployeeKpiAssignment[];
  onSetTarget: (assignment: EmployeeKpiAssignment) => void;
  onLogActual: (assignment: EmployeeKpiAssignment) => void;
  onRemove: (assignment: EmployeeKpiAssignment) => void;
}

export function EmployeeKpiTable({ assignments, onSetTarget, onLogActual, onRemove }: EmployeeKpiTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>KPI</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Assigned Role</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.map((assignment) => (
          <TableRow key={assignment.id}>
            <TableCell className="font-medium">{assignment.kpiName}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{assignment.categoryName ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{assignment.roleName ?? "—"}</TableCell>
            <TableCell>
              <Badge variant="secondary" className="capitalize">
                {assignment.source}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" title="Set target" onClick={() => onSetTarget(assignment)}>
                  <Target className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Log actual" onClick={() => onLogActual(assignment)}>
                  <TrendingUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Remove" onClick={() => onRemove(assignment)}>
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
