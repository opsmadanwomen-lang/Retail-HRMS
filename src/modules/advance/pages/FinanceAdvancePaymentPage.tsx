import { useMemo, useState } from "react";
import { CheckCircle2, PauseCircle, ShieldAlert, Eye, Play, Wallet, ExternalLink } from "lucide-react";

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
  useAmIAdvanceFinance,
  useAdvanceFinancePending,
  useAdvanceFinanceHistory,
  useAdvanceFinancePayment,
  useAdvanceFinancePaymentActions,
  useAdvanceFinanceStart,
  useAdvanceFinanceHold,
  useAdvanceFinanceResume,
  useAdvancePaymentModes,
  useAdvanceApprovalHistory,
  useAdvanceHrProcessActions,
} from "@/hooks/useAdvance";
import { advanceService } from "@/services/advanceService";
import { formatDate } from "@/lib/utils";
import {
  formatAmount,
  formatDateTime,
  ADVANCE_STATUS_LABEL,
  ADVANCE_STATUS_VARIANT,
  actionLabel,
  hrActionLabel,
  financeActionLabel,
  roleLabel,
} from "@/modules/advance/utils";
import { AdvanceReceiptSection, ReceiptStatusBadge } from "@/modules/advance/components/AdvanceReceiptSection";
import { AdvancePaymentDialog } from "@/modules/advance/components/AdvancePaymentDialog";
import type { AdvanceFinancePendingRow, AdvanceFinanceHistoryRow } from "@/types/advance";

/**
 * Finance Advance Payment — Phase 3. Finance is NOT an approval level: no Approve/Reject anywhere.
 * Finance can Start Processing, record the actual Payment, or put it On Hold. The Boss Approved
 * Amount is the maximum payable and can never be changed here; a lower amount is allowed only when
 * the applicable policy's allow_partial_payment flag is true — all enforced server-side by
 * advance_finance_start / _pay / _hold / _resume().
 */
export function FinanceAdvancePaymentPage() {
  const { user } = useAuth();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const myEmployeeId = currentEmployeeQuery.data?.id;
  const isSuperAdmin = user?.role === "super_admin";
  const amIFinanceQuery = useAmIAdvanceFinance(myEmployeeId);
  const isFinance = amIFinanceQuery.data === true;

  if (currentEmployeeQuery.isLoading || amIFinanceQuery.isLoading) return <LoadingState />;

  if (!isFinance && !isSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Finance Advance Payment" description="Record advance disbursements for HR-processed requests." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="You are not an active Finance Processor." />
      </div>
    );
  }

  return <FinanceQueueView companyId={user?.companyId ?? undefined} canManageReceipts={isFinance || isSuperAdmin} />;
}

