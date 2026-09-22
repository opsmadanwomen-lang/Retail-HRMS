import { useState } from "react";
import { CalendarRange, ClipboardCheck, FileText, Link2, Users } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useStores } from "@/hooks/useStores";
import { useEmployees } from "@/hooks/useEmployees";
import { formatDate } from "@/lib/utils";
import {
  useLeaveFinancialYears,
  useCreateLeaveFinancialYear,
  useActivateLeaveFinancialYear,
  useLeaveTypes,
  useCreateLeaveType,
  useLeavePolicies,
  useCreateLeavePolicy,
  useLeaveTypeConfigs,
  useCreateLeaveTypeConfig,
  useLeaveAccrualPeriods,
  useCreateLeaveAccrualPeriod,
  useDeleteLeaveAccrualPeriod,
  useLeaveProbationRule,
  useUpsertLeaveProbationRule,
  useSetLeavePolicyStatus,
  useLeavePolicyAssignments,
  useCreateLeavePolicyAssignment,
  useLeavePreviewCalculation,
  useLeaveApprovalThresholdRule,
  useUpsertLeaveApprovalThresholdRule,
  useLeavePriorNoticeRule,
  useAccrualPreview,
  useRunAccrual,
} from "@/hooks/useLeave";
import type { LeavePolicy } from "@/types/leave";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "consultant"];

export function LeavePolicyManagementPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const companyId = user?.companyId ?? undefined;

  if (!isSuperAdmin) {
    return <EmptyState icon={Link2} title="Super Admin access required" description="Only Super Admin can view or manage Leave Policies." />;
  }

  const [activeTab, setActiveTab] = useState("financial-years");

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Policies" description="Configure the Leave Policy Engine — Financial Years, Leave Types, Policies, Accrual, Probation, Assignment, and Preview." />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="financial-years">Financial Years</TabsTrigger>
          <TabsTrigger value="leave-types">Leave Types</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="assignment">Assignment</TabsTrigger>
          <TabsTrigger value="accrual">Accrual</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="financial-years"><FinancialYearsTab companyId={companyId} /></TabsContent>
        <TabsContent value="leave-types"><LeaveTypesTab companyId={companyId} /></TabsContent>
        <TabsContent value="policies"><PoliciesTab companyId={companyId} /></TabsContent>
        <TabsContent value="assignment"><AssignmentTab companyId={companyId} /></TabsContent>
        <TabsContent value="accrual"><AccrualTab companyId={companyId} /></TabsContent>
        <TabsContent value="preview"><PreviewTab companyId={companyId} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Financial Years
