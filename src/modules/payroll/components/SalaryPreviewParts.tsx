import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { formatAmount } from "@/modules/advance/utils";
import type { ReviewIssue } from "@/modules/payroll/salaryPreview";

/** Read-only, automatically resolved value (Auto Grade / Salary Structure / Salary Slab). */
export function ReadOnlyField({ label, value, loading, id }: { label: string; value: string | null | undefined; loading?: boolean; id?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground" htmlFor={id}>{label} <span className="text-[10px]">(automatic)</span></Label>
      <div id={id} className="flex min-h-10 items-center rounded-md border bg-muted/40 px-3 py-2 text-sm" aria-readonly="true">
        {loading ? <span className="text-muted-foreground">Working it out…</span> : value ?? <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

export interface PreviewRow { code: string; name: string; amount: number; sign?: "+" | "−"; note?: string | null; unresolved?: boolean }

/** A titled list of preview lines. A "Not applicable …" note (service eligibility not yet met) is shown as such instead of a bare ₹0. */
export function PreviewBlock({ title, rows, total, totalLabel, empty }: { title: string; rows: PreviewRow[]; total?: number; totalLabel?: string; empty?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-sm font-medium">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">{empty ?? "—"}</p> : (
        <ul className="space-y-1 text-sm">
          {rows.map((r, i) => {
            const notApplicable = Boolean(r.note) && /^Not applicable/.test(r.note ?? "");
            return (
              <li key={`${r.code}-${i}`}>
                <div className="flex justify-between gap-2">
                  <span className={r.unresolved ? "text-amber-800" : notApplicable ? "text-muted-foreground" : undefined}>{r.name}{r.unresolved ? " ⚠" : ""}</span>
                  <span className={`tabular-nums ${notApplicable ? "text-muted-foreground" : ""}`}>{notApplicable ? "Not applicable · ₹0" : `${r.sign ? `${r.sign} ` : ""}${formatAmount(Number(r.amount))}`}</span>
                </div>
                {notApplicable && <div className="text-[11px] text-muted-foreground">{r.note}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {total != null && rows.length > 0 && (
        <div className="mt-2 flex justify-between border-t pt-1 text-sm font-medium"><span>{totalLabel}</span><span className="tabular-nums">{formatAmount(total)}</span></div>
      )}
    </div>
  );
}

/** Needs-review notes for a component (invalid formula / missing Joining Date). They never hide the resolved structure. */
export function ReviewIssues({ issues }: { issues: ReviewIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[11px] text-amber-900" aria-label="Needs review">
      {issues.map((i) => (
        <li key={i.key} className={i.kind === "formula" ? "text-destructive" : undefined}>
          <AlertTriangle className="mr-1 inline h-3 w-3" /><b>Needs review — {i.head}</b>{i.detail ? `: ${i.detail}` : ""}
          {i.kind === "formula" ? " Fix it under Common Payroll Components; this line shows ₹0 until then." : ""}
        </li>
      ))}
    </ul>
  );
}
