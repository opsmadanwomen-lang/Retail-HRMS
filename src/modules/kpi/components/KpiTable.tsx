import { Pencil, Trash2, Network } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiActiveBadge } from "./KpiStatusBadge";
import type { Kpi } from "@/types/kpi";

interface KpiTableProps {
  kpis: Kpi[];
  onEdit: (kpi: Kpi) => void;
  onDelete: (kpi: Kpi) => void;
}

export function KpiTable({ kpis, onEdit, onDelete }: KpiTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>KPI Code</TableHead>
          <TableHead>KPI Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Calculation Type</TableHead>
          <TableHead>Target Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Mapped Roles</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {kpis.map((kpi) => (
          <TableRow key={kpi.id}>
            <TableCell className="text-sm text-muted-foreground">{kpi.kpiCode}</TableCell>
            <TableCell>
              <p className="font-medium">{kpi.kpiName}</p>
              {kpi.isSystemKpi && <p className="text-xs text-muted-foreground">System</p>}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{kpi.categoryName ?? "—"}</TableCell>
            <TableCell className="text-sm capitalize text-muted-foreground">{kpi.calculationType}</TableCell>
            <TableCell className="text-sm capitalize text-muted-foreground">{kpi.targetType}</TableCell>
            <TableCell>
              <KpiActiveBadge isActive={kpi.isActive} />
            </TableCell>
            <TableCell>
              <Badge variant="secondary" className="gap-1">
                <Network className="h-3 w-3" />
                {kpi.mappedRoleCount ?? 0}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" title="Edit" onClick={() => onEdit(kpi)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete"
                  onClick={() => onDelete(kpi)}
                  disabled={kpi.isSystemKpi}
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
