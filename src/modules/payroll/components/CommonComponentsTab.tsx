import { useState } from "react";
import { Plus, Trash2, ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCommonComponents, useUpsertStatutoryRule, useDeleteStatutoryRule, useTestPayrollComponent } from "@/hooks/usePayroll";
import { formatAmount } from "@/modules/advance/utils";
import { FORMULA_VARIABLES, FORMULA_FUNCTIONS, buildRangeFormula, parseRangeFormula, checkFormula, type RangeTier } from "@/modules/payroll/formulaBuilder";
import type { PayrollStatutoryRule } from "@/types/payroll";

/** Calculation choices shown to the business user → stored (calc_method, calc_base) of the existing rule engine. */
const METHODS = [
  { v: "fixed_amount", label: "Fixed Amount", method: "fixed_amount", base: null as string | null },
  { v: "pct_gross", label: "% of Gross", method: "pct_of_base", base: "gross" },
  { v: "pct_basic", label: "% of Basic", method: "pct_of_base", base: "basic" },
  { v: "pct_of_component", label: "% of Another Component", method: "pct_of_component", base: null },
  { v: "formula", label: "Custom Formula", method: "formula", base: null },
  { v: "manual", label: "Manual / Excel Import", method: "manual", base: null },
];
const methodUi = (r: Pick<PayrollStatutoryRule, "calcMethod" | "calcBase">) =>
  r.calcMethod === "pct_of_base" ? (r.calcBase === "basic" ? "pct_basic" : "pct_gross") : r.calcMethod;

const SYSTEM_LABEL: Record<string, string> = { pf: "Provident Fund (PF)", esi: "ESI", pt: "Professional Tax (PT)", tds: "TDS", gratuity: "Gratuity", other: "Other (statutory)" };

const RESERVED = ["OT", "NDUTY", "LWP", "ADVREC", "LATE", "PF", "ESI", "PT", "TDS", "GRATUITY", "PRORATE", "PRORATE_EXIT", "BASIC", "DA", "GROSS", "NET"];

function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") return (e as { message: string }).message;
  return typeof e === "string" ? e : "Something went wrong.";
}
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);

function describe(r: PayrollStatutoryRule): string {
  switch (r.calcMethod) {
    case "fixed_amount": return r.employeeAmount == null ? "Fixed amount — not set" : `Fixed ${formatAmount(r.employeeAmount)}`;
    case "pct_of_base": return r.employeeRate == null ? `% of ${r.calcBase ?? "base"} — rate not set` : `${r.employeeRate}% of ${r.calcBase === "basic_da" ? "Basic + DA" : r.calcBase ?? "base"}${r.wageCeiling ? ` (ceiling ${formatAmount(r.wageCeiling)})` : ""}`;
    case "pct_of_component": return `${r.employeeRate ?? "?"}% of ${r.refComponentCode ?? "?"}`;
    case "formula": return r.baseFormula ? `Formula: ${r.baseFormula}` : "Formula — not set";
    case "manual": return "Manual / Excel import (per employee, per month)";
    default: return r.calcMethod;
  }
}

function methodLabel(r: PayrollStatutoryRule): string {
  return METHODS.find((m) => m.v === methodUi(r))?.label ?? (r.calcMethod === "pct_of_base" ? "% of Basic + DA" : r.calcMethod);
}
function appliesOn(r: PayrollStatutoryRule): string {
  switch (r.calcMethod) {
    case "pct_of_base": return r.calcBase === "basic_da" ? "Basic + DA" : r.calcBase === "basic" ? "Basic" : r.calcBase === "gross" ? "Gross" : (r.calcBase ?? "—");
    case "pct_of_component": return r.refComponentCode ?? "—";
    case "formula": return "Formula (BASIC / DA / GROSS)";
    case "fixed_amount": return "Each employee";
    case "manual": return "Each employee, each month";
    default: return "—";
  }
}
function sourceOf(r: PayrollStatutoryRule): string {
  return r.calcMethod === "manual" ? "Manual entry / Excel import" : "Payroll rule engine";
}
function StatusBadge({ rule }: { rule: PayrollStatutoryRule }) {
  const today = new Date().toISOString().slice(0, 10);
  if (!rule.enabled) return <Badge variant="secondary">Inactive</Badge>;
  if (rule.effectiveFrom > today) return <Badge variant="warning">Scheduled</Badge>;
  if (rule.effectiveTo && rule.effectiveTo < today) return <Badge variant="secondary">Ended</Badge>;
  return <Badge variant="success">Active</Badge>;
}
/** Read-only reference: these are driven by their own modules and are deliberately NOT editable as generic components. */
const SOURCE_DRIVEN = [
  { name: "Overtime (OT)", type: "Earning", source: "Attendance", flow: "Attendance → payable overtime minutes (after the OT Rule) → Payroll values those minutes at (Basic + DA) ÷ calendar days of the payroll month ÷ standard hours/day. Never a fixed amount, %, formula, manual or import.", where: "Attendance → Overtime Rules" },
  { name: "Late", type: "Deduction", source: "Attendance", flow: "Attendance (Late + Penalty rules) → payable late minutes → when “Deduct Late from salary” is on (Payroll Rules → Late), Payroll values them at the same hourly basis as Overtime and deducts the amount. Never a fixed amount, %, formula, manual or import.", where: "Attendance → Rules; Payroll Rules → Late" },
  { name: "Loss of Pay (LWP)", type: "Deduction", source: "Leave + Attendance", flow: "Approved unpaid leave and absent days → Payroll LWP deduction using the LWP basis you set.", where: "Payroll Rules → LWP" },
  { name: "Advance Recovery", type: "Deduction", source: "Advance Management", flow: "Actual paid amount → recovery plan / instalment → Payroll deducts the month's recovery.", where: "Advance Management" },
];

