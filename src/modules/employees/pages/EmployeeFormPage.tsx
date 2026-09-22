import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DesignationCascadeSelect } from "../components/DesignationCascadeSelect";
import { ReportingManagerSelect } from "../components/ReportingManagerSelect";
import { gradeLabel, gradeSelectOptions } from "../gradeOptions";
import { StaffAccountCredentialsDialog } from "../components/StaffAccountCredentialsDialog";
import { staffAccountService, type StaffAccountCredentials } from "@/services/staffAccountService";
import {
  employeeFormSchema,
  type EmployeeFormSchema,
  EMPLOYEE_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  SALARY_TYPE_OPTIONS,
  GENDER_OPTIONS,
} from "../schema";
import { useStores } from "@/hooks/useStores";
import { useEmployeeGrades, useEmployeeCategories, useAssignEmployeeSalary } from "@/hooks/usePayroll";
import { EmployeePayrollSalarySection } from "../components/EmployeePayrollSalarySection";
import { emptySalaryDraft, noSalaryIntent, type SalaryDraft, type SalaryIntent } from "../salaryDraft";
import { useCreateEmployee, useEmployee, useUpdateEmployee } from "@/hooks/useEmployees";
import { employeeService } from "@/services/employeeService";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";

// Radix <SelectItem> cannot carry an empty value, so "no grade" uses a sentinel that is mapped back to ""
// (employeeService writes "" as NULL — leaving the value undefined would silently skip the update).
const NO_GRADE = "__none__";

