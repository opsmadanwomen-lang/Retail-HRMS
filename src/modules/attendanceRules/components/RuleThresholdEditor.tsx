import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ThresholdDraft {
  fromMinutes: number;
  toMinutes: number | null;
  calculatedMinutes: number;
}

interface RuleThresholdEditorProps {
  thresholds: ThresholdDraft[];
  onChange: (thresholds: ThresholdDraft[]) => void;
}

/**
 * Slab/threshold editor shared by the Late Rule and Overtime Rule form dialogs — "From Minutes /
 * To Minutes / Calculated Minutes" rows, add/edit/delete, no fixed slab count. `toMinutes: null`
 * means "and above" (unbounded upper end), useful for the last slab in a ladder.
 */
export function RuleThresholdEditor({ thresholds, onChange }: RuleThresholdEditorProps) {
  const updateRow = (index: number, patch: Partial<ThresholdDraft>) => {
    onChange(thresholds.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    const last = thresholds[thresholds.length - 1];
    onChange([...thresholds, { fromMinutes: last ? (last.toMinutes ?? last.fromMinutes) + 1 : 0, toMinutes: null, calculatedMinutes: 0 }]);
  };

  const removeRow = (index: number) => onChange(thresholds.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
        <Label className="text-xs text-muted-foreground">From Minutes</Label>
        <Label className="text-xs text-muted-foreground">To Minutes (blank = and above)</Label>
        <Label className="text-xs text-muted-foreground">Calculated Minutes</Label>
        <span />
      </div>

      {thresholds.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
          <Input
            type="number"
            min={0}
            value={row.fromMinutes}
            onChange={(event) => updateRow(index, { fromMinutes: Number(event.target.value) })}
          />
          <Input
            type="number"
            min={0}
            value={row.toMinutes ?? ""}
            placeholder="and above"
            onChange={(event) => updateRow(index, { toMinutes: event.target.value === "" ? null : Number(event.target.value) })}
          />
          <Input
            type="number"
            min={0}
            value={row.calculatedMinutes}
            onChange={(event) => updateRow(index, { calculatedMinutes: Number(event.target.value) })}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(index)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="mr-2 h-4 w-4" />
        Add Slab
      </Button>
    </div>
  );
}
