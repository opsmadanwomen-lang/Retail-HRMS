import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingState } from "@/components/common/LoadingState";
import { useCommonComponents, useSalaryPreview, useSalaryPreviewForGross, useSalarySlabRules } from "@/hooks/usePayroll";
import { formatAmount } from "@/modules/advance/utils";
import { errText, quickTestValues, reviewIssues, slabText, splitPreview } from "@/modules/payroll/salaryPreview";
import { PreviewBlock, ReadOnlyField, ReviewIssues } from "@/modules/payroll/components/SalaryPreviewParts";
import { OtLateBasisCard } from "@/modules/payroll/components/OtLateBasisCard";
import type { SalaryStructure } from "@/types/payroll";

// Sample Gross values offered as quick-test buttons IN ADDITION to the boundaries read from the configured slabs.
// They only fill the input — routing is always decided by the server from the salary slabs, never by this list.
const SAMPLE_GROSS = [10000, 13000, 25000];
const SYSTEM_NAMES: Record<string, string> = { PF: "Provident Fund", ESI: "ESI", PT: "Professional Tax", TDS: "TDS", GRATUITY: "Gratuity", LWP: "Loss of Pay", ADVREC: "Advance Recovery" };
const currentMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Test Salary Structure — completely READ-ONLY. It calls the same server engine as payroll (payroll_policy_preview with no employee:
 * slab routing → salary_bifurcate → common components incl. service eligibility) and the existing salary_preview for this structure alone.
 * It never creates or changes an employee, salary, grade, structure, slab, component, policy or payroll row.
 */
