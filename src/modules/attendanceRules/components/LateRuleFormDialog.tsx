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
import { useCreateLateRule, useLateRuleThresholds, useUpdateLateRule } from "@/hooks/useAttendanceRules";
import { todayDateKey } from "@/lib/dateRange";
import type { RoundingMethod } from "@/lib/attendanceCalculation";
import type { LateRule, RuleCalculationMethod } from "@/types/attendanceRules";
import { CALCULATION_METHOD_OPTIONS, ROUNDING_METHOD_OPTIONS, needsCustomRoundingUnit } from "@/modules/attendanceRules/constants";
import { RuleThresholdEditor, type ThresholdDraft } from "@/modules/attendanceRules/components/RuleThresholdEditor";

interface LateRuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a brand new rule; otherwise editing (versioning) this rule. */
  rule: LateRule | null;
  onSaved?: () => void;
}

const emptyThresholds: ThresholdDraft[] = [
  { fromMinutes: 0, toMinutes: 10, calculatedMinutes: 0 },
  { fromMinutes: 11, toMinutes: 20, calculatedMinutes: 15 },
  { fromMinutes: 21, toMinutes: 30, calculatedMinutes: 30 },
  { fromMinutes: 31, toMinutes: null, calculatedMinutes: 60 },
];

export function LateRuleFormDialog({ open, onOpenChange, rule, onSaved }: LateRuleFormDialogProps) {
  const { user } = useAuth();
  const isEdit = Boolean(rule);
  const createRule = useCreateLateRule();
  const updateRule = useUpdateLateRule();
  const existingThresholdsQuery = useLateRuleThresholds(rule?.id);

  const [ruleName, setRuleName] = useState("");
  const [ruleCode, setRuleCode] = useState("");
  const [description, setDescription] = useState("");
  const [calculationMethod, setCalculationMethod] = useState<RuleCalculationMethod>("exact");
  const [roundingMethod, setRoundingMethod] = useState<RoundingMethod>("exact");
  const [customRoundingMinutes, setCustomRoundingMinutes] = useState<number | null>(null);
  const [minimumLateMinutes, setMinimumLateMinutes] = useState(0);
  const [maximumLateMinutes, setMaximumLateMinutes] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [remark, setRemark] = useState("");
  const [thresholds, setThresholds] = useState<ThresholdDraft[]>(emptyThresholds);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setRuleName(rule.ruleName);
      setRuleCode(rule.ruleCode);
      setDescription(rule.description ?? "");
      setCalculationMethod(rule.calculationMethod);
      setRoundingMethod(rule.roundingMethod);
      setCustomRoundingMinutes(rule.customRoundingMinutes);
      setMinimumLateMinutes(rule.minimumLateMinutes);
      setMaximumLateMinutes(rule.maximumLateMinutes);
      setIsActive(rule.isActive);
      setEffectiveFrom(todayDateKey());
      setRemark("");
    } else {
      setRuleName("");
      setRuleCode("");
      setDescription("");
      setCalculationMethod("exact");
      setRoundingMethod("exact");
      setCustomRoundingMinutes(null);
      setMinimumLateMinutes(0);
      setMaximumLateMinutes(null);
      setIsActive(true);
      setEffectiveFrom(todayDateKey());
      setRemark("");
      setThresholds(emptyThresholds);
    }
  }, [open, rule]);

  useEffect(() => {
    if (isEdit && existingThresholdsQuery.data) {
      setThresholds(
        existingThresholdsQuery.data.length > 0
          ? existingThresholdsQuery.data.map((t) => ({ fromMinutes: t.fromMinutes, toMinutes: t.toMinutes, calculatedMinutes: t.calculatedMinutes }))
          : emptyThresholds
      );
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
      roundingMethod,
      customRoundingMinutes: needsCustomRoundingUnit(roundingMethod) ? customRoundingMinutes : null,
      minimumLateMinutes,
      maximumLateMinutes,
      isActive,
      remark,
      thresholds: calculationMethod === "slab" ? thresholds : [],
    };

    try {
      if (isEdit && rule) {
        await updateRule.mutateAsync({ currentRuleId: rule.id, companyId: user.companyId, values, effectiveFrom, userId: user.id });
        toast({ title: "Late Rule updated", description: `Effective from ${effectiveFrom}.`, variant: "success" });
      } else {
        await createRule.mutateAsync([user.companyId, values, effectiveFrom, user.id]);
        toast({ title: "Late Rule created", variant: "success" });
      }
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast({
        title: "Could not save Late Rule",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Late Rule" : "Create Late Rule"}</DialogTitle>
          <DialogDescription>
            Actual/raw lateness is always Punch In minus Shift Start — Shift Management no longer holds any grace
            concept. This rule decides how that raw lateness is COUNTED — an optional Grace/Threshold gate, exact or
            slab-based classification, rounding, and min/max clamps. {isEdit ? "Saving creates a new version effective from the date below — past attendance keeps using the version that calculated it." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Rule Name</Label>
              <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Standard Late Rule" />
            </div>
            <div className="space-y-1.5">
              <Label>Rule Code</Label>
              <Input value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} placeholder="LATE-STD" disabled={isEdit} />
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
              <Label>Late Grace / Threshold (minutes)</Label>
              <Input type="number" min={0} value={minimumLateMinutes} onChange={(e) => setMinimumLateMinutes(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">
                Late is 0 up to this threshold. Once exceeded, the full actual late minutes from Shift Start are
                counted — never floored up to this value, never reduced by it. Example (10-minute threshold): 10:10 =
                0 Late, 10:11 = 11 Late.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Maximum Late Minutes (cap, optional)</Label>
              <Input
                type="number"
                min={0}
                value={maximumLateMinutes ?? ""}
                onChange={(e) => setMaximumLateMinutes(e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Effective From</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} id="late-rule-active" />
              <Label htmlFor="late-rule-active">Active</Label>
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
