import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AssignmentStatusBadge } from "./RoleStatusBadge";
import { formatDate } from "@/lib/utils";
import type { EmployeeRole } from "@/types/role";

interface ResponsibilityCardProps {
  employeeRole: EmployeeRole;
  onRemove?: (employeeRole: EmployeeRole) => void;
}

export function ResponsibilityCard({ employeeRole, onRemove }: ResponsibilityCardProps) {
  const isOpen = !employeeRole.removedAt;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{employeeRole.roleName}</p>
            <p className="text-xs text-muted-foreground">{employeeRole.categoryName ?? "—"}</p>
          </div>
          <AssignmentStatusBadge code={employeeRole.statusCode} label={employeeRole.statusLabel} />
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Assigned {formatDate(employeeRole.effectiveDate)}</span>
          {employeeRole.assignedByName && <span>By {employeeRole.assignedByName}</span>}
          {employeeRole.endDate && <span>Ends {formatDate(employeeRole.endDate)}</span>}
        </div>

        {employeeRole.remarks && <p className="text-sm">{employeeRole.remarks}</p>}

        {isOpen && onRemove && (
          <div className="flex justify-end pt-1">
            <Button variant="outline" size="sm" onClick={() => onRemove(employeeRole)}>
              Remove
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
