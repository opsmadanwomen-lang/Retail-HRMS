import { Badge } from "@/components/ui/badge";
import type { EmployeeStatus } from "@/types/database.types";

const STATUS_CONFIG: Record<EmployeeStatus, { label: string; variant: "success" | "warning" | "secondary" | "destructive" }> = {
  active: { label: "Active", variant: "success" },
  inactive: { label: "Inactive", variant: "secondary" },
  on_leave: { label: "On Leave", variant: "warning" },
  notice_period: { label: "Notice Period", variant: "warning" },
  resigned: { label: "Resigned", variant: "destructive" },
  terminated: { label: "Terminated", variant: "destructive" },
  transferred: { label: "Transferred", variant: "secondary" },
};

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  const config = STATUS_CONFIG[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