export function EmployeeFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: stores } = useStores(user?.companyId ?? undefined);
  const { data: grades, isLoading: isLoadingGrades } = useEmployeeGrades(user?.companyId ?? undefined);
  const { data: categories } = useEmployeeCategories(user?.companyId ?? undefined);
  const { data: existingEmployee, isLoading: isLoadingEmployee } = useEmployee(id);
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const [newAccountCredentials, setNewAccountCredentials] = useState<StaffAccountCredentials | null>(null);
  const [createdEmployeeId, setCreatedEmployeeId] = useState<string | null>(null);
  // Payroll Salary section (Gross + Effective From -> auto Grade / Structure / Slab). Saved through the existing salary revision function.
  const location = useLocation();
  const assignSalary = useAssignEmployeeSalary();
  const [salaryDraft, setSalaryDraft] = useState<SalaryDraft>(emptySalaryDraft);
  const [salaryIntent, setSalaryIntent] = useState<SalaryIntent>(noSalaryIntent);
  const [salaryFailedForNew, setSalaryFailedForNew] = useState(false);

  // "Edit Salary" on the profile links here with #payroll-salary — bring the section into view once the form is on screen.
  useEffect(() => {
    if (location.hash === "#payroll-salary") {
      const t = setTimeout(() => document.getElementById("payroll-salary")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [location.hash, existingEmployee?.id]);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormSchema>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: { status: "active", employeeScope: "store_specific" },
  });

  const storeId = watch("storeId");
  const employeeScope = watch("employeeScope");
  const joiningDateValue = watch("joiningDate");
  const isCompanyWide = employeeScope === "company_wide";

  // Switching to Company Wide clears any Store/Designation already picked under Store Specific —
  // a store-scoped designation can never apply once there's no store, and Store itself must be
  // NULL for a company-wide employee (enforced again server-side by a CHECK constraint).
  useEffect(() => {
    if (isCompanyWide) {
      setValue("storeId", undefined);
      setValue("storeDesignationId", undefined);
    }
  }, [isCompanyWide, setValue]);

  useEffect(() => {
    if (existingEmployee) {
      reset({
        employeeScope: existingEmployee.employeeScope,
        storeId: existingEmployee.storeId ?? undefined,
        storeDesignationId: existingEmployee.storeDesignationId ?? "",
        reportingManagerId: existingEmployee.reportingManagerId ?? undefined,
        employeeCode: existingEmployee.employeeCode ?? "",
        firstName: existingEmployee.firstName ?? "",
        middleName: existingEmployee.middleName ?? "",
        lastName: existingEmployee.lastName ?? "",
        gender: existingEmployee.gender ?? undefined,
        dateOfBirth: existingEmployee.dateOfBirth ?? "",
        bloodGroup: existingEmployee.bloodGroup ?? "",
        mobile: existingEmployee.mobile ?? "",
        alternateMobile: existingEmployee.alternateMobile ?? "",
        email: existingEmployee.email ?? "",
        joiningDate: existingEmployee.joiningDate ?? "",
        confirmationDate: existingEmployee.confirmationDate ?? "",
        leavingDate: existingEmployee.leavingDate ?? "",
        exitReason: existingEmployee.exitReason ?? "",
        exitStatus: (existingEmployee.exitStatus as EmployeeFormSchema["exitStatus"]) ?? undefined,
        gradeId: existingEmployee.gradeId ?? undefined,
        categoryId: existingEmployee.categoryId ?? undefined,
        employmentType: existingEmployee.employmentType ?? undefined,
        salaryType: existingEmployee.salaryType ?? undefined,
        status: existingEmployee.status,
      });
    }
  }, [existingEmployee, reset]);

  // Active grades + the employee's currently stored grade (kept even if it was later deactivated).
  const gradeOptions = useMemo(
    () => gradeSelectOptions(grades ?? [], existingEmployee?.gradeId),
    [grades, existingEmployee?.gradeId]
  );
  // The grade list RPC returns nothing to a user who may not read the grade master, and the database
  // rejects grade changes from such a user anyway — so don't present a dropdown that cannot work.
  const gradeLocked = !isLoadingGrades && (grades ?? []).length === 0;

  const selectedStoreCompanyId = useMemo(
    () => (stores ?? []).find((s) => s.id === storeId)?.companyId,
    [stores, storeId]
  );

  const onSubmit = async (values: EmployeeFormSchema) => {
    try {
      const companyId = selectedStoreCompanyId ?? user?.companyId;
      if (!companyId) {
        toast({ title: "Could not determine company", description: "Select a store, or sign in with an account linked to a company.", variant: "destructive" });
        return;
      }

      if (values.email) {
        const emailTaken = await employeeService.isEmailTaken(companyId, values.email, id);
        if (emailTaken) {
          setError("email", { message: "This email is already in use." });
          return;
        }
      }

      // Salary that cannot be resolved (no slab / structure cannot split it) must be fixed BEFORE anything is saved.
      if (salaryIntent.blocking) {
        toast({ title: "Payroll Salary needs attention", description: salaryIntent.blocking, variant: "destructive" });
        document.getElementById("payroll-salary")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      // Saved through the EXISTING salary revision function: history, closed-period protection and permissions are enforced by the server.
      const saveSalary = async (employeeId: string): Promise<boolean> => {
        if (!salaryIntent.save) return true;
        try {
          await assignSalary.mutateAsync({
            employeeId, grossSalary: salaryIntent.gross, effectiveFrom: salaryIntent.effectiveFrom, salaryStructureId: null, reason: salaryIntent.reason,
          });
          toast({ title: "Salary saved", variant: "success" });
          setSalaryDraft(emptySalaryDraft());
          return true;
        } catch (salaryError) {
          const message = salaryError && typeof salaryError === "object" && "message" in salaryError ? String((salaryError as { message: unknown }).message) : "Please try again.";
          toast({ title: "Employee saved, but the salary could not be saved", description: `${message} — fix it in Payroll Salary and save again.`, variant: "destructive" });
          return false;
        }
      };

      if (isEditing && id) {
        await updateEmployee.mutateAsync({ id, values, userId: user?.id });
        toast({ title: "Employee updated", variant: "success" });
        // Stay on the page when the salary failed so the user can correct it; otherwise leave as before.
        if (await saveSalary(id)) navigate(ROUTES.employees);
        return;
      }

      const created = await createEmployee.mutateAsync({ companyId, storeId: values.storeId ?? null, values, userId: user?.id });
      toast({ title: "Employee added", description: `Employee Code: ${created.employeeCode}`, variant: "success" });
      setCreatedEmployeeId(created.id);
      const salaryOk = await saveSalary(created.id);
      setSalaryFailedForNew(!salaryOk);

      try {
        const credentials = await staffAccountService.createAccount(created.id);
        setNewAccountCredentials(credentials);
      } catch (accountError) {
        toast({
          title: "Employee saved, but the Staff login could not be created",
          description:
            accountError instanceof Error
              ? accountError.message
              : "You can create the login later from the employee's profile.",
          variant: "destructive",
        });
        navigate(salaryOk ? ROUTES.employees : `/employees/${created.id}/edit#payroll-salary`);
      }
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isEditing && isLoadingEmployee) {
    return <p className="text-sm text-muted-foreground">Loading employee…</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEditing ? "Edit Employee" : "Add Employee"}
        description="Choose Employee Scope first. Store Specific employees are assigned from your existing organization structure; Company Wide employees (e.g. Super Manager) are not tied to any single store. Salary is entered in the Payroll Salary section."
      />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Employment</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                Employee Scope <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="employeeScope"
                control={control}
                render={({ field }) => (
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={field.value === "store_specific"}
                        onChange={() => field.onChange("store_specific")}
                        disabled={isEditing}
                      />
                      Store Specific
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={field.value === "company_wide"}
                        onChange={() => field.onChange("company_wide")}
                        disabled={isEditing}
                      />
                      Company Wide
                    </label>
                  </div>
                )}
              />
              {isCompanyWide && (
                <p className="text-xs text-muted-foreground">
                  Company-wide employees are not assigned to an individual store. Use this for roles that need access across all
                  stores of the company (e.g. Super Manager) — the Super Manager designation itself is assigned separately under
                  Attendance → Night Duty Manager Access.
                </p>
              )}
              {isEditing && <p className="text-xs text-muted-foreground">Employee Scope cannot be changed after creation.</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Store {!isCompanyWide && <span className="text-destructive">*</span>}
              </Label>
              {isCompanyWide ? (
                <Input disabled value="Company Wide / No Store" className="bg-muted/50" />
              ) : (
                <Controller
                  name="storeId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={isEditing}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a store" />
                      </SelectTrigger>
                      <SelectContent>
                        {(stores ?? []).map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {store.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
              {errors.storeId && <p className="text-xs text-destructive">{errors.storeId.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Designation {!isCompanyWide && <span className="text-destructive">*</span>}
              </Label>
              {isCompanyWide ? (
                <Input disabled value="Not applicable — Company Wide" className="bg-muted/50" />
              ) : (
                <Controller
                  name="storeDesignationId"
                  control={control}
                  render={({ field }) => (
                    <DesignationCascadeSelect storeId={storeId} value={field.value} onChange={field.onChange} />
                  )}
                />
              )}
              {errors.storeDesignationId && <p className="text-xs text-destructive">{errors.storeDesignationId.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Reporting Manager</Label>
              <Controller
                name="reportingManagerId"
                control={control}
                render={({ field }) => (
                  <ReportingManagerSelect
                    storeId={storeId}
                    value={field.value}
                    onChange={field.onChange}
                    excludeEmployeeId={id}
                  />
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Employee Code</Label>
              <Input
                readOnly
                disabled
                className="bg-muted/50 font-mono"
                placeholder="AUTO-GENERATED"
                value={isEditing ? existingEmployee?.employeeCode ?? "" : ""}
              />
              <p className="text-xs text-muted-foreground">
                {isEditing
                  ? "Employee Code is permanent and cannot be changed."
                  : isCompanyWide
                  ? "Generated automatically (CW-XXXX-XXXX) after saving — Company Wide employees are not tied to a store's code."
                  : "Generated automatically from the selected store's code after saving."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Joining Date</Label>
              <Input type="date" {...register("joiningDate")} />
            </div>

            <div className="space-y-1.5">
              <Label>Confirmation Date</Label>
              <Input type="date" {...register("confirmationDate")} />
            </div>

            <div className="space-y-1.5">
              <Label>Leaving Date</Label>
              <Input type="date" {...register("leavingDate")} />
              {errors.leavingDate && <p className="text-xs text-destructive">{errors.leavingDate.message}</p>}
              <p className="text-xs text-muted-foreground">The canonical payroll exit date. Payroll prorates the exit month per the Payroll Policy; historical payroll is unaffected.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Exit Status</Label>
              <Controller
                name="exitStatus"
                control={control}
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {["resigned", "terminated", "retired", "absconded", "contract_end", "other"].map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Exit Reason</Label>
              <Input {...register("exitReason")} placeholder="Optional note" />
            </div>

            <div className="space-y-1.5">
              <Label>HR Grade <span className="text-xs font-normal text-muted-foreground">(optional — not used for salary)</span></Label>
              <Controller
                name="gradeId"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value ?? ""}
                    onValueChange={(v) => field.onChange(v === NO_GRADE ? "" : v)}
                    disabled={gradeLocked}
                  >
                    <SelectTrigger><SelectValue placeholder={isLoadingGrades ? "Loading…" : "Select grade"} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_GRADE}>— No grade —</SelectItem>
                      {gradeOptions.map((gr) => (
                        <SelectItem key={gr.id} value={gr.id}>{gradeLabel(gr)}{gr.isActive ? "" : " (inactive)"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted-foreground">
                {gradeLocked
                  ? "No grades are available to you. A grade can be set by an authorised user once grades exist in Payroll Settings → Advanced → Grades & Categories."
                  : "Used only for grade-scoped Advance / Payroll policies and HR reports. The salary Grade is worked out automatically from the Gross Salary in Payroll Salary below."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Controller
                name="categoryId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {(categories ?? []).map((ct) => <SelectItem key={ct.id} value={ct.id}>{ct.code} — {ct.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Employment Type</Label>
              <Controller
                name="employmentType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type} className="capitalize">
                          {type.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Salary Type</Label>
              <Controller
                name="salaryType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {SALARY_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type} className="capitalize">
                          {type.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYEE_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status} value={status} className="capitalize">
                          {status.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <EmployeePayrollSalarySection
          employeeId={id}
          companyId={selectedStoreCompanyId ?? user?.companyId ?? undefined}
          joiningDate={joiningDateValue || undefined}
          draft={salaryDraft}
          onDraftChange={setSalaryDraft}
          onIntentChange={setSalaryIntent}
        />

        <Card>
          <CardHeader>
            <CardTitle>Personal Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                First Name <span className="text-destructive">*</span>
              </Label>
              <Input {...register("firstName")} />
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Middle Name</Label>
              <Input {...register("middleName")} />
            </div>

            <div className="space-y-1.5">
              <Label>
                Last Name <span className="text-destructive">*</span>
              </Label>
              <Input {...register("lastName")} />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Controller
                name="gender"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      {GENDER_OPTIONS.map((gender) => (
                        <SelectItem key={gender} value={gender} className="capitalize">
                          {gender.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Date of Birth</Label>
              <Input type="date" {...register("dateOfBirth")} />
            </div>

            <div className="space-y-1.5">
              <Label>Blood Group</Label>
              <Input placeholder="e.g. O+" {...register("bloodGroup")} />
            </div>

            <div className="space-y-1.5">
              <Label>Mobile</Label>
              <Input {...register("mobile")} />
              {errors.mobile && <p className="text-xs text-destructive">{errors.mobile.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Alternate Mobile</Label>
              <Input {...register("alternateMobile")} />
              {errors.alternateMobile && <p className="text-xs text-destructive">{errors.alternateMobile.message}</p>}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Email</Label>
              <Input type="email" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(ROUTES.employees)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Add Employee"}
          </Button>
        </div>
      </form>

      <StaffAccountCredentialsDialog
        credentials={newAccountCredentials}
        onClose={() => {
          setNewAccountCredentials(null);
          // If the salary could not be saved, land on the Payroll Salary section of the new employee to retry.
          navigate(createdEmployeeId ? (salaryFailedForNew ? `/employees/${createdEmployeeId}/edit#payroll-salary` : `/employees/${createdEmployeeId}`) : ROUTES.employees);
        }}
      />
    </div>
  );
}
