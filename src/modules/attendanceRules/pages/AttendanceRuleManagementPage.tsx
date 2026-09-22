import { useState } from "react";
import { AlertTriangle, FlaskConical, History, Link2, Plus } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";
import {
  useLateRules,
  useOvertimeRules,
  useResetLateOvertimeRules,
  useRuleAssignments,
  useScopeLabels,
  useStoreEmployeeLabels,
  useSetLateRuleActive,
  useSetOvertimeRuleActive,
  useDuplicateLateRule,
  useDuplicateOvertimeRule,
  useUnassignRule,
} from "@/hooks/useAttendanceRules";
import { scopeLabelKey } from "@/services/attendanceRuleService";
import { toast } from "@/components/ui/use-toast";
import { ROUNDING_METHOD_OPTIONS } from "@/modules/attendanceRules/constants";
import { LateRuleFormDialog } from "@/modules/attendanceRules/components/LateRuleFormDialog";
import { OvertimeRuleFormDialog } from "@/modules/attendanceRules/components/OvertimeRuleFormDialog";
import { RuleHistoryDialog } from "@/modules/attendanceRules/components/RuleHistoryDialog";
import { LateRuleSimulatorDialog } from "@/modules/attendanceRules/components/LateRuleSimulatorDialog";
import { OvertimeRuleSimulatorDialog } from "@/modules/attendanceRules/components/OvertimeRuleSimulatorDialog";
import { RuleAssignmentDialog } from "@/modules/attendanceRules/components/RuleAssignmentDialog";
import { ExtendedRulesPanel } from "@/modules/attendanceRules/components/ExtendedRulesPanel";
import {
  useListInformationRules,
  useListWeeklyOffLateRules,
  useListPenaltyRules,
  useListHalfDayRules,
  useListEarlyGoingRules,
  useListExtendedDutyRules,
} from "@/hooks/useExtendedAttendanceRules";
import { informationRuleLabel, weeklyOffLateRuleLabel, penaltyRuleLabel, halfDayRuleLabel, earlyGoingRuleLabel, extendedDutyRuleLabel } from "@/modules/attendanceRules/ruleLabels";
import type { LateRule, OvertimeRule } from "@/types/attendanceRules";

const roundingLabel = (value: string) => ROUNDING_METHOD_OPTIONS.find((o) => o.value === value)?.label ?? value;

