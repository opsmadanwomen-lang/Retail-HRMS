import { useState } from "react";
import { ArrowRightLeft, Plus, ShieldAlert, CheckCircle2, XCircle, Send, Ban } from "lucide-react";

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
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { usePayrollAdmin } from "@/hooks/usePayroll";
import { useAssignableEmployees } from "@/hooks/useEmployees";
import { useStores } from "@/hooks/useStores";
import { useShifts } from "@/hooks/useShifts";
import { useSalaryStructures, useEmployeeGrades, useEmployeeCategories } from "@/hooks/usePayroll";
import {
  useTransferList, useTransferDetail, useCreateTransfer, useTransferAction, useTransferRegister,
} from "@/hooks/useTransfer";
import { formatDate } from "@/lib/utils";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STATUS_VARIANT: Record<string, "success" | "secondary" | "warning" | "destructive"> = {
  effective: "success", approved: "success", draft: "warning", pending_approval: "warning", rejected: "destructive", cancelled: "destructive",
};

function useStoreDepartments(companyId?: string) {
  return useQuery({
    queryKey: ["store-departments", companyId],
    queryFn: async () => { const { data, error } = await supabase.from("store_departments").select("id,name"); if (error) throw error; return data ?? []; },
    enabled: Boolean(companyId),
  });
}
function useStoreDesignations(companyId?: string) {
  return useQuery({
    queryKey: ["store-designations", companyId],
    queryFn: async () => { const { data, error } = await supabase.from("store_designations").select("id,title"); if (error) throw error; return data ?? []; },
    enabled: Boolean(companyId),
  });
}
function useStoreTeams(companyId?: string) {
  return useQuery({
    queryKey: ["store-teams", companyId],
    queryFn: async () => { const { data, error } = await supabase.from("store_teams").select("id,name"); if (error) throw error; return data ?? []; },
    enabled: Boolean(companyId),
  });
}

