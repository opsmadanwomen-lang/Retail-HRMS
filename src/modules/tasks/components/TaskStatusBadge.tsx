import { Badge } from "@/components/ui/badge";
import type { TaskPriority } from "@/types/task";

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  pending: "secondary",
  in_progress: "warning",
  completed: "success",
  verified: "success",
  rejected: "destructive",
  cancelled: "secondary",
  expired: "destructive",
};

export function TaskStatusBadge({ code, label }: { code?: string; label?: string }) {
  const variant = (code && STATUS_VARIANT[code]) || "secondary";
  return <Badge variant={variant}>{label ?? "—"}</Badge>;
}

const PRIORITY_VARIANT: Record<TaskPriority, "success" | "warning" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "success",
  high: "warning",
  critical: "destructive",
};

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <Badge variant={PRIORITY_VARIANT[priority]} className="capitalize">
      {priority}
    </Badge>
  );
}

export function TaskActiveBadge({ isActive }: { isActive: boolean }) {
  return <Badge variant={isActive ? "success" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>;
}
