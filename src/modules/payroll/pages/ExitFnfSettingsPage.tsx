import { useState } from "react";
import { ShieldAlert, Plus } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAssignableEmployees } from "@/hooks/useEmployees";
import {
  useFnfSettings, useSaveFnfSettings, useExitApprovers, useExitApproverMutations,
  useExitNoticePolicies, useSaveExitNoticePolicy,
} from "@/hooks/useFnf";
import { useExitTypes, useUpsertExitType } from "@/hooks/useExit";
import { useTransferApprovers, useTransferApproverMutations } from "@/hooks/useTransfer";
import { formatDate } from "@/lib/utils";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DIVISORS = [
  { v: "26", label: "Fixed 26" }, { v: "30", label: "Fixed 30" },
  { v: "calendar_days", label: "Calendar days" }, { v: "custom", label: "Custom" },
];
const BASES = [
  { v: "basic", label: "Basic" }, { v: "basic_da", label: "Basic + DA" },
  { v: "gross", label: "Gross" }, { v: "component", label: "A component" },
];

export function ExitFnfSettingsPage() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;
  const isSuperAdmin = user?.role === "super_admin";

  if (!isSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Exit / F&F Settings" description="Configure exit approvers, notice-pay policy and F&F behaviour." />
        <EmptyState icon={ShieldAlert} title="Super Admin only" description="Only a Super Admin can change exit / F&F configuration." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Exit / Transfer / F&F Settings" description="Exit types, exit & transfer approval stages, the configurable notice-pay policy and F&F behaviour. Nothing here is assumed — an unconfigured value produces ₹0 + a review flag on the settlement." />
      <ExitTypesCard companyId={companyId as string} />
      <FnfSettingsCard companyId={companyId as string} />
      <ApproversCard companyId={companyId as string} />
      <TransferApproversCard companyId={companyId as string} />
      <NoticePoliciesCard companyId={companyId as string} />
    </div>
  );
}

