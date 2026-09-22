import { Badge } from "@/components/ui/badge";
import type { PerformanceEntryStatus } from "@/types/performance";

export function MetricActiveBadge({ isActive }: { isActive: boolean }) {
  return <Badge variant={isActive ? "success" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>;
}

const STATUS_VARIANT: Record<PerformanceEntryStatus, "success" | "warning" | "secondary" | "destructive"> = {
  draft: "secondary",
  submitted: "warning",
  approved: "success",
  rejected: "destructive",
  locked: "success",
};

const STATUS_LABEL: Record<PerformanceEntryStatus, string> = {
  draft: "Draft",
  submitted: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  locked: "Locked",
};

export function EntryStatusBadge({ status }: { status: PerformanceEntryStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
