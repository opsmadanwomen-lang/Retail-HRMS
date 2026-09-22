// Employee Master ↔ Grade master helpers. Grades are loaded dynamically from public.employee_grades
// (Payroll Settings → Grades & Categories); nothing about specific grade codes is known here.

export interface GradeLike {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** "M1 — Unskilled" */
export function gradeLabel(g: Pick<GradeLike, "code" | "name">): string {
  return `${g.code} — ${g.name}`;
}

/**
 * Grades offered in the Employee form: every ACTIVE grade for a new assignment, plus the grade the
 * employee is ALREADY stored with (even if it has since been made inactive) so a historical value is
 * preserved and can still be shown / kept — an inactive grade is never offered to anyone else.
 */
export function gradeSelectOptions<T extends GradeLike>(grades: T[], storedGradeId?: string | null): T[] {
  return grades.filter((g) => g.isActive || (storedGradeId != null && g.id === storedGradeId));
}

/** id → "M1 — Unskilled" for list/profile display. Includes inactive grades so historical values still render. */
export function gradeLabelMap(grades: GradeLike[]): Map<string, string> {
  return new Map(grades.map((g) => [g.id, gradeLabel(g)]));
}
