import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCreateOvertimeRule, useOvertimeRuleThresholds, useUpdateOvertimeRule } from "@/hooks/useAttendanceRules";
import { todayDateKey } from "@/lib/dateRange";
import type { RoundingMethod } from "@/lib/attendanceCalculation";
import type { OvertimeRule, RuleCalculationMethod } from "@/types/attendanceRules";
import { CALCULATION_METHOD_OPTIONS, ROUNDING_METHOD_OPTIONS, needsCustomRoundingUnit } from "@/modules/attendanceRules/constants";
import { RuleThresholdEditor, type ThresholdDraft } from "@/modules/attendanceRules/components/RuleThresholdEditor";

interface OvertimeRuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: OvertimeRule | null;
  onSaved?: () => void;
}

export function OvertimeRuleFormDialog({ open, onOpenChange, rule, onSaved }: OvertimeRuleFormDialogProps) {
  const { user } = useAuth();
  const isEdit = Boolean(rule);
  const createRule = useCreateOvertimeRule();
  const updateRule = useUpdateOvertimeRule();
  const existingThresholdsQuery = useOvertimeRuleThresholds(rule?.id);

  const [ruleName, setRuleName] = useState("");
  const [ruleCode, setRuleCode] = useState("");
  const [description, setDescription] = useState("");
  const [calculationMethod, setCalculationMethod] = useState<RuleCalculationMethod>("exact");
  const [minimumOvertimeMinutes, setMinimumOvertimeMinutes] = useState(0);
  const [maximumOvertimeMinutes, setMaximumOvertimeMinutes] = useState<number | null>(null);
  const [roundingMethod, setRoundingMethod] = useState<RoundingMethod>("exact");
  const [customRoundingMinutes, setCustomRoundingMinutes] = useState<number | null>(null);
  const [weeklyOffOvertimeAllowed, setWeeklyOffOvertimeAllowed] = useState(true);
  const [holidayOvertimeAllowed, setHolidayOvertimeAllowed] = useState(true);
  const [leaveOvertimeAllowed, setLeaveOvertimeAllowed] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");
  const [thresholds, setThresholds] = useState<ThresholdDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setRuleName(rule.ruleName);
      setRuleCode(rule.ruleCode);
      setDescription(rule.description ?? "");
      setCalculationMethod(rule.calculationMethod);
      setMinimumOvertimeMinutes(rule.minimumOvertimeMinutes);
      setMaximumOvertimeMinutes(rule.maximumOvertimeMinutes);
      setRoundingMethod(rule.roundingMethod);
      setCustomRoundingMinutes(rule.customRoundingMinutes);
      setWeeklyOffOvertimeAllowed(rule.weeklyOffOvertimeAllowed);
      setHolidayOvertimeAllowed(rule.holidayOvertimeAllowed);
      setLeaveOvertimeAllowed(rule.leaveOvertimeAllowed);
      setIsActive(rule.isActive);
      setEffectiveFrom(todayDateKey());
      setRemark("");
    } else {
      setRuleName("");
      setRuleCode("");
      setDescription("");
      setCalculationMethod("exact");
      setMinimumOvertimeMinutes(0);
      setMaximumOvertimeMinutes(null);
      setRoundingMethod("exact");
      setCustomRoundingMinutes(null);
      setWeeklyOffOvertimeAllowed(true);
      setHolidayOvertimeAllowed(true);
      setLeaveOvertimeAllowed(false);
      setIsActive(true);
      setEffectiveFrom(todayDateKey());
      setRemark("");
      setThresholds([]);
    }
  }, [open, rule]);

  useEffect(() => {
    if (isEdit && existingThresholdsQuery.data) {
      setThresholds(existingThresholdsQuery.data.map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes })));
    }
  }, [isEdit, existingThresholdsQuery.data]);

  const isPending = createRule.isPending || updateRule.isPending;

  const handleSave = async () => {
    if (!user?.companyId || !ruleName.trim()) {
      toast({ title: "Rule Name is required.", variant: "destructive" });
      return;
    }

    const values = {
      ruleName: ruleName.trim(),
      ruleCode: ruleCode.trim(),
      description,
      calculationMethod,
      minimumOvertimeMinutes,
      maximumOvertimeMinutes,
      roundingMethod,
      customRoundingMinutes: needsCustomRoundingUnit(roundingMethod) ? customRoundingMinutes : null,
      weeklyOffOvertimeAllowed,
      holidayOvertimeAllowed,
      leaveOvertimeAllowed,
      isActive,
      remark,
      thresholds: calculationMethod === "slab" ? thresholds : [],
    };

    try {
      if (isEdit && rule) {
        await updateRule.mutateAsync({ currentRuleId: rule.id, companyId: user.companyId, values, effectiveFrom, userId: user.id });
        toast({ title: "Overtime Rule updated", description: `Effective from ${effectiveFrom}.`, variant: "success" });
      } else {
        await createRule.mutateAsync([user.companyId, values, effectiveFrom, user.id]);
        toast({ title: "Overtime Rule created", variant: "success" });
      }
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast({
        title: "Could not save Overtime Rule",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Overtime Rule" : "Create Overtime Rule"}</DialogTitle>
          <DialogDescription>
            Required Working Hours and the shift-level Overtime Enabled switch stay on Shift
            Management (they decide whether/where raw overtime starts). This rule decides how that
            raw overtime is COUNTED. {isEdit ? "Saving creates a new version effective from the date below — past attendance keeps using the version that calculated it." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Rule Name</Label>
              <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Standard Overtime Rule" />
            </div>
            <div className="space-y-1.5">
              <Label>Rule Code</Label>
              <Input value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} placeholder="OT-STD" disabled={isEdit} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Calculation Method</Label>
              <Select value={calculationMethod} onValueChange={(v) => setCalculationMethod(v as RuleCalculationMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CALCULATION_METHOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rounding Method</Label>
              <Select value={roundingMethod} onValueChange={(v) => setRoundingMethod(v as RoundingMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROUNDING_METHOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {needsCustomRoundingUnit(roundingMethod) ? (
            <div className="space-y-1.5">
              <Label>Rounding Unit (minutes)</Label>
              <Input
                type="number"
                min={1}
                value={customRoundingMinutes ?? ""}
                onChange={(e) => setCustomRoundingMinutes(e.target.value === "" ? null : Number(e.target.value))}
                placeholder="e.g. 15"
              />
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
              <Label>Minimum Overtime Minutes (below this = 0)</Label>
              <Input type="number" min={0} value={minimumOvertimeMinutes} onChange={(e) => setMinimumOvertimeMinutes(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Maximum Overtime Minutes (cap, optional)</Label>
              <Input
                type="number"
                min={0}
                value={maximumOvertimeMinutes ?? ""}
                onChange={(e) => setMaximumOvertimeMinutes(e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Special Day Conditions</p>
            <div className="flex items-center gap-2">
              <Checkbox checked={weeklyOffOvertimeAllowed} onCheckedChange={(v) => setWeeklyOffOvertimeAllowed(Boolean(v))} id="ot-weekly-off" />
              <Label htmlFor="ot-weekly-off">Overtime allowed on Weekly Off</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={holidayOvertimeAllowed} onCheckedChange={(v) => setHolidayOvertimeAllowed(Boolean(v))} id="ot-holiday" />
              <Label htmlFor="ot-holiday">Overtime allowed on Holiday</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={leaveOvertimeAllowed} onCheckedChange={(v) => setLeaveOvertimeAllowed(Boolean(v))} id="ot-leave" />
              <Label htmlFor="ot-leave">Overtime allowed on Leave</Label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Effective From</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} id="ot-rule-active" />
              <Label htmlFor="ot-rule-active">Active</Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Remark</Label>
            <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Reason for this rule / change." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
