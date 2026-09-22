import { z } from "zod";

export const TASK_PRIORITY_OPTIONS = ["low", "medium", "high", "critical"] as const;

export const taskFormSchema = z.object({
  taskCode: z
    .string()
    .min(2, "Task code is required")
    .max(40, "Keep the code under 40 characters")
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers, and underscores only"),
  taskName: z.string().min(2, "Task name is required"),
  categoryId: z.string().optional(),
  frequencyId: z.string().optional(),
  templateId: z.string().optional(),
  priority: z.enum(TASK_PRIORITY_OPTIONS),
  description: z.string().optional(),
  estimatedTimeMinutes: z.coerce.number().int().min(0).optional(),
  requiresVerification: z.boolean(),
  allowPhotoUpload: z.boolean(),
  allowDocumentUpload: z.boolean(),
  allowRemarks: z.boolean(),
  allowGpsPlaceholder: z.boolean(),
  allowQrPlaceholder: z.boolean(),
  weightage: z.coerce.number().min(0).max(100).optional(),
  isActive: z.boolean(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});
export type TaskFormSchema = z.infer<typeof taskFormSchema>;

export const taskTemplateFormSchema = z.object({
  templateCode: z
    .string()
    .min(2, "Template code is required")
    .max(40, "Keep the code under 40 characters")
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers, and underscores only"),
  templateName: z.string().min(2, "Template name is required"),
  categoryId: z.string().optional(),
  description: z.string().optional(),
  isActive: z.boolean(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});
export type TaskTemplateFormSchema = z.infer<typeof taskTemplateFormSchema>;

export const assignTaskFormSchema = z.object({
  taskId: z.string().min(1, "Select a task"),
  statusId: z.string().min(1, "Select a status"),
  priority: z.enum(TASK_PRIORITY_OPTIONS),
  dueDate: z.string().min(1, "Due date is required"),
  dueTime: z.string().optional(),
});
export type AssignTaskFormSchema = z.infer<typeof assignTaskFormSchema>;

export const taskVerificationFormSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  remarks: z.string().optional(),
  score: z.coerce.number().min(0).max(100).optional(),
});
export type TaskVerificationFormSchema = z.infer<typeof taskVerificationFormSchema>;

export const taskChecklistItemFormSchema = z.object({
  itemName: z.string().min(1, "Item name is required"),
  description: z.string().optional(),
  isMandatory: z.boolean(),
  weightage: z.coerce.number().min(0).max(100).optional(),
  sequence: z.coerce.number().int().min(0).optional(),
});
export type TaskChecklistItemFormSchema = z.infer<typeof taskChecklistItemFormSchema>;
