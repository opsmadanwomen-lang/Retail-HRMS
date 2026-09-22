import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Banknote, CheckCircle2, XCircle, History, Plus } from "lucide-react";

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
import {
  useMyAdvanceRequests,
  useCancelAdvance,
  useAdvanceApprovalHistory,
  useAdvanceHrProcessActions,
  useAdvanceFinancePaymentActions,
  useMyAdvanceRecoveries,
  useAdvanceRecoveryInstallments,
  useAdvanceRecoveryTransactions,
} from "@/hooks/useAdvance";
import { formatDate } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";
import {
  formatAmount,
  formatDateTime,
  ADVANCE_STATUS_LABEL,
  ADVANCE_STATUS_VARIANT,
  advanceStageLabel,
  actionLabel,
  roleLabel,
  hrActionLabel,
  financeActionLabel,
  isBossApprovedFamily,
} from "@/modules/advance/utils";
import type { MyAdvanceRequest } from "@/types/advance";

const CANCELLABLE = new Set(["manager_pending", "boss_pending", "sent_back"]);

function StatusBadge({ status }: { status: MyAdvanceRequest["status"] }) {
  return <Badge variant={ADVANCE_STATUS_VARIANT[status]}>{ADVANCE_STATUS_LABEL[status]}</Badge>;
}

/**
 * Staff Panel — My Advances. Strictly self-scoped by advance_list_my_requests()
 * (current_user_employee_id() server-side; no client-supplied id). Nothing is ever removed —
 * a request just moves between the Pending / Approved / Rejected / Cancelled tabs, and full
 * history is retained. The immutable approval trail is shown per request.
 */
