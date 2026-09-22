import { z } from "zod";

export const companyFormSchema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters"),
  legalName: z.string().optional(),
  registrationNumber: z.string().optional(),
  gstNumber: z.string().optional(),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
});

export type CompanyFormSchema = z.infer<typeof companyFormSchema>;
