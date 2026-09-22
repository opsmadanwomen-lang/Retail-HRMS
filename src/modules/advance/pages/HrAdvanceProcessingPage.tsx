import { useMemo, useState } from "react";
import { CheckCircle2, PauseCircle, Undo2, ShieldAlert, Eye } from "lucide-react";

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
import {
  useAmIAdvanceHr,
  useAdvanceHrPending,
  useAdvanceHrHistory,
  useAdvanceHrProcessAction,
  useAdvanceHrHold,
  useAdvanceHrSendBack,
  useAdvanceHrResume,
  useAdvanceHrProcess,
  useAdvanceApprovalHistory,
  useAdvanceHrProcessActions,
  useAdvanceFinanceHistory,
  useAdvanceFinancePayment,
} from "@/hooks/useAdvance";
import { formatDate } from "@/lib/utils";
import {
  formatAmount,
  formatDateTime,
  ADVANCE_STATUS_LABEL,
  ADVANCE_STATUS_VARIANT,
  actionLabel,
  hrActionLabel,
  roleLabel,
} from "@/modules/advance/utils";
import { AdvanceReceiptSection, ReceiptStatusBadge } from "@/modules/advance/components/AdvanceReceiptSection";
import type { AdvanceHrPendingRow, AdvanceHrHistoryRow } from "@/types/advance";

type ActionKind = "process" | "hold" | "send_back";

/**
 * HR Advance Processing — Phase 2. HR IS NOT AN APPROVAL LEVEL: there is no Approve/Reject button
 * anywhere on this page. HR can only Process (-> Ready for Finance), Hold, or Send Back a request
 * that has ALREADY received Boss final approval — every one of those rules, and the fact that the
 * Boss Approved Amount can never be changed here, is enforced server-side by
 * advance_hr_process/_hold/_send_back(), not by this component.
 */
export function HrAdvanceProcessingPage() {
  const { user } = useAuth();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const myEmployeeId = currentEmployeeQuery.data?.id;
  const isSuperAdmin = user?.role === "super_admin";

  const amIHrQuery = useAmIAdvanceHr(myEmployeeId);
  const isHr = amIHrQuery.data === true;

  if (currentEmployeeQuery.isLoading || amIHrQuery.isLoading) return <LoadingState />;

  if (!isHr && !isSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="HR Advance Processing" description="Process, hold, or send back Boss-approved advance requests." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="You are not an active HR Processor." />
      </div>
    );
  }

  return <HrQueueView companyId={user?.companyId ?? undefined} canManageReceipts={isHr || isSuperAdmin} />;
}

