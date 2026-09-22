import { z } from "zod";

export const ROLE_TYPE_OPTIONS = ["frontend", "backend", "both"] as const;

export const roleFormSchema = z.object({
  roleName: z.string().min(2, "Role name is required"),
  roleCode: z
    .string()
    .min(2, "Role code is required")
    .max(40, "Keep the code under 40 characters")
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers, and underscores only"),
  categoryId: z.string().optional(),
  description: z.string().optional(),
  roleType: z.enum(ROLE_TYPE_OPTIONS),
  departmentId: z.string().optional(),
  isActive: z.boolean(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});

export type RoleFormSchema = z.infer<typeof roleFormSchema>;

export const assignRoleFormSchema = z
  .object({
    roleId: z.string().min(1, "Select a role"),
    statusId: z.string().min(1, "Select a status"),
    effectiveDate: z.string().min(1, "Effective date is required"),
    endDate: z.string().optional(),
    remarks: z.string().optional(),
  })
  .refine((data) => !data.endDate || data.endDate >= data.effectiveDate, {
    message: "End date cannot be before the effective date",
    path: ["endDate"],
  });

export type AssignRoleFormSchema = z.infer<typeof assignRoleFormSchema>;

export const removeRoleFormSchema = z.object({
  reason: z.string().optional(),
});

export type RemoveRoleFormSchema = z.infer<typeof removeRoleFormSchema>;
