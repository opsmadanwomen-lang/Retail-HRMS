import { Pencil, Trash2, Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoleActiveBadge } from "./RoleStatusBadge";
import type { Role } from "@/types/role";

interface RoleTableProps {
  roles: Role[];
  onEdit: (role: Role) => void;
  onDelete: (role: Role) => void;
}

export function RoleTable({ roles, onEdit, onDelete }: RoleTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Role Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Role Type</TableHead>
          <TableHead>Assigned Employees</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {roles.map((role) => (
          <TableRow key={role.id}>
            <TableCell>
              <p className="font-medium">{role.roleName}</p>
              <p className="text-xs text-muted-foreground">
                {role.roleCode} {role.isSystemRole && <span className="ml-1">· System</span>}
              </p>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{role.categoryName ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{role.departmentName ?? "—"}</TableCell>
            <TableCell className="text-sm capitalize text-muted-foreground">{role.roleType}</TableCell>
            <TableCell>
              <Badge variant="secondary" className="gap-1">
                <Users className="h-3 w-3" />
                {role.assignedEmployeeCount ?? 0}
              </Badge>
            </TableCell>
            <TableCell>
              <RoleActiveBadge isActive={role.isActive} />
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" title="Edit" onClick={() => onEdit(role)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete"
                  onClick={() => onDelete(role)}
                  disabled={role.isSystemRole}
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
