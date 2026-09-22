import type { RoundingMethod } from "@/lib/attendanceCalculation";

export const ROUNDING_METHOD_OPTIONS: { value: RoundingMethod; label: string }[] = [
  { value: "exact", label: "Exact Minutes" },
  { value: "round_down", label: "Round Down" },
  { value: "round_up", label: "Round Up" },
  { value: "nearest_5", label: "Nearest 5 Minutes" },
  { value: "nearest_10", label: "Nearest 10 Minutes" },
  { value: "nearest_15", label: "Nearest 15 Minutes" },
  { value: "nearest_30", label: "Nearest 30 Minutes" },
  { value: "custom", label: "Custom" },
];

export const CALCULATION_METHOD_OPTIONS = [
  { value: "exact" as const, label: "Exact (raw minutes)" },
  { value: "slab" as const, label: "Slab / Threshold-based" },
];

export function needsCustomRoundingUnit(method: RoundingMethod): boolean {
  return method === "round_down" || method === "round_up" || method === "custom";
}