function FinanceQueueView({ companyId, canManageReceipts }: { companyId?: string; canManageReceipts: boolean }) {
  const pendingQuery = useAdvanceFinancePending();
  const historyQuery = useAdvanceFinanceHistory();
  const modesQuery = useAdvancePaymentModes(companyId, true);

  const pending = pendingQuery.data ?? [];
  const processing = useMemo(() => (historyQuery.data ?? []).filter((r) => r.status === "finance_processing"), [historyQuery.data]);
  const onHold = useMemo(() => (historyQuery.data ?? []).filter((r) => r.status === "finance_on_hold"), [historyQuery.data]);
  const paid = useMemo(() => (historyQuery.data ?? []).filter((r) => r.status === "paid"), [historyQuery.data]);

  const [activeTab, setActiveTab] = useState("pending");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [startTarget, setStartTarget] = useState<{ id: string; employeeName: string } | null>(null);
  const [holdTarget, setHoldTarget] = useState<{ id: string; employeeName: string } | null>(null);
  const [payTarget, setPayTarget] = useState<AdvanceFinanceHistoryRow | null>(null);
  const [holdReason, setHoldReason] = useState("");

  const startMutation = useAdvanceFinanceStart();
  const holdMutation = useAdvanceFinanceHold();
  const resumeMutation = useAdvanceFinanceResume();

  const doStart = async () => {
    if (!startTarget) return;
    try {
      await startMutation.mutateAsync(startTarget.id);
      toast({ title: "Finance processing started.", variant: "success" });
      setStartTarget(null);
      setActiveTab("processing");
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const doHold = async () => {
    if (!holdTarget) return;
    if (!holdReason.trim()) {
      toast({ title: "A reason is required to put a payment on hold.", variant: "destructive" });
      return;
    }
    try {
      await holdMutation.mutateAsync({ requestId: holdTarget.id, reason: holdReason.trim() });
      toast({ title: "Payment put on hold.", variant: "success" });
      setHoldTarget(null);
      setHoldReason("");
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const doResume = async (id: string) => {
    try {
      await resumeMutation.mutateAsync({ requestId: id, remark: "Resumed by Finance" });
      toast({ title: "Payment resumed — back in processing.", variant: "success" });
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const isBusy = startMutation.isPending || holdMutation.isPending || resumeMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance Advance Payment"
        description="Start processing an HR-processed advance, record the actual payment/disbursement, or put it on hold. Finance never re-approves — the Boss Approved Amount is the maximum payable."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="processing">Processing ({processing.length})</TabsTrigger>
          <TabsTrigger value="on_hold">On Hold ({onHold.length})</TabsTrigger>
          <TabsTrigger value="paid">Paid / History ({paid.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardContent className="pt-6">
              {pendingQuery.isLoading ? (
                <LoadingState />
              ) : pending.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No HR-processed advances awaiting payment." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Requested</TableHead>
                        <TableHead>Mgr Recommended</TableHead><TableHead>Boss Approved</TableHead>
                        <TableHead>HR Processed On</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pending.map((row: AdvanceFinancePendingRow) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span></TableCell>
                          <TableCell>{row.advanceTypeName}</TableCell>
                          <TableCell>{formatAmount(row.requestedAmount)}</TableCell>
                          <TableCell className="text-xs">{formatAmount(row.managerRecommendedAmount)}</TableCell>
                          <TableCell className="font-medium">{formatAmount(row.bossApprovedAmount)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{row.hrProcessedAt ? formatDate(row.hrProcessedAt) : "—"}</TableCell>
                          <TableCell><Badge variant={ADVANCE_STATUS_VARIANT[row.status]}>{ADVANCE_STATUS_LABEL[row.status]}</Badge></TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="ghost" onClick={() => setDetailId(row.id)}><Eye className="mr-1 h-4 w-4" /> View</Button>
                              <Button size="sm" onClick={() => setStartTarget({ id: row.id, employeeName: row.employeeName })}><Play className="mr-1 h-4 w-4" /> Start Processing</Button>
                              <Button size="sm" variant="secondary" onClick={() => setHoldTarget({ id: row.id, employeeName: row.employeeName })}><PauseCircle className="mr-1 h-4 w-4" /> Hold</Button>
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

        <TabsContent value="processing">
          <FinanceHistoryTable
            rows={processing}
            loading={historyQuery.isLoading}
            variant="processing"
            onView={setDetailId}
            onPay={setPayTarget}
            onHold={(r) => setHoldTarget({ id: r.id, employeeName: r.employeeName })}
            busy={isBusy}
          />
        </TabsContent>
        <TabsContent value="on_hold">
          <FinanceHistoryTable
            rows={onHold}
            loading={historyQuery.isLoading}
            variant="on_hold"
            onView={setDetailId}
            onResume={doResume}
            busy={isBusy}
          />
        </TabsContent>
        <TabsContent value="paid">
          <FinanceHistoryTable rows={paid} loading={historyQuery.isLoading} variant="paid" onView={setDetailId} busy={isBusy} />
        </TabsContent>
      </Tabs>

      {/* Start confirmation */}
      <Dialog open={Boolean(startTarget)} onOpenChange={(o) => !o && setStartTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Finance Processing</DialogTitle>
            <DialogDescription>{startTarget ? `Begin processing the advance payment for ${startTarget.employeeName}. This moves it to Processing.` : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setStartTarget(null)} disabled={isBusy}>Cancel</Button>
            <Button onClick={doStart} disabled={isBusy}>{startMutation.isPending ? "Starting…" : "Start Processing"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hold confirmation */}
      <Dialog open={Boolean(holdTarget)} onOpenChange={(o) => !o && (setHoldTarget(null), setHoldReason(""))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Put Payment On Hold</DialogTitle>
            <DialogDescription>{holdTarget ? `${holdTarget.employeeName}'s advance payment will be paused until resumed.` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Textarea value={holdReason} onChange={(e) => setHoldReason(e.target.value)} placeholder="e.g. Bank account details pending verification." />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => (setHoldTarget(null), setHoldReason(""))} disabled={isBusy}>Cancel</Button>
            <Button variant="secondary" onClick={doHold} disabled={isBusy}>{holdMutation.isPending ? "Saving…" : "Confirm Hold"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <AdvancePaymentDialog target={payTarget} companyId={companyId} activeModes={modesQuery.data ?? []} onClose={() => setPayTarget(null)} />

      {/* Detail drawer */}
      <FinanceDetailDialog requestId={detailId} companyId={companyId} canManageReceipts={canManageReceipts} onClose={() => setDetailId(null)} />
    </div>
  );
}

function FinanceHistoryTable({
  rows,
  loading,
  variant,
  onView,
  onPay,
  onHold,
  onResume,
  busy,
}: {
  rows: AdvanceFinanceHistoryRow[];
  loading: boolean;
  variant: "processing" | "on_hold" | "paid";
  onView: (id: string) => void;
  onPay?: (r: AdvanceFinanceHistoryRow) => void;
  onHold?: (r: AdvanceFinanceHistoryRow) => void;
  onResume?: (id: string) => void;
  busy?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        {loading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={variant === "paid" ? Wallet : PauseCircle} title={`No ${variant.replace("_", " ")} advances.`} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Requested</TableHead>
                  <TableHead>Boss Approved</TableHead>
                  {variant === "paid" && <TableHead>Actual Paid</TableHead>}
                  {variant === "paid" && <TableHead>Payment Date</TableHead>}
                  {variant === "paid" && <TableHead>Mode</TableHead>}
                  {variant === "paid" && <TableHead>Reference</TableHead>}
                  {variant === "paid" && <TableHead>Receipt</TableHead>}
                  {variant === "on_hold" && <TableHead>Hold Reason</TableHead>}
                  {variant === "paid" && <TableHead>Processed By</TableHead>}
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
                    {variant === "paid" && <TableCell className="font-medium text-emerald-700">{formatAmount(row.paymentAmount)}</TableCell>}
                    {variant === "paid" && <TableCell className="text-xs">{row.paymentDate ? formatDate(row.paymentDate) : "—"}</TableCell>}
                    {variant === "paid" && <TableCell className="text-xs">{row.paymentModeLabel ?? "—"}</TableCell>}
                    {variant === "paid" && <TableCell className="text-xs">{row.transactionReference || row.utrNumber || row.bankReference || "—"}</TableCell>}
                    {variant === "paid" && <TableCell><ReceiptStatusBadge advanceRequestId={row.id} /></TableCell>}
                    {variant === "on_hold" && <TableCell className="max-w-[16rem] truncate text-xs" title={row.holdReason ?? undefined}>{row.holdReason ?? "—"}</TableCell>}
                    {variant === "paid" && <TableCell className="text-xs">{row.processedByName ?? "—"}</TableCell>}
                    <TableCell><Badge variant={ADVANCE_STATUS_VARIANT[row.status]}>{ADVANCE_STATUS_LABEL[row.status]}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => onView(row.id)}><Eye className="mr-1 h-4 w-4" /> View</Button>
                        {variant === "processing" && onPay && <Button size="sm" onClick={() => onPay(row)}><Wallet className="mr-1 h-4 w-4" /> Pay Advance</Button>}
                        {variant === "processing" && onHold && <Button size="sm" variant="secondary" onClick={() => onHold(row)}>Hold</Button>}
                        {variant === "on_hold" && onResume && <Button size="sm" variant="secondary" onClick={() => onResume(row.id)} disabled={busy}>Resume</Button>}
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

function FinanceDetailDialog({
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
  const approvalHistoryQuery = useAdvanceApprovalHistory(requestId ?? undefined);
  const hrHistoryQuery = useAdvanceHrProcessActions(requestId ?? undefined);
  const financeHistoryQuery = useAdvanceFinancePaymentActions(requestId ?? undefined);
  const d = detailQuery.data ?? null;
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  const openProof = async () => {
    if (!d?.paymentProofPath) return;
    try {
      const url = await advanceService.getPaymentProofSignedUrl(d.paymentProofPath);
      setProofUrl(url);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast({ title: "Could not open payment proof", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Dialog open={Boolean(requestId)} onOpenChange={(o) => !o && (setProofUrl(null), onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Advance Payment Details</DialogTitle>
          <DialogDescription>No salary information is shown. Boss Approved Amount is the maximum payable.</DialogDescription>
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
              <Field label="Supporting Documents">{d.documentCount} file(s)</Field>
              <Field label="Current Status">{ADVANCE_STATUS_LABEL[d.requestStatus]}</Field>
            </section>

            <section className="grid grid-cols-4 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Requested</p><p className="font-medium">{formatAmount(d.requestedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Mgr Recommended</p><p className="font-medium">{formatAmount(d.managerRecommendedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Boss Approved</p><p className="font-medium">{formatAmount(d.bossApprovedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Actual Paid</p><p className="font-medium text-emerald-700">{formatAmount(d.paymentAmount)}</p></div>
            </section>

            <section>
              <p className="text-xs font-medium text-muted-foreground">Reason</p>
              <p className="text-sm">{d.reason}</p>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <Field label="HR Processor">{d.hrProcessedByName ?? "—"}</Field>
              <Field label="HR Processed Date">{d.hrProcessedAt ? formatDate(d.hrProcessedAt) : "—"}</Field>
              {d.hrProcessRemarks && <Field label="HR Remarks">{d.hrProcessRemarks}</Field>}
            </section>

            {(d.paymentAmount != null || d.holdReason) && (
              <section className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Payment</p>
                <div className="grid gap-3 sm:grid-cols-3 text-sm">
                  <Field label="Payment Amount">{formatAmount(d.paymentAmount)}</Field>
                  <Field label="Payment Date">{d.paymentDate ? formatDate(d.paymentDate) : "—"}</Field>
                  <Field label="Payment Mode">{d.paymentModeLabel ?? "—"}</Field>
                  <Field label="Transaction Ref">{d.transactionReference ?? "—"}</Field>
                  <Field label="UTR">{d.utrNumber ?? "—"}</Field>
                  <Field label="Bank Reference">{d.bankReference ?? "—"}</Field>
                  {d.paymentRemarks && <Field label="Remarks">{d.paymentRemarks}</Field>}
                  {d.holdReason && <Field label="Hold Reason">{d.holdReason}</Field>}
                </div>
                {d.paymentProofPath && (
                  <Button size="sm" variant="secondary" className="mt-3" onClick={openProof}>
                    <ExternalLink className="mr-1 h-4 w-4" /> Open Payment Proof
                  </Button>
                )}
                {proofUrl && <p className="mt-1 text-xs text-muted-foreground">A short-lived signed link opened in a new tab.</p>}
              </section>
            )}

            {d.requestStatus === "paid" && requestId && (
              <AdvanceReceiptSection advanceRequestId={requestId} companyId={companyId} canManage={canManageReceipts} />
            )}

            <section>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Manager / Boss Approval History</p>
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

            {(financeHistoryQuery.data ?? []).length > 0 && (
              <section>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Finance History</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>When</TableHead><TableHead>By</TableHead><TableHead>Action</TableHead><TableHead>Amount</TableHead><TableHead>Remark</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(financeHistoryQuery.data ?? []).map((h, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs text-muted-foreground">{formatDateTime(h.actedAt)}</TableCell>
                          <TableCell className="text-xs">{h.actorName}</TableCell>
                          <TableCell className="text-xs">{financeActionLabel(h.action)}</TableCell>
                          <TableCell className="text-xs">{h.newPaymentAmount != null ? formatAmount(h.newPaymentAmount) : "—"}</TableCell>
                          <TableCell className="max-w-[14rem] truncate text-xs" title={h.remark ?? undefined}>{h.remark ?? "—"}</TableCell>
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
