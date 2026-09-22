import { useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsibilityCard } from "../components/ResponsibilityCard";
import { RemoveRoleDialog } from "../components/RemoveRoleDialog";
import { assignRoleFormSchema, type AssignRoleFormSchema } from "../schema";
import { useEmployees } from "@/hooks/useEmployees";
import { useRoles } from "@/hooks/useRoles";
import { useRoleStatuses } from "@/hooks/useRoleLookups";
import { useActiveEmployeeRoles, useAssignRole } from "@/hooks/useEmployeeRoles";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { EmployeeRole } from "@/types/role";

export function RoleAssignmentPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState<string>("");
  const [removingRole, setRemovingRole] = useState<EmployeeRole | null>(null);

  const { data: employees } = useEmployees({ companyId: user?.companyId ?? undefined });
  const selectedEmployee = (employees ?? []).find((e) => e.id === employeeId);

  const { data: roles } = useRoles({ companyId: user?.companyId ?? undefined, isActive: true });
  const { data: statuses } = useRoleStatuses();
  const { data: activeRoles } = useActiveEmployeeRoles(employeeId || undefined);
  const assignRole = useAssignRole();

  const heldRoleIds = useMemo(() => new Set((activeRoles ?? []).map((r) => r.roleId)), [activeRoles]);
  const availableRoles = (roles ?? []).filter((r) => !heldRoleIds.has(r.id));

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignRoleFormSchema>({
    resolver: zodResolver(assignRoleFormSchema),
    defaultValues: { effectiveDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: AssignRoleFormSchema) => {
    if (!selectedEmployee) return;
    if (!selectedEmployee.storeId) {
      toast({ title: "Not applicable", description: "Role assignment applies to Store Specific employees only.", variant: "destructive" });
      return;
    }
    try {
      await assignRole.mutateAsync({
        employeeId: selectedEmployee.id,
        storeId: selectedEmployee.storeId,
        companyId: selectedEmployee.companyId,
        values,
        assignedBy: user?.id,
      });
      toast({ title: "Role assigned", variant: "success" });
      reset({ effectiveDate: new Date().toISOString().slice(0, 10) });
    } catch (error) {
      toast({
        title: "Could not assign role",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.roles}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Roles
        </Link>
      </Button>

      <PageHeader title="Role Assignment" description="Assign an additional responsibility to an employee." />

      <Card>
        <CardHeader>
          <CardTitle>1. Select Employee</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Search and select an employee" />
            </SelectTrigger>
            <SelectContent>
              {(employees ?? []).map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.fullName} {emp.employeeCode ? `(${emp.employeeCode})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedEmployee && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Assign Role</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <Label>
                    Role <span className="text-destructive">*</span>
                  </Label>
                  <Controller
                    name="roleId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableRoles.map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.roleName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.roleId && <p className="text-xs text-destructive">{errors.roleId.message}</p>}
                  {availableRoles.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      This employee already holds every available role.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Status <span className="text-destructive">*</span>
                  </Label>
                  <Controller
                    name="statusId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a status" />
                        </SelectTrigger>
                        <SelectContent>
                          {(statuses ?? []).map((status) => (
                            <SelectItem key={status.id} value={status.id}>
                              {status.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.statusId && <p className="text-xs text-destructive">{errors.statusId.message}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>
                      Effective Date <span className="text-destructive">*</span>
                    </Label>
                    <Input type="date" {...register("effectiveDate")} />
                    {errors.effectiveDate && <p className="text-xs text-destructive">{errors.effectiveDate.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>End Date</Label>
                    <Input type="date" {...register("endDate")} />
                    {errors.endDate && <p className="text-xs text-destructive">{errors.endDate.message}</p>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Remarks</Label>
                  <Textarea placeholder="Optional notes about this assignment…" {...register("remarks")} />
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => navigate(ROUTES.employees)}>
                    View Employees
                  </Button>
                  <Button type="submit" disabled={isSubmitting || availableRoles.length === 0}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current Responsibilities</CardTitle>
            </CardHeader>
            <CardContent>
              {!activeRoles || activeRoles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No additional roles assigned yet.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {activeRoles.map((employeeRole) => (
                    <ResponsibilityCard key={employeeRole.id} employeeRole={employeeRole} onRemove={setRemovingRole} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <RemoveRoleDialog employeeRole={removingRole} onOpenChange={(open) => !open && setRemovingRole(null)} />
    </div>
  );
}
