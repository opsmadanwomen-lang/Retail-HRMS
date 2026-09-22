/** Form-side state of the Employees → Payroll Salary section (kept out of the component file so it can be shared with the form page). */
export interface SalaryDraft { gross: string; effectiveFrom: string; reason: string; editing: boolean }

/** What the parent form should do with salary when the employee is saved. `blocking` = why the form must not submit yet. */
export interface SalaryIntent { save: boolean; gross: number; effectiveFrom: string; reason: string | null; blocking: string | null }

export const NO_STRUCTURE_MESSAGE = "No active salary structure is configured for this Gross Salary.";

/**
 * Decides, from what the SERVER answered, whether the salary can be saved and what blocks it. It resolves nothing itself:
 * `structId` / `ambiguous` / `note` come from the server's resolver, `currentGross` from the salary history.
 */
export function computeSalaryIntent(i: {
  showFields: boolean; hasGross: boolean; grossNum: number; effectiveFrom: string; settled: boolean;
  isError: boolean; errorText: string; structId: string | null | undefined; ambiguous: boolean; note: string | null | undefined; currentGross: number | null;
}): { save: boolean; blocking: string | null } {
  if (!i.showFields || !i.hasGross) return { save: false, blocking: null };
  let blocking: string | null = null;
  if (!Number.isFinite(i.grossNum) || i.grossNum <= 0) blocking = NO_STRUCTURE_MESSAGE;          // Gross 0 is not routed by the resolver
  else if (!i.effectiveFrom) blocking = "Choose the salary Effective From date.";
  else if (!i.settled) blocking = "Working out the salary structure…";
  else if (i.isError) blocking = i.errorText;
  else if (!i.structId) blocking = NO_STRUCTURE_MESSAGE;
  else if (i.ambiguous) blocking = i.note ?? "More than one salary structure matches this Gross Salary.";
  // An unchanged Gross on an employee who already has a salary does not create a new revision.
  return { save: !blocking && (i.currentGross == null || i.grossNum !== i.currentGross), blocking };
}

// The default Effective From is only a starting value for the input the user can change; it is never used for eligibility or resolution.
export const emptySalaryDraft = (): SalaryDraft => ({ gross: "", effectiveFrom: new Date().toISOString().slice(0, 10), reason: "", editing: false });
export const noSalaryIntent: SalaryIntent = { save: false, gross: 0, effectiveFrom: "", reason: null, blocking: null };
