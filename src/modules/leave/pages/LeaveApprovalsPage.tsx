import { useMemo, useState } from "react";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import { useAmISuperManager } from "@/hooks/useExtendedAttendanceRules";
import {
  useAmILeaveManager,
  useManagerPendingLeaveApplications,
  useSuperManagerPendingLeaveApplications,
  useManagerDecideLeave,
  useSuperManagerDecideLeave,
  useMyApprovalHistory,
  useMyLeaveHistory,
} from "@/hooks/useLeave";
import { formatDate } from "@/lib/utils";
import type { LeaveApprovalQueueRow, LeaveApproverHistoryRow, StaffLeaveHistoryRow } from "@/types/leave";

type DecideAction = "approved" | "rejected";

/** "Step 1 — Direct Manager" / "Step 2 — Super Manager" from a pending row's current status. */
function pendingStageLabel(status: string): string {
  if (status === "super_manager_pending") return "Step 2 — Super Manager";
  return "Step 1 — Direct Manager";
}
/** Same label from a history row's own recorded action. */
function historyStageLabel(row: Pick<LeaveApproverHistoryRow, "stepOrder" | "approverRole">): string {
  return `Step ${row.stepOrder} — ${row.approverRole === "super_manager" ? "Super Manager" : "Direct Manager"}`;
}

function ShortLongBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={value === "long" ? "secondary" : "outline"} className="capitalize">{value}</Badge>;
}

/** Badge for a leave application's CURRENT overall status (used in the history tabs). */
function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "approved" ? "success" : status === "rejected" ? "destructive" : status === "cancelled" ? "secondary" : "warning";
  return <Badge variant={variant} className="capitalize">{status.replace(/_/g, " ")}</Badge>;
}

/**
 * Leave Approvals — role-based, dual purpose:
 *   • Direct Manager / Super Manager  -> the decide inbox + their own approval history
 *     (ApproverApprovalsView).
 *   • Normal Staff                    -> the status / approval history of the employee's OWN
 *     leave applications, strictly self-scoped (StaffLeaveHistoryView).
 * Nothing is ever deleted — a decided request just moves between the Pending / Approved / Rejected
 * tabs. The 1–3 / 4+ day workflow (leave_manager_decide / leave_super_manager_decide) is unchanged.
 */
export function LeaveApprovalsPage() {
  const { user } = useAuth();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const myEmployeeId = currentEmployeeQuery.data?.id;
  const isSuperAdmin = user?.role === "super_admin";

  const amIManagerQuery = useAmILeaveManager(myEmployeeId);
  const amISuperManagerQuery = useAmISuperManager(myEmployeeId);
  const isApprover = amIManagerQuery.data === true || amISuperManagerQuery.data === true;

  if (currentEmployeeQuery.isLoading || amIManagerQuery.isLoading || amISuperManagerQuery.isLoading) {
    return <LoadingState />;
  }

  if (isApprover || isSuperAdmin) {
    return <ApproverApprovalsView />;
  }
  if (myEmployeeId) {
    return <StaffLeaveHistoryView />;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Leave Approval" description="Track the approval status of your leave applications." />
      <EmptyState
        icon={ShieldAlert}
        title="No leave records"
        description="Your login is not linked to an employee record, so there is nothing to show here."
      />
    </div>
  );
}

