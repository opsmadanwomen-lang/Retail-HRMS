import { z } from "zod";

export const STORE_STATUS_OPTIONS = ["active", "inactive", "onboarding", "closed"] as const;

export const storeFormSchema = z.object({
  companyId: z.string().min(1, "Company is required"),
  name: z.string().min(2, "Store name must be at least 2 characters"),
  code: z
    .string()
    .min(2, "Store code must be at least 2 characters")
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, hyphens or underscores only"),
  storeType: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  gstNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  status: z.enum(STORE_STATUS_OPTIONS),
});

export type StoreFormSchema = z.infer<typeof storeFormSchema>;
