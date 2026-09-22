import { formatAmount } from "@/modules/advance/utils";
import type { PayrollPolicyPreview } from "@/types/payroll";

// Pure presentation helpers over the server's preview result (payroll_policy_preview). NOTHING here calculates salary, resolves a slab
// or knows a structure code — the server (salary_resolve_core + salary_bifurcate + the common-component engine) is the only engine.

export function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") return (e as { message: string }).message;
  return typeof e === "string" ? e : "Something went wrong.";
}

/** "₹0 – ₹12,499.99" for a structure, taken from the configured slab rows (display only — never used to route a Gross). */
export function slabText(slabs: ReadonlyArray<{ salaryStructureId: string; minGross: number; maxGross: number | null; isActive: boolean }>, structureId: string | null | undefined): string | null {
  if (!structureId) return null;
  const s = slabs.filter((x) => x.isActive && x.salaryStructureId === structureId);
  return s.length ? s.map((x) => `${formatAmount(x.minGross)} – ${x.maxGross == null ? "∞" : formatAmount(x.maxGross)}`).join(", ") : null;
}

/**
 * Quick-test Gross values: every boundary read from the configured slab rows (each slab's minimum and maximum) plus a few sample values.
 * They only fill the Test input — which structure a Gross belongs to is always decided by the server.
 */
export function quickTestValues(slabs: ReadonlyArray<{ minGross: number; maxGross: number | null; isActive: boolean }>, samples: readonly number[]): number[] {
  const s = new Set<number>(samples);
  for (const sl of slabs.filter((x) => x.isActive)) { if (sl.minGross > 0) s.add(sl.minGross); if (sl.maxGross != null) s.add(sl.maxGross); }
  return [...s].sort((a, b) => a - b);
}

/** Split the preview into the structure's own earnings (Basic / DA / Allowance …) and the common payroll components. */
export function splitPreview(p: PayrollPolicyPreview | undefined) {
  const earnings = p?.earnings ?? [];
  return {
    structureEarnings: earnings.filter((e) => e.calc_type !== "common_component" && !/^(overtime|night_duty|proration)/.test(e.calc_type ?? "")),
    commonEarnings: earnings.filter((e) => e.calc_type === "common_component"),
    deductions: p?.deductions ?? [],
  };
}

export interface ReviewIssue { key: string; kind: "formula" | "joining"; head: string; detail: string }

/**
 * Component-specific problems worth showing next to a salary (an invalid formula, or a service rule that needs a Joining Date).
 * Routine "manual amount not entered" notes are not shown here. They never affect the resolved Grade / Structure / Slab.
 */
export function reviewIssues(p: PayrollPolicyPreview | undefined): ReviewIssue[] {
  const out: ReviewIssue[] = [];
  for (const i of p?.issues ?? []) {
    const note = (i.note ?? "").replace(new RegExp(`^${i.code}:\\s*`, "i"), "");
    const f = /formula is invalid — ([\s\S]*)$/.exec(note);
    if (f) { out.push({ key: `${i.line_type}-${i.code}`, kind: "formula", head: `${i.name || i.code} formula is invalid`, detail: f[1] }); continue; }
    if (/joining date is missing/.test(note)) out.push({ key: `${i.line_type}-${i.code}`, kind: "joining", head: `${i.name || i.code} eligibility cannot be evaluated without Joining Date.`, detail: "" });
  }
  return out;
}
