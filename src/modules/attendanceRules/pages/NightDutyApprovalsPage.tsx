import { useMemo, useState } from "react";
import { ArrowUpCircle, CheckCircle2, Eye, Moon, ShieldAlert, XCircle } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAttendanceRecordsByIds, useCurrentEmployee } from "@/hooks/useAttendance";
import {
  useAmISuperManager,
  useMyOperationsManagerStores,
  useNightDutyApprovals,
  useNightDutyOmDecide,
  useNightDutySuperManagerDecide,
  useOmNightDutyApprovals,
  useSuperManagerNightDutyApprovals,
} from "@/hooks/useExtendedAttendanceRules";
import { formatDateTime } from "@/modules/attendance/utils";
import { formatDate } from "@/lib/utils";
import type { NightDutyApproval, NightDutyApprovalStatus } from "@/types/attendanceRules";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending (legacy)",
  approved: "Approved (legacy)",
  disallowed: "Disallowed (legacy)",
  pending_om: "Pending with Operations Manager",
  om_approved: "Approved by Operations Manager",
  om_disallowed: "Disallowed by Operations Manager",
  pending_super_manager: "Pending with Super Manager",
  super_manager_approved: "Approved by Super Manager",
  super_manager_disallowed: "Disallowed by Super Manager",
};

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  disallowed: "destructive",
  pending_om: "secondary",
  om_approved: "default",
  om_disallowed: "destructive",
  pending_super_manager: "secondary",
  super_manager_approved: "default",
  super_manager_disallowed: "destructive",
};

