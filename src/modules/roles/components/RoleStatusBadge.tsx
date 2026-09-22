import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  active: "success",
  inactive: "secondary",
  temporary: "warning",
  permanent: "success",
};

export function AssignmentStatusBadge({ code, label }: { code?: string; label?: string }) {
  const variant = (code && STATUS_VARIANT[code]) || "secondary";
  return <Badge variant={variant}>{label ?? "—"}</Badge>;
}

export function RoleActiveBadge({ isActive }: { isActive: boolean }) {
  return <Badge variant={isActive ? "success" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>;
}
