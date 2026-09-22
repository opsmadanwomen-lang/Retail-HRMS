import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserMinus, Plus, ShieldAlert, CheckCircle2, XCircle, Send, Ban, Undo2, Wallet } from "lucide-react";

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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { usePayrollAdmin } from "@/hooks/usePayroll";
import { useAssignableEmployees } from "@/hooks/useEmployees";
import {
  useExitTypes, useExitRequestList, useExitRequestDetail, useCreateExitRequest, useExitRequestAction, useExitRegister,
} from "@/hooks/useExit";
import { formatDate } from "@/lib/utils";
import { formatAmount } from "@/modules/advance/utils";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STATUS_VARIANT: Record<string, "success" | "secondary" | "warning" | "destructive"> = {
  approved: "success", completed: "success", draft: "warning", submitted: "warning", under_approval: "warning", sent_back: "warning",
  rejected: "destructive", cancelled: "destructive",
};

export function ExitRequestsPage() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;
  const adminQ = usePayrollAdmin(companyId);
  const isAdmin = adminQ.data === true || user?.role === "super_admin";
  const listQ = useExitRequestList(isAdmin ? companyId : undefined);
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const navigate = useNavigate();

  if (adminQ.isLoading) return <LoadingState />;
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Employee Exit Requests" description="Exit request → approval → leaving date effective → F&F." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="Exit administration reuses the Finance Processor roster — you are not an active Finance Processor." />
      </div>
    );
  }
  const rows = listQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader title="Employee Exit Requests" description="Exit Request → configured approval stages → Approved (leaving date becomes effective) → F&F. The leaving date is never set directly outside this workflow." />
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> New Exit Request</Button>
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests ({rows.length})</TabsTrigger>
          <TabsTrigger value="register">Exit Register</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="pt-3">
          <Card>
            <CardContent className="pt-4">
              {listQ.isLoading ? <LoadingState /> : rows.length === 0 ? (
                <EmptyState icon={UserMinus} title="No exit requests yet" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Employee</TableHead><TableHead>Exit type</TableHead><TableHead>Requested leaving</TableHead>
                      <TableHead>Effective leaving</TableHead><TableHead>Status</TableHead><TableHead>F&F</TableHead><TableHead></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                          <TableCell className="font-medium">{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode ?? "—"})</span></TableCell>
                          <TableCell className="text-xs capitalize">{r.exitType}</TableCell>
                          <TableCell className="text-xs">{formatDate(r.requestedLeavingDate)}</TableCell>
                          <TableCell className="text-xs">{r.effectiveLeavingDate ? formatDate(r.effectiveLeavingDate) : "—"}</TableCell>
                          <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "secondary"} className="capitalize">{r.status.replace("_", " ")}</Badge></TableCell>
                          <TableCell>
                            {r.fnfSettlementId
                              ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/payroll/fnf/${r.fnfSettlementId}`); }}><Wallet className="mr-1 h-3.5 w-3.5" /> Open</Button>
                              : <span className="text-xs text-muted-foreground">{r.status === "approved" ? "Available" : "—"}</span>}
                          </TableCell>
                          <TableCell><Button size="sm" variant="ghost">Open</Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="register" className="pt-3">
          <RegisterTab companyId={companyId as string} />
        </TabsContent>
      </Tabs>

      <NewExitRequestDialog open={open} onClose={() => setOpen(false)} companyId={companyId as string} onCreated={(id) => { setOpen(false); setDetailId(id); }} />
      <ExitRequestDetailDialog id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function NewExitRequestDialog({ open, onClose, companyId, onCreated }: { open: boolean; onClose: () => void; companyId: string; onCreated: (id: string) => void }) {
  const empQ = useAssignableEmployees(companyId);
  const typesQ = useExitTypes(companyId);
  const create = useCreateExitRequest();
  const [f, setF] = useState({ employeeId: "", exitTypeId: "", requestedLeavingDate: "", reason: "", notes: "", noticePeriodDays: "", noticeServedDays: "" });

  const submit = async () => {
    if (!f.employeeId || !f.exitTypeId || !f.requestedLeavingDate) { toast({ title: "Employee, exit type and leaving date are required.", variant: "destructive" }); return; }
    try {
      const row = await create.mutateAsync({
        companyId, employeeId: f.employeeId, exitTypeId: f.exitTypeId, requestedLeavingDate: f.requestedLeavingDate,
        reason: f.reason || undefined, notes: f.notes || undefined,
        noticePeriodDays: Number(f.noticePeriodDays) || 0, noticeServedDays: Number(f.noticeServedDays) || 0,
      });
      toast({ title: "Exit request created (draft).", variant: "success" });
      onCreated(row.id);
      setF({ employeeId: "", exitTypeId: "", requestedLeavingDate: "", reason: "", notes: "", noticePeriodDays: "", noticeServedDays: "" });
    } catch (e) { toast({ title: "Create failed", description: msg(e), variant: "destructive" }); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Exit Request</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Employee</Label>
            <Select value={f.employeeId} onValueChange={(v) => setF({ ...f, employeeId: v })}>
              <SelectTrigger><SelectValue placeholder="Pick an employee" /></SelectTrigger>
              <SelectContent>{(empQ.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeCode ?? "—"})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Exit type</Label>
              <Select value={f.exitTypeId} onValueChange={(v) => setF({ ...f, exitTypeId: v })}>
                <SelectTrigger><SelectValue placeholder="Pick a type" /></SelectTrigger>
                <SelectContent>{(typesQ.data ?? []).filter((t) => t.isActive).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
              {(typesQ.data ?? []).length === 0 && <p className="text-[11px] text-amber-700">No exit types configured — add one in Exit / F&F Settings.</p>}
            </div>
            <div className="space-y-1.5"><Label>Requested leaving date</Label><Input type="date" value={f.requestedLeavingDate} onChange={(e) => setF({ ...f, requestedLeavingDate: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Notice period (days)</Label><Input type="number" value={f.noticePeriodDays} onChange={(e) => setF({ ...f, noticePeriodDays: e.target.value })} placeholder="0" /></div>
            <div className="space-y-1.5"><Label>Notice served (days)</Label><Input type="number" value={f.noticeServedDays} onChange={(e) => setF({ ...f, noticeServedDays: e.target.value })} placeholder="0" /></div>
          </div>
          <div className="space-y-1.5"><Label>Reason</Label><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Notes</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExitRequestDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useExitRequestDetail(id ?? undefined);
  const act = useExitRequestAction();
  const navigate = useNavigate();
  const [reasonOpen, setReasonOpen] = useState<null | "reject" | "send_back" | "cancel" | "correct">(null);
  const [reason, setReason] = useState("");
  const [newDate, setNewDate] = useState("");
  const d = q.data;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: "success" }); }
    catch (e) { toast({ title: "Action failed", description: msg(e), variant: "destructive" }); }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Exit Request — {d?.employeeName ?? ""}</DialogTitle></DialogHeader>
        {q.isLoading || !d ? <LoadingState rows={4} /> : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"} className="capitalize">{d.status.replace("_", " ")}</Badge>
              <span className="text-xs text-muted-foreground">{d.exitType?.name ?? ""} · step {d.currentStep}/{d.maxStage}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">Requested leaving: </span>{formatDate(d.requestedLeavingDate)}</div>
              <div><span className="text-muted-foreground">Effective leaving: </span>{d.effectiveLeavingDate ? formatDate(d.effectiveLeavingDate) : "—"}</div>
              <div><span className="text-muted-foreground">Notice: </span>{d.noticeServedDays}/{d.noticePeriodDays} days served</div>
            </div>
            {d.reason && <p className="text-xs text-muted-foreground">{d.reason}</p>}
            <div className="flex flex-wrap gap-2">
              {d.status === "draft" && <Button size="sm" onClick={() => run(() => act.mutateAsync({ kind: "submit", id: d.id }), "Submitted.")}><Send className="mr-1 h-4 w-4" /> Submit</Button>}
              {d.status === "under_approval" && <>
                <Button size="sm" onClick={() => run(() => act.mutateAsync({ kind: "decide", id: d.id, action: "approve" }), "Approved.")}><CheckCircle2 className="mr-1 h-4 w-4" /> Approve</Button>
                <Button size="sm" variant="outline" onClick={() => setReasonOpen("send_back")}><Undo2 className="mr-1 h-4 w-4" /> Send back</Button>
                <Button size="sm" variant="destructive" onClick={() => setReasonOpen("reject")}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
              </>}
              {d.status === "sent_back" && <Button size="sm" onClick={() => run(() => act.mutateAsync({ kind: "submit", id: d.id }), "Resubmitted.")}><Send className="mr-1 h-4 w-4" /> Resubmit</Button>}
              {["draft", "under_approval", "sent_back"].includes(d.status) && <Button size="sm" variant="outline" onClick={() => setReasonOpen("cancel")}><Ban className="mr-1 h-4 w-4" /> Cancel</Button>}
              {d.status === "approved" && !d.fnfSettlementId && (
                <Button size="sm" onClick={() => run(() => act.mutateAsync({ kind: "create_fnf", id: d.id }), "F&F created.")}><Wallet className="mr-1 h-4 w-4" /> Start F&F</Button>
              )}
              {d.status === "approved" && d.fnfSettlementId && (
                <Button size="sm" variant="outline" onClick={() => navigate(`/payroll/fnf/${d.fnfSettlementId}`)}><Wallet className="mr-1 h-4 w-4" /> Open F&F</Button>
              )}
              {d.status === "approved" && <Button size="sm" variant="outline" onClick={() => { setNewDate(d.effectiveLeavingDate ?? d.requestedLeavingDate); setReasonOpen("correct"); }}>Correct leaving date</Button>}
            </div>
            <div className="rounded-lg border p-3 text-xs">
              <p className="mb-1 font-medium">History</p>
              {d.decisions.map((ev) => (
                <div key={ev.id} className="flex justify-between border-b py-1 last:border-0">
                  <span className="capitalize">step {ev.stepNo} · {ev.action.replace("_", " ")}{ev.remark ? ` — ${ev.remark}` : ""}</span>
                  <span className="text-muted-foreground">{formatDate(ev.decidedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <Dialog open={Boolean(reasonOpen)} onOpenChange={(o) => !o && setReasonOpen(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle className="capitalize">{reasonOpen?.replace("_", " ")} — {reasonOpen === "correct" ? "audited correction" : "reason required"}</DialogTitle></DialogHeader>
            {reasonOpen === "correct" && <div className="space-y-1.5"><Label>New leaving date</Label><Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></div>}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason…" />
            <DialogFooter>
              <Button variant="secondary" onClick={() => { setReasonOpen(null); setReason(""); }}>Back</Button>
              <Button variant={reasonOpen === "send_back" ? "default" : "destructive"} disabled={!reason.trim() || (reasonOpen === "correct" && !newDate)} onClick={async () => {
                if (!d) return;
                if (reasonOpen === "reject") await run(() => act.mutateAsync({ kind: "decide", id: d.id, action: "reject", remark: reason }), "Rejected.");
                else if (reasonOpen === "send_back") await run(() => act.mutateAsync({ kind: "decide", id: d.id, action: "send_back", remark: reason }), "Sent back.");
                else if (reasonOpen === "cancel") await run(() => act.mutateAsync({ kind: "cancel", id: d.id, reason }), "Cancelled.");
                else if (reasonOpen === "correct") await run(() => act.mutateAsync({ kind: "correct", id: d.id, newDate, reason }), "Leaving date corrected.");
                setReasonOpen(null); setReason("");
              }}>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function RegisterTab({ companyId }: { companyId: string }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const q = useExitRegister(companyId, range.from || null, range.to || null);
  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">Exit Register</CardTitle>
        <div className="flex items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Left from</Label><Input type="date" className="h-8" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">to</Label><Input type="date" className="h-8" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <LoadingState /> : rows.length === 0 ? <EmptyState icon={UserMinus} title="No exits in range" /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Staff ID</TableHead><TableHead>Employee</TableHead><TableHead>Store</TableHead><TableHead>Department</TableHead>
                <TableHead>Joined</TableHead><TableHead>Left</TableHead><TableHead>Exit type</TableHead><TableHead>Reason</TableHead>
                <TableHead>Exit status</TableHead><TableHead>F&F status</TableHead><TableHead>F&F amount</TableHead><TableHead>Payment</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.staffId ?? "—"}</TableCell>
                    <TableCell className="font-medium">{r.employeeName}</TableCell>
                    <TableCell className="text-xs">{r.store ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.department ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.joiningDate ? formatDate(r.joiningDate) : "—"}</TableCell>
                    <TableCell className="text-xs">{formatDate(r.leavingDate)}</TableCell>
                    <TableCell className="text-xs capitalize">{r.exitType}</TableCell>
                    <TableCell className="text-xs">{r.reason ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.exitStatus ?? "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{r.fnfStatus.replace("_", " ")}</TableCell>
                    <TableCell className="text-xs">{r.fnfAmount != null ? formatAmount(r.fnfAmount) : "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{r.paymentStatus.replace("_", " ")}</TableCell>
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
