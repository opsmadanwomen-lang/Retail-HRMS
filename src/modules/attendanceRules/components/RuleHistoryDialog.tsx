import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/common/LoadingState";
import { formatDate } from "@/lib/utils";
import { useLateRuleHistory, useOvertimeRuleHistory } from "@/hooks/useAttendanceRules";
import { ROUNDING_METHOD_OPTIONS } from "@/modules/attendanceRules/constants";

interface RuleHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "late" | "overtime";
  companyId?: string;
  ruleCode: string | null;
  ruleName: string;
}

const roundingLabel = (value: string) => ROUNDING_METHOD_OPTIONS.find((o) => o.value === value)?.label ?? value;

/**
 * Every version of a rule shares the same rule_code — editing a rule never overwrites the old row,
 * it closes it (effective_to) and inserts a new one (migration 0038/attendanceRuleService pattern,
 * identical to shift/weekly-off history). This dialog just lists every row for that rule_code.
 */
export function RuleHistoryDialog({ open, onOpenChange, kind, companyId, ruleCode, ruleName }: RuleHistoryDialogProps) {
  const lateHistory = useLateRuleHistory(kind === "late" ? companyId : undefined, kind === "late" ? ruleCode ?? undefined : undefined);
  const overtimeHistory = useOvertimeRuleHistory(kind === "overtime" ? companyId : undefined, kind === "overtime" ? ruleCode ?? undefined : undefined);

  const query = kind === "late" ? lateHistory : overtimeHistory;
  const rows = query.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rule History — {ruleName}</DialogTitle>
          <DialogDescription>
            Every configuration this rule has ever had. Historical attendance keeps using whichever
            version was in effect when it was calculated — editing again never changes past records.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Effective To</TableHead>
                  <TableHead>Calculation</TableHead>
                  <TableHead>Rounding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDate(row.effectiveFrom)}</TableCell>
                    <TableCell>{row.effectiveTo ? formatDate(row.effectiveTo) : "Current"}</TableCell>
                    <TableCell className="capitalize">{row.calculationMethod}</TableCell>
                    <TableCell>{roundingLabel(row.roundingMethod)}</TableCell>
                    <TableCell>
                      <Badge variant={row.isActive ? "default" : "secondary"}>{row.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">{row.remark ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
