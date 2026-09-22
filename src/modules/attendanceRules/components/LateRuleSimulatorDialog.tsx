import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useLateRules, useLateRuleThresholds } from "@/hooks/useAttendanceRules";
import { useCurrentInformationRule, useCurrentHalfDayRule, useCurrentWeeklyOffLateRule } from "@/hooks/useExtendedAttendanceRules";
import { parseTimeToMinutesOfDay, previewAttendanceFacts, type DayType } from "@/lib/attendanceCalculation";
import { todayDateKey } from "@/lib/dateRange";
import { Stat, Explanation, PreviewOnlyNotice } from "./SimulatorPrimitives";

const NO_RULE = "__none__";

/** UI-level day type. "information_day" is not a real DayType in the engine — it maps to
 *  dayType: "normal" + useInformationToday: true. Weekly Off is independent of Information
 *  entirely (migration 0057) — it only needs its own cutoff, never Information fields. */
type UiDayType = "normal" | "weekly_off" | "holiday" | "information_day";

interface LateRuleSimulatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects the rule being edited/viewed when opened from that rule's card. */
  initialRuleId?: string;
}

function formatClock(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Test Late Rule — context-aware simulator scoped to Late only. Runs the exact same
 *  previewAttendanceFacts() engine every other simulator uses.
 *
 *  Weekly Off (migration 0057): independent of Information entirely. Selecting "Weekly Off" shows
 *  ONLY Weekly Off Cutoff, Calculation Mode, Applied Base/Cutoff, Raw Late, Final Late — no
 *  Information Remaining/Used/Available/Exhausted fields of any kind.
 *  Information Day: unchanged, still shows Information Remaining/Used (preserved, untouched). */
export function LateRuleSimulatorDialog({ open, onOpenChange, initialRuleId }: LateRuleSimulatorDialogProps) {
  const { user } = useAuth();
  const lateRulesQuery = useLateRules(user?.companyId ?? undefined);
  const informationRuleQuery = useCurrentInformationRule(user?.companyId ?? undefined);
  const weeklyOffRuleQuery = useCurrentWeeklyOffLateRule(user?.companyId ?? undefined);
  const halfDayRuleQuery = useCurrentHalfDayRule(user?.companyId ?? undefined);

  const [date, setDate] = useState(() => todayDateKey());
  const [uiDayType, setUiDayType] = useState<UiDayType>("weekly_off");
  const [shiftStart, setShiftStart] = useState("10:00");
  const [shiftEnd, setShiftEnd] = useState("20:00");
  const [punchIn, setPunchIn] = useState("10:59");
  const [weeklyOffCutoff, setWeeklyOffCutoff] = useState("12:00");
  const [informationRemaining, setInformationRemaining] = useState(1);
  const [lateRuleId, setLateRuleId] = useState(initialRuleId ?? NO_RULE);

  // Seed the Weekly Off Cutoff input from the configured rule once it loads (still freely editable
  // for testing arbitrary cutoffs, per the "Weekly Off Cutoff" being listed as a Test Rule INPUT).
  useEffect(() => {
    if (weeklyOffRuleQuery.data) setWeeklyOffCutoff(weeklyOffRuleQuery.data.cutoffTime.slice(0, 5));
  }, [weeklyOffRuleQuery.data]);

  const lateThresholdsQuery = useLateRuleThresholds(lateRuleId !== NO_RULE ? lateRuleId : undefined);
  const selectedLateRule = lateRulesQuery.data?.find((r) => r.id === lateRuleId) ?? null;

  const dayType: DayType = uiDayType === "information_day" ? "normal" : uiDayType;
  const useInformationToday = uiDayType === "information_day";
  const isWeeklyOffSelected = uiDayType === "weekly_off";
  const isInformationDaySelected = uiDayType === "information_day";
  const infoRuleData = informationRuleQuery.data;

  const informationUsedThisMonth = infoRuleData ? Math.max(0, infoRuleData.monthlyLimit - informationRemaining) : 0;

  const result = useMemo(() => {
    const shift = {
      startMinutes: parseTimeToMinutesOfDay(shiftStart),
      endMinutes: parseTimeToMinutesOfDay(shiftEnd),
      breakMinutes: 0,
      lateEligible: true,
      overtimeEnabled: false,
    };
    const lateConfig = selectedLateRule
      ? {
          calculationMethod: selectedLateRule.calculationMethod,
          roundingMethod: selectedLateRule.roundingMethod,
          customRoundingMinutes: selectedLateRule.customRoundingMinutes,
          minimumLateMinutes: selectedLateRule.minimumLateMinutes,
          maximumLateMinutes: selectedLateRule.maximumLateMinutes,
          thresholds: (lateThresholdsQuery.data ?? []).map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes })),
        }
      : null;

    return previewAttendanceFacts({
      dayType,
      shift,
      punchInMinutes: parseTimeToMinutesOfDay(punchIn),
      punchOutMinutes: null,
      // Weekly Off Cutoff — independent of Information entirely. Only supplied when Weekly Off is
      // selected, matching the Test Rule requirement to run the SAME calculation as the real engine.
      weeklyOffLateRule: isWeeklyOffSelected ? { cutoffMinutes: parseTimeToMinutesOfDay(weeklyOffCutoff) } : null,
      // Information Rule — only relevant for the Information Day day type (unchanged, preserved).
      informationRule: isInformationDaySelected && infoRuleData
        ? { monthlyLimit: infoRuleData.monthlyLimit, cutoffMinutes: parseTimeToMinutesOfDay(infoRuleData.cutoffTime), applicableOnWeeklyOff: infoRuleData.applicableOnWeeklyOff }
        : null,
      useInformationToday,
      informationUsedThisMonth: isInformationDaySelected ? informationUsedThisMonth : 0,
      halfDayRule: halfDayRuleQuery.data
        ? { lateArrivalCutoffMinutes: parseTimeToMinutesOfDay(halfDayRuleQuery.data.lateArrivalCutoffTime), earlyGoingCutoffMinutes: parseTimeToMinutesOfDay(halfDayRuleQuery.data.earlyGoingCutoffTime) }
        : null,
      lateRule: lateConfig,
    });
  }, [dayType, shiftStart, shiftEnd, punchIn, isWeeklyOffSelected, weeklyOffCutoff, isInformationDaySelected, useInformationToday, informationUsedThisMonth, infoRuleData, halfDayRuleQuery.data, selectedLateRule, lateThresholdsQuery.data]);

  const calculationMode = isWeeklyOffSelected
    ? "Weekly Off"
    : dayType === "holiday"
    ? "Holiday (Late always 0)"
    : result.usedInformationToday
    ? "Information Day"
    : "Normal Day (Shift Start)";

  const informationUsedCount = result.usedInformationToday ? 1 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Late Rule</DialogTitle>
          <DialogDescription><PreviewOnlyNotice /></DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Day Type</Label>
              <Select value={uiDayType} onValueChange={(v) => setUiDayType(v as UiDayType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal Working Day</SelectItem>
                  <SelectItem value="weekly_off">Weekly Off</SelectItem>
                  <SelectItem value="holiday">Holiday</SelectItem>
                  <SelectItem value="information_day">Information Day</SelectItem>
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

            {/* Weekly Off: ONLY the Weekly Off Cutoff — no Information Remaining/Used/Available/
                Exhausted field of any kind (migration 0057, fully decoupled from Information). */}
            {isWeeklyOffSelected && (
              <div className="space-y-1.5">
                <Label>Weekly Off Cutoff</Label>
                <Input type="time" value={weeklyOffCutoff} onChange={(e) => setWeeklyOffCutoff(e.target.value)} />
              </div>
            )}

            {/* Information Day: unchanged, preserved exactly as before. */}
            {isInformationDaySelected && (
              <div className="space-y-1.5">
                <Label>Information Remaining (this month, before today)</Label>
                <Input
                  type="number"
                  min={0}
                  value={informationRemaining}
                  onChange={(e) => setInformationRemaining(Math.max(0, Number(e.target.value)))}
                />
              </div>
            )}

            <div className="space-y-1.5 sm:col-span-3">
              <Label>Selected Late Rule</Label>
              <Select value={lateRuleId} onValueChange={setLateRuleId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RULE}>No Rule (legacy exact behaviour)</SelectItem>
                  {(lateRulesQuery.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.ruleName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
            <Stat label="Calculation Mode" value={calculationMode} />
            <Stat label="Applied Base / Cutoff" value={`${result.lateBaseLabel} (${result.lateBaseMinutes != null ? formatClock(result.lateBaseMinutes) : "—"})`} />
            <Stat label="Raw Late Minutes" value={result.rawLateMinutes} />
            {isInformationDaySelected && <Stat label="Information Used" value={informationUsedCount} />}
            <Stat label="Final Late Minutes" value={result.calculatedLateMinutes} highlight />
            <Stat label="Half Day (Late Arrival)" value={result.halfDayLateComing ? "Yes" : "No"} />
            <Stat label="Applied Late Rule" value={selectedLateRule?.ruleName ?? "No Rule (legacy exact behaviour)"} />
          </div>

          <Explanation
            lines={[
              `Punch In ${formatClock(parseTimeToMinutesOfDay(punchIn))} compared against ${result.lateBaseLabel} (${result.lateBaseMinutes != null ? formatClock(result.lateBaseMinutes) : "—"}).`,
              isWeeklyOffSelected
                ? `Weekly Off Late Rule (independent of Information): Punch In <= Weekly Off Cutoff (${formatClock(parseTimeToMinutesOfDay(weeklyOffCutoff))}) → Late 0. Punch In > Cutoff → Late = Punch In − Cutoff, in full. Nothing is checked or consumed from Information.`
                : result.usesNoonRule
                ? "Information Day noon cutoff has no separate grace — the cutoff itself is the gate."
                : "Grace is never subtracted here — it is only a threshold gate inside the Late Rule's own slab thresholds, if configured.",
              result.halfDayLateComing ? "Punch In is at/after the Half Day Late Arrival Cutoff, so Late is recalculated from that cutoff instead of Shift Start." : null,
              result.lateZeroedReason,
              selectedLateRule ? `The "${selectedLateRule.ruleName}" Late Rule was applied on top of the raw value (rounding/thresholds/min/max).` : "No Late Rule is assigned for this scope — the raw value is used as-is (legacy behaviour).",
              isInformationDaySelected ? "This is a preview only — no employee_information_usage row is ever created here, even when a credit would be consumed on a real punch." : null,
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
