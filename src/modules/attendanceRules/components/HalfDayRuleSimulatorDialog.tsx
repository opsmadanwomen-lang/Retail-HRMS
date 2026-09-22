import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentHalfDayRule } from "@/hooks/useExtendedAttendanceRules";
import { parseTimeToMinutesOfDay, previewAttendanceFacts } from "@/lib/attendanceCalculation";
import { Stat, Explanation, PreviewOnlyNotice } from "./SimulatorPrimitives";

interface HalfDayRuleSimulatorDialogProps {
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

/** Test Half Day Rule — tests Late Arrival and Early Going as two independent directions, exactly
 *  as the real engine treats them (either can independently trigger Half Day). */
export function HalfDayRuleSimulatorDialog({ open, onOpenChange }: HalfDayRuleSimulatorDialogProps) {
  const { user } = useAuth();
  const ruleQuery = useCurrentHalfDayRule(user?.companyId ?? undefined);
  const rule = ruleQuery.data;

  const [shiftStart, setShiftStart] = useState("10:00");
  const [shiftEnd, setShiftEnd] = useState("20:00");
  const [lateArrivalCutoff, setLateArrivalCutoff] = useState("14:00");
  const [earlyGoingCutoff, setEarlyGoingCutoff] = useState("16:00");
  const [punchIn, setPunchIn] = useState("13:59");
  const [punchOut, setPunchOut] = useState("20:00");

  useEffect(() => {
    if (!rule || !open) return;
    setLateArrivalCutoff(rule.lateArrivalCutoffTime.slice(0, 5));
    setEarlyGoingCutoff(rule.earlyGoingCutoffTime.slice(0, 5));
  }, [rule, open]);

  const result = useMemo(() => {
    const shift = { startMinutes: parseTimeToMinutesOfDay(shiftStart), endMinutes: parseTimeToMinutesOfDay(shiftEnd), breakMinutes: 0, lateEligible: true, overtimeEnabled: false };
    return previewAttendanceFacts({
      dayType: "normal",
      shift,
      punchInMinutes: parseTimeToMinutesOfDay(punchIn),
      punchOutMinutes: parseTimeToMinutesOfDay(punchOut),
      halfDayRule: { lateArrivalCutoffMinutes: parseTimeToMinutesOfDay(lateArrivalCutoff), earlyGoingCutoffMinutes: parseTimeToMinutesOfDay(earlyGoingCutoff) },
      // A minimal pass-through config is enough here: when Half Day's own Early Going trigger
      // fires, the engine computes the raw span from the Half Day cutoff directly and does NOT
      // apply this rule's grace/slab/rounding at all (see previewAttendanceFacts) — this is only
      // present so rawEarlyGoingMinutes/calculatedEarlyGoingMinutes get populated instead of
      // staying null when no dedicated Early Going Rule exists yet.
      earlyGoingRule: { graceMinutes: 0, calculationMethod: "exact", roundingMethod: "exact", customRoundingMinutes: null, thresholds: [] },
    });
  }, [shiftStart, shiftEnd, lateArrivalCutoff, earlyGoingCutoff, punchIn, punchOut]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Half Day Rule</DialogTitle>
          <DialogDescription><PreviewOnlyNotice /></DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium">A. Late Arrival</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Shift Start</Label>
                <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Late Arrival Cutoff</Label>
                <Input type="time" value={lateArrivalCutoff} onChange={(e) => setLateArrivalCutoff(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Punch In</Label>
                <Input type="time" value={punchIn} onChange={(e) => setPunchIn(e.target.value)} />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">B. Early Going</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Shift End</Label>
                <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Early Going Cutoff</Label>
                <Input type="time" value={earlyGoingCutoff} onChange={(e) => setEarlyGoingCutoff(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Punch Out</Label>
                <Input type="time" value={punchOut} onChange={(e) => setPunchOut(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
            <Stat label="Attendance Status" value={result.isHalfDay ? <Badge variant="warning">Half Day</Badge> : <Badge variant="success">Full Day</Badge>} />
            <Stat label="Half Day" value={result.isHalfDay ? "Yes" : "No"} />
            <Stat label="Half Day Trigger" value={result.halfDayLateComing && result.halfDayEarlyGoing ? "Both" : result.halfDayLateComing ? "Late Arrival" : result.halfDayEarlyGoing ? "Early Going" : "None"} />
            <Stat label="Late Minutes" value={result.rawLateMinutes} highlight />
            <Stat label="Early Going Minutes" value={result.rawEarlyGoingMinutes ?? 0} highlight />
            <div />
          </div>

          <Explanation
            lines={[
              `Punch In ${formatClock(parseTimeToMinutesOfDay(punchIn))} vs Late Arrival Cutoff ${formatClock(parseTimeToMinutesOfDay(lateArrivalCutoff))}: ${
                result.halfDayLateComing ? `at/after cutoff → Half Day, Late is calculated from the cutoff (${result.rawLateMinutes} min).` : "before cutoff → Full Day for this direction; Late follows the normal Shift-Start-based rule."
              }`,
              `Punch Out ${formatClock(parseTimeToMinutesOfDay(punchOut))} vs Early Going Cutoff ${formatClock(parseTimeToMinutesOfDay(earlyGoingCutoff))}: ${
                result.halfDayEarlyGoing ? `at/before cutoff → Half Day, Early Going is calculated from the cutoff (${result.rawEarlyGoingMinutes ?? 0} min).` : "after cutoff → Full Day for this direction, subject to the configured Early Going Rule."
              }`,
              "Late Arrival and Early Going are independent — either alone is enough to make the day a Half Day.",
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
