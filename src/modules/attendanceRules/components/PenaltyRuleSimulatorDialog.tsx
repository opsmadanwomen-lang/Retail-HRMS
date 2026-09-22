import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentPenaltyRule, usePenaltyThresholds, useCurrentWeeklyOffLateRule, useCurrentInformationRule, useCurrentHalfDayRule } from "@/hooks/useExtendedAttendanceRules";
import { parseTimeToMinutesOfDay, previewAttendanceFacts, type DayType, PENALTY_APPLICABILITY_LABELS } from "@/lib/attendanceCalculation";
import { Stat, Explanation, PreviewOnlyNotice } from "./SimulatorPrimitives";

interface PenaltyRuleSimulatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** UI-level day type this Test Rule can simulate. "information_day" maps to dayType "normal" +
 *  useInformationToday: true, matching Test Late Rule's convention. */
type UiDayType = "normal" | "weekly_off" | "information_day" | "half_day" | "holiday";

function formatClock(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Test Penalty Rule — runs the SAME previewAttendanceFacts() engine as every other simulator
 * (migration 0058). Day-Type driven: Actual Late is computed from the real Weekly Off Late Rule /
 * Information Rule / Half Day Rule cutoffs, exactly like the real attendance engine — this is not
 * a "type in a raw Actual Late number" tool. Actual Late and Penalty are always shown as two
 * separate figures; Actual Late is NEVER overwritten by the Penalty result.
 */
export function PenaltyRuleSimulatorDialog({ open, onOpenChange }: PenaltyRuleSimulatorDialogProps) {
  const { user } = useAuth();
  const ruleQuery = useCurrentPenaltyRule(user?.companyId ?? undefined);
  const thresholdsQuery = usePenaltyThresholds(ruleQuery.data?.id);
  const weeklyOffRuleQuery = useCurrentWeeklyOffLateRule(user?.companyId ?? undefined);
  const informationRuleQuery = useCurrentInformationRule(user?.companyId ?? undefined);
  const halfDayRuleQuery = useCurrentHalfDayRule(user?.companyId ?? undefined);

  const [uiDayType, setUiDayType] = useState<UiDayType>("half_day");
  const [shiftStart, setShiftStart] = useState("10:00");
  const [shiftEnd, setShiftEnd] = useState("20:00");
  const [punchIn, setPunchIn] = useState("12:15");
  const [halfDayCutoff, setHalfDayCutoff] = useState("14:00");

  // Seed the Half Day cutoff input from the configured rule once it loads (still freely editable —
  // Day Type = Half Day is a direct, declarative simulation mode, exactly like Weekly Off /
  // Information Used Day, not something gated behind a real rule happening to be configured).
  useEffect(() => {
    if (halfDayRuleQuery.data) setHalfDayCutoff(halfDayRuleQuery.data.lateArrivalCutoffTime.slice(0, 5));
  }, [halfDayRuleQuery.data]);

  const rule = ruleQuery.data;
  const thresholds = (thresholdsQuery.data ?? []).map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes }));

  const dayType: DayType = uiDayType === "information_day" || uiDayType === "half_day" ? "normal" : uiDayType === "weekly_off" ? "weekly_off" : uiDayType === "holiday" ? "holiday" : "normal";
  const useInformationToday = uiDayType === "information_day";
  const isWeeklyOffSelected = uiDayType === "weekly_off";
  const isInformationDaySelected = uiDayType === "information_day";
  const isHalfDaySelected = uiDayType === "half_day";

  const result = useMemo(() => {
    const shift = { startMinutes: parseTimeToMinutesOfDay(shiftStart), endMinutes: parseTimeToMinutesOfDay(shiftEnd), breakMinutes: 0, lateEligible: true, overtimeEnabled: false };
    return previewAttendanceFacts({
      dayType,
      shift,
      punchInMinutes: parseTimeToMinutesOfDay(punchIn),
      punchOutMinutes: null,
      weeklyOffLateRule: isWeeklyOffSelected && weeklyOffRuleQuery.data ? { cutoffMinutes: parseTimeToMinutesOfDay(weeklyOffRuleQuery.data.cutoffTime) } : null,
      informationRule: isInformationDaySelected && informationRuleQuery.data
        ? { monthlyLimit: informationRuleQuery.data.monthlyLimit, cutoffMinutes: parseTimeToMinutesOfDay(informationRuleQuery.data.cutoffTime), applicableOnWeeklyOff: informationRuleQuery.data.applicableOnWeeklyOff }
        : null,
      useInformationToday,
      informationUsedThisMonth: 0,
      // Half Day: an editable, always-effective cutoff (like Weekly Off Cutoff) — never gated on
      // whether a real Half Day Rule happens to be configured for the company. Recomputes Actual
      // Late from this cutoff ONLY if Punch In actually crosses it; otherwise Actual Late stays
      // whatever the normal branch above already produced.
      halfDayRule: isHalfDaySelected ? { lateArrivalCutoffMinutes: parseTimeToMinutesOfDay(halfDayCutoff), earlyGoingCutoffMinutes: parseTimeToMinutesOfDay("16:00") } : null,
      // Day Type = Half Day (Late Arrival) is a direct, declarative simulation mode: Penalty
      // exclusion applies unconditionally the moment this Day Type is selected, exactly matching
      // the mandatory rule ("Half Day condition MUST be evaluated FIRST"), regardless of whether
      // Punch In happens to be before or after the cutoff above.
      forceHalfDayLateArrival: isHalfDaySelected,
      lateRule: null,
      penaltyRule: rule
        ? { method: rule.method, fixedMinutes: rule.fixedMinutes, multiplier: rule.multiplier, thresholds, applicability: rule.applicability, applyOnWeeklyOff: rule.applyOnWeeklyOff, applyOnInformationDay: rule.applyOnInformationDay }
        : null,
    });
  }, [dayType, shiftStart, shiftEnd, punchIn, isWeeklyOffSelected, weeklyOffRuleQuery.data, isInformationDaySelected, informationRuleQuery.data, useInformationToday, isHalfDaySelected, halfDayCutoff, rule, thresholds]);

  const calculationMode = isWeeklyOffSelected
    ? "Weekly Off"
    : isHalfDaySelected
    ? "Half Day (Late Arrival)"
    : dayType === "holiday"
    ? "Holiday"
    : isInformationDaySelected
    ? "Information Used Day"
    : "Normal Working Day";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Penalty Rule</DialogTitle>
          <DialogDescription><PreviewOnlyNotice /></DialogDescription>
        </DialogHeader>

        {!rule ? (
          <p className="text-sm text-muted-foreground">Configure the Penalty Rule first — nothing to preview yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Day Type</Label>
                <Select value={uiDayType} onValueChange={(v) => setUiDayType(v as UiDayType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal Working Day</SelectItem>
                    <SelectItem value="weekly_off">Weekly Off</SelectItem>
                    <SelectItem value="information_day">Information Used Day</SelectItem>
                    <SelectItem value="half_day">Half Day (Late Arrival)</SelectItem>
                    <SelectItem value="holiday">Holiday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div />
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

              {/* Weekly Off: only its own cutoff — no Information fields, per the current
                  independent Weekly Off Late Rule. */}
              {isWeeklyOffSelected && (
                <Stat
                  label="Weekly Off Cutoff"
                  value={weeklyOffRuleQuery.data ? formatClock(parseTimeToMinutesOfDay(weeklyOffRuleQuery.data.cutoffTime)) : "Not configured"}
                />
              )}
              {isWeeklyOffSelected && <Stat label="Apply Penalty on Weekly Off" value={rule.applyOnWeeklyOff ? "Yes" : "No"} />}

              {isInformationDaySelected && (
                <Stat
                  label="Information Cutoff"
                  value={informationRuleQuery.data ? formatClock(parseTimeToMinutesOfDay(informationRuleQuery.data.cutoffTime)) : "Not configured"}
                />
              )}
              {isInformationDaySelected && <Stat label="Apply Penalty on Information Used Day" value={rule.applyOnInformationDay ? "Yes" : "No"} />}

              {isHalfDaySelected && (
                <div className="space-y-1.5">
                  <Label>Half Day Late Arrival Cutoff</Label>
                  <Input type="time" value={halfDayCutoff} onChange={(e) => setHalfDayCutoff(e.target.value)} />
                </div>
              )}
            </div>

            <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
              <Stat label="Calculation Mode" value={calculationMode} />
              <Stat label="Actual Late" value={result.calculatedLateMinutes} />
              <Stat label="Penalty Applicability" value={result.penaltyApplicable ? <Badge variant="success">Applicable</Badge> : <Badge variant="secondary">Not Applicable</Badge>} />
              <Stat label="Calculated Penalty" value={result.calculatedPenaltyMinutes} highlight />
              <Stat label="Penalty Method" value={rule.method} />
              <Stat label="Normal Day Applicability Rule" value={PENALTY_APPLICABILITY_LABELS[rule.applicability]} />
            </div>

            <Explanation
              lines={[
                `Reason: ${result.penaltyReason}`,
                "Actual Late and Penalty remain two separate figures — Penalty never overwrites or replaces Actual Late, and turning Penalty off for a day type never changes that day's Late value.",
                isWeeklyOffSelected ? "Weekly Off: Late is always computed from the Weekly Off Cutoff regardless of the Penalty toggle above; only whether a Penalty is derived from it depends on that toggle." : null,
                isInformationDaySelected ? "Information Used Day: Late is always computed from the Information Cutoff regardless of the Penalty toggle above; only whether a Penalty is derived from it depends on that toggle." : null,
              ]}
            />
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
