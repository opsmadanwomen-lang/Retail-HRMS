import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Calculator, Send, CheckCircle2, XCircle, Undo2, Wallet, RotateCcw, AlertTriangle, ArrowLeft, Plus, FileText, Printer,
} from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useFnfDetail, useCalculateFnf, useFnfAction, useAddFnfAdjustment, useFnfAmIApprover } from "@/hooks/useFnf";
import { formatDate } from "@/lib/utils";
import { formatAmount } from "@/modules/advance/utils";
import type { FnfLine } from "@/types/fnf";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EDITABLE = ["draft", "under_review", "calculated", "sent_back"];

export function FnfDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;
  const q = useFnfDetail(id);
  const approverQ = useFnfAmIApprover(companyId);
  const calc = useCalculateFnf();
  const act = useFnfAction();
  const [adjOpen, setAdjOpen] = useState(false);
  const [reasonDlg, setReasonDlg] = useState<null | { kind: "reject" | "send_back" | "reverse" }>(null);
  const [reason, setReason] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);

  if (q.isLoading || !q.data) return <LoadingState />;
  const { settlement: s, lines, adjustments, payments, events } = q.data;
  const isApprover = approverQ.data === true || user?.role === "super_admin";
  const editable = EDITABLE.includes(s.status);
  const earnings = lines.filter((l) => l.lineType === "earning");
  const deductions = lines.filter((l) => l.lineType === "deduction");
  const employer = lines.filter((l) => l.lineType === "employer_contribution");
  const outstanding = s.netSettlement - s.amountPaid;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: "success" }); }
    catch (e) { toast({ title: "Action failed", description: msg(e), variant: "destructive" }); }
  };
  const doReasonAction = async () => {
    if (!reasonDlg || !reason.trim()) return;
    await run(() => act.mutateAsync({ kind: reasonDlg.kind, id, reason: reason.trim() } as any),
      reasonDlg.kind === "reverse" ? "F&F reversed." : reasonDlg.kind === "reject" ? "F&F rejected." : "Sent back.");
    setReasonDlg(null); setReason("");
  };

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate("/payroll/fnf")}><ArrowLeft className="mr-1 h-4 w-4" /> All settlements</Button>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader
          title={`F&F — ${s.employeeName ?? ""}`}
          description={`${s.employeeCode ?? "—"} · ${s.store ?? "—"} · joined ${s.joiningDate ? formatDate(s.joiningDate) : "—"} · leaving ${formatDate(s.leavingDate)} · ${s.exitType.replace("_", " ")}${s.version > 1 ? ` · correction v${s.version}` : ""}`}
        />
        <Badge className="capitalize" variant={["approved", "paid", "closed"].includes(s.status) ? "success" : ["rejected", "reversed"].includes(s.status) ? "destructive" : "warning"}>
          {s.status.replace("_", " ")}
        </Badge>
      </div>

      {s.needsReview && s.reviewNotes && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="flex items-center gap-1 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> Review flags</p>
          <p className="mt-1">{s.reviewNotes}</p>
        </div>
      )}

      {/* action bar */}
      <div className="flex flex-wrap gap-2">
        {editable && <Button size="sm" onClick={() => run(() => calc.mutateAsync(id), "F&F calculated.")} disabled={calc.isPending}><Calculator className="mr-1 h-4 w-4" /> {s.status === "draft" ? "Calculate" : "Recalculate"}</Button>}
        {editable && <Button size="sm" variant="outline" onClick={() => setAdjOpen(true)}><Plus className="mr-1 h-4 w-4" /> Add adjustment</Button>}
        {(s.status === "calculated" || s.status === "sent_back") && <Button size="sm" variant="secondary" onClick={() => run(() => act.mutateAsync({ kind: "submit", id }), "Submitted for approval.")}><Send className="mr-1 h-4 w-4" /> Submit</Button>}
        {s.status === "pending_approval" && isApprover && <>
          <Button size="sm" onClick={() => run(() => act.mutateAsync({ kind: "approve", id }), "F&F approved — snapshot frozen.")}><CheckCircle2 className="mr-1 h-4 w-4" /> Approve</Button>
          <Button size="sm" variant="outline" onClick={() => setReasonDlg({ kind: "send_back" })}><Undo2 className="mr-1 h-4 w-4" /> Send back</Button>
          <Button size="sm" variant="destructive" onClick={() => setReasonDlg({ kind: "reject" })}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
        </>}
        {["approved", "payment_pending", "partially_paid"].includes(s.status) && <Button size="sm" onClick={() => setPayOpen(true)}><Wallet className="mr-1 h-4 w-4" /> Record payment</Button>}
        {["approved", "payment_pending", "partially_paid", "paid", "closed"].includes(s.status) && isApprover && (
          <Button size="sm" variant="destructive" onClick={() => setReasonDlg({ kind: "reverse" })}><RotateCcw className="mr-1 h-4 w-4" /> Reverse</Button>
        )}
        {s.snapshot != null && <Button size="sm" variant="outline" onClick={() => setStatementOpen(true)}><FileText className="mr-1 h-4 w-4" /> F&F Statement</Button>}
      </div>

      {/* summary */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-5">
        <div><p className="text-xs text-muted-foreground">Total Earnings</p><p className="font-medium">{formatAmount(s.grossEarnings)}</p></div>
        <div><p className="text-xs text-muted-foreground">Total Deductions</p><p className="font-medium">{formatAmount(s.totalDeductions)}</p></div>
        <div><p className="text-xs text-muted-foreground">Advance Recovered</p><p className="font-medium text-amber-700">{formatAmount(s.advanceRecovered)}</p></div>
        <div><p className="text-xs text-muted-foreground">Net F&F</p><p className={`font-medium ${s.hasNegativeNet ? "text-destructive" : ""}`}>{formatAmount(s.netSettlement)}</p></div>
        <div><p className="text-xs text-muted-foreground">Paid / Outstanding</p><p className="font-medium">{formatAmount(s.amountPaid)} / {formatAmount(outstanding)}</p></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LineCard title="Earnings" lines={earnings} total={s.grossEarnings} totalLabel="Total Earnings" />
        <LineCard title="Deductions" lines={deductions} total={s.totalDeductions} totalLabel="Total Deductions" />
      </div>
      {employer.length > 0 && <LineCard title="Employer Contributions (CTC — not in Net)" lines={employer} total={s.employerContributionTotal} totalLabel="Total" />}

      <div className="rounded-lg border p-3 text-center font-semibold">
        Net F&F Settlement: <span className={s.hasNegativeNet ? "text-destructive" : "text-emerald-700"}>{formatAmount(s.netSettlement)}</span>
        {s.advanceRemaining > 0 && <span className="ml-2 text-xs font-normal text-amber-700">(advance remaining {formatAmount(s.advanceRemaining)})</span>}
      </div>

      {adjustments.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Manual adjustments (audited)</CardTitle></CardHeader>
          <CardContent className="text-xs">
            {adjustments.map((a) => (
              <div key={a.id} className="flex justify-between border-b py-1 last:border-0">
                <span>{a.lineType === "earning" ? "+" : "−"} {a.name} <span className="text-muted-foreground">· {a.reason}</span></span>
                <span className="font-medium">{formatAmount(a.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {payments.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Payments</CardTitle></CardHeader>
          <CardContent className="text-xs">
            {payments.map((p) => (
              <div key={p.id} className="flex justify-between border-b py-1 last:border-0">
                <span>{formatDate(p.paymentDate)} · {p.paymentMode ?? "—"} {p.transactionReference ? `· ${p.transactionReference}` : ""}</span>
                <span className="font-medium">{formatAmount(p.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">History</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {events.map((ev) => (
            <div key={ev.id} className="flex justify-between border-b py-1 last:border-0">
              <span className="capitalize">{ev.event.replace("_", " ")}{ev.reason ? ` — ${ev.reason}` : ""}</span>
              <span className="text-muted-foreground">{formatDate(ev.createdAt)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* dialogs */}
      <AdjustmentDialog open={adjOpen} onClose={() => setAdjOpen(false)} id={id} />
      <Dialog open={Boolean(reasonDlg)} onOpenChange={(o) => { if (!o) { setReasonDlg(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="capitalize">{reasonDlg?.kind.replace("_", " ")} — reason required</DialogTitle></DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason…" />
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setReasonDlg(null); setReason(""); }}>Cancel</Button>
            <Button variant={reasonDlg?.kind === "send_back" ? "default" : "destructive"} disabled={!reason.trim() || act.isPending} onClick={doReasonAction}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PayDialog open={payOpen} onClose={() => setPayOpen(false)} id={id} outstanding={outstanding} />
      <StatementDialog open={statementOpen} onClose={() => setStatementOpen(false)} snapshot={s.snapshot} version={s.version} status={s.status} />
    </div>
  );
}

/**
 * F&F Statement — renders ONLY the immutable, frozen `snapshot` captured at
 * approval (fnf_approve). Never recalculates. Consistent with the existing
 * payslip document architecture: a printable in-page view + window.print()
 * (browser "Save as PDF"), not a separate PDF-generation engine. If this F&F
 * is later reversed, the ORIGINAL settlement (and this exact snapshot) stays
 * historical; a corrected F&F is a NEW settlement with its own snapshot/version.
 */
function StatementDialog({ open, onClose, snapshot, version, status }: { open: boolean; onClose: () => void; snapshot: unknown; version: number; status: string }) {
  const s = (snapshot ?? {}) as any;
  const lines: any[] = Array.isArray(s.lines) ? s.lines : [];
  const earnings = lines.filter((l) => l.line_type === "earning");
  const deductions = lines.filter((l) => l.line_type === "deduction");
  const employer = lines.filter((l) => l.line_type === "employer_contribution");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>F&F Statement{version > 1 ? ` — correction v${version}` : ""}</DialogTitle></DialogHeader>
        {!snapshot ? <LoadingState rows={4} /> : (
          <div id="fnf-statement-print" className="space-y-4 text-sm">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-base font-semibold">{s.employee_name}</p>
                <p className="text-xs text-muted-foreground">{s.employee_code ?? "—"} · {s.store ?? "—"} · {s.department ?? "—"} · {s.designation ?? "—"}</p>
              </div>
              <div className="text-right text-xs">
                <p className="font-medium">Full &amp; Final Settlement</p>
                <p className="text-muted-foreground">Frozen {s.frozen_at ? formatDate(s.frozen_at) : "—"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div><span className="text-muted-foreground">Joining date: </span>{s.joining_date ? formatDate(s.joining_date) : "—"}</div>
              <div><span className="text-muted-foreground">Leaving date: </span>{s.leaving_date ? formatDate(s.leaving_date) : "—"}</div>
              <div><span className="text-muted-foreground">Exit type: </span>{s.exit_type ?? "—"}</div>
              <div><span className="text-muted-foreground">Notice: </span>{s.notice?.served ?? 0}/{s.notice?.required ?? 0} days{s.notice?.waived ? " (waived)" : ""}</div>
              <div><span className="text-muted-foreground">Settlement status: </span><span className="capitalize">{status.replace("_", " ")}</span></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 font-medium">Earnings</p>
                <table className="w-full text-xs">
                  <tbody>
                    {earnings.map((l, i) => <tr key={i}><td>{l.name}</td><td className="text-right">{formatAmount(l.amount)}</td></tr>)}
                    <tr className="border-t font-medium"><td>Total Earnings</td><td className="text-right">{formatAmount(s.gross_earnings)}</td></tr>
                  </tbody>
                </table>
              </div>
              <div>
                <p className="mb-1 font-medium">Deductions</p>
                <table className="w-full text-xs">
                  <tbody>
                    {deductions.map((l, i) => <tr key={i}><td>{l.name}</td><td className="text-right">{formatAmount(l.amount)}</td></tr>)}
                    <tr className="border-t font-medium"><td>Total Deductions</td><td className="text-right">{formatAmount(s.total_deductions)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            {employer.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Employer Contributions <span className="font-normal text-muted-foreground">(CTC — not in Net)</span></p>
                <table className="w-full text-xs"><tbody>{employer.map((l, i) => <tr key={i}><td>{l.name}</td><td className="text-right">{formatAmount(l.amount)}</td></tr>)}</tbody></table>
              </div>
            )}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center font-semibold text-emerald-800">
              Net F&F Settlement: {formatAmount(s.net_settlement)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div><span className="text-muted-foreground">Advance recovered: </span>{formatAmount(s.advance_recovered)}</div>
              <div><span className="text-muted-foreground">Advance remaining: </span>{formatAmount(s.advance_remaining)}</div>
              <div><span className="text-muted-foreground">Approved: </span>{s.frozen_at ? formatDate(s.frozen_at) : "—"}</div>
            </div>
            <div className="flex justify-end print:hidden">
              <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" /> Print / Save as PDF</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LineCard({ title, lines, total, totalLabel }: { title: string; lines: FnfLine[]; total: number; totalLabel: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs">
                  {l.name}{l.isAdjustment ? " (adj)" : ""}{l.isProtected ? " · protected" : ""}
                  {l.calcNote ? <span className="ml-1 block text-[11px] text-muted-foreground">{l.calcNote}</span> : null}
                </TableCell>
                <TableCell className="text-right text-xs">{formatAmount(l.amount)}</TableCell>
              </TableRow>
            ))}
            {lines.length === 0 && <TableRow><TableCell className="text-xs text-muted-foreground">—</TableCell><TableCell /></TableRow>}
            <TableRow><TableCell className="text-xs font-medium">{totalLabel}</TableCell><TableCell className="text-right text-xs font-medium">{formatAmount(total)}</TableCell></TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AdjustmentDialog({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const add = useAddFnfAdjustment();
  const [f, setF] = useState({ lineType: "earning" as "earning" | "deduction", code: "", name: "", amount: "", reason: "" });
  const submit = async () => {
    if (!f.code.trim() || !f.name.trim() || !f.reason.trim()) { toast({ title: "Code, name and reason are required.", variant: "destructive" }); return; }
    try {
      await add.mutateAsync({ id, lineType: f.lineType, code: f.code.trim().toUpperCase(), name: f.name.trim(), amount: Number(f.amount) || 0, reason: f.reason.trim() });
      toast({ title: "Adjustment added — recalculate to apply.", variant: "success" });
      setF({ lineType: "earning", code: "", name: "", amount: "", reason: "" });
      onClose();
    } catch (e) { toast({ title: "Failed", description: msg(e), variant: "destructive" }); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Manual F&F adjustment</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={f.lineType} onValueChange={(v) => setF({ ...f, lineType: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="earning">Earning</SelectItem><SelectItem value="deduction">Deduction</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Amount ₹</Label><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Code</Label><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="ARREARS / BONUS / …" /></div>
            <div className="space-y-1.5"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label>Reason (required, audited)</Label><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
          <p className="text-[11px] text-muted-foreground">Overtime cannot be added here — OT comes only from Attendance OT Rules.</p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={add.isPending}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ open, onClose, id, outstanding }: { open: boolean; onClose: () => void; id: string; outstanding: number }) {
  const act = useFnfAction();
  const [f, setF] = useState({ amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMode: "bank_transfer", ref: "", bank: "", notes: "" });
  const submit = async () => {
    const amt = Number(f.amount);
    if (!amt || amt <= 0 || !f.paymentDate) { toast({ title: "Amount and date are required.", variant: "destructive" }); return; }
    try {
      await act.mutateAsync({ kind: "pay", id, amount: amt, paymentDate: f.paymentDate, paymentMode: f.paymentMode, transactionReference: f.ref, bankDetails: f.bank, notes: f.notes });
      toast({ title: "Payment recorded.", variant: "success" });
      onClose();
    } catch (e) { toast({ title: "Payment failed", description: msg(e), variant: "destructive" }); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record F&F payment</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Outstanding: <b>{formatAmount(outstanding)}</b>. Partial payments are allowed; the F&F is only marked Paid/Closed when fully settled.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Amount ₹</Label><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Payment date</Label><Input type="date" value={f.paymentDate} onChange={(e) => setF({ ...f, paymentDate: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Mode</Label><Input value={f.paymentMode} onChange={(e) => setF({ ...f, paymentMode: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Transaction ref</Label><Input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Bank / reference details</Label><Input value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Notes</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={act.isPending}>Record payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
