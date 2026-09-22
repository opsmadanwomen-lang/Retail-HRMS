import { useMemo, useState } from "react";
import { CheckCircle2, ShieldAlert, Eye, Play, RotateCcw, Lock, ListChecks, CalendarPlus } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import {
  useAmIAdvanceFinance,
  useAmIAdvanceHr,
  useAdvanceRecoveryPlans,
  useAdvanceRecoveryDetail,
  useAdvanceRecoveryInstallments,
  useAdvanceRecoveryTransactions,
  useAdvancePayrollPeriods,
  useGenerateRecoveryPlan,
  useCreatePayrollPeriod,
  useRunPayrollPeriod,
  useFinalizePayrollPeriod,
  useReversePayrollPeriod,
  useSettleRecovery,
  useCloseRecovery,
  useAdjustRecoveryInstallment,
  useRecoveryInstallmentAdjustments,
  useAdvancePaymentModes,
  useAdvanceFinanceHistory,
} from "@/hooks/useAdvance";
import { formatDate } from "@/lib/utils";
import { formatAmount, formatDateTime, ADVANCE_STATUS_LABEL, ADVANCE_STATUS_VARIANT, RECOVERY_METHOD_LABEL } from "@/modules/advance/utils";
import type { AdvanceRecoveryPlanRow } from "@/types/advance";

const monthStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

/**
 * Advance Recovery (Finance / Super Admin) — Phase 4. Recovery is based on the ACTUAL PAID AMOUNT,
 * never the Boss Approved amount. Outstanding is backend-authoritative and can never be negative;
 * an Advance closes only when Outstanding = 0. Payroll deduction runs are idempotent and reversible.
 * Recovery + settlement authority reuses the Phase 3 Finance Processor roster (no new role).
 */
export function AdvanceRecoveryPage() {
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
        <PageHeader title="Advance Recovery" description="Payroll recovery, installments, settlement & closure." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="Recovery management reuses the Finance Processor roster — you are not an active Finance Processor." />
      </div>
    );
  }
  return <RecoveryView companyId={user?.companyId ?? undefined} />;
}