function HrQueueView({ companyId, canManageReceipts }: { companyId?: string; canManageReceipts: boolean }) {
  const pendingQuery = useAdvanceHrPending();
  const historyQuery = useAdvanceHrHistory();
  // Receipt Management (migration 0160) also authorizes HR — but HR's own queue (above) never
  // reaches a Paid row (it stops at "finance_pending"). Reuse the SAME Finance history RPC
  // read-only here (HR is already permitted to read it per that RPC's own visibility policy) so
  // HR has a place to upload/replace a signed receipt for an advance they previously processed.
  const financeHistoryQuery = useAdvanceFinanceHistory();
  const paid = useMemo(() => (financeHistoryQuery.data ?? []).filter((r) => r.status === "paid"), [financeHistoryQuery.data]);
  const [paidDetailId, setPaidDetailId] = useState<string | null>(null);

  const pending = pendingQuery.data ?? [];
  const onHold = useMemo(() => (historyQuery.data ?? []).filter((r) => r.status === "hr_on_hold"), [historyQuery.data]);
  const sentBack = useMemo(() => (historyQuery.data ?? []).filter((r) => r.status === "hr_sent_back"), [historyQuery.data]);
  const processed = useMemo(() => (historyQuery.data ?? []).filter((r) => r.status === "finance_pending"), [historyQuery.data]);

  const [activeTab, setActiveTab] = useState("pending");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{ id: string; employeeName: string; requestedAmount: number; bossApprovedAmount: number | null } | null>(null);
  const [actionKind, setActionKind] = useState<ActionKind | null>(null);
  const [remarkOrReason, setRemarkOrReason] = useState("");

  const processMutation = useAdvanceHrProcessAction();
  const holdMutation = useAdvanceHrHold();
  const sendBackMutation = useAdvanceHrSendBack();
  const resumeMutation = useAdvanceHrResume();

  const openAction = (row: { id: string; employeeName: string; requestedAmount: number; bossApprovedAmount: number | null }, kind: ActionKind) => {
    setActionTarget(row);
    setActionKind(kind);
    setRemarkOrReason("");
  };
  const closeAction = () => {
    setActionTarget(null);
    setActionKind(null);
  };

  const submitAction = async () => {
    if (!actionTarget || !actionKind) return;
    if ((actionKind === "hold" || actionKind === "send_back") && !remarkOrReason.trim()) {
      toast({ title: `A reason is required to ${actionKind === "hold" ? "put this advance on hold" : "send this advance back"}.`, variant: "destructive" });
      return;
    }
    try {
      if (actionKind === "process") {
        await processMutation.mutateAsync({ requestId: actionTarget.id, remarks: remarkOrReason.trim() || undefined });
        toast({ title: "Advance processed — ready for Finance.", variant: "success" });
      } else if (actionKind === "hold") {
        await holdMutation.mutateAsync({ requestId: actionTarget.id, reason: remarkOrReason.trim() });
        toast({ title: "Advance put on hold.", variant: "success" });
      } else {
        await sendBackMutation.mutateAsync({ requestId: actionTarget.id, reason: remarkOrReason.trim() });
        toast({ title: "Advance sent back.", variant: "success" });
      }
      closeAction();
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const resume = async (id: string) => {
    try {
      await resumeMutation.mutateAsync({ requestId: id, remark: "Resumed by HR" });
      toast({ title: "Advance moved back to HR Pending.", variant: "success" });
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const isBusy = processMutation.isPending || holdMutation.isPending || sendBackMutation.isPending || resumeMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR Advance Processing"
        description="Process a Boss-approved advance request to make it ready for Finance, put it on hold, or send it back. HR does not approve or reject — the Boss Approved Amount is final and cannot be changed here."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="on_hold">On Hold ({onHold.length})</TabsTrigger>
          <TabsTrigger value="sent_back">Sent Back ({sentBack.length})</TabsTrigger>
          <TabsTrigger value="processed">Processed / Ready for Finance ({processed.length})</TabsTrigger>
          <TabsTrigger value="paid">Paid ({paid.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardContent className="pt-6">
              {pendingQuery.isLoading ? (
                <LoadingState />
              ) : pending.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No Boss-approved requests awaiting HR processing." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Requested</TableHead>
                        <TableHead>Mgr Recommended</TableHead><TableHead>Boss Approved</TableHead>
                        <TableHead>Requested On</TableHead><TableHead>Approval Completed</TableHead>
                        <TableHead>Status</TableHead><TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pending.map((row: AdvanceHrPendingRow) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span></TableCell>
                          <TableCell>{row.advanceTypeName}</TableCell>
                          <TableCell>{formatAmount(row.requestedAmount)}</TableCell>
                          <TableCell className="text-xs">{formatAmount(row.managerRecommendedAmount)}</TableCell>
                          <TableCell className="font-medium">{formatAmount(row.bossApprovedAmount)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(row.requestedAt)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{row.approvalCompletedAt ? formatDate(row.approvalCompletedAt) : "—"}</TableCell>
                          <TableCell><Badge variant={ADVANCE_STATUS_VARIANT[row.status]}>{ADVANCE_STATUS_LABEL[row.status]}</Badge></TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="ghost" onClick={() => setDetailId(row.id)}><Eye className="mr-1 h-4 w-4" /> View</Button>
                              <Button size="sm" onClick={() => openAction(row, "process")}>Process</Button>
                              <Button size="sm" variant="secondary" onClick={() => openAction(row, "hold")}><PauseCircle className="mr-1 h-4 w-4" /> Hold</Button>
                              <Button size="sm" variant="destructive" onClick={() => openAction(row, "send_back")}><Undo2 className="mr-1 h-4 w-4" /> Send Back</Button>
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

        <HistoryTab title="On Hold" rows={onHold} loading={historyQuery.isLoading} reasonKey="holdReason" emptyIcon={PauseCircle}
          onView={setDetailId} onResume={resume} resumeLabel="Resume to HR Pending" busy={isBusy} />
        <HistoryTab title="Sent Back" rows={sentBack} loading={historyQuery.isLoading} reasonKey="sendBackReason" emptyIcon={Undo2}
          onView={setDetailId} onResume={resume} resumeLabel="Resume to HR Pending" busy={isBusy} />
        <HistoryTab title="Processed" rows={processed} loading={historyQuery.isLoading} reasonKey={null} emptyIcon={CheckCircle2}
          onView={setDetailId} busy={isBusy} />

        <TabsContent value="paid">
          <Card>
            <CardContent className="pt-6">
              {financeHistoryQuery.isLoading ? (
                <LoadingState />
              ) : paid.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No paid advances yet." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Boss Approved</TableHead>
                        <TableHead>Paid</TableHead><TableHead>Payment Date</TableHead><TableHead>Receipt</TableHead><TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paid.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span></TableCell>
                          <TableCell>{row.advanceTypeName}</TableCell>
                          <TableCell className="font-medium">{formatAmount(row.bossApprovedAmount)}</TableCell>
                          <TableCell className="font-medium text-emerald-700">{formatAmount(row.paymentAmount)}</TableCell>
                          <TableCell className="text-xs">{row.paymentDate ? formatDate(row.paymentDate) : "—"}</TableCell>
                          <TableCell><ReceiptStatusBadge advanceRequestId={row.id} /></TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => setPaidDetailId(row.id)}><Eye className="mr-1 h-4 w-4" /> View / Receipt</Button>
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
      </Tabs>

      {/* Action confirmation dialog */}
      <Dialog open={Boolean(actionTarget && actionKind)} onOpenChange={(open) => !open && closeAction()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionKind === "process" ? "Process Advance" : actionKind === "hold" ? "Put On Hold" : "Send Back"}
            </DialogTitle>
            <DialogDescription>
              {actionTarget
                ? actionKind === "process"
                  ? `Are you sure you want to process this advance for ${formatAmount(actionTarget.bossApprovedAmount)}?`
                  : `${actionTarget.employeeName} — requested ${formatAmount(actionTarget.requestedAmount)}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {actionTarget && actionKind === "process" && (
            <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Requested</p><p className="font-medium">{formatAmount(actionTarget.requestedAmount)}</p></div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Amount to be processed for Finance = Boss Approved Amount</p>
                <p className="font-medium text-emerald-700">{formatAmount(actionTarget.bossApprovedAmount)}</p>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{actionKind === "process" ? "Remarks (optional)" : "Reason (required)"}</Label>
            <Textarea
              value={remarkOrReason}
              onChange={(e) => setRemarkOrReason(e.target.value)}
              placeholder={
                actionKind === "process"
                  ? "Optional processing note."
                  : actionKind === "hold"
                  ? "e.g. Supporting document requires verification."
                  : "e.g. Please upload the required medical document."
              }
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={closeAction} disabled={isBusy}>Cancel</Button>
            <Button variant={actionKind === "send_back" ? "destructive" : "default"} onClick={submitAction} disabled={isBusy}>
              {isBusy ? "Saving…" : actionKind === "process" ? "Confirm Process" : actionKind === "hold" ? "Confirm Hold" : "Confirm Send Back"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HrDetailDialog requestId={detailId} onClose={() => setDetailId(null)} />
      <HrPaidDetailDialog requestId={paidDetailId} companyId={companyId} canManageReceipts={canManageReceipts} onClose={() => setPaidDetailId(null)} />
    </div>
  );
}

/** Read-only Paid detail + Signed Staff Receipt management for HR — reuses the Finance payment
 *  detail RPC (already authorizes HR per its own visibility policy) instead of a parallel one. */
function HrPaidDetailDialog({
  requestId,
  companyId,
  canManageReceipts,
  onClose,
}: {
  requestId: string | null;
  companyId?: string;
  canManageReceipts: boolean;
  onClose: () => void;
}) {
  const detailQuery = useAdvanceFinancePayment(requestId ?? undefined);
  const d = detailQuery.data ?? null;

  return (
    <Dialog open={Boolean(requestId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Advance Payment Details</DialogTitle>
          <DialogDescription>No salary information is shown. Boss Approved Amount is the maximum payable.</DialogDescription>
        </DialogHeader>
        {detailQuery.isLoading || !d ? (
          <LoadingState rows={4} />
        ) : (
          <div className="space-y-5">
            <section className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee">{d.employeeName} {d.employeeCode ? `(${d.employeeCode})` : ""}</Field>
              <Field label="Advance Type">{d.advanceTypeName}</Field>
            </section>
            <section className="grid grid-cols-4 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Requested</p><p className="font-medium">{formatAmount(d.requestedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Mgr Recommended</p><p className="font-medium">{formatAmount(d.managerRecommendedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Boss Approved</p><p className="font-medium">{formatAmount(d.bossApprovedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Actual Paid</p><p className="font-medium text-emerald-700">{formatAmount(d.paymentAmount)}</p></div>
            </section>
            {requestId && <AdvanceReceiptSection advanceRequestId={requestId} companyId={companyId} canManage={canManageReceipts} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HistoryTab({
  title,
  rows,
  loading,
  reasonKey,
  emptyIcon: EmptyIcon,
  onView,
  onResume,
  resumeLabel,
  busy,
}: {
  title: string;
  rows: AdvanceHrHistoryRow[];
  loading: boolean;
  reasonKey: "holdReason" | "sendBackReason" | null;
  emptyIcon: typeof CheckCircle2;
  onView: (id: string) => void;
  onResume?: (id: string) => void;
  resumeLabel?: string;
  busy?: boolean;
}) {
  const tabValue = title === "On Hold" ? "on_hold" : title === "Sent Back" ? "sent_back" : "processed";
  return (
    <TabsContent value={tabValue}>
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <LoadingState />
          ) : rows.length === 0 ? (
            <EmptyState icon={EmptyIcon} title={`No ${title.toLowerCase()} advances.`} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Requested</TableHead>
                    <TableHead>Boss Approved</TableHead>
                    {reasonKey && <TableHead>Reason</TableHead>}
                    <TableHead>{title === "Processed" ? "Processed On" : "Since"}</TableHead>
                    <TableHead>Status</TableHead><TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span></TableCell>
                      <TableCell>{row.advanceTypeName}</TableCell>
                      <TableCell>{formatAmount(row.requestedAmount)}</TableCell>
                      <TableCell className="font-medium">{formatAmount(row.bossApprovedAmount)}</TableCell>
                      {reasonKey && <TableCell className="max-w-[16rem] truncate text-xs" title={row[reasonKey] ?? undefined}>{row[reasonKey] ?? "—"}</TableCell>}
                      <TableCell className="text-xs text-muted-foreground">{row.processedAt ? formatDate(row.processedAt) : "—"}</TableCell>
                      <TableCell><Badge variant={ADVANCE_STATUS_VARIANT[row.status]}>{ADVANCE_STATUS_LABEL[row.status]}</Badge></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="ghost" onClick={() => onView(row.id)}><Eye className="mr-1 h-4 w-4" /> View</Button>
                          {onResume && (
                            <Button size="sm" variant="secondary" onClick={() => onResume(row.id)} disabled={busy}>{resumeLabel}</Button>
                          )}
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
  );
}

function HrDetailDialog({ requestId, onClose }: { requestId: string | null; onClose: () => void }) {
  const detailQuery = useAdvanceHrProcess(requestId ?? undefined);
  const approvalHistoryQuery = useAdvanceApprovalHistory(requestId ?? undefined);
  const hrHistoryQuery = useAdvanceHrProcessActions(requestId ?? undefined);
  const d = detailQuery.data ?? null;

  return (
    <Dialog open={Boolean(requestId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Advance Details</DialogTitle>
          <DialogDescription>Everything needed to process this request — no salary information is shown.</DialogDescription>
        </DialogHeader>
        {detailQuery.isLoading || !d ? (
          <LoadingState rows={5} />
        ) : (
          <div className="space-y-5">
            <section className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee">{d.employeeName} {d.employeeCode ? `(${d.employeeCode})` : ""}</Field>
              <Field label="Advance Type">{d.advanceTypeName}</Field>
              <Field label="Policy">{d.policyName} (v{d.policyVersion})</Field>
              <Field label="Requested On">{formatDate(d.requestedAt)}</Field>
              <Field label="Approval Completed">{d.approvalCompletedAt ? formatDate(d.approvalCompletedAt) : "—"}</Field>
              <Field label="Supporting Documents">{d.documentCount} file(s)</Field>
            </section>

            <section className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Requested</p><p className="font-medium">{formatAmount(d.requestedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Manager Recommended</p><p className="font-medium">{formatAmount(d.managerRecommendedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Boss Approved (final)</p><p className="font-medium text-emerald-700">{formatAmount(d.bossApprovedAmount)}</p></div>
            </section>

            <section>
              <p className="text-xs font-medium text-muted-foreground">Reason</p>
              <p className="text-sm">{d.reason}</p>
              {d.remarks && (<><p className="mt-2 text-xs font-medium text-muted-foreground">Employee Remarks</p><p className="text-sm">{d.remarks}</p></>)}
            </section>

            {(d.holdReason || d.sendBackReason) && (
              <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">{d.hrStatus === "sent_back" ? "Currently Sent Back" : "Currently On Hold"}</p>
                <p>{d.sendBackReason || d.holdReason}</p>
              </section>
            )}

            <section>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Manager / Boss Approval History</p>
              {approvalHistoryQuery.isLoading ? (
                <LoadingState rows={2} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>When</TableHead><TableHead>By</TableHead><TableHead>Role</TableHead><TableHead>Action</TableHead><TableHead>Amount</TableHead><TableHead>Remark</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(approvalHistoryQuery.data ?? []).map((h, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs text-muted-foreground">{formatDateTime(h.actedAt)}</TableCell>
                          <TableCell className="text-xs">{h.actorName}</TableCell>
                          <TableCell className="text-xs">{roleLabel(h.actorRole)}</TableCell>
                          <TableCell className="text-xs">{actionLabel(h.action)}</TableCell>
                          <TableCell className="text-xs">{h.newAmount != null ? formatAmount(h.newAmount) : "—"}</TableCell>
                          <TableCell className="max-w-[12rem] truncate text-xs" title={h.remark ?? undefined}>{h.remark ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {(hrHistoryQuery.data ?? []).length > 0 && (
              <section>
                <p className="mb-1 text-xs font-medium text-muted-foreground">HR Processing History</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>When</TableHead><TableHead>By</TableHead><TableHead>Action</TableHead><TableHead>Remark</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(hrHistoryQuery.data ?? []).map((h, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs text-muted-foreground">{formatDateTime(h.actedAt)}</TableCell>
                          <TableCell className="text-xs">{h.actorName}</TableCell>
                          <TableCell className="text-xs">{hrActionLabel(h.action)}</TableCell>
                          <TableCell className="max-w-[16rem] truncate text-xs" title={h.remark ?? undefined}>{h.remark ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{children}</p>
    </div>
  );
}
