import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { todayDateKey } from "@/lib/dateRange";
import { formatDate } from "@/lib/utils";
import type { RoundingMethod, PenaltyMethod } from "@/lib/attendanceCalculation";
import { ROUNDING_METHOD_OPTIONS, needsCustomRoundingUnit } from "@/modules/attendanceRules/constants";
import { RuleThresholdEditor, type ThresholdDraft } from "@/modules/attendanceRules/components/RuleThresholdEditor";
import { InformationRuleSimulatorDialog } from "@/modules/attendanceRules/components/InformationRuleSimulatorDialog";
import { LateRuleSimulatorDialog } from "@/modules/attendanceRules/components/LateRuleSimulatorDialog";
import { PenaltyRuleSimulatorDialog } from "@/modules/attendanceRules/components/PenaltyRuleSimulatorDialog";
import { HalfDayRuleSimulatorDialog } from "@/modules/attendanceRules/components/HalfDayRuleSimulatorDialog";
import { EarlyGoingRuleSimulatorDialog } from "@/modules/attendanceRules/components/EarlyGoingRuleSimulatorDialog";
import { ExtendedDutyRuleSimulatorDialog } from "@/modules/attendanceRules/components/ExtendedDutyRuleSimulatorDialog";
import {
  useCurrentWeeklyOffLateRule,
  useSaveWeeklyOffLateRule,
  useCreateWeeklyOffLateRuleVariant,
  useCurrentInformationRule,
  useSaveInformationRule,
  useCreateInformationRuleVariant,
  useCurrentPenaltyRule,
  usePenaltyThresholds,
  useSavePenaltyRule,
  useCreatePenaltyRuleVariant,
  useCurrentHalfDayRule,
  useSaveHalfDayRule,
  useCreateHalfDayRuleVariant,
  useCurrentEarlyGoingRule,
  useEarlyGoingThresholds,
  useSaveEarlyGoingRule,
  useCreateEarlyGoingRuleVariant,
  useCurrentExtendedDutyRule,
  useSaveExtendedDutyRule,
  useCreateExtendedDutyRuleVariant,
  useCurrentNightDutyConfig,
  useSaveNightDutyConfig,
} from "@/hooks/useExtendedAttendanceRules";

const PENALTY_METHOD_OPTIONS: { value: PenaltyMethod; label: string }[] = [
  { value: "none", label: "No Penalty" },
  { value: "actual", label: "Actual Late Minutes" },
  { value: "double", label: "Double Late" },
  { value: "1.5x", label: "1.5 x Late" },
  { value: "2x", label: "2 x Late" },
  { value: "fixed", label: "Fixed Minutes" },
  { value: "slab", label: "Slab Based" },
  { value: "custom_multiplier", label: "Custom Multiplier" },
  { value: "custom_fixed", label: "Custom Fixed Minutes" },
];

// Migration 0058: Weekly Off and Information Used Day are now governed by their own dedicated
// toggles below (Penalty Applicability section), evaluated BEFORE this switch — so those two
// options, and 'half_day' (now hardcoded off, never configurable), are removed from this list to
// avoid implying they still control anything here. This dropdown now only ever governs a plain
// Normal Working Day with no Weekly Off / no explicit Information usage.
const PENALTY_APPLICABILITY_OPTIONS = [
  { value: "every_late", label: "Every Late" },
  { value: "after_information_exhausted", label: "After Information Exhausted (Normal Day)" },
  { value: "normal_day_only", label: "Normal Working Day Only" },
  { value: "other", label: "Other / Unconditional" },
] as const;

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

/**
 * All six company-wide singleton rules (Information, Penalty, Half Day, Early Going, Extended
 * Duty, Night Duty Approval Config) in one panel — each is "one active configuration per company,
 * versioned the same close-old-open-new way as Late/Overtime Rules" (an explicit, approved
 * simplification: no Employee>Shift>Store>Company assignment hierarchy for these). Caller is
 * responsible for the Super-Admin-only gate (see AttendanceRuleManagementPage).
 */
