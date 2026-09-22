import { z } from "zod";

export const EMPLOYEE_STATUS_OPTIONS = [
  "active",
  "inactive",
  "on_leave",
  "notice_period",
  "resigned",
  "terminated",
  "transferred",
] as const;

export const EMPLOYMENT_TYPE_OPTIONS = ["full_time", "part_time", "contract", "intern", "consultant"] as const;
export const SALARY_TYPE_OPTIONS = ["monthly", "daily", "hourly", "piece_rate"] as const;
export const GENDER_OPTIONS = ["male", "female", "other", "prefer_not_to_say"] as const;

const MOBILE_REGEX = /^[0-9+\-\s]{7,15}$/;

export const EMPLOYEE_SCOPE_OPTIONS = ["store_specific", "company_wide"] as const;

export const employeeFormSchema = z
  .object({
    employeeScope: z.enum(EMPLOYEE_SCOPE_OPTIONS),
    storeId: z.string().optional(),
    storeDesignationId: z.string().optional(),
    reportingManagerId: z.string().optional(),
  employeeCode: z.string().optional(),
  firstName: z.string().min(1, "First name is required"),
  middleName: z.string().optional(),
  lastName: z.string().min(1, "Last name is required"),
  gender: z.enum(GENDER_OPTIONS).optional(),
  dateOfBirth: z.string().optional(),
  bloodGroup: z.string().optional(),
  mobile: z
    .string()
    .optional()
    .refine((val) => !val || MOBILE_REGEX.test(val), "Enter a valid mobile number"),
  alternateMobile: z
    .string()
    .optional()
    .refine((val) => !val || MOBILE_REGEX.test(val), "Enter a valid mobile number"),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  joiningDate: z.string().optional(),
  confirmationDate: z.string().optional(),
  leavingDate: z.string().optional(),
  exitReason: z.string().optional(),
  exitStatus: z.enum(["resigned", "terminated", "retired", "absconded", "contract_end", "other"]).optional(),
  gradeId: z.string().optional(),
  categoryId: z.string().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPE_OPTIONS).optional(),
  salaryType: z.enum(SALARY_TYPE_OPTIONS).optional(),
  status: z.enum(EMPLOYEE_STATUS_OPTIONS),
  })
  .superRefine((values, ctx) => {
    if (values.leavingDate && values.joiningDate && values.leavingDate < values.joiningDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["leavingDate"], message: "Leaving date cannot be before joining date." });
    }
    // Store Specific: Store is required (existing behaviour, unchanged). Company Wide: Store must
    // NOT be set — enforced here so the form can never silently submit a stale storeId left over
    // from switching scope after picking a store.
    if (values.employeeScope === "store_specific") {
      if (!values.storeId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["storeId"], message: "Store is required" });
      }
      if (!values.storeDesignationId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["storeDesignationId"], message: "Designation is required" });
      }
    } else if (values.storeId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["storeId"], message: "Company-wide employees must not have a store." });
    }
  });

export type EmployeeFormSchema = z.infer<typeof employeeFormSchema>;

export const employeeFilterSchema = z.object({
  storeId: z.string().optional(),
  storeTeamId: z.string().optional(),
  storeDepartmentId: z.string().optional(),
  storeDesignationId: z.string().optional(),
  status: z.enum(EMPLOYEE_STATUS_OPTIONS).optional(),
  joiningFrom: z.string().optional(),
  joiningTo: z.string().optional(),
  search: z.string().optional(),
});

export type EmployeeFilterSchema = z.infer<typeof employeeFilterSchema>;
