import { Link } from "react-router-dom";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmployeeStatusBadge } from "./EmployeeStatusBadge";
import type { Employee } from "@/types/employee";
import { initialsFromName } from "@/lib/utils";

interface EmployeeTableProps {
  employees: Employee[];
  onDelete: (employee: Employee) => void;
  /** grade id → "M1 — Unskilled", built from the Grade master; an id missing from it renders "—". */
  gradeLabels?: Map<string, string>;
}

export function EmployeeTable({ employees, onDelete, gradeLabels }: EmployeeTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[1%]">Photo</TableHead>
          <TableHead>Employee Code</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Store</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Designation</TableHead>
          <TableHead>Grade</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Reporting Manager</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {employees.map((employee) => (
          <TableRow key={employee.id}>
            <TableCell>
              <Avatar>
                <AvatarImage src={employee.photoUrl ?? undefined} alt={employee.fullName} />
                <AvatarFallback>{initialsFromName(employee.fullName)}</AvatarFallback>
              </Avatar>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{employee.employeeCode ?? "—"}</TableCell>
            <TableCell>
              <Link to={`/employees/${employee.id}`} className="font-medium hover:underline">
                {employee.fullName}
              </Link>
              {employee.email && <p className="text-xs text-muted-foreground">{employee.email}</p>}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {employee.employeeScope === "company_wide" ? "Company Wide" : employee.storeName ?? "—"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{employee.departmentName ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{employee.designationTitle ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{(employee.gradeId && gradeLabels?.get(employee.gradeId)) || "—"}</TableCell>
            <TableCell>
              <EmployeeStatusBadge status={employee.status} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{employee.reportingManagerName ?? "—"}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" asChild title="View profile">
                  <Link to={`/employees/${employee.id}`}>
                    <Eye className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" asChild title="Edit">
                  <Link to={`/employees/${employee.id}/edit`}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" title="Delete" onClick={() => onDelete(employee)}>
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
