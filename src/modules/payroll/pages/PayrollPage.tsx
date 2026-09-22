import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, Calculator, Lock, RotateCcw, CheckCircle2, ShieldAlert, Eye, AlertTriangle, Wallet, SlidersHorizontal, UserMinus } from "lucide-react";

import { ROUTES } from "@/constants/routes";
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
  usePayrollAdmin,
  usePayrollPeriods,
  usePayrollRunResults,
  usePayrollEmployeeResult,
  usePayrollResultLines,
  usePayrollAdvanceRecoveryReport,
  useCreatePayrollPeriod,
  useStartPayrollRun,
  useCalculatePayrollRun,
  useFinalizePayrollRun,
  useLockPayrollRun,
  useReversePayrollRun,
} from "@/hooks/usePayroll";
import { formatDate } from "@/lib/utils";
import { formatAmount } from "@/modules/advance/utils";
import type { PayrollPeriodRow, PayrollStatus } from "@/types/payroll";

function StatusBadge({ status }: { status: PayrollStatus | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const v = status === "finalized" || status === "calculated" ? "success" : status === "locked" ? "secondary" : status === "reversed" ? "destructive" : "warning";
  return <Badge variant={v} className="capitalize">{status}</Badge>;
}
const monthStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

/**
 * Payroll — real payroll engine (Phase 5). Period -> Run -> Calculate (salary snapshot + attendance
 * + leave inputs + earnings + deductions + Advance Recovery) -> Review -> Finalize -> Lock, with a
 * controlled Reverse. Advance Recovery is always based on the Actual Paid Amount and is driven
 * through the unmodified Phase-4 recovery RPCs via a bridged advance period. Payroll admin authority
 * reuses the Finance Processor roster (no new role).
 */
export function PayrollPage() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const isSuperAdmin = user?.role === "super_admin";
  const adminQuery = usePayrollAdmin(companyId);
  const isAdmin = adminQuery.data === true || isSuperAdmin;

  const periodsQuery = usePayrollPeriods(companyId, isAdmin);
  const createPeriod = useCreatePayrollPeriod();
  const startRun = useStartPayrollRun();

  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [newMonth, setNewMonth] = useState(() => monthStr(new Date()));

  if (currentEmployeeQuery.isLoading || adminQuery.isLoading) return <LoadingState />;
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Payroll" description="Payroll runs, salary calculation, deductions & payslips." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="Payroll administration reuses the Finance Processor roster — you are not an active Finance Processor." />
      </div>
    );
  }

  const periods = periodsQuery.data ?? [];
  const latest = periods[0];

  const doCreate = async () => {
    if (!companyId) return;
    try {
      await createPeriod.mutateAsync({ companyId, periodMonth: newMonth });
      toast({ title: "Payroll period created (draft).", variant: "success" });
    } catch (e) {
      toast({ title: "Create failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };
  const doStart = async (p: PayrollPeriodRow) => {
    try {
      const run = await startRun.mutateAsync(p.id);
      setOpenRunId(run.id);
      toast({ title: "Payroll run started.", variant: "success" });
    } catch (e) {
      toast({ title: "Start failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader title="Payroll" description="Create a payroll period, run the calculation, review, finalize and lock. Advance Recovery is deducted from the Actual Paid Amount." />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.payrollComponentAmounts}><SlidersHorizontal className="mr-1 h-4 w-4" /> PF / ESI Amount Input</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.fnf}><UserMinus className="mr-1 h-4 w-4" /> Full &amp; Final Settlement</Link>
          </Button>
        </div>
      </div>

      {/* Dashboard header */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Latest Period" value={latest ? formatDate(latest.periodMonth) : "—"} sub={latest ? latest.status : ""} />
        <Kpi label="Employees" value={latest ? String(latest.employeeCount) : "—"} />
        <Kpi label="Gross Payroll" value={latest ? formatAmount(latest.grossTotal) : "—"} />
        <Kpi label="Net Payroll" value={latest ? formatAmount(latest.netTotal) : "—"} sub={latest ? `Advance Recovery ${formatAmount(latest.advanceRecoveryTotal)}` : ""} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Payroll Periods</CardTitle>
          <div className="flex items-end gap-2">
            <div className="space-y-1"><Label className="text-xs">New period month</Label><Input type="date" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} className="h-9" /></div>
            <Button onClick={doCreate} disabled={createPeriod.isPending}><CalendarPlus className="mr-1 h-4 w-4" /> Create Period</Button>
          </div>
        </CardHeader>
        <CardContent>
          {periodsQuery.isLoading ? (
            <LoadingState />
          ) : periods.length === 0 ? (
            <EmptyState icon={Wallet} title="No payroll periods yet." description="Create one to run payroll." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead><TableHead>Period</TableHead><TableHead>Status</TableHead>
                    <TableHead>Employees</TableHead><TableHead>Gross</TableHead><TableHead>Deductions</TableHead>
                    <TableHead>Advance Recovery</TableHead><TableHead>Net</TableHead><TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periods.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{formatDate(p.periodMonth)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(p.periodStartDate)} – {formatDate(p.periodEndDate)}</TableCell>
                      <TableCell><StatusBadge status={p.status} /></TableCell>
                      <TableCell>{p.employeeCount}</TableCell>
                      <TableCell>{formatAmount(p.grossTotal)}</TableCell>
                      <TableCell>{formatAmount(p.deductionTotal)}</TableCell>
                      <TableCell className="font-medium text-amber-700">{formatAmount(p.advanceRecoveryTotal)}</TableCell>
                      <TableCell className="font-medium">{formatAmount(p.netTotal)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {p.currentRunId && <Button size="sm" variant="ghost" onClick={() => setOpenRunId(p.currentRunId)}><Eye className="mr-1 h-4 w-4" /> Open Run</Button>}
                          {["draft", "processing", "calculated"].includes(p.status) && (
                            <Button size="sm" onClick={() => doStart(p)} disabled={startRun.isPending}>
                              {p.currentRunId ? "New Run" : "Start Run"}
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

      <RunDialog runId={openRunId} onClose={() => setOpenRunId(null)} />
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold">{value}</p>
        {sub ? <p className="text-xs capitalize text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function RunDialog({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const resultsQuery = usePayrollRunResults(runId ?? undefined);
  const advRecQuery = usePayrollAdvanceRecoveryReport(runId ?? undefined);
  const calc = useCalculatePayrollRun();
  const finalize = useFinalizePayrollRun();
  const lock = useLockPayrollRun();
  const reverse = useReversePayrollRun();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [tab, setTab] = useState("results");

  const results = resultsQuery.data ?? [];
  const totals = useMemo(() => results.reduce(
    (a, r) => ({ g: a.g + r.grossEarnings, d: a.d + r.totalDeductions, adv: a.adv + r.advanceRecoveryAmount, net: a.net + r.netSalary, rev: a.rev + (r.needsReview ? 1 : 0) }),
    { g: 0, d: 0, adv: 0, net: 0, rev: 0 },
  ), [results]);
  const status = results[0]?.status ?? null;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: "success" }); }
    catch (e) { toast({ title: "Action failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" }); }
  };

  return (
    <Dialog open={Boolean(runId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Payroll Run</DialogTitle>
          <DialogDescription>Calculate salary, review each employee, then Finalize and Lock. A finalized/locked run can only be Reversed (controlled).</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => runId && act(() => calc.mutateAsync(runId), "Payroll calculated.")} disabled={calc.isPending}>
            <Calculator className="mr-1 h-4 w-4" /> {results.length === 0 ? "Calculate" : "Recalculate"}
          </Button>
          <Button size="sm" variant="secondary" disabled={status !== "calculated" || finalize.isPending}
            onClick={() => runId && act(() => finalize.mutateAsync(runId), "Payroll finalized — payslips generated.")}>
            <CheckCircle2 className="mr-1 h-4 w-4" /> Finalize
          </Button>
          <Button size="sm" variant="secondary" disabled={status !== "finalized" || lock.isPending}
            onClick={() => runId && act(() => lock.mutateAsync(runId), "Payroll locked.")}>
            <Lock className="mr-1 h-4 w-4" /> Lock
          </Button>
          <Button size="sm" variant="destructive" disabled={!(status === "finalized") && status !== null && status !== "reversed"}
            onClick={() => setReverseOpen(true)}>
            <RotateCcw className="mr-1 h-4 w-4" /> Reverse
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-5">
          <div><p className="text-xs text-muted-foreground">Employees</p><p className="font-medium">{results.length}</p></div>
          <div><p className="text-xs text-muted-foreground">Gross</p><p className="font-medium">{formatAmount(totals.g)}</p></div>
          <div><p className="text-xs text-muted-foreground">Deductions</p><p className="font-medium">{formatAmount(totals.d)}</p></div>
          <div><p className="text-xs text-muted-foreground">Advance Recovery</p><p className="font-medium text-amber-700">{formatAmount(totals.adv)}</p></div>
          <div><p className="text-xs text-muted-foreground">Net</p><p className="font-medium">{formatAmount(totals.net)}</p></div>
        </div>
        {totals.rev > 0 && (
          <p className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {totals.rev} employee result(s) flagged for review.</p>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="results">Employees ({results.length})</TabsTrigger>
            <TabsTrigger value="advrec">Advance Recovery ({advRecQuery.data?.length ?? 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="results">
            {resultsQuery.isLoading ? (
              <LoadingState />
            ) : results.length === 0 ? (
              <EmptyState icon={Calculator} title="Not calculated yet." description="Run Calculate to compute salary for all eligible employees." />
            ) : (
              <div className="max-h-[45vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead><TableHead>Basic</TableHead><TableHead>DA</TableHead>
                      <TableHead>Paid/Unpaid</TableHead><TableHead>Gross</TableHead><TableHead>Deductions</TableHead>
                      <TableHead>Advance Recovery</TableHead><TableHead>Net</TableHead><TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.id} className={r.needsReview ? "bg-amber-50/60" : undefined}>
                        <TableCell className="font-medium">
                          {r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode ?? "—"})</span>
                          {r.needsReview && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-600" />}
                        </TableCell>
                        <TableCell className="text-xs">{formatAmount(r.basic)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(r.da)}</TableCell>
                        <TableCell className="text-xs">{r.paidDays} / {r.unpaidDays}</TableCell>
                        <TableCell>{formatAmount(r.grossEarnings)}</TableCell>
                        <TableCell>{formatAmount(r.totalDeductions)}</TableCell>
                        <TableCell className="text-amber-700">{formatAmount(r.advanceRecoveryAmount)}</TableCell>
                        <TableCell className={`font-medium ${r.hasNegativeNet ? "text-destructive" : ""}`}>{formatAmount(r.netSalary)}</TableCell>
                        <TableCell><Button size="sm" variant="ghost" onClick={() => setDetailId(r.id)}>View</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="advrec">
            {advRecQuery.isLoading ? (
              <LoadingState />
            ) : (advRecQuery.data ?? []).length === 0 ? (
              <EmptyState icon={Wallet} title="No advance recovery in this run." />
            ) : (
              <div className="max-h-[45vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead><TableHead>Advance</TableHead><TableHead>Actual Paid</TableHead>
                      <TableHead>Recovered This Period</TableHead><TableHead>Total Recovered</TableHead><TableHead>Outstanding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(advRecQuery.data ?? []).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode ?? "—"})</span></TableCell>
                        <TableCell>{r.advanceTypeName}</TableCell>
                        <TableCell>{formatAmount(r.actualPaidAmount)}</TableCell>
                        <TableCell className="font-medium">{formatAmount(r.recoveredThisPeriod)}</TableCell>
                        <TableCell className="text-xs">{formatAmount(r.totalRecovered)}</TableCell>
                        <TableCell className="font-medium text-amber-700">{formatAmount(r.outstandingAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <ResultDetailDialog resultId={detailId} onClose={() => setDetailId(null)} />

        <Dialog open={reverseOpen} onOpenChange={(o) => !o && (setReverseOpen(false), setReverseReason(""))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reverse Payroll Run</DialogTitle>
              <DialogDescription>Original payroll & recovery records are kept; mirroring reversal lines are added and Advance Recovery is unwound (outstanding restored).</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5"><Label>Reason (required)</Label><Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} /></div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => (setReverseOpen(false), setReverseReason(""))} disabled={reverse.isPending}>Cancel</Button>
              <Button variant="destructive" disabled={reverse.isPending || !reverseReason.trim()}
                onClick={async () => { if (!runId) return; await act(() => reverse.mutateAsync({ runId, reason: reverseReason.trim() }), "Payroll reversed."); setReverseOpen(false); setReverseReason(""); }}>
                {reverse.isPending ? "Reversing…" : "Confirm Reverse"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function ResultDetailDialog({ resultId, onClose }: { resultId: string | null; onClose: () => void }) {
  const detailQuery = usePayrollEmployeeResult(resultId ?? undefined);
  const linesQuery = usePayrollResultLines(resultId ?? undefined);
  const d = detailQuery.data ?? null;
  const lines = linesQuery.data ?? [];
  const earnings = lines.filter((l) => l.lineType === "earning");
  const deductions = lines.filter((l) => l.lineType === "deduction");
  const employerContribs = lines.filter((l) => l.lineType === "employer_contribution");
  const basis = (l: (typeof lines)[number]) =>
    l.calcType === "formula" ? l.calcFormula
      : l.calcBase ? `${l.calcRate ?? ""}% of ${l.calcBase}`
      : l.calcType && l.calcType !== "attendance_input" ? l.calcType
      : l.quantity != null ? `${l.quantity}${l.rate != null ? ` × ${l.rate}` : ""}` : null;

  return (
    <Dialog open={Boolean(resultId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Employee Payroll — {d?.employeeName ?? ""}</DialogTitle>
          <DialogDescription>Salary snapshot, attendance & leave inputs, earnings, deductions and net.</DialogDescription>
        </DialogHeader>
        {detailQuery.isLoading || !d ? (
          <LoadingState rows={5} />
        ) : (
          <div className="space-y-4 text-sm">
            {d.needsReview && d.reviewNotes && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-medium">Review flags</p>
                <p>{d.reviewNotes}</p>
              </div>
            )}
            <section className="grid gap-2 sm:grid-cols-3">
              <F l="Code">{d.employeeCode ?? "—"}</F>
              <F l="Department">{d.department ?? "—"}</F>
              <F l="Designation">{d.designation ?? "—"}</F>
              <F l="Store">{d.store ?? "—"}</F>
              <F l="Period">{formatDate(d.periodMonth)}</F>
              <F l="Salary effective">{d.salaryEffectiveFrom ? formatDate(d.salaryEffectiveFrom) : "—"}</F>
              <F l="Salary source">
                {d.salaryStructureId
                  ? <>Structure <span className="font-mono text-xs">{d.structureName ?? d.salaryStructureId.slice(0, 8)}</span>{d.grossFromStructure != null ? ` · Gross ${formatAmount(d.grossFromStructure)}` : ""}</>
                  : "Legacy Basic + DA"}
              </F>
              {d.employerContributionTotal > 0 && <F l="Employer contributions">{formatAmount(d.employerContributionTotal)} <span className="text-xs font-normal text-muted-foreground">(not in Net)</span></F>}
            </section>

            {(d.leavingDateSnapshot || d.eligibleDays != null || d.exitProrationAmount !== 0 || d.storeCalendarId) && (
              <section className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-4">
                <F l="Leaving date">{d.leavingDateSnapshot ? formatDate(d.leavingDateSnapshot) : "—"}</F>
                <F l="Eligible days">{d.eligibleDays ?? "—"}</F>
                <F l="Exit proration">{d.exitProrationAmount !== 0 ? formatAmount(d.exitProrationAmount) : "—"}</F>
                {d.storeCalendarSnapshot && (
                  <F l="Store calendar">
                    {String((d.storeCalendarSnapshot as Record<string, unknown>).name ?? "—")}
                    {" · "}{String((d.storeCalendarSnapshot as Record<string, unknown>).working_days ?? "?")} working days
                  </F>
                )}
                {d.salaryStructureScope && <F l="Salary structure scope">{d.salaryStructureScope}</F>}
              </section>
            )}

            {d.policySnapshot && (
              <section className="rounded-lg border bg-muted/30 p-3 text-xs">
                <p className="mb-1 font-medium">Payroll Policy snapshot</p>
                <div className="grid gap-1 sm:grid-cols-3">
                  <span>Policy: <b>{String((d.policySnapshot as Record<string, unknown>).policy_code ?? "—")}</b> v{String((d.policySnapshot as Record<string, unknown>).version_no ?? "")}</span>
                  <span>Proration: {String((d.policySnapshot as Record<string, unknown>).proration_method ?? "not configured")}</span>
                  <span>Exit date payable: {String((d.policySnapshot as Record<string, unknown>).exit_date_payable ?? "not confirmed")}</span>
                  <span>LWP deduction: {formatAmount(d.lwpDeductionAmount)}</span>
                  <span>Statutory total: {formatAmount(d.statutoryDeductionTotal)}</span>
                  {d.prorationFactor != null && d.prorationFactor !== 1 && <span>Proration factor: {d.prorationFactor}</span>}
                  {(() => {
                    const t = (d.policySnapshot as Record<string, unknown>).tds as { configured?: boolean; reason?: string; monthly_tds?: number } | undefined;
                    return t ? <span>TDS: {t.configured ? formatAmount(Number(t.monthly_tds ?? 0)) : `Not configured (${t.reason ?? ""})`}</span> : null;
                  })()}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Finalized/locked payroll keeps this snapshot — a later policy, calendar, grade, category or structure change never recalculates it.</p>
              </section>
            )}
            <section className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/40 p-3 sm:grid-cols-6">
              <F l="Calendar">{d.calendarDays}</F>
              <F l="Working">{d.workingDays}</F>
              <F l="Present">{d.presentDays}</F>
              <F l="Paid Leave">{d.paidLeaveDays}</F>
              <F l="LWP">{d.lwpDays}</F>
              <F l="Absent">{d.absentDays}</F>
              <F l="Weekly Off">{d.weeklyOffDays}</F>
              <F l="Holiday">{d.holidayDays}</F>
              <F l="Paid Days">{d.paidDays}</F>
              <F l="Unpaid Days">{d.unpaidDays}</F>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Earnings</p>
                <Table>
                  <TableBody>
                    {earnings.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">
                          {l.name}{l.isReversal ? " (rev)" : ""}
                          {basis(l) ? <span className="ml-1 text-[11px] text-muted-foreground">· {basis(l)}</span> : null}
                        </TableCell>
                        <TableCell className="text-right text-xs">{formatAmount(l.amount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow><TableCell className="text-xs font-medium">Gross Earnings</TableCell><TableCell className="text-right text-xs font-medium">{formatAmount(d.grossEarnings)}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Deductions</p>
                <Table>
                  <TableBody>
                    {deductions.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">
                          {l.name}{l.isReversal ? " (rev)" : ""}
                          {basis(l) ? <span className="ml-1 text-[11px] text-muted-foreground">· {basis(l)}</span> : null}
                        </TableCell>
                        <TableCell className="text-right text-xs">{formatAmount(l.amount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow><TableCell className="text-xs font-medium">Total Deductions</TableCell><TableCell className="text-right text-xs font-medium">{formatAmount(d.totalDeductions)}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            {employerContribs.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Employer Contributions <span className="font-normal">— shown for CTC; not deducted from Net</span></p>
                <Table>
                  <TableBody>
                    {employerContribs.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">
                          {l.name}{l.isReversal ? " (rev)" : ""}
                          {basis(l) ? <span className="ml-1 text-[11px] text-muted-foreground">· {basis(l)}</span> : null}
                        </TableCell>
                        <TableCell className="text-right text-xs">{formatAmount(l.amount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow><TableCell className="text-xs font-medium">Total Employer Contribution</TableCell><TableCell className="text-right text-xs font-medium">{formatAmount(d.employerContributionTotal)}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            <div className={`rounded-lg border p-3 text-center font-semibold ${d.hasNegativeNet ? "border-destructive text-destructive" : "border-emerald-200 text-emerald-700"}`}>
              Net Salary: {formatAmount(d.netSalary)} {d.hasNegativeNet ? "(negative — deductions exceed gross)" : ""}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function F({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{l}</p>
      <p className="font-medium">{children}</p>
    </div>
  );
}
