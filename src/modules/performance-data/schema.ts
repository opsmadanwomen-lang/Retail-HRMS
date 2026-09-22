import { z } from "zod";

export const METRIC_CATEGORY_OPTIONS = [
  "sales",
  "billing",
  "customer",
  "operations",
  "inventory",
  "attendance",
  "task",
  "checklist",
  "audit",
  "training",
  "security",
  "housekeeping",
  "maintenance",
  "custom",
] as const;

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

export const CALCULATION_TYPE_OPTIONS = ["manual", "automatic", "hybrid"] as const;

export const metricFormSchema = z.object({
  metricCode: z
    .string()
    .min(2, "Metric code is required")
    .max(40, "Keep the code under 40 characters")
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers, and underscores only"),
  metricName: z.string().min(2, "Metric name is required"),
  category: z.enum(METRIC_CATEGORY_OPTIONS),
  measurementUnit: z.enum(MEASUREMENT_UNIT_OPTIONS),
  calculationType: z.enum(CALCULATION_TYPE_OPTIONS),
  isActive: z.boolean(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});
export type MetricFormSchema = z.infer<typeof metricFormSchema>;

export const metricMappingFormSchema = z
  .object({
    metricId: z.string().min(1, "Select a metric"),
    roleId: z.string().optional(),
    departmentId: z.string().optional(),
    storeId: z.string().optional(),
    employeeId: z.string().optional(),
  })
  .refine((data) => data.roleId || data.departmentId || data.storeId || data.employeeId, {
    message: "Select at least one of Role, Department, Store, or Employee.",
    path: ["roleId"],
  });
export type MetricMappingFormSchema = z.infer<typeof metricMappingFormSchema>;

export const performanceEntryFormSchema = z.object({
  metricId: z.string().min(1, "Select a metric"),
  employeeId: z.string().optional(),
  storeId: z.string().min(1, "Select a store"),
  departmentId: z.string().optional(),
  roleId: z.string().optional(),
  entryDate: z.string().min(1, "Entry date is required"),
  entryValue: z.coerce.number(),
  remarks: z.string().optional(),
});
export type PerformanceEntryFormSchema = z.infer<typeof performanceEntryFormSchema>;

export const metricApprovalFormSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  remarks: z.string().optional(),
});
export type MetricApprovalFormSchema = z.infer<typeof metricApprovalFormSchema>;
