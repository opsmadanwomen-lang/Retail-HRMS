import { useMemo, useState } from "react";
import {
  ShieldAlert, Eye, CheckCircle2, XCircle, Undo2, Wallet, PauseCircle, Play,
  RefreshCw, Search,
} from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useCurrentEmployee } from "@/hooks/useAttendance";
import {
  useAmIAdvanceManager,
  useAmIAdvanceBoss,
  useAmIAdvanceHr,
  useAmIAdvanceFinance,
  useAdvanceHrWorkflow,
  useAdvanceManagerPending,
  useAdvanceBossPending,
  useAdvanceManagerDecide,
  useAdvanceBossDecide,
  useAdvanceApprovalHistory,
  useAdvanceHrProcessActions,
  useAdvanceHrProcessAction,
  useAdvanceHrHold,
  useAdvanceHrSendBack,
  useAdvanceFinancePayment,
  useAdvanceFinancePaymentActions,
  useAdvanceFinanceStart,
  useAdvanceFinanceHold,
  useAdvanceFinanceResume,
  useAdvancePaymentModes,
  useAdvancePaymentReceipt,
  useAdvanceRecoveryDetail,
  useAdvanceRecoveryInstallments,
  useAdvanceRecoveryTransactions,
  useAdjustRecoveryInstallment,
} from "@/hooks/useAdvance";
import { useHasTabPermission } from "@/hooks/usePermissions";
import { AdvancePaymentDialog } from "@/modules/advance/components/AdvancePaymentDialog";
import { AdvanceReceiptSection, ReceiptStatusBadge } from "@/modules/advance/components/AdvanceReceiptSection";
import { formatDate } from "@/lib/utils";
import {
  formatAmount, formatDateTime, ADVANCE_STATUS_LABEL, ADVANCE_STATUS_VARIANT,
  actionLabel, hrActionLabel, financeActionLabel, roleLabel,
} from "@/modules/advance/utils";
import type { AdvanceWorkflowRow } from "@/types/advance";

type StageKey = "my_decisions" | "pending_manager" | "pending_boss" | "boss_approved" | "payment" | "paid" | "recovery" | "history";

/**
 * HR Panel — Approvals -> Advance (single unified workflow). Consolidates what was previously 4
 * separate destinations (Advance Approval, HR Advance Processing, Finance Advance Payment,
 * Advance Recovery) into ONE screen. Every action still calls the EXACT SAME existing RPCs those
 * pages already used (advance_manager_decide, advance_boss_decide, advance_hr_process/hold/
 * send_back, advance_finance_start/pay/hold/resume, advance_recovery_adjust_installment, the
 * receipt RPCs) — nothing here is a new engine. advance_hr_workflow_list() (migration 0168) is
 * the ONLY new backend surface, and it is read-only: it grants no decide/process/pay authority.
 * Those 4 pages/routes still exist and still work directly — only their separate top-level
 * navigation entry from Approvals is gone (see StaffApprovalsPage.tsx).
 */
export function AdvanceWorkflowPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const employeeId = currentEmployeeQuery.data?.id;

  const isManagerQuery = useAmIAdvanceManager(employeeId);
  const isBossQuery = useAmIAdvanceBoss(employeeId);
  const isHrQuery = useAmIAdvanceHr(employeeId);
  const isFinanceQuery = useAmIAdvanceFinance(employeeId);
  const isManager = isManagerQuery.data === true;
  const isBoss = isBossQuery.data === true;
  const isHr = isHrQuery.data === true;
  const isFinance = isFinanceQuery.data === true;

  const workflowQuery = useAdvanceHrWorkflow();

  if (currentEmployeeQuery.isLoading || isManagerQuery.isLoading || isBossQuery.isLoading || isHrQuery.isLoading || isFinanceQuery.isLoading) {
    return <LoadingState />;
  }

  if (!isSuperAdmin && !isManager && !isBoss && !isHr && !isFinance) {
    return (
      <div className="space-y-6">
        <PageHeader title="Advance" description="The complete Advance lifecycle in one place." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="You are not configured as an Advance Manager, Boss, HR Processor or Finance Processor." />
      </div>
    );
  }

  return (
    <AdvanceWorkflowView
      companyId={user?.companyId ?? undefined}
      employeeId={employeeId}
      isManager={isManager}
      isBoss={isBoss}
      isHr={isHr}
      isFinance={isFinance}
      rows={workflowQuery.data ?? []}
      loading={workflowQuery.isLoading}
    />
  );
}

