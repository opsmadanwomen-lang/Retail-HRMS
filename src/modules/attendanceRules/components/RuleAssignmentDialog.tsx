import { useMemo, useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useStores } from "@/hooks/useStores";
import { useEmployees } from "@/hooks/useEmployees";
import { useAssignRuleScoped, useLateRules, useOvertimeRules } from "@/hooks/useAttendanceRules";
import {
  useListInformationRules,
  useListWeeklyOffLateRules,
  useListPenaltyRules,
  useListHalfDayRules,
  useListEarlyGoingRules,
  useListExtendedDutyRules,
} from "@/hooks/useExtendedAttendanceRules";
import { informationRuleLabel, weeklyOffLateRuleLabel, penaltyRuleLabel, halfDayRuleLabel, earlyGoingRuleLabel, extendedDutyRuleLabel } from "@/modules/attendanceRules/ruleLabels";
import { todayDateKey } from "@/lib/dateRange";

interface RuleAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

/** "Not Assigned / Keep Existing" sentinel — selecting this for a given rule kind means this
 *  assignment operation does NOT touch that rule kind at all; whatever it already resolves to for
 *  this scope (from an existing row, or from a higher-priority scope) keeps resolving unchanged.
 *  This is what makes every rule independently assignable (task requirement #4/#6). */
const NONE = "__none__";
type StoreScope = "all" | "selected";
type EmployeeScope = "all" | "selected";

/**
 * Central Rule Assignment form (migration 0063) — assigns any/all of the 8 configurable
 * Attendance Rule types to a Store x Employee scope in ONE operation:
 *   1. Normal Late Rule            5. Half Day Rule
 *   2. Weekly Off Late Rule        6. Early Going Rule
 *   3. Information/Intimation Rule 7. Normal Overtime Rule
 *   4. Penalty Rule                8. Extended Duty Rule
 *
 * Every rule selector independently defaults to "Not Assigned / Keep Existing" — leaving a
 * selector on that value means THIS operation does not change that rule kind at all for the
 * chosen scope; only the rule kind(s) actually picked are written. See
 * attendanceRuleService.assignRuleScoped for the server-side carry-forward logic that guarantees
 * this (assigning only Penalty to a store never disturbs that store's existing Late assignment,
 * and vice versa).
 *
 * Resolution priority (enforced server-side by resolve_attendance_rule(), authoritative — this
 * dialog only creates rows), applied INDEPENDENTLY per rule kind: Employee+Store > Store (all
 * employees) > All Stores > legacy Employee/Shift/Store/Company assignments (Late/Overtime only).
 */