const APPROVAL_LEVEL: Record<string, string> = {
  pending: "Operations Manager",
  pending_om: "Operations Manager",
  pending_super_manager: "Super Manager",
  approved: "Finalized",
  disallowed: "Finalized",
  om_approved: "Finalized (by Operations Manager)",
  om_disallowed: "Finalized (by Operations Manager)",
  super_manager_approved: "Finalized (by Super Manager)",
  super_manager_disallowed: "Finalized (by Super Manager)",
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_BADGE[status] ?? "outline"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

/**
 * `a.extraDutyValue`/`a.nightOtMinutes` (attendance_night_duty_approvals) are set ONCE at request
 * creation. If the underlying punch was corrected afterward (e.g. Manual Staff Attendance) before
 * a manager acts on it, that snapshot goes stale while attendance_records recomputes correctly —
 * exactly the bug that let an 08:30 AM overnight punch-out show "1 Day" here instead of "2 Days".
 * `liveRecord`, when available, is always preferred — same rule as everywhere else Night Duty is
 * shown (see modules/attendance/utils.ts resolveNightDutyFacts() module note). This matters most
 * HERE: a manager's Approve/Disallow decision should be informed by the CURRENT punch, not a
 * possibly-outdated one.
 */
function ExtendedDutyCell({ a, liveRecord }: { a: NightDutyApproval; liveRecord?: { extraDutyValue: number | null; nightOtMinutes: number | null } }) {
  const extraDutyValue = liveRecord?.extraDutyValue ?? a.extraDutyValue;
  const nightOtMinutes = liveRecord?.nightOtMinutes ?? a.nightOtMinutes;
  return (
    <div className="text-sm">
      <div>{extraDutyValue} Day{extraDutyValue === 1 ? "" : "s"}</div>
      <div className="text-xs text-muted-foreground">{nightOtMinutes} min OT</div>
    </div>
  );
}

type DecideAction = "approved" | "disallowed" | "carry_forward";

/**
 * Night Duty Approvals — routed to Operations Manager first (store-scoped, actively assigned via
 * attendance_operations_manager_assignments), who may Approve (final), Disallow (final, requires
 * Manager Confirmed Payable Out Time), or Carry Forward to Super Manager (not final). A carried
 * request is decided by any active Super Manager (company-wide, via attendance_super_managers),
 * whose Approve/Disallow is the terminal decision. Super Admin gets a read-only global oversight
 * view here — the normal approval route is OM -> Super Manager, never Super Admin. All server-side
 * authorization is re-enforced inside attendance_night_duty_om_decide / attendance_night_duty_super_manager_decide
 * regardless of what this page renders; the actual punch_out_at is never modified by any decision.
 */
export function NightDutyApprovalsPage() {
  const { user } = useAuth();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const myEmployeeId = currentEmployeeQuery.data?.id;
  const companyId = user?.companyId ?? undefined;
  const isSuperAdmin = user?.role === "super_admin";

  const omStoresQuery = useMyOperationsManagerStores(myEmployeeId);
  const amISuperManagerQuery = useAmISuperManager(myEmployeeId);
  const isOm = (omStoresQuery.data?.length ?? 0) > 0;
  const isSuperManager = amISuperManagerQuery.data === true;

  const roleDetectionLoading = currentEmployeeQuery.isLoading || omStoresQuery.isLoading || amISuperManagerQuery.isLoading;

  const tabs = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    if (isOm) list.push({ value: "om", label: "Operations Manager" });
    if (isSuperManager) list.push({ value: "sm", label: "Super Manager" });
    if (isSuperAdmin) list.push({ value: "oversight", label: "All Records (Oversight)" });
    return list;
  }, [isOm, isSuperManager, isSuperAdmin]);

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const currentTab = activeTab ?? tabs[0]?.value;

  if (roleDetectionLoading) {
    return <LoadingState />;
  }

  if (tabs.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Night Duty Approvals" description="Extended Duty past the configured midnight threshold requires approval before it becomes payroll-eligible." />
        <EmptyState
          icon={ShieldAlert}
          title="No approval access"
          description="You are not assigned as an Operations Manager for any store, nor designated as a Super Manager. Contact your Super Admin if you believe this is incorrect."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Night Duty Approvals" description="Operations Manager reviews first (by store); Carry Forward routes the request to a Super Manager for the final decision." />

      <Tabs value={currentTab} onValueChange={setActiveTab}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {isOm && (
          <TabsContent value="om">
            <OperationsManagerPanel companyId={companyId} omEmployeeId={myEmployeeId} />
          </TabsContent>
        )}
        {isSuperManager && (
          <TabsContent value="sm">
            <SuperManagerPanel companyId={companyId} superManagerEmployeeId={myEmployeeId} />
          </TabsContent>
        )}
        {isSuperAdmin && (
          <TabsContent value="oversight">
            <OversightPanel companyId={companyId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Operations Manager panel
// ---------------------------------------------------------------------------

function OperationsManagerPanel({ companyId, omEmployeeId }: { companyId?: string; omEmployeeId?: string }) {
  const approvalsQuery = useOmNightDutyApprovals(companyId, omEmployeeId);
  const decide = useNightDutyOmDecide();

  const [subTab, setSubTab] = useState<"pending" | "decided">("pending");
  const [target, setTarget] = useState<NightDutyApproval | null>(null);
  const [action, setAction] = useState<DecideAction | null>(null);
  const [payableOutTime, setPayableOutTime] = useState("");
  const [remark, setRemark] = useState("");

  const all = approvalsQuery.data ?? [];
  const pending = all.filter((a) => a.approvalStatus === "pending_om");
  const decided = all.filter((a) => a.approvalStatus !== "pending_om");

  const openAction = (a: NightDutyApproval, act: DecideAction) => {
    setTarget(a);
    setAction(act);
    setPayableOutTime(new Date(a.actualPunchOutAt).toISOString().slice(0, 16));
    setRemark("");
  };

  const closeDialog = () => {
    setTarget(null);
    setAction(null);
  };

  const handleConfirm = async () => {
    if (!target || !action) return;
    if (action === "disallowed" && !payableOutTime) {
      toast({ title: "Please confirm the payable Out Time.", variant: "destructive" });
      return;
    }
    try {
      await decide.mutateAsync({
        approvalId: target.id,
        decision: action,
        managerPayableOutTime: action === "disallowed" ? new Date(payableOutTime).toISOString() : undefined,
        remark: remark || undefined,
      });
      const successMessage =
        action === "approved" ? "Night Duty approved (final)." : action === "disallowed" ? "Night Duty disallowed (final)." : "Carried forward to Super Manager for final decision.";
      toast({ title: successMessage, variant: "success" });
      closeDialog();
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={(v) => setSubTab(v as typeof subTab)}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="decided">My Decisions ({decided.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-6">
          {approvalsQuery.isLoading ? (
            <LoadingState />
          ) : (
            <NightDutyTable
              rows={subTab === "pending" ? pending : decided}
              emptyLabel={subTab === "pending" ? "No requests pending your review." : "No decisions recorded yet."}
              renderActions={
                subTab === "pending"
                  ? (a) => (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => openAction(a, "approved")}>
                          <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => openAction(a, "disallowed")}>
                          <XCircle className="mr-1 h-4 w-4" /> Disallow
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openAction(a, "carry_forward")}>
                          <ArrowUpCircle className="mr-1 h-4 w-4" /> Carry Forward to Super Manager
                        </Button>
                      </div>
                    )
                  : undefined
              }
              showOmColumn={false}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(target && action)} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "approved" ? "Approve Night Duty" : action === "disallowed" ? "Disallow Night Duty" : "Carry Forward to Super Manager"}
            </DialogTitle>
            <DialogDescription>
              {target
                ? `${target.employeeName ?? "—"} (${target.employeeCode ?? "—"}) — ${target.storeName ?? "—"} — ${formatDate(target.attendanceDate)}. Actual Punch Out: ${formatDateTime(target.actualPunchOutAt)}.`
                : ""}
              {action === "approved" && " This is a final decision — the actual Punch Out becomes payable."}
              {action === "disallowed" && " This is a final decision. The actual Punch Out is preserved for history; please confirm the payable Out Time."}
              {action === "carry_forward" && " This is NOT a final decision. The request moves to Pending with Super Manager, and only the Super Manager's decision will apply."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {action === "disallowed" && (
              <div className="space-y-1.5">
                <Label>Manager Confirmed Payable Out Time</Label>
                <Input type="datetime-local" value={payableOutTime} onChange={(e) => setPayableOutTime(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Remark {action === "disallowed" ? "" : "(optional)"}</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={action === "carry_forward" ? "Reason for forwarding to Super Manager." : action === "disallowed" ? "Reason for disallowing." : undefined} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={closeDialog} disabled={decide.isPending}>Cancel</Button>
            <Button variant={action === "disallowed" ? "destructive" : "default"} onClick={handleConfirm} disabled={decide.isPending}>
              {decide.isPending ? "Saving…" : action === "approved" ? "Yes, Approve" : action === "disallowed" ? "Confirm Disallow" : "Carry Forward"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Super Manager panel
// ---------------------------------------------------------------------------

function SuperManagerPanel({ companyId, superManagerEmployeeId }: { companyId?: string; superManagerEmployeeId?: string }) {
  const approvalsQuery = useSuperManagerNightDutyApprovals(companyId, superManagerEmployeeId);
  const decide = useNightDutySuperManagerDecide();

  const [subTab, setSubTab] = useState<"pending" | "decided">("pending");
  const [target, setTarget] = useState<NightDutyApproval | null>(null);
  const [action, setAction] = useState<"approved" | "disallowed" | null>(null);
  const [payableOutTime, setPayableOutTime] = useState("");
  const [remark, setRemark] = useState("");

  const all = approvalsQuery.data ?? [];
  const pending = all.filter((a) => a.approvalStatus === "pending_super_manager");
  const decided = all.filter((a) => a.approvalStatus !== "pending_super_manager");

  const openAction = (a: NightDutyApproval, act: "approved" | "disallowed") => {
    setTarget(a);
    setAction(act);
    setPayableOutTime(new Date(a.actualPunchOutAt).toISOString().slice(0, 16));
    setRemark("");
  };

  const closeDialog = () => {
    setTarget(null);
    setAction(null);
  };

  const handleConfirm = async () => {
    if (!target || !action) return;
    if (action === "disallowed" && !payableOutTime) {
      toast({ title: "Please confirm the payable Out Time.", variant: "destructive" });
      return;
    }
    try {
      await decide.mutateAsync({
        approvalId: target.id,
        decision: action,
        managerPayableOutTime: action === "disallowed" ? new Date(payableOutTime).toISOString() : undefined,
        remark: remark || undefined,
      });
      toast({ title: action === "approved" ? "Night Duty approved (final)." : "Night Duty disallowed (final).", variant: "success" });
      closeDialog();
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={(v) => setSubTab(v as typeof subTab)}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="decided">My Decisions ({decided.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-6">
          {approvalsQuery.isLoading ? (
            <LoadingState />
          ) : (
            <NightDutyTable
              rows={subTab === "pending" ? pending : decided}
              emptyLabel={subTab === "pending" ? "No requests carried forward to you." : "No decisions recorded yet."}
              renderActions={
                subTab === "pending"
                  ? (a) => (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => openAction(a, "approved")}>
                          <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => openAction(a, "disallowed")}>
                          <XCircle className="mr-1 h-4 w-4" /> Disallow
                        </Button>
                      </div>
                    )
                  : undefined
              }
              showOmColumn
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(target && action)} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action === "approved" ? "Approve Night Duty (Final)" : "Disallow Night Duty (Final)"}</DialogTitle>
            <DialogDescription>
              {target
                ? `${target.employeeName ?? "—"} (${target.employeeCode ?? "—"}) — ${target.storeName ?? "—"} — ${formatDate(target.attendanceDate)}. Actual Punch Out: ${formatDateTime(target.actualPunchOutAt)}. Previously carried forward by ${target.omName ?? "the Operations Manager"}.`
                : ""}
              {" "}This is the final decision on this request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {action === "disallowed" && (
              <div className="space-y-1.5">
                <Label>Manager Confirmed Payable Out Time</Label>
                <Input type="datetime-local" value={payableOutTime} onChange={(e) => setPayableOutTime(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Remark {action === "disallowed" ? "" : "(optional)"}</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={action === "disallowed" ? "Reason for disallowing." : undefined} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={closeDialog} disabled={decide.isPending}>Cancel</Button>
            <Button variant={action === "disallowed" ? "destructive" : "default"} onClick={handleConfirm} disabled={decide.isPending}>
              {decide.isPending ? "Saving…" : action === "approved" ? "Yes, Approve" : "Confirm Disallow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Super Admin oversight panel — read-only, global. Super Admin is NOT the normal approval route;
// this view exists purely for administrative visibility, per explicit instruction.
// ---------------------------------------------------------------------------

function OversightPanel({ companyId }: { companyId?: string }) {
  const [statusFilter, setStatusFilter] = useState<NightDutyApprovalStatus | "all">("all");
  const approvalsQuery = useNightDutyApprovals(companyId, statusFilter === "all" ? undefined : statusFilter);
  const rows = approvalsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Eye className="h-4 w-4" />
        Read-only global view for administrative oversight. Approvals are decided by Operations Managers and Super Managers, not here.
      </div>
      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending_om">Pending OM</TabsTrigger>
          <TabsTrigger value="pending_super_manager">Pending SM</TabsTrigger>
          <TabsTrigger value="om_approved">OM Approved</TabsTrigger>
          <TabsTrigger value="om_disallowed">OM Disallowed</TabsTrigger>
          <TabsTrigger value="super_manager_approved">SM Approved</TabsTrigger>
          <TabsTrigger value="super_manager_disallowed">SM Disallowed</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        <CardContent className="pt-6">
          {approvalsQuery.isLoading ? <LoadingState /> : <NightDutyTable rows={rows} emptyLabel="No records." showOmColumn />}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared table
// ---------------------------------------------------------------------------

function NightDutyTable({
  rows,
  emptyLabel,
  renderActions,
  showOmColumn,
}: {
  rows: NightDutyApproval[];
  emptyLabel: string;
  renderActions?: (a: NightDutyApproval) => React.ReactNode;
  showOmColumn: boolean;
}) {
  const recordIds = useMemo(() => rows.map((a) => a.attendanceRecordId), [rows]);
  const recordsQuery = useAttendanceRecordsByIds(recordIds);
  const recordById = useMemo(() => new Map((recordsQuery.data ?? []).map((r) => [r.id, r])), [recordsQuery.data]);

  if (rows.length === 0) {
    return <EmptyState icon={Moon} title="No records" description={emptyLabel} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Punch In</TableHead>
            <TableHead>Actual Punch Out</TableHead>
            <TableHead>Extended Duty / Night OT</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Approval Level</TableHead>
            {showOmColumn && <TableHead>Previous OM Action</TableHead>}
            <TableHead>Remarks</TableHead>
            {renderActions && <TableHead>Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">
                {a.employeeName ?? "—"} <span className="text-muted-foreground">({a.employeeCode ?? "—"})</span>
              </TableCell>
              <TableCell>{a.storeName ?? "—"}</TableCell>
              <TableCell>{formatDate(a.attendanceDate)}</TableCell>
              <TableCell>{a.punchInAt ? formatDateTime(a.punchInAt) : "—"}</TableCell>
              <TableCell>{formatDateTime(a.actualPunchOutAt)}</TableCell>
              <TableCell><ExtendedDutyCell a={a} liveRecord={recordById.get(a.attendanceRecordId)} /></TableCell>
              <TableCell><StatusBadge status={a.approvalStatus} /></TableCell>
              <TableCell className="text-sm">{APPROVAL_LEVEL[a.approvalStatus] ?? "—"}</TableCell>
              {showOmColumn && (
                <TableCell className="text-sm">
                  {a.omAction ? (
                    <>
                      {a.omAction === "carried_forward" ? "Carried Forward" : a.omAction === "approved" ? "Approved" : "Disallowed"}
                      {a.omName ? ` by ${a.omName}` : ""}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
              )}
              <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                {[a.omRemark, a.superManagerRemark].filter(Boolean).join(" | ") || "—"}
                {a.approvalStatus.includes("disallowed") && a.managerConfirmedPayableOutAt && (
                  <div className="mt-1 text-foreground">Payable Out: {formatDateTime(a.managerConfirmedPayableOutAt)}</div>
                )}
              </TableCell>
              {renderActions && <TableCell>{renderActions(a)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
