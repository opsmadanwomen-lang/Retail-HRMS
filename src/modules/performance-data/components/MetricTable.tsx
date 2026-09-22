import { Pencil, Trash2, Network } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricActiveBadge } from "./StatusBadges";
import type { Metric } from "@/types/performance";

interface MetricTableProps {
  metrics: Metric[];
  onEdit: (metric: Metric) => void;
  onDelete: (metric: Metric) => void;
}

export function MetricTable({ metrics, onEdit, onDelete }: MetricTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Metric Code</TableHead>
          <TableHead>Metric Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Measurement Unit</TableHead>
          <TableHead>Calculation Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Mappings</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {metrics.map((metric) => (
          <TableRow key={metric.id}>
            <TableCell className="text-sm text-muted-foreground">{metric.metricCode}</TableCell>
            <TableCell>
              <p className="font-medium">{metric.metricName}</p>
              {metric.isSystemMetric && <p className="text-xs text-muted-foreground">System</p>}
            </TableCell>
            <TableCell className="text-sm capitalize text-muted-foreground">{metric.category}</TableCell>
            <TableCell className="text-sm capitalize text-muted-foreground">{metric.measurementUnit}</TableCell>
            <TableCell className="text-sm capitalize text-muted-foreground">{metric.calculationType}</TableCell>
            <TableCell>
              <MetricActiveBadge isActive={metric.isActive} />
            </TableCell>
            <TableCell>
              <Badge variant="secondary" className="gap-1">
                <Network className="h-3 w-3" />
                {metric.mappingCount ?? 0}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" title="Edit" onClick={() => onEdit(metric)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete"
                  onClick={() => onDelete(metric)}
                  disabled={metric.isSystemMetric}
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
