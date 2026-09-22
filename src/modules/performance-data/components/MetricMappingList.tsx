import { Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { MetricMapping } from "@/types/performance";

interface MetricMappingListProps {
  mappings: MetricMapping[];
  onRemove: (mapping: MetricMapping) => void;
}

export function MetricMappingList({ mappings, onRemove }: MetricMappingListProps) {
  if (mappings.length === 0) {
    return <p className="text-sm text-muted-foreground">No mappings yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Metric</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Store</TableHead>
          <TableHead>Employee</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mappings.map((mapping) => (
          <TableRow key={mapping.id}>
            <TableCell className="font-medium">{mapping.metricName}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{mapping.roleName ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{mapping.departmentName ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{mapping.storeName ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{mapping.employeeName ?? "—"}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="icon" title="Remove mapping" onClick={() => onRemove(mapping)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