// ============================================================================
function FinancialYearsTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const fyQuery = useLeaveFinancialYears(companyId);
  const createFy = useCreateLeaveFinancialYear();
  const activateFy = useActivateLeaveFinancialYear();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState("draft");

  const handleActivateFy = async (id: string) => {
    try {
      await activateFy.mutateAsync(id);
      toast({ title: "Financial Year activated", variant: "success" });
    } catch (error) {
      toast({ title: "Failed to activate", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleCreate = async () => {
    try {
      await createFy.mutateAsync({ companyId: companyId as string, label, startDate, endDate, status, userId: user?.id });
      toast({ title: "Financial Year created", variant: "success" });
      setOpen(false);
      setLabel(""); setStartDate(""); setEndDate(""); setStatus("draft");
    } catch (error) {
      toast({ title: "Failed to create", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Financial Years</CardTitle>
        <Button onClick={() => setOpen(true)}>New Financial Year</Button>
      </CardHeader>
      <CardContent>
        {fyQuery.isLoading ? (
          <LoadingState />
        ) : (fyQuery.data ?? []).length === 0 ? (
          <EmptyState icon={CalendarRange} title="No Financial Years yet" description="Create one to start building Leave Policies." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Label</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(fyQuery.data ?? []).map((fy) => (
                <TableRow key={fy.id}>
                  <TableCell className="font-medium">{fy.label}</TableCell>
                  <TableCell>{formatDate(fy.startDate)}</TableCell>
                  <TableCell>{formatDate(fy.endDate)}</TableCell>
                  <TableCell><Badge variant={fy.status === "active" ? "default" : "secondary"} className="capitalize">{fy.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {fy.status !== "active" && fy.status !== "closed" && fy.status !== "archived" ? (
                      <Button size="sm" variant="outline" onClick={() => handleActivateFy(fy.id)} disabled={activateFy.isPending}>
                        Activate
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Financial Year</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="FY 2027-28" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
              <div><Label>End Date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!label || !startDate || !endDate || createFy.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// Leave Types
// ============================================================================
function LeaveTypesTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const typesQuery = useLeaveTypes(companyId);
  const createType = useCreateLeaveType();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isPaid, setIsPaid] = useState(true);
  const [halfDayAllowed, setHalfDayAllowed] = useState(true);
  const [quarterDayAllowed, setQuarterDayAllowed] = useState(false);
  const [minimumUnit, setMinimumUnit] = useState("1");
  const [documentRequired, setDocumentRequired] = useState(false);
  const [requiresReason, setRequiresReason] = useState(true);

  const handleCreate = async () => {
    try {
      await createType.mutateAsync({
        companyId: companyId as string, code, name, isPaid, halfDayAllowed, quarterDayAllowed,
        minimumUnit: Number(minimumUnit), documentRequired, requiresReason, userId: user?.id,
      });
      toast({ title: "Leave Type created", variant: "success" });
      setOpen(false);
      setCode(""); setName("");
    } catch (error) {
      toast({ title: "Failed to create", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Leave Types</CardTitle>
        <Button onClick={() => setOpen(true)}>New Leave Type</Button>
      </CardHeader>
      <CardContent>
        {typesQuery.isLoading ? (
          <LoadingState />
        ) : (typesQuery.data ?? []).length === 0 ? (
          <EmptyState icon={FileText} title="No Leave Types yet" description="Create Casual Leave, Sick Leave, Earned Leave, or any custom type." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Paid</TableHead><TableHead>Half Day</TableHead><TableHead>Min. Unit</TableHead><TableHead>Active</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(typesQuery.data ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.code}</TableCell>
                  <TableCell>{t.name}</TableCell>
                  <TableCell><Badge variant={t.isPaid ? "success" : "secondary"}>{t.isPaid ? "Paid" : "Unpaid"}</Badge></TableCell>
                  <TableCell>{t.halfDayAllowed ? "Yes" : "No"}</TableCell>
                  <TableCell>{t.minimumUnit} day</TableCell>
                  <TableCell><Badge variant={t.isActive ? "default" : "secondary"}>{t.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Leave Type</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SL" /></div>
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sick Leave" /></div>
            </div>
            <div>
              <Label>Minimum Unit (days)</Label>
              <Select value={minimumUnit} onValueChange={setMinimumUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 (Full Day only)</SelectItem>
                  <SelectItem value="0.5">0.5 (Half Day)</SelectItem>
                  <SelectItem value="0.25">0.25 (Quarter Day)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={isPaid} onCheckedChange={(v) => setIsPaid(Boolean(v))} /> Paid</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={halfDayAllowed} onCheckedChange={(v) => setHalfDayAllowed(Boolean(v))} /> Half Day Allowed</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={quarterDayAllowed} onCheckedChange={(v) => setQuarterDayAllowed(Boolean(v))} /> Quarter Day Allowed</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={documentRequired} onCheckedChange={(v) => setDocumentRequired(Boolean(v))} /> Document Required</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={requiresReason} onCheckedChange={(v) => setRequiresReason(Boolean(v))} /> Requires Reason</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!code || !name || createType.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// Policies (+ Type Config + Accrual Periods + Probation, per policy)
// ============================================================================
function PoliciesTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const policiesQuery = useLeavePolicies(companyId);
  const fyQuery = useLeaveFinancialYears(companyId);
  const createPolicy = useCreateLeavePolicy();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [financialYearId, setFinancialYearId] = useState("");
  const [configureTarget, setConfigureTarget] = useState<LeavePolicy | null>(null);

  const handleCreate = async () => {
    try {
      await createPolicy.mutateAsync({ companyId: companyId as string, financialYearId, name, code, status: "draft", userId: user?.id });
      toast({ title: "Policy created (draft)", variant: "success" });
      setOpen(false);
      setName(""); setCode(""); setFinancialYearId("");
    } catch (error) {
      toast({ title: "Failed to create", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Leave Policies</CardTitle>
        <Button onClick={() => setOpen(true)}>New Policy</Button>
      </CardHeader>
      <CardContent>
        {policiesQuery.isLoading ? (
          <LoadingState />
        ) : (policiesQuery.data ?? []).length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No Policies yet" description="Create a policy to configure Accrual, Probation, and Carry Forward rules." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Financial Year</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(policiesQuery.data ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.code}</TableCell>
                  <TableCell>{p.financialYearLabel ?? "—"}</TableCell>
                  <TableCell>v{p.versionNumber}</TableCell>
                  <TableCell><Badge variant={p.status === "active" ? "default" : "secondary"} className="capitalize">{p.status.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell><Button variant="outline" size="sm" onClick={() => setConfigureTarget(p)}>Configure</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Leave Policy</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="General Staff Leave Policy" /></div>
              <div><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="GENERAL-STAFF" /></div>
            </div>
            <div>
              <Label>Financial Year</Label>
              <Select value={financialYearId} onValueChange={setFinancialYearId}>
                <SelectTrigger><SelectValue placeholder="Select Financial Year" /></SelectTrigger>
                <SelectContent>
                  {(fyQuery.data ?? []).map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name || !code || !financialYearId || createPolicy.isPending}>Create Draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {configureTarget ? <ConfigurePolicyDialog policy={configureTarget} onOpenChange={(open) => !open && setConfigureTarget(null)} /> : null}
    </Card>
  );
}

function ConfigurePolicyDialog({ policy, onOpenChange }: { policy: LeavePolicy; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const typesQuery = useLeaveTypes(policy.companyId);
  const configsQuery = useLeaveTypeConfigs(policy.id);
  const createConfig = useCreateLeaveTypeConfig();
  const probationQuery = useLeaveProbationRule(policy.id);
  const upsertProbation = useUpsertLeaveProbationRule();
  const setStatus = useSetLeavePolicyStatus();

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [carryForwardAllowed, setCarryForwardAllowed] = useState(true);
  const [probationEligible, setProbationEligible] = useState(true);
  const [encashmentAllowed, setEncashmentAllowed] = useState(false);
  const [lapseAllowed, setLapseAllowed] = useState(false);

  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  const [probDuration, setProbDuration] = useState("6");
  const [probUnit, setProbUnit] = useState("months");
  const [probExtra, setProbExtra] = useState("0");
  const [probRule, setProbRule] = useState("same_month");

  const handleAddConfig = async () => {
    try {
      const created = await createConfig.mutateAsync({
        policyId: policy.id, leaveTypeId, accrualEnabled: true, accrualFrequency: "monthly",
        probationEligible, carryForwardAllowed, carryForwardMaxDays: null, carryForwardExpiryType: "fy_end",
        encashmentAllowed, lapseAllowed, negativeBalanceAllowed: false, userId: user?.id,
      });
      toast({ title: "Leave Type added to policy", variant: "success" });
      setSelectedConfigId(created.id);
      setLeaveTypeId("");
    } catch (error) {
      toast({ title: "Failed to add", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleSaveProbation = async () => {
    try {
      await upsertProbation.mutateAsync({
        policyId: policy.id, durationValue: Number(probDuration), durationUnit: probUnit,
        extraLeaveDuringProbation: Number(probExtra), weeklyOffDuringProbation: true,
        postProbationStartRule: probRule, userId: user?.id,
      });
      toast({ title: "Probation rule saved", variant: "success" });
    } catch (error) {
      toast({ title: "Failed to save", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleActivate = async () => {
    try {
      await setStatus.mutateAsync({ policyId: policy.id, status: "active", userId: user?.id });
      toast({ title: "Policy activated", variant: "success" });
    } catch (error) {
      toast({ title: "Failed to activate", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Configure — {policy.name} (v{policy.versionNumber})</DialogTitle>
          <DialogDescription>Add Leave Types, Accrual Periods, and the Probation rule for this policy version.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-6 overflow-y-auto">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Status: <Badge variant={policy.status === "active" ? "default" : "secondary"} className="capitalize">{policy.status.replace(/_/g, " ")}</Badge></p>
              <p className="text-xs text-muted-foreground">Activating makes this the resolvable version for its policy code (deactivates any other active version).</p>
            </div>
            {policy.status !== "active" ? <Button size="sm" onClick={handleActivate} disabled={setStatus.isPending}>Activate</Button> : null}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold">Leave Types in this Policy</p>
            {(configsQuery.data ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between p-3 text-left text-sm font-medium"
                  onClick={() => setSelectedConfigId(selectedConfigId === c.id ? null : c.id)}
                >
                  {c.leaveTypeName} ({c.leaveTypeCode})
                  <span className="text-xs text-muted-foreground">{selectedConfigId === c.id ? "Hide Accrual Periods" : "Show Accrual Periods"}</span>
                </button>
                {selectedConfigId === c.id ? <AccrualPeriodsEditor policyTypeConfigId={c.id} /> : null}
              </div>
            ))}

            <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
              <div className="flex-1">
                <Label>Add Leave Type</Label>
                <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                  <SelectTrigger><SelectValue placeholder="Select Leave Type" /></SelectTrigger>
                  <SelectContent>
                    {(typesQuery.data ?? []).filter((t) => !(configsQuery.data ?? []).some((c) => c.leaveTypeId === t.id)).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-1 text-xs"><Checkbox checked={probationEligible} onCheckedChange={(v) => setProbationEligible(Boolean(v))} /> Probation Gate</label>
              <label className="flex items-center gap-1 text-xs"><Checkbox checked={carryForwardAllowed} onCheckedChange={(v) => setCarryForwardAllowed(Boolean(v))} /> Carry Fwd</label>
              <label className="flex items-center gap-1 text-xs"><Checkbox checked={encashmentAllowed} onCheckedChange={(v) => setEncashmentAllowed(Boolean(v))} /> Encashment</label>
              <label className="flex items-center gap-1 text-xs"><Checkbox checked={lapseAllowed} onCheckedChange={(v) => setLapseAllowed(Boolean(v))} /> Lapse</label>
              <Button size="sm" onClick={handleAddConfig} disabled={!leaveTypeId || createConfig.isPending}>Add</Button>
            </div>
          </div>

          <ApprovalHierarchySection policy={policy} />

          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-semibold">Probation Rule (applies to every Probation-gated Leave Type above)</p>
            <div className="grid grid-cols-4 gap-2">
              <div><Label className="text-xs">Duration</Label><Input type="number" value={probDuration} onChange={(e) => setProbDuration(e.target.value)} /></div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Select value={probUnit} onValueChange={setProbUnit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="months">Months</SelectItem><SelectItem value="days">Days</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Extra Leave During Probation</Label><Input type="number" value={probExtra} onChange={(e) => setProbExtra(e.target.value)} /></div>
              <div>
                <Label className="text-xs">Post-Probation Start</Label>
                <Select value={probRule} onValueChange={setProbRule}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="same_month">Same Month</SelectItem>
                    <SelectItem value="next_month">Next Month</SelectItem>
                    <SelectItem value="pro_rata">Pro-Rata</SelectItem>
                    <SelectItem value="full_entitlement">Full Entitlement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {probationQuery.data ? (
              <p className="text-xs text-muted-foreground">
                Currently saved: {probationQuery.data.durationValue} {probationQuery.data.durationUnit}, starts {probationQuery.data.postProbationStartRule.replace(/_/g, " ")}.
              </p>
            ) : null}
            <Button size="sm" onClick={handleSaveProbation} disabled={upsertProbation.isPending}>Save Probation Rule</Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Approval Hierarchy threshold — the SAME `leave_short_long_rules` row leave_apply() /
 * leave_manager_decide() already use. This is the APPROVAL routing threshold and is a completely
 * separate concept from the Prior Notice "notice period" (shown read-only here for contrast; it is
 * edited on Settlement → Prior Notice). Nothing is hard-coded — the number below is the source of
 * truth the engine reads.
 */
function ApprovalHierarchySection({ policy }: { policy: LeavePolicy }) {
  const { user } = useAuth();
  const ruleQuery = useLeaveApprovalThresholdRule(policy.id);
  const upsert = useUpsertLeaveApprovalThresholdRule();
  const priorNoticeQuery = useLeavePriorNoticeRule(policy.id);

  const currentThreshold = ruleQuery.data?.thresholdDays ?? 3;
  const [days, setDays] = useState<string>("");
  const effectiveDays = days === "" ? String(currentThreshold) : days;

  const handleSave = async () => {
    const n = Number(effectiveDays);
    if (!Number.isFinite(n) || n < 1) {
      toast({ title: "Enter a valid number of days (1 or more).", variant: "destructive" });
      return;
    }
    try {
      await upsert.mutateAsync({ policyId: policy.id, thresholdDays: n, thresholdOperator: "short_lte", userId: user?.id });
      toast({ title: "Approval threshold saved", variant: "success" });
      setDays("");
    } catch (error) {
      toast({ title: "Failed to save", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-semibold">Approval Hierarchy</p>
      <p className="text-xs text-muted-foreground">
        Determines how far a leave application must travel for final approval. Separate from Prior Notice.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Direct Manager can finalise up to (chargeable days)</Label>
          <Input
            type="number"
            min={1}
            className="w-40"
            value={effectiveDays}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={handleSave} disabled={upsert.isPending || ruleQuery.isLoading}>Save</Button>
      </div>
      <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
        <p>• <span className="font-medium text-foreground">1–{effectiveDays} day(s):</span> Employee → Direct Manager → <span className="font-medium text-foreground">Final Approved</span> (no Super Manager).</p>
        <p>• <span className="font-medium text-foreground">More than {effectiveDays} day(s):</span> Employee → Direct Manager → Super Manager → <span className="font-medium text-foreground">Final Approved</span>.</p>
        <p className="mt-1">
          Prior Notice (separate): {priorNoticeQuery.data?.required
            ? `Long leave needs ${priorNoticeQuery.data.noticeDays} day(s) advance notice.`
            : "not required."} Edit on Settlement → Prior Notice.
        </p>
      </div>
    </div>
  );
}

function AccrualPeriodsEditor({ policyTypeConfigId }: { policyTypeConfigId: string }) {
  const { user } = useAuth();
  const periodsQuery = useLeaveAccrualPeriods(policyTypeConfigId);
  const createPeriod = useCreateLeaveAccrualPeriod();
  const deletePeriod = useDeleteLeaveAccrualPeriod();
  const [startMonth, setStartMonth] = useState("4");
  const [endMonth, setEndMonth] = useState("9");
  const [amount, setAmount] = useState("3");

  const handleAdd = async () => {
    try {
      await createPeriod.mutateAsync({
        policyTypeConfigId, periodStartMonth: Number(startMonth), periodEndMonth: Number(endMonth),
        accrualAmount: Number(amount), sortOrder: (periodsQuery.data?.length ?? 0) + 1, userId: user?.id,
      });
    } catch (error) {
      toast({ title: "Failed to add period", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-2 border-t p-3">
      {(periodsQuery.data ?? []).map((p) => (
        <div key={p.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
          <span>{MONTH_LABELS[p.periodStartMonth - 1]} – {MONTH_LABELS[p.periodEndMonth - 1]}: {p.accrualAmount} / month</span>
          <Button variant="ghost" size="sm" onClick={() => deletePeriod.mutate(p.id)}>Remove</Button>
        </div>
      ))}
      <div className="flex items-end gap-2">
        <div>
          <Label className="text-xs">From Month</Label>
          <Select value={startMonth} onValueChange={setStartMonth}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTH_LABELS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">To Month</Label>
          <Select value={endMonth} onValueChange={setEndMonth}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTH_LABELS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Amount / Month</Label>
          <Input className="h-8 w-20" type="number" step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <Button size="sm" onClick={handleAdd} disabled={createPeriod.isPending}>Add Period</Button>
      </div>
    </div>
  );
}

// ============================================================================
// Assignment
// ============================================================================
function AssignmentTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const assignmentsQuery = useLeavePolicyAssignments(companyId);
  const policiesQuery = useLeavePolicies(companyId);
  const storesQuery = useStores(companyId);
  const employeesQuery = useEmployees({ companyId });
  const createAssignment = useCreateLeavePolicyAssignment();

  const [open, setOpen] = useState(false);
  const [policyId, setPolicyId] = useState("");
  const [scopeType, setScopeType] = useState("company");
  const [targetId, setTargetId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const handleCreate = async () => {
    try {
      await createAssignment.mutateAsync({
        companyId: companyId as string, policyId, scopeType, effectiveFrom,
        employeeId: scopeType === "employee" ? targetId : null,
        storeId: scopeType === "store" ? targetId : null,
        employmentType: scopeType === "employment_type" ? targetId : null,
        userId: user?.id,
      });
      toast({ title: "Assignment created", variant: "success" });
      setOpen(false);
      setPolicyId(""); setTargetId(""); setEffectiveFrom("");
    } catch (error) {
      toast({ title: "Failed to create", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Policy Assignment</CardTitle>
        <Button onClick={() => setOpen(true)}>New Assignment</Button>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-muted-foreground">
          Precedence when multiple assignments could apply: Employee-specific &gt; Store &gt; Store Designation &gt; Store Department &gt; Employment Type &gt; Company-wide default.
        </p>
        {assignmentsQuery.isLoading ? (
          <LoadingState />
        ) : (assignmentsQuery.data ?? []).length === 0 ? (
          <EmptyState icon={Users} title="No assignments yet" description="Assign a policy to Company-wide, a Store, or a specific Employee." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Policy</TableHead><TableHead>Scope</TableHead><TableHead>Effective From</TableHead><TableHead>Active</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(assignmentsQuery.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.policyName}</TableCell>
                  <TableCell className="capitalize">{a.scopeType.replace(/_/g, " ")}</TableCell>
                  <TableCell>{formatDate(a.effectiveFrom)}</TableCell>
                  <TableCell><Badge variant={a.isActive ? "default" : "secondary"}>{a.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Policy Assignment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Policy</Label>
              <Select value={policyId} onValueChange={setPolicyId}>
                <SelectTrigger><SelectValue placeholder="Select Policy" /></SelectTrigger>
                <SelectContent>
                  {(policiesQuery.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} (v{p.versionNumber})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Scope</Label>
              <Select value={scopeType} onValueChange={(v) => { setScopeType(v); setTargetId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Company-wide (default)</SelectItem>
                  <SelectItem value="store">Store</SelectItem>
                  <SelectItem value="employment_type">Employment Type</SelectItem>
                  <SelectItem value="employee">Specific Employee</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scopeType === "store" ? (
              <div>
                <Label>Store</Label>
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger><SelectValue placeholder="Select Store" /></SelectTrigger>
                  <SelectContent>{(storesQuery.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
            {scopeType === "employment_type" ? (
              <div>
                <Label>Employment Type</Label>
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger><SelectValue placeholder="Select Employment Type" /></SelectTrigger>
                  <SelectContent>{EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
            {scopeType === "employee" ? (
              <div>
                <Label>Employee</Label>
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger><SelectValue placeholder="Select Employee" /></SelectTrigger>
                  <SelectContent>{(employeesQuery.data ?? []).slice(0, 100).map((e: any) => <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeCode})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
            <div><Label>Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!policyId || !effectiveFrom || (scopeType !== "company" && !targetId) || createAssignment.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// Accrual Posting — materialises monthly entitlement into leave_ledger.
// Reuses the existing leave_preview_calculation() engine per employee via the
// leave_accrual_run() RPC (dry-run = preview, commit = post). Idempotent.
// ============================================================================
function AccrualTab({ companyId }: { companyId?: string }) {
  const fyQuery = useLeaveFinancialYears(companyId);
  const policiesQuery = useLeavePolicies(companyId);
  const typesQuery = useLeaveTypes(companyId);
  const runAccrual = useRunAccrual();

  const [fyId, setFyId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [upToMonth, setUpToMonth] = useState(currentMonth);

  const upToMonthDate = upToMonth ? `${upToMonth}-01` : undefined;
  const preview = useAccrualPreview(
    fyId && policyId && leaveTypeId ? { financialYearId: fyId, policyId, leaveTypeId, upToMonth: upToMonthDate } : null
  );

  const rows = preview.data ?? [];
  const summary = {
    eligible: rows.filter((r) => r.eligible).length,
    alreadyPosted: rows.filter((r) => r.alreadyPostedDays > 0).length,
    toBePosted: rows.filter((r) => r.toPostMonths > 0).length,
    totalDaysToPost: rows.reduce((s, r) => s + r.toPostDays, 0),
    totalDaysAlready: rows.reduce((s, r) => s + r.alreadyPostedDays, 0),
  };

  const activePolicies = (policiesQuery.data ?? []).filter((p) => p.status === "active");
  const activeTypes = (typesQuery.data ?? []).filter((t) => t.isActive);

  const handlePost = async () => {
    if (!fyId || !policyId || !leaveTypeId) return;
    if (summary.toBePosted === 0) {
      toast({ title: "Accrual already posted for this period.", description: "Nothing new to post for the selected Financial Year / Policy / Leave Type / month." });
      return;
    }
    try {
      const result = await runAccrual.mutateAsync({ financialYearId: fyId, policyId, leaveTypeId, upToMonth: upToMonthDate });
      const posted = result.filter((r) => r.posted);
      const days = posted.reduce((s, r) => s + r.toPostDays, 0);
      toast({ title: "Accrual posted", description: `${posted.length} employee(s), ${days} day(s) credited to the Leave Ledger.`, variant: "success" });
    } catch (error) {
      toast({ title: "Failed to post accrual", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Post Accrual</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Credits each eligible employee's monthly leave entitlement (from the configured Accrual Periods) into the
          authoritative Leave Ledger, from the Financial Year start up to and including the selected month. Safe to
          re-run — already-posted months are never double-credited.
        </p>

        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label className="text-xs">Financial Year</Label>
            <Select value={fyId} onValueChange={setFyId}>
              <SelectTrigger><SelectValue placeholder="Select FY" /></SelectTrigger>
              <SelectContent>{(fyQuery.data ?? []).map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Leave Policy</Label>
            <Select value={policyId} onValueChange={setPolicyId}>
              <SelectTrigger><SelectValue placeholder="Select Policy" /></SelectTrigger>
              <SelectContent>{activePolicies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} (v{p.versionNumber})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Leave Type</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger><SelectValue placeholder="Select Leave Type" /></SelectTrigger>
              <SelectContent>{activeTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Post up to month</Label>
            <Input type="month" value={upToMonth} onChange={(e) => setUpToMonth(e.target.value)} />
          </div>
        </div>

        {!fyId || !policyId || !leaveTypeId ? (
          <EmptyState icon={CalendarRange} title="Select Financial Year, Policy, Leave Type and month" description="The preview below shows who is eligible and how many days will be posted." />
        ) : preview.isLoading ? (
          <LoadingState />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Eligible Employees</p><p className="text-xl font-semibold">{summary.eligible}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Already Posted</p><p className="text-xl font-semibold">{summary.alreadyPosted} <span className="text-xs font-normal text-muted-foreground">({summary.totalDaysAlready} days)</span></p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">To Be Posted</p><p className="text-xl font-semibold">{summary.toBePosted}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Total Days To Post</p><p className="text-xl font-semibold">{summary.totalDaysToPost}</p></div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handlePost} disabled={runAccrual.isPending || summary.toBePosted === 0}>
                {runAccrual.isPending ? "Posting…" : "Post Accrual"}
              </Button>
              {summary.toBePosted === 0 ? <span className="text-xs text-muted-foreground">Accrual already posted for this period.</span> : null}
            </div>

            {rows.length === 0 ? (
              <EmptyState icon={Users} title="No employees on this policy" description="No active employee resolves to the selected policy for this Financial Year." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead><TableHead>Eligible</TableHead>
                      <TableHead>Entitlement (to date)</TableHead><TableHead>Already Posted</TableHead>
                      <TableHead>To Post</TableHead><TableHead>Months</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.employeeId}>
                        <TableCell className="font-medium">{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode})</span></TableCell>
                        <TableCell>{r.eligible ? <Badge variant="default">Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                        <TableCell>{r.entitlementDays}</TableCell>
                        <TableCell>{r.alreadyPostedDays}</TableCell>
                        <TableCell className={r.toPostDays > 0 ? "font-semibold text-green-600" : ""}>{r.toPostDays}</TableCell>
                        <TableCell>{r.toPostMonths}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Preview
// ============================================================================
function PreviewTab({ companyId }: { companyId?: string }) {
  const employeesQuery = useEmployees({ companyId });
  const typesQuery = useLeaveTypes(companyId);
  const fyQuery = useLeaveFinancialYears(companyId);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [financialYearId, setFinancialYearId] = useState("");

  const previewQuery = useLeavePreviewCalculation(
    employeeId && leaveTypeId && financialYearId ? { employeeId, leaveTypeId, financialYearId } : null
  );

  return (
    <Card>
      <CardHeader><CardTitle>Policy Preview</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Runs the SAME engine real accrual will use — Used/Pending are always 0 here (no Leave Ledger exists yet, Phase 2), so Closing = cumulative Earned.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Select Employee" /></SelectTrigger>
              <SelectContent>{(employeesQuery.data ?? []).slice(0, 100).map((e: any) => <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeCode})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Leave Type</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger><SelectValue placeholder="Select Leave Type" /></SelectTrigger>
              <SelectContent>{(typesQuery.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Financial Year</Label>
            <Select value={financialYearId} onValueChange={setFinancialYearId}>
              <SelectTrigger><SelectValue placeholder="Select Financial Year" /></SelectTrigger>
              <SelectContent>{(fyQuery.data ?? []).map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {previewQuery.isLoading ? (
          <LoadingState />
        ) : previewQuery.data && previewQuery.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead><TableHead>Probation</TableHead><TableHead>Eligible</TableHead>
                <TableHead>Entitlement</TableHead><TableHead>Cumulative Earned</TableHead><TableHead>Closing</TableHead><TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewQuery.data.map((row) => (
                <TableRow key={row.monthStart}>
                  <TableCell>{new Date(row.monthStart).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</TableCell>
                  <TableCell>{row.isProbation ? <Badge variant="warning">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                  <TableCell>{row.isEligible ? <Badge variant="success">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                  <TableCell>{row.monthlyEntitlement}</TableCell>
                  <TableCell>{row.cumulativeEarned}</TableCell>
                  <TableCell className="font-medium">{row.closingBalance}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.note ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : employeeId && leaveTypeId && financialYearId ? (
          <p className="text-sm text-muted-foreground">No preview data — check a policy is assigned and configured for this employee/leave type.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
