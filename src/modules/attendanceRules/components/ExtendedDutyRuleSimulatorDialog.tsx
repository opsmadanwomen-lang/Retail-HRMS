import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentExtendedDutyRule } from "@/hooks/useExtendedAttendanceRules";
import { parseTimeToMinutesOfDay, calculateExtendedDuty, type DayType } from "@/lib/attendanceCalculation";
import { Stat, Explanation, PreviewOnlyNotice } from "./SimulatorPrimitives";

interface ExtendedDutyRuleSimulatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatClock(minutes: number) {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const dayTag = minutes >= 1440 ? " (+1 day)" : "";
  return `${h12}:${String(m).padStart(2, "0")} ${period}${dayTag}`;
}

/** Test Extended Duty (Late Night) Rule — Normal OT and Extended Duty OT are computed from the
 *  SAME calculateExtendedDuty() used by real attendance (migration 0060 — TIME-BASED midnight
 *  cutoff): Punch Out before the next calendar midnight -> Normal OT works normally (Punch Out −
 *  Shift End), Extra Duty = 0. Punch Out at/after midnight -> Normal OT = 0, and the Shift-End ->
 *  Midnight span folds into the Extra Duty Value tier instead — never both at once. Works for any
 *  Shift Start/End (never hardcoded); "midnight" is always the actual next calendar midnight, not
 *  a fixed offset from Shift End. */