const blank = { name: "", code: "", type: "deduction" as "earning" | "deduction", method: "pct_gross", rate: "", amount: "", ref: "", formula: "", rounding: "round_2", applicable: true, eligibility: "always" as "always" | "after_months", months: "" };

/** Reusable eligibility options. Values live on the rule (eligibility_type / eligibility_months) — never in code. */
const ELIGIBILITY = [
  { v: "always", label: "Always" },
  { v: "after_months", label: "After X months of service" },
] as const;
const eligibilityText = (r: Pick<PayrollStatutoryRule, "eligibilityType" | "eligibilityMonths">): string =>
  r.eligibilityType === "after_months" ? `Eligibility: After ${r.eligibilityMonths ?? "?"} month${r.eligibilityMonths === 1 ? "" : "s"} of service` : "Eligibility: Always";

/**
 * Common Payroll Components — defined ONCE, they apply to every salary structure (M1, M2, M3 and any future one).
 * Storage/engine = the existing payroll_statutory_rules (PF / ESI already live there); a named component is a
 * kind='other' rule with its own code/name/type. Rates, amounts and rounding are configuration, never code.
 */
export function CommonComponentsTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const { policy, rules, isLoading } = useCommonComponents(companyId);
  const upsert = useUpsertStatutoryRule();
  const del = useDeleteStatutoryRule();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PayrollStatutoryRule | null>(null);
  const [f, setF] = useState(blank);
  const editable = Boolean(policy && policy.status !== "archived");

  const openNew = () => { setEditing(null); setF(blank); setOpen(true); };
  const openEdit = (r: PayrollStatutoryRule) => {
    setEditing(r);
    setF({
      name: r.componentName ?? "", code: r.componentCode ?? "", type: (r.componentType ?? "deduction") as "earning" | "deduction",
      method: methodUi(r), rate: r.employeeRate?.toString() ?? "", amount: r.employeeAmount?.toString() ?? "", ref: r.refComponentCode ?? "",
      formula: r.baseFormula ?? "", rounding: r.rounding ?? "round_2", applicable: r.enabled,
      eligibility: r.eligibilityType, months: r.eligibilityMonths?.toString() ?? "",
    });
    setOpen(true);
  };

  const toggle = async (r: PayrollStatutoryRule, enabled: boolean) => {
    if (!policy || !companyId) return;
    try {
      await upsert.mutateAsync({
        id: r.id, companyId, payrollPolicyId: policy.id, kind: r.kind, enabled, calcMethod: r.calcMethod, calcBase: r.calcBase,
        baseFormula: r.baseFormula, employerFormula: r.employerFormula, employeeRate: r.employeeRate, employerRate: r.employerRate,
        employeeAmount: r.employeeAmount, employerAmount: r.employerAmount, refComponentCode: r.refComponentCode, wageCeiling: r.wageCeiling,
        rounding: r.rounding, effectiveFrom: r.effectiveFrom, userId: user?.id,
        componentCode: r.componentCode, componentName: r.componentName, componentType: r.componentType,
        eligibilityType: r.eligibilityType, eligibilityMonths: r.eligibilityMonths,
      });
      toast({ title: `${r.componentName ?? SYSTEM_LABEL[r.kind]} ${enabled ? "is now applicable" : "is switched off"}.`, variant: "success" });
    } catch (e) { toast({ title: "Update failed", description: errText(e), variant: "destructive" }); }
  };

  const save = async () => {
    if (!policy || !companyId) return;
    const code = f.code.trim().toUpperCase();
    const name = f.name.trim();
    if (!name || !code) { toast({ title: "Name and code are required.", variant: "destructive" }); return; }
    if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(code) || code.endsWith("_ER")) { toast({ title: "Invalid code.", description: "Use 2–20 capital letters, digits or underscore, starting with a letter (e.g. MEDICAL).", variant: "destructive" }); return; }
    if (code === "OT" || /^over\s*time$/i.test(name)) { toast({ title: "Overtime is not a common component.", description: "OT always comes from Attendance → Overtime Rules.", variant: "destructive" }); return; }
    if (RESERVED.includes(code)) { toast({ title: `“${code}” is reserved.`, description: "Choose a different code.", variant: "destructive" }); return; }
    if (f.eligibility === "after_months") {
      const mo = Number(f.months);
      if (f.months.trim() === "" || !Number.isInteger(mo) || mo < 0 || mo > 600) { toast({ title: "Enter the number of months of service.", description: "A whole number from 0 to 600 (e.g. 12).", variant: "destructive" }); return; }
    }
    const m = METHODS.find((x) => x.v === f.method) ?? METHODS[1];
    const rate = f.rate.trim() === "" ? null : Number(f.rate);
    const amount = f.amount.trim() === "" ? null : Number(f.amount);
    if ((m.method === "pct_of_base" || m.method === "pct_of_component") && (rate == null || !Number.isFinite(rate) || rate < 0)) { toast({ title: "Enter the percentage.", variant: "destructive" }); return; }
    if (m.method === "fixed_amount" && (amount == null || !Number.isFinite(amount) || amount < 0)) { toast({ title: "Enter the fixed amount.", variant: "destructive" }); return; }
    if (m.method === "pct_of_component" && !f.ref.trim()) { toast({ title: "Enter the component to take the percentage of (e.g. DA).", variant: "destructive" }); return; }
    if (m.method === "formula") {
      const fe = checkFormula(f.formula);
      if (fe) { toast({ title: `${name} formula is invalid`, description: fe === "Enter a formula." ? "Complete every Gross limit and amount in the range table (or write a formula)." : fe, variant: "destructive" }); return; }
    }
    try {
      await upsert.mutateAsync({
        id: editing?.id, companyId, payrollPolicyId: policy.id, kind: "other", enabled: f.applicable,
        calcMethod: m.method, calcBase: m.base,
        employeeRate: m.method === "pct_of_base" || m.method === "pct_of_component" ? rate : null,
        employeeAmount: m.method === "fixed_amount" ? amount : null,
        refComponentCode: m.method === "pct_of_component" ? f.ref.trim().toUpperCase() : null,
        baseFormula: m.method === "formula" ? f.formula.trim() : null,
        employerFormula: null, employerRate: null, employerAmount: null, wageCeiling: editing?.wageCeiling ?? null,
        rounding: f.rounding, effectiveFrom: editing?.effectiveFrom ?? policy.effectiveFrom, userId: user?.id,
        componentCode: code, componentName: name, componentType: f.type,
        eligibilityType: f.eligibility, eligibilityMonths: f.eligibility === "after_months" ? Number(f.months) : null,
      });
      toast({ title: `${name} saved.`, description: f.applicable ? "It now applies to every salary structure." : "Saved as not applicable.", variant: "success" });
      setOpen(false);
    } catch (e) {
      const t = errText(e);
      toast({ title: "Save failed", description: /uq_payroll_statutory_rules|duplicate key/i.test(t) ? `A component with code ${code} already exists.` : t, variant: "destructive" });
    }
  };

  const remove = async (r: PayrollStatutoryRule) => {
    if (!window.confirm(`Remove “${r.componentName}” from all salary structures? Past payslips are not changed.`)) return;
    try { await del.mutateAsync(r.id); toast({ title: `${r.componentName} removed.`, variant: "success" }); }
    catch (e) { toast({ title: "Remove failed", description: errText(e), variant: "destructive" }); }
  };

  const named = rules.filter((r) => r.componentCode);
  const system = rules.filter((r) => !r.componentCode);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Common Payroll Components</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a component <b>once</b> — PF, ESI, Medical Fund, Incentive, other deductions or earnings. It works for every salary structure (M1, M2, M3 and any you add later); you never repeat it per structure.
            Basic, DA and Allowance stay inside each Salary Structure. Overtime, Late, Loss of Pay and Advance Recovery come from Attendance, Leave and Advance Management.
          </p>
        </div>
        <Button size="sm" onClick={openNew} disabled={!editable}><Plus className="mr-1 h-4 w-4" /> Add Common Payroll Component</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <LoadingState /> : !policy ? (
          <EmptyState icon={ShieldAlert} title="No payroll policy yet" description="Create and activate a payroll policy under Payroll Rules first — common components are saved against the active policy." />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Applies to all employees under payroll policy <b>{policy.policyName ?? policy.code}</b> (v{policy.versionNo}, {policy.status}).</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead><TableHead>Type</TableHead><TableHead>Applies On</TableHead><TableHead>Calculation Method</TableHead>
                    <TableHead>Source</TableHead><TableHead>Effective From</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {named.length === 0 && system.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">No common components yet. Add one — e.g. Medical Fund, 1% of Gross.</TableCell></TableRow>
                  )}
                  {named.map((r) => (
                    <TableRow key={r.id} className={!r.enabled ? "opacity-60" : undefined}>
                      <TableCell className="font-medium">{r.componentName}<div className="font-mono text-[11px] font-normal text-muted-foreground">{r.componentCode}</div></TableCell>
                      <TableCell className="text-xs">{r.componentType === "earning" ? "Employee Earning" : "Employee Deduction"}</TableCell>
                      <TableCell className="max-w-[200px] text-xs">{appliesOn(r)}<div className="text-[11px] text-muted-foreground">All salary structures</div><div className="text-[11px] text-muted-foreground">{eligibilityText(r)}</div></TableCell>
                      <TableCell className="max-w-[220px] text-xs">{methodLabel(r)}<div className="text-[11px] text-muted-foreground">{describe(r)}</div></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{sourceOf(r)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.effectiveFrom}{r.effectiveTo ? ` → ${r.effectiveTo}` : ""}</TableCell>
                      <TableCell><StatusBadge rule={r} /></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Checkbox checked={r.enabled} onCheckedChange={(v) => toggle(r, Boolean(v))} disabled={!editable} aria-label={`${r.componentName} applicable`} title="Applicable" />
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)} disabled={!editable}>Configure</Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(r)} disabled={!editable} aria-label={`Remove ${r.componentName}`}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {system.map((r) => (
                    <TableRow key={r.id} className={!r.enabled ? "opacity-60" : undefined}>
                      <TableCell className="font-medium">{SYSTEM_LABEL[r.kind] ?? r.kind.toUpperCase()}<div className="font-mono text-[11px] font-normal text-muted-foreground">{r.kind.toUpperCase()}</div></TableCell>
                      <TableCell className="text-xs">Employee Deduction{r.employerRate != null || r.employerAmount != null ? " + Employer" : ""}</TableCell>
                      <TableCell className="text-xs">{r.kind === "pt" ? "Gross (PT slabs)" : r.kind === "tds" ? "Taxable income" : appliesOn(r)}<div className="text-[11px] text-muted-foreground">All salary structures</div></TableCell>
                      <TableCell className="max-w-[220px] text-xs">{r.kind === "pt" ? "PT slab table" : r.kind === "tds" ? "TDS policy / formula" : methodLabel(r)}<div className="text-[11px] text-muted-foreground">{r.kind === "pt" || r.kind === "tds" ? "" : describe(r)}</div></TableCell>
                      <TableCell className="text-xs text-muted-foreground">Statutory rule (Payroll Rules)</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.effectiveFrom}{r.effectiveTo ? ` → ${r.effectiveTo}` : ""}</TableCell>
                      <TableCell><StatusBadge rule={r} /></TableCell>
                      <TableCell className="text-right text-[11px] text-muted-foreground">Configure in Payroll Rules → Statutory</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Source-driven items <span className="font-normal text-muted-foreground">— not generic components</span></p>
              <p className="mb-2 text-xs text-muted-foreground">These come from their own modules. They cannot be given a fixed amount, a percentage, a formula, a manual amount or an Excel import here.</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Type</TableHead><TableHead>Source</TableHead><TableHead>How it reaches payroll</TableHead><TableHead className="text-right">Configure in</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {SOURCE_DRIVEN.map((s) => (
                      <TableRow key={s.name}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-xs">{s.type}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.source}</TableCell>
                        <TableCell className="max-w-[320px] text-xs text-muted-foreground">{s.flow}</TableCell>
                        <TableCell className="text-right text-[11px] text-muted-foreground">{s.where}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900">
              <b>Good to know.</b> “% of Another Component” can only use the <b>salary-structure earnings</b> of the employee (Basic, DA, Allowance …). A common component cannot be a percentage of another common component. Rates, amounts and rounding are configuration — nothing is fixed in the software.
            </p>
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Scrolls inside the viewport: the formula editor + eligibility section are taller than the default dialog. */}
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit" : "Add"} Common Payroll Component</DialogTitle>
            <DialogDescription>Saved once; available to every salary structure the moment it is applicable.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Component Name</Label>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, code: editing ? f.code : slug(e.target.value) })} placeholder="Medical Fund" />
            </div>
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="MEDICAL" disabled={Boolean(editing)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v as "earning" | "deduction" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="deduction">Employee Deduction</SelectItem><SelectItem value="earning">Employee Earning</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Calculation</Label>
              <Select value={f.method} onValueChange={(v) => setF({ ...f, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {(f.method === "pct_gross" || f.method === "pct_basic" || f.method === "pct_of_component") && (
              <div className="space-y-1.5"><Label>Percentage (%)</Label><Input type="number" min={0} step="0.01" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="1" /></div>
            )}
            {f.method === "pct_of_component" && (
              <div className="space-y-1.5"><Label>Of component (code)</Label><Input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value.toUpperCase() })} placeholder="DA" className="font-mono" />
                <p className="text-[11px] text-muted-foreground">Salary-structure earnings only (Basic, DA, Allowance …) — not another common component.</p></div>
            )}
            {f.method === "fixed_amount" && (
              <div className="space-y-1.5"><Label>Amount (₹)</Label><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="200" /></div>
            )}
            {f.method === "formula" && (
              <div className="sm:col-span-2">
                <FormulaEditor
                  key={editing?.id ?? "new"}
                  value={f.formula}
                  onChange={(v) => setF((s) => ({ ...s, formula: v }))}
                  eligibilityType={f.eligibility}
                  eligibilityMonths={f.eligibility === "after_months" && f.months.trim() !== "" && Number.isInteger(Number(f.months)) ? Number(f.months) : null}
                />
              </div>
            )}
            {f.method === "manual" && (
              <p className="rounded-md border border-sky-200 bg-sky-50 p-2 text-[11px] text-sky-900 sm:col-span-2">
                The amount is entered per employee and payroll month — grid or Excel import on the <b>Manual Component Amount Input</b> screen. A blank cell is “not entered” (flagged for review); an explicit 0 is respected.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Rounding</Label>
              <Select value={f.rounding} onValueChange={(v) => setF({ ...f, rounding: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="round_2">2 decimals</SelectItem><SelectItem value="nearest_rupee">Nearest rupee</SelectItem><SelectItem value="none">None</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Applicable</Label>
              <Select value={f.applicable ? "yes" : "no"} onValueChange={(v) => setF({ ...f, applicable: v === "yes" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2 rounded-md border p-3">
              <Label>Eligibility</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={f.eligibility} onValueChange={(v) => setF({ ...f, eligibility: v as "always" | "after_months" })}>
                  <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>{ELIGIBILITY.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                {f.eligibility === "after_months" && (
                  <>
                    <Label htmlFor="cc-months" className="text-sm font-normal text-muted-foreground">Months of service</Label>
                    <Input id="cc-months" className="w-24" type="number" min={0} max={600} step={1} placeholder="12" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} />
                  </>
                )}
              </div>
              <p className="text-sm font-medium">
                Eligibility: {f.eligibility === "after_months" ? `After ${f.months.trim() === "" ? "…" : f.months} month${f.months === "1" ? "" : "s"} of service` : "Always"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {f.eligibility === "after_months"
                  ? "Applicable after the employee completes this many months from the Joining Date. Checked on the server against the payroll month's end date (the same date payroll uses for salary and policy); before that it shows ₹0 “Not applicable”. This is separate from the amount formula above — the formula only decides the amount once the employee is eligible."
                  : "Applies to every employee in every payroll month within the Effective From / To dates."}
              </p>
            </div>
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

const nf = (s: string) => { const n = Number(s); return Number.isFinite(n) && s.trim() !== "" ? n.toLocaleString("en-IN") : "…"; };

interface TestOutcome { ok: boolean; error?: string; applicable?: boolean; value?: number; amountIfEligible?: number; needsReview?: boolean; note?: string | null }

/**
 * Custom Formula editor. Two ways in, one stored result (a formula in the EXISTING engine syntax):
 *  • “Amount by Gross range” — pick limits and amounts; the formula is generated (no syntax to learn). A saved range formula
 *    re-opens as its ranges.
 *  • “Write formula” — free text, but only the supported words (GROSS, BASIC, DA and a few functions) are accepted.
 * “Test” runs the WHOLE component on the server — the amount formula through the same evaluator Payroll uses, plus the service
 * eligibility through the same function Payroll uses — using test-only inputs (a joining date and a payroll month typed here).
 */
function FormulaEditor({ value, onChange, eligibilityType, eligibilityMonths }: {
  value: string; onChange: (v: string) => void; eligibilityType: "always" | "after_months"; eligibilityMonths: number | null;
}) {
  const [saved] = useState(() => (value.trim() ? parseRangeFormula(value) : null));
  const [mode, setMode] = useState<"range" | "write">(() => (saved ? "range" : value.trim() ? "write" : "range"));
  const [tiers, setTiers] = useState<RangeTier[]>(() => saved?.tiers ?? [{ limit: "", mode: "below", amount: "" }]);
  const [finalAmt, setFinalAmt] = useState(() => saved?.finalAmount ?? "");
  const [touched, setTouched] = useState(false);
  const [tGross, setTGross] = useState(""); const [tBasic, setTBasic] = useState(""); const [tDa, setTDa] = useState("");
  const [tJoin, setTJoin] = useState(""); const [tMonth, setTMonth] = useState("");
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [limits, setLimits] = useState<Array<{ gross: number; text: string }> | null>(null);
  const test = useTestPayrollComponent();
  const bound = useTestPayrollComponent();

  const built = mode === "range" ? buildRangeFormula(tiers, finalAmt) : null;
  const problem = mode === "write" && value.trim() ? checkFormula(value) : null;
  const needsService = eligibilityType === "after_months";

  const applyTiers = (t: RangeTier[], last: string) => {
    setTouched(true); setTiers(t); setFinalAmt(last); setLimits(null);
    onChange(buildRangeFormula(t, last).formula ?? "");
  };
  const setTier = (i: number, p: Partial<RangeTier>) => applyTiers(tiers.map((x, j) => (j === i ? { ...x, ...p } : x)), finalAmt);
  const addRow = () => {
    // Natural continuation of a band table: after a "below X" row the next row is usually "up to and including Y".
    const next: RangeTier["mode"] = tiers.length > 0 && tiers[tiers.length - 1].mode === "below" ? "upto" : "below";
    applyTiers([...tiers, { limit: "", mode: next, amount: "" }], finalAmt);
  };
  const insert = (tok: string) => { onChange(`${value}${value && !/[\s(]$/.test(value) ? " " : ""}${tok}`); setOutcome(null); };

  const showRange = () => {
    if (mode === "range") return;
    if (!value.trim()) { setMode("range"); return; }
    const p = parseRangeFormula(value);
    if (p) { setTiers(p.tiers); setFinalAmt(p.finalAmount); setLimits(null); setMode("range"); return; }
    if (window.confirm("This formula was not created with the range builder, so it cannot be shown as ranges.\n\nOK = start a new range table (replaces the formula).\nCancel = keep editing it as text.")) {
      setTiers([{ limit: "", mode: "below", amount: "" }]); setFinalAmt(""); setTouched(false); onChange(""); setMode("range");
    }
  };

  const runTest = async () => {
    const g = Number(tGross);
    if (!value.trim()) { toast({ title: "Complete the formula (or the Gross ranges) first.", variant: "destructive" }); return; }
    if (tGross.trim() === "" || !Number.isFinite(g)) { toast({ title: "Enter a Gross to test.", variant: "destructive" }); return; }
    if (needsService && (!tJoin || !tMonth)) { toast({ title: "Enter a test Joining Date and a payroll month.", description: "They are used only for this test — no employee data is read or changed.", variant: "destructive" }); return; }
    try {
      setOutcome(await test.mutateAsync({
        expr: value, gross: g, basic: tBasic.trim() ? Number(tBasic) : null, da: tDa.trim() ? Number(tDa) : null,
        eligibilityType, eligibilityMonths, joiningDate: tJoin || null, payrollMonth: tMonth ? `${tMonth}-01` : null,
      }));
    } catch (e) { toast({ title: "Test failed", description: errText(e), variant: "destructive" }); }
  };

  // Boundary check derived from the rows the user entered (limit − 0.01, limit, limit + 0.01) — no amounts are built into the app.
  const runLimits = async () => {
    if (!built?.formula) return;
    const pts = new Set<number>();
    for (const t of tiers) { const l = Number(t.limit); [Number((l - 0.01).toFixed(2)), l, Number((l + 0.01).toFixed(2))].forEach((x) => { if (x >= 0) pts.add(x); }); }
    const out: Array<{ gross: number; text: string }> = [];
    try {
      for (const g of [...pts].sort((a, b) => a - b)) {
        const r = await bound.mutateAsync({ expr: built.formula, gross: g, eligibilityType: "always" });
        out.push({ gross: g, text: r.ok ? formatAmount(r.value ?? 0) : (r.error ?? "error") });
      }
      setLimits(out);
    } catch (e) { toast({ title: "Check failed", description: errText(e), variant: "destructive" }); }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Custom Formula — amount</Label>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant={mode === "range" ? "default" : "outline"} onClick={showRange}>Amount by Gross range</Button>
          <Button type="button" size="sm" variant={mode === "write" ? "default" : "outline"} onClick={() => setMode("write")}>Write formula</Button>
        </div>
      </div>

      {mode === "range" ? (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">The amount changes with the employee’s <b>Gross Salary</b>. Enter the Gross limits from lowest to highest. For a limit that belongs to the band below it (e.g. “₹20,000 is still ₹100”) choose <b>up to and including</b>.</p>
          {tiers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-muted-foreground">If Gross is</span>
              <Select value={t.mode} onValueChange={(v) => setTier(i, { mode: v as RangeTier["mode"] })}>
                <SelectTrigger className="h-8 w-56" aria-label={`Comparison ${i + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="below">below (limit not included)</SelectItem><SelectItem value="upto">up to and including</SelectItem></SelectContent>
              </Select>
              <Input className="h-8 w-32" type="number" min={0} step="0.01" placeholder="Gross limit ₹" aria-label={`Gross limit ${i + 1}`} value={t.limit} onChange={(e) => setTier(i, { limit: e.target.value })} />
              <span className="text-muted-foreground">→ ₹</span>
              <Input className="h-8 w-24" type="number" min={0} step="0.01" placeholder="Amount" aria-label={`Amount ${i + 1}`} value={t.amount} onChange={(e) => setTier(i, { amount: e.target.value })} />
              <Button type="button" size="sm" variant="ghost" disabled={tiers.length === 1} onClick={() => applyTiers(tiers.filter((_, j) => j !== i), finalAmt)} aria-label={`Remove limit ${i + 1}`}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Otherwise (Gross above the last limit) → ₹</span>
            <Input className="h-8 w-24" type="number" min={0} step="0.01" placeholder="Amount" aria-label="Amount above last limit" value={finalAmt} onChange={(e) => applyTiers(tiers, e.target.value)} />
            <Button type="button" size="sm" variant="outline" onClick={addRow}><Plus className="mr-1 h-3.5 w-3.5" /> Add limit</Button>
          </div>
          {built?.error ? (
            touched ? <p className="text-[11px] text-amber-700" role="alert">{built.error}</p> : <p className="text-[11px] text-muted-foreground">Fill in the limits and amounts above.</p>
          ) : built?.formula ? (
            <div className="rounded bg-muted/50 p-2 text-[11px]">
              <ul className="mb-1 list-inside list-disc">
                {tiers.map((t, i) => {
                  const prev = tiers[i - 1];
                  const lower = prev ? `${prev.mode === "below" ? "≥" : ">"} ${nf(prev.limit)} and ` : "";
                  return <li key={i}>Gross {lower}{t.mode === "below" ? "<" : "≤"} {nf(t.limit)} → ₹{nf(t.amount)}</li>;
                })}
                <li>Gross {tiers[tiers.length - 1].mode === "below" ? "≥" : ">"} {nf(tiers[tiers.length - 1].limit)} → ₹{nf(finalAmt)}</li>
              </ul>
              <span className="text-muted-foreground">Stored formula: </span><code className="break-all font-mono">{built.formula}</code>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="h-7" onClick={runLimits} disabled={bound.isPending}>{bound.isPending ? "Checking…" : "Check the limits"}</Button>
                {limits && limits.map((l) => <span key={l.gross} className="rounded border bg-background px-1.5 py-0.5">₹{l.gross.toLocaleString("en-IN")} → <b>{l.text}</b></span>)}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <Input value={value} onChange={(e) => { onChange(e.target.value); setOutcome(null); }} placeholder="round(BASIC * 0.02, 2)" className="font-mono" aria-label="Formula" />
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-muted-foreground">Insert:</span>
            {FORMULA_VARIABLES.map((v) => <Button key={v.token} type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => insert(v.token)}>{v.label} <span className="ml-1 font-mono text-muted-foreground">{v.token}</span></Button>)}
            {FORMULA_FUNCTIONS.map((fn) => <Button key={fn} type="button" size="sm" variant="ghost" className="h-6 px-2 font-mono text-[11px]" onClick={() => insert(`${fn}(`)}>{fn}(</Button>)}
          </div>
          {problem ? <p className="text-[11px] text-destructive">{problem}</p> : (
            <p className="text-[11px] text-muted-foreground">Only <span className="font-mono">GROSS, BASIC, DA</span> and <span className="font-mono">{FORMULA_FUNCTIONS.join(", ")}</span> with + − * / ( ) are supported. There is no IF — for amounts that change with Gross use “Amount by Gross range”.</p>
          )}
        </div>
      )}

      <div className="space-y-2 border-t pt-2">
        <p className="text-[11px] font-medium">Test the whole component <span className="font-normal text-muted-foreground">— test values only; no employee or payroll data is read or changed</span></p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-[11px]">Gross ₹</Label><Input className="h-8 w-28" type="number" aria-label="Test Gross" value={tGross} onChange={(e) => { setTGross(e.target.value); setOutcome(null); }} /></div>
          <div className="space-y-1"><Label className="text-[11px]">Basic ₹ (optional)</Label><Input className="h-8 w-24" type="number" value={tBasic} onChange={(e) => setTBasic(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-[11px]">DA ₹ (optional)</Label><Input className="h-8 w-24" type="number" value={tDa} onChange={(e) => setTDa(e.target.value)} /></div>
          {needsService && (
            <>
              <div className="space-y-1"><Label className="text-[11px]">Joining Date (test only)</Label><Input className="h-8 w-40" type="date" aria-label="Test joining date" value={tJoin} onChange={(e) => { setTJoin(e.target.value); setOutcome(null); }} /></div>
              <div className="space-y-1"><Label className="text-[11px]">Payroll month</Label><Input className="h-8 w-40" type="month" aria-label="Test payroll month" value={tMonth} onChange={(e) => { setTMonth(e.target.value); setOutcome(null); }} /></div>
            </>
          )}
          <Button type="button" size="sm" variant="outline" onClick={runTest} disabled={test.isPending || Boolean(problem) || !value.trim()}>{test.isPending ? "Testing…" : "Test"}</Button>
        </div>
        {outcome && (
          !outcome.ok ? <p className="text-[11px] text-destructive" role="alert">{outcome.error}</p>
          : outcome.applicable === false ? (
            <p className="text-sm" role="status">
              <b className="text-muted-foreground">Not applicable · ₹0</b>
              <span className="block text-[11px] text-muted-foreground">{outcome.needsReview ? `⚠ ${outcome.note}` : outcome.note}{outcome.amountIfEligible != null ? ` (Once eligible the amount would be ${formatAmount(outcome.amountIfEligible)}.)` : ""}</span>
            </p>
          ) : (
            <p className="text-sm" role="status"><b className="text-emerald-700">= {formatAmount(outcome.value ?? 0)}</b>{outcome.note ? <span className="block text-[11px] text-muted-foreground">{outcome.note}</span> : null}</p>
          )
        )}
      </div>
    </div>
  );
}

/** Read-only list used inside a Salary Structure: it only REFERENCES common components, never redefines them. */
export function CommonComponentsReference({ companyId, onOpenCommon }: { companyId?: string; onOpenCommon?: () => void }) {
  const { policy, rules, isLoading } = useCommonComponents(companyId);
  if (isLoading) return null;
  const rows = rules.filter((r) => r.kind !== "tds" || r.enabled);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium">Common Payroll Components</p>
        {onOpenCommon && <Button size="sm" variant="ghost" onClick={onOpenCommon}>Manage</Button>}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Shared by every salary structure — defined once under Common Payroll Components, not per structure.</p>
      {!policy || rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None configured yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <Badge key={r.id} variant={r.enabled ? "success" : "secondary"} className="text-[11px]">
              {(r.componentName ?? SYSTEM_LABEL[r.kind] ?? r.kind.toUpperCase())} · {r.enabled ? "Applicable" : "Off"}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