// ===========================================================================
// Approver view — Direct Manager / Super Manager decide inbox + approval history
// ===========================================================================
function ApproverApprovalsView() {
  const { user } = useAuth();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const myEmployeeId = currentEmployeeQuery.data?.id;

  const amIManagerQuery = useAmILeaveManager(myEmployeeId);
  const amISuperManagerQuery = useAmISuperManager(myEmployeeId);
  const isManager = amIManagerQuery.data === true;
  const isSuperManager = amISuperManagerQuery.data === true;

  const managerQueueQuery = useManagerPendingLeaveApplications();
  const superManagerQueueQuery = useSuperManagerPendingLeaveApplications();
  const approvedQuery = useMyApprovalHistory("approved");
  const rejectedQuery = useMyApprovalHistory("rejected");

  const decideManager = useManagerDecideLeave();
  const decideSuperManager = useSuperManagerDecideLeave();

  const [target, setTarget] = useState<LeaveApprovalQueueRow | null>(null);
  const [action, setAction] = useState<DecideAction | null>(null);
  const [remark, setRemark] = useState("");

  const pendingRows = useMemo<LeaveApprovalQueueRow[]>(() => {
    const rows: LeaveApprovalQueueRow[] = [];
    if (isManager) rows.push(...(managerQueueQuery.data ?? []));
    if (isSuperManager) rows.push(...(superManagerQueueQuery.data ?? []));
    // de-dupe defensively (an application is only ever in one queue, but guard anyway)
    return Array.from(new Map(rows.map((r) => [r.id, r])).values()).sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
  }, [isManager, isSuperManager, managerQueueQuery.data, superManagerQueueQuery.data]);

  const approvedRows = approvedQuery.data ?? [];
  const rejectedRows = rejectedQuery.data ?? [];

  const [activeTab, setActiveTab] = useState("pending");

  const openAction = (row: LeaveApprovalQueueRow, act: DecideAction) => {
    setTarget(row);
    setAction(act);
    setRemark("");
  };
  const closeDialog = () => {
    setTarget(null);
    setAction(null);
  };
  const decidePending = target?.status === "super_manager_pending" ? decideSuperManager : decideManager;

  const handleConfirm = async () => {
    if (!target || !action) return;
    if (action === "rejected" && !remark.trim()) {
      toast({ title: "A remark is required to reject an application.", variant: "destructive" });
      return;
    }
    try {
      const result = await decidePending.mutateAsync({ applicationId: target.id, decision: action, remark: remark || undefined });
      const message =
        action === "rejected"
          ? "Leave application rejected."
          : result.status === "super_manager_pending"
          ? "Approved and forwarded to Super Manager for final decision."
          : "Leave application approved (final).";
      toast({ title: message, variant: "success" });
      closeDialog();
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const isLongApprove = action === "approved" && target?.status === "manager_pending" && target?.shortOrLong === "long";

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Approvals" description="1–3 day leave: Direct Manager decides (final). 4+ day leave: Direct Manager forwards, Super Manager finalizes." />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pendingRows.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approvedRows.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejectedRows.length})</TabsTrigger>
        </TabsList>

        {/* ---------------- Pending ---------------- */}
        <TabsContent value="pending">
          <Card>
            <CardContent className="pt-6">
              {managerQueueQuery.isLoading || superManagerQueueQuery.isLoading ? (
                <LoadingState />
              ) : pendingRows.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No pending leave approvals." description="No leave applications are currently awaiting your decision." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Leave Type</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Short/Long</TableHead>
                        <TableHead>Applied Date</TableHead>
                        <TableHead>Current Approval Stage</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span>
                          </TableCell>
                          <TableCell>{row.leaveTypeName}</TableCell>
                          <TableCell className="text-xs">{formatDate(row.fromDate)}</TableCell>
                          <TableCell className="text-xs">{formatDate(row.toDate)}</TableCell>
                          <TableCell>{row.totalDays}</TableCell>
                          <TableCell><ShortLongBadge value={row.shortOrLong} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(row.appliedAt)}</TableCell>
                          <TableCell className="text-xs">{pendingStageLabel(row.status)}</TableCell>
                          <TableCell>
                            <Badge variant="warning">{row.status === "super_manager_pending" ? "Super Manager Pending" : "Manager Pending"}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" onClick={() => openAction(row, "approved")}>
                                <CheckCircle2 className="mr-1 h-4 w-4" />
                                {row.status === "manager_pending" && row.shortOrLong === "long" ? "Approve & Forward" : "Approve"}
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => openAction(row, "rejected")}>
                                <XCircle className="mr-1 h-4 w-4" /> Reject
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
        </TabsContent>

        {/* ---------------- Approved ---------------- */}
        <TabsContent value="approved">
          <Card>
            <CardContent className="pt-6">
              {approvedQuery.isLoading ? (
                <LoadingState />
              ) : approvedRows.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No approved leave records." description="Leave applications you approve will appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Leave Type</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Short/Long</TableHead>
                        <TableHead>Applied Date</TableHead>
                        <TableHead>Approved Date</TableHead>
                        <TableHead>Approved By</TableHead>
                        <TableHead>Approval Stage</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {approvedRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span>
                          </TableCell>
                          <TableCell>{row.leaveTypeName}</TableCell>
                          <TableCell className="text-xs">{formatDate(row.fromDate)}</TableCell>
                          <TableCell className="text-xs">{formatDate(row.toDate)}</TableCell>
                          <TableCell>{row.totalDays}</TableCell>
                          <TableCell><ShortLongBadge value={row.shortOrLong} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(row.appliedAt)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(row.actedAt)}</TableCell>
                          <TableCell className="text-xs">{row.approverName}</TableCell>
                          <TableCell className="text-xs">{historyStageLabel(row)}</TableCell>
                          <TableCell><StatusBadge status={row.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Rejected ---------------- */}
        <TabsContent value="rejected">
          <Card>
            <CardContent className="pt-6">
              {rejectedQuery.isLoading ? (
                <LoadingState />
              ) : rejectedRows.length === 0 ? (
                <EmptyState icon={XCircle} title="No rejected leave records." description="Leave applications you reject will appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Leave Type</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Short/Long</TableHead>
                        <TableHead>Applied Date</TableHead>
                        <TableHead>Rejected Date</TableHead>
                        <TableHead>Rejected By</TableHead>
                        <TableHead>Approval Stage</TableHead>
                        <TableHead>Rejection Reason</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rejectedRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span>
                          </TableCell>
                          <TableCell>{row.leaveTypeName}</TableCell>
                          <TableCell className="text-xs">{formatDate(row.fromDate)}</TableCell>
                          <TableCell className="text-xs">{formatDate(row.toDate)}</TableCell>
                          <TableCell>{row.totalDays}</TableCell>
                          <TableCell><ShortLongBadge value={row.shortOrLong} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(row.appliedAt)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(row.actedAt)}</TableCell>
                          <TableCell className="text-xs">{row.approverName}</TableCell>
                          <TableCell className="text-xs">{historyStageLabel(row)}</TableCell>
                          <TableCell className="max-w-[16rem] truncate text-xs" title={row.remark ?? undefined}>{row.remark ?? "—"}</TableCell>
                          <TableCell><StatusBadge status={row.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(target && action)} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "rejected"
                ? "Reject Leave Application"
                : isLongApprove
                ? "Approve & Forward to Super Manager"
                : "Approve Leave Application"}
            </DialogTitle>
            <DialogDescription>
              {target ? `${target.employeeName} — ${target.leaveTypeName} — ${formatDate(target.fromDate)} to ${formatDate(target.toDate)} (${target.totalDays} day(s)).` : ""}
              {action === "approved" && isLongApprove ? " This is NOT a final decision — only the Super Manager's decision will be final." : ""}
              {action === "approved" && !isLongApprove ? " This is a final decision." : ""}
              {action === "rejected" ? " This is a final decision. The reserved leave balance will be released." : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Remark {action === "rejected" ? "(required)" : "(optional)"}</Label>
            <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={action === "rejected" ? "Reason for rejection." : "Optional comment."} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={closeDialog} disabled={decidePending.isPending}>Cancel</Button>
            <Button variant={action === "rejected" ? "destructive" : "default"} onClick={handleConfirm} disabled={decidePending.isPending}>
              {decidePending.isPending ? "Saving…" : action === "rejected" ? "Confirm Reject" : isLongApprove ? "Approve & Forward" : "Yes, Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// Staff self-view — the logged-in employee's OWN leave applications & approval
// status/history. Strictly self-scoped by leave_list_my_leave_history()
// (current_user_employee_id() server-side). NEVER shows another employee's
// leave, and NEVER has Approve/Reject buttons.
// ===========================================================================
function staffStageLabel(row: StaffLeaveHistoryRow): string {
  if (row.status === "manager_pending") return "Step 1 — Direct Manager";
  if (row.status === "super_manager_pending") return "Step 2 — Super Manager";
  return "Completed";
}

function StaffLeaveHistoryView() {
  const historyQuery = useMyLeaveHistory();
  const rows = historyQuery.data ?? [];

  const pending = rows.filter((r) => r.status === "manager_pending" || r.status === "super_manager_pending");
  const approved = rows.filter((r) => r.status === "approved");
  const rejected = rows.filter((r) => r.status === "rejected");

  const [activeTab, setActiveTab] = useState("pending");

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Approval" description="Track the approval status and history of your leave applications." />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <StaffHistoryTable
            loading={historyQuery.isLoading}
            rows={pending}
            emptyTitle="No pending leave applications."
            emptyDescription="Your leave applications that are awaiting a decision will appear here."
            variant="pending"
          />
        </TabsContent>
        <TabsContent value="approved">
          <StaffHistoryTable
            loading={historyQuery.isLoading}
            rows={approved}
            emptyTitle="No approved leave records."
            emptyDescription="Your approved leave applications will appear here."
            variant="approved"
          />
        </TabsContent>
        <TabsContent value="rejected">
          <StaffHistoryTable
            loading={historyQuery.isLoading}
            rows={rejected}
            emptyTitle="No rejected leave records."
            emptyDescription="Your rejected leave applications will appear here."
            variant="rejected"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StaffHistoryTable({
  loading,
  rows,
  emptyTitle,
  emptyDescription,
  variant,
}: {
  loading: boolean;
  rows: StaffLeaveHistoryRow[];
  emptyTitle: string;
  emptyDescription: string;
  variant: "pending" | "approved" | "rejected";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        {loading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={variant === "rejected" ? XCircle : CheckCircle2} title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Short/Long</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Applied Date</TableHead>
                  <TableHead>Approval Stage</TableHead>
                  {variant !== "pending" && <TableHead>{variant === "approved" ? "Approved By" : "Rejected By"}</TableHead>}
                  {variant !== "pending" && <TableHead>{variant === "approved" ? "Approved Date" : "Rejected Date"}</TableHead>}
                  {variant === "rejected" && <TableHead>Rejection Reason</TableHead>}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span>
                    </TableCell>
                    <TableCell>{row.leaveTypeName}</TableCell>
                    <TableCell className="text-xs">{formatDate(row.fromDate)}</TableCell>
                    <TableCell className="text-xs">{formatDate(row.toDate)}</TableCell>
                    <TableCell>{row.totalDays}{row.isHalfDay ? " (½)" : ""}</TableCell>
                    <TableCell><ShortLongBadge value={row.shortOrLong} /></TableCell>
                    <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground" title={row.reason ?? undefined}>{row.reason ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(row.appliedAt)}</TableCell>
                    <TableCell className="text-xs">{staffStageLabel(row)}</TableCell>
                    {variant !== "pending" && <TableCell className="text-xs">{row.decidedByName ?? "—"}</TableCell>}
                    {variant !== "pending" && <TableCell className="text-xs text-muted-foreground">{row.decidedAt ? formatDate(row.decidedAt) : "—"}</TableCell>}
                    {variant === "rejected" && (
                      <TableCell className="max-w-[16rem] truncate text-xs" title={row.decisionRemark ?? undefined}>{row.decisionRemark ?? "—"}</TableCell>
                    )}
                    <TableCell><StatusBadge status={row.status} /></TableCell>
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