export function AttendanceRuleManagementPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const companyId = user?.companyId ?? undefined;

  const lateRulesQuery = useLateRules(companyId);
  const overtimeRulesQuery = useOvertimeRules(companyId);
  const assignmentsQuery = useRuleAssignments(companyId);
  const scopeLabelsQuery = useScopeLabels(assignmentsQuery.data ?? []);
  const storeEmployeeLabelsQuery = useStoreEmployeeLabels(assignmentsQuery.data ?? []);
  const informationRulesQuery = useListInformationRules(companyId);
  const weeklyOffLateRulesQuery = useListWeeklyOffLateRules(companyId);
  const penaltyRulesQuery = useListPenaltyRules(companyId);
  const halfDayRulesQuery = useListHalfDayRules(companyId);
  const earlyGoingRulesQuery = useListEarlyGoingRules(companyId);
  const extendedDutyRulesQuery = useListExtendedDutyRules(companyId);

  const setLateActive = useSetLateRuleActive();
  const setOvertimeActive = useSetOvertimeRuleActive();
  const duplicateLate = useDuplicateLateRule();
  const duplicateOvertime = useDuplicateOvertimeRule();
  const unassign = useUnassignRule();
  const resetRules = useResetLateOvertimeRules();

  const [activeTab, setActiveTab] = useState<"late" | "overtime" | "extended">("late");
  const [lateDialogRule, setLateDialogRule] = useState<LateRule | null>(null);
  const [showLateDialog, setShowLateDialog] = useState(false);
  const [overtimeDialogRule, setOvertimeDialogRule] = useState<OvertimeRule | null>(null);
  const [showOvertimeDialog, setShowOvertimeDialog] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{ kind: "late" | "overtime"; ruleCode: string; ruleName: string } | null>(null);
  const [lateSimulatorRuleId, setLateSimulatorRuleId] = useState<string | undefined>(undefined);
  const [showLateSimulator, setShowLateSimulator] = useState(false);
  const [overtimeSimulatorRuleId, setOvertimeSimulatorRuleId] = useState<string | undefined>(undefined);
  const [showOvertimeSimulator, setShowOvertimeSimulator] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  if (!isSuperAdmin) {
    return (
      <EmptyState
        icon={Link2}
        title="Super Admin access required"
        description="Only Super Admin can view or manage Late/Overtime Rules."
      />
    );
  }

  const handleToggleLateActive = async (rule: LateRule) => {
    try {
      await setLateActive.mutateAsync([rule.id, !rule.isActive, user?.id]);
      toast({ title: rule.isActive ? "Rule deactivated" : "Rule activated", variant: "success" });
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleToggleOvertimeActive = async (rule: OvertimeRule) => {
    try {
      await setOvertimeActive.mutateAsync([rule.id, !rule.isActive, user?.id]);
      toast({ title: rule.isActive ? "Rule deactivated" : "Rule activated", variant: "success" });
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleDuplicateLate = async (rule: LateRule) => {
    try {
      await duplicateLate.mutateAsync([rule.id, companyId as string, `${rule.ruleName} (Copy)`, user?.id]);
      toast({ title: "Rule duplicated as an inactive copy", variant: "success" });
    } catch (error) {
      toast({ title: "Duplicate failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleDuplicateOvertime = async (rule: OvertimeRule) => {
    try {
      await duplicateOvertime.mutateAsync([rule.id, companyId as string, `${rule.ruleName} (Copy)`, user?.id]);
      toast({ title: "Rule duplicated as an inactive copy", variant: "success" });
    } catch (error) {
      toast({ title: "Duplicate failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleResetRules = async () => {
    if (!companyId) return;
    try {
      const result = await resetRules.mutateAsync(companyId);
      toast({
        title: "Late & Overtime rules reset",
        description: `${result.lateRulesDeactivated} Late Rule(s), ${result.overtimeRulesDeactivated} Overtime Rule(s), and ${result.assignmentsDeactivated} assignment(s) deactivated. Attendance records were not touched.`,
        variant: "success",
      });
      setShowResetConfirm(false);
    } catch (error) {
      toast({ title: "Reset failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const assignments = assignmentsQuery.data ?? [];
  const lateRuleNameById = new Map((lateRulesQuery.data ?? []).map((r) => [r.id, r.ruleName]));
  const overtimeRuleNameById = new Map((overtimeRulesQuery.data ?? []).map((r) => [r.id, r.ruleName]));
  const informationRuleNameById = new Map((informationRulesQuery.data ?? []).map((r) => [r.id, informationRuleLabel(r)]));
  const weeklyOffLateRuleNameById = new Map((weeklyOffLateRulesQuery.data ?? []).map((r) => [r.id, weeklyOffLateRuleLabel(r)]));
  const penaltyRuleNameById = new Map((penaltyRulesQuery.data ?? []).map((r) => [r.id, penaltyRuleLabel(r)]));
  const halfDayRuleNameById = new Map((halfDayRulesQuery.data ?? []).map((r) => [r.id, halfDayRuleLabel(r)]));
  const earlyGoingRuleNameById = new Map((earlyGoingRulesQuery.data ?? []).map((r) => [r.id, earlyGoingRuleLabel(r)]));
  const extendedDutyRuleNameById = new Map((extendedDutyRulesQuery.data ?? []).map((r) => [r.id, extendedDutyRuleLabel(r)]));
  const scopeLabels = scopeLabelsQuery.data;
  const storeEmployeeLabels = storeEmployeeLabelsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Rule Management"
        description="Configure how lateness and overtime are counted — separate from Shift, which now only defines Scheduled Start/End Time and Late/Overtime eligibility. Super Admin only."
        actions={
          activeTab === "late" ? (
            <Button variant="outline" onClick={() => { setLateSimulatorRuleId(undefined); setShowLateSimulator(true); }}>
              <FlaskConical className="mr-2 h-4 w-4" />
              Test Late Rule
            </Button>
          ) : activeTab === "overtime" ? (
            <Button variant="outline" onClick={() => { setOvertimeSimulatorRuleId(undefined); setShowOvertimeSimulator(true); }}>
              <FlaskConical className="mr-2 h-4 w-4" />
              Test Overtime Rule
            </Button>
          ) : undefined
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "late" | "overtime" | "extended")}>
        <TabsList>
          <TabsTrigger value="late">Late Rules</TabsTrigger>
          <TabsTrigger value="overtime">Overtime Rules</TabsTrigger>
          <TabsTrigger value="extended">Weekly Off / Information / Penalty / Half Day / Early Going / Extended Duty</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === "extended" ? <ExtendedRulesPanel /> : null}

      {activeTab === "late" ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Late Rules</CardTitle>
            <Button size="sm" onClick={() => { setLateDialogRule(null); setShowLateDialog(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Create Late Rule
            </Button>
          </CardHeader>
          <CardContent>
            {lateRulesQuery.isLoading ? (
              <LoadingState />
            ) : (lateRulesQuery.data ?? []).length === 0 ? (
              <EmptyState icon={Plus} title="No Late Rules yet" description="Create one to override the default exact-minutes calculation." />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Calculation</TableHead>
                      <TableHead>Rounding</TableHead>
                      <TableHead>Effective From</TableHead>
                      <TableHead>Effective To</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(lateRulesQuery.data ?? []).map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="font-medium">{rule.ruleName}</TableCell>
                        <TableCell>{rule.ruleCode}</TableCell>
                        <TableCell className="capitalize">{rule.calculationMethod}</TableCell>
                        <TableCell>{roundingLabel(rule.roundingMethod)}</TableCell>
                        <TableCell>{formatDate(rule.effectiveFrom)}</TableCell>
                        <TableCell>{rule.effectiveTo ? formatDate(rule.effectiveTo) : "—"}</TableCell>
                        <TableCell>
                          <Badge variant={rule.isActive ? "default" : "secondary"}>{rule.isActive ? "Active" : "Inactive"}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" onClick={() => { setLateDialogRule(rule); setShowLateDialog(true); }}>Edit</Button>
                            <Button size="sm" variant="outline" onClick={() => { setLateSimulatorRuleId(rule.id); setShowLateSimulator(true); }}>
                              <FlaskConical className="mr-1 h-4 w-4" /> Test Rule
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleDuplicateLate(rule)}>Duplicate</Button>
                            <Button size="sm" variant="outline" onClick={() => setHistoryTarget({ kind: "late", ruleCode: rule.ruleCode, ruleName: rule.ruleName })}>
                              <History className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant={rule.isActive ? "destructive" : "default"} onClick={() => handleToggleLateActive(rule)}>
                              {rule.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : activeTab === "overtime" ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Overtime Rules</CardTitle>
            <Button size="sm" onClick={() => { setOvertimeDialogRule(null); setShowOvertimeDialog(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Create Overtime Rule
            </Button>
          </CardHeader>
          <CardContent>
            {overtimeRulesQuery.isLoading ? (
              <LoadingState />
            ) : (overtimeRulesQuery.data ?? []).length === 0 ? (
              <EmptyState icon={Plus} title="No Overtime Rules yet" description="Create one to override the default exact-minutes calculation." />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Minimum OT</TableHead>
                      <TableHead>Rounding</TableHead>
                      <TableHead>Effective From</TableHead>
                      <TableHead>Effective To</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(overtimeRulesQuery.data ?? []).map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="font-medium">{rule.ruleName}</TableCell>
                        <TableCell>{rule.ruleCode}</TableCell>
                        <TableCell>{rule.minimumOvertimeMinutes} min</TableCell>
                        <TableCell>{roundingLabel(rule.roundingMethod)}</TableCell>
                        <TableCell>{formatDate(rule.effectiveFrom)}</TableCell>
                        <TableCell>{rule.effectiveTo ? formatDate(rule.effectiveTo) : "—"}</TableCell>
                        <TableCell>
                          <Badge variant={rule.isActive ? "default" : "secondary"}>{rule.isActive ? "Active" : "Inactive"}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" onClick={() => { setOvertimeDialogRule(rule); setShowOvertimeDialog(true); }}>Edit</Button>
                            <Button size="sm" variant="outline" onClick={() => { setOvertimeSimulatorRuleId(rule.id); setShowOvertimeSimulator(true); }}>
                              <FlaskConical className="mr-1 h-4 w-4" /> Test Rule
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleDuplicateOvertime(rule)}>Duplicate</Button>
                            <Button size="sm" variant="outline" onClick={() => setHistoryTarget({ kind: "overtime", ruleCode: rule.ruleCode, ruleName: rule.ruleName })}>
                              <History className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant={rule.isActive ? "destructive" : "default"} onClick={() => handleToggleOvertimeActive(rule)}>
                              {rule.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Rule Assignments</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowAssignDialog(true)}>
            <Link2 className="mr-2 h-4 w-4" />
            Assign Rule
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Resolution priority when several could apply: Employee+Store &gt; Store (All Employees) &gt; All Stores &gt; legacy Employee/Shift/Store/Company assignments (still supported as a fallback). A scope with no assignment at any tier falls back to the legacy exact-minutes calculation.
          </p>
          {assignmentsQuery.isLoading ? (
            <LoadingState />
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules assigned yet — every date currently uses the legacy exact-minutes calculation.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Store Scope</TableHead>
                    <TableHead>Employee Scope</TableHead>
                    <TableHead>Normal Late</TableHead>
                    <TableHead>Weekly Off Late</TableHead>
                    <TableHead>Information / Intimation</TableHead>
                    <TableHead>Penalty</TableHead>
                    <TableHead>Half Day</TableHead>
                    <TableHead>Early Going</TableHead>
                    <TableHead>Normal Overtime</TableHead>
                    <TableHead>Extended Duty</TableHead>
                    <TableHead>Effective From</TableHead>
                    <TableHead>Effective To</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Remark</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((a) => {
                    const isStoreEmployee = a.scopeType === "store_employee";
                    const storeEmployee = storeEmployeeLabels?.get(a.id);
                    const storeScopeLabel = isStoreEmployee
                      ? storeEmployee?.storeLabel ?? (storeEmployeeLabelsQuery.isLoading ? "Loading…" : "—")
                      : a.scopeType === "store"
                      ? scopeLabels?.get(scopeLabelKey(a.scopeType, a.scopeId)) ?? "—"
                      : a.scopeType === "company"
                      ? "All Stores (legacy)"
                      : `Legacy: ${a.scopeType}`;
                    const employeeScopeLabel = isStoreEmployee
                      ? storeEmployee?.employeeLabel ?? (storeEmployeeLabelsQuery.isLoading ? "Loading…" : "—")
                      : a.scopeType === "employee"
                      ? scopeLabels?.get(scopeLabelKey(a.scopeType, a.scopeId)) ?? "—"
                      : "All Employees";
                    // "Not Assigned" (never blank) — this row simply doesn't set that particular rule
                    // kind for this scope; it continues resolving from a higher-priority scope or the
                    // legacy fallback, per resolve_attendance_rule()'s per-kind independence.
                    return (
                      <TableRow key={a.id}>
                        <TableCell>{storeScopeLabel}</TableCell>
                        <TableCell>{employeeScopeLabel}</TableCell>
                        <TableCell>{a.lateRuleId ? lateRuleNameById.get(a.lateRuleId) ?? "—" : "Not Assigned"}</TableCell>
                        <TableCell>{a.weeklyOffLateRuleId ? weeklyOffLateRuleNameById.get(a.weeklyOffLateRuleId) ?? "—" : "Not Assigned"}</TableCell>
                        <TableCell>{a.informationRuleId ? informationRuleNameById.get(a.informationRuleId) ?? "—" : "Not Assigned"}</TableCell>
                        <TableCell>{a.penaltyRuleId ? penaltyRuleNameById.get(a.penaltyRuleId) ?? "—" : "Not Assigned"}</TableCell>
                        <TableCell>{a.halfDayRuleId ? halfDayRuleNameById.get(a.halfDayRuleId) ?? "—" : "Not Assigned"}</TableCell>
                        <TableCell>{a.earlyGoingRuleId ? earlyGoingRuleNameById.get(a.earlyGoingRuleId) ?? "—" : "Not Assigned"}</TableCell>
                        <TableCell>{a.overtimeRuleId ? overtimeRuleNameById.get(a.overtimeRuleId) ?? "—" : "Not Assigned"}</TableCell>
                        <TableCell>{a.extendedDutyRuleId ? extendedDutyRuleNameById.get(a.extendedDutyRuleId) ?? "—" : "Not Assigned"}</TableCell>
                        <TableCell>{formatDate(a.effectiveFrom)}</TableCell>
                        <TableCell>{a.effectiveTo ? formatDate(a.effectiveTo) : "—"}</TableCell>
                        <TableCell>
                          <Badge variant={a.isActive ? "default" : "secondary"}>{a.isActive ? "Active" : "Inactive"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.remark ?? "—"}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="destructive" onClick={() => unassign.mutate([a.id, user?.id])}>
                            Unassign
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Start over with a completely fresh Late/Overtime rule structure. Existing rules are deactivated (not
            physically deleted) so historical attendance keeps its exact audit trail.
          </p>
          <Button variant="destructive" onClick={() => setShowResetConfirm(true)}>
            Reset / Delete Existing Late &amp; Overtime Rules
          </Button>
        </CardContent>
      </Card>

      <LateRuleFormDialog open={showLateDialog} onOpenChange={setShowLateDialog} rule={lateDialogRule} />
      <OvertimeRuleFormDialog open={showOvertimeDialog} onOpenChange={setShowOvertimeDialog} rule={overtimeDialogRule} />
      <RuleHistoryDialog
        open={Boolean(historyTarget)}
        onOpenChange={(open) => !open && setHistoryTarget(null)}
        kind={historyTarget?.kind ?? "late"}
        companyId={companyId}
        ruleCode={historyTarget?.ruleCode ?? null}
        ruleName={historyTarget?.ruleName ?? ""}
      />
      <LateRuleSimulatorDialog open={showLateSimulator} onOpenChange={setShowLateSimulator} initialRuleId={lateSimulatorRuleId} />
      <OvertimeRuleSimulatorDialog open={showOvertimeSimulator} onOpenChange={setShowOvertimeSimulator} initialRuleId={overtimeSimulatorRuleId} />
      <RuleAssignmentDialog open={showAssignDialog} onOpenChange={setShowAssignDialog} />

      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Reset Late &amp; Overtime Rules?
            </DialogTitle>
            <DialogDescription>
              All existing Late and Overtime rules and their assignments will be permanently removed. Attendance
              records will not be deleted. Do you want to continue?
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Employees, attendance records, shifts, stores, leave records, payroll records, and Night Duty records are
            never affected by this action.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowResetConfirm(false)} disabled={resetRules.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleResetRules} disabled={resetRules.isPending}>
              {resetRules.isPending ? "Resetting…" : "Yes, Reset Rules"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
