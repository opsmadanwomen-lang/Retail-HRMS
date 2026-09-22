import { Link } from "react-router-dom";
import { AlertTriangle, Pencil } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/hooks/usePermissions";
import { useEmployeeSalaryAssignments, usePayrollAdmin, useSalarySlabRules } from "@/hooks/usePayroll";
import { formatAmount } from "@/modules/advance/utils";
import { slabText } from "@/modules/payroll/salaryPreview";

/**
 * Current Salary on the Employee profile: Gross, Grade, Structure, Effective From. Read from the server's salary history (the RPC returns
 * rows only to payroll-authorised viewers or the employee themself). "Edit Salary" opens Edit Employee at the Payroll Salary section —
 * there is no separate salary page.
 */
export function EmployeeCurrentSalaryCard({ employeeId, companyId }: { employeeId: string; companyId?: string }) {
  const view = useHasPermission("payroll", "VIEW");
  const edit = useHasPermission("payroll", "EDIT");
  const adminQ = usePayrollAdmin(companyId);
  const asgQ = useEmployeeSalaryAssignments(employeeId);
  const slabQ = useSalarySlabRules(companyId);
  if (!view.allowed || asgQ.isLoading || asgQ.isError) return null;

  const current = (asgQ.data ?? []).find((a) => a.effectiveTo == null) ?? null;
  const canEdit = Boolean(adminQ.data) && edit.allowed;
  const label = current?.resolvedStructureCode ? `${current.resolvedStructureCode} - ${current.resolvedStructureName ?? ""}` : "—";

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        {current ? (
          <div className="grid flex-1 gap-3 sm:grid-cols-4" aria-label="Current salary">
            <div><p className="text-[11px] text-muted-foreground">Current Salary</p><p className="text-lg font-semibold">{formatAmount(current.grossSalary)}</p></div>
            <div><p className="text-[11px] text-muted-foreground">Grade</p><p className="text-sm">{label}</p></div>
            <div><p className="text-[11px] text-muted-foreground">Structure</p><p className="text-sm">{label}{slabText(slabQ.data ?? [], current.resolvedStructureId) ? <span className="block text-[11px] text-muted-foreground">Slab {slabText(slabQ.data ?? [], current.resolvedStructureId)}</span> : null}</p></div>
            <div><p className="text-[11px] text-muted-foreground">Effective From</p><p className="text-sm">{current.effectiveFrom}</p></div>
          </div>
        ) : (
          <p className="flex flex-1 items-center gap-2 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" /> Salary not configured</p>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/employees/${employeeId}/edit#payroll-salary`}><Pencil className="mr-2 h-3.5 w-3.5" />{current ? "Edit Salary" : "Add Salary"}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