export function SalaryStructureTestDialog({ structure, companyId, onClose }: { structure: SalaryStructure | null; companyId?: string; onClose: () => void }) {
  const [gross, setGross] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [joining, setJoining] = useState("");
  const [debounced, setDebounced] = useState<number | undefined>(undefined);
  useEffect(() => {
    const n = Number(gross);
    const t = setTimeout(() => setDebounced(Number.isFinite(n) && n > 0 ? n : undefined), 350);
    return () => clearTimeout(t);
  }, [gross]);
  const pick = (g: number) => { setGross(String(g)); setDebounced(g); };

  const slabQ = useSalarySlabRules(companyId);
  const { rules } = useCommonComponents(companyId);
  const previewQ = useSalaryPreviewForGross({ employeeId: null, companyId, periodMonth: /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : undefined, gross: debounced, joiningDate: joining || null });
  const ownQ = useSalaryPreview(structure?.id, debounced);

  const chips = useMemo(() => quickTestValues(slabQ.data ?? [], SAMPLE_GROSS), [slabQ.data]);

  const nameOf = useMemo(() => {
    const m: Record<string, string> = { ...SYSTEM_NAMES };
    for (const r of rules) if (r.componentCode) m[r.componentCode] = r.componentName ?? r.componentCode;
    return (code: string, fallback?: string) => m[code] ?? fallback ?? code;
  }, [rules]);

  const p = previewQ.data;
  const struct = p?.salary_structure;
  const label = struct?.id ? `${struct.code ?? ""} - ${struct.name ?? ""}` : null;
  const parts = splitPreview(p);
  const settled = debounced === Number(gross) && !previewQ.isFetching;
  const routesHere = Boolean(structure && struct?.id && struct.id === structure.id);
  const grossNum = Number(gross);
  const ownRows = ownQ.data ?? [];

  return (
    <Dialog open={Boolean(structure)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Salary Structure — {structure?.code} · {structure?.name}</DialogTitle>
          <DialogDescription className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Read-only. Nothing is saved — no employee, salary, grade, structure, slab, component or payroll data is created or changed.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="st-gross">Test Gross Salary (₹)</Label><Input id="st-gross" type="number" inputMode="decimal" min={0} step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="e.g. 11000" /></div>
          <div className="space-y-1.5"><Label htmlFor="st-month">Test Date (payroll month)</Label><Input id="st-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="st-join">Test Joining Date <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="st-join" type="date" value={joining} onChange={(e) => setJoining(e.target.value)} /></div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" aria-label="Quick test values">
          <span className="text-[11px] text-muted-foreground">Quick test:</span>
          {chips.map((c) => (
            <Button key={c} type="button" size="sm" variant={grossNum === c ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => pick(c)}>{formatAmount(c)}</Button>
          ))}
        </div>

        {!gross.trim() ? (
          <p className="text-xs text-muted-foreground">Enter a Gross Salary, or pick a quick-test value, to see which structure it routes to and how it is split.</p>
        ) : previewQ.isError && settled ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{errText(previewQ.error)}</p>
        ) : !p && !settled ? (
          <LoadingState rows={4} />
        ) : p && !struct?.id ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />No active salary structure is configured for this Gross Salary.</p>
        ) : p && struct ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <ReadOnlyField label="Test Gross" value={formatAmount(grossNum)} />
              <ReadOnlyField label="Structure" value={label} />
              <ReadOnlyField label="Grade" value={label} />
              <ReadOnlyField label="Slab" value={slabText(slabQ.data ?? [], struct.id)} />
            </div>

            {routesHere ? (
              <p className="flex items-center gap-1 text-xs text-emerald-700" role="status"><CheckCircle2 className="h-4 w-4" /> This Gross routes to {structure?.code} — payroll would use this structure.</p>
            ) : (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="status">
                This Gross falls in the slab of <b>{struct.code}</b>, so payroll would use <b>{struct.code}</b>, not {structure?.code}{structure?.status !== "active" ? ` (${structure?.status} structures are not routed to)` : ""}. The result below is for {struct.code}; what {structure?.code} alone would give is shown at the bottom.
              </p>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <PreviewBlock
                title="Salary Bifurcation"
                rows={parts.structureEarnings.map((e) => ({ code: e.code, name: e.name || e.code, amount: e.amount }))}
                total={parts.structureEarnings.reduce((a, e) => a + Number(e.amount), 0)}
                totalLabel="Gross"
              />
              <PreviewBlock
                title="Common Payroll Components"
                empty="No common component applies."
                rows={[
                  ...parts.commonEarnings.map((e) => ({ code: e.code, name: e.name || nameOf(e.code), amount: e.amount, sign: "+" as const, note: p.line_notes?.[e.code] ?? e.note, unresolved: e.unresolved })),
                  ...parts.deductions.map((d) => ({ code: d.code, name: nameOf(d.code, d.name), amount: d.amount, sign: "−" as const, note: p.line_notes?.[d.code] ?? d.note, unresolved: d.unresolved })),
                ]}
              />
            </div>
            <ReviewIssues issues={reviewIssues(p)} />
            {p.ot_late_basis && <OtLateBasisCard basis={p.ot_late_basis} />}
            {!joining && (
              <p className="text-[11px] text-muted-foreground">Enter a Test Joining Date to evaluate service-based rules (for example Medical Fund after 12 months). Today's date is never used as a substitute.</p>
            )}

            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4" aria-label="Estimated totals">
              <div><p className="text-[11px] text-muted-foreground">Gross</p><p className="font-medium tabular-nums">{formatAmount(grossNum)}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Earnings</p><p className="font-medium tabular-nums">{formatAmount(Number(p.gross))}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Deductions</p><p className="font-medium tabular-nums">− {formatAmount(Number(p.total_deductions))}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Estimated Net</p><p className="text-base font-semibold tabular-nums">{formatAmount(Number(p.net_salary))}</p></div>
            </div>
            <p className="text-[11px] text-muted-foreground">Estimate for a full month: overtime, late, loss of pay and advance recovery come from Attendance, Leave and Advance Management and are not part of these totals — the hourly basis above is what OT and Late would be valued at for the Test Date's month.</p>

            {!routesHere && (
              <div className="rounded-lg border border-dashed p-3">
                <p className="mb-2 text-sm font-medium">{structure?.code} alone, at this Gross (ignoring the slab)</p>
                {ownQ.isLoading ? <LoadingState rows={2} /> : ownQ.isError ? <p className="text-xs text-destructive">{errText(ownQ.error)}</p> : (
                  <ul className="space-y-1 text-sm">
                    {ownRows.map((r) => <li key={r.code} className="flex justify-between"><span>{r.name || r.code}</span><span className="tabular-nums">{formatAmount(r.amount)}</span></li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