function AdvanceWorkflowView({
  companyId,
  employeeId,
  isManager,
  isBoss,
  isHr,
  isFinance,
  rows,
  loading,
}: {
  companyId?: string;
  employeeId?: string;
  isManager: boolean;
  isBoss: boolean;
  isHr: boolean;
  isFinance: boolean;
  rows: AdvanceWorkflowRow[];
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<StageKey>(isManager || isBoss ? "my_decisions" : "pending_manager");
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(q) ||
        (r.employeeCode ?? "").toLowerCase().includes(q) ||
        (r.storeName ?? "").toLowerCase().includes(q) ||
        r.advanceTypeName.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const pendingManager = useMemo(() => filtered.filter((r) => r.status === "manager_pending"), [filtered]);
  const pendingBoss = useMemo(() => filtered.filter((r) => r.status === "boss_pending"), [filtered]);
  const bossApproved = useMemo(() => filtered.filter((r) => r.status === "approved"), [filtered]);
  const payment = useMemo(() => filtered.filter((r) => ["finance_pending", "finance_processing", "finance_on_hold"].includes(r.status)), [filtered]);
  const paid = useMemo(() => filtered.filter((r) => r.status === "paid"), [filtered]);
  const recovery = useMemo(() => filtered.filter((r) => ["recovery_pending", "recovering", "settled", "closed"].includes(r.status)), [filtered]);
  const receiptPendingCount = useMemo(() => paid.filter((r) => r.receiptStatus === "pending").length, [paid]);
  const completedCount = useMemo(() => filtered.filter((r) => r.recoveryStatus === "closed" || r.status === "settled").length, [filtered]);

  const cards: { key: StageKey; label: string; count: number }[] = [
    { key: "pending_manager", label: "Pending with Manager", count: pendingManager.length },
    { key: "pending_boss", label: "Pending with Boss", count: pendingBoss.length },
    { key: "boss_approved", label: "Boss Approved", count: bossApproved.length },
    { key: "payment", label: "Payment Pending", count: payment.length },
    { key: "paid", label: "Paid", count: paid.length },
    { key: "paid", label: "Receipt Pending", count: receiptPendingCount },
    { key: "recovery", label: "Recovery Running", count: recovery.filter((r) => r.status === "recovering" || r.status === "recovery_pending").length },
    { key: "history", label: "Completed", count: completedCount },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advance"
        description="The complete Advance lifecycle — Boss approval, payment, receipt and recovery — in one place. Business authority is unchanged: HR is not the Boss, and payment still requires an authorized Finance Processor."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {cards.map((c, i) => (
          <Card key={`${c.key}-${i}`} className="cursor-pointer transition-colors hover:border-primary/50" onClick={() => setActiveTab(c.key)}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-xl font-semibold">{c.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee, staff ID, store or advance type…" className="pl-9" />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as StageKey)}>
        <TabsList className="flex-wrap">
          {(isManager || isBoss) && <TabsTrigger value="my_decisions">My Decisions</TabsTrigger>}
          <TabsTrigger value="pending_manager">Pending with Manager ({pendingManager.length})</TabsTrigger>
          <TabsTrigger value="pending_boss">Pending with Boss ({pendingBoss.length})</TabsTrigger>
          <TabsTrigger value="boss_approved">Boss Approved ({bossApproved.length})</TabsTrigger>
          <TabsTrigger value="payment">Payment ({payment.length})</TabsTrigger>
          <TabsTrigger value="paid">Paid / Receipt ({paid.length})</TabsTrigger>
          <TabsTrigger value="recovery">Recovery ({recovery.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {(isManager || isBoss) && (
          <TabsContent value="my_decisions">
            <MyDecisionsTab isManager={isManager} isBoss={isBoss} onView={setDetailId} />
          </TabsContent>
        )}

        <TabsContent value="pending_manager">
          <p className="mb-2 text-xs text-muted-foreground">
            View-only for HR/Boss/Finance. Viewing this list does not grant Manager approval authority — a request can only be
            approved by its actual Reporting Manager, from their "My Decisions" tab.
          </p>
          <StageTable rows={pendingManager} loading={loading} emptyText="No requests pending Manager approval." onView={setDetailId}
            extraColumns={["Requested", "Installments", "Reporting Manager", "Reason"]}
            renderExtra={(r) => (<>
              <TableCell className="font-medium">{formatAmount(r.requestedAmount)}</TableCell>
              <TableCell className="text-xs">{r.requestedInstallmentCount ?? "—"}</TableCell>
              <TableCell className="text-xs">
                {r.reportingManagerName ?? "—"}
                {r.reportingManagerId && r.reportingManagerId === employeeId && <Badge variant="secondary" className="ml-1">You</Badge>}
              </TableCell>
              <TableCell className="max-w-[14rem] truncate text-xs" title={r.reason}>{r.reason || "—"}</TableCell>
            </>)} />
        </TabsContent>

        <TabsContent value="pending_boss">
          <StageTable rows={pendingBoss} loading={loading} emptyText="No requests pending Boss approval." onView={setDetailId}
            extraColumns={["Requested", "Mgr Recommended", "Req. Installments", "Mgr Rec. Installments", "Reason"]}
            renderExtra={(r) => (<>
              <TableCell>{formatAmount(r.requestedAmount)}</TableCell>
              <TableCell className="text-xs">{formatAmount(r.managerRecommendedAmount)}</TableCell>
              <TableCell className="text-xs">{r.requestedInstallmentCount ?? "—"}</TableCell>
              <TableCell className="text-xs">{r.managerRecommendedInstallmentCount ?? "—"}</TableCell>
              <TableCell className="max-w-[12rem] truncate text-xs" title={r.reason}>{r.reason || "—"}</TableCell>
            </>)} />
        </TabsContent>

        <TabsContent value="boss_approved">
          <StageTable rows={bossApproved} loading={loading} emptyText="No Boss-approved requests awaiting HR processing." onView={setDetailId}
            extraColumns={["Requested", "Mgr Recommended", "Boss Approved", "Req. Installments", "Final Installments", "Approved On", "Status"]}
            renderExtra={(r) => (<>
              <TableCell className="text-xs">{formatAmount(r.requestedAmount)}</TableCell>
              <TableCell className="text-xs">{formatAmount(r.managerRecommendedAmount)}</TableCell>
              <TableCell className="font-medium">{formatAmount(r.bossApprovedAmount)}</TableCell>
              <TableCell className="text-xs">{r.requestedInstallmentCount ?? "—"}</TableCell>
              <TableCell className="text-xs">{r.bossFinalInstallmentCount ?? "—"}</TableCell>
              <TableCell className="text-xs">{r.decidedAt ? formatDate(r.decidedAt) : "—"}</TableCell>
              <TableCell><Badge variant={ADVANCE_STATUS_VARIANT[r.status]}>{ADVANCE_STATUS_LABEL[r.status]}</Badge></TableCell>
            </>)} />
        </TabsContent>

        <TabsContent value="payment">
          <StageTable rows={payment} loading={loading} emptyText="No requests awaiting payment." onView={setDetailId}
            extraColumns={["Boss Approved", "Stage"]}
            renderExtra={(r) => (<>
              <TableCell className="font-medium">{formatAmount(r.bossApprovedAmount)}</TableCell>
              <TableCell><Badge variant={ADVANCE_STATUS_VARIANT[r.status]}>{ADVANCE_STATUS_LABEL[r.status]}</Badge></TableCell>
            </>)} />
        </TabsContent>

        <TabsContent value="paid">
          <StageTable rows={paid} loading={loading} emptyText="No paid advances yet." onView={setDetailId}
            extraColumns={["Paid", "Payment Date", "Receipt"]}
            renderExtra={(r) => (<>
              <TableCell className="font-medium text-emerald-700">{formatAmount(r.paymentAmount)}</TableCell>
              <TableCell className="text-xs">{r.paymentDate ? formatDate(r.paymentDate) : "—"}</TableCell>
              <TableCell><ReceiptStatusBadge advanceRequestId={r.id} /></TableCell>
            </>)} />
        </TabsContent>

        <TabsContent value="recovery">
          <StageTable rows={recovery} loading={loading} emptyText="No advances in recovery yet." onView={setDetailId}
            extraColumns={["Recovered", "Outstanding", "Recovery Status"]}
            renderExtra={(r) => (<>
              <TableCell className="text-xs">{formatAmount(r.totalRecovered)}</TableCell>
              <TableCell className="text-xs">{formatAmount(r.outstandingAmount)}</TableCell>
              <TableCell><Badge variant={r.recoveryStatus === "closed" ? "success" : "warning"}>{r.recoveryStatus ?? "—"}</Badge></TableCell>
            </>)} />
        </TabsContent>

        <TabsContent value="history">
          <StageTable rows={filtered} loading={loading} emptyText="No advance requests yet." onView={setDetailId}
            extraColumns={["Requested", "Boss Approved", "Paid", "Payment Date", "Receipt", "Recovered", "Outstanding", "Status"]}
            renderExtra={(r) => (<>
              <TableCell className="text-xs">{formatAmount(r.requestedAmount)}</TableCell>
              <TableCell className="text-xs">{formatAmount(r.bossApprovedAmount)}</TableCell>
              <TableCell className="text-xs">{formatAmount(r.paymentAmount)}</TableCell>
              <TableCell className="text-xs">{r.paymentDate ? formatDate(r.paymentDate) : "—"}</TableCell>
              <TableCell>{r.paymentAmount != null ? <ReceiptStatusBadge advanceRequestId={r.id} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-xs">{formatAmount(r.totalRecovered)}</TableCell>
              <TableCell className="text-xs">{formatAmount(r.outstandingAmount)}</TableCell>
              <TableCell><Badge variant={ADVANCE_STATUS_VARIANT[r.status]}>{ADVANCE_STATUS_LABEL[r.status]}</Badge></TableCell>
            </>)} />
        </TabsContent>
      </Tabs>

      <AdvanceWorkflowDetailDialog requestId={detailId} companyId={companyId} isHr={isHr} isFinance={isFinance} onClose={() => setDetailId(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic stage table
// ---------------------------------------------------------------------------
function StageTable({
  rows,
  loading,
  emptyText,
  onView,
  extraColumns,
  renderExtra,
}: {
  rows: AdvanceWorkflowRow[];
  loading: boolean;
  emptyText: string;
  onView: (id: string) => void;
  extraColumns: string[];
  renderExtra: (r: AdvanceWorkflowRow) => React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        {loading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={emptyText} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Type</TableHead>
                  {extraColumns.map((c) => <TableHead key={c}>{c}</TableHead>)}
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode ?? "—"})</span></TableCell>
                    <TableCell className="text-xs">{r.storeName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.advanceTypeName}</TableCell>
                    {renderExtra(r)}
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => onView(r.id)}><Eye className="mr-1 h-4 w-4" /> View</Button>
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

// ---------------------------------------------------------------------------
// "My Decisions" tab — reuses the EXACT SAME advance_manager_decide/
// advance_boss_decide RPCs (via existing hooks) AdvanceApprovalsPage already
// uses. Only shown to a caller who IS the resolved Manager/Boss — every
// decision is still re-enforced server-side regardless of what this shows.
// ---------------------------------------------------------------------------
function MyDecisionsTab({ isManager, isBoss, onView }: { isManager: boolean; isBoss: boolean; onView: (id: string) => void }) {
  const managerQuery = useAdvanceManagerPending();
  const bossQuery = useAdvanceBossPending();
  const managerDecide = useAdvanceManagerDecide();
  const bossDecide = useAdvanceBossDecide();

  const [target, setTarget] = useState<{ id: string; employeeName: string; kind: "manager" | "boss"; requestedAmount: number; requestedInstallmentCount: number | null } | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected" | "sent_back" | null>(null);
  const [amount, setAmount] = useState("");
  const [installments, setInstallments] = useState("");
  const [remark, setRemark] = useState("");

  const openAction = (id: string, employeeName: string, kind: "manager" | "boss", requestedAmount: number, requestedInstallmentCount: number | null, dec: "approved" | "rejected" | "sent_back") => {
    setTarget({ id, employeeName, kind, requestedAmount, requestedInstallmentCount });
    setDecision(dec);
    setAmount(String(requestedAmount));
    setInstallments(requestedInstallmentCount != null ? String(requestedInstallmentCount) : "");
    setRemark("");
  };
  const close = () => { setTarget(null); setDecision(null); };

  const submit = async () => {
    if (!target || !decision) return;
    if (decision !== "approved" && !remark.trim()) {
      toast({ title: "A remark is required to reject or send back a request.", variant: "destructive" });
      return;
    }
    try {
      if (target.kind === "manager") {
        await managerDecide.mutateAsync({
          requestId: target.id, decision,
          recommendedAmount: decision === "approved" ? Number(amount) : undefined,
          recommendedInstallmentCount: decision === "approved" && installments ? Number(installments) : undefined,
          remark: remark.trim() || undefined,
        });
      } else {
        await bossDecide.mutateAsync({
          requestId: target.id, decision,
          approvedAmount: decision === "approved" ? Number(amount) : undefined,
          finalInstallmentCount: decision === "approved" && installments ? Number(installments) : undefined,
          remark: remark.trim() || undefined,
        });
      }
      toast({ title: "Decision recorded.", variant: "success" });
      close();
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {isManager && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Awaiting your Manager recommendation</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {(managerQuery.data ?? []).length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Nothing pending your recommendation." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Requested</TableHead><TableHead>Installments</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(managerQuery.data ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.employeeName}</TableCell>
                        <TableCell>{formatAmount(r.requestedAmount)}</TableCell>
                        <TableCell className="text-xs">{r.requestedInstallmentCount ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="ghost" onClick={() => onView(r.id)}><Eye className="mr-1 h-4 w-4" /> View</Button>
                            <Button size="sm" onClick={() => openAction(r.id, r.employeeName, "manager", r.requestedAmount, r.requestedInstallmentCount, "approved")}><CheckCircle2 className="mr-1 h-4 w-4" /> Approve</Button>
                            <Button size="sm" variant="destructive" onClick={() => openAction(r.id, r.employeeName, "manager", r.requestedAmount, r.requestedInstallmentCount, "rejected")}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
                            <Button size="sm" variant="secondary" onClick={() => openAction(r.id, r.employeeName, "manager", r.requestedAmount, r.requestedInstallmentCount, "sent_back")}><Undo2 className="mr-1 h-4 w-4" /> Send Back</Button>
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
      )}

      {isBoss && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Awaiting your Final (Boss) Approval</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {(bossQuery.data ?? []).length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Nothing pending your final approval." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Requested</TableHead><TableHead>Mgr Recommended</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(bossQuery.data ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.employeeName}</TableCell>
                        <TableCell>{formatAmount(r.requestedAmount)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(r.managerRecommendedAmount)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="ghost" onClick={() => onView(r.id)}><Eye className="mr-1 h-4 w-4" /> View</Button>
                            <Button size="sm" onClick={() => openAction(r.id, r.employeeName, "boss", r.requestedAmount, r.requestedInstallmentCount, "approved")}><CheckCircle2 className="mr-1 h-4 w-4" /> Approve</Button>
                            <Button size="sm" variant="destructive" onClick={() => openAction(r.id, r.employeeName, "boss", r.requestedAmount, r.requestedInstallmentCount, "rejected")}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
                            <Button size="sm" variant="secondary" onClick={() => openAction(r.id, r.employeeName, "boss", r.requestedAmount, r.requestedInstallmentCount, "sent_back")}><Undo2 className="mr-1 h-4 w-4" /> Send Back</Button>
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
      )}

      <Dialog open={Boolean(target && decision)} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision === "approved" ? "Approve" : decision === "rejected" ? "Reject" : "Send Back"} — {target?.employeeName}</DialogTitle>
            <DialogDescription>
              {target?.kind === "boss" ? "Final approval — this becomes the authoritative approved amount/installments." : "Recommendation only — never authoritative on its own."}
            </DialogDescription>
          </DialogHeader>
          {decision === "approved" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>{target?.kind === "boss" ? "Approved Amount" : "Recommended Amount"}</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{target?.kind === "boss" ? "Final Installments" : "Recommended Installments"}</Label><Input type="number" value={installments} onChange={(e) => setInstallments(e.target.value)} /></div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{decision === "approved" ? "Remark (optional, required if amount/installments changed)" : "Reason (required)"}</Label>
            <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={submit} disabled={managerDecide.isPending || bossDecide.isPending}>
              {managerDecide.isPending || bossDecide.isPending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified detail dialog — composes the SAME existing detail RPCs/hooks the 4
// separate pages already use (advance_get_finance_payment already includes
// HR in its visibility, so this one call backs sections 1-5 below).
// ---------------------------------------------------------------------------
function AdvanceWorkflowDetailDialog({
  requestId,
  companyId,
  isHr,
  isFinance,
  onClose,
}: {
  requestId: string | null;
  companyId?: string;
  isHr: boolean;
  isFinance: boolean;
  onClose: () => void;
}) {
  const detailQuery = useAdvanceFinancePayment(requestId ?? undefined);
  const receiptQuery = useAdvancePaymentReceipt(requestId ?? undefined);
  const approvalHistoryQuery = useAdvanceApprovalHistory(requestId ?? undefined);
  const hrHistoryQuery = useAdvanceHrProcessActions(requestId ?? undefined);
  const financeHistoryQuery = useAdvanceFinancePaymentActions(requestId ?? undefined);
  const recoveryDetailQuery = useAdvanceRecoveryDetail(requestId ?? undefined);
  const recoveryInstallmentsQuery = useAdvanceRecoveryInstallments(requestId ?? undefined);
  const recoveryTxnQuery = useAdvanceRecoveryTransactions(requestId ?? undefined);
  const modesQuery = useAdvancePaymentModes(companyId, true);

  const hrProcessAction = useAdvanceHrProcessAction();
  const hrHold = useAdvanceHrHold();
  const hrSendBack = useAdvanceHrSendBack();
  const financeStart = useAdvanceFinanceStart();
  const financeHold = useAdvanceFinanceHold();
  const financeResume = useAdvanceFinanceResume();
  const adjustInstallment = useAdjustRecoveryInstallment();

  const [payTarget, setPayTarget] = useState<{ id: string; employeeName: string; advanceTypeName: string; bossApprovedAmount: number | null } | null>(null);
  const [hrHoldReason, setHrHoldReason] = useState("");
  const [hrSendBackReason, setHrSendBackReason] = useState("");
  const [showHrHold, setShowHrHold] = useState(false);
  const [showHrSendBack, setShowHrSendBack] = useState(false);
  const [financeHoldReason, setFinanceHoldReason] = useState("");
  const [showFinanceHold, setShowFinanceHold] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<{ installmentNumber: number; scheduledAmount: number } | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustFutureCount, setAdjustFutureCount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const d = detailQuery.data ?? null;
  const rd = recoveryDetailQuery.data ?? null;
  // Business authority (isHr/isFinance) AND the Super-Admin-configurable "Paid / Receipt -> Upload"
  // tab permission (migration 0171) must both allow it — backend re-enforces the exact same pair.
  const uploadTabPermission = useHasTabPermission("advance_management", "paid_receipt", "UPLOAD");
  const canManageReceipt = (isHr || isFinance) && uploadTabPermission.allowed;

  if (!requestId) return null;

  const doHrProcess = async () => {
    try {
      await hrProcessAction.mutateAsync({ requestId, remarks: undefined });
      toast({ title: "Processed — ready for Finance.", variant: "success" });
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const doHrHold = async () => {
    if (!hrHoldReason.trim()) { toast({ title: "A reason is required.", variant: "destructive" }); return; }
    try {
      await hrHold.mutateAsync({ requestId, reason: hrHoldReason.trim() });
      toast({ title: "Put on hold.", variant: "success" });
      setShowHrHold(false); setHrHoldReason("");
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const doHrSendBack = async () => {
    if (!hrSendBackReason.trim()) { toast({ title: "A reason is required.", variant: "destructive" }); return; }
    try {
      await hrSendBack.mutateAsync({ requestId, reason: hrSendBackReason.trim() });
      toast({ title: "Sent back.", variant: "success" });
      setShowHrSendBack(false); setHrSendBackReason("");
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const doFinanceStart = async () => {
    try {
      await financeStart.mutateAsync(requestId);
      toast({ title: "Finance processing started.", variant: "success" });
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const doFinanceHold = async () => {
    if (!financeHoldReason.trim()) { toast({ title: "A reason is required.", variant: "destructive" }); return; }
    try {
      await financeHold.mutateAsync({ requestId, reason: financeHoldReason.trim() });
      toast({ title: "Payment put on hold.", variant: "success" });
      setShowFinanceHold(false); setFinanceHoldReason("");
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const doFinanceResume = async () => {
    try {
      await financeResume.mutateAsync({ requestId, remark: "Resumed" });
      toast({ title: "Payment resumed.", variant: "success" });
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const doAdjust = async () => {
    if (!adjustTarget) return;
    if (!adjustReason.trim()) { toast({ title: "A reason is required.", variant: "destructive" }); return; }
    try {
      await adjustInstallment.mutateAsync({
        advanceRequestId: requestId,
        installmentNumber: adjustTarget.installmentNumber,
        newAmount: Number(adjustAmount),
        reason: adjustReason.trim(),
        newFutureInstallmentCount: adjustFutureCount ? Number(adjustFutureCount) : undefined,
      });
      toast({ title: "Recovery schedule adjusted.", variant: "success" });
      setAdjustTarget(null); setAdjustAmount(""); setAdjustFutureCount(""); setAdjustReason("");
    } catch (error) {
      toast({ title: "Adjustment failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Advance Details</DialogTitle>
            <DialogDescription>No salary information is shown. Boss Approved Amount is the maximum payable.</DialogDescription>
          </DialogHeader>

          {detailQuery.isLoading || !d ? (
            <LoadingState rows={6} />
          ) : (
            <div className="space-y-5">
              {/* 1-2. Employee + Advance Request */}
              <section className="grid gap-3 sm:grid-cols-2">
                <Field label="Employee">{d.employeeName} {d.employeeCode ? `(${d.employeeCode})` : ""}</Field>
                <Field label="Advance Type">{d.advanceTypeName}</Field>
                <Field label="Policy">{d.policyName} (v{d.policyVersion})</Field>
                <Field label="Requested On">{formatDate(d.requestedAt)}</Field>
                <Field label="Current Status"><Badge variant={ADVANCE_STATUS_VARIANT[d.requestStatus]}>{ADVANCE_STATUS_LABEL[d.requestStatus]}</Badge></Field>
              </section>

              <AdvanceLifecycleTimeline d={d} receiptUploaded={receiptQuery.data?.receiptStatus === "uploaded"} />

              {/* 3-4. Approval Status + Boss Approval */}
              <section className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Requested</p><p className="font-medium">{formatAmount(d.requestedAmount)}</p></div>
                <div><p className="text-xs text-muted-foreground">Mgr Recommended</p><p className="font-medium">{formatAmount(d.managerRecommendedAmount)}</p></div>
                <div><p className="text-xs text-muted-foreground">Boss Approved (final)</p><p className="font-medium text-emerald-700">{formatAmount(d.bossApprovedAmount)}</p></div>
              </section>
              <section>
                <p className="text-xs font-medium text-muted-foreground">Reason</p>
                <p className="text-sm">{d.reason}</p>
              </section>

              {/* Stage-appropriate actions */}
              {d.requestStatus === "approved" && (
                <section className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">HR Processing</p>
                  {isHr ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={doHrProcess} disabled={hrProcessAction.isPending}>Process for Finance</Button>
                      <Button size="sm" variant="secondary" onClick={() => setShowHrHold(true)}><PauseCircle className="mr-1 h-4 w-4" /> Hold</Button>
                      <Button size="sm" variant="destructive" onClick={() => setShowHrSendBack(true)}><Undo2 className="mr-1 h-4 w-4" /> Send Back</Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Awaiting HR processing.</p>
                  )}
                </section>
              )}

              {(d.requestStatus === "finance_pending" || d.requestStatus === "finance_processing" || d.requestStatus === "finance_on_hold") && (
                <section className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Payment</p>
                  {isFinance ? (
                    <div className="flex flex-wrap gap-2">
                      {d.requestStatus === "finance_pending" && <Button size="sm" onClick={doFinanceStart} disabled={financeStart.isPending}><Play className="mr-1 h-4 w-4" /> Start Processing</Button>}
                      {d.requestStatus === "finance_processing" && (
                        <>
                          <Button size="sm" onClick={() => setPayTarget({ id: requestId, employeeName: d.employeeName, advanceTypeName: d.advanceTypeName, bossApprovedAmount: d.bossApprovedAmount })}><Wallet className="mr-1 h-4 w-4" /> Pay Advance</Button>
                          <Button size="sm" variant="secondary" onClick={() => setShowFinanceHold(true)}>Hold</Button>
                        </>
                      )}
                      {d.requestStatus === "finance_on_hold" && <Button size="sm" variant="secondary" onClick={doFinanceResume} disabled={financeResume.isPending}>Resume</Button>}
                    </div>
                  ) : (
                    <Badge variant="warning">Payment Pending Finance</Badge>
                  )}
                </section>
              )}

              {/* Payment & Receipt (spec §14) — the same fields already recorded by advance_finance_pay(), just surfaced */}
              {d.paymentAmount != null && (
                <section className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Payment</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Payment Status"><Badge variant="success">Paid</Badge></Field>
                    <Field label="Payment Mode">{d.paymentModeLabel ?? "—"}</Field>
                    <Field label="Actual Paid Amount">{formatAmount(d.paymentAmount)}</Field>
                    <Field label="Payment Date">{d.paymentDate ? formatDate(d.paymentDate) : "—"}</Field>
                    <Field label="Reference / UTR">{d.utrNumber ?? d.bankReference ?? d.transactionReference ?? "—"}</Field>
                    <Field label="Payment Remarks">{d.paymentRemarks ?? "—"}</Field>
                  </div>
                </section>
              )}

              {/* 6. Receipt — available for the life of the advance once paid, not just while
                  requestStatus is still literally 'paid' (recovery starting afterward must not
                  hide it; a cash receipt is often supplied well after payment). */}
              {d.paymentAmount != null && (
                <AdvanceReceiptSection advanceRequestId={requestId} companyId={companyId} canManage={canManageReceipt} />
              )}

              {/* 7. Recovery */}
              {rd && (
                <section className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Recovery</p>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <Field label="Actual Paid">{formatAmount(rd.actualPaidAmount)}</Field>
                    <Field label="Recovered">{formatAmount(rd.totalRecovered)}</Field>
                    <Field label="Outstanding">{formatAmount(rd.outstandingAmount)}</Field>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Due</TableHead><TableHead>Scheduled</TableHead><TableHead>Recovered</TableHead><TableHead>Status</TableHead>{isHr && <TableHead>Action</TableHead>}</TableRow></TableHeader>
                      <TableBody>
                        {(recoveryInstallmentsQuery.data ?? []).map((i) => (
                          <TableRow key={i.installmentNumber}>
                            <TableCell>{i.installmentNumber}</TableCell>
                            <TableCell className="text-xs">{formatDate(i.dueMonth)}</TableCell>
                            <TableCell>{formatAmount(i.scheduledAmount)}</TableCell>
                            <TableCell className="text-xs">{formatAmount(i.recoveredAmount)}</TableCell>
                            <TableCell><Badge variant={i.status === "processed" ? "success" : i.status === "cancelled" ? "secondary" : "warning"}>{i.status}</Badge></TableCell>
                            {isHr && (
                              <TableCell>
                                {i.status === "scheduled" && (rd.status === "recovery_pending" || rd.status === "recovering") && (
                                  <Button size="sm" variant="ghost" onClick={() => { setAdjustTarget({ installmentNumber: i.installmentNumber, scheduledAmount: i.scheduledAmount }); setAdjustAmount(String(i.scheduledAmount)); }}>
                                    <RefreshCw className="mr-1 h-3 w-3" /> Adjust
                                  </Button>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}

              {/* 8. History / Audit */}
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
              {(recoveryTxnQuery.data ?? []).length > 0 && (
                <section>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Recovery Transactions</p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Closing Outstanding</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {(recoveryTxnQuery.data ?? []).map((t, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{t.periodMonth ? formatDate(t.periodMonth) : "—"}</TableCell>
                            <TableCell className="text-xs capitalize">{t.kind}</TableCell>
                            <TableCell className="text-xs">{formatAmount(t.amount)}</TableCell>
                            <TableCell className="text-xs">{formatAmount(t.closingOutstanding)}</TableCell>
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

      <AdvancePaymentDialog target={payTarget} companyId={companyId} activeModes={modesQuery.data ?? []} onClose={() => setPayTarget(null)} />

      <Dialog open={showHrHold} onOpenChange={(o) => !o && (setShowHrHold(false), setHrHoldReason(""))}>
        <DialogContent>
          <DialogHeader><DialogTitle>Put On Hold</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label>Reason (required)</Label><Textarea value={hrHoldReason} onChange={(e) => setHrHoldReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => (setShowHrHold(false), setHrHoldReason(""))}>Cancel</Button>
            <Button onClick={doHrHold} disabled={hrHold.isPending}>Confirm Hold</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHrSendBack} onOpenChange={(o) => !o && (setShowHrSendBack(false), setHrSendBackReason(""))}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Back</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label>Reason (required)</Label><Textarea value={hrSendBackReason} onChange={(e) => setHrSendBackReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => (setShowHrSendBack(false), setHrSendBackReason(""))}>Cancel</Button>
            <Button variant="destructive" onClick={doHrSendBack} disabled={hrSendBack.isPending}>Confirm Send Back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFinanceHold} onOpenChange={(o) => !o && (setShowFinanceHold(false), setFinanceHoldReason(""))}>
        <DialogContent>
          <DialogHeader><DialogTitle>Put Payment On Hold</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label>Reason (required)</Label><Textarea value={financeHoldReason} onChange={(e) => setFinanceHoldReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => (setShowFinanceHold(false), setFinanceHoldReason(""))}>Cancel</Button>
            <Button onClick={doFinanceHold} disabled={financeHold.isPending}>Confirm Hold</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(adjustTarget)} onOpenChange={(o) => !o && setAdjustTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Installment #{adjustTarget?.installmentNumber}</DialogTitle>
            <DialogDescription>Redistributes the remainder across the remaining future installments — the total never changes.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>New Amount for this Installment</Label><Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Future Installment Count (optional)</Label><Input type="number" value={adjustFutureCount} onChange={(e) => setAdjustFutureCount(e.target.value)} placeholder="unchanged if blank" /></div>
          </div>
          <div className="space-y-1.5"><Label>Reason (required)</Label><Textarea value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAdjustTarget(null)}>Cancel</Button>
            <Button onClick={doAdjust} disabled={adjustInstallment.isPending}>{adjustInstallment.isPending ? "Saving…" : "Confirm Adjustment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Timeline — derived ENTIRELY from real fields on the detail row, never
// hard-coded per request.
// ---------------------------------------------------------------------------
function AdvanceLifecycleTimeline({
  d,
  receiptUploaded,
}: {
  d: { requestStatus: string; hrProcessedAt: string | null; paymentAmount: number | null };
  receiptUploaded: boolean;
}) {
  const steps = [
    { label: "Applied by Employee", done: true },
    { label: "Manager Approved", done: !["manager_pending", "rejected", "sent_back", "cancelled"].includes(d.requestStatus) },
    { label: "Boss Approved", done: !["manager_pending", "boss_pending", "rejected", "sent_back", "cancelled"].includes(d.requestStatus) },
    { label: "HR/Finance Processing", done: Boolean(d.hrProcessedAt) },
    { label: "Payment Completed", done: d.paymentAmount != null },
    { label: "Receipt Uploaded", done: receiptUploaded },
    { label: "Recovery Running", done: ["recovering", "settled", "closed"].includes(d.requestStatus) },
    { label: "Fully Recovered", done: ["settled", "closed"].includes(d.requestStatus) },
  ];
  return (
    <section className="rounded-lg border bg-muted/20 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Advance Lifecycle</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {steps.map((s) => (
          <span key={s.label} className={s.done ? "text-emerald-700" : "text-muted-foreground"}>
            {s.done ? "✓" : "○"} {s.label}
          </span>
        ))}
      </div>
    </section>
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
