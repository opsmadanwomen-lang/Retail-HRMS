import { Pencil, Trash2, Lock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EntryStatusBadge } from "./StatusBadges";
import { formatDate } from "@/lib/utils";
import type { PerformanceEntry } from "@/types/performance";

interface EntryTableProps {
  entries: PerformanceEntry[];
  onEdit?: (entry: PerformanceEntry) => void;
  onDelete?: (entry: PerformanceEntry) => void;
}

export function EntryTable({ entries, onEdit, onDelete }: EntryTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Metric</TableHead>
          <TableHead>Employee / Store</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Status</TableHead>
          {(onEdit || onDelete) && <TableHead className="w-[1%] text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="text-sm text-muted-foreground">{formatDate(entry.entryDate)}</TableCell>
            <TableCell className="font-medium">{entry.metricName}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{entry.employeeName ?? entry.storeName}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{entry.departmentName ?? "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{entry.roleName ?? "—"}</TableCell>
            <TableCell className="font-medium">
              {entry.entryValue} <span className="text-xs text-muted-foreground">{entry.measurementUnit}</span>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{entry.sourceLabel ?? "—"}</TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <EntryStatusBadge status={entry.status} />
                {entry.isLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
            </TableCell>
            {(onEdit || onDelete) && (
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {onEdit && (
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => onEdit(entry)} disabled={entry.isLocked}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => onDelete(entry)}
                      disabled={entry.isLocked}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