export function EmployeeTransfersPage() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;
  const adminQ = usePayrollAdmin(companyId);
  const isAdmin = adminQ.data === true || user?.role === "super_admin";
  const listQ = useTransferList(isAdmin ? companyId : undefined);
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  if (adminQ.isLoading) return <LoadingState />;
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Employee Transfers" description="Effective-dated store / department / designation / grade / manager / salary / shift changes." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="Transfer administration reuses the Finance Processor roster — you are not an active Finance Processor." />
      </div>
    );
  }
  const rows = listQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader title="Employee Transfers" description="Only the fields you change are updated. The transfer becomes effective on its Effective Date — history before that date is never rewritten." />
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> New Transfer</Button>
      </div>

      <Tabs defaultValue="transfers">
        <TabsList>
          <TabsTrigger value="transfers">Transfers ({rows.length})</TabsTrigger>
          <TabsTrigger value="register">Transfer Register</TabsTrigger>
        </TabsList>
        <TabsContent value="transfers" className="pt-3">
          <Card>
            <CardContent className="pt-4">
              {listQ.isLoading ? <LoadingState /> : rows.length === 0 ? (
                <EmptyState icon={ArrowRightLeft} title="No transfers yet" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Employee</TableHead><TableHead>Store</TableHead><TableHead>Department</TableHead>
                      <TableHead>Designation</TableHead><TableHead>Effective</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                          <TableCell className="font-medium">{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode ?? "—"})</span></TableCell>
                          <TableCell className="text-xs">{r.oldStore && r.newStore && r.oldStore !== r.newStore ? `${r.oldStore} → ${r.newStore}` : (r.newStore ?? r.oldStore ?? "—")}</TableCell>
                          <TableCell className="text-xs">{r.oldDepartment && r.newDepartment && r.oldDepartment !== r.newDepartment ? `${r.oldDepartment} → ${r.newDepartment}` : (r.newDepartment ?? "—")}</TableCell>
                          <TableCell className="text-xs">{r.oldDesignation && r.newDesignation && r.oldDesignation !== r.newDesignation ? `${r.oldDesignation} → ${r.newDesignation}` : (r.newDesignation ?? "—")}</TableCell>
                          <TableCell className="text-xs">{formatDate(r.effectiveDate)}</TableCell>
                          <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "secondary"} className="capitalize">{r.status.replace("_", " ")}</Badge></TableCell>
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

      <NewTransferDialog open={open} onClose={() => setOpen(false)} companyId={companyId as string} onCreated={(id) => { setOpen(false); setDetailId(id); }} />
      <TransferDetailDialog id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function NewTransferDialog({ open, onClose, companyId, onCreated }: { open: boolean; onClose: () => void; companyId: string; onCreated: (id: string) => void }) {
  const empQ = useAssignableEmployees(companyId);
  const storesQ = useStores(companyId);
  const deptQ = useStoreDepartments(companyId);
  const desigQ = useStoreDesignations(companyId);
  const teamQ = useStoreTeams(companyId);
  const gradeQ = useEmployeeGrades(companyId);
  const catQ = useEmployeeCategories(companyId);
  const shiftQ = useShifts(companyId);
  const structQ = useSalaryStructures(companyId);
  const create = useCreateTransfer();
  const [f, setF] = useState<Record<string, string>>({ employeeId: "", effectiveDate: "", reason: "" });

  const pick = (v: string) => (v === "__none__" ? "" : v);
  const submit = async () => {
    if (!f.employeeId || !f.effectiveDate) { toast({ title: "Employee and effective date are required.", variant: "destructive" }); return; }
    try {
      const row = await create.mutateAsync({
        companyId, employeeId: f.employeeId, effectiveDate: f.effectiveDate, reason: f.reason || undefined,
        newStoreId: f.newStoreId || null, newStoreDepartmentId: f.newDept || null, newStoreDesignationId: f.newDesig || null,
        newStoreTeamId: f.newTeam || null, newGradeId: f.newGrade || null, newCategoryId: f.newCategory || null,
        newReportingManagerId: f.newManager || null, newEmploymentType: f.newEmploymentType || null,
        newSalaryStructureId: f.newStructure || null, newShiftId: f.newShift || null,
      });
      toast({ title: "Transfer request created.", variant: "success" });
      onCreated(row.id);
      setF({ employeeId: "", effectiveDate: "", reason: "" });
    } catch (e) { toast({ title: "Create failed", description: msg(e), variant: "destructive" }); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New Employee Transfer</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={f.employeeId} onValueChange={(v) => setF({ ...f, employeeId: v })}>
                <SelectTrigger><SelectValue placeholder="Pick an employee" /></SelectTrigger>
                <SelectContent>{(empQ.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeCode ?? "—"})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Effective date</Label><Input type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></div>
          </div>
          <p className="text-[11px] text-muted-foreground">Leave any field below unset — only the fields you pick will change.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label className="text-xs">New store</Label>
              <Select value={f.newStoreId ?? ""} onValueChange={(v) => setF({ ...f, newStoreId: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">No change</SelectItem>{(storesQ.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">New department</Label>
              <Select value={f.newDept ?? ""} onValueChange={(v) => setF({ ...f, newDept: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">No change</SelectItem>{(deptQ.data ?? []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">New designation</Label>
              <Select value={f.newDesig ?? ""} onValueChange={(v) => setF({ ...f, newDesig: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">No change</SelectItem>{(desigQ.data ?? []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">New team</Label>
              <Select value={f.newTeam ?? ""} onValueChange={(v) => setF({ ...f, newTeam: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">No change</SelectItem>{(teamQ.data ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">New grade</Label>
              <Select value={f.newGrade ?? ""} onValueChange={(v) => setF({ ...f, newGrade: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">No change</SelectItem>{(gradeQ.data ?? []).map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">New category</Label>
              <Select value={f.newCategory ?? ""} onValueChange={(v) => setF({ ...f, newCategory: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">No change</SelectItem>{(catQ.data ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">New reporting manager</Label>
              <Select value={f.newManager ?? ""} onValueChange={(v) => setF({ ...f, newManager: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">No change</SelectItem>{(empQ.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">New employment type</Label>
              <Select value={f.newEmploymentType ?? ""} onValueChange={(v) => setF({ ...f, newEmploymentType: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No change</SelectItem>
                  {["full_time", "part_time", "contract", "intern", "consultant"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">New salary structure</Label>
              <Select value={f.newStructure ?? ""} onValueChange={(v) => setF({ ...f, newStructure: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">No change</SelectItem>{(structQ.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name ?? s.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">New shift</Label>
              <Select value={f.newShift ?? ""} onValueChange={(v) => setF({ ...f, newShift: pick(v) })}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">No change</SelectItem>{(shiftQ.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Reason</Label><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useTransferDetail(id ?? undefined);
  const act = useTransferAction();
  const [reasonOpen, setReasonOpen] = useState<null | "reject" | "cancel">(null);
  const [reason, setReason] = useState("");
  const d = q.data;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: "success" }); }
    catch (e) { toast({ title: "Action failed", description: msg(e), variant: "destructive" }); }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Transfer — {d?.employeeName ?? ""}</DialogTitle></DialogHeader>
        {q.isLoading || !d ? <LoadingState rows={4} /> : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"} className="capitalize">{d.status.replace("_", " ")}</Badge>
              <span className="text-xs text-muted-foreground">Effective {formatDate(d.effectiveDate)} · step {d.currentStep}/{d.maxStage}</span>
            </div>
            {d.reason && <p className="text-xs text-muted-foreground">{d.reason}</p>}
            <div className="flex flex-wrap gap-2">
              {d.status === "draft" && <Button size="sm" onClick={() => run(() => act.mutateAsync({ kind: "submit", id: d.id }), "Submitted.")}><Send className="mr-1 h-4 w-4" /> Submit</Button>}
              {d.status === "pending_approval" && <>
                <Button size="sm" onClick={() => run(() => act.mutateAsync({ kind: "decide", id: d.id, action: "approve" }), "Approved.")}><CheckCircle2 className="mr-1 h-4 w-4" /> Approve</Button>
                <Button size="sm" variant="destructive" onClick={() => setReasonOpen("reject")}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
              </>}
              {["draft", "pending_approval", "approved"].includes(d.status) && <Button size="sm" variant="outline" onClick={() => setReasonOpen("cancel")}><Ban className="mr-1 h-4 w-4" /> Cancel</Button>}
            </div>
            <div className="rounded-lg border p-3 text-xs">
              <p className="mb-1 font-medium">History</p>
              {d.decisions.map((ev) => (
                <div key={ev.id} className="flex justify-between border-b py-1 last:border-0">
                  <span className="capitalize">step {ev.stepNo} · {ev.action}{ev.remark ? ` — ${ev.remark}` : ""}</span>
                  <span className="text-muted-foreground">{formatDate(ev.decidedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <Dialog open={Boolean(reasonOpen)} onOpenChange={(o) => !o && setReasonOpen(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle className="capitalize">{reasonOpen} transfer — reason required</DialogTitle></DialogHeader>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            <DialogFooter>
              <Button variant="secondary" onClick={() => { setReasonOpen(null); setReason(""); }}>Back</Button>
              <Button variant="destructive" disabled={!reason.trim()} onClick={async () => {
                if (!d) return;
                if (reasonOpen === "reject") await run(() => act.mutateAsync({ kind: "decide", id: d.id, action: "reject", remark: reason }), "Rejected.");
                else await run(() => act.mutateAsync({ kind: "cancel", id: d.id, reason }), "Cancelled.");
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
  const q = useTransferRegister({ companyId, from: range.from || null, to: range.to || null });
  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">Transfer Register</CardTitle>
        <div className="flex items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" className="h-8" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" className="h-8" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <LoadingState /> : rows.length === 0 ? <EmptyState icon={ArrowRightLeft} title="No transfers in range" /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Staff ID</TableHead><TableHead>Employee</TableHead><TableHead>Old Store</TableHead><TableHead>New Store</TableHead>
                <TableHead>Old Dept</TableHead><TableHead>New Dept</TableHead><TableHead>Old Desig</TableHead><TableHead>New Desig</TableHead>
                <TableHead>Effective</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Approved By</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.staffId ?? "—"}</TableCell>
                    <TableCell className="font-medium">{r.employeeName}</TableCell>
                    <TableCell className="text-xs">{r.oldStore ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.newStore ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.oldDepartment ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.newDepartment ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.oldDesignation ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.newDesignation ?? "—"}</TableCell>
                    <TableCell className="text-xs">{formatDate(r.effectiveDate)}</TableCell>
                    <TableCell className="text-xs">{r.reason ?? "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{r.status.replace("_", " ")}</TableCell>
                    <TableCell className="text-xs">{r.approvedBy ?? "—"}</TableCell>
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
