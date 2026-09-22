import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useEmployees } from "@/hooks/useEmployees";
import { useCurrentInformationRule, useInformationUsageThisMonth } from "@/hooks/useExtendedAttendanceRules";
import { parseTimeToMinutesOfDay, previewAttendanceFacts, type DayType } from "@/lib/attendanceCalculation";
import { todayDateKey } from "@/lib/dateRange";
import { Stat, Explanation, PreviewOnlyNotice } from "./SimulatorPrimitives";

const HYPOTHETICAL = "__hypothetical__";

interface InformationRuleSimulatorDialogProps {
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

/**
 * Test Information / Intimation Rule — PREVIEW ONLY. Never inserts an employee_information_usage
 * row, regardless of Information being "used" in the preview.
 *
 * Also the home of the Weekly-Off + Information interaction test (migration 0056): on a Weekly
 * Off worked day, the 12:00 PM cutoff benefit is CONDITIONAL on Information actually being
 * available — it is not an explicit toggle choice like a normal Information Day, it applies (and
 * consumes a credit) automatically whenever Information Remaining > 0, and falls through to the
 * full Shift-Start-based Late when Information is exhausted.
 */
export function InformationRuleSimulatorDialog({ open, onOpenChange }: InformationRuleSimulatorDialogProps) {
  const { user } = useAuth();
  const informationRuleQuery = useCurrentInformationRule(user?.companyId ?? undefined);
  const employeesQuery = useEmployees({ companyId: user?.companyId ?? undefined, status: "active" });

  const [employeeId, setEmployeeId] = useState<string>(HYPOTHETICAL);
  const [date, setDate] = useState(() => todayDateKey());
  const [dayType, setDayType] = useState<DayType>("weekly_off");
  const [shiftStart, setShiftStart] = useState("10:00");
  const [punchIn, setPunchIn] = useState("12:15");
  const [useInformation, setUseInformation] = useState(false);
  const [manualUsed, setManualUsed] = useState(0);

  const [year, month] = date.split("-").map(Number);
  const realUsageQuery = useInformationUsageThisMonth(employeeId !== HYPOTHETICAL ? employeeId : undefined, year, month);
  const informationUsedThisMonth = employeeId !== HYPOTHETICAL ? realUsageQuery.data?.length ?? 0 : manualUsed;

  const rule = informationRuleQuery.data;
  const isWeeklyOff = dayType === "weekly_off";

  const result = useMemo(() => {
    const shift = { startMinutes: parseTimeToMinutesOfDay(shiftStart), endMinutes: parseTimeToMinutesOfDay("20:00"), breakMinutes: 0, lateEligible: true, overtimeEnabled: false };
    return previewAttendanceFacts({
      dayType,
      shift,
      punchInMinutes: parseTimeToMinutesOfDay(punchIn),
      punchOutMinutes: null,
      informationRule: rule ? { monthlyLimit: rule.monthlyLimit, cutoffMinutes: parseTimeToMinutesOfDay(rule.cutoffTime), applicableOnWeeklyOff: rule.applicableOnWeeklyOff } : null,
      // Weekly Off coverage is automatic (no toggle) — the engine decides based on availability
      // alone. The explicit toggle only matters for a normal Information Day.
      useInformationToday: isWeeklyOff ? false : useInformation,
      informationUsedThisMonth,
    });
  }, [dayType, isWeeklyOff, shiftStart, punchIn, useInformation, informationUsedThisMonth, rule]);

  const remainingBefore = rule ? Math.max(0, rule.monthlyLimit - informationUsedThisMonth) : null;

  const calculationMode = !rule
    ? "No Information Rule configured"
    : isWeeklyOff
    ? result.usesNoonRule
      ? "Weekly Off / Information"
      : "Weekly Off / Information Exhausted"
    : result.usedInformationToday
    ? "Information Day"
    : "Normal Day (Shift Start)";

  const informationUsedCount = result.usedInformationToday ? 1 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Information Rule</DialogTitle>
          <DialogDescription><PreviewOnlyNotice /> Never creates a real employee_information_usage row.</DialogDescription>
        </DialogHeader>

        {!rule ? (
          <p className="text-sm text-muted-foreground">Configure the Information Rule first — nothing to preview yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Employee (optional — pulls their real monthly usage; leave as Hypothetical to type a number instead)</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HYPOTHETICAL}>Hypothetical (no real employee)</SelectItem>
                    {(employeesQuery.data ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeCode ?? "—"})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Test Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              {employeeId === HYPOTHETICAL ? (
                <div className="space-y-1.5">
                  <Label>Information Remaining (this month, before today)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={rule.monthlyLimit}
                    value={Math.max(0, rule.monthlyLimit - manualUsed)}
                    onChange={(e) => setManualUsed(Math.max(0, rule.monthlyLimit - Number(e.target.value)))}
                  />
                </div>
              ) : (
                <Stat label="Information Remaining (this month, real data)" value={realUsageQuery.isLoading ? "Loading…" : remainingBefore} />
              )}
              <Stat label="Monthly Information Limit" value={rule.monthlyLimit} />
              <Stat label="Weekly Off Cutoff" value={formatClock(parseTimeToMinutesOfDay(rule.cutoffTime))} />

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
                <Label>Punch In</Label>
                <Input type="time" value={punchIn} onChange={(e) => setPunchIn(e.target.value)} />
              </div>

              {isWeeklyOff ? (
                <p className="text-xs text-muted-foreground sm:col-span-3">
                  Weekly Off coverage is automatic — no toggle needed. It applies (and consumes one Information
                  credit) whenever Information Remaining &gt; 0; otherwise Late is calculated in full from Shift Start.
                </p>
              ) : (
                <div className="flex items-center gap-2 pt-1 sm:col-span-3">
                  <Checkbox checked={useInformation} onCheckedChange={(v) => setUseInformation(Boolean(v))} id="info-sim-use" />
                  <Label htmlFor="info-sim-use">Use Information Today (explicit choice, Information Day only)</Label>
                </div>
              )}
            </div>

            <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
              <Stat label="Calculation Mode" value={calculationMode} />
              <Stat label="Raw Late" value={result.rawLateMinutes} />
              <Stat label="Final Late" value={result.calculatedLateMinutes} highlight />
              <Stat label="Information Used" value={informationUsedCount} />
              <Stat label="Information Remaining (after today)" value={result.informationRemainingAfter ?? "—"} />
              <Stat
                label="Result"
                value={
                  (isWeeklyOff ? false : useInformation) && result.informationExhausted ? (
                    <Badge variant="destructive">Information quota exhausted</Badge>
                  ) : result.usedInformationToday ? (
                    <Badge variant="success">Information Used</Badge>
                  ) : (
                    <Badge variant="secondary">Not Used</Badge>
                  )
                }
              />
            </div>

            <Explanation
              lines={[
                `Monthly Limit ${rule.monthlyLimit}, ${remainingBefore} remaining before today.`,
                isWeeklyOff && result.usesNoonRule
                  ? `Information is available → the 12:00 PM Weekly Off cutoff (${formatClock(parseTimeToMinutesOfDay(rule.cutoffTime))}) governs Late instead of Shift Start. Any lateness past the cutoff is automatically covered by consuming one Information credit, so Final Late becomes 0.`
                  : isWeeklyOff
                  ? `Information is exhausted (0 remaining) — the 12:00 PM cutoff does NOT apply. Late is calculated in full from Shift Start (${formatClock(parseTimeToMinutesOfDay(shiftStart))}), exactly like a Normal day: ${result.rawLateMinutes} minutes, never floored to 0.`
                  : useInformation && result.informationExhausted
                  ? "Information quota is exhausted — the real Punch In would be rejected. Late falls back to the normal Shift-Start-based calculation shown here."
                  : useInformation
                  ? `Information is used → the noon cutoff (${formatClock(parseTimeToMinutesOfDay(rule.cutoffTime))}) governs Late instead of Shift Start, and one Information credit would be consumed on a real punch.`
                  : "Information wasn't used — the normal Shift-Start-based Late calculation applies (see Test Late Rule for that formula).",
                "This is a preview only — no employee_information_usage row is ever created here, even when a credit would be consumed on a real punch.",
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
