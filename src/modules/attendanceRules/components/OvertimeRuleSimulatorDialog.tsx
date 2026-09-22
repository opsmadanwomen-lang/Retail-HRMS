import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useOvertimeRules, useOvertimeRuleThresholds } from "@/hooks/useAttendanceRules";
import { parseTimeToMinutesOfDay, previewAttendanceFacts, type DayType } from "@/lib/attendanceCalculation";
import { todayDateKey } from "@/lib/dateRange";
import { Stat, Explanation, PreviewOnlyNotice } from "./SimulatorPrimitives";

const NO_RULE = "__none__";

interface OvertimeRuleSimulatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRuleId?: string;
}

/** Test Overtime Rule — context-aware simulator scoped to Overtime only. OT is ALWAYS
 *  Punch Out - Shift End; never Required Working Hours, never Working/Late-derived. */
export function OvertimeRuleSimulatorDialog({ open, onOpenChange, initialRuleId }: OvertimeRuleSimulatorDialogProps) {
  const { user } = useAuth();
  const overtimeRulesQuery = useOvertimeRules(user?.companyId ?? undefined);

  const [date, setDate] = useState(() => todayDateKey());
  const [dayType, setDayType] = useState<DayType>("normal");
  const [shiftStart, setShiftStart] = useState("10:00");
  const [shiftEnd, setShiftEnd] = useState("20:00");
  const [punchIn, setPunchIn] = useState("10:00");
  const [punchOut, setPunchOut] = useState("20:30");
  const [overtimeEnabled, setOvertimeEnabled] = useState(true);
  const [overtimeRuleId, setOvertimeRuleId] = useState(initialRuleId ?? NO_RULE);

  const overtimeThresholdsQuery = useOvertimeRuleThresholds(overtimeRuleId !== NO_RULE ? overtimeRuleId : undefined);
  const selectedOvertimeRule = overtimeRulesQuery.data?.find((r) => r.id === overtimeRuleId) ?? null;

  const result = useMemo(() => {
    const shift = {
      startMinutes: parseTimeToMinutesOfDay(shiftStart),
      endMinutes: parseTimeToMinutesOfDay(shiftEnd),
      breakMinutes: 0,
      lateEligible: false,
      overtimeEnabled,
    };
    const overtimeConfig = selectedOvertimeRule
      ? {
          calculationMethod: selectedOvertimeRule.calculationMethod,
          minimumOvertimeMinutes: selectedOvertimeRule.minimumOvertimeMinutes,
          maximumOvertimeMinutes: selectedOvertimeRule.maximumOvertimeMinutes,
          roundingMethod: selectedOvertimeRule.roundingMethod,
          customRoundingMinutes: selectedOvertimeRule.customRoundingMinutes,
          weeklyOffOvertimeAllowed: selectedOvertimeRule.weeklyOffOvertimeAllowed,
          holidayOvertimeAllowed: selectedOvertimeRule.holidayOvertimeAllowed,
          leaveOvertimeAllowed: selectedOvertimeRule.leaveOvertimeAllowed,
          thresholds: (overtimeThresholdsQuery.data ?? []).map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes })),
        }
      : null;

    return previewAttendanceFacts({
      dayType,
      shift,
      punchInMinutes: parseTimeToMinutesOfDay(punchIn),
      punchOutMinutes: parseTimeToMinutesOfDay(punchOut),
      overtimeRule: overtimeConfig,
    });
  }, [dayType, shiftStart, shiftEnd, punchIn, punchOut, overtimeEnabled, selectedOvertimeRule, overtimeThresholdsQuery.data]);

  const formatClock = (minutes: number) => {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Overtime Rule</DialogTitle>
          <DialogDescription><PreviewOnlyNotice /></DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Day Type</Label>
              <Select value={dayType} onValueChange={(v) => setDayType(v as DayType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal Working Day</SelectItem>
                  <SelectItem value="weekly_off">Weekly Off</SelectItem>
                  <SelectItem value="holiday">Holiday</SelectItem>
                  <SelectItem value="leave">Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox checked={overtimeEnabled} onCheckedChange={(v) => setOvertimeEnabled(Boolean(v))} id="ot-sim-enabled" />
              <Label htmlFor="ot-sim-enabled">Overtime Enabled</Label>
            </div>
            <div className="space-y-1.5">
              <Label>Shift Start</Label>
              <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Shift End</Label>
              <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
            </div>
            <div />
            <div className="space-y-1.5">
              <Label>Punch In</Label>
              <Input type="time" value={punchIn} onChange={(e) => setPunchIn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Punch Out</Label>
              <Input type="time" value={punchOut} onChange={(e) => setPunchOut(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Selected Overtime Rule</Label>
              <Select value={overtimeRuleId} onValueChange={setOvertimeRuleId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RULE}>No Rule (legacy exact behaviour)</SelectItem>
                  {(overtimeRulesQuery.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.ruleName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
            <Stat label="Raw OT Minutes" value={result.rawOvertimeMinutes ?? 0} />
            <Stat label="Calculated OT Minutes" value={result.calculatedOvertimeMinutes ?? 0} highlight />
            <Stat label="OT Eligibility" value={result.overtimeAllowed ? "Allowed" : "Not Allowed"} />
            <Stat label="Applied OT Rule" value={selectedOvertimeRule?.ruleName ?? "No Rule (legacy exact behaviour)"} />
          </div>

          <Explanation
            lines={[
              `Shift End ${formatClock(parseTimeToMinutesOfDay(shiftEnd))}, Punch Out ${formatClock(parseTimeToMinutesOfDay(punchOut))}.`,
              `OT = Punch Out − Shift End = ${result.rawOvertimeMinutes ?? 0} minutes. Never Required Working Hours, never Working/Late-derived.`,
              result.overtimeDisallowedReason,
              selectedOvertimeRule ? `The "${selectedOvertimeRule.ruleName}" Overtime Rule was applied on top of the raw value (rounding/thresholds/min/max).` : "No Overtime Rule is assigned for this scope — the raw value is used as-is (legacy behaviour).",
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
