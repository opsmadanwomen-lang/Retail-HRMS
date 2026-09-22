import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, Plus, Trash2, Wand2, CheckCircle2, Copy, ExternalLink } from "lucide-react";

import { ROUTES } from "@/constants/routes";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAssignableEmployees } from "@/hooks/useEmployees";
import {
  usePayrollComponents, useUpsertPayrollComponent,
  useSalaryStructures, useSalaryStructureComponents, useSalaryPreview, useSalarySlabRules,
  useCreateSalaryStructure, useActivateSalaryStructure, useCloneSalaryStructure, useValidateSalaryStructure,
  useUpsertSalaryStructureComponent, useDeleteSalaryStructureComponent, useAddSalarySlabRule, useDeleteSalarySlabRule,
  useSalaryStructureDeleteCheck, useDeleteSalaryStructure,
  usePayrollPolicies, usePolicyStatutoryRules, usePolicyPtSlabs, usePolicyDeductionOrder,
  useCreatePolicyVersion, useUpdatePolicyV2, useValidatePolicy, useActivatePolicy, usePolicyPreview,
  useUpsertStatutoryRule, useAddPtSlab, useDeletePtSlab, useSetDeductionOrder,
  useEmployeeGrades, useEmployeeCategories, useUpsertGrade, useUpsertCategory,
  useStoreCalendars, useUpsertStoreCalendar, usePreviewStoreCalendar,
  useTdsPolicies, useTdsSlabs, useCreateTdsPolicy, useUpdateTdsPolicy, useAddTdsSlab, useDeleteTdsSlab, useComputeTds,
} from "@/hooks/usePayroll";
import { formatAmount } from "@/modules/advance/utils";
import { findSlabOverlap } from "@/modules/payroll/salarySlabRange";
import { describeDeleteError } from "@/modules/payroll/salaryStructureDelete";
import type { SalaryStructure, SalaryStructureComponent, PayrollPolicyV2, TdsPolicy } from "@/types/payroll";
import { SalaryStructureTestDialog } from "@/modules/payroll/components/SalaryStructureTestDialog";
import { OtLateBasisCard } from "@/modules/payroll/components/OtLateBasisCard";
import { CommonComponentsTab, CommonComponentsReference } from "@/modules/payroll/components/CommonComponentsTab";

/**
 * Payroll Settings — Super Admin only.
 *  • Salary Components (Phase 5 flat master) + Payroll Policy (every unresolved business rule is a
 *    NULLable field — blank keeps that line ₹0 + review flag).
 *  • Salary Structures (Phase 5A dynamic bifurcation): unlimited configurable components, 6 calculation
 *    types + advance_recovery bridge, safe Formula Builder, dependency ordering + circular detection,
 *    Remaining/Balance, Slabs, and a Preview that calls the SAME engine as the Payroll Run.
 *  • Employee salary is NOT maintained here any more: it lives in Employees → Add / Edit → Payroll Salary (Gross + Effective From;
 *    Grade / Structure / Slab are resolved by the server). Each structure has a read-only Test action.
 *  • Common Payroll Components: created once, apply to every structure (stored in the payroll policy's rule engine).
 */