export function RuleAssignmentDialog({ open, onOpenChange, onSaved }: RuleAssignmentDialogProps) {
  const { user } = useAuth();
  const lateRulesQuery = useLateRules(user?.companyId ?? undefined);
  const overtimeRulesQuery = useOvertimeRules(user?.companyId ?? undefined);
  const informationRulesQuery = useListInformationRules(user?.companyId ?? undefined);
  const weeklyOffLateRulesQuery = useListWeeklyOffLateRules(user?.companyId ?? undefined);
  const penaltyRulesQuery = useListPenaltyRules(user?.companyId ?? undefined);
  const halfDayRulesQuery = useListHalfDayRules(user?.companyId ?? undefined);
  const earlyGoingRulesQuery = useListEarlyGoingRules(user?.companyId ?? undefined);
  const extendedDutyRulesQuery = useListExtendedDutyRules(user?.companyId ?? undefined);
  const storesQuery = useStores(user?.companyId ?? undefined);
  const employeesQuery = useEmployees({ companyId: user?.companyId ?? undefined, status: "active" });
  const assignRuleScoped = useAssignRuleScoped();

  const [storeScope, setStoreScope] = useState<StoreScope>("all");
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [employeeScope, setEmployeeScope] = useState<EmployeeScope>("all");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);

  const [lateRuleId, setLateRuleId] = useState(NONE);
  const [overtimeRuleId, setOvertimeRuleId] = useState(NONE);
  const [informationRuleId, setInformationRuleId] = useState(NONE);
  const [weeklyOffLateRuleId, setWeeklyOffLateRuleId] = useState(NONE);
  const [penaltyRuleId, setPenaltyRuleId] = useState(NONE);
  const [halfDayRuleId, setHalfDayRuleId] = useState(NONE);
  const [earlyGoingRuleId, setEarlyGoingRuleId] = useState(NONE);
  const [extendedDutyRuleId, setExtendedDutyRuleId] = useState(NONE);

  const [effectiveFrom, setEffectiveFrom] = useState(() => todayDateKey());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open) return;
    setStoreScope("all");
    setSelectedStoreIds([]);
    setEmployeeScope("all");
    setSelectedEmployeeIds([]);
    setLateRuleId(NONE);
    setOvertimeRuleId(NONE);
    setInformationRuleId(NONE);
    setWeeklyOffLateRuleId(NONE);
    setPenaltyRuleId(NONE);
    setHalfDayRuleId(NONE);
    setEarlyGoingRuleId(NONE);
    setExtendedDutyRuleId(NONE);
    setEffectiveFrom(todayDateKey());
    setEffectiveTo("");
    setRemark("");
  }, [open]);

  // Employee Scope only makes sense once specific stores are chosen — you can't filter "which
  // employees" without knowing "at which store(s)" (per the required UI behaviour). Switching back
  // to All Stores forces Employee Scope back to All Employees.
  useEffect(() => {
    if (storeScope === "all") {
      setEmployeeScope("all");
      setSelectedEmployeeIds([]);
    }
  }, [storeScope]);

  const employeesInSelectedStores = useMemo(() => {
    if (storeScope === "all" || selectedStoreIds.length === 0) return [];
    return (employeesQuery.data ?? []).filter((e) => e.storeId && selectedStoreIds.includes(e.storeId));
  }, [employeesQuery.data, storeScope, selectedStoreIds]);

  const toggleStore = (storeId: string) => {
    setSelectedStoreIds((prev) => (prev.includes(storeId) ? prev.filter((id) => id !== storeId) : [...prev, storeId]));
    setSelectedEmployeeIds([]); // store selection changed — employee picks from the old set may no longer be valid
  };

  const toggleEmployee = (employeeId: string) => {
    setSelectedEmployeeIds((prev) => (prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId]));
  };

  const ruleSelections = [lateRuleId, overtimeRuleId, informationRuleId, weeklyOffLateRuleId, penaltyRuleId, halfDayRuleId, earlyGoingRuleId, extendedDutyRuleId];

  const handleSave = async () => {
    if (!user?.companyId) return;
    if (storeScope === "selected" && selectedStoreIds.length === 0) {
      toast({ title: "Select at least one store, or choose All Stores.", variant: "destructive" });
      return;
    }
    if (storeScope === "selected" && employeeScope === "selected" && selectedEmployeeIds.length === 0) {
      toast({ title: "Select at least one employee, or choose All Employees.", variant: "destructive" });
      return;
    }
    if (ruleSelections.every((id) => id === NONE)) {
      toast({ title: "Select at least one rule to assign (all others may stay Not Assigned / Keep Existing).", variant: "destructive" });
      return;
    }

    const employees =
      employeeScope === "selected"
        ? employeesInSelectedStores.filter((e) => selectedEmployeeIds.includes(e.id)).map((e) => ({ id: e.id, storeId: e.storeId as string }))
        : [];

    // NONE = "Not Assigned / Keep Existing" -> omit the field entirely so assignRuleScoped() never
    // touches that rule kind for this scope; only explicitly-picked rule kinds are written.
    const pick = (id: string) => (id === NONE ? undefined : id);

    try {
      const { created, recalculated } = await assignRuleScoped.mutateAsync({
        companyId: user.companyId,
        storeScope,
        storeIds: selectedStoreIds,
        employeeScope,
        employees,
        lateRuleId: pick(lateRuleId),
        overtimeRuleId: pick(overtimeRuleId),
        informationRuleId: pick(informationRuleId),
        weeklyOffLateRuleId: pick(weeklyOffLateRuleId),
        penaltyRuleId: pick(penaltyRuleId),
        halfDayRuleId: pick(halfDayRuleId),
        earlyGoingRuleId: pick(earlyGoingRuleId),
        extendedDutyRuleId: pick(extendedDutyRuleId),
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        remark: remark.trim() || undefined,
        userId: user.id,
      });
      const scopeNote = created > 1 ? ` across ${created} scope(s)` : "";
      const recalcNote = recalculated > 0 ? ` — ${recalculated} existing attendance record${recalculated > 1 ? "s" : ""} automatically recalculated` : "";
      toast({ title: `Rule(s) assigned${scopeNote}${recalcNote}`, variant: "success" });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast({
        title: "Could not assign rule",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign Attendance Rule(s)</DialogTitle>
          <DialogDescription>
            Each rule below is assigned independently — leave a rule on "Not Assigned / Keep Existing" to leave it exactly as it already resolves for this
            scope. Priority per rule kind: Employee+Store &gt; Store (All Employees) &gt; All Stores &gt; legacy assignments (Late/Overtime only).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-semibold">Store Scope</p>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={storeScope === "all"} onChange={() => { setStoreScope("all"); setSelectedStoreIds([]); }} />
                All Stores
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={storeScope === "selected"} onChange={() => setStoreScope("selected")} />
                Selected Store(s)
              </label>
            </div>
            {storeScope === "selected" && (
              <div className="grid gap-1.5 rounded-md border bg-muted/30 p-2 sm:grid-cols-2">
                {(storesQuery.data ?? []).map((store) => (
                  <label key={store.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={selectedStoreIds.includes(store.id)} onCheckedChange={() => toggleStore(store.id)} />
                    {store.name}
                  </label>
                ))}
                {(storesQuery.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No stores found.</p>}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-semibold">Employee Scope</p>
            {storeScope === "all" ? (
              <p className="text-xs text-muted-foreground">Employee Scope is only available once Selected Store(s) is chosen above — it applies to All Employees when Store Scope is All Stores.</p>
            ) : (
              <>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={employeeScope === "all"} onChange={() => { setEmployeeScope("all"); setSelectedEmployeeIds([]); }} />
                    All Employees
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={employeeScope === "selected"} onChange={() => setEmployeeScope("selected")} disabled={selectedStoreIds.length === 0} />
                    Selected Employees
                  </label>
                </div>
                {employeeScope === "selected" && (
                  selectedStoreIds.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Select at least one store above first.</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-2">
                      {employeesInSelectedStores.map((emp) => (
                        <label key={emp.id} className="flex items-center gap-2 border-b py-1.5 text-sm last:border-b-0">
                          <Checkbox checked={selectedEmployeeIds.includes(emp.id)} onCheckedChange={() => toggleEmployee(emp.id)} />
                          <span className="font-medium">{emp.fullName}</span>
                          <span className="text-muted-foreground">({emp.employeeCode ?? "—"} — {emp.storeName ?? "—"})</span>
                        </label>
                      ))}
                      {employeesInSelectedStores.length === 0 && <p className="text-xs text-muted-foreground">No active employees in the selected store(s).</p>}
                    </div>
                  )
                )}
              </>
            )}
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-semibold">Rule Assignments</p>
            <p className="text-xs text-muted-foreground">Pick only the rule(s) you want to change for this scope. Everything left as "Not Assigned / Keep Existing" is untouched.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Normal Late Rule</Label>
                <Select value={lateRuleId} onValueChange={setLateRuleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not Assigned / Keep Existing</SelectItem>
                    {(lateRulesQuery.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.ruleName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Weekly Off Late Rule</Label>
                <Select value={weeklyOffLateRuleId} onValueChange={setWeeklyOffLateRuleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not Assigned / Keep Existing</SelectItem>
                    {(weeklyOffLateRulesQuery.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{weeklyOffLateRuleLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Information / Intimation Rule</Label>
                <Select value={informationRuleId} onValueChange={setInformationRuleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not Assigned / Keep Existing</SelectItem>
                    {(informationRulesQuery.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{informationRuleLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Penalty Rule</Label>
                <Select value={penaltyRuleId} onValueChange={setPenaltyRuleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not Assigned / Keep Existing</SelectItem>
                    {(penaltyRulesQuery.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{penaltyRuleLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Half Day Rule</Label>
                <Select value={halfDayRuleId} onValueChange={setHalfDayRuleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not Assigned / Keep Existing</SelectItem>
                    {(halfDayRulesQuery.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{halfDayRuleLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Early Going Rule</Label>
                <Select value={earlyGoingRuleId} onValueChange={setEarlyGoingRuleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not Assigned / Keep Existing</SelectItem>
                    {(earlyGoingRulesQuery.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{earlyGoingRuleLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Normal Overtime Rule</Label>
                <Select value={overtimeRuleId} onValueChange={setOvertimeRuleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not Assigned / Keep Existing</SelectItem>
                    {(overtimeRulesQuery.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.ruleName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Extended Duty Rule</Label>
                <Select value={extendedDutyRuleId} onValueChange={setExtendedDutyRuleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not Assigned / Keep Existing</SelectItem>
                    {(extendedDutyRulesQuery.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{extendedDutyRuleLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Effective From</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Effective To (optional)</Label>
              <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Remark</Label>
            <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={assignRuleScoped.isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={assignRuleScoped.isPending}>{assignRuleScoped.isPending ? "Saving…" : "Assign Rule(s)"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