export function ExtendedRulesPanel() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;

  return (
    <div className="space-y-6">
      <WeeklyOffLateRuleSection companyId={companyId} userId={user?.id} />
      <InformationRuleSection companyId={companyId} userId={user?.id} />
      <PenaltyRuleSection companyId={companyId} userId={user?.id} />
      <HalfDayRuleSection companyId={companyId} userId={user?.id} />
      <EarlyGoingRuleSection companyId={companyId} userId={user?.id} />
      <ExtendedDutyRuleSection companyId={companyId} userId={user?.id} />
      <NightDutyConfigSection companyId={companyId} userId={user?.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly Off Late Rule
//
// Logically, visually, and now STRUCTURALLY separate from both the Normal Late Rule
// (attendance_late_rules, edited on the "Late Rules" tab) and the Information/Intimation Rule
// (its own table, own card below) — own dedicated table (attendance_weekly_off_late_rules),
// own storage, own edit dialog. Editing here never touches either of those.
//
// THIS PHASE (temporary, by explicit instruction): completely independent of Information. Punch
// In <= Weekly Off Cutoff -> Late 0. Punch In > Cutoff -> Late = Punch In - Cutoff, in full. No
// Information Remaining/Used/Available/Exhausted check of any kind, no employee_information_usage
// row ever created by this rule. The Weekly Off + Information interaction is a planned future
// phase, deliberately deferred (migration 0057).
// ---------------------------------------------------------------------------
function WeeklyOffLateRuleSection({ companyId, userId }: { companyId?: string; userId?: string }) {
  const ruleQuery = useCurrentWeeklyOffLateRule(companyId);
  const save = useSaveWeeklyOffLateRule();
  const createVariant = useCreateWeeklyOffLateRuleVariant();
  const [open, setOpen] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [cutoffTime, setCutoffTime] = useState("12:00");
  const [isActive, setIsActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open) return;
    const r = ruleQuery.data;
    setCutoffTime(r?.cutoffTime.slice(0, 5) ?? "12:00");
    setIsActive(r?.isActive ?? true);
    setEffectiveFrom(todayDateKey());
    setRemark("");
  }, [open, ruleQuery.data]);

  const handleSave = async () => {
    if (!companyId) return;
    try {
      await save.mutateAsync([ruleQuery.data?.id, companyId, { cutoffTime, isActive, remark }, effectiveFrom, userId]);
      toast({ title: "Weekly Off Late Rule saved", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleSaveAsVariant = async () => {
    if (!companyId) return;
    try {
      await createVariant.mutateAsync([companyId, { cutoffTime, isActive, remark }, effectiveFrom, userId]);
      toast({ title: "New Weekly Off Late Rule variant created — assign it to a Store/Employee scope under Rule Assignments.", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const r = ruleQuery.data;

  return (
    <Card className="border-amber-400/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Weekly Off Late Rule</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>{r ? "Edit" : "Configure"}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowTest(true)} disabled={!r}>
            <FlaskConical className="mr-1 h-4 w-4" /> Test Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-4">
        <InfoLine label="Weekly Off Cutoff Time" value={r ? r.cutoffTime.slice(0, 5) : "Not configured"} />
        <InfoLine label="Status" value={r ? (r.isActive ? "Active" : "Inactive") : "—"} />
        <InfoLine label="Effective From" value={r ? formatDate(r.effectiveFrom) : "—"} />
        <InfoLine label="Remark" value={r?.remark ?? "—"} />
      </CardContent>
      <CardContent className="pt-0 space-y-1.5 text-xs text-muted-foreground">
        <p>Separate from the Normal Late Rule (Shift Start + configured grace/slabs) — governs Late on an employee's Weekly Off only:</p>
        <p>• Punch In ≤ Weekly Off Cutoff → Late 0.</p>
        <p>• Punch In &gt; Weekly Off Cutoff → Late = Punch In − Weekly Off Cutoff, in full.</p>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Weekly Off Late Rule</DialogTitle>
            <DialogDescription>Separate from the Normal Late Rule. Punch In ≤ cutoff → Late 0; Punch In &gt; cutoff → Late = Punch In − cutoff.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Weekly Off Cutoff Time</Label>
              <Input type="time" value={cutoffTime} onChange={(e) => setCutoffTime(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} id="wo-late-active" />
                <Label htmlFor="wo-late-active">Active</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remark</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending || createVariant.isPending}>Cancel</Button>
            <Button variant="outline" onClick={handleSaveAsVariant} disabled={save.isPending || createVariant.isPending}>
              {createVariant.isPending ? "Creating…" : "Save as New Variant"}
            </Button>
            <Button onClick={handleSave} disabled={save.isPending || createVariant.isPending}>{save.isPending ? "Saving…" : "Save (Company Default)"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LateRuleSimulatorDialog open={showTest} onOpenChange={setShowTest} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Information Rule
// ---------------------------------------------------------------------------
function InformationRuleSection({ companyId, userId }: { companyId?: string; userId?: string }) {
  const ruleQuery = useCurrentInformationRule(companyId);
  const save = useSaveInformationRule();
  const createVariant = useCreateInformationRuleVariant();
  const [open, setOpen] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [monthlyLimit, setMonthlyLimit] = useState(2);
  const [cutoffTime, setCutoffTime] = useState("12:00");
  const [applicableOnWeeklyOff, setApplicableOnWeeklyOff] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open) return;
    const r = ruleQuery.data;
    setMonthlyLimit(r?.monthlyLimit ?? 2);
    setCutoffTime(r?.cutoffTime.slice(0, 5) ?? "12:00");
    setApplicableOnWeeklyOff(r?.applicableOnWeeklyOff ?? true);
    setIsActive(r?.isActive ?? true);
    setEffectiveFrom(todayDateKey());
    setRemark("");
  }, [open, ruleQuery.data]);

  const handleSave = async () => {
    if (!companyId) return;
    try {
      await save.mutateAsync([ruleQuery.data?.id, companyId, { monthlyLimit, cutoffTime, applicableOnWeeklyOff, isActive, remark }, effectiveFrom, userId]);
      toast({ title: "Information Rule saved", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleSaveAsVariant = async () => {
    if (!companyId) return;
    try {
      await createVariant.mutateAsync([companyId, { monthlyLimit, cutoffTime, applicableOnWeeklyOff, isActive, remark }, effectiveFrom, userId]);
      toast({ title: "New Information Rule variant created — assign it to a Store/Employee scope under Rule Assignments.", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const r = ruleQuery.data;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Information / Intimation Rule</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>{r ? "Edit" : "Configure"}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowTest(true)} disabled={!r}>
            <FlaskConical className="mr-1 h-4 w-4" /> Test Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-4">
        <InfoLine label="Monthly Limit" value={r ? String(r.monthlyLimit) : "Not configured"} />
        <InfoLine label="Cutoff Time" value={r ? r.cutoffTime.slice(0, 5) : "—"} />
        <InfoLine label="Applies to Weekly Off" value={r ? (r.applicableOnWeeklyOff ? "Yes" : "No") : "—"} />
        <InfoLine label="Effective From" value={r ? formatDate(r.effectiveFrom) : "—"} />
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Information / Intimation Rule</DialogTitle>
            <DialogDescription>Governs the monthly quota and the noon cutoff used on Information days and (if enabled) Weekly-Off-worked days. Never applies to a normal working day.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Monthly Limit</Label>
                <Input type="number" min={0} value={monthlyLimit} onChange={(e) => setMonthlyLimit(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label>Cutoff Time</Label>
                <Input type="time" value={cutoffTime} onChange={(e) => setCutoffTime(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={applicableOnWeeklyOff} onCheckedChange={(v) => setApplicableOnWeeklyOff(Boolean(v))} id="info-wo" />
              <Label htmlFor="info-wo">Same cutoff also applies when an employee works on their Weekly Off</Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} id="info-active" />
                <Label htmlFor="info-active">Active</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remark</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending || createVariant.isPending}>Cancel</Button>
            <Button variant="outline" onClick={handleSaveAsVariant} disabled={save.isPending || createVariant.isPending}>
              {createVariant.isPending ? "Creating…" : "Save as New Variant"}
            </Button>
            <Button onClick={handleSave} disabled={save.isPending || createVariant.isPending}>{save.isPending ? "Saving…" : "Save (Company Default)"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <InformationRuleSimulatorDialog open={showTest} onOpenChange={setShowTest} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Penalty Rule
// ---------------------------------------------------------------------------
function PenaltyRuleSection({ companyId, userId }: { companyId?: string; userId?: string }) {
  const ruleQuery = useCurrentPenaltyRule(companyId);
  const thresholdsQuery = usePenaltyThresholds(ruleQuery.data?.id);
  const save = useSavePenaltyRule();
  const createVariant = useCreatePenaltyRuleVariant();
  const [open, setOpen] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [method, setMethod] = useState<PenaltyMethod>("none");
  const [fixedMinutes, setFixedMinutes] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [applicability, setApplicability] = useState<string>("after_information_exhausted");
  const [applyOnWeeklyOff, setApplyOnWeeklyOff] = useState(true);
  const [applyOnInformationDay, setApplyOnInformationDay] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");
  const [thresholds, setThresholds] = useState<ThresholdDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    const r = ruleQuery.data;
    setMethod(r?.method ?? "none");
    setFixedMinutes(r?.fixedMinutes ?? null);
    setMultiplier(r?.multiplier ?? null);
    setApplicability(r?.applicability ?? "after_information_exhausted");
    setApplyOnWeeklyOff(r?.applyOnWeeklyOff ?? true);
    setApplyOnInformationDay(r?.applyOnInformationDay ?? true);
    setIsActive(r?.isActive ?? true);
    setEffectiveFrom(todayDateKey());
    setRemark("");
    setThresholds((thresholdsQuery.data ?? []).map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes })));
  }, [open, ruleQuery.data, thresholdsQuery.data]);

  const handleSave = async () => {
    if (!companyId) return;
    try {
      await save.mutateAsync([
        ruleQuery.data?.id,
        companyId,
        { method, fixedMinutes, multiplier, applicability: applicability as any, applyOnWeeklyOff, applyOnInformationDay, isActive, remark, thresholds: method === "slab" ? thresholds : [] },
        effectiveFrom,
        userId,
      ]);
      toast({ title: "Penalty Rule saved", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleSaveAsVariant = async () => {
    if (!companyId) return;
    try {
      await createVariant.mutateAsync([
        companyId,
        { method, fixedMinutes, multiplier, applicability: applicability as any, applyOnWeeklyOff, applyOnInformationDay, isActive, remark, thresholds: method === "slab" ? thresholds : [] },
        effectiveFrom,
        userId,
      ]);
      toast({ title: "New Penalty Rule variant created — assign it to a Store/Employee scope under Rule Assignments.", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const r = ruleQuery.data;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Penalty Rule</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>{r ? "Edit" : "Configure"}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowTest(true)} disabled={!r}>
            <FlaskConical className="mr-1 h-4 w-4" /> Test Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <InfoLine label="Method" value={r ? PENALTY_METHOD_OPTIONS.find((o) => o.value === r.method)?.label ?? r.method : "Not configured (0 penalty)"} />
        <InfoLine label="Normal Day Applicability" value={r ? PENALTY_APPLICABILITY_OPTIONS.find((o) => o.value === r.applicability)?.label ?? r.applicability : "—"} />
        <InfoLine label="Effective From" value={r ? formatDate(r.effectiveFrom) : "—"} />
        <InfoLine label="Apply Penalty on Weekly Off" value={r ? (r.applyOnWeeklyOff ? "Yes" : "No") : "—"} />
        <InfoLine label="Apply Penalty on Information Used Day" value={r ? (r.applyOnInformationDay ? "Yes" : "No") : "—"} />
        <InfoLine label="Half Day (Late Arrival)" value="Never (not configurable)" />
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Penalty Rule</DialogTitle>
            <DialogDescription>Penalty is derived from Actual Late Minutes and stored SEPARATELY — it never overwrites Actual Late.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PenaltyMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PENALTY_METHOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {method === "fixed" || method === "custom_fixed" ? (
                <div className="space-y-1.5">
                  <Label>Fixed Minutes</Label>
                  <Input type="number" min={0} value={fixedMinutes ?? ""} onChange={(e) => setFixedMinutes(e.target.value === "" ? null : Number(e.target.value))} />
                </div>
              ) : null}
              {method === "custom_multiplier" ? (
                <div className="space-y-1.5">
                  <Label>Multiplier</Label>
                  <Input type="number" step="0.1" min={0} value={multiplier ?? ""} onChange={(e) => setMultiplier(e.target.value === "" ? null : Number(e.target.value))} />
                </div>
              ) : null}
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-semibold">Penalty Applicability</p>

              <div className="space-y-1.5">
                <Label>Normal Working Day</Label>
                <Select value={applicability} onValueChange={setApplicability}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PENALTY_APPLICABILITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox checked={applyOnWeeklyOff} onCheckedChange={(v) => setApplyOnWeeklyOff(Boolean(v))} id="penalty-wo" />
                <Label htmlFor="penalty-wo">Apply Penalty on Weekly Off</Label>
              </div>
              <p className="pl-6 text-xs text-muted-foreground">Independent of Information Used Day below. Turning this off does not change Weekly Off Late — only whether Penalty is computed from it.</p>

              <div className="flex items-center gap-2">
                <Checkbox checked={applyOnInformationDay} onCheckedChange={(v) => setApplyOnInformationDay(Boolean(v))} id="penalty-info" />
                <Label htmlFor="penalty-info">Apply Penalty on Information Used Day</Label>
              </div>
              <p className="pl-6 text-xs text-muted-foreground">Independent of Weekly Off above. Turning this off does not change Information Day Late — only whether Penalty is computed from it.</p>

              <div className="flex items-center gap-2 opacity-60">
                <Checkbox checked={false} disabled id="penalty-halfday" />
                <Label htmlFor="penalty-halfday">Apply Penalty on Half Day (Late Arrival) — disabled, Penalty never applies</Label>
              </div>
            </div>

            {method === "slab" ? (
              <div className="space-y-1.5">
                <Label>Slabs</Label>
                <RuleThresholdEditor thresholds={thresholds} onChange={setThresholds} />
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} id="penalty-active" />
                <Label htmlFor="penalty-active">Active</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remark</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending || createVariant.isPending}>Cancel</Button>
            <Button variant="outline" onClick={handleSaveAsVariant} disabled={save.isPending || createVariant.isPending}>
              {createVariant.isPending ? "Creating…" : "Save as New Variant"}
            </Button>
            <Button onClick={handleSave} disabled={save.isPending || createVariant.isPending}>{save.isPending ? "Saving…" : "Save (Company Default)"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PenaltyRuleSimulatorDialog open={showTest} onOpenChange={setShowTest} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Half Day Rule
// ---------------------------------------------------------------------------
function HalfDayRuleSection({ companyId, userId }: { companyId?: string; userId?: string }) {
  const ruleQuery = useCurrentHalfDayRule(companyId);
  const save = useSaveHalfDayRule();
  const createVariant = useCreateHalfDayRuleVariant();
  const [open, setOpen] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [lateArrivalCutoffTime, setLateArrivalCutoffTime] = useState("14:00");
  const [earlyGoingCutoffTime, setEarlyGoingCutoffTime] = useState("16:00");
  const [isActive, setIsActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open) return;
    const r = ruleQuery.data;
    setLateArrivalCutoffTime(r?.lateArrivalCutoffTime.slice(0, 5) ?? "14:00");
    setEarlyGoingCutoffTime(r?.earlyGoingCutoffTime.slice(0, 5) ?? "16:00");
    setIsActive(r?.isActive ?? true);
    setEffectiveFrom(todayDateKey());
    setRemark("");
  }, [open, ruleQuery.data]);

  const handleSave = async () => {
    if (!companyId) return;
    try {
      await save.mutateAsync([ruleQuery.data?.id, companyId, { lateArrivalCutoffTime, earlyGoingCutoffTime, isActive, remark }, effectiveFrom, userId]);
      toast({ title: "Half Day Rule saved", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleSaveAsVariant = async () => {
    if (!companyId) return;
    try {
      await createVariant.mutateAsync([companyId, { lateArrivalCutoffTime, earlyGoingCutoffTime, isActive, remark }, effectiveFrom, userId]);
      toast({ title: "New Half Day Rule variant created — assign it to a Store/Employee scope under Rule Assignments.", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const r = ruleQuery.data;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Half Day Rule</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>{r ? "Edit" : "Configure"}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowTest(true)} disabled={!r}>
            <FlaskConical className="mr-1 h-4 w-4" /> Test Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <InfoLine label="Late Arrival Cutoff" value={r ? r.lateArrivalCutoffTime.slice(0, 5) : "Not configured"} />
        <InfoLine label="Early Going Cutoff" value={r ? r.earlyGoingCutoffTime.slice(0, 5) : "Not configured"} />
        <InfoLine label="Effective From" value={r ? formatDate(r.effectiveFrom) : "—"} />
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Half Day Rule</DialogTitle>
            <DialogDescription>Punch In at/after the Late Arrival Cutoff, or Punch Out at/before the Early Going Cutoff, converts the day to Half Day.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Late Arrival Cutoff (Half Day if Punch In &gt;=)</Label>
                <Input type="time" value={lateArrivalCutoffTime} onChange={(e) => setLateArrivalCutoffTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Early Going Cutoff (Half Day if Punch Out &lt;=)</Label>
                <Input type="time" value={earlyGoingCutoffTime} onChange={(e) => setEarlyGoingCutoffTime(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} id="halfday-active" />
                <Label htmlFor="halfday-active">Active</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remark</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending || createVariant.isPending}>Cancel</Button>
            <Button variant="outline" onClick={handleSaveAsVariant} disabled={save.isPending || createVariant.isPending}>
              {createVariant.isPending ? "Creating…" : "Save as New Variant"}
            </Button>
            <Button onClick={handleSave} disabled={save.isPending || createVariant.isPending}>{save.isPending ? "Saving…" : "Save (Company Default)"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <HalfDayRuleSimulatorDialog open={showTest} onOpenChange={setShowTest} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Early Going Rule
// ---------------------------------------------------------------------------
function EarlyGoingRuleSection({ companyId, userId }: { companyId?: string; userId?: string }) {
  const ruleQuery = useCurrentEarlyGoingRule(companyId);
  const thresholdsQuery = useEarlyGoingThresholds(ruleQuery.data?.id);
  const save = useSaveEarlyGoingRule();
  const createVariant = useCreateEarlyGoingRuleVariant();
  const [open, setOpen] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [graceMinutes, setGraceMinutes] = useState(0);
  const [calculationMethod, setCalculationMethod] = useState<"exact" | "slab">("exact");
  const [roundingMethod, setRoundingMethod] = useState<RoundingMethod>("exact");
  const [customRoundingMinutes, setCustomRoundingMinutes] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");
  const [thresholds, setThresholds] = useState<ThresholdDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    const r = ruleQuery.data;
    setGraceMinutes(r?.graceMinutes ?? 0);
    setCalculationMethod(r?.calculationMethod ?? "exact");
    setRoundingMethod(r?.roundingMethod ?? "exact");
    setCustomRoundingMinutes(r?.customRoundingMinutes ?? null);
    setIsActive(r?.isActive ?? true);
    setEffectiveFrom(todayDateKey());
    setRemark("");
    setThresholds((thresholdsQuery.data ?? []).map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes })));
  }, [open, ruleQuery.data, thresholdsQuery.data]);

  const handleSave = async () => {
    if (!companyId) return;
    try {
      await save.mutateAsync([
        ruleQuery.data?.id,
        companyId,
        { graceMinutes, calculationMethod, roundingMethod, customRoundingMinutes: needsCustomRoundingUnit(roundingMethod) ? customRoundingMinutes : null, isActive, remark, thresholds: calculationMethod === "slab" ? thresholds : [] },
        effectiveFrom,
        userId,
      ]);
      toast({ title: "Early Going Rule saved", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleSaveAsVariant = async () => {
    if (!companyId) return;
    try {
      await createVariant.mutateAsync([
        companyId,
        { graceMinutes, calculationMethod, roundingMethod, customRoundingMinutes: needsCustomRoundingUnit(roundingMethod) ? customRoundingMinutes : null, isActive, remark, thresholds: calculationMethod === "slab" ? thresholds : [] },
        effectiveFrom,
        userId,
      ]);
      toast({ title: "New Early Going Rule variant created — assign it to a Store/Employee scope under Rule Assignments.", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const r = ruleQuery.data;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Early Going Rule</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>{r ? "Edit" : "Configure"}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowTest(true)} disabled={!r}>
            <FlaskConical className="mr-1 h-4 w-4" /> Test Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <InfoLine label="Grace (threshold, not subtracted)" value={r ? `${r.graceMinutes} min` : "0 min"} />
        <InfoLine label="Rounding" value={r ? ROUNDING_METHOD_OPTIONS.find((o) => o.value === r.roundingMethod)?.label ?? r.roundingMethod : "Exact"} />
        <InfoLine label="Effective From" value={r ? formatDate(r.effectiveFrom) : "—"} />
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Early Going Rule</DialogTitle>
            <DialogDescription>Independent of Late Grace. Grace here is a threshold gate too (Shift End 8PM, Grace 10 -&gt; 7:50PM=10, 7:49PM=11 — never elapsed-minus-grace).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Grace (minutes)</Label>
                <Input type="number" min={0} value={graceMinutes} onChange={(e) => setGraceMinutes(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label>Calculation Method</Label>
                <Select value={calculationMethod} onValueChange={(v) => setCalculationMethod(v as "exact" | "slab")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exact">Exact</SelectItem>
                    <SelectItem value="slab">Slab / Threshold-based</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Rounding Method</Label>
              <Select value={roundingMethod} onValueChange={(v) => setRoundingMethod(v as RoundingMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROUNDING_METHOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {needsCustomRoundingUnit(roundingMethod) ? (
              <div className="space-y-1.5">
                <Label>Rounding Unit (minutes)</Label>
                <Input type="number" min={1} value={customRoundingMinutes ?? ""} onChange={(e) => setCustomRoundingMinutes(e.target.value === "" ? null : Number(e.target.value))} />
              </div>
            ) : null}
            {calculationMethod === "slab" ? (
              <div className="space-y-1.5">
                <Label>Slabs</Label>
                <RuleThresholdEditor thresholds={thresholds} onChange={setThresholds} />
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} id="earlygoing-active" />
                <Label htmlFor="earlygoing-active">Active</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remark</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending || createVariant.isPending}>Cancel</Button>
            <Button variant="outline" onClick={handleSaveAsVariant} disabled={save.isPending || createVariant.isPending}>
              {createVariant.isPending ? "Creating…" : "Save as New Variant"}
            </Button>
            <Button onClick={handleSave} disabled={save.isPending || createVariant.isPending}>{save.isPending ? "Saving…" : "Save (Company Default)"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <EarlyGoingRuleSimulatorDialog open={showTest} onOpenChange={setShowTest} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Extended Duty Rule
// ---------------------------------------------------------------------------
function ExtendedDutyRuleSection({ companyId, userId }: { companyId?: string; userId?: string }) {
  const ruleQuery = useCurrentExtendedDutyRule(companyId);
  const save = useSaveExtendedDutyRule();
  const createVariant = useCreateExtendedDutyRuleVariant();
  const [open, setOpen] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [midnightThresholdTime, setMidnightThresholdTime] = useState("00:00");
  const [midnightExtraDutyValue, setMidnightExtraDutyValue] = useState(0.5);
  const [firstDaySalaryThresholdTime, setFirstDaySalaryThresholdTime] = useState("02:00");
  const [firstDayExtraDutyValue, setFirstDayExtraDutyValue] = useState(1.0);
  const [secondDaySalaryThresholdTime, setSecondDaySalaryThresholdTime] = useState("08:00");
  const [secondDayExtraDutyValue, setSecondDayExtraDutyValue] = useState(2.0);
  const [hourlyOtRoundingMethod, setHourlyOtRoundingMethod] = useState<RoundingMethod>("exact");
  const [hourlyOtCustomRoundingMinutes, setHourlyOtCustomRoundingMinutes] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open) return;
    const r = ruleQuery.data;
    setMidnightThresholdTime(r?.midnightThresholdTime.slice(0, 5) ?? "00:00");
    setMidnightExtraDutyValue(r?.midnightExtraDutyValue ?? 0.5);
    setFirstDaySalaryThresholdTime(r?.firstDaySalaryThresholdTime.slice(0, 5) ?? "02:00");
    setFirstDayExtraDutyValue(r?.firstDayExtraDutyValue ?? 1.0);
    setSecondDaySalaryThresholdTime(r?.secondDaySalaryThresholdTime.slice(0, 5) ?? "08:00");
    setSecondDayExtraDutyValue(r?.secondDayExtraDutyValue ?? 2.0);
    setHourlyOtRoundingMethod(r?.hourlyOtRoundingMethod ?? "exact");
    setHourlyOtCustomRoundingMinutes(r?.hourlyOtCustomRoundingMinutes ?? null);
    setIsActive(r?.isActive ?? true);
    setEffectiveFrom(todayDateKey());
    setRemark("");
  }, [open, ruleQuery.data]);

  const handleSave = async () => {
    if (!companyId) return;
    try {
      await save.mutateAsync([
        ruleQuery.data?.id,
        companyId,
        {
          midnightThresholdTime, midnightExtraDutyValue, firstDaySalaryThresholdTime, firstDayExtraDutyValue,
          secondDaySalaryThresholdTime, secondDayExtraDutyValue,
          hourlyOtRoundingMethod, hourlyOtCustomRoundingMinutes: needsCustomRoundingUnit(hourlyOtRoundingMethod) ? hourlyOtCustomRoundingMinutes : null,
          isActive, remark,
        },
        effectiveFrom,
        userId,
      ]);
      toast({ title: "Extended Duty Rule saved", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleSaveAsVariant = async () => {
    if (!companyId) return;
    try {
      await createVariant.mutateAsync([
        companyId,
        {
          midnightThresholdTime, midnightExtraDutyValue, firstDaySalaryThresholdTime, firstDayExtraDutyValue,
          secondDaySalaryThresholdTime, secondDayExtraDutyValue,
          hourlyOtRoundingMethod, hourlyOtCustomRoundingMinutes: needsCustomRoundingUnit(hourlyOtRoundingMethod) ? hourlyOtCustomRoundingMinutes : null,
          isActive, remark,
        },
        effectiveFrom,
        userId,
      ]);
      toast({ title: "New Extended Duty Rule variant created — assign it to a Store/Employee scope under Rule Assignments.", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const r = ruleQuery.data;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Extended Duty (Late Night) Rule</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>{r ? "Edit" : "Configure"}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowTest(true)}>
            <FlaskConical className="mr-1 h-4 w-4" /> Test Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <InfoLine label="Midnight" value={r ? `${r.midnightThresholdTime.slice(0, 5)} → ${r.midnightExtraDutyValue} Day` : "00:00 → 0.5 Day (default)"} />
        <InfoLine label="First Day Salary" value={r ? `${r.firstDaySalaryThresholdTime.slice(0, 5)} → ${r.firstDayExtraDutyValue} Day` : "02:00 → 1.0 Day (default)"} />
        <InfoLine label="Second Day Salary" value={r ? `${r.secondDaySalaryThresholdTime.slice(0, 5)} → ${r.secondDayExtraDutyValue} Days` : "08:00 → 2.0 Days (default)"} />
      </CardContent>
      <CardContent className="pt-0 text-xs text-muted-foreground">
        Normal OT (Shift-End based) is always capped at the Midnight threshold — Extended Duty's hourly OT only starts from that same instant, so the two never double-count the same span.
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Extended Duty (Late Night) Rule</DialogTitle>
            <DialogDescription>Separate from Normal OT. Applies only once Punch Out crosses the Midnight threshold.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Midnight Threshold</Label>
                <Input type="time" value={midnightThresholdTime} onChange={(e) => setMidnightThresholdTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Midnight Extra Duty (Days)</Label>
                <Input type="number" step="0.1" min={0} value={midnightExtraDutyValue} onChange={(e) => setMidnightExtraDutyValue(Number(e.target.value))} />
              </div>
              <div />
              <div className="space-y-1.5">
                <Label>First Day Salary Threshold</Label>
                <Input type="time" value={firstDaySalaryThresholdTime} onChange={(e) => setFirstDaySalaryThresholdTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>First Day Extra Duty (Days)</Label>
                <Input type="number" step="0.1" min={0} value={firstDayExtraDutyValue} onChange={(e) => setFirstDayExtraDutyValue(Number(e.target.value))} />
              </div>
              <div />
              <div className="space-y-1.5">
                <Label>Second Day Salary Threshold</Label>
                <Input type="time" value={secondDaySalaryThresholdTime} onChange={(e) => setSecondDaySalaryThresholdTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Second Day Extra Duty (Days)</Label>
                <Input type="number" step="0.1" min={0} value={secondDayExtraDutyValue} onChange={(e) => setSecondDayExtraDutyValue(Number(e.target.value))} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Hourly OT Rounding</Label>
                <Select value={hourlyOtRoundingMethod} onValueChange={(v) => setHourlyOtRoundingMethod(v as RoundingMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROUNDING_METHOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {needsCustomRoundingUnit(hourlyOtRoundingMethod) ? (
                <div className="space-y-1.5">
                  <Label>Rounding Unit (minutes)</Label>
                  <Input type="number" min={1} value={hourlyOtCustomRoundingMinutes ?? ""} onChange={(e) => setHourlyOtCustomRoundingMinutes(e.target.value === "" ? null : Number(e.target.value))} />
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} id="extended-active" />
                <Label htmlFor="extended-active">Active</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remark</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending || createVariant.isPending}>Cancel</Button>
            <Button variant="outline" onClick={handleSaveAsVariant} disabled={save.isPending || createVariant.isPending}>
              {createVariant.isPending ? "Creating…" : "Save as New Variant"}
            </Button>
            <Button onClick={handleSave} disabled={save.isPending || createVariant.isPending}>{save.isPending ? "Saving…" : "Save (Company Default)"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ExtendedDutyRuleSimulatorDialog open={showTest} onOpenChange={setShowTest} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Night Duty Approval Config
// ---------------------------------------------------------------------------
function NightDutyConfigSection({ companyId, userId }: { companyId?: string; userId?: string }) {
  const ruleQuery = useCurrentNightDutyConfig(companyId);
  const save = useSaveNightDutyConfig();
  const [open, setOpen] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [allowPayableOutOverride, setAllowPayableOutOverride] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open) return;
    const r = ruleQuery.data;
    setApprovalRequired(r?.approvalRequired ?? true);
    setAllowPayableOutOverride(r?.allowPayableOutOverride ?? true);
    setIsActive(r?.isActive ?? true);
    setEffectiveFrom(todayDateKey());
    setRemark("");
  }, [open, ruleQuery.data]);

  const handleSave = async () => {
    if (!companyId) return;
    try {
      await save.mutateAsync([ruleQuery.data?.id, companyId, { approvalRequired, allowPayableOutOverride, isActive, remark }, effectiveFrom, userId]);
      toast({ title: "Night Duty Approval Config saved", variant: "success" });
      setOpen(false);
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const r = ruleQuery.data;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Night Duty Approval Configuration</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>{r ? "Edit" : "Configure"}</Button>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <InfoLine label="Approval Required" value={r ? (r.approvalRequired ? "Yes" : "No") : "Yes (default)"} />
        <InfoLine label="Approver" value="Operations Manager, then Super Manager" />
        <InfoLine label="Effective From" value={r ? formatDate(r.effectiveFrom) : "—"} />
      </CardContent>
      <CardContent className="pt-0 text-xs text-muted-foreground">
        Requests route to the Operations Manager assigned to that store first; they may Approve, Disallow, or Carry Forward to a Super Manager for the final decision. Manage who holds these roles under Attendance → Night Duty Manager Access. Super Admin retains oversight but is not the normal approval route.
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Night Duty Approval Configuration</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox checked={approvalRequired} onCheckedChange={(v) => setApprovalRequired(Boolean(v))} id="nd-required" />
              <Label htmlFor="nd-required">Approval Required (a pending record is created whenever Extended Duty is triggered)</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={allowPayableOutOverride} onCheckedChange={(v) => setAllowPayableOutOverride(Boolean(v))} id="nd-override" />
              <Label htmlFor="nd-override">Allow Manager Confirmed Payable Out Time on Disallow</Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} id="nd-active" />
                <Label htmlFor="nd-active">Active</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remark</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending}>Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