export function PayrollSettingsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const companyId = user?.companyId ?? undefined;
  const [tab, setTab] = useState("structures");

  if (!isSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Payroll Settings" description="Salary structures, components and payroll policy." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="Payroll configuration is available to Super Admin only." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll Settings" description="Salary is maintained from the Employee profile. Enter Gross Salary there and the system automatically determines Grade, Salary Structure and Salary Slab. Here you configure the Salary Structures (Basic / DA / Allowance), the Common Payroll Components (PF, ESI, Medical Fund, Incentive …, defined once for every structure) and the payroll rules." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="structures">Salary Structures</TabsTrigger>
          <TabsTrigger value="common">Common Payroll Components</TabsTrigger>
          <TabsTrigger value="policy">Payroll Rules</TabsTrigger>
          <TabsTrigger value="calendars">Store Calendars</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
        <TabsContent value="structures"><StructuresTab companyId={companyId} onOpenCommon={() => setTab("common")} /></TabsContent>
        <TabsContent value="common"><CommonComponentsTab companyId={companyId} /></TabsContent>
        <TabsContent value="policy"><PolicyEngineTab companyId={companyId} /></TabsContent>
        <TabsContent value="calendars"><StoreCalendarsTab companyId={companyId} /></TabsContent>
        <TabsContent value="advanced">
          <p className="mb-3 text-xs text-muted-foreground">Technical configuration — normal salary setup does not need anything on this tab.</p>
          <Tabs defaultValue="tds">
            <TabsList className="flex-wrap">
              <TabsTrigger value="tds">TDS</TabsTrigger>
              <TabsTrigger value="masters">Grades &amp; Categories</TabsTrigger>
              <TabsTrigger value="components">Legacy Salary Components</TabsTrigger>
            </TabsList>
            <TabsContent value="tds"><TdsTab companyId={companyId} /></TabsContent>
            <TabsContent value="masters"><GradesCategoriesTab companyId={companyId} /></TabsContent>
            <TabsContent value="components"><ComponentsTab companyId={companyId} /></TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ========================================================================== */
/* Phase 5A — Salary Structures                                                */
/* ========================================================================== */

const CALC_TYPES: Array<{ v: string; label: string }> = [
  { v: "fixed", label: "Fixed amount" },
  { v: "pct_of_gross", label: "% of Gross" },
  { v: "pct_of_basic", label: "% of Basic" },
  { v: "pct_of_component", label: "% of another component" },
  { v: "formula", label: "Custom formula" },
  { v: "balance", label: "Remaining balance" },
  { v: "advance_recovery", label: "Advance Recovery (Phase 4 bridge)" },
  { v: "manual", label: "Manual / Excel Import" },
];
const CATEGORIES: Array<{ v: string; label: string }> = [
  { v: "earning", label: "Earning" },
  { v: "employee_deduction", label: "Employee Deduction" },
  { v: "employer_contribution", label: "Employer Contribution (not in Net)" },
];

function StructuresTab({ companyId, onOpenCommon }: { companyId?: string; onOpenCommon?: () => void }) {
  const q = useSalaryStructures(companyId);
  const slabsQ = useSalarySlabRules(companyId);
  const slabText = (id: string) => {
    const s = (slabsQ.data ?? []).filter((x) => x.isActive && x.salaryStructureId === id);
    return s.length ? s.map((x) => `${formatAmount(x.minGross)} – ${x.maxGross == null ? "∞" : formatAmount(x.maxGross)}`).join(", ") : null;
  };
  const create = useCreateSalaryStructure();
  const clone = useCloneSalaryStructure();
  const activate = useActivateSalaryStructure();
  const validate = useValidateSalaryStructure();
  const { user } = useAuth();
  // UI gate only — salary_structure_delete() re-verifies is_super_admin() server-side.
  const isSuperAdmin = user?.role === "super_admin";

  const [editStruct, setEditStruct] = useState<SalaryStructure | null>(null);
  const [testStruct, setTestStruct] = useState<SalaryStructure | null>(null);
  const [deleteStruct, setDeleteStruct] = useState<SalaryStructure | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState({ code: "", name: "", rounding: "round_2", grossBalanced: true, allowNegativeBalance: false, effectiveFrom: new Date().toISOString().slice(0, 10) });

  const doCreate = async () => {
    if (!companyId || !nf.code.trim() || !nf.name.trim()) { toast({ title: "Code and name are required.", variant: "destructive" }); return; }
    try {
      await create.mutateAsync({ companyId, code: nf.code.trim().toUpperCase(), name: nf.name.trim(), grossBalanced: nf.grossBalanced, allowNegativeBalance: nf.allowNegativeBalance, rounding: nf.rounding, effectiveFrom: nf.effectiveFrom, userId: user?.id });
      toast({ title: "Draft structure created.", variant: "success" });
      setNewOpen(false); setNf({ code: "", name: "", rounding: "round_2", grossBalanced: true, allowNegativeBalance: false, effectiveFrom: new Date().toISOString().slice(0, 10) });
    } catch (e) { toast({ title: "Create failed", description: msg(e), variant: "destructive" }); }
  };
  const doActivate = async (s: SalaryStructure) => {
    try {
      const v = await validate.mutateAsync(s.id);
      if (!v.ok) { toast({ title: "Cannot activate", description: v.error ?? "Validation failed.", variant: "destructive" }); return; }
      await activate.mutateAsync(s.id);
      toast({ title: `“${s.code}” is now the active structure.`, variant: "success" });
    } catch (e) { toast({ title: "Activate failed", description: msg(e), variant: "destructive" }); }
  };
  const doClone = async (s: SalaryStructure) => {
    const code = window.prompt(`New code for the clone of ${s.code}:`, `${s.code}_V2`);
    if (!code) return;
    try { await clone.mutateAsync({ id: s.id, newCode: code.trim().toUpperCase(), newName: `${s.name} (copy)` }); toast({ title: "Structure cloned to a new draft.", variant: "success" }); }
    catch (e) { toast({ title: "Clone failed", description: msg(e), variant: "destructive" }); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Salary Structures</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">A structure is versioned by code — activating one archives the previous active version with the same code. An active or used structure can only be made Inactive/Archived; only a Super Admin can permanently delete an unused, non-active one.</p>
        </div>
        <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" /> New Structure</Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <LoadingState /> : (q.data ?? []).length === 0 ? (
          <EmptyState icon={Wand2} title="No salary structures yet." description="Create a draft, add components, Preview, then Activate." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Salary slab</TableHead><TableHead>Rounding</TableHead><TableHead>Balanced</TableHead><TableHead>Effective</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {(q.data ?? []).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell><StructStatus status={s.status} /></TableCell>
                    <TableCell className="text-xs">{s.status === "active" ? (slabText(s.id) ?? <span className="text-amber-700">No slab — Gross will not route here</span>) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{s.rounding}</TableCell>
                    <TableCell className="text-xs">{s.grossBalanced ? "Yes" : "No"}{s.allowNegativeBalance ? " · −ve ok" : ""}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.effectiveFrom}{s.effectiveTo ? ` – ${s.effectiveTo}` : ""}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setTestStruct(s)} aria-label={`Test ${s.code}`}>Test</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditStruct(s)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => doClone(s)}><Copy className="mr-1 h-3.5 w-3.5" />Clone</Button>
                        {s.status !== "active" && s.status !== "archived" && (
                          <Button size="sm" variant="ghost" onClick={() => doActivate(s)} disabled={activate.isPending || validate.isPending}>
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Activate
                          </Button>
                        )}
                        {isSuperAdmin && (
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteStruct(s)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
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

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Salary Structure (draft)</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Code</Label><Input value={nf.code} onChange={(e) => setNf({ ...nf, code: e.target.value })} placeholder="STD_STAFF" /></div>
            <div className="space-y-1.5"><Label>Name</Label><Input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Rounding</Label>
              <Select value={nf.rounding} onValueChange={(v) => setNf({ ...nf, rounding: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="round_2">2 decimals</SelectItem><SelectItem value="nearest_rupee">Nearest rupee</SelectItem><SelectItem value="none">None</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Effective from</Label><Input type="date" value={nf.effectiveFrom} onChange={(e) => setNf({ ...nf, effectiveFrom: e.target.value })} /></div>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={nf.grossBalanced} onCheckedChange={(v) => setNf({ ...nf, grossBalanced: Boolean(v) })} /> Gross-balanced (earnings must reconcile to Gross)</label>
            <label className="flex items-center gap-2"><Checkbox checked={nf.allowNegativeBalance} onCheckedChange={(v) => setNf({ ...nf, allowNegativeBalance: Boolean(v) })} /> Allow negative balance</label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewOpen(false)} disabled={create.isPending}>Cancel</Button>
            <Button onClick={doCreate} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create Draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SalaryStructureTestDialog structure={testStruct} companyId={companyId} onClose={() => setTestStruct(null)} />
      <StructureEditorDialog structure={editStruct} companyId={companyId} onClose={() => setEditStruct(null)} onOpenCommon={() => { setEditStruct(null); onOpenCommon?.(); }} />
      {isSuperAdmin && <DeleteStructureDialog structure={deleteStruct} onClose={() => setDeleteStruct(null)} />}
    </Card>
  );
}

function DeleteStructureDialog({ structure, onClose }: { structure: SalaryStructure | null; onClose: () => void }) {
  const checkQ = useSalaryStructureDeleteCheck(structure?.id);
  const del = useDeleteSalaryStructure();
  const c = checkQ.data;

  const doDelete = async () => {
    if (!structure) return;
    try {
      await del.mutateAsync(structure.id);
      toast({ title: `Salary structure “${structure.code}” permanently deleted.`, variant: "success" });
      onClose();
    } catch (e) {
      const info = describeDeleteError(e);
      toast({ title: info.title, description: info.description, variant: "destructive" });
      checkQ.refetch(); // show the current blocker (e.g. it became assigned after the dialog opened)
    }
  };
  const yn = (v: boolean) => (v ? "Yes" : "No");
  const err = checkQ.isError ? describeDeleteError(checkQ.error) : null;

  return (
    <Dialog open={Boolean(structure)} onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Salary Structure?</DialogTitle>
          <DialogDescription>Permanent deletion is allowed only when this salary structure is not used by employees or payroll history.</DialogDescription>
        </DialogHeader>
        {checkQ.isLoading ? <LoadingState rows={4} /> : err ? (
          <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive"><strong>{err.title}.</strong> {err.description}</p>
        ) : c ? (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[11rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted-foreground">Structure code</dt><dd className="font-mono">{c.code}</dd>
              <dt className="text-muted-foreground">Structure name</dt><dd className="font-medium">{c.name}</dd>
              <dt className="text-muted-foreground">Current status</dt><dd className="capitalize">{c.status}</dd>
              <dt className="text-muted-foreground">Components</dt><dd>{c.componentCount}</dd>
              <dt className="text-muted-foreground">Salary slabs</dt><dd>{c.slabCount}</dd>
              <dt className="text-muted-foreground">Assigned to employees</dt><dd>{yn(c.isAssignedToEmployees)}{c.isAssignedToEmployees ? ` (${c.employeeAssignmentCount})` : ""}</dd>
              <dt className="text-muted-foreground">Used by payroll</dt><dd>{yn(c.usedInPayroll)}{c.usedInPayroll ? ` (${c.payrollUseCount} result${c.payrollUseCount === 1 ? "" : "s"})` : ""}</dd>
            </dl>
            {c.canDelete ? (
              <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">This permanently removes the structure with its {c.componentCount} component(s) and {c.slabCount} slab(s). It cannot be undone; an audit entry is recorded.</p>
            ) : (
              <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{c.blockMessage}</p>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={del.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={doDelete} disabled={del.isPending || checkQ.isLoading || !c || !c.canDelete}>
            {del.isPending ? "Deleting…" : "Delete Permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StructStatus({ status }: { status: string }) {
  const v = status === "active" ? "success" : status === "draft" ? "warning" : "secondary";
  return <Badge variant={v as "success" | "warning" | "secondary"} className="capitalize">{status}</Badge>;
}

function StructureEditorDialog({ structure, companyId, onClose, onOpenCommon }: { structure: SalaryStructure | null; companyId?: string; onClose: () => void; onOpenCommon?: () => void }) {
  const compQ = useSalaryStructureComponents(structure?.id);
  const slabQ = useSalarySlabRules(companyId);
  const structsQ = useSalaryStructures(companyId);
  const upsertComp = useUpsertSalaryStructureComponent();
  const delComp = useDeleteSalaryStructureComponent();
  const addSlab = useAddSalarySlabRule();
  const delSlab = useDeleteSalarySlabRule();
  const { user } = useAuth();

  const validateStruct = useValidateSalaryStructure();
  const [validation, setValidation] = useState<{ ok: boolean; error: string | null } | null>(null);
  const [previewGross, setPreviewGross] = useState("18000");
  const previewNum = Number(previewGross) || 0;
  const previewQ = useSalaryPreview(structure?.id, previewNum);

  const [compOpen, setCompOpen] = useState(false);
  const [editComp, setEditComp] = useState<SalaryStructureComponent | null>(null);
  const blank = { code: "", name: "", category: "earning", calculationType: "fixed", fixedAmount: "", percentage: "", baseComponentCode: "", formulaExpression: "", isBasic: false, includedInGross: true, includedInCtc: true, isTaxable: false, isStatutory: false, statutoryKind: "", statutoryBase: "", statutoryRate: "", statutoryCeiling: "", rounding: "", displayOrder: "100", isActive: true };
  const [cf, setCf] = useState(blank);

  const comps = compQ.data ?? [];
  const allSlabs = slabQ.data ?? [];
  const slabsForStruct = allSlabs.filter((s) => s.salaryStructureId === structure?.id);
  // The overlap guard is company-wide, so slabs owned by other structures also block a new range.
  const slabsOfOthers = allSlabs.filter((s) => s.salaryStructureId !== structure?.id);
  const structLabel = (id: string) => { const s = (structsQ.data ?? []).find((x) => x.id === id); return s ? `${s.code} — ${s.name}` : "another structure"; };
  const slabRange = (s: { minGross: number; maxGross: number | null }) => `${formatAmount(s.minGross)} – ${s.maxGross == null ? "∞" : formatAmount(s.maxGross)}`;

  const openNewComp = () => { setEditComp(null); setCf({ ...blank, displayOrder: String((comps.at(-1)?.displayOrder ?? 90) + 10) }); setCompOpen(true); };
  const openEditComp = (c: SalaryStructureComponent) => {
    setEditComp(c);
    setCf({
      code: c.code, name: c.name, category: c.category, calculationType: c.calculationType,
      fixedAmount: c.fixedAmount?.toString() ?? "", percentage: c.percentage?.toString() ?? "",
      baseComponentCode: c.baseComponentCode ?? "", formulaExpression: c.formulaExpression ?? "",
      isBasic: c.isBasic, includedInGross: c.includedInGross, includedInCtc: c.includedInCtc, isTaxable: c.isTaxable,
      isStatutory: c.isStatutory, statutoryKind: c.statutoryKind ?? "", statutoryBase: c.statutoryBase ?? "",
      statutoryRate: c.statutoryRate?.toString() ?? "", statutoryCeiling: c.statutoryCeiling?.toString() ?? "",
      rounding: c.rounding ?? "", displayOrder: String(c.displayOrder), isActive: c.isActive,
    });
    setCompOpen(true);
  };
  const saveComp = async () => {
    if (!structure || !companyId || !cf.code.trim() || !cf.name.trim()) { toast({ title: "Code and name are required.", variant: "destructive" }); return; }
    if (cf.calculationType === "manual" && cf.code.trim().toUpperCase() === "OT") {
      toast({ title: "Overtime cannot use Manual / Excel Import.", description: "OT is always calculated from Attendance → Overtime Rules.", variant: "destructive" });
      return;
    }
    try {
      await upsertComp.mutateAsync({
        id: editComp?.id, companyId, salaryStructureId: structure.id, code: cf.code.trim().toUpperCase(), name: cf.name.trim(),
        category: cf.category, calculationType: cf.calculationType,
        // Manual/Excel Import never carries a fixed amount or percentage — never a contradictory
        // "Manual + % of Basic = 50%" configuration.
        fixedAmount: cf.calculationType === "manual" ? null : num(cf.fixedAmount),
        percentage: cf.calculationType === "manual" ? null : num(cf.percentage),
        baseComponentCode: cf.calculationType === "pct_of_component" ? (cf.baseComponentCode.trim().toUpperCase() || null) : null,
        formulaExpression: cf.calculationType === "formula" ? (cf.formulaExpression.trim() || null) : null,
        isBasic: cf.isBasic, includedInGross: cf.includedInGross, includedInCtc: cf.includedInCtc, isTaxable: cf.isTaxable,
        isStatutory: cf.isStatutory, statutoryKind: cf.statutoryKind || null, statutoryBase: cf.statutoryBase || null,
        statutoryRate: num(cf.statutoryRate), statutoryCeiling: num(cf.statutoryCeiling), rounding: cf.rounding || null,
        displayOrder: Number(cf.displayOrder) || 100, isActive: cf.isActive, userId: user?.id,
      });
      toast({ title: editComp ? "Component updated." : "Component added.", variant: "success" });
      setCompOpen(false);
    } catch (e) { toast({ title: "Save failed", description: msg(e), variant: "destructive" }); }
  };

  const [slabForm, setSlabForm] = useState({ minGross: "", maxGross: "" });
  const doAddSlab = async () => {
    if (!structure || !companyId || !slabForm.minGross) { toast({ title: "Minimum gross is required.", variant: "destructive" }); return; }
    const minGross = Number(slabForm.minGross);
    const maxGross = slabForm.maxGross ? Number(slabForm.maxGross) : null;
    if (!Number.isFinite(minGross) || minGross < 0 || (maxGross != null && (!Number.isFinite(maxGross) || maxGross < minGross))) {
      toast({ title: "Invalid range.", description: "Minimum must be 0 or more, and maximum (if given) must not be below the minimum.", variant: "destructive" });
      return;
    }
    // Same inclusive-bounds rule as the database constraint; names the real conflicting slab from the stored values.
    const clash = findSlabOverlap({ minGross, maxGross }, allSlabs);
    if (clash) {
      toast({
        title: "Overlaps an existing active slab.",
        description: `${structLabel(clash.salaryStructureId)}: ${slabRange(clash)} (stored ${clash.minGross} – ${clash.maxGross ?? "∞"}). Both ends are inclusive, so an adjacent slab must start ₹0.01 above the previous maximum.`,
        variant: "destructive",
      });
      return;
    }
    try {
      await addSlab.mutateAsync({ companyId, salaryStructureId: structure.id, minGross, maxGross, userId: user?.id });
      toast({ title: "Slab rule added.", variant: "success" }); setSlabForm({ minGross: "", maxGross: "" });
    } catch (e) {
      const overlap = (e as { code?: string } | null)?.code === "23P01"; // exclusion_violation
      toast({ title: overlap ? "Add failed — overlaps an existing active slab." : "Add failed.", description: msg(e), variant: "destructive" });
    }
  };

  const previewRows = previewQ.data ?? [];
  const previewGrossSum = previewRows.filter((r) => r.category === "earning" && r.includedInGross).reduce((a, r) => a + r.amount, 0);

  return (
    <Dialog open={Boolean(structure)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{structure?.code} — {structure?.name}</DialogTitle>
          <DialogDescription>Configure components, slab routing and Preview. Preview calls <span className="font-mono">salary_bifurcate()</span> — the exact function the Payroll Run uses.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* components + slabs */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Components ({comps.length})</p>
              <Button size="sm" variant="outline" onClick={openNewComp}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>
            </div>
            <div className="max-h-[38vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Code</TableHead><TableHead>Category</TableHead><TableHead>Type</TableHead><TableHead>Rule</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {comps.map((c) => (
                    <TableRow key={c.id} className={!c.isActive ? "opacity-50" : undefined}>
                      <TableCell className="text-xs">{c.displayOrder}</TableCell>
                      <TableCell className="font-mono text-xs">{c.code}{c.isBasic ? " ★" : ""}</TableCell>
                      <TableCell className="text-xs">{c.category.replace("_", " ")}</TableCell>
                      <TableCell className="text-xs">{CALC_TYPES.find((t) => t.v === c.calculationType)?.label ?? c.calculationType}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
                        {c.calculationType === "fixed" ? formatAmount(c.fixedAmount ?? 0)
                          : c.calculationType === "formula" ? c.formulaExpression
                          : c.calculationType === "pct_of_component" ? `${c.percentage ?? 0}% of ${c.baseComponentCode ?? "?"}`
                          : ["pct_of_gross", "pct_of_basic"].includes(c.calculationType) ? `${c.percentage ?? 0}%`
                          : c.calculationType === "balance" ? "Gross − Σ(earnings)"
                          : c.calculationType === "manual" ? "Per employee/period — Manual/Excel"
                          : "—"}
                        {c.isStatutory ? ` · ${c.statutoryKind ?? "statutory"}${c.statutoryRate == null ? " (rate UNRESOLVED → ₹0)" : ""}` : ""}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEditComp(c)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => delComp.mutate(c.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Salary slabs (Gross → this structure)</p>
              <p className="mb-2 text-xs text-muted-foreground">Ranges are inclusive at both ends (Gross ≥ min and ≤ max; blank max = ∞). Overlapping active ranges across the company are rejected at the database — adjacent slabs must differ by ₹0.01.</p>
              <div className="space-y-1">
                {slabsForStruct.map((s) => (
                  <div key={s.id} className={`flex items-center justify-between rounded border px-2 py-1 text-xs ${s.isActive ? "" : "opacity-50"}`}>
                    <span>{slabRange(s)}{s.isActive ? "" : " (inactive)"}</span>
                    <Button size="sm" variant="ghost" onClick={() => delSlab.mutate(s.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                ))}
                {slabsOfOthers.length > 0 && (
                  <>
                    <p className="pt-1 text-[11px] text-muted-foreground">Slabs of other structures (also count towards overlap):</p>
                    {slabsOfOthers.map((s) => (
                      <div key={s.id} className={`flex items-center justify-between rounded border border-dashed px-2 py-1 text-xs text-muted-foreground ${s.isActive ? "" : "opacity-50"}`}>
                        <span>{slabRange(s)}{s.isActive ? "" : " (inactive)"}</span>
                        <span className="font-mono">{structLabel(s.salaryStructureId).split(" — ")[0]}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div className="space-y-1"><Label className="text-xs">Min gross</Label><Input className="h-8 w-28" type="number" value={slabForm.minGross} onChange={(e) => setSlabForm({ ...slabForm, minGross: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Max gross (blank = ∞)</Label><Input className="h-8 w-28" type="number" value={slabForm.maxGross} onChange={(e) => setSlabForm({ ...slabForm, maxGross: e.target.value })} /></div>
                <Button size="sm" variant="outline" onClick={doAddSlab} disabled={addSlab.isPending}>Add slab</Button>
              </div>
            </div>

            <CommonComponentsReference companyId={companyId} onOpenCommon={onOpenCommon} />
          </div>

          {/* preview */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <p className="text-sm font-medium">Test Structure</p>
            <p className="text-[11px] text-muted-foreground">Enter a sample Gross to see Gross → Basic → DA → Allowance → balance for THIS structure. Read-only: the structure stays a draft, and is not used by payroll, until you click Activate on the Salary Structures list.</p>
            <div className="space-y-1"><Label className="text-xs">Sample Gross salary</Label><Input type="number" value={previewGross} onChange={(e) => { setPreviewGross(e.target.value); setValidation(null); }} /></div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={!structure || validateStruct.isPending} onClick={async () => {
                if (!structure) return;
                try { setValidation(await validateStruct.mutateAsync(structure.id)); }
                catch (e) { setValidation({ ok: false, error: msg(e) ?? "Validation failed." }); }
              }}>{validateStruct.isPending ? "Validating…" : "Validate structure"}</Button>
              {validation && (validation.ok
                ? <span className="text-xs text-emerald-700" role="status">Structure is valid — every component resolves and earnings reconcile to Gross.</span>
                : <span className="text-xs text-destructive" role="alert">{validation.error}</span>)}
            </div>
            {previewQ.isLoading ? <LoadingState rows={4} /> : previewQ.isError ? (
              <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{msg(previewQ.error)}</p>
            ) : previewRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Add components to preview.</p>
            ) : (
              <div className="max-h-[40vh] overflow-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Component</TableHead><TableHead>Basis</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {previewRows.map((r) => (
                      <TableRow key={r.code}>
                        <TableCell className="text-xs">{r.name} <span className="text-muted-foreground">({r.category === "employer_contribution" ? "employer" : r.category})</span></TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">
                          {r.calculationType === "formula" ? r.calcFormula
                            : r.calcBase ? `${r.calcRate ?? ""}% of ${r.calcBase}`
                            : r.calculationType === "fixed" ? "fixed"
                            : r.calculationType === "balance" ? "balance"
                            : r.calculationType}
                        </TableCell>
                        <TableCell className={`text-right text-xs ${r.amount < 0 ? "text-destructive" : ""}`}>{formatAmount(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="text-xs font-medium" colSpan={2}>Σ earnings in Gross</TableCell>
                      <TableCell className={`text-right text-xs font-medium ${Math.abs(previewGrossSum - previewNum) > 0.01 ? "text-destructive" : "text-emerald-700"}`}>{formatAmount(previewGrossSum)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        {/* component editor */}
        <Dialog open={compOpen} onOpenChange={setCompOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editComp ? "Edit" : "Add"} Component</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Code</Label><Input value={cf.code} onChange={(e) => setCf({ ...cf, code: e.target.value })} disabled={Boolean(editComp)} /></div>
              <div className="space-y-1.5"><Label>Name</Label><Input value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={cf.category} onValueChange={(v) => setCf({ ...cf, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.v} value={c.v}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Calculation type</Label>
                <Select value={cf.calculationType} onValueChange={(v) => setCf({ ...cf, calculationType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CALC_TYPES.map((c) => <SelectItem key={c.v} value={c.v}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {cf.calculationType === "fixed" && (
                <div className="space-y-1.5"><Label>Fixed amount (₹)</Label><Input type="number" value={cf.fixedAmount} onChange={(e) => setCf({ ...cf, fixedAmount: e.target.value })} /></div>
              )}
              {["pct_of_gross", "pct_of_basic", "pct_of_component"].includes(cf.calculationType) && (
                <div className="space-y-1.5"><Label>Percentage (%)</Label><Input type="number" value={cf.percentage} onChange={(e) => setCf({ ...cf, percentage: e.target.value })} /></div>
              )}
              {cf.calculationType === "pct_of_component" && (
                <div className="space-y-1.5">
                  <Label>Base component</Label>
                  <Select value={cf.baseComponentCode} onValueChange={(v) => setCf({ ...cf, baseComponentCode: v })}>
                    <SelectTrigger><SelectValue placeholder="Pick a component" /></SelectTrigger>
                    <SelectContent>{comps.filter((c) => c.code !== cf.code).map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {cf.calculationType === "manual" && (
              cf.code.trim().toUpperCase() === "OT" ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  Overtime can never use Manual / Excel Import — OT is always calculated from Attendance → Overtime Rules. Choose a different Calculation type.
                </div>
              ) : (
                <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                  <p>Amount will be supplied per employee and payroll period through manual entry or Excel import.</p>
                  <Link to={ROUTES.payrollComponentAmounts} className="mt-1 inline-flex items-center gap-1 font-medium text-sky-700 underline">
                    Go to Manual Component Amount Input <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )
            )}
            {cf.calculationType === "formula" && (
              <div className="space-y-1.5">
                <Label>Formula</Label>
                <Textarea value={cf.formulaExpression} onChange={(e) => setCf({ ...cf, formulaExpression: e.target.value })} placeholder="round(BASIC * 0.4 + min(GROSS * 0.1, 1600), 2)" />
                <p className="text-[11px] text-muted-foreground">Allowed: other component codes, <span className="font-mono">GROSS</span>, numbers, <span className="font-mono">+ - * / ( )</span> and <span className="font-mono">round min max abs least greatest floor ceil</span>. No <span className="font-mono">;</span>, no SQL, no other identifiers — the backend re-validates and rejects anything else.</p>
              </div>
            )}
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={cf.isBasic} onCheckedChange={(v) => setCf({ ...cf, isBasic: Boolean(v) })} /> Is Basic</label>
              <label className="flex items-center gap-2"><Checkbox checked={cf.includedInGross} onCheckedChange={(v) => setCf({ ...cf, includedInGross: Boolean(v) })} /> In Gross</label>
              <label className="flex items-center gap-2"><Checkbox checked={cf.includedInCtc} onCheckedChange={(v) => setCf({ ...cf, includedInCtc: Boolean(v) })} /> In CTC</label>
              <label className="flex items-center gap-2"><Checkbox checked={cf.isTaxable} onCheckedChange={(v) => setCf({ ...cf, isTaxable: Boolean(v) })} /> Taxable</label>
              <label className="flex items-center gap-2"><Checkbox checked={cf.isStatutory} onCheckedChange={(v) => setCf({ ...cf, isStatutory: Boolean(v) })} /> Statutory</label>
              <label className="flex items-center gap-2"><Checkbox checked={cf.isActive} onCheckedChange={(v) => setCf({ ...cf, isActive: Boolean(v) })} /> Active</label>
            </div>
            {cf.isStatutory && (
              <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50/50 p-3 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Kind</Label>
                  <Select value={cf.statutoryKind} onValueChange={(v) => setCf({ ...cf, statutoryKind: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent><SelectItem value="pf">PF</SelectItem><SelectItem value="esi">ESI</SelectItem><SelectItem value="pt">PT</SelectItem><SelectItem value="tds">TDS</SelectItem><SelectItem value="gratuity">Gratuity</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Base</Label>
                  <Select value={cf.statutoryBase} onValueChange={(v) => setCf({ ...cf, statutoryBase: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent><SelectItem value="basic">Basic</SelectItem><SelectItem value="basic_da">Basic + DA</SelectItem><SelectItem value="gross">Gross</SelectItem><SelectItem value="component">Component</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Rate % (blank = UNRESOLVED → ₹0)</Label><Input type="number" value={cf.statutoryRate} onChange={(e) => setCf({ ...cf, statutoryRate: e.target.value })} placeholder="—" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Ceiling ₹ (optional)</Label><Input type="number" value={cf.statutoryCeiling} onChange={(e) => setCf({ ...cf, statutoryCeiling: e.target.value })} placeholder="—" /></div>
              </div>
            )}
            <div className="space-y-1.5"><Label>Display order</Label><Input type="number" value={cf.displayOrder} onChange={(e) => setCf({ ...cf, displayOrder: e.target.value })} className="w-32" /></div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCompOpen(false)} disabled={upsertComp.isPending}>Cancel</Button>
              <Button onClick={saveComp} disabled={upsertComp.isPending}>{upsertComp.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

/* ========================================================================== */
/* Phase 5 — Salary Components (flat master) + Payroll Policy  (unchanged)      */
/* ========================================================================== */

function ComponentsTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const q = usePayrollComponents(companyId);
  const upsert = useUpsertPayrollComponent();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState({ code: "", name: "", componentType: "earning", calculationMethod: "manual", source: "", isTaxable: false, isStatutory: false, isActive: true, sortOrder: "100" });
  // An OT component is a special system-calculated line — its amount comes from the Attendance OT Rule Engine,
  // never a generic Calculation Method. The DB CHECK payroll_salary_components_ot_attendance_only enforces this too.
  const isOtComponent = f.source.trim().toLowerCase() === "overtime" || f.code.trim().toUpperCase() === "OT";

  const openEdit = (c: NonNullable<typeof q.data>[number]) => {
    setEditId(c.id);
    setF({ code: c.code, name: c.name, componentType: c.componentType, calculationMethod: c.calculationMethod, source: c.source ?? "", isTaxable: c.isTaxable, isStatutory: c.isStatutory, isActive: c.isActive, sortOrder: String(c.sortOrder) });
    setOpen(true);
  };
  const save = async () => {
    if (!companyId || !f.code.trim() || !f.name.trim()) { toast({ title: "Code and name are required.", variant: "destructive" }); return; }
    try {
      await upsert.mutateAsync({
        id: editId ?? undefined, companyId, code: f.code.trim(), name: f.name.trim(),
        componentType: f.componentType as "earning" | "deduction", calculationMethod: isOtComponent ? "attendance_input" : f.calculationMethod,
        source: f.source.trim() || null, isTaxable: f.isTaxable, isStatutory: f.isStatutory, isActive: f.isActive,
        sortOrder: Number(f.sortOrder) || 100, userId: user?.id,
      });
      toast({ title: editId ? "Component updated." : "Component created.", variant: "success" });
      setOpen(false); setEditId(null);
    } catch (e) { toast({ title: "Save failed", description: msg(e), variant: "destructive" }); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Salary Components (flat master)</CardTitle>
        <Button size="sm" onClick={() => { setEditId(null); setF({ code: "", name: "", componentType: "earning", calculationMethod: "manual", source: "", isTaxable: false, isStatutory: false, isActive: true, sortOrder: "100" }); setOpen(true); }}>New</Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
          <b>Legacy.</b> Configure PF, ESI, Medical Fund, Incentive and other earnings/deductions under <b>Common Payroll Components</b> instead. This flat master is kept only for employees who have no salary structure; the old “Fund” (Medical Fund) row here has been switched off.
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Used by the Phase 5 legacy path (employees with no dynamic salary structure). <span className="font-mono">fixed_from_salary</span> = Basic / DA from the effective salary;
          <span className="font-mono"> not_configured</span> = statutory line, no formula (₹0); <span className="font-mono">advance_recovery</span> / <span className="font-mono">lwp</span> / <span className="font-mono">attendance_input</span> are integration points.
        </p>
        {q.isLoading ? (
          <LoadingState />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Sort</TableHead><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Method</TableHead><TableHead>Statutory</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {(q.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs">{c.sortOrder}</TableCell>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-xs capitalize">{c.componentType}</TableCell>
                    <TableCell className="font-mono text-xs">{c.calculationMethod}</TableCell>
                    <TableCell>{c.isStatutory ? "Yes" : "No"}</TableCell>
                    <TableCell>{c.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => openEdit(c)}>Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit" : "New"} Salary Component</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Code</Label><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={Boolean(editId)} /></div>
            <div className="space-y-1.5"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={f.componentType} onValueChange={(v) => setF({ ...f, componentType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="earning">Earning</SelectItem><SelectItem value="deduction">Deduction</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Calculation Method</Label>
              {isOtComponent ? (
                <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
                  <p>OT is calculated automatically from Attendance OT Rules. Method is fixed to <span className="font-mono">attendance_input</span>.</p>
                  <Link to={ROUTES.attendanceRules} className="mt-1 inline-flex items-center gap-1 font-medium text-sky-700 underline">
                    Configure OT Rules → Attendance Settings <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <Select value={f.calculationMethod} onValueChange={(v) => setF({ ...f, calculationMethod: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_from_salary">fixed_from_salary</SelectItem>
                    <SelectItem value="manual">manual</SelectItem>
                    <SelectItem value="attendance_input">attendance_input</SelectItem>
                    <SelectItem value="advance_recovery">advance_recovery</SelectItem>
                    <SelectItem value="lwp">lwp</SelectItem>
                    <SelectItem value="not_configured">not_configured</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5"><Label>Source</Label><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="basic / da / statutory / overtime / night_duty / custom" /></div>
            <div className="space-y-1.5"><Label>Sort order</Label><Input type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></div>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: Boolean(v) })} /> Active</label>
            <label className="flex items-center gap-2"><Checkbox checked={f.isTaxable} onCheckedChange={(v) => setF({ ...f, isTaxable: Boolean(v) })} /> Taxable</label>
            <label className="flex items-center gap-2"><Checkbox checked={f.isStatutory} onCheckedChange={(v) => setF({ ...f, isStatutory: Boolean(v) })} /> Statutory</label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={upsert.isPending}>Cancel</Button>
            <Button onClick={save} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ========================================================================== */
/* Phase 6 — Payroll Policy Engine (versioned)                                 */
/* ========================================================================== */

const PRORATION_METHODS = [
  { v: "calendar_days", label: "Calendar days" }, { v: "working_days", label: "Working days" },
  { v: "fixed_26", label: "Fixed 26" }, { v: "fixed_30", label: "Fixed 30" }, { v: "custom", label: "Custom" },
];
const SALARY_BASES = [
  { v: "basic", label: "Basic" }, { v: "basic_da", label: "Basic + DA" }, { v: "gross", label: "Gross" }, { v: "custom", label: "Custom formula" },
];
/** Migration 0185 — OT/Late hourly wage basis is policy configuration, not a hard-coded "Basic + DA". */
const OT_LATE_BASES = [
  { v: "basic", label: "Basic" }, { v: "da", label: "DA" }, { v: "basic_da", label: "Basic + DA" }, { v: "gross", label: "Gross" },
  { v: "component", label: "Another Salary Component" }, { v: "custom", label: "Custom Formula" },
];
/** Migration 0185 — OT/Late day divisor is policy configuration, not a hard-coded "payroll month calendar days".
 *  "Working Days" composes with this SAME policy's Working-days method (Proration tab) — Store Calendar included —
 *  instead of a second, duplicate calendar-resolution path. */
const OT_LATE_DIVISORS = [
  { v: "calendar_days", label: "Payroll Month Calendar Days" },
  { v: "working_days", label: "Working Days (this policy's Working-days method)" },
  { v: "custom", label: "Custom Divisor" },
];
const otLateBasisLabel = (v: string | null | undefined) => OT_LATE_BASES.find((o) => o.v === v)?.label ?? "Basic + DA";
const otLateDivisorLabel = (v: string | null | undefined) => OT_LATE_DIVISORS.find((o) => o.v === v)?.label ?? "Payroll Month Calendar Days";
/** UI method options → stored (calc_method, calc_base). "% of Basic" and "% of Gross"
 *  are the same engine method (pct_of_base) with the base preset. */
const STAT_METHOD_UI = [
  { v: "fixed_amount", label: "Fixed Amount", method: "fixed_amount", base: null as string | null },
  { v: "pct_basic", label: "% of Basic", method: "pct_of_base", base: "basic" },
  { v: "pct_gross", label: "% of Gross", method: "pct_of_base", base: "gross" },
  { v: "pct_of_component", label: "% of Another Component", method: "pct_of_component", base: null },
  { v: "formula", label: "Custom Formula", method: "formula", base: null },
  { v: "manual", label: "Manual / Excel Import", method: "manual", base: null },
];
const statMethodUiValue = (method: string, base: string | null): string => {
  if (method === "pct_of_base") return base === "gross" ? "pct_gross" : "pct_basic";
  return method;
};
const ND_RATE_TYPES = [
  { v: "fixed", label: "Fixed per unit" }, { v: "pct_of_basic", label: "% of Basic" },
  { v: "pct_of_basic_da", label: "% of Basic+DA" }, { v: "custom_formula", label: "Custom formula" },
];
const ALL_DED_CODES = ["PF", "ESI", "PT", "TDS", "LWP", "LATE", "ADVREC"];

/** A fixed (non-editable) company rule shown as a labelled value, so the active configuration is unambiguous. */
function FixedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex min-h-10 items-center rounded-md border bg-muted/40 px-3 py-2 text-sm" aria-readonly="true">{value}</div>
    </div>
  );
}

function PolicyEngineTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const listQ = usePayrollPolicies(companyId);
  const create = useCreatePolicyVersion();
  const update = useUpdatePolicyV2();
  const validate = useValidatePolicy();
  const activate = useActivatePolicy();

  const policies = listQ.data ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const selected = policies.find((p) => p.id === selId) ?? policies[0] ?? null;
  const [previewOpen, setPreviewOpen] = useState(false);

  const [draft, setDraft] = useState<Partial<PayrollPolicyV2>>({});
  const cur = { ...(selected ?? {}), ...draft } as PayrollPolicyV2;
  const dirty = Object.keys(draft).length > 0;
  const editable = selected && selected.status !== "archived";
  const set = <K extends keyof PayrollPolicyV2>(k: K, v: PayrollPolicyV2[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const resetDraft = () => setDraft({});

  const doCreate = async () => {
    if (!companyId) return;
    const code = window.prompt("New policy version code:", `PAYROLL_V${(policies.at(0)?.versionNo ?? 1) + 1}`);
    if (!code) return;
    const eff = window.prompt("Effective from (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!eff) return;
    try {
      const res = await create.mutateAsync({ companyId, policyName: `Payroll Policy ${code}`, code: code.trim().toUpperCase(), effectiveFrom: eff, previousPolicyId: selected?.id ?? null, userId: user?.id });
      setSelId(res.id); resetDraft();
      toast({ title: "Draft policy version created.", description: selected ? "Statutory / common component rules, PT slabs and deduction order were copied from the previous version. Edit them freely — the old version is unchanged." : undefined, variant: "success" });
    } catch (e) { toast({ title: "Create failed", description: msg(e), variant: "destructive" }); }
  };
  const saveScalars = async (keys: Array<keyof PayrollPolicyV2>) => {
    if (!selected) return;
    const map: Record<string, string> = {
      prorationMethod: "proration_method", prorationBasis: "proration_basis", prorationCustomDivisor: "proration_custom_divisor",
      prorationCustomFormula: "proration_custom_formula", currencyPrecision: "currency_precision", rounding: "rounding",
      lwpEnabled: "lwp_enabled", lwpBasis: "lwp_basis", lwpDivisor: "lwp_divisor", lwpDivisorBasis: "lwp_divisor_basis",
      lwpProrationMethod: "lwp_proration_method", lwpHalfDaySupported: "lwp_half_day_supported", lwpRounding: "lwp_rounding", lwpCustomFormula: "lwp_custom_formula",
      otEnabled: "ot_enabled", otStdHoursPerDay: "ot_std_hours_per_day", lateDeductionEnabled: "late_deduction_enabled",
      otLateBasis: "ot_late_basis", otLateBasisComponentCode: "ot_late_basis_component_code", otLateBasisFormula: "ot_late_basis_formula",
      otLateDivisorMethod: "ot_late_divisor_method", otLateDivisorCustom: "ot_late_divisor_custom",
      ndEarningEnabled: "nd_earning_enabled", ndRateType: "nd_rate_type", ndRate: "nd_rate", ndBasis: "nd_basis", ndRounding: "nd_rounding", ndCustomFormula: "nd_custom_formula",
      deductionCapMode: "deduction_cap_mode", deductionCapValue: "deduction_cap_value", deductionCapFormula: "deduction_cap_formula", negativeNetPolicy: "negative_net_policy",
      policyName: "policy_name", effectiveFrom: "effective_from", effectiveTo: "effective_to",
      workingDaysMethod: "working_days_method", exitDatePayable: "exit_date_payable",
    };
    const values: Record<string, unknown> = {};
    for (const k of keys) { const col = map[k as string]; if (col) values[col] = (cur as unknown as Record<string, unknown>)[k] === "" ? null : (cur as unknown as Record<string, unknown>)[k]; }
    try {
      await update.mutateAsync({ id: selected.id, values, userId: user?.id });
      resetDraft();
      toast({ title: "Policy saved.", variant: "success" });
    } catch (e) { toast({ title: "Save failed", description: msg(e), variant: "destructive" }); }
  };
  const doValidate = async () => {
    if (!selected) return;
    const v = await validate.mutateAsync(selected.id);
    toast({ title: v.ok ? "Policy is valid." : "Validation failed", description: v.error ?? undefined, variant: v.ok ? "success" : "destructive" });
  };
  const doActivate = async () => {
    if (!selected) return;
    try { await activate.mutateAsync(selected.id); toast({ title: "Policy version activated.", variant: "success" }); }
    catch (e) { toast({ title: "Activate failed", description: msg(e), variant: "destructive" }); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm">Versions</CardTitle>
          <Button size="sm" variant="outline" onClick={doCreate}><Plus className="h-3.5 w-3.5" /></Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {listQ.isLoading ? <LoadingState rows={3} /> : policies.map((p) => (
            <button key={p.id} onClick={() => { setSelId(p.id); resetDraft(); }}
              className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${selected?.id === p.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono">{p.code ?? "—"}</span>
                <Badge variant={p.status === "active" ? "success" : p.status === "draft" ? "warning" : "secondary"} className="text-[10px] capitalize">{p.status}</Badge>
              </div>
              <div className="text-muted-foreground">{p.effectiveFrom}{p.effectiveTo ? ` – ${p.effectiveTo}` : " →"}</div>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        {!selected ? (
          <CardContent className="py-10"><EmptyState icon={Wand2} title="No payroll policy" description="Create a version to configure proration, LWP, overtime, night duty and statutory rules." /></CardContent>
        ) : (
          <>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">{selected.policyName} <span className="font-mono text-xs text-muted-foreground">v{selected.versionNo}</span></CardTitle>
                <p className="text-xs text-muted-foreground">Effective {selected.effectiveFrom}{selected.effectiveTo ? ` to ${selected.effectiveTo}` : " onward"}. Payroll resolves the policy by the period END date; finalized payroll keeps its snapshot.</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setPreviewOpen(true)}>Preview</Button>
                <Button size="sm" variant="ghost" onClick={doValidate} disabled={validate.isPending}>Validate</Button>
                {selected.status !== "active" && <Button size="sm" onClick={doActivate} disabled={activate.isPending}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Activate</Button>}
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="proration">
                <TabsList className="flex-wrap">
                  <TabsTrigger value="proration">Proration</TabsTrigger>
                  <TabsTrigger value="lwp">LWP</TabsTrigger>
                  <TabsTrigger value="ot">Overtime</TabsTrigger>
                  <TabsTrigger value="late">Late</TabsTrigger>
                  <TabsTrigger value="nd">Night Duty</TabsTrigger>
                  <TabsTrigger value="stat">Statutory</TabsTrigger>
                  <TabsTrigger value="order">Deduction Order</TabsTrigger>
                  <TabsTrigger value="cap">Cap &amp; Negative Net</TabsTrigger>
                </TabsList>

                <TabsContent value="proration" className="space-y-3 pt-3">
                  <UnresolvedBanner text="Supported options only — the company confirms which method and divisor apply. Blank = no proration; a joining/exit-month employee is flagged. The SAME engine prorates the joining month and the exit month." />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Pick label="Proration method" value={cur.prorationMethod} opts={PRORATION_METHODS} on={(v) => set("prorationMethod", v)} disabled={!editable} />
                    <Pick label="Salary basis" value={cur.prorationBasis} opts={SALARY_BASES} on={(v) => set("prorationBasis", v)} disabled={!editable} />
                    <NumF label="Custom divisor" v={cur.prorationCustomDivisor} on={(v) => set("prorationCustomDivisor", v)} disabled={!editable} />
                    <div className="sm:col-span-3"><Label className="text-xs">Custom basis formula</Label><Input value={cur.prorationCustomFormula ?? ""} onChange={(e) => set("prorationCustomFormula", e.target.value)} placeholder="BASIC + DA" disabled={!editable} /></div>
                    <NumF label="Currency precision" v={cur.currencyPrecision} on={(v) => set("currencyPrecision", (v ?? 2) as number)} disabled={!editable} />
                    <Pick label="Working-days method" value={cur.workingDaysMethod} opts={[{ v: "calendar_minus_offdays", label: "Calendar − off days (attendance)" }, { v: "store_calendar", label: "Store Calendar" }, { v: "custom", label: "Custom" }]} on={(v) => set("workingDaysMethod", v)} disabled={!editable} />
                    <div className="space-y-1.5">
                      <Label className="text-xs">Leaving date is payable? <span className="text-amber-700">(UNRESOLVED until confirmed)</span></Label>
                      <Select value={cur.exitDatePayable == null ? "" : cur.exitDatePayable ? "yes" : "no"}
                        onValueChange={(v) => set("exitDatePayable", (v === "yes" ? true : v === "no" ? false : null) as boolean | null)} disabled={!editable}>
                        <SelectTrigger><SelectValue placeholder="Not confirmed" /></SelectTrigger>
                        <SelectContent><SelectItem value="yes">Yes — pay the leaving date</SelectItem><SelectItem value="no">No — last payable day is the day before</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">The proration method, divisor and working-days method above drive salary proration (joining / exit month) and LWP only. Overtime and Late do <span className="font-medium">not</span> use them — they always use the payroll month's calendar days (see the Overtime and Late tabs).</p>
                  <SaveBar dirty={dirty} onSave={() => saveScalars(["prorationMethod", "prorationBasis", "prorationCustomDivisor", "prorationCustomFormula", "currencyPrecision", "workingDaysMethod", "exitDatePayable"])} onReset={resetDraft} pending={update.isPending} />
                </TabsContent>

                <TabsContent value="lwp" className="space-y-3 pt-3">
                  <UnresolvedBanner text="LWP days come from the Leave module's daily Paid/Unpaid allocation. Enable + choose a basis and divisor/method to compute a daily rate — nothing is hard-coded." />
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={cur.lwpEnabled} onCheckedChange={(v) => set("lwpEnabled", Boolean(v))} disabled={!editable} /> Enable LWP deduction</label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Pick label="Salary basis" value={cur.lwpBasis ?? cur.lwpDivisorBasis} opts={SALARY_BASES} on={(v) => set("lwpBasis", v)} disabled={!editable} />
                    <Pick label="Proration method" value={cur.lwpProrationMethod} opts={PRORATION_METHODS} on={(v) => set("lwpProrationMethod", v)} disabled={!editable} />
                    <NumF label="Divisor (fallback)" v={cur.lwpDivisor} on={(v) => set("lwpDivisor", v)} disabled={!editable} />
                    <Pick label="Rounding" value={cur.lwpRounding} opts={[{ v: "round_2", label: "2 decimals" }, { v: "nearest_rupee", label: "Nearest rupee" }, { v: "none", label: "None" }]} on={(v) => set("lwpRounding", v)} disabled={!editable} />
                    <label className="flex items-center gap-2 pt-6 text-sm"><Checkbox checked={cur.lwpHalfDaySupported} onCheckedChange={(v) => set("lwpHalfDaySupported", Boolean(v))} disabled={!editable} /> Support half-day LWP (0.5)</label>
                  </div>
                  <SaveBar dirty={dirty} onSave={() => saveScalars(["lwpEnabled", "lwpBasis", "lwpProrationMethod", "lwpDivisor", "lwpRounding", "lwpHalfDaySupported"])} onReset={resetDraft} pending={update.isPending} />
                </TabsContent>

                <TabsContent value="ot" className="space-y-3 pt-3">
                  <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                    <p className="font-medium">Overtime minutes come from Attendance → Overtime / OT Rules.</p>
                    <p className="mt-1">
                      The OT Rule owns eligibility, the minimum OT minutes, rounding, slabs / any premium, limits and the approved payable overtime.
                      Payroll only <span className="font-medium">consumes</span> those payable minutes from <span className="font-mono">attendance_records</span> and
                      converts them to money. There is no rate type, multiplier or ₹ amount to set here.
                    </p>
                    <Link to={ROUTES.attendanceRules} className="mt-2 inline-flex items-center gap-1 font-medium text-sky-700 underline">
                      Configure OT Rules → Attendance Settings <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={cur.otEnabled} onCheckedChange={(v) => set("otEnabled", Boolean(v))} disabled={!editable} /> Show overtime as a payslip earning line</label>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <FixedField label="Overtime Calculation Basis" value="Attendance OT Rules" />
                    <Pick label="Hourly Wage Basis" value={cur.otLateBasis} opts={OT_LATE_BASES} on={(v) => set("otLateBasis", v as PayrollPolicyV2["otLateBasis"])} disabled={!editable} />
                    <Pick label="Day Divisor" value={cur.otLateDivisorMethod} opts={OT_LATE_DIVISORS} on={(v) => set("otLateDivisorMethod", v as PayrollPolicyV2["otLateDivisorMethod"])} disabled={!editable} />
                    <NumF label="Standard Hours/Day" v={cur.otStdHoursPerDay} on={(v) => set("otStdHoursPerDay", v)} disabled={!editable} />
                  </div>
                  {cur.otLateBasis === "component" && (
                    <div className="space-y-1.5"><Label className="text-xs">Salary component code</Label>
                      <Input className="max-w-xs" value={cur.otLateBasisComponentCode ?? ""} onChange={(e) => set("otLateBasisComponentCode", e.target.value.toUpperCase() || null)} placeholder="BASIC / DA / ALLOWANCE / …" disabled={!editable} />
                    </div>
                  )}
                  {cur.otLateBasis === "custom" && (
                    <div className="space-y-1.5"><Label className="text-xs">Custom wage-basis formula</Label>
                      <Input value={cur.otLateBasisFormula ?? ""} onChange={(e) => set("otLateBasisFormula", e.target.value)} placeholder="BASIC + DA / 2" disabled={!editable} />
                    </div>
                  )}
                  {cur.otLateDivisorMethod === "custom" && (
                    <NumF label="Custom day divisor" v={cur.otLateDivisorCustom} on={(v) => set("otLateDivisorCustom", v)} disabled={!editable} />
                  )}
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900" role="note">
                    <p className="font-medium">Company OT hourly basis (configured, not fixed):</p>
                    <p className="mt-1">{otLateBasisLabel(cur.otLateBasis)} ÷ {otLateDivisorLabel(cur.otLateDivisorMethod).replace(/ \(.*\)$/, "")} ÷ {cur.otStdHoursPerDay ?? "standard"} hours.</p>
                    <p className="mt-1">Current seeded example: ₹10,000 ÷ 30 ÷ 10 = ₹33.33/hour in September — use Preview to see the exact rate for any month under the current configuration.</p>
                    <p className="mt-1 text-emerald-800">The Day Divisor is independent of the Proration method used for joining/exit-month proration and LWP (see the Proration tab) — choosing "Working Days" here reuses that tab's Working-days method (including Store Calendar) rather than a second calendar-resolution path.</p>
                  </div>
                  <p className="text-xs text-muted-foreground">If Standard Hours/Day is empty (or a Custom Formula / Another Component / Custom Divisor choice is left unconfigured), OT shows ₹0 with a review flag — nothing is ever guessed. The same wage basis, day divisor and hours/day are used for the Late deduction below.</p>
                  <SaveBar dirty={dirty} onSave={() => saveScalars(["otEnabled", "otStdHoursPerDay", "otLateBasis", "otLateBasisComponentCode", "otLateBasisFormula", "otLateDivisorMethod", "otLateDivisorCustom"])} onReset={resetDraft} pending={update.isPending} />
                </TabsContent>

                <TabsContent value="late" className="space-y-3 pt-3">
                  <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                    <p className="font-medium">Late minutes come from Attendance.</p>
                    <p className="mt-1">
                      The Attendance Late Rule (grace, minimum, rounding, thresholds), the Information exemption and the Penalty Rule (fixed / multiplier / slab, applicability)
                      decide the payable late minutes (<span className="font-mono">attendance_records.penalty_minutes</span>). Payroll does not repeat any of that — it only values those minutes.
                    </p>
                    <Link to={ROUTES.attendanceRules} className="mt-2 inline-flex items-center gap-1 font-medium text-sky-700 underline">
                      Configure Late / Penalty Rules → Attendance Settings <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={cur.lateDeductionEnabled} onCheckedChange={(v) => set("lateDeductionEnabled", Boolean(v))} disabled={!editable} /> Deduct Late from salary (adds a “Late Deduction” line)</label>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <FixedField label="Late Calculation Basis" value="Use OT Hourly Basis (below)" />
                    <FixedField label="Hourly Wage Basis" value={`${otLateBasisLabel(cur.otLateBasis)} (set under Overtime)`} />
                    <FixedField label="Day Divisor" value={`${otLateDivisorLabel(cur.otLateDivisorMethod)} (set under Overtime)`} />
                    <FixedField label="Standard Hours/Day" value={cur.otStdHoursPerDay == null ? "Not configured (set under Overtime)" : `${cur.otStdHoursPerDay} (set under Overtime)`} />
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900" role="note">
                    <p className="font-medium">Late deduction = payable late hours × the SAME configured hourly basis as Overtime — one basis, not a duplicate.</p>
                    <p className="mt-1">Current seeded example: 60 payable late minutes = 1 hour = ₹33.33 when the hourly basis is ₹33.33 (₹10,000 ÷ 30 ÷ 10, September).</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Off by default: payroll changes only when this is switched on. Change the Hourly Wage Basis, Day Divisor or Standard Hours/Day under the Overtime tab — Late follows automatically. If that basis is unconfigured, Late shows ₹0 with a review flag.</p>
                  <SaveBar dirty={dirty} onSave={() => saveScalars(["lateDeductionEnabled"])} onReset={resetDraft} pending={update.isPending} />
                </TabsContent>

                <TabsContent value="nd" className="space-y-3 pt-3">
                  <UnresolvedBanner text="Night-Duty eligibility / ladder / cutoff / approval are owned by the Night Duty module. Payroll only turns the approved payable value into money at a configured rate." />
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={cur.ndEarningEnabled} onCheckedChange={(v) => set("ndEarningEnabled", Boolean(v))} disabled={!editable} /> Enable night-duty payroll earning</label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Pick label="Rate type" value={cur.ndRateType} opts={ND_RATE_TYPES} on={(v) => set("ndRateType", v)} disabled={!editable} />
                    <NumF label="Rate (₹ or %)" v={cur.ndRate} on={(v) => set("ndRate", v)} disabled={!editable} />
                    <Pick label="Basis" value={cur.ndBasis} opts={SALARY_BASES.filter((b) => b.v !== "custom")} on={(v) => set("ndBasis", v)} disabled={!editable} />
                    <div className="sm:col-span-3"><Label className="text-xs">Custom formula</Label><Input value={cur.ndCustomFormula ?? ""} onChange={(e) => set("ndCustomFormula", e.target.value)} placeholder="NDVALUE * 75" disabled={!editable} /></div>
                  </div>
                  <SaveBar dirty={dirty} onSave={() => saveScalars(["ndEarningEnabled", "ndRateType", "ndRate", "ndBasis", "ndCustomFormula"])} onReset={resetDraft} pending={update.isPending} />
                </TabsContent>

                <TabsContent value="stat" className="pt-3">
                  <StatutoryEditor policy={selected} companyId={companyId} editable={Boolean(editable)} />
                </TabsContent>

                <TabsContent value="order" className="pt-3">
                  <DeductionOrderEditor policy={selected} companyId={companyId} editable={Boolean(editable)} />
                </TabsContent>

                <TabsContent value="cap" className="space-y-3 pt-3">
                  <UnresolvedBanner text="Phase 4/5 apply no general deduction cap and allow negative net. Do not activate a cap or a blocking policy without business confirmation. Advance Recovery is never trimmed by the cap — it is bounded only by its own Outstanding." />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Pick label="Deduction cap mode" value={cur.deductionCapMode} opts={[{ v: "none", label: "No cap" }, { v: "fixed", label: "Fixed amount" }, { v: "pct_of_gross", label: "% of Gross" }, { v: "pct_of_net", label: "% of Net/applicable" }, { v: "custom", label: "Custom formula" }]} on={(v) => set("deductionCapMode", v ?? "none")} disabled={!editable} />
                    <NumF label="Cap value (₹ or %)" v={cur.deductionCapValue} on={(v) => set("deductionCapValue", v)} disabled={!editable} />
                    <div><Label className="text-xs">Cap formula</Label><Input value={cur.deductionCapFormula ?? ""} onChange={(e) => set("deductionCapFormula", e.target.value)} placeholder="GROSS * 0.5" disabled={!editable} /></div>
                    <Pick label="Negative net policy" value={cur.negativeNetPolicy} opts={[{ v: "allow", label: "Allow (flag)" }, { v: "warn", label: "Allow with warning" }, { v: "block", label: "Block (reduce non-protected deductions)" }]} on={(v) => set("negativeNetPolicy", (v ?? "allow") as "allow" | "warn" | "block")} disabled={!editable} />
                  </div>
                  <SaveBar dirty={dirty} onSave={() => saveScalars(["deductionCapMode", "deductionCapValue", "deductionCapFormula", "negativeNetPolicy"])} onReset={resetDraft} pending={update.isPending} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </>
        )}
      </Card>

      {selected && <PolicyPreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} companyId={companyId} />}
    </div>
  );
}

function StatutoryEditor({ policy, companyId, editable }: { policy: PayrollPolicyV2; companyId?: string; editable: boolean }) {
  const { user } = useAuth();
  const rulesQ = usePolicyStatutoryRules(policy.id);
  const slabsQ = usePolicyPtSlabs(policy.id);
  const upsert = useUpsertStatutoryRule();
  const addSlab = useAddPtSlab();
  const delSlab = useDeletePtSlab();
  const rules = rulesQ.data ?? [];
  const [slab, setSlab] = useState({ min: "", max: "", amount: "" });

  const rule = (kind: string) => rules.find((r) => r.kind === kind);
  const saveRule = async (kind: string, patch: Record<string, unknown>) => {
    const ex = rule(kind);
    try {
      await upsert.mutateAsync({
        id: ex?.id, companyId: companyId as string, payrollPolicyId: policy.id, kind,
        enabled: ex?.enabled ?? false, calcMethod: ex?.calcMethod ?? "pct_of_base",
        calcBase: ex?.calcBase ?? null, baseFormula: ex?.baseFormula ?? null, employerFormula: ex?.employerFormula ?? null,
        employeeRate: ex?.employeeRate ?? null, employerRate: ex?.employerRate ?? null,
        employeeAmount: ex?.employeeAmount ?? null, employerAmount: ex?.employerAmount ?? null,
        refComponentCode: ex?.refComponentCode ?? null, wageCeiling: ex?.wageCeiling ?? null,
        rounding: ex?.rounding ?? null, effectiveFrom: ex?.effectiveFrom ?? policy.effectiveFrom, userId: user?.id,
        ...patch,
      });
      toast({ title: `${kind.toUpperCase()} saved.`, variant: "success" });
    } catch (e) { toast({ title: "Save failed", description: msg(e), variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <UnresolvedBanner text="No statutory percentage, ceiling, amount or slab is pre-filled. PF / ESI / PT / TDS stay 'Not Configured' and produce ₹0 until an authorised admin enters the company's own figures. Overtime is NOT here — OT comes only from Attendance → OT Rules." />
      {(["pf", "esi", "gratuity"] as const).map((k) => {
        const r = rule(k);
        const m = r?.calcMethod ?? "pct_of_base";
        const uiMethod = statMethodUiValue(m, r?.calcBase ?? null);
        return (
          <div key={k} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium uppercase">{k}</span>
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={r?.enabled ?? false} onCheckedChange={(v) => saveRule(k, { enabled: Boolean(v) })} disabled={!editable} /> Enabled {r ? "" : "(not configured)"}</label>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Pick label="Calculation Method" value={uiMethod} opts={STAT_METHOD_UI}
                on={(v) => { const o = STAT_METHOD_UI.find((x) => x.v === v); saveRule(k, { calcMethod: o?.method ?? "pct_of_base", ...(o?.base ? { calcBase: o.base } : {}) }); }}
                disabled={!editable} />
              {m === "pct_of_base" && <>
                <NumF label="Employee %" v={r?.employeeRate ?? null} on={(v) => saveRule(k, { employeeRate: v })} disabled={!editable} />
                <NumF label="Employer %" v={r?.employerRate ?? null} on={(v) => saveRule(k, { employerRate: v })} disabled={!editable} />
                <NumF label="Wage ceiling ₹ (optional)" v={r?.wageCeiling ?? null} on={(v) => saveRule(k, { wageCeiling: v })} disabled={!editable} />
              </>}
              {m === "fixed_amount" && <>
                <NumF label="Employee amount ₹" v={r?.employeeAmount ?? null} on={(v) => saveRule(k, { employeeAmount: v })} disabled={!editable} />
                <NumF label="Employer amount ₹ (optional)" v={r?.employerAmount ?? null} on={(v) => saveRule(k, { employerAmount: v })} disabled={!editable} />
              </>}
              {m === "pct_of_component" && <>
                <div className="space-y-1.5"><Label className="text-xs">Of component code</Label><Input className="h-8" defaultValue={r?.refComponentCode ?? ""} onBlur={(e) => saveRule(k, { refComponentCode: e.target.value.toUpperCase() || null })} placeholder="BASIC / HRA / …" disabled={!editable} /></div>
                <NumF label="Employee %" v={r?.employeeRate ?? null} on={(v) => saveRule(k, { employeeRate: v })} disabled={!editable} />
                <NumF label="Employer %" v={r?.employerRate ?? null} on={(v) => saveRule(k, { employerRate: v })} disabled={!editable} />
              </>}
              {m === "formula" && <div className="sm:col-span-3 grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5"><Label className="text-xs">Employee formula → ₹</Label><Input className="h-8" defaultValue={r?.baseFormula ?? ""} onBlur={(e) => saveRule(k, { baseFormula: e.target.value || null })} placeholder="round(BASIC * 0.12, 2)" disabled={!editable} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Employer formula → ₹ (optional)</Label><Input className="h-8" defaultValue={r?.employerFormula ?? ""} onBlur={(e) => saveRule(k, { employerFormula: e.target.value || null })} placeholder="round(BASIC * 0.13, 2)" disabled={!editable} /></div>
              </div>}
              {m === "manual" && <div className="sm:col-span-3 self-end rounded-md border border-sky-200 bg-sky-50 p-2 text-[11px] text-sky-900">
                Amount is entered per employee &amp; payroll period on the <b>PF / ESI Amount Input</b> screen (manual grid or Excel import). Blank ≠ ₹0.
              </div>}
            </div>
            {m === "pct_of_base" && !r?.employeeRate && <p className="mt-1 text-[11px] text-amber-700">Rate not configured → this line computes to ₹0 and the payroll result is flagged.</p>}
            {m === "fixed_amount" && r?.employeeAmount == null && <p className="mt-1 text-[11px] text-amber-700">Amount not configured → ₹0 + review flag.</p>}
          </div>
        );
      })}

      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Professional Tax (slabs)</span>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={rule("pt")?.enabled ?? false} onCheckedChange={(v) => saveRule("pt", { enabled: Boolean(v), calcBase: rule("pt")?.calcBase ?? "gross" })} disabled={!editable} /> Enabled</label>
        </div>
        <div className="space-y-1">
          {(slabsQ.data ?? []).map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
              <span>{formatAmount(s.minSalary)} – {s.maxSalary == null ? "∞" : formatAmount(s.maxSalary)} → <b>{formatAmount(s.amount)}</b></span>
              <Button size="sm" variant="ghost" onClick={() => delSlab.mutate(s.id)} disabled={!editable}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
            </div>
          ))}
          {(slabsQ.data ?? []).length === 0 && <p className="text-[11px] text-amber-700">No slabs — PT computes to ₹0.</p>}
        </div>
        <div className="mt-2 flex items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Min ₹</Label><Input className="h-8 w-24" type="number" value={slab.min} onChange={(e) => setSlab({ ...slab, min: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Max ₹ (blank ∞)</Label><Input className="h-8 w-24" type="number" value={slab.max} onChange={(e) => setSlab({ ...slab, max: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Amount ₹</Label><Input className="h-8 w-24" type="number" value={slab.amount} onChange={(e) => setSlab({ ...slab, amount: e.target.value })} /></div>
          <Button size="sm" variant="outline" disabled={!editable || !slab.min || !slab.amount || addSlab.isPending}
            onClick={async () => {
              try {
                await addSlab.mutateAsync({ companyId: companyId as string, payrollPolicyId: policy.id, minSalary: Number(slab.min), maxSalary: slab.max ? Number(slab.max) : null, amount: Number(slab.amount), effectiveFrom: policy.effectiveFrom, userId: user?.id });
                setSlab({ min: "", max: "", amount: "" });
              } catch (e) { toast({ title: "Add failed", description: msg(e), variant: "destructive" }); }
            }}>Add slab</Button>
        </div>
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">TDS</span>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={rule("tds")?.enabled ?? false} onCheckedChange={(v) => saveRule("tds", { enabled: Boolean(v) })} disabled={!editable} /> Enabled</label>
        </div>
        <Label className="text-xs">Base formula (leave blank = Not Configured / inactive)</Label>
        <Input defaultValue={rule("tds")?.baseFormula ?? ""} onBlur={(e) => saveRule("tds", { baseFormula: e.target.value || null })} placeholder="(no tax engine — leave blank)" disabled={!editable} />
        <p className="mt-1 text-[11px] text-amber-700">Phase 6 does not ship a tax engine. Until a formula is supplied TDS stays UNRESOLVED and produces no value.</p>
      </div>
    </div>
  );
}

function DeductionOrderEditor({ policy, companyId, editable }: { policy: PayrollPolicyV2; companyId?: string; editable: boolean }) {
  const { user } = useAuth();
  const q = usePolicyDeductionOrder(policy.id);
  const setOrder = useSetDeductionOrder();
  const [rows, setRows] = useState<Array<{ code: string; priority: number }> | null>(null);
  const current = rows ?? (q.data ?? []).map((r) => ({ code: r.deductionCode, priority: r.priority }));
  const missing = ALL_DED_CODES.filter((c) => !current.some((r) => r.code === c));

  return (
    <div className="space-y-3">
      <UnresolvedBanner text="Deduction priority is not assumed. Until you set an order, Payroll shows 'Deduction priority not configured' and applies deductions by their component sort order. Advance Recovery FIFO (Phase 4) is unchanged." />
      <Table>
        <TableHeader><TableRow><TableHead>Priority</TableHead><TableHead>Deduction</TableHead></TableRow></TableHeader>
        <TableBody>
          {[...current].sort((a, b) => a.priority - b.priority).map((r) => (
            <TableRow key={r.code}>
              <TableCell className="w-24">
                <Input type="number" className="h-8 w-20" value={r.priority} disabled={!editable}
                  onChange={(e) => setRows(current.map((x) => x.code === r.code ? { ...x, priority: Number(e.target.value) || 0 } : x))} />
              </TableCell>
              <TableCell className="font-mono text-xs">{r.code}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">Not ordered: {missing.map((c) => (
          <button key={c} className="mx-0.5 rounded border px-1 font-mono text-[11px] hover:bg-muted" disabled={!editable}
            onClick={() => setRows([...current, { code: c, priority: (current.at(-1)?.priority ?? 0) + 1 }])}>+{c}</button>
        ))}</p>
      )}
      <div className="flex justify-end">
        <Button size="sm" disabled={!editable || !rows || setOrder.isPending}
          onClick={async () => {
            try { await setOrder.mutateAsync({ companyId: companyId as string, payrollPolicyId: policy.id, rows: current, userId: user?.id }); setRows(null); toast({ title: "Deduction order saved.", variant: "success" }); }
            catch (e) { toast({ title: "Save failed", description: msg(e), variant: "destructive" }); }
          }}>Save order</Button>
      </div>
    </div>
  );
}

function PolicyPreviewDialog({ open, onClose, companyId }: { open: boolean; onClose: () => void; companyId?: string }) {
  const empQ = useAssignableEmployees(companyId);
  const preview = usePolicyPreview();
  const [f, setF] = useState({ employeeId: "", month: new Date().toISOString().slice(0, 10), gross: "", lwp: "", ot: "", late: "", nd: "", adv: "", joining: "", leaving: "" });
  const res = preview.data;

  const run = () => {
    if (!f.employeeId) { toast({ title: "Pick an employee.", variant: "destructive" }); return; }
    const inputs: Record<string, unknown> = {};
    if (f.gross) inputs.gross = Number(f.gross);
    if (f.lwp) inputs.lwp_days = Number(f.lwp);
    if (f.ot) inputs.ot_minutes = Number(f.ot);
    if (f.late) inputs.late_minutes = Number(f.late);
    if (f.nd) inputs.nd_value = Number(f.nd);
    if (f.adv) inputs.advance_recovery = Number(f.adv);
    if (f.joining) inputs.joining_date = f.joining;
    if (f.leaving) inputs.leaving_date = f.leaving;
    preview.mutate({ employeeId: f.employeeId, periodMonth: f.month, inputs });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Payroll Policy Preview</DialogTitle>
          <DialogDescription>Runs the SAME engine as the Payroll Run (<span className="font-mono">payroll_policy_compute_lines</span> + <span className="font-mono">payroll_policy_finalize</span>). Unresolved rules show “Not configured”, never a made-up number.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Employee</Label>
            <Select value={f.employeeId} onValueChange={(v) => setF({ ...f, employeeId: v })}>
              <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
              <SelectContent>{(empQ.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeCode ?? "—"})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Payroll month</Label><Input type="date" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Gross override</Label><Input type="number" value={f.gross} onChange={(e) => setF({ ...f, gross: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">LWP days</Label><Input type="number" value={f.lwp} onChange={(e) => setF({ ...f, lwp: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Payable OT minutes</Label><Input type="number" value={f.ot} onChange={(e) => setF({ ...f, ot: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Payable Late minutes</Label><Input type="number" value={f.late} onChange={(e) => setF({ ...f, late: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Night-duty value</Label><Input type="number" value={f.nd} onChange={(e) => setF({ ...f, nd: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Advance recovery</Label><Input type="number" value={f.adv} onChange={(e) => setF({ ...f, adv: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Joining date</Label><Input type="date" value={f.joining} onChange={(e) => setF({ ...f, joining: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Leaving date</Label><Input type="date" value={f.leaving} onChange={(e) => setF({ ...f, leaving: e.target.value })} /></div>
        </div>
        <Button size="sm" onClick={run} disabled={preview.isPending}>{preview.isPending ? "Computing…" : "Compute"}</Button>

        {preview.isError && <p className="text-xs text-destructive">{msg(preview.error)}</p>}
        {res && (
          <div className="max-h-[45vh] space-y-3 overflow-auto text-sm">
            <p className="text-xs text-muted-foreground">Policy <span className="font-mono">{res.policy.code}</span> v{res.policy.version_no} · effective {res.policy.effective_from}{res.policy.effective_to ? `–${res.policy.effective_to}` : ""}{res.priority_configured ? "" : " · deduction priority NOT configured"}
              {(res as unknown as { tds?: { configured?: boolean; reason?: string } }).tds?.configured === false ? ` · TDS: Not Configured (${(res as unknown as { tds?: { reason?: string } }).tds?.reason ?? ""})` : ""}</p>
            {res.ot_late_basis && <OtLateBasisCard basis={res.ot_late_basis} showAmounts />}
            <PreviewList title="Earnings" rows={res.earnings.map((e) => ({ name: e.name, amount: e.amount, note: e.note, unresolved: e.unresolved }))} />
            <PreviewList title="Employee Deductions" rows={res.deductions.map((d) => ({ name: d.name ?? d.code, amount: d.amount, note: d.note, unresolved: d.unresolved, capped: d.capped }))} />
            <PreviewList title="Employer Contributions (not in Net)" rows={res.employer_contributions.map((d) => ({ name: d.name, amount: d.amount, note: d.note }))} />
            <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/40 p-2 text-xs">
              <div><p className="text-muted-foreground">Gross</p><p className="font-medium">{formatAmount(res.gross)}</p></div>
              <div><p className="text-muted-foreground">Total deductions</p><p className="font-medium">{formatAmount(res.total_deductions)}{res.cap_reduction > 0 ? ` (cap −${formatAmount(res.cap_reduction)})` : ""}</p></div>
              <div><p className="text-muted-foreground">Net salary</p><p className={`font-medium ${res.net_salary < 0 ? "text-destructive" : ""}`}>{formatAmount(res.net_salary)}{res.negative_flag ? ` · ${res.negative_net_policy}` : ""}</p></div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewList({ title, rows }: { title: string; rows: Array<{ name: string; amount: number; note?: string | null; unresolved?: boolean; capped?: boolean }> }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <Table>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="text-xs">
                {r.name}
                {r.unresolved && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">Not configured</span>}
                {r.capped && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-800">capped</span>}
                {r.note ? <span className="ml-1 text-[11px] text-muted-foreground">· {r.note}</span> : null}
              </TableCell>
              <TableCell className="text-right text-xs">{formatAmount(r.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ========================================================================== */
/* Phase 7 — Store Calendars                                                   */
/* ========================================================================== */

const DOW = [
  { v: 0, label: "Sun" }, { v: 1, label: "Mon" }, { v: 2, label: "Tue" }, { v: 3, label: "Wed" },
  { v: 4, label: "Thu" }, { v: 5, label: "Fri" }, { v: 6, label: "Sat" },
];

function StoreCalendarsTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const q = useStoreCalendars(companyId);
  const upsert = useUpsertStoreCalendar();
  const preview = usePreviewStoreCalendar();
  const empQ = useAssignableEmployees(companyId); // reused only to surface store names via employees is overkill — keep minimal

  const [open, setOpen] = useState(false);
  const blank = { id: undefined as string | undefined, storeId: "", name: "", effectiveFrom: new Date().toISOString().slice(0, 10), weeklyOffDays: [0] as number[], altSat: false, altSatRef: "", holidaySource: "company_holidays", status: "draft" };
  const [f, setF] = useState(blank);
  const [pv, setPv] = useState({ id: "", start: new Date().toISOString().slice(0, 8) + "01", end: "" });

  const save = async () => {
    if (!companyId || !f.name.trim()) { toast({ title: "Name is required.", variant: "destructive" }); return; }
    try {
      await upsert.mutateAsync({
        id: f.id, companyId, storeId: f.storeId || null, name: f.name.trim(), effectiveFrom: f.effectiveFrom,
        weeklyOffDays: f.weeklyOffDays, alternateSaturdayOff: f.altSat, alternateSaturdayReference: f.altSatRef || null,
        holidaySource: f.holidaySource, status: f.status, userId: user?.id,
      });
      toast({ title: f.id ? "Calendar updated." : "Calendar created.", variant: "success" });
      setOpen(false); setF(blank);
    } catch (e) { toast({ title: "Save failed", description: msg(e), variant: "destructive" }); }
  };
  void empQ;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Store Payroll Calendars</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Effective-dated weekly-off + holiday source for the <span className="font-mono">working_days</span> proration method. Reuses the company Holiday master — Leave holiday behaviour is untouched. Historical payroll keeps its calendar snapshot.</p>
        </div>
        <Button size="sm" onClick={() => { setF(blank); setOpen(true); }}><Plus className="mr-1 h-4 w-4" /> New Calendar</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? <LoadingState /> : (q.data ?? []).length === 0 ? (
          <EmptyState icon={Wand2} title="No store calendars" description="Payroll uses attendance calendar days until a store calendar is active and the policy's working-days method is 'Store Calendar'." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Scope</TableHead><TableHead>Effective</TableHead><TableHead>Weekly off</TableHead><TableHead>Holidays</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {(q.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-xs">{c.storeId ? "Store" : "Company-wide"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.effectiveFrom}{c.effectiveTo ? ` – ${c.effectiveTo}` : " →"}</TableCell>
                    <TableCell className="text-xs">{c.weeklyOffDays.map((d) => DOW[d]?.label).join(", ")}{c.alternateSaturdayOff ? " + alt Sat" : ""}</TableCell>
                    <TableCell className="text-xs">{c.holidaySource === "company_holidays" ? "Company holidays" : "None"}</TableCell>
                    <TableCell><Badge variant={c.status === "active" ? "success" : c.status === "draft" ? "warning" : "secondary"} className="capitalize">{c.status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { setPv({ id: c.id, start: pv.start, end: pv.end }); }}>Preview</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setF({ id: c.id, storeId: c.storeId ?? "", name: c.name, effectiveFrom: c.effectiveFrom, weeklyOffDays: c.weeklyOffDays, altSat: c.alternateSaturdayOff, altSatRef: c.alternateSaturdayReference ?? "", holidaySource: c.holidaySource, status: c.status }); setOpen(true); }}>Edit</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {pv.id && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-2 text-sm font-medium">Working-days preview</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" className="h-8" value={pv.start} onChange={(e) => setPv({ ...pv, start: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" className="h-8" value={pv.end} onChange={(e) => setPv({ ...pv, end: e.target.value })} /></div>
              <Button size="sm" variant="outline" disabled={!pv.end || preview.isPending} onClick={() => preview.mutate({ calendarId: pv.id, start: pv.start, end: pv.end })}>Compute</Button>
            </div>
            {preview.data && (
              <p className="mt-2 text-sm">Period {preview.data.period_days} day(s) → <b>{preview.data.working_days ?? "—"}</b> working day(s) (weekly off: {(preview.data.weekly_off_days ?? []).map((d) => DOW[d]?.label).join(", ")}; holidays: {preview.data.holiday_source})</p>
            )}
            {preview.isError && <p className="mt-2 text-xs text-destructive">{msg(preview.error)}</p>}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{f.id ? "Edit" : "New"} Store Calendar</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Store id (blank = company-wide)</Label><Input value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })} placeholder="uuid or blank" /></div>
            <div className="space-y-1.5"><Label>Effective from</Label><Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></div>
            <Pick label="Status" value={f.status} opts={[{ v: "draft", label: "Draft" }, { v: "active", label: "Active" }, { v: "archived", label: "Archived" }]} on={(v) => setF({ ...f, status: v })} />
          </div>
          <div>
            <Label className="text-xs">Weekly off days</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {DOW.map((d) => (
                <label key={d.v} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
                  <Checkbox checked={f.weeklyOffDays.includes(d.v)} onCheckedChange={(c) => setF({ ...f, weeklyOffDays: c ? [...f.weeklyOffDays, d.v].sort() : f.weeklyOffDays.filter((x) => x !== d.v) })} /> {d.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.altSat} onCheckedChange={(v) => setF({ ...f, altSat: Boolean(v) })} /> Alternate Saturday off</label>
            {f.altSat && <div className="space-y-1"><Label className="text-xs">Reference Saturday (that IS off)</Label><Input type="date" className="h-8" value={f.altSatRef} onChange={(e) => setF({ ...f, altSatRef: e.target.value })} /></div>}
            <Pick label="Holiday source" value={f.holidaySource} opts={[{ v: "company_holidays", label: "Company holidays" }, { v: "none", label: "None" }]} on={(v) => setF({ ...f, holidaySource: v })} />
          </div>
          <p className="text-[11px] text-amber-700">No weekly-off pattern is assumed — pick the company's own. Sunday is the default only because a calendar must start somewhere; change it.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={upsert.isPending}>Cancel</Button>
            <Button onClick={save} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ========================================================================== */
/* Phase 7 — TDS (foundation; inert until real rules are supplied)             */
/* ========================================================================== */

function TdsTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const q = useTdsPolicies(companyId);
  const create = useCreateTdsPolicy();
  const update = useUpdateTdsPolicy();
  const [selId, setSelId] = useState<string | null>(null);
  const selected = (q.data ?? []).find((p) => p.id === selId) ?? (q.data ?? [])[0] ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">TDS (Tax Deducted at Source)</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Phase 7 ships the <b>foundation only</b>. Until the company supplies a tax regime, an annualization method and real slabs, TDS stays <b>Not Configured</b> — payroll deducts ₹0 and never invents a tax amount.</p>
        </div>
        <Button size="sm" onClick={async () => {
          if (!companyId) return;
          const code = window.prompt("TDS policy code:", "TDS_FY2627");
          if (!code) return;
          try { const r = await create.mutateAsync({ companyId, name: `TDS Policy ${code}`, code: code.trim().toUpperCase(), userId: user?.id }); setSelId(r.id); }
          catch (e) { toast({ title: "Create failed", description: msg(e), variant: "destructive" }); }
        }}><Plus className="mr-1 h-4 w-4" /> New TDS Policy</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? <LoadingState /> : (q.data ?? []).length === 0 ? (
          <EmptyState icon={ShieldAlert} title="TDS Not Configured" description="No TDS policy exists for this company. Payroll's TDS line stays ₹0 with an explanation." />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {(q.data ?? []).map((p) => (
                <button key={p.id} onClick={() => setSelId(p.id)} className={`rounded-md border px-2 py-1 text-xs ${selected?.id === p.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}>
                  <span className="font-mono">{p.code}</span> v{p.versionNo} <Badge variant={p.status === "active" ? "success" : "warning"} className="ml-1 text-[10px] capitalize">{p.status}</Badge>
                </button>
              ))}
            </div>
            {selected && <TdsPolicyEditor policy={selected} companyId={companyId} onSave={(v) => update.mutate({ id: selected.id, values: v, userId: user?.id })} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TdsPolicyEditor({ policy, companyId, onSave }: { policy: TdsPolicy; companyId?: string; onSave: (v: Record<string, unknown>) => void }) {
  const { user } = useAuth();
  const slabsQ = useTdsSlabs(policy.id);
  const addSlab = useAddTdsSlab();
  const delSlab = useDeleteTdsSlab();
  const compute = useComputeTds();
  const [d, setD] = useState<Record<string, string>>({});
  const g = (k: keyof TdsPolicy) => d[k as string] ?? (policy[k] == null ? "" : String(policy[k]));
  const [slab, setSlab] = useState({ min: "", max: "", rate: "" });
  const [testIncome, setTestIncome] = useState("");
  const missing = [
    !policy.taxRegime && "tax regime",
    !policy.annualizationMethod && "annualization method",
    (slabsQ.data ?? []).length === 0 && "tax slabs",
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {missing.length > 0 && <UnresolvedBanner text={`Not Configured — still missing: ${missing.join(", ")}. TDS produces ₹0 until every piece is supplied.`} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label className="text-xs">Tax regime</Label><Input value={g("taxRegime")} onChange={(e) => setD({ ...d, taxRegime: e.target.value })} placeholder="e.g. new / old (not assumed)" /></div>
        <Pick label="Annualization method" value={g("annualizationMethod") || null}
          opts={[{ v: "flat_x12", label: "Current monthly × 12" }, { v: "project_current_x_remaining", label: "YTD + projected (needs YTD)" }, { v: "ytd_plus_projected", label: "YTD + projected" }]}
          on={(v) => setD({ ...d, annualizationMethod: v })} />
        <Pick label="Status" value={g("status")} opts={[{ v: "draft", label: "Draft" }, { v: "active", label: "Active" }, { v: "archived", label: "Archived" }]} on={(v) => setD({ ...d, status: v })} />
        <div className="space-y-1"><Label className="text-xs">Standard deduction ₹</Label><Input type="number" value={g("standardDeduction")} onChange={(e) => setD({ ...d, standardDeduction: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">Rebate limit ₹</Label><Input type="number" value={g("rebateLimit")} onChange={(e) => setD({ ...d, rebateLimit: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">Rebate amount ₹</Label><Input type="number" value={g("rebateAmount")} onChange={(e) => setD({ ...d, rebateAmount: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">Cess %</Label><Input type="number" value={g("cessPct")} onChange={(e) => setD({ ...d, cessPct: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">FY start</Label><Input type="date" value={g("financialYearStart")} onChange={(e) => setD({ ...d, financialYearStart: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">FY end</Label><Input type="date" value={g("financialYearEnd")} onChange={(e) => setD({ ...d, financialYearEnd: e.target.value })} /></div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={Object.keys(d).length === 0} onClick={() => {
          const v: Record<string, unknown> = {};
          for (const k of Object.keys(d)) {
            const col = { taxRegime: "tax_regime", annualizationMethod: "annualization_method", status: "status", standardDeduction: "standard_deduction", rebateLimit: "rebate_limit", rebateAmount: "rebate_amount", cessPct: "cess_pct", financialYearStart: "financial_year_start", financialYearEnd: "financial_year_end" }[k];
            if (col) v[col] = d[k] === "" ? null : (["standard_deduction", "rebate_limit", "rebate_amount", "cess_pct"].includes(col) ? Number(d[k]) : d[k]);
          }
          onSave(v); setD({});
        }}>Save policy</Button>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium">Tax slabs</p>
        <div className="space-y-1">
          {(slabsQ.data ?? []).map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
              <span>{formatAmount(s.minIncome)} – {s.maxIncome == null ? "∞" : formatAmount(s.maxIncome)} → <b>{s.rate}%</b>{s.fixedComponent ? ` + ${formatAmount(s.fixedComponent)}` : ""}</span>
              <Button size="sm" variant="ghost" onClick={() => delSlab.mutate(s.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
            </div>
          ))}
          {(slabsQ.data ?? []).length === 0 && <p className="text-[11px] text-amber-700">No slabs — TDS stays Not Configured.</p>}
        </div>
        <div className="mt-2 flex items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Min ₹</Label><Input className="h-8 w-28" type="number" value={slab.min} onChange={(e) => setSlab({ ...slab, min: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Max ₹ (∞)</Label><Input className="h-8 w-28" type="number" value={slab.max} onChange={(e) => setSlab({ ...slab, max: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Rate %</Label><Input className="h-8 w-20" type="number" value={slab.rate} onChange={(e) => setSlab({ ...slab, rate: e.target.value })} /></div>
          <Button size="sm" variant="outline" disabled={!companyId || !slab.min || !slab.rate || addSlab.isPending}
            onClick={async () => { try { await addSlab.mutateAsync({ companyId: companyId as string, tdsPolicyId: policy.id, minIncome: Number(slab.min), maxIncome: slab.max ? Number(slab.max) : null, rate: Number(slab.rate), userId: user?.id }); setSlab({ min: "", max: "", rate: "" }); } catch (e) { toast({ title: "Add failed", description: msg(e), variant: "destructive" }); } }}>Add slab</Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="mb-2 text-sm font-medium">Test calculation</p>
        <div className="flex items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Annual taxable ₹</Label><Input className="h-8 w-40" type="number" value={testIncome} onChange={(e) => setTestIncome(e.target.value)} /></div>
          <Button size="sm" variant="outline" disabled={!testIncome || compute.isPending} onClick={() => compute.mutate({ policyId: policy.id, annualTaxable: Number(testIncome) })}>Compute</Button>
        </div>
        {compute.data && (
          <p className="mt-2 text-sm">
            {(compute.data as { configured?: boolean }).configured
              ? <>Annual TDS <b>{formatAmount(Number((compute.data as Record<string, unknown>).final_annual_tds ?? 0))}</b> · monthly <b>{formatAmount(Number((compute.data as Record<string, unknown>).monthly_tds ?? 0))}</b> (slab {String((compute.data as Record<string, unknown>).slab_rate ?? "?")}%)</>
              : <span className="text-amber-700">Not Configured — {String((compute.data as Record<string, unknown>).reason ?? "")}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Phase 7 — Grades & Categories masters                                       */
/* ========================================================================== */

function GradesCategoriesTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const gradesQ = useEmployeeGrades(companyId);
  const catsQ = useEmployeeCategories(companyId);
  const upG = useUpsertGrade();
  const upC = useUpsertCategory();
  const [g, setG] = useState({ code: "", name: "" });
  const [c, setC] = useState({ code: "", name: "" });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[
        { title: "Employee Grades", rows: gradesQ.data ?? [], form: g, setForm: setG, add: () => upG.mutateAsync({ companyId: companyId as string, code: g.code.trim().toUpperCase(), name: g.name.trim(), userId: user?.id }).then(() => setG({ code: "", name: "" })), pending: upG.isPending, loading: gradesQ.isLoading, hint: "Grade A / Grade B / … — the company's own scheme. Nothing is seeded." },
        { title: "Employee Categories", rows: catsQ.data ?? [], form: c, setForm: setC, add: () => upC.mutateAsync({ companyId: companyId as string, code: c.code.trim().toUpperCase(), name: c.name.trim(), userId: user?.id }).then(() => setC({ code: "", name: "" })), pending: upC.isPending, loading: catsQ.isLoading, hint: "Staff / Supervisor / Manager / … — the company's own scheme. Nothing is seeded." },
      ].map((s) => (
        <Card key={s.title}>
          <CardHeader><CardTitle className="text-base">{s.title}</CardTitle><p className="text-xs text-muted-foreground">{s.hint}</p></CardHeader>
          <CardContent className="space-y-3">
            {s.loading ? <LoadingState rows={3} /> : (
              <div className="space-y-1">
                {s.rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                    <span><span className="font-mono">{r.code}</span> — {r.name}</span>
                    {!r.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                ))}
                {s.rows.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="space-y-1"><Label className="text-xs">Code</Label><Input className="h-8 w-28" value={s.form.code} onChange={(e) => s.setForm({ ...s.form, code: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Name</Label><Input className="h-8" value={s.form.name} onChange={(e) => s.setForm({ ...s.form, name: e.target.value })} /></div>
              <Button size="sm" variant="outline" disabled={!companyId || !s.form.code.trim() || !s.form.name.trim() || s.pending}
                onClick={() => s.add().catch((e: unknown) => toast({ title: "Save failed", description: msg(e), variant: "destructive" }))}>Add</Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground md:col-span-2">Assign a grade / category to an employee in the Employee master; then map a Salary Structure or Payroll Policy to that grade / category scope in the Salary Structures / Payroll Policy tabs.</p>
    </div>
  );
}

function UnresolvedBanner({ text }: { text: string }) {
  return <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900">{text}</p>;
}
function SaveBar({ dirty, onSave, onReset, pending }: { dirty: boolean; onSave: () => void; onReset: () => void; pending: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      {dirty && <Button size="sm" variant="ghost" onClick={onReset} disabled={pending}>Discard</Button>}
      <Button size="sm" onClick={onSave} disabled={!dirty || pending}>{pending ? "Saving…" : "Save"}</Button>
    </div>
  );
}
function Pick({ label, value, opts, on, disabled }: { label: string; value: string | null | undefined; opts: Array<{ v: string; label: string }>; on: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value ?? ""} onValueChange={on} disabled={disabled}>
        <SelectTrigger><SelectValue placeholder="Not configured" /></SelectTrigger>
        <SelectContent>{opts.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
function NumF({ label, v, on, disabled }: { label: string; v: number | null | undefined; on: (v: number | null) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={v ?? ""} onChange={(e) => on(e.target.value === "" ? null : Number(e.target.value))} placeholder="—" disabled={disabled} />
    </div>
  );
}

function num(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}
function msg(e: unknown): string | undefined {
  return e instanceof Error ? e.message : typeof e === "string" ? e : undefined;
}
