// Salary slab boundary convention — must match public.salary_slab_rules in the database:
//   * the exclusion constraint uses numrange(min_gross, coalesce(max_gross, 'infinity'), '[]')
//   * salary_resolve_for_employee matches with  gross >= min_gross and (max_gross is null or gross <= max_gross)
// i.e. BOTH bounds are inclusive and a null max means "no upper limit". Two active slabs overlap
// iff  aMin <= bMax  and  bMin <= aMax. Adjacent slabs therefore differ by one paisa, e.g.
// ₹0–₹12,499.99 then ₹12,500–₹20,000 then ₹20,000.01–∞. No amounts are hard-coded here.

export interface SlabRange {
  minGross: number;
  maxGross: number | null;
}

const upper = (r: SlabRange) => (r.maxGross == null ? Infinity : r.maxGross);

export function slabsOverlap(a: SlabRange, b: SlabRange): boolean {
  return a.minGross <= upper(b) && b.minGross <= upper(a);
}

/** First ACTIVE existing slab that genuinely overlaps `candidate`, or undefined. */
export function findSlabOverlap<T extends SlabRange & { isActive: boolean }>(candidate: SlabRange, existing: T[]): T | undefined {
  return existing.find((s) => s.isActive && slabsOverlap(candidate, s));
}
