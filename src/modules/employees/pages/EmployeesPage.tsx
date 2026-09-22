import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Users, PlusCircle, UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmployeeTable } from "../components/EmployeeTable";
import { EmployeeFilters } from "../components/EmployeeFilters";
import { EmployeeSearchBar } from "../components/EmployeeSearchBar";
import { useDeleteEmployee, useEmployees } from "@/hooks/useEmployees";
import { useEmployeeGrades } from "@/hooks/usePayroll";
import { gradeLabelMap } from "../gradeOptions";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { Employee, EmployeeFilters as EmployeeFiltersValue } from "@/types/employee";

export function EmployeesPage() {
  const { user } = useAuth();

  const [filters, setFilters] = useState<EmployeeFiltersValue>({});
  const [search, setSearch] = useState("");
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);

  const effectiveFilters = useMemo<EmployeeFiltersValue>(
    () => ({
      ...filters,
      companyId: user?.companyId ?? undefined,
      search: search || undefined,
    }),
    [filters, search, user?.companyId]
  );

  const {
    data: employees,
    isLoading,
    error,
  } = useEmployees(effectiveFilters);
  const { data: grades } = useEmployeeGrades(user?.companyId ?? undefined);
  const gradeLabels = useMemo(() => gradeLabelMap(grades ?? []), [grades]);

  console.log("================================");
  console.log("USER :", user);
  console.log("USER COMPANY :", user?.companyId);
  console.log("FILTERS :", effectiveFilters);
  console.log("EMPLOYEES :", employees);
  console.log("ERROR :", error);
  console.log("================================");

  const deleteEmployee = useDeleteEmployee();

  const handleDelete = async () => {
    if (!employeeToDelete) return;

    try {
      await deleteEmployee.mutateAsync(employeeToDelete.id);

      toast({
        title: "Employee deleted",
        description: `${employeeToDelete.fullName} was removed.`,
        variant: "success",
      });

      setEmployeeToDelete(null);
    } catch (error) {
      toast({
        title: "Could not delete employee",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Every employee across your stores, in one place."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={ROUTES.employeeImport}>
                <UploadCloud className="mr-2 h-4 w-4" />
                Import
              </Link>
            </Button>

            <Button asChild>
              <Link to={ROUTES.employeeNew}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Employee
              </Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-6">
          <EmployeeSearchBar
            value={search}
            onChange={setSearch}
          />

          <EmployeeFilters
            value={filters}
            onChange={setFilters}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !employees || employees.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No employees found"
              description="Add your first employee, or import a list from a spreadsheet."
              action={
                <Button asChild size="sm">
                  <Link to={ROUTES.employeeNew}>
                    Add an employee
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmployeeTable
              employees={employees}
              onDelete={setEmployeeToDelete}
              gradeLabels={gradeLabels}
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(employeeToDelete)}
        onOpenChange={(open) =>
          !open && setEmployeeToDelete(null)
        }
        title="Delete this employee?"
        description={`This will permanently remove "${employeeToDelete?.fullName}" and their records.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteEmployee.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}