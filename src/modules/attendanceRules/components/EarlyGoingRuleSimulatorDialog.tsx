import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEarlyGoingRule, useEarlyGoingThresholds, useCurrentHalfDayRule } from "@/hooks/useExtendedAttendanceRules";
import { parseTimeToMinutesOfDay, previewAttendanceFacts } from "@/lib/attendanceCalculation";
import { Stat, Explanation, PreviewOnlyNotice } from "./SimulatorPrimitives";

interface EarlyGoingRuleSimulatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatClock(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Test Early Going Rule — grace is a threshold GATE (elapsed < grace -> 0; elapsed >= grace ->
 *  the full elapsed span), never a subtracted amount. Independent of Late's own grace-less rule. */
export function EarlyGoingRuleSimulatorDialog({ open, onOpenChange }: EarlyGoingRuleSimulatorDialogProps) {
  const { user } = useAuth();
  const ruleQuery = useCurrentEarlyGoingRule(user?.companyId ?? undefined);
  const thresholdsQuery = useEarlyGoingThresholds(ruleQuery.data?.id);
  const halfDayRuleQuery = useCurrentHalfDayRule(user?.companyId ?? undefined);
  const rule = ruleQuery.data;

  const [shiftEnd, setShiftEnd] = useState("21:00");
  const [graceMinutes, setGraceMinutes] = useState(15);
  const [punchOut, setPunchOut] = useState("20:46");
  const [testHalfDay, setTestHalfDay] = useState(false);

  useEffect(() => {
    if (!rule || !open) return;
    setGraceMinutes(rule.graceMinutes);
  }, [rule, open]);

  const thresholds = (thresholdsQuery.data ?? []).map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes }));

  const result = useMemo(() => {
    const shift = { startMinutes: parseTimeToMinutesOfDay("09:00"), endMinutes: parseTimeToMinutesOfDay(shiftEnd), breakMinutes: 0, lateEligible: false, overtimeEnabled: false };
    return previewAttendanceFacts({
      dayType: "normal",
      shift,
      punchInMinutes: parseTimeToMinutesOfDay("09:00"),
      punchOutMinutes: parseTimeToMinutesOfDay(punchOut),
      earlyGoingRule: rule
        ? { graceMinutes, calculationMethod: rule.calculationMethod, roundingMethod: rule.roundingMethod, customRoundingMinutes: rule.customRoundingMinutes, thresholds }
        : { graceMinutes, calculationMethod: "exact", roundingMethod: "exact", customRoundingMinutes: null, thresholds: [] },
      halfDayRule: testHalfDay && halfDayRuleQuery.data
        ? { lateArrivalCutoffMinutes: parseTimeToMinutesOfDay(halfDayRuleQuery.data.lateArrivalCutoffTime), earlyGoingCutoffMinutes: parseTimeToMinutesOfDay(halfDayRuleQuery.data.earlyGoingCutoffTime) }
        : null,
    });
  }, [shiftEnd, punchOut, graceMinutes, rule, thresholds, testHalfDay, halfDayRuleQuery.data]);

  const elapsed = Math.max(0, parseTimeToMinutesOfDay(shiftEnd) - parseTimeToMinutesOfDay(punchOut));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Early Going Rule</DialogTitle>
          <DialogDescription><PreviewOnlyNotice /></DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Shift End</Label>
              <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Early Going Grace (minutes)</Label>
              <Input type="number" min={0} value={graceMinutes} onChange={(e) => setGraceMinutes(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Punch Out</Label>
              <Input type="time" value={punchOut} onChange={(e) => setPunchOut(e.target.value)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={testHalfDay} onChange={(e) => setTestHalfDay(e.target.checked)} />
            Also apply the current Half Day Rule (Early Going cutoff can override this calculation — see Test Half Day Rule)
          </label>

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
            <Stat label="Raw Early Going" value={elapsed} />
            <Stat label="Grace Threshold" value={`${graceMinutes} min`} />
            <Stat label="Calculated Early Going" value={result.calculatedEarlyGoingMinutes ?? 0} highlight />
            <Stat label="Grace Applied (zeroed)" value={result.earlyGoingGraceApplied ? "Yes" : "No"} />
            <Stat label="Half Day Result" value={testHalfDay ? (result.isHalfDay ? "Half Day" : "Full Day") : "Not tested"} />
            <div />
          </div>

          <Explanation
            lines={[
              `Shift End ${formatClock(parseTimeToMinutesOfDay(shiftEnd))}, Punch Out ${formatClock(parseTimeToMinutesOfDay(punchOut))} → raw elapsed early = ${elapsed} minutes.`,
              elapsed < graceMinutes
                ? `${elapsed} minutes is within the ${graceMinutes}-minute grace threshold, so Early Going is 0 — grace is a threshold gate, not a subtracted amount.`
                : `${elapsed} minutes is at/beyond the ${graceMinutes}-minute grace threshold, so the FULL elapsed span (${elapsed} min) counts — grace never reduces it once crossed.`,
              rule?.calculationMethod === "slab" ? "The saved rule uses Slab calculation — a matching threshold row (if any) overrides the raw value before rounding." : null,
              testHalfDay ? "When the Half Day Rule's Early Going Cutoff also applies, it takes priority and this Rule's own grace gate is bypassed for that portion of the day (see Test Half Day Rule)." : null,
            ]}
          />
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