function RecoveryView({ companyId }: { companyId?: string }) {
  const pendingQ = useAdvanceRecoveryPlans("recovery_pending");
  const recoveringQ = useAdvanceRecoveryPlans("recovering");
  const settledQ = useAdvanceRecoveryPlans("settled");
  const closedQ = useAdvanceRecoveryPlans("closed");
  const periodsQ = useAdvancePayrollPeriods();
  const modesQ = useAdvancePaymentModes(companyId, true);
  const financeHistoryQ = useAdvanceFinanceHistory();
  const awaitingPlan = useMemo(() => (financeHistoryQ.data ?? []).filter((r) => r.status === "paid"), [financeHistoryQ.data]);
  const generatePlan = useGenerateRecoveryPlan();

  const [tab, setTab] = useState("awaiting");
  const [detailId, setDetailId] = useState<string | null>(null);

  const doGenerate = async (requestId: string) => {
    try {
      await generatePlan.mutateAsync({ requestId });
      toast({ title: "Recovery plan generated.", variant: "success" });
    } catch (e) {
      toast({ title: "Generate failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  const createPeriod = useCreatePayrollPeriod();
  const runPeriod = useRunPayrollPeriod();
  const finalizePeriod = useFinalizePayrollPeriod();
  const reversePeriod = useReversePayrollPeriod();

  const [newMonth, setNewMonth] = useState(() => monthStr(new Date()));
  const [reverseTarget, setReverseTarget] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [runResult, setRunResult] = useState<Awaited<ReturnType<typeof runPeriod.mutateAsync>> | null>(null);

  const doCreatePeriod = async () => {
    try {
      await createPeriod.mutateAsync({ periodMonth: newMonth, companyId });
      toast({ title: "Payroll period created (draft).", variant: "success" });
    } catch (e) {
      toast({ title: "Create failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };
  const doRun = async (periodId: string) => {
    try {
      const rows = await runPeriod.mutateAsync({ periodId });
      setRunResult(rows);
      toast({ title: `Recovery run complete — ${rows.length} deduction(s).`, variant: "success" });
    } catch (e) {
      toast({ title: "Run failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };
  const doFinalize = async (periodId: string) => {
    try {
      await finalizePeriod.mutateAsync(periodId);
      toast({ title: "Payroll period finalized.", variant: "success" });
    } catch (e) {
      toast({ title: "Finalize failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };
  const doReverse = async () => {
    if (!reverseTarget || !reverseReason.trim()) {
      toast({ title: "A reason is required to reverse a period.", variant: "destructive" });
      return;
    }
    try {
      await reversePeriod.mutateAsync({ periodId: reverseTarget, reason: reverseReason.trim() });
      toast({ title: "Payroll period reversed — recovery unwound.", variant: "success" });
      setReverseTarget(null);
      setReverseReason("");
    } catch (e) {
      toast({ title: "Reverse failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advance Recovery"
        description="Recover paid advances through payroll installments, or record an early settlement. Recovery is always based on the actual paid amount; an advance closes only when the outstanding is zero."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="awaiting">Awaiting Plan ({awaitingPlan.length})</TabsTrigger>
          <TabsTrigger value="recovery_pending">Recovery Pending ({pendingQ.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="recovering">Recovering ({recoveringQ.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="settled">Settled ({settledQ.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="closed">Closed ({closedQ.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="periods">Payroll Periods ({periodsQ.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="awaiting">
          <Card>
            <CardContent className="pt-6">
              {financeHistoryQ.isLoading ? (
                <LoadingState />
              ) : awaitingPlan.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No paid advances awaiting a recovery plan." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Boss Approved</TableHead>
                        <TableHead>Actual Paid</TableHead><TableHead>Paid On</TableHead><TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {awaitingPlan.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode ?? "—"})</span></TableCell>
                          <TableCell>{r.advanceTypeName}</TableCell>
                          <TableCell className="text-xs">{formatAmount(r.bossApprovedAmount)}</TableCell>
                          <TableCell className="font-medium text-emerald-700">{formatAmount(r.paymentAmount)}</TableCell>
                          <TableCell className="text-xs">{r.paymentDate ? formatDate(r.paymentDate) : "—"}</TableCell>
                          <TableCell>
                            <Button size="sm" onClick={() => doGenerate(r.id)} disabled={generatePlan.isPending}>Generate Recovery Plan</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Plan generation uses the applicable policy's recovery configuration (method, installments, start rule). Recovery is always based
                on the <span className="font-medium">Actual Paid Amount</span>, never the Boss Approved Amount.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recovery_pending"><PlanTable q={pendingQ} onView={setDetailId} /></TabsContent>
        <TabsContent value="recovering"><PlanTable q={recoveringQ} onView={setDetailId} /></TabsContent>
        <TabsContent value="settled"><PlanTable q={settledQ} onView={setDetailId} /></TabsContent>
        <TabsContent value="closed"><PlanTable q={closedQ} onView={setDetailId} /></TabsContent>

        <TabsContent value="periods">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label>New payroll period (month)</Label>
                  <Input type="date" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} />
                </div>
                <Button onClick={doCreatePeriod} disabled={createPeriod.isPending}>
                  <CalendarPlus className="mr-1 h-4 w-4" /> Create Draft Period
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                A payroll period is the recovery-run boundary (this project has no standalone payroll engine — see the Phase 4 notes). Run a
                draft period to deduct one installment per active advance (oldest-paid first), then finalize to lock it. A finalized period can
                still be reversed, which unwinds every deduction in it while keeping the original transactions visible.
              </p>

              {periodsQ.isLoading ? (
                <LoadingState />
              ) : (periodsQ.data ?? []).length === 0 ? (
                <EmptyState icon={ListChecks} title="No payroll periods yet." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead><TableHead>Label</TableHead><TableHead>Status</TableHead>
                        <TableHead>Deductions</TableHead><TableHead>Total Deducted</TableHead><TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(periodsQ.data ?? []).map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{formatDate(p.periodMonth)}</TableCell>
                          <TableCell className="text-xs">{p.label ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={p.status === "reversed" ? "destructive" : p.status === "finalized" ? "secondary" : "warning"} className="capitalize">{p.status}</Badge>
                          </TableCell>
                          <TableCell>{p.deductionCount}</TableCell>
                          <TableCell>{formatAmount(p.deductedTotal)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              {p.status === "draft" && <Button size="sm" onClick={() => doRun(p.id)} disabled={runPeriod.isPending}><Play className="mr-1 h-4 w-4" /> Run</Button>}
                              {p.status === "draft" && <Button size="sm" variant="secondary" onClick={() => doFinalize(p.id)} disabled={finalizePeriod.isPending}><Lock className="mr-1 h-4 w-4" /> Finalize</Button>}
                              {p.status !== "reversed" && <Button size="sm" variant="ghost" onClick={() => setReverseTarget(p.id)}><RotateCcw className="mr-1 h-4 w-4" /> Reverse</Button>}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {runResult && (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Last run result</p>
                  {runResult.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No installments were due this period.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Installment</TableHead><TableHead>Deducted</TableHead><TableHead>Outstanding</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {runResult.map((r, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs">{r.employeeName}</TableCell>
                              <TableCell className="text-xs">#{r.installmentNumber}</TableCell>
                              <TableCell className="text-xs font-medium">{formatAmount(r.deductedAmount)}</TableCell>
                              <TableCell className="text-xs">{formatAmount(r.closingOutstanding)}</TableCell>
                              <TableCell className="text-xs capitalize">{r.planStatus}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(reverseTarget)} onOpenChange={(o) => !o && (setReverseTarget(null), setReverseReason(""))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Payroll Period</DialogTitle>
            <DialogDescription>Every recovery deduction in this period is unwound. The original transactions stay visible; a reversal transaction is created for each.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => (setReverseTarget(null), setReverseReason(""))} disabled={reversePeriod.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={doReverse} disabled={reversePeriod.isPending}>{reversePeriod.isPending ? "Reversing…" : "Confirm Reverse"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecoveryDetailDialog requestId={detailId} activeModes={modesQ.data ?? []} onClose={() => setDetailId(null)} />
    </div>
  );
}

function PlanTable({ q, onView }: { q: ReturnType<typeof useAdvanceRecoveryPlans>; onView: (id: string) => void }) {
  const rows = q.data ?? [];
  return (
    <Card>
      <CardContent className="pt-6">
        {q.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing here." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead><TableHead>Type</TableHead>
                  <TableHead>Actual Paid</TableHead><TableHead>Recovered</TableHead><TableHead>Outstanding</TableHead>
                  <TableHead>Method</TableHead><TableHead>Start</TableHead><TableHead>Next Due</TableHead>
                  <TableHead>Status</TableHead><TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p: AdvanceRecoveryPlanRow) => (
                  <TableRow key={p.advanceRequestId}>
                    <TableCell className="font-medium">{p.employeeName} <span className="text-xs text-muted-foreground">({p.employeeCode ?? "—"})</span></TableCell>
                    <TableCell>{p.advanceTypeName}</TableCell>
                    <TableCell className="font-medium">{formatAmount(p.actualPaidAmount)}</TableCell>
                    <TableCell className="text-xs">{formatAmount(p.totalRecovered + p.totalSettled)}</TableCell>
                    <TableCell className="font-medium text-amber-700">{formatAmount(p.outstandingAmount)}</TableCell>
                    <TableCell className="text-xs">{RECOVERY_METHOD_LABEL[p.recoveryMethod] ?? p.recoveryMethod}</TableCell>
                    <TableCell className="text-xs">{formatDate(p.recoveryStartDate)}</TableCell>
                    <TableCell className="text-xs">{p.nextDueMonth ? formatDate(p.nextDueMonth) : "—"}</TableCell>
                    <TableCell><Badge variant={ADVANCE_STATUS_VARIANT[p.status]}>{ADVANCE_STATUS_LABEL[p.status]}</Badge></TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => onView(p.advanceRequestId)}><Eye className="mr-1 h-4 w-4" /> View</Button></TableCell>
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

export function RecoveryDetailDialog({
  requestId,
  activeModes,
  onClose,
  readOnly = false,
}: {
  requestId: string | null;
  activeModes: ReturnType<typeof useAdvancePaymentModes>["data"];
  onClose: () => void;
  readOnly?: boolean;
}) {
  const detailQ = useAdvanceRecoveryDetail(requestId ?? undefined);
  const instQ = useAdvanceRecoveryInstallments(requestId ?? undefined);
  const txnQ = useAdvanceRecoveryTransactions(requestId ?? undefined);
  const adjustmentsQ = useRecoveryInstallmentAdjustments(requestId ?? undefined);
  const d = detailQ.data ?? null;
  const modes = activeModes ?? [];

  // HR Recovery Schedule Adjustment (migration 0157) — NOT an approval level. Reuses the same
  // advance_hr_processors roster HR Processing already uses (useAmIAdvanceHr), never Finance's own
  // advance_recovery_can_manage() authority. Self-contained so this dialog works from any parent
  // (Advance Recovery, Advance Settings' Recovery tab, Advance Management ledger).
  const { user } = useAuth();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const myEmployeeId = currentEmployeeQuery.data?.id;
  const amIHrQuery = useAmIAdvanceHr(myEmployeeId);
  const isHr = amIHrQuery.data === true;

  const settle = useSettleRecovery();
  const close = useCloseRecovery();
  const adjustInstallment = useAdjustRecoveryInstallment();

  const [settleOpen, setSettleOpen] = useState(false);
  const [settleAmt, setSettleAmt] = useState("");
  const [settleDate, setSettleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [settleMode, setSettleMode] = useState("");
  const [settleRef, setSettleRef] = useState("");
  const [settleRemark, setSettleRemark] = useState("");

  const [adjustTarget, setAdjustTarget] = useState<{ installmentNumber: number; scheduledAmount: number } | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustFutureCount, setAdjustFutureCount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const doAdjust = async () => {
    if (!requestId || !adjustTarget) return;
    const amt = Number(adjustAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      toast({ title: "Enter a valid new amount (₹0 or more).", variant: "destructive" });
      return;
    }
    if (!adjustReason.trim()) {
      toast({ title: "A reason is required for a recovery adjustment.", variant: "destructive" });
      return;
    }
    const futureCount = adjustFutureCount.trim() ? Number(adjustFutureCount) : undefined;
    if (futureCount !== undefined && (!Number.isInteger(futureCount) || futureCount < 0)) {
      toast({ title: "Future installment count must be a whole number of 0 or more.", variant: "destructive" });
      return;
    }
    try {
      await adjustInstallment.mutateAsync({
        advanceRequestId: requestId,
        installmentNumber: adjustTarget.installmentNumber,
        newAmount: amt,
        reason: adjustReason.trim(),
        newFutureInstallmentCount: futureCount ?? null,
      });
      toast({ title: "Recovery schedule adjusted.", variant: "success" });
      setAdjustTarget(null);
      setAdjustAmount("");
      setAdjustFutureCount("");
      setAdjustReason("");
    } catch (e) {
      toast({ title: "Adjustment failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  const doSettle = async () => {
    if (!requestId) return;
    const amt = Number(settleAmt);
    if (!Number.isFinite(amt) || amt <= 0 || (d && amt > d.outstandingAmount)) {
      toast({ title: `Settlement must be between ₹1 and ${formatAmount(d?.outstandingAmount ?? 0)}.`, variant: "destructive" });
      return;
    }
    try {
      await settle.mutateAsync({ requestId, settlementAmount: amt, settlementDate: settleDate, paymentModeId: settleMode || undefined, transactionReference: settleRef.trim() || undefined, remarks: settleRemark.trim() || undefined });
      toast({ title: "Settlement recorded.", variant: "success" });
      setSettleOpen(false);
    } catch (e) {
      toast({ title: "Settlement failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Dialog open={Boolean(requestId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Advance Recovery Detail</DialogTitle>
          <DialogDescription>Boss Approved Amount and Actual Paid Amount are different values — recovery is based on Actual Paid.</DialogDescription>
        </DialogHeader>
        {detailQ.isLoading ? (
          <LoadingState rows={5} />
        ) : !d ? (
          <EmptyState icon={ShieldAlert} title="No recovery plan for this advance yet." description="Generate one from the 'Awaiting Plan' tab." />
        ) : (
          <div className="space-y-5">
            <section className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee">{d.employeeName} {d.employeeCode ? `(${d.employeeCode})` : ""}</Field>
              <Field label="Advance Type">{d.advanceTypeName}</Field>
              <Field label="Policy">{d.policyName} (v{d.policyVersion})</Field>
              <Field label="Payment Date">{d.paymentDate ? formatDate(d.paymentDate) : "—"}</Field>
              <Field label="Recovery Method">{RECOVERY_METHOD_LABEL[d.recoveryMethod] ?? d.recoveryMethod}</Field>
              <Field label="Recovery Start">{formatDate(d.recoveryStartDate)}</Field>
              <Field label="Installments">{d.installmentCount ?? "—"}</Field>
              <Field label="Monthly Deduction">{formatAmount(d.monthlyAmount)}</Field>
              <Field label="Next Due">{d.nextDueMonth ? formatDate(d.nextDueMonth) : "—"}</Field>
              <Field label="Last Deduction">{d.lastDeductionDate ? formatDate(d.lastDeductionDate) : "—"}</Field>
            </section>

            <section className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-6">
              <Amt label="Requested" v={d.requestedAmount} />
              <Amt label="Mgr Rec." v={d.managerRecommendedAmount} />
              <Amt label="Boss Appr." v={d.bossApprovedAmount} />
              <Amt label="Actual Paid" v={d.actualPaidAmount} accent />
              <Amt label="Recovered" v={d.totalRecovered + d.totalSettled} />
              <Amt label="Outstanding" v={d.outstandingAmount} amber />
            </section>

            {!readOnly && (
              <section className="flex flex-wrap gap-2">
                {d.outstandingAmount > 0 && d.allowEarlySettlement && (d.status === "recovering" || d.status === "recovery_pending") && (
                  <Button size="sm" onClick={() => { setSettleAmt(String(d.outstandingAmount)); setSettleOpen(true); }}>Early Settlement</Button>
                )}
                {d.outstandingAmount === 0 && d.status !== "closed" && (
                  <Button size="sm" variant="secondary" onClick={async () => { try { await close.mutateAsync({ requestId: requestId! }); toast({ title: "Advance closed.", variant: "success" }); } catch (e) { toast({ title: "Close failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" }); } }}>
                    Close Advance
                  </Button>
                )}
              </section>
            )}

            <section>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Installment Schedule</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Due</TableHead><TableHead>Scheduled</TableHead><TableHead>Recovered</TableHead><TableHead>Outstanding After</TableHead><TableHead>Status</TableHead>{!readOnly && isHr && <TableHead>Action</TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {(instQ.data ?? []).map((i) => (
                      <TableRow key={i.installmentNumber}>
                        <TableCell className="text-xs">{i.installmentNumber}</TableCell>
                        <TableCell className="text-xs">{formatDate(i.dueMonth)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(i.scheduledAmount)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(i.recoveredAmount)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(i.outstandingAfter)}</TableCell>
                        <TableCell className="text-xs capitalize">{i.status.replace("_", " ")}</TableCell>
                        {!readOnly && isHr && (
                          <TableCell>
                            {i.status === "scheduled" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setAdjustTarget({ installmentNumber: i.installmentNumber, scheduledAmount: i.scheduledAmount });
                                  setAdjustAmount(String(i.scheduledAmount));
                                  setAdjustFutureCount("");
                                  setAdjustReason("");
                                }}
                              >
                                Adjust Recovery
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {!readOnly && isHr && (
                <p className="mt-1 text-xs text-muted-foreground">
                  HR may adjust a still-unprocessed installment before that month's payroll is locked. This never changes the original Boss
                  approval, the Actual Paid Amount, or approval history — only the future deduction schedule.
                </p>
              )}
            </section>

            {(adjustmentsQ.data ?? []).length > 0 && (
              <section>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Recovery Schedule Adjustment History</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Scope</TableHead><TableHead>Period</TableHead><TableHead>Old → New</TableHead><TableHead>Type</TableHead><TableHead>By</TableHead><TableHead>Reason</TableHead><TableHead>Payroll Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(adjustmentsQ.data ?? []).map((a, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</TableCell>
                          <TableCell className="text-xs">{a.adjustmentScope === "target_period" ? `#${a.installmentNumber}` : "Future redistribution"}</TableCell>
                          <TableCell className="text-xs">{a.dueMonth ? formatDate(a.dueMonth) : "—"}</TableCell>
                          <TableCell className="text-xs">{formatAmount(a.oldScheduledAmount)} → {formatAmount(a.newScheduledAmount)}</TableCell>
                          <TableCell className="text-xs capitalize">{a.adjustmentType}</TableCell>
                          <TableCell className="text-xs">{a.processedByName ?? "—"}</TableCell>
                          <TableCell className="max-w-[12rem] truncate text-xs" title={a.reason}>{a.reason}</TableCell>
                          <TableCell className="text-xs capitalize">{(a.payrollLockStatusAtTime ?? "—").replace("_", " ")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            <section>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Recovery Transactions &amp; Settlements</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Kind</TableHead><TableHead>Period</TableHead><TableHead>Amount</TableHead><TableHead>Opening → Closing</TableHead><TableHead>By</TableHead><TableHead>Remark</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(txnQ.data ?? []).map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(t.actedAt)}</TableCell>
                        <TableCell className="text-xs capitalize">{t.kind}</TableCell>
                        <TableCell className="text-xs">{t.periodMonth ? formatDate(t.periodMonth) : "—"}</TableCell>
                        <TableCell className="text-xs font-medium">{formatAmount(t.amount)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(t.openingOutstanding)} → {formatAmount(t.closingOutstanding)}</TableCell>
                        <TableCell className="text-xs">{t.actorName ?? "—"}</TableCell>
                        <TableCell className="max-w-[14rem] truncate text-xs" title={t.remark ?? undefined}>{t.remark ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </div>
        )}

        <Dialog open={settleOpen} onOpenChange={(o) => !o && setSettleOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Early Settlement</DialogTitle>
              <DialogDescription>Outstanding: {formatAmount(d?.outstandingAmount ?? null)}. Settlement must be greater than zero and no more than the outstanding.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Settlement Amount (₹)</Label><Input type="number" value={settleAmt} onChange={(e) => setSettleAmt(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Settlement Date</Label><Input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Payment Mode</Label>
                <Select value={settleMode} onValueChange={setSettleMode}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>{modes.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Transaction Ref</Label><Input value={settleRef} onChange={(e) => setSettleRef(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Remarks</Label><Textarea value={settleRemark} onChange={(e) => setSettleRemark(e.target.value)} /></div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setSettleOpen(false)} disabled={settle.isPending}>Cancel</Button>
              <Button onClick={doSettle} disabled={settle.isPending}>{settle.isPending ? "Recording…" : "Record Settlement"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(adjustTarget)} onOpenChange={(o) => !o && setAdjustTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adjust Recovery — Installment #{adjustTarget?.installmentNumber}</DialogTitle>
              <DialogDescription>
                Currently scheduled: {formatAmount(adjustTarget?.scheduledAmount ?? null)}. The difference is automatically redistributed across
                the remaining future installments — never lost, never exceeding the Actual Paid Amount.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>New Amount for This Period (₹)</Label><Input type="number" min={0} value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Spread Remainder Over (installments, optional)</Label>
                <Input type="number" min={0} step={1} value={adjustFutureCount} onChange={(e) => setAdjustFutureCount(e.target.value)} placeholder="Keep current count" />
              </div>
            </div>
            <div className="space-y-1.5"><Label>Reason (required)</Label><Textarea value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="e.g. Employee requested a lower deduction this month." /></div>
            <p className="text-xs text-muted-foreground">
              This does not change the Boss-approved amount, the Actual Paid Amount, or approval history — only future payroll deduction
              amounts. Blocked automatically once this period's payroll is locked.
            </p>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setAdjustTarget(null)} disabled={adjustInstallment.isPending}>Cancel</Button>
              <Button onClick={doAdjust} disabled={adjustInstallment.isPending}>{adjustInstallment.isPending ? "Saving…" : "Save Adjustment"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
function Amt({ label, v, accent, amber }: { label: string; v: number | null; accent?: boolean; amber?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-medium ${accent ? "text-emerald-700" : amber ? "text-amber-700" : ""}`}>{formatAmount(v)}</p>
    </div>
  );
}
