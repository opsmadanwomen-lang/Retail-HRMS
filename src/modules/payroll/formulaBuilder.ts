// Custom Formula helpers for Common Payroll Components.
//
// The formula ENGINE is the existing database function payroll_eval_formula (used by Payroll, Preview and F&F).
// It supports exactly:
//   variables  GROSS, BASIC, DA            (case-insensitive: Gross = GROSS)
//   functions  round, min, max, abs, least, greatest, floor, ceil
//   numbers and + - * / ( ) ,
// There is NO IF / CASE / comparison (< > = !). This file never evaluates anything — it only
//   (a) mirrors the server's "supported words" check so the UI can warn before saving, and
//   (b) GENERATES formulas in that existing syntax from a "Gross range" table.
// The database re-validates every formula on save (trigger) and on use, so this is a convenience, not the guard.

export const FORMULA_VARIABLES: ReadonlyArray<{ token: string; label: string }> = [
  { token: "GROSS", label: "Gross Salary" },
  { token: "BASIC", label: "Basic" },
  { token: "DA", label: "DA" },
];
export const FORMULA_FUNCTIONS: readonly string[] = ["round", "min", "max", "abs", "least", "greatest", "floor", "ceil"];

const ALLOWED = new Set([...FORMULA_VARIABLES.map((v) => v.token), ...FORMULA_FUNCTIONS.map((f) => f.toUpperCase())]);

/** Words in the formula the engine does not know (e.g. IF, Salary, Allowance). Upper-case, unique, in order of appearance. */
export function findUnsupportedTokens(expr: string): string[] {
  const out: string[] = [];
  for (const m of expr.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const t = m[0].toUpperCase();
    if (!ALLOWED.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

export function hasComparison(expr: string): boolean {
  return /[<>=!]/.test(expr);
}

/** Plain-language problem with a formula, or null when it looks acceptable (the server makes the final call). */
export function checkFormula(expr: string): string | null {
  if (!expr.trim()) return "Enter a formula.";
  const bad = findUnsupportedTokens(expr);
  if (bad.length) return `Unsupported word${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}. Use only GROSS, BASIC, DA and ${FORMULA_FUNCTIONS.join(" / ")}.`;
  if (hasComparison(expr)) return "Comparison symbols (< > = !) and IF / CASE are not supported. Use “Amount by Gross range”, or least / greatest / floor / ceil.";
  const depth = [...expr].reduce((d, c) => (c === "(" ? d + 1 : c === ")" ? d - 1 : d), 0);
  if (depth !== 0) return "Brackets do not match.";
  return null;
}

/** below = the limit itself belongs to the NEXT (higher) range;  upto = the limit itself belongs to THIS (lower) range. */
export interface RangeTier { limit: string; mode: "below" | "upto"; amount: string }

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n: number) => String(Number(n.toFixed(6)));

/**
 * The reverse of buildRangeFormula: recognises ONLY the exact shape that buildRangeFormula writes, so a saved range
 * formula re-opens as its ranges (limits + amounts) instead of a blank table. Anything else returns null (edit as text).
 */
export function parseRangeFormula(formula: string): { tiers: RangeTier[]; finalAmount: string } | null {
  const NUM = "(\\d+(?:\\.\\d+)?)";
  const head = new RegExp(`^\\s*${NUM}`).exec(formula);
  if (!head) return null;
  const step = new RegExp(
    `^\\s*([+-])\\s*${NUM}\\s*\\*\\s*(?:\\(1 - least\\(1, greatest\\(0, ceil\\(${NUM} - GROSS\\)\\)\\)\\)|least\\(1, greatest\\(0, ceil\\(GROSS - ${NUM}\\)\\)\\))`,
  );
  let rest = formula.slice(head[0].length);
  let amount = Number(head[1]);
  const tiers: RangeTier[] = [];
  while (rest.trim() !== "") {
    const m = step.exec(rest);
    if (!m) return null;
    const below = m[3] !== undefined;
    tiers.push({ limit: below ? m[3] : m[4], mode: below ? "below" : "upto", amount: fmt(amount) });
    amount = Number((amount + (m[1] === "-" ? -1 : 1) * Number(m[2])).toFixed(6));
    rest = rest.slice(m[0].length);
  }
  return tiers.length === 0 ? null : { tiers, finalAmount: fmt(amount) };
}

/**
 * "Amount by Gross range" → a formula in the EXISTING syntax.
 *   ranges: [{limit 10000, below, 75}, {limit 20000, upto, 100}] + finalAmount 125 means
 *     Gross < 10000 → 75 ;  10000 ≤ Gross ≤ 20000 → 100 ;  Gross > 20000 → 125.
 * Each step between two ranges is  delta × (0 or 1)  where the 0/1 switch is built only from least / greatest / ceil,
 * exact for any number of decimals:
 *     Gross ≥ L :  1 - least(1, greatest(0, ceil(L - GROSS)))
 *     Gross > L :      least(1, greatest(0, ceil(GROSS - L)))
 */
export function buildRangeFormula(tiers: RangeTier[], finalAmount: string): { formula: string | null; error: string | null } {
  if (tiers.length === 0) return { formula: null, error: "Add at least one Gross limit." };
  const limits: number[] = [];
  const amounts: number[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const l = num(tiers[i].limit);
    const a = num(tiers[i].amount);
    if (l == null || l < 0) return { formula: null, error: `Row ${i + 1}: enter a Gross limit of 0 or more.` };
    if (a == null || a < 0) return { formula: null, error: `Row ${i + 1}: enter the amount (0 or more).` };
    if (i > 0 && l <= limits[i - 1]) return { formula: null, error: `Row ${i + 1}: the limit must be higher than the row above.` };
    limits.push(l); amounts.push(a);
  }
  const last = num(finalAmount);
  if (last == null || last < 0) return { formula: null, error: "Enter the amount for Gross above the last limit." };
  amounts.push(last);

  let formula = fmt(amounts[0]);
  for (let i = 0; i < limits.length; i++) {
    const delta = Number((amounts[i + 1] - amounts[i]).toFixed(6));
    if (delta === 0) continue;
    const L = fmt(limits[i]);
    const sw = tiers[i].mode === "below"
      ? `(1 - least(1, greatest(0, ceil(${L} - GROSS))))`
      : `least(1, greatest(0, ceil(GROSS - ${L})))`;
    formula += ` ${delta < 0 ? "-" : "+"} ${fmt(Math.abs(delta))} * ${sw}`;
  }
  return { formula, error: null };
}
