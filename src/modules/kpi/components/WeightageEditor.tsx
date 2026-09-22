import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RoleKpiMapping } from "@/types/kpi";

interface WeightageEditorProps {
  mappings: RoleKpiMapping[];
  onSave: (entries: Array<{ roleKpiMappingId: string; weightage: number }>) => void;
  onRemove: (mapping: RoleKpiMapping) => void;
  isSaving?: boolean;
}

export function WeightageEditor({ mappings, onSave, onRemove, isSaving }: WeightageEditorProps) {
  const [values, setValues] = useState<Record<string, number>>({});

  useEffect(() => {
    setValues(Object.fromEntries(mappings.map((m) => [m.id, m.currentWeightage ?? 0])));
  }, [mappings]);

  const total = Object.values(values).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  const isValidTotal = Math.round(total * 100) / 100 === 100;

  if (mappings.length === 0) {
    return <p className="text-sm text-muted-foreground">No KPIs mapped to this role yet.</p>;
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>KPI</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Calculation Type</TableHead>
            <TableHead>Target Type</TableHead>
            <TableHead className="w-32">Weightage (%)</TableHead>
            <TableHead className="w-[1%] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mappings.map((mapping) => (
            <TableRow key={mapping.id}>
              <TableCell className="font-medium">{mapping.kpiName}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{mapping.categoryName ?? "—"}</TableCell>
              <TableCell className="text-sm capitalize text-muted-foreground">{mapping.calculationType}</TableCell>
              <TableCell className="text-sm capitalize text-muted-foreground">{mapping.targetType}</TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={values[mapping.id] ?? 0}
                  onChange={(e) => setValues((prev) => ({ ...prev, [mapping.id]: Number(e.target.value) }))}
                  className="w-24"
                />
              </TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" title="Remove from role" onClick={() => onRemove(mapping)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <p className={cn("text-sm font-medium", isValidTotal ? "text-emerald-600" : "text-destructive")}>
          Total Weightage: {total.toFixed(2)}% {isValidTotal ? "✓" : "(must equal 100%)"}
        </p>
        <Button
          onClick={() =>
            onSave(Object.entries(values).map(([roleKpiMappingId, weightage]) => ({ roleKpiMappingId, weightage })))
          }
          disabled={!isValidTotal || isSaving}
        >
          {isSaving ? "Saving…" : "Save Weightages"}
        </Button>
      </div>
    </div>
  );
}
