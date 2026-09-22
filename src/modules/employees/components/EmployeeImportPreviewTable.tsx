import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EmployeeImportPreviewRow } from "@/types/employee";

const STATE_CONFIG: Record<EmployeeImportPreviewRow["state"], { label: string; variant: "success" | "warning" | "destructive" | "secondary"; rowClass: string }> = {
  valid: { label: "Ready", variant: "success", rowClass: "" },
  error: { label: "Error", variant: "destructive", rowClass: "bg-destructive/5" },
  duplicate: { label: "Duplicate", variant: "warning", rowClass: "bg-amber-500/5" },
  needs_mapping: { label: "Needs Mapping", variant: "secondary", rowClass: "bg-muted/50" },
};

export function EmployeeImportPreviewTable({ rows }: { rows: EmployeeImportPreviewRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[1%]">Row</TableHead>
          <TableHead>Employee Name</TableHead>
          <TableHead>Store</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Designation</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const config = STATE_CONFIG[row.state];
          return (
            <TableRow key={row.rowNumber} className={cn(config.rowClass)}>
              <TableCell className="text-sm text-muted-foreground">{row.rowNumber}</TableCell>
              <TableCell className="font-medium">{row.raw.employeeName || "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.raw.store || "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.raw.department || "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.raw.designation || "—"}</TableCell>
              <TableCell>
                <Badge variant={config.variant}>{config.label}</Badge>
              </TableCell>
              <TableCell className="max-w-xs text-xs text-muted-foreground">
                {row.state === "needs_mapping"
                  ? "Department or Designation not found in this store — map manually or update the sheet."
                  : row.errors.join(" ")}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
