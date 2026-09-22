import { useMemo, useState } from "react";
import { CheckCircle2, Landmark, ShieldAlert, XCircle } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";
import {
  useLeavePolicies,
  useLeaveFinancialYears,
  useLeaveEncashmentRule,
  useUpsertLeaveEncashmentRule,
  useLeavePriorNoticeRule,
  useUpsertLeavePriorNoticeRule,
  usePendingPriorNoticeExceptions,
  useDecidePriorNoticeException,
  useLeaveNotificationSettings,
  useUpdateLeaveNotificationSetting,
  useFyClosingPreview,
  useConfirmFyClosing,
  usePayrollLeaveTransactions,
} from "@/hooks/useLeave";
import type { LeaveFyClosingLine } from "@/types/leave";

const NOTIFICATION_EVENT_LABELS: Record<string, string> = {
  leave_applied: "Leave Applied",
  manager_approval_pending: "Manager Approval Pending",
  super_manager_approval_pending: "Super Manager Approval Pending",
  leave_approved: "Leave Approved",
  leave_rejected: "Leave Rejected",
  leave_cancelled: "Leave Cancelled",
  leave_modified: "Leave Modified",
  long_leave_applied: "Long Leave Applied",
  prior_notice_exception: "Prior Notice Exception",
  balance_low: "Leave Balance Low",
  leave_expiring: "Leave Expiring",
  encashment_generated: "Encashment Generated",
  lapse_generated: "Lapse Generated",
  financial_year_closed: "Financial Year Closed",
};

/**
 * Leave Settlement & Closing (Phase 4) — Prior Notice, Encashment, Lapse (via the same Encashment
 * rule's threshold — a leave type with Lapse allowed but no Encashment match simply lapses, no
 * separate "Lapse formula" exists), Notifications, Financial Year Closing (Preview -> Confirm, one
 * authoritative engine for both), and a read-only Payroll Integration view. Super Admin only, same
 * as Leave Policies. Every business value here (7 days, ₹15,000, 26, Basic+DA) is ordinary editable
 * configuration data — nothing is hard-coded in this page.
 */
