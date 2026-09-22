import { z } from "zod";

export const CALCULATION_TYPE_OPTIONS = ["manual", "automatic", "hybrid"] as const;
export const TARGET_TYPE_OPTIONS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export const MEASUREMENT_UNIT_OPTIONS = [
  "percentage",
  "number",
  "amount",
  "hours",
  "days",
  "quantity",
  "score",
  "rating",
] as const;
export const FORMULA_TYPE_OPTIONS = [
  "greater_than_target",
  "equal_to_target",
  "less_than_target",
  "range_based",
  "percentage_based",
  "formula_based",
] as const;

export const kpiFormSchema = z.object({
  kpiCode: z
    .string()
    .min(2, "KPI code is required")
    .max(40, "Keep the code under 40 characters")
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers, and underscores only"),
  kpiName: z.string().min(2, "KPI name is required"),
  categoryId: z.string().optional(),
  description: z.string().optional(),
  calculationType: z.enum(CALCULATION_TYPE_OPTIONS),
  targetType: z.enum(TARGET_TYPE_OPTIONS),
  measurementUnit: z.enum(MEASUREMENT_UNIT_OPTIONS),
  dataSource: z.string().min(1, "Data source is required"),
  formulaType: z.enum(FORMULA_TYPE_OPTIONS),
  isActive: z.boolean(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});
export type KpiFormSchema = z.infer<typeof kpiFormSchema>;

export const kpiCategoryFormSchema = z.object({
  name: z.string().min(2, "Category name is required"),
  displayOrder: z.coerce.number().int().min(0).optional(),
});
export type KpiCategoryFormSchema = z.infer<typeof kpiCategoryFormSchema>;

export const kpiTargetFormSchema = z.object({
  targetValue: z.coerce.number(),
  effectiveDate: z.string().min(1, "Effective date is required"),
  expiryDate: z.string().optional(),
});
export type KpiTargetFormSchema = z.infer<typeof kpiTargetFormSchema>;

export const kpiActualFormSchema = z
  .object({
    periodStart: z.string().min(1, "Period start is required"),
    periodEnd: z.string().min(1, "Period end is required"),
    actualValue: z.coerce.number(),
    notes: z.string().optional(),
  })
  .refine((data) => data.periodEnd >= data.periodStart, {
    message: "Period end cannot be before period start",
    path: ["periodEnd"],
  });
export type KpiActualFormSchema = z.infer<typeof kpiActualFormSchema>;