export function ExtendedDutyRuleSimulatorDialog({ open, onOpenChange }: ExtendedDutyRuleSimulatorDialogProps) {
  const { user } = useAuth();
  const ruleQuery = useCurrentExtendedDutyRule(user?.companyId ?? undefined);
  const rule = ruleQuery.data;

  const [dayType, setDayType] = useState<DayType>("normal");
  const [shiftStart, setShiftStart] = useState("10:00");
  const [shiftEnd, setShiftEnd] = useState("20:00");
  const [punchIn, setPunchIn] = useState("10:00");
  const [punchOut, setPunchOut] = useState("01:00");
  const [punchOutNextDay, setPunchOutNextDay] = useState(true);

  const result = useMemo(() => {
    const shiftEndMinutes = parseTimeToMinutesOfDay(shiftEnd);
    const punchOutMinutes = parseTimeToMinutesOfDay(punchOut) + (punchOutNextDay ? 1440 : 0);
    const ruleConfig = rule
      ? {
          midnightThresholdMinutes: parseTimeToMinutesOfDay(rule.midnightThresholdTime),
          midnightExtraDutyValue: rule.midnightExtraDutyValue,
          firstDaySalaryThresholdMinutes: parseTimeToMinutesOfDay(rule.firstDaySalaryThresholdTime),
          firstDayExtraDutyValue: rule.firstDayExtraDutyValue,
          secondDaySalaryThresholdMinutes: parseTimeToMinutesOfDay(rule.secondDaySalaryThresholdTime),
          secondDayExtraDutyValue: rule.secondDayExtraDutyValue,
          hourlyOtRoundingMethod: rule.hourlyOtRoundingMethod,
          hourlyOtCustomRoundingMinutes: rule.hourlyOtCustomRoundingMinutes,
        }
      : null;
    return { ext: calculateExtendedDuty(shiftEndMinutes, punchOutMinutes, ruleConfig), punchOutMinutes, shiftEndMinutes };
  }, [shiftEnd, punchOut, punchOutNextDay, rule]);

  const midnightAt = rule ? 1440 + parseTimeToMinutesOfDay(rule.midnightThresholdTime) : 1440;
  const firstDayAt = rule ? 1440 + parseTimeToMinutesOfDay(rule.firstDaySalaryThresholdTime) : null;
  const secondDayAt = rule ? 1440 + parseTimeToMinutesOfDay(rule.secondDaySalaryThresholdTime) : null;

  const ladderStage =
    result.punchOutMinutes < midnightAt
      ? "Before Midnight threshold — Normal OT only"
      : firstDayAt != null && result.punchOutMinutes < firstDayAt
      ? "Midnight → First Day Salary threshold"
      : secondDayAt != null && result.punchOutMinutes < secondDayAt
      ? "First Day Salary → Second Day Salary threshold"
      : "At/beyond Second Day Salary threshold";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Extended Duty Rule</DialogTitle>
          <DialogDescription><PreviewOnlyNotice /></DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Day Type</Label>
              <Select value={dayType} onValueChange={(v) => setDayType(v as DayType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal Working Day</SelectItem>
                  <SelectItem value="weekly_off">Weekly Off</SelectItem>
                  <SelectItem value="holiday">Holiday</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Shift Start</Label>
              <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Shift End</Label>
              <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Punch In</Label>
              <Input type="time" value={punchIn} onChange={(e) => setPunchIn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Punch Out</Label>
              <Input type="time" value={punchOut} onChange={(e) => setPunchOut(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" checked={punchOutNextDay} onChange={(e) => setPunchOutNextDay(e.target.checked)} id="ext-next-day" />
              <Label htmlFor="ext-next-day">Punch Out is next calendar day</Label>
            </div>
          </div>

          {!rule ? (
            <p className="text-sm text-muted-foreground">No Extended Duty Rule configured — Normal OT will be uncapped (legacy behaviour), no Extended Duty.</p>
          ) : (
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-3">
              <Stat label="Midnight Threshold" value={`${formatClock(midnightAt)} → ${rule.midnightExtraDutyValue} Day`} />
              <Stat label="First Day Salary Threshold" value={`${formatClock(firstDayAt!)} → ${rule.firstDayExtraDutyValue} Day`} />
              <Stat label="Second Day Salary Threshold" value={`${formatClock(secondDayAt!)} → ${rule.secondDayExtraDutyValue} Days`} />
            </div>
          )}

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
            <Stat label="Normal OT" value={`${result.ext.normalOvertimeMinutes} min`} highlight />
            <Stat label="Extended Duty / Post-Midnight OT" value={`${result.ext.nightOvertimeMinutes} min`} highlight />
            <Stat label="Extra Duty Value" value={`${result.ext.extraDutyValue} Day${result.ext.extraDutyValue === 1 ? "" : "s"}`} highlight />
            <Stat label="Current Ladder Stage" value={ladderStage} />
            <Stat label="Punch Out (resolved)" value={formatClock(result.punchOutMinutes)} />
            <Stat
              label="Total Salary Duty Value (illustrative — assumes a full Normal Duty day)"
              value={`${(1 + result.ext.extraDutyValue).toString()} Day${1 + result.ext.extraDutyValue === 1 ? "" : "s"}`}
            />
          </div>

          <Explanation
            lines={[
              !rule
                ? `No Extended Duty Rule configured — Normal OT = Punch Out − Shift End = ${result.ext.normalOvertimeMinutes} minutes, uncapped (legacy behaviour).`
                : result.punchOutMinutes < midnightAt
                ? `Punch Out (${formatClock(result.punchOutMinutes)}) is BEFORE the next calendar midnight — Normal OT applies normally: Punch Out − Shift End (${formatClock(result.shiftEndMinutes)}) = ${result.ext.normalOvertimeMinutes} minutes. Extra Duty = 0; the Extended Duty ladder has not started yet.`
                : `Punch Out (${formatClock(result.punchOutMinutes)}) is AT/AFTER the next calendar midnight — Normal OT stops completely (0). Shift End (${formatClock(result.shiftEndMinutes)}) → Midnight now belongs entirely to Extra Duty Value instead, landing in: ${ladderStage}. Only minutes AFTER midnight count as Extended Duty / Post-Midnight OT.`,
              "The same minutes are never counted in two categories — Normal OT and Extended Duty / Extra Duty Value are always shown separately and never summed into one figure or subtracted from each other. This works identically for any Shift Start/End — midnight is always the real calendar midnight, never a fixed offset from Shift End.",
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