export function LeaveSettlementPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const companyId = user?.companyId ?? undefined;

  if (!isSuperAdmin) {
    return <EmptyState icon={ShieldAlert} title="Super Admin access required" description="Only Super Admin can view or manage Leave Settlement configuration." />;
  }

  const [activeTab, setActiveTab] = useState("financial-years");
  const policiesQuery = useLeavePolicies(companyId);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const effectivePolicyId = selectedPolicyId || policiesQuery.data?.[0]?.id || "";

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Settlement & Closing" description="Prior Notice, Encashment, Lapse, Notifications, and Financial Year Closing — all configuration-driven." />

      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-sm text-muted-foreground">Leave Policy:</Label>
        <Select value={effectivePolicyId} onValueChange={setSelectedPolicyId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Select a policy" /></SelectTrigger>
          <SelectContent>
            {(policiesQuery.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name} (v{p.versionNumber})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="financial-years">Financial Year Closing</TabsTrigger>
          <TabsTrigger value="prior-notice">Prior Notice</TabsTrigger>
          <TabsTrigger value="encashment">Encashment &amp; Lapse</TabsTrigger>
          <TabsTrigger value="exceptions">Exception Requests</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="payroll">Payroll Integration</TabsTrigger>
        </TabsList>

        <TabsContent value="financial-years"><FinancialYearClosingTab companyId={companyId} /></TabsContent>
        <TabsContent value="prior-notice"><PriorNoticeTab policyId={effectivePolicyId} /></TabsContent>
        <TabsContent value="encashment"><EncashmentTab policyId={effectivePolicyId} /></TabsContent>
        <TabsContent value="exceptions"><ExceptionRequestsTab /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab companyId={companyId} /></TabsContent>
        <TabsContent value="payroll"><PayrollTab companyId={companyId} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Prior Notice
// ============================================================================
function PriorNoticeTab({ policyId }: { policyId: string }) {
  const ruleQuery = useLeavePriorNoticeRule(policyId || undefined);
  const upsert = useUpsertLeavePriorNoticeRule();

  const [required, setRequired] = useState(true);
  const [noticeDays, setNoticeDays] = useState(7);
  const [behavior, setBehavior] = useState("allow_with_reason");
  const [loaded, setLoaded] = useState(false);

  const rule = ruleQuery.data;
  if (rule && !loaded) {
    setRequired(rule.required);
    setNoticeDays(rule.noticeDays);
    setBehavior(rule.exceptionBehavior);
    setLoaded(true);
  }

  if (!policyId) return <EmptyState icon={Landmark} title="Select a Leave Policy" description="Choose a Leave Policy above to configure its Prior Notice rule." />;
  if (ruleQuery.isLoading) return <LoadingState />;

  const handleSave = async () => {
    try {
      await upsert.mutateAsync({ policyId, required, noticeDays, exceptionBehavior: behavior });
      toast({ title: "Prior Notice rule saved", variant: "success" });
    } catch (error) {
      toast({ title: "Could not save", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Prior Notice for Long Leave</CardTitle></CardHeader>
      <CardContent className="max-w-lg space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={required} onCheckedChange={(v) => setRequired(Boolean(v))} /> Prior Notice Required for Long Leave
        </label>
        {required && (
          <>
            <div>
              <Label>Notice Period (days)</Label>
              <Input type="number" min={0} value={noticeDays} onChange={(e) => setNoticeDays(Number(e.target.value))} />
            </div>
            <div>
              <Label>Exception Policy (when notice is not satisfied)</Label>
              <Select value={behavior} onValueChange={setBehavior}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reject">Reject Application</SelectItem>
                  <SelectItem value="allow_with_reason">Allow With Reason</SelectItem>
                  <SelectItem value="hr_approval_required">HR Approval Required</SelectItem>
                  <SelectItem value="special_approval_required">Special Approval Required</SelectItem>
                  <SelectItem value="emergency_exception">Emergency Exception</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                "HR Approval Required", "Special Approval Required", and "Emergency Exception" all route through the same Exception Request → Admin/HR decision flow (see the "Exception Requests" tab).
              </p>
            </div>
          </>
        )}
        <Button onClick={handleSave} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : "Save"}</Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Encashment & Lapse
// ============================================================================
function EncashmentTab({ policyId }: { policyId: string }) {
  const ruleQuery = useLeaveEncashmentRule(policyId || undefined);
  const upsert = useUpsertLeaveEncashmentRule();

  const [enabled, setEnabled] = useState(true);
  const [salaryBaseType, setSalaryBaseType] = useState("basic_da");
  const [divisorType, setDivisorType] = useState("26");
  const [divisorCustomValue, setDivisorCustomValue] = useState<number | "">("");
  const [thresholdBaseType, setThresholdBaseType] = useState("basic");
  const [salaryThreshold, setSalaryThreshold] = useState<number | "">(15000);
  const [thresholdComparison, setThresholdComparison] = useState("lt");
  const [loaded, setLoaded] = useState(false);

  const rule = ruleQuery.data;
  if (rule && !loaded) {
    setEnabled(rule.enabled);
    setSalaryBaseType(rule.salaryBaseType);
    setDivisorType(rule.divisorType);
    setDivisorCustomValue(rule.divisorCustomValue ?? "");
    setThresholdBaseType(rule.thresholdBaseType);
    setSalaryThreshold(rule.salaryThreshold ?? "");
    setThresholdComparison(rule.thresholdComparison);
    setLoaded(true);
  }

  if (!policyId) return <EmptyState icon={Landmark} title="Select a Leave Policy" description="Choose a Leave Policy above to configure Encashment." />;
  if (ruleQuery.isLoading) return <LoadingState />;

  const handleSave = async () => {
    try {
      await upsert.mutateAsync({
        policyId,
        enabled,
        salaryBaseType,
        divisorType,
        divisorCustomValue: divisorType === "custom" ? Number(divisorCustomValue) || null : null,
        thresholdBaseType,
        salaryThreshold: salaryThreshold === "" ? null : Number(salaryThreshold),
        thresholdComparison,
      });
      toast({ title: "Encashment rule saved", variant: "success" });
    } catch (error) {
      toast({ title: "Could not save", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Encashment Formula &amp; Salary Threshold</CardTitle></CardHeader>
      <CardContent className="max-w-lg space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} /> Encashment Enabled for this Policy
        </label>

        <div>
          <Label>Salary Base (for the Daily Rate formula)</Label>
          <Select value={salaryBaseType} onValueChange={setSalaryBaseType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="basic">Basic Salary</SelectItem>
              <SelectItem value="basic_da">Basic Salary + DA</SelectItem>
              <SelectItem value="gross">Gross (not yet available — no Payroll data)</SelectItem>
              <SelectItem value="gross_da">Gross + DA (not yet available)</SelectItem>
              <SelectItem value="custom">Custom Components (not yet available)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Divisor</Label>
          <Select value={divisorType} onValueChange={setDivisorType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="26">26</SelectItem>
              <SelectItem value="30">30</SelectItem>
              <SelectItem value="calendar_days">Calendar Days (of the FY-end month)</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {divisorType === "custom" && (
            <Input className="mt-2" type="number" min={1} placeholder="Custom divisor" value={divisorCustomValue} onChange={(e) => setDivisorCustomValue(e.target.value === "" ? "" : Number(e.target.value))} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Threshold Based On</Label>
            <Select value={thresholdBaseType} onValueChange={setThresholdBaseType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">Basic Salary</SelectItem>
                <SelectItem value="basic_da">Basic Salary + DA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Comparison</Label>
            <Select value={thresholdComparison} onValueChange={setThresholdComparison}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lt">Less Than</SelectItem>
                <SelectItem value="lte">Less Than Or Equal</SelectItem>
                <SelectItem value="gt">Greater Than</SelectItem>
                <SelectItem value="gte">Greater Than Or Equal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Salary Threshold (₹)</Label>
          <Input type="number" min={0} value={salaryThreshold} onChange={(e) => setSalaryThreshold(e.target.value === "" ? "" : Number(e.target.value))} />
          <p className="mt-1 text-xs text-muted-foreground">
            Employees who satisfy this comparison are Encashed; the remaining balance for everyone else falls to Lapse (if the Leave Type's own Lapse setting allows it — configured in Leave Policies → Leave Types).
          </p>
        </div>

        <Button onClick={handleSave} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : "Save"}</Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Prior Notice Exception Requests (Admin/HR decision queue)
// ============================================================================
function ExceptionRequestsTab() {
  const pendingQuery = usePendingPriorNoticeExceptions();
  const decide = useDecidePriorNoticeException();
  const [target, setTarget] = useState<{ id: string } | null>(null);
  const [action, setAction] = useState<"approved" | "rejected" | null>(null);
  const [remark, setRemark] = useState("");

  const rows = pendingQuery.data ?? [];

  const handleConfirm = async () => {
    if (!target || !action) return;
    try {
      await decide.mutateAsync({ exceptionId: target.id, decision: action, remark: remark || undefined });
      toast({ title: action === "approved" ? "Exception approved" : "Exception rejected", variant: "success" });
      setTarget(null);
      setAction(null);
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Pending Prior Notice Exception Requests</CardTitle></CardHeader>
      <CardContent>
        {pendingQuery.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing pending" description="No prior notice exception requests need a decision." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Behavior</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.employeeName ?? "—"}</TableCell>
                    <TableCell>{r.leaveTypeName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{formatDate(r.fromDate)}</TableCell>
                    <TableCell className="text-xs">{formatDate(r.toDate)}</TableCell>
                    <TableCell className="text-xs capitalize">{r.exceptionBehavior.replace(/_/g, " ")}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs" title={r.reason}>{r.reason}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(r.requestedAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => { setTarget({ id: r.id }); setAction("approved"); setRemark(""); }}><CheckCircle2 className="mr-1 h-4 w-4" />Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => { setTarget({ id: r.id }); setAction("rejected"); setRemark(""); }}><XCircle className="mr-1 h-4 w-4" />Reject</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(target && action)} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action === "approved" ? "Approve Exception Request" : "Reject Exception Request"}</DialogTitle>
            <DialogDescription>The employee will be able to re-submit their leave application once approved.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Remark (optional)</Label>
            <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={decide.isPending}>Cancel</Button>
            <Button variant={action === "rejected" ? "destructive" : "default"} onClick={handleConfirm} disabled={decide.isPending}>{decide.isPending ? "Saving…" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// Notifications
// ============================================================================
function NotificationsTab({ companyId }: { companyId?: string }) {
  const settingsQuery = useLeaveNotificationSettings(companyId);
  const update = useUpdateLeaveNotificationSetting();

  if (!companyId) return null;
  if (settingsQuery.isLoading) return <LoadingState />;

  const toggle = async (id: string, field: "inAppEnabled" | "pushEnabled" | "emailEnabled" | "smsEnabled", current: { inAppEnabled: boolean; pushEnabled: boolean; emailEnabled: boolean; smsEnabled: boolean }, value: boolean) => {
    try {
      await update.mutateAsync({ id, inAppEnabled: current.inAppEnabled, pushEnabled: current.pushEnabled, emailEnabled: current.emailEnabled, smsEnabled: current.smsEnabled, [field]: value } as any);
    } catch (error) {
      toast({ title: "Could not update", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Notification Channels per Event</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">Only In-App is actually delivered in this phase. Push/Email/SMS are shown for completeness and remain "Not Configured" until a provider integration exists — enabling them here does not fabricate delivery.</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>In-App</TableHead>
                <TableHead>Push</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>SMS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(settingsQuery.data ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{NOTIFICATION_EVENT_LABELS[s.eventType] ?? s.eventType}</TableCell>
                  <TableCell><Checkbox checked={s.inAppEnabled} onCheckedChange={(v) => toggle(s.id, "inAppEnabled", s, Boolean(v))} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={s.pushEnabled} onCheckedChange={(v) => toggle(s.id, "pushEnabled", s, Boolean(v))} />
                      {!s.pushEnabled && <Badge variant="secondary" className="text-[10px]">Not Configured</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={s.emailEnabled} onCheckedChange={(v) => toggle(s.id, "emailEnabled", s, Boolean(v))} />
                      {!s.emailEnabled && <Badge variant="secondary" className="text-[10px]">Not Configured</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={s.smsEnabled} onCheckedChange={(v) => toggle(s.id, "smsEnabled", s, Boolean(v))} />
                      {!s.smsEnabled && <Badge variant="secondary" className="text-[10px]">Not Configured</Badge>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Financial Year Closing (Preview -> Confirm, one shared engine)
// ============================================================================
function FinancialYearClosingTab({ companyId }: { companyId?: string }) {
  const fyQuery = useLeaveFinancialYears(companyId);
  const [selectedFyId, setSelectedFyId] = useState("");
  const [nextFyId, setNextFyId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fys = fyQuery.data ?? [];
  const effectiveFyId = selectedFyId || fys.find((f) => f.status === "active")?.id || "";
  const previewQuery = useFyClosingPreview(effectiveFyId || undefined);
  const confirmClosing = useConfirmFyClosing();

  const rows = previewQuery.data ?? [];
  const withActivity = rows.filter((r) => r.available > 0 || r.carryForwardDays > 0 || r.encashmentDays > 0 || r.lapseDays > 0 || r.available < 0);
  const needsCarryForward = rows.some((r) => r.carryForwardDays > 0);
  const totals = useMemo(
    () => ({
      carryForward: rows.reduce((s, r) => s + r.carryForwardDays, 0),
      encashmentDays: rows.reduce((s, r) => s + r.encashmentDays, 0),
      encashmentAmount: rows.reduce((s, r) => s + (r.encashmentAmount ?? 0), 0),
      lapse: rows.reduce((s, r) => s + r.lapseDays, 0),
      unresolved: rows.filter((r) => r.finalStatus === "partial_unresolved").length,
    }),
    [rows]
  );

  const handleConfirm = async () => {
    try {
      await confirmClosing.mutateAsync({ financialYearId: effectiveFyId, nextFinancialYearId: nextFyId || undefined });
      toast({ title: "Financial Year closed", variant: "success" });
      setConfirmOpen(false);
    } catch (error) {
      toast({ title: "Closing failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-sm text-muted-foreground">Financial Year</Label>
          <Select value={effectiveFyId} onValueChange={setSelectedFyId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select FY" /></SelectTrigger>
            <SelectContent>
              {fys.map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.label} ({fy.status})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {needsCarryForward && (
          <div>
            <Label className="text-sm text-muted-foreground">Next Financial Year (for Carry Forward)</Label>
            <Select value={nextFyId} onValueChange={setNextFyId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Select next FY" /></SelectTrigger>
              <SelectContent>
                {fys.filter((fy) => fy.id !== effectiveFyId).map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!effectiveFyId ? (
        <EmptyState icon={Landmark} title="Select a Financial Year" description="Choose a Financial Year above to preview its closing." />
      ) : previewQuery.isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Carry Forward</p><p className="text-xl font-semibold">{totals.carryForward} day(s)</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Encashment</p><p className="text-xl font-semibold">{totals.encashmentDays} day(s) / ₹{totals.encashmentAmount.toFixed(2)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Lapse</p><p className="text-xl font-semibold">{totals.lapse} day(s)</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Unresolved</p><p className={`text-xl font-semibold ${totals.unresolved > 0 ? "text-destructive" : ""}`}>{totals.unresolved} row(s)</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Preview FY Closing ({withActivity.length} of {rows.length} employee/leave-type rows have activity)</CardTitle></CardHeader>
            <CardContent>
              {withActivity.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="Nothing to close" description="No employee has a balance requiring Carry Forward, Encashment, or Lapse for this Financial Year." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Opening</TableHead>
                        <TableHead>Earned</TableHead>
                        <TableHead>Used</TableHead>
                        <TableHead>Available</TableHead>
                        <TableHead>Carry Fwd</TableHead>
                        <TableHead>Encash</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Lapse</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {withActivity.map((r: LeaveFyClosingLine) => (
                        <TableRow key={`${r.employeeId}-${r.leaveTypeId}`}>
                          <TableCell className="font-mono text-xs">{r.employeeId.slice(0, 8)}…</TableCell>
                          <TableCell>{r.opening}</TableCell>
                          <TableCell>{r.earned}</TableCell>
                          <TableCell>{r.used}</TableCell>
                          <TableCell className={r.available < 0 ? "text-destructive" : ""}>{r.available}</TableCell>
                          <TableCell>{r.carryForwardDays || "—"}</TableCell>
                          <TableCell>{r.encashmentDays || "—"}</TableCell>
                          <TableCell>{r.encashmentAmount ? `₹${r.encashmentAmount.toFixed(2)}` : "—"}</TableCell>
                          <TableCell>{r.lapseDays || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={r.finalStatus === "partial_unresolved" ? "destructive" : r.finalStatus === "no_action" ? "secondary" : "default"}>
                              {r.finalStatus.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Button onClick={() => setConfirmOpen(true)} disabled={withActivity.length === 0 || (needsCarryForward && !nextFyId)}>
            Confirm Financial Year Closing
          </Button>
          {needsCarryForward && !nextFyId && <p className="text-xs text-destructive">Select a Next Financial Year above — Carry Forward days need somewhere to land.</p>}
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Financial Year Closing</DialogTitle>
            <DialogDescription>Are you sure? This will finalize Leave balances and create Encashment/Lapse transactions. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={confirmClosing.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={confirmClosing.isPending}>{confirmClosing.isPending ? "Closing…" : "Yes, Close Financial Year"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Payroll Integration (read-only — no Payroll module exists yet to post into)
// ============================================================================
function PayrollTab({ companyId }: { companyId?: string }) {
  const txnsQuery = usePayrollLeaveTransactions(companyId);
  const rows = txnsQuery.data ?? [];

  return (
    <Card>
      <CardHeader><CardTitle>Leave-Originated Payroll Transactions</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Integration-ready records only — no Payroll module exists in this project yet to actually post these into. LWP amounts are intentionally left blank (no salary formula is invented here).
        </p>
        {txnsQuery.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={Landmark} title="No transactions yet" description="Leave Encashment/LWP transactions created at Financial Year Closing will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.employeeId.slice(0, 8)}…</TableCell>
                    <TableCell className="capitalize">{t.transactionType.replace(/_/g, " ")}</TableCell>
                    <TableCell>{t.days}</TableCell>
                    <TableCell>{t.amount !== null ? `₹${t.amount.toFixed(2)}` : "Pending Payroll pricing"}</TableCell>
                    <TableCell><Badge variant="secondary">{t.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(t.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