export function StaffMyAdvancesPage() {
  const navigate = useNavigate();
  const requestsQuery = useMyAdvanceRequests();
  const cancelMutation = useCancelAdvance();
  const rows = requestsQuery.data ?? [];

  const pending = useMemo(() => rows.filter((r) => r.status === "manager_pending" || r.status === "boss_pending" || r.status === "sent_back"), [rows]);
  // "Approved / In Progress" groups every status from the Boss's final decision onward that is still
  // moving toward payment (HR + Finance stages); the terminal `paid` gets its own tab. The per-row
  // badge/stage always shows exactly where it currently stands.
  const approved = useMemo(() => rows.filter((r) => isBossApprovedFamily(r.status)), [rows]);
  const paid = useMemo(() => rows.filter((r) => r.status === "paid"), [rows]);
  const recovering = useMemo(() => rows.filter((r) => r.status === "recovery_pending" || r.status === "recovering"), [rows]);
  const settled = useMemo(() => rows.filter((r) => r.status === "settled"), [rows]);
  const closed = useMemo(() => rows.filter((r) => r.status === "closed"), [rows]);
  const rejected = useMemo(() => rows.filter((r) => r.status === "rejected"), [rows]);
  const cancelled = useMemo(() => rows.filter((r) => r.status === "cancelled"), [rows]);

  const [activeTab, setActiveTab] = useState("pending");
  const [cancelTarget, setCancelTarget] = useState<MyAdvanceRequest | null>(null);
  const [cancelRemark, setCancelRemark] = useState("");
  const [historyTarget, setHistoryTarget] = useState<MyAdvanceRequest | null>(null);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync({ requestId: cancelTarget.id, remark: cancelRemark.trim() || undefined });
      toast({ title: "Advance request cancelled.", variant: "success" });
      setCancelTarget(null);
      setCancelRemark("");
    } catch (error) {
      toast({ title: "Cancel failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Advances"
        description="The status and full history of every advance you have requested."
        actions={
          <Button onClick={() => navigate(ROUTES.advanceRequest)}>
            <Plus className="mr-1 h-4 w-4" /> Request Advance
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved / In Progress ({approved.length})</TabsTrigger>
          <TabsTrigger value="paid">Paid ({paid.length})</TabsTrigger>
          <TabsTrigger value="recovering">Recovering ({recovering.length})</TabsTrigger>
          <TabsTrigger value="settled">Settled ({settled.length})</TabsTrigger>
          <TabsTrigger value="closed">Closed ({closed.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled ({cancelled.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <RequestTable
            loading={requestsQuery.isLoading}
            rows={pending}
            variant="pending"
            emptyTitle="No pending advances."
            emptyDescription="Advance requests awaiting a decision will appear here."
            onCancel={(r) => setCancelTarget(r)}
            onHistory={(r) => setHistoryTarget(r)}
          />
        </TabsContent>
        <TabsContent value="approved">
          <RequestTable
            loading={requestsQuery.isLoading}
            rows={approved}
            variant="approved"
            emptyTitle="No approved advances."
            emptyDescription="Your approved advances will appear here."
            onCancel={(r) => setCancelTarget(r)}
            onHistory={(r) => setHistoryTarget(r)}
          />
        </TabsContent>
        <TabsContent value="paid">
          <RequestTable
            loading={requestsQuery.isLoading}
            rows={paid}
            variant="paid"
            emptyTitle="No paid advances yet."
            emptyDescription="Once Finance records a payment, the advance appears here with the actual paid amount."
            onCancel={() => {}}
            onHistory={(r) => setHistoryTarget(r)}
          />
        </TabsContent>
        <TabsContent value="recovering">
          <RequestTable
            loading={requestsQuery.isLoading}
            rows={recovering}
            variant="recovering"
            emptyTitle="No advances in recovery."
            emptyDescription="Once a recovery schedule is set up, your advance appears here with the outstanding balance."
            onCancel={() => {}}
            onHistory={(r) => setHistoryTarget(r)}
          />
        </TabsContent>
        <TabsContent value="settled">
          <RequestTable
            loading={requestsQuery.isLoading}
            rows={settled}
            variant="closed"
            emptyTitle="No settled advances."
            emptyDescription="Advances cleared through an early settlement appear here."
            onCancel={() => {}}
            onHistory={(r) => setHistoryTarget(r)}
          />
        </TabsContent>
        <TabsContent value="closed">
          <RequestTable
            loading={requestsQuery.isLoading}
            rows={closed}
            variant="closed"
            emptyTitle="No closed advances."
            emptyDescription="Fully recovered or settled advances appear here."
            onCancel={() => {}}
            onHistory={(r) => setHistoryTarget(r)}
          />
        </TabsContent>
        <TabsContent value="rejected">
          <RequestTable
            loading={requestsQuery.isLoading}
            rows={rejected}
            variant="rejected"
            emptyTitle="No rejected advances."
            emptyDescription="Your rejected advances will appear here."
            onCancel={() => {}}
            onHistory={(r) => setHistoryTarget(r)}
          />
        </TabsContent>
        <TabsContent value="cancelled">
          <RequestTable
            loading={requestsQuery.isLoading}
            rows={cancelled}
            variant="cancelled"
            emptyTitle="No cancelled advances."
            emptyDescription="Advances you cancel will appear here."
            onCancel={() => {}}
            onHistory={(r) => setHistoryTarget(r)}
          />
        </TabsContent>
      </Tabs>

      {/* Cancel dialog */}
      <Dialog open={Boolean(cancelTarget)} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Advance Request</DialogTitle>
            <DialogDescription>
              {cancelTarget
                ? `${cancelTarget.advanceTypeName} — ${formatAmount(cancelTarget.requestedAmount)} requested on ${formatDate(cancelTarget.requestedAt)}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Remark (optional)</Label>
            <Textarea value={cancelRemark} onChange={(e) => setCancelRemark(e.target.value)} placeholder="Why are you cancelling?" />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelTarget(null)} disabled={cancelMutation.isPending}>
              Keep Request
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling…" : "Confirm Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval history dialog */}
      <ApprovalHistoryDialog request={historyTarget} onClose={() => setHistoryTarget(null)} />
    </div>
  );
}

function RequestTable({
  loading,
  rows,
  variant,
  emptyTitle,
  emptyDescription,
  onCancel,
  onHistory,
}: {
  loading: boolean;
  rows: MyAdvanceRequest[];
  variant: "pending" | "approved" | "paid" | "recovering" | "rejected" | "cancelled" | "closed";
  emptyTitle: string;
  emptyDescription: string;
  onCancel: (r: MyAdvanceRequest) => void;
  onHistory: (r: MyAdvanceRequest) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        {loading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={variant === "rejected" ? XCircle : variant === "approved" ? CheckCircle2 : Banknote} title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Mgr Recommended</TableHead>
                  <TableHead>Boss Approved</TableHead>
                  {variant !== "pending" && variant !== "rejected" && variant !== "cancelled" && <TableHead>Actual Paid</TableHead>}
                  <TableHead>Reason</TableHead>
                  <TableHead>Requested On</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  {variant === "paid" && <TableHead>Payment Date</TableHead>}
                  {variant !== "pending" && variant !== "paid" && <TableHead>Decided On</TableHead>}
                  {(variant === "rejected" || variant === "cancelled") && <TableHead>Remark</TableHead>}
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.advanceTypeName}</TableCell>
                    <TableCell>{formatAmount(r.requestedAmount)}</TableCell>
                    <TableCell className="text-xs">{formatAmount(r.managerRecommendedAmount)}</TableCell>
                    <TableCell className="text-xs">{formatAmount(r.bossApprovedAmount)}</TableCell>
                    {variant !== "pending" && variant !== "rejected" && variant !== "cancelled" && (
                      <TableCell className="text-xs font-medium text-emerald-700">{r.paidAmount != null ? formatAmount(r.paidAmount) : "—"}</TableCell>
                    )}
                    <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground" title={r.reason}>{r.reason}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(r.requestedAt)}</TableCell>
                    <TableCell className="text-xs">{advanceStageLabel(r.status, r.currentStep)}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    {variant === "paid" && <TableCell className="text-xs text-muted-foreground">{r.paymentDate ? formatDate(r.paymentDate) : "—"}</TableCell>}
                    {variant !== "pending" && variant !== "paid" && <TableCell className="text-xs text-muted-foreground">{r.decidedAt ? formatDate(r.decidedAt) : "—"}</TableCell>}
                    {(variant === "rejected" || variant === "cancelled") && (
                      <TableCell className="max-w-[16rem] truncate text-xs" title={r.decisionRemark ?? undefined}>{r.decisionRemark ?? "—"}</TableCell>
                    )}
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => onHistory(r)}>
                          <History className="mr-1 h-4 w-4" /> History
                        </Button>
                        {CANCELLABLE.has(r.status) && (
                          <Button size="sm" variant="destructive" onClick={() => onCancel(r)}>
                            Cancel
                          </Button>
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
  );
}

export function ApprovalHistoryDialog({ request, onClose }: { request: MyAdvanceRequest | null; onClose: () => void }) {
  const historyQuery = useAdvanceApprovalHistory(request?.id);
  const hrHistoryQuery = useAdvanceHrProcessActions(request?.id);
  const financeHistoryQuery = useAdvanceFinancePaymentActions(request?.id);
  const recoveriesQuery = useMyAdvanceRecoveries();
  const isRecoveryStage = request != null && ["recovery_pending", "recovering", "settled", "closed"].includes(request.status);
  const recoveryInstQuery = useAdvanceRecoveryInstallments(isRecoveryStage ? request?.id : undefined);
  const recoveryTxnQuery = useAdvanceRecoveryTransactions(isRecoveryStage ? request?.id : undefined);
  const recovery = (recoveriesQuery.data ?? []).find((x) => x.advanceRequestId === request?.id) ?? null;
  const rows = historyQuery.data ?? [];
  const hrRows = hrHistoryQuery.data ?? [];
  const financeRows = financeHistoryQuery.data ?? [];
  const isHrSentBack = request?.status === "hr_sent_back";
  const isHrOnHold = request?.status === "hr_on_hold";
  const isFinanceOnHold = request?.status === "finance_on_hold";
  const isPaid = request?.status === "paid";

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Approval &amp; Processing History</DialogTitle>
          <DialogDescription>
            {request ? `${request.advanceTypeName} — requested ${formatAmount(request.requestedAmount)} on ${formatDate(request.requestedAt)}.` : ""}
          </DialogDescription>
        </DialogHeader>
        {request && (
          <div className="mb-3 grid grid-cols-4 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Requested (immutable)</p>
              <p className="font-medium">{formatAmount(request.requestedAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Manager Recommended</p>
              <p className="font-medium">{formatAmount(request.managerRecommendedAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Boss Approved</p>
              <p className="font-medium">{formatAmount(request.bossApprovedAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Actual Paid</p>
              <p className="font-medium text-emerald-700">{isPaid ? formatAmount(request.paidAmount) : "—"}</p>
            </div>
            {request.bossModificationReason && (
              <div className="col-span-4">
                <p className="text-xs text-muted-foreground">Boss modification reason</p>
                <p>{request.bossModificationReason}</p>
              </div>
            )}
            {isPaid && (
              <div className="col-span-4 rounded bg-emerald-50 px-2 py-1 text-emerald-800">
                Paid {formatAmount(request.paidAmount)}
                {request.paymentDate ? ` on ${formatDate(request.paymentDate)}` : ""}
                {request.paymentModeLabel ? ` via ${request.paymentModeLabel}` : ""}.
              </div>
            )}
          </div>
        )}

        {/* Current HR / Finance Sent Back / On Hold reason — only while the request is actually in
            that state (the reason is retained forever in the history tables below regardless). */}
        {(isHrSentBack || isHrOnHold) && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{isHrSentBack ? "HR Sent Back" : "HR On Hold"}</p>
            <p>Reason: {(isHrSentBack ? hrRows.find((h) => h.action === "sent_back") : hrRows.find((h) => h.action === "on_hold"))?.remark ?? "—"}</p>
          </div>
        )}
        {isFinanceOnHold && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Finance On Hold</p>
            <p>Reason: {financeRows.find((h) => h.action === "on_hold")?.remark ?? "—"}</p>
          </div>
        )}

        {historyQuery.isLoading ? (
          <LoadingState rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState icon={History} title="No approval actions yet." />
        ) : (
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Manager / Boss Approval History</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>From → To</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((h, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(h.actedAt)}</TableCell>
                    <TableCell className="text-xs">{h.actorName}</TableCell>
                    <TableCell className="text-xs">{roleLabel(h.actorRole)}</TableCell>
                    <TableCell className="text-xs">{actionLabel(h.action)}</TableCell>
                    <TableCell className="text-xs">
                      {h.oldAmount != null || h.newAmount != null ? `${formatAmount(h.oldAmount)} → ${formatAmount(h.newAmount)}` : "—"}
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate text-xs" title={h.remark ?? undefined}>{h.remark ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {hrRows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-muted-foreground">HR Processing History</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hrRows.map((h, i) => (
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
        )}

        {financeRows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Finance History</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {financeRows.map((h, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(h.actedAt)}</TableCell>
                    <TableCell className="text-xs">{h.actorName}</TableCell>
                    <TableCell className="text-xs">{financeActionLabel(h.action)}</TableCell>
                    <TableCell className="text-xs">{h.newPaymentAmount != null ? formatAmount(h.newPaymentAmount) : "—"}</TableCell>
                    <TableCell className="max-w-[16rem] truncate text-xs" title={h.remark ?? undefined}>{h.remark ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {recovery && (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Recovery Summary</p>
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Actual Paid</p><p className="font-medium">{formatAmount(recovery.actualPaidAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Total Recovered</p><p className="font-medium">{formatAmount(recovery.totalRecovered + recovery.totalSettled)}</p></div>
              <div><p className="text-xs text-muted-foreground">Outstanding</p><p className="font-medium text-amber-700">{formatAmount(recovery.outstandingAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Monthly Deduction</p><p className="font-medium">{formatAmount(recovery.monthlyAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Installments</p><p className="font-medium">{recovery.totalInstallments}</p></div>
              <div><p className="text-xs text-muted-foreground">Completed</p><p className="font-medium">{recovery.completedInstallments}</p></div>
              <div><p className="text-xs text-muted-foreground">Remaining</p><p className="font-medium">{Math.max(recovery.totalInstallments - recovery.completedInstallments, 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">Next Recovery</p><p className="font-medium">{recovery.nextDueMonth ? formatDate(recovery.nextDueMonth) : "—"}</p></div>
            </div>

            {(recoveryInstQuery.data ?? []).length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Installment Schedule</p>
                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Due</TableHead><TableHead>Scheduled</TableHead><TableHead>Deducted</TableHead><TableHead>Outstanding After</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(recoveryInstQuery.data ?? []).map((i) => (
                      <TableRow key={i.installmentNumber}>
                        <TableCell className="text-xs">{i.installmentNumber}</TableCell>
                        <TableCell className="text-xs">{formatDate(i.dueMonth)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(i.scheduledAmount)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(i.recoveredAmount)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(i.outstandingAfter)}</TableCell>
                        <TableCell className="text-xs capitalize">{i.status.replace("_", " ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {(recoveryTxnQuery.data ?? []).length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Payroll Recovery &amp; Settlement History</p>
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Kind</TableHead><TableHead>Period</TableHead><TableHead>Amount</TableHead><TableHead>Outstanding</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(recoveryTxnQuery.data ?? []).map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(t.actedAt)}</TableCell>
                        <TableCell className="text-xs capitalize">{t.kind}</TableCell>
                        <TableCell className="text-xs">{t.periodMonth ? formatDate(t.periodMonth) : "—"}</TableCell>
                        <TableCell className="text-xs font-medium">{formatAmount(t.amount)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(t.openingOutstanding)} → {formatAmount(t.closingOutstanding)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
