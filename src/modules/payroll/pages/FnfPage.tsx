import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserMinus, Plus, ShieldAlert, FileText, Settings as SettingsIcon } from "lucide-react";

import { ROUTES } from "@/constants/routes";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAssignableEmployees } from "@/hooks/useEmployees";
import { usePayrollAdmin } from "@/hooks/usePayroll";
import { useFnfList, useFnfRegister, useCreateFnf } from "@/hooks/useFnf";
import { formatDate } from "@/lib/utils";
import { formatAmount } from "@/modules/advance/utils";
import { EXIT_TYPES } from "@/types/fnf";

const STATUS_VARIANT: Record<string, "success" | "secondary" | "warning" | "destructive"> = {
  approved: "success", paid: "success", closed: "success",
  draft: "warning", calculated: "warning", pending_approval: "warning", sent_back: "warning",
  partially_paid: "warning", payment_pending: "warning", under_review: "warning",
  rejected: "destructive", reversed: "destructive",
};
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function FnfPage() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;
  const adminQ = usePayrollAdmin(companyId);
  const isAdmin = adminQ.data === true || user?.role === "super_admin";
  const navigate = useNavigate();

  const listQ = useFnfList(isAdmin ? companyId : undefined);
  const [open, setOpen] = useState(false);

  if (adminQ.isLoading) return <LoadingState />;
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Full & Final Settlement" description="Exit settlements for leaving employees." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="F&F reuses the Finance Processor roster — you are not an active Finance Processor." />
      </div>
    );
  }

  const rows = listQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader title="Full & Final Settlement" description="Open a settlement for an exiting employee, calculate it (exit-month proration, leave encashment, notice pay, PF/ESI, Advance Recovery — all from the existing engines), approve, pay and close." />
        <div className="flex gap-2">
          <Button asChild variant="ghost" size="sm"><Link to={ROUTES.exitFnfSettings}><SettingsIcon className="mr-1 h-4 w-4" /> Exit / F&F Settings</Link></Button>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> New F&F</Button>
        </div>
      </div>

      <Tabs defaultValue="settlements">
        <TabsList>
          <TabsTrigger value="settlements">Settlements ({rows.length})</TabsTrigger>
          <TabsTrigger value="register">F&F Register</TabsTrigger>
        </TabsList>

        <TabsContent value="settlements" className="pt-3">
          <Card>
            <CardContent className="pt-4">
              {listQ.isLoading ? (
                <LoadingState />
              ) : rows.length === 0 ? (
                <EmptyState icon={UserMinus} title="No F&F settlements yet" description="Create one for an exiting employee." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead><TableHead>Exit type</TableHead><TableHead>Leaving</TableHead>
                        <TableHead>Status</TableHead><TableHead>Gross</TableHead><TableHead>Deductions</TableHead>
                        <TableHead>Advance Rec.</TableHead><TableHead>Net F&F</TableHead><TableHead>Paid</TableHead><TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/payroll/fnf/${r.id}`)}>
                          <TableCell className="font-medium">
                            {r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode ?? "—"})</span>
                            {r.version > 1 && <span className="ml-1 text-[10px] text-muted-foreground">v{r.version}</span>}
                          </TableCell>
                          <TableCell className="text-xs capitalize">{r.exitType.replace("_", " ")}</TableCell>
                          <TableCell className="text-xs">{formatDate(r.leavingDate)}</TableCell>
                          <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "secondary"} className="capitalize">{r.status.replace("_", " ")}</Badge></TableCell>
                          <TableCell>{formatAmount(r.grossEarnings)}</TableCell>
                          <TableCell>{formatAmount(r.totalDeductions)}</TableCell>
                          <TableCell className="text-amber-700">{formatAmount(r.advanceRecovered)}</TableCell>
                          <TableCell className={`font-medium ${r.netSettlement < 0 ? "text-destructive" : ""}`}>{formatAmount(r.netSettlement)}</TableCell>
                          <TableCell className="text-xs">{formatAmount(r.amountPaid)}</TableCell>
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
          <FnfRegister companyId={companyId as string} />
        </TabsContent>
      </Tabs>

      <NewFnfDialog open={open} onClose={() => setOpen(false)} companyId={companyId as string} onCreated={(id) => { setOpen(false); navigate(`/payroll/fnf/${id}`); }} />
    </div>
  );
}

function NewFnfDialog({ open, onClose, companyId, onCreated }: { open: boolean; onClose: () => void; companyId: string; onCreated: (id: string) => void }) {
  const empQ = useAssignableEmployees(companyId);
  const create = useCreateFnf();
  const [f, setF] = useState({ employeeId: "", exitType: "resignation", leavingDate: "", noticeServedDays: "", noticeWaived: false, encashableLeaveDays: "" });

  const submit = async () => {
    if (!f.employeeId || !f.leavingDate) { toast({ title: "Employee and leaving date are required.", variant: "destructive" }); return; }
    try {
      const row = await create.mutateAsync({
        companyId, employeeId: f.employeeId, exitType: f.exitType, leavingDate: f.leavingDate,
        noticeServedDays: Number(f.noticeServedDays) || 0, noticeWaived: f.noticeWaived,
        encashableLeaveDays: Number(f.encashableLeaveDays) || 0,
      });
      toast({ title: "F&F settlement created.", variant: "success" });
      onCreated(row.id);
    } catch (e) { toast({ title: "Create failed", description: msg(e), variant: "destructive" }); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New F&F Settlement</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Employee</Label>
            <Select value={f.employeeId} onValueChange={(v) => setF({ ...f, employeeId: v })}>
              <SelectTrigger><SelectValue placeholder="Pick an employee" /></SelectTrigger>
              <SelectContent>
                {(empQ.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeCode ?? "—"})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Exit type</Label>
              <Select value={f.exitType} onValueChange={(v) => setF({ ...f, exitType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EXIT_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Leaving date</Label><Input type="date" value={f.leavingDate} onChange={(e) => setF({ ...f, leavingDate: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Notice served (days)</Label><Input type="number" value={f.noticeServedDays} onChange={(e) => setF({ ...f, noticeServedDays: e.target.value })} placeholder="0" /></div>
            <div className="space-y-1.5"><Label>Encashable leave (days)</Label><Input type="number" value={f.encashableLeaveDays} onChange={(e) => setF({ ...f, encashableLeaveDays: e.target.value })} placeholder="0" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.noticeWaived} onCheckedChange={(v) => setF({ ...f, noticeWaived: Boolean(v) })} /> Notice period waived (no shortfall recovery)</label>
          <p className="text-[11px] text-muted-foreground">Notice period, recovery basis and encashment rule come from the configured Exit / Notice policy and Leave policy — nothing is assumed here.</p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FnfRegister({ companyId }: { companyId: string }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const q = useFnfRegister(companyId, range.from || null, range.to || null);
  const rows = q.data ?? [];
  const totals = useMemo(() => rows.reduce((a, r) => ({
    e: a.e + r.totalEarnings, d: a.d + r.totalDeductions, adv: a.adv + r.advanceRecovery, enc: a.enc + r.leaveEncashment, net: a.net + r.netFnf,
  }), { e: 0, d: 0, adv: 0, enc: 0, net: 0 }), [rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">F&F Register</CardTitle>
        <div className="flex items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Left from</Label><Input type="date" className="h-8" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">to</Label><Input type="date" className="h-8" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <LoadingState /> : rows.length === 0 ? (
          <EmptyState icon={FileText} title="No settlements in range" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead><TableHead>Staff ID</TableHead><TableHead>Store</TableHead><TableHead>Dept</TableHead>
                  <TableHead>Joined</TableHead><TableHead>Left</TableHead><TableHead>Exit</TableHead>
                  <TableHead>Earnings</TableHead><TableHead>Deductions</TableHead><TableHead>Adv. Rec.</TableHead>
                  <TableHead>Leave Enc.</TableHead><TableHead>Net F&F</TableHead><TableHead>Status</TableHead><TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.employeeName}</TableCell>
                    <TableCell className="font-mono text-xs">{r.staffId ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.store ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.department ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.joiningDate ? formatDate(r.joiningDate) : "—"}</TableCell>
                    <TableCell className="text-xs">{formatDate(r.leavingDate)}</TableCell>
                    <TableCell className="text-xs capitalize">{r.exitType.replace("_", " ")}</TableCell>
                    <TableCell>{formatAmount(r.totalEarnings)}</TableCell>
                    <TableCell>{formatAmount(r.totalDeductions)}</TableCell>
                    <TableCell className="text-amber-700">{formatAmount(r.advanceRecovery)}</TableCell>
                    <TableCell>{formatAmount(r.leaveEncashment)}</TableCell>
                    <TableCell className="font-medium">{formatAmount(r.netFnf)}</TableCell>
                    <TableCell className="text-xs capitalize">{r.status.replace("_", " ")}</TableCell>
                    <TableCell className="text-xs">{r.paymentDate ? formatDate(r.paymentDate) : "—"}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell colSpan={7}>Total ({rows.length})</TableCell>
                  <TableCell>{formatAmount(totals.e)}</TableCell>
                  <TableCell>{formatAmount(totals.d)}</TableCell>
                  <TableCell className="text-amber-700">{formatAmount(totals.adv)}</TableCell>
                  <TableCell>{formatAmount(totals.enc)}</TableCell>
                  <TableCell>{formatAmount(totals.net)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