function ExitTypesCard({ companyId }: { companyId: string }) {
  const { user } = useAuth();
  const q = useExitTypes(companyId);
  const save = useUpsertExitType();
  const [f, setF] = useState({ code: "", name: "" });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Exit Type master</CardTitle>
        <div className="flex items-end gap-2">
          <Input className="h-8 w-32" placeholder="code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/\s+/g, "_") })} />
          <Input className="h-8 w-40" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Button size="sm" disabled={!f.code || !f.name || save.isPending}
            onClick={async () => {
              try { await save.mutateAsync({ companyId, code: f.code, name: f.name, userId: user?.id }); setF({ code: "", name: "" }); toast({ title: "Exit type saved.", variant: "success" }); }
              catch (e) { toast({ title: "Failed", description: msg(e), variant: "destructive" }); }
            }}><Plus className="h-3.5 w-3.5" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <LoadingState rows={2} /> : (q.data ?? []).length === 0 ? (
          <p className="text-xs text-amber-700">No exit types configured — Exit Requests cannot be created until at least one exists (e.g. Resignation, Termination, Retirement, Absconded, Contract End, Other). Never deleted once used, only disabled.</p>
        ) : (
          <div className="space-y-1">
            {(q.data ?? []).map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                <span>{t.name} <span className="font-mono text-muted-foreground">({t.code})</span></span>
                <label className="flex items-center gap-2">
                  <Checkbox checked={t.isActive} onCheckedChange={(v) => save.mutate({ id: t.id, companyId, code: t.code, name: t.name, isActive: Boolean(v), userId: user?.id })} /> Active
                </label>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TransferApproversCard({ companyId }: { companyId: string }) {
  const { user } = useAuth();
  const q = useTransferApprovers(companyId);
  const empQ = useAssignableEmployees(companyId);
  const { add, toggle } = useTransferApproverMutations();
  const [pick, setPick] = useState("");
  const [stage, setStage] = useState("1");
  const empName = (id: string) => (empQ.data ?? []).find((e) => e.id === id)?.fullName ?? id.slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Employee Transfer approvers</CardTitle>
        <div className="flex items-end gap-2">
          <Input className="h-8 w-16" type="number" min={1} value={stage} onChange={(e) => setStage(e.target.value)} title="Stage" />
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Add an approver…" /></SelectTrigger>
            <SelectContent>{(empQ.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeCode ?? "—"})</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" disabled={!pick || add.isPending}
            onClick={async () => { try { await add.mutateAsync({ companyId, employeeId: pick, stageNo: Number(stage) || 1, userId: user?.id }); setPick(""); toast({ title: "Approver added.", variant: "success" }); } catch (e) { toast({ title: "Failed", description: msg(e), variant: "destructive" }); } }}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <LoadingState rows={2} /> : (q.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No transfer approvers yet — only a Super Admin can approve transfers until one is added. This is a SEPARATE roster from Payroll/Finance authority.</p>
        ) : (
          <div className="space-y-1">
            {(q.data ?? []).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                <span>Stage {a.stage_no} · {empName(a.employee_id)}</span>
                <label className="flex items-center gap-2">
                  <Checkbox checked={a.is_active} onCheckedChange={(v) => toggle.mutate({ id: a.id, isActive: Boolean(v) })} /> Active
                </label>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FnfSettingsCard({ companyId }: { companyId: string }) {
  const { user } = useAuth();
  const q = useFnfSettings(companyId);
  const save = useSaveFnfSettings();
  const [mode, setMode] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const cur = q.data ?? {};
  const modeV = mode ?? cur.advance_recovery_mode ?? "full";
  const autoV = auto ?? (cur.auto_inactivate_on_close ?? true);

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">F&F behaviour</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Advance recovery in F&F</Label>
          <Select value={modeV} onValueChange={setMode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Recover full outstanding</SelectItem>
              <SelectItem value="scheduled">Only the scheduled installments</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 self-end text-sm">
          <Checkbox checked={autoV} onCheckedChange={(v) => setAuto(Boolean(v))} /> Inactivate the employee when F&F is closed
        </label>
        <div className="self-end">
          <Button size="sm" disabled={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync({ companyId, advanceRecoveryMode: modeV, autoInactivateOnClose: autoV, userId: user?.id });
                setMode(null); setAuto(null);
                toast({ title: "Saved.", variant: "success" });
              } catch (e) { toast({ title: "Save failed", description: msg(e), variant: "destructive" }); }
            }}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ApproversCard({ companyId }: { companyId: string }) {
  const { user } = useAuth();
  const q = useExitApprovers(companyId);
  const empQ = useAssignableEmployees(companyId);
  const { add, toggle } = useExitApproverMutations();
  const [pick, setPick] = useState("");
  const [stage, setStage] = useState("1");
  const empName = (id: string) => (empQ.data ?? []).find((e) => e.id === id)?.fullName ?? id.slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Exit Request / F&F approvers</CardTitle>
        <div className="flex items-end gap-2">
          <Input className="h-8 w-16" type="number" min={1} value={stage} onChange={(e) => setStage(e.target.value)} title="Stage" />
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Add an approver…" /></SelectTrigger>
            <SelectContent>{(empQ.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeCode ?? "—"})</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" disabled={!pick || add.isPending}
            onClick={async () => { try { await add.mutateAsync({ companyId, employeeId: pick, stageNo: Number(stage) || 1, userId: user?.id }); setPick(""); toast({ title: "Approver added.", variant: "success" }); } catch (e) { toast({ title: "Failed", description: msg(e), variant: "destructive" }); } }}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-[11px] text-muted-foreground">This roster approves BOTH the Exit Request workflow (stage-by-stage) and F&F (any active stage, or the employee's resolved reporting manager at stage 1). Stage 1 also always allows the exiting employee's own reporting manager, even with no roster row.</p>
        {q.isLoading ? <LoadingState rows={2} /> : (q.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No exit approvers yet — only a Super Admin can approve Exit Requests / F&F until one is added.</p>
        ) : (
          <div className="space-y-1">
            {(q.data ?? []).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                <span>Stage {a.stage_no} · {empName(a.employee_id)}</span>
                <label className="flex items-center gap-2">
                  <Checkbox checked={a.is_active} onCheckedChange={(v) => toggle.mutate({ id: a.id, isActive: Boolean(v) })} /> Active
                </label>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NoticePoliciesCard({ companyId }: { companyId: string }) {
  const { user } = useAuth();
  const q = useExitNoticePolicies(companyId);
  const save = useSaveExitNoticePolicy();
  const [f, setF] = useState<any>(null);

  const blank = {
    companyId, noticeDays: 30, recoveryEnabled: true, recoveryBasis: "basic_da", recoveryComponentCode: "",
    recoveryDivisorType: "30", recoveryDivisorCustom: "", shortfallRecovery: true, waiverAllowed: true,
    effectiveFrom: new Date().toISOString().slice(0, 10), remark: "", userId: user?.id,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Notice / Exit policy (effective-dated)</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setF({ ...blank })}><Plus className="mr-1 h-3.5 w-3.5" /> New</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? <LoadingState rows={2} /> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Effective</TableHead><TableHead>Notice days</TableHead><TableHead>Recovery basis</TableHead>
              <TableHead>Divisor</TableHead><TableHead>Shortfall / Waiver</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(q.data ?? []).map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">{formatDate(p.effective_from)}{p.effective_to ? ` – ${formatDate(p.effective_to)}` : ""}</TableCell>
                  <TableCell>{p.notice_days}</TableCell>
                  <TableCell className="text-xs">{p.recovery_enabled ? (p.recovery_basis ?? "—") : "disabled"}</TableCell>
                  <TableCell className="text-xs">{p.recovery_divisor_type}{p.recovery_divisor_type === "custom" ? ` (${p.recovery_divisor_custom})` : ""}</TableCell>
                  <TableCell className="text-xs">{p.shortfall_recovery ? "recover" : "no"} / {p.waiver_allowed ? "waiver ok" : "no waiver"}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => setF({
                    id: p.id, companyId, noticeDays: p.notice_days, recoveryEnabled: p.recovery_enabled,
                    recoveryBasis: p.recovery_basis ?? "basic_da", recoveryComponentCode: p.recovery_component_code ?? "",
                    recoveryDivisorType: p.recovery_divisor_type, recoveryDivisorCustom: p.recovery_divisor_custom ?? "",
                    shortfallRecovery: p.shortfall_recovery, waiverAllowed: p.waiver_allowed,
                    effectiveFrom: p.effective_from, remark: p.remark ?? "", userId: user?.id,
                  })}>Edit</Button></TableCell>
                </TableRow>
              ))}
              {(q.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-xs text-muted-foreground">No notice policy configured — notice-pay recovery stays ₹0 + review flag.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}

        {f && (
          <div className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-medium">{f.id ? "Edit" : "New"} notice policy</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1"><Label className="text-xs">Effective from</Label><Input type="date" className="h-8" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Notice period (days)</Label><Input type="number" className="h-8" value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: Number(e.target.value) || 0 })} /></div>
              <div className="space-y-1"><Label className="text-xs">Recovery basis</Label>
                <Select value={f.recoveryBasis} onValueChange={(v) => setF({ ...f, recoveryBasis: v })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{BASES.map((b) => <SelectItem key={b.v} value={b.v}>{b.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {f.recoveryBasis === "component" && <div className="space-y-1"><Label className="text-xs">Component code</Label><Input className="h-8" value={f.recoveryComponentCode} onChange={(e) => setF({ ...f, recoveryComponentCode: e.target.value.toUpperCase() })} /></div>}
              <div className="space-y-1"><Label className="text-xs">Daily divisor</Label>
                <Select value={f.recoveryDivisorType} onValueChange={(v) => setF({ ...f, recoveryDivisorType: v })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{DIVISORS.map((d) => <SelectItem key={d.v} value={d.v}>{d.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {f.recoveryDivisorType === "custom" && <div className="space-y-1"><Label className="text-xs">Custom divisor</Label><Input type="number" className="h-8" value={f.recoveryDivisorCustom} onChange={(e) => setF({ ...f, recoveryDivisorCustom: e.target.value })} /></div>}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={f.recoveryEnabled} onCheckedChange={(v) => setF({ ...f, recoveryEnabled: Boolean(v) })} /> Recovery enabled</label>
              <label className="flex items-center gap-2"><Checkbox checked={f.shortfallRecovery} onCheckedChange={(v) => setF({ ...f, shortfallRecovery: Boolean(v) })} /> Recover shortfall days</label>
              <label className="flex items-center gap-2"><Checkbox checked={f.waiverAllowed} onCheckedChange={(v) => setF({ ...f, waiverAllowed: Boolean(v) })} /> Waiver allowed</label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setF(null)}>Cancel</Button>
              <Button size="sm" disabled={save.isPending}
                onClick={async () => {
                  try {
                    await save.mutateAsync({ ...f, recoveryDivisorCustom: f.recoveryDivisorCustom === "" ? null : Number(f.recoveryDivisorCustom) });
                    setF(null); toast({ title: "Notice policy saved.", variant: "success" });
                  } catch (e) { toast({ title: "Save failed", description: msg(e), variant: "destructive" }); }
                }}>Save</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
