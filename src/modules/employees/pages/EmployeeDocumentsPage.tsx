import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Users } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmployeeSearchBar } from "../components/EmployeeSearchBar";
import { EmployeeFilters } from "../components/EmployeeFilters";
import { useEmployees } from "@/hooks/useEmployees";
import { useAuth } from "@/hooks/useAuth";
import { useEmployeeDocuments } from "@/hooks/useEmployeeDocuments";
import { REQUIRED_DOCUMENT_TYPES } from "@/constants/documentTypes";
import type { EmployeeFilters as EmployeeFiltersValue } from "@/types/employee";

/** Grace period (days since joining) before a fully-missing document set is treated as overdue
 *  rather than "just hasn't had a chance yet" — a pure display heuristic (spec §18), not a new
 *  document requirement, due-date field, or business rule; no document/storage logic changes. */
const DOCUMENT_OVERDUE_GRACE_DAYS = 15;

function DocumentsStatusBadge({ employeeId, joiningDate }: { employeeId: string; joiningDate: string | null }) {
  const { data: documents } = useEmployeeDocuments(employeeId);
  const uploadedTypes = new Set((documents ?? []).map((d) => d.documentType));
  const total = REQUIRED_DOCUMENT_TYPES.length;
  const present = REQUIRED_DOCUMENT_TYPES.filter((t) => uploadedTypes.has(t)).length;

  const daysSinceJoining = joiningDate ? (Date.now() - new Date(joiningDate).getTime()) / 86_400_000 : 0;
  const isOverdue = present < total && daysSinceJoining > DOCUMENT_OVERDUE_GRACE_DAYS;

  const label = `${present}/${total} ${present === total ? "Complete" : "Pending"}`;
  // 0 collected, still within the grace period -> neutral (a brand-new joiner, not a problem yet).
  // Some collected but incomplete, or 0 collected past the grace period -> amber/red per spec §18.
  const variant: "success" | "warning" | "destructive" | "secondary" =
    present === total ? "success" : isOverdue ? "destructive" : present === 0 ? "secondary" : "warning";

  return <Badge variant={variant}>{label}</Badge>;
}

export function EmployeeDocumentsPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<EmployeeFiltersValue>({});
  const [search, setSearch] = useState("");

  const effectiveFilters = useMemo<EmployeeFiltersValue>(
    () => ({
      ...filters,
      companyId: user?.companyId ?? undefined,
      search: search || undefined,
    }),
    [filters, search, user?.companyId]
  );

  const { data: employees, isLoading, error } = useEmployees(effectiveFilters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee Documents"
        description="Browse staff, review document readiness, and open an employee profile for full details."
      />

      <Card>
        <CardContent className="space-y-4 p-6">
          <EmployeeSearchBar value={search} onChange={setSearch} />
          <EmployeeFilters value={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              Unable to load employees right now.
            </div>
          ) : !employees || employees.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No employees found"
              description="Try a different search or filter to find the staff you need."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee Code</TableHead>
                    <TableHead>Staff Name</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Designation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Documents</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">{employee.employeeCode ?? "—"}</TableCell>
                      <TableCell>
                        <Link to={`/employees/${employee.id}`} className="flex items-center gap-2 font-medium text-primary hover:underline">
                          <FileText className="h-4 w-4" />
                          {employee.fullName}
                        </Link>
                      </TableCell>
                      <TableCell>{employee.storeName ?? "—"}</TableCell>
                      <TableCell>{employee.departmentName ?? "—"}</TableCell>
                      <TableCell>{employee.designationTitle ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={employee.status === "active" ? "success" : "secondary"}>
                          {employee.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DocumentsStatusBadge employeeId={employee.id} joiningDate={employee.joiningDate} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
