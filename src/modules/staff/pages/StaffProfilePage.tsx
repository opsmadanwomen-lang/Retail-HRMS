import { Lock } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import { useEmployee } from "@/hooks/useEmployees";
import { AttendanceInformationCard } from "@/modules/attendance/components/AttendanceInformationCard";
import { DocumentDetailsCard } from "@/modules/staff/components/DocumentDetailsCard";
import { initialsFromName } from "@/lib/utils";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value && value.length > 0 ? value : <span className="text-muted-foreground">Not available</span>}</p>
    </div>
  );
}

function LockedField({ label }: { label: string }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <Lock className="h-3 w-3" />
      </p>
      <p className="text-sm font-medium text-muted-foreground">Contact HR to update</p>
    </div>
  );
}

/**
 * Staff Panel — My Profile. Read-only self-service view of the logged-in Staff's own Employee
 * record, resolved the SAME way every other Staff Panel page resolves identity (useCurrentEmployee
 * -> useEmployee, never a URL/route param) — a Staff account can never view another employee's
 * profile through this page. No new backend/permission logic is introduced: editing is not wired
 * up here (this project has no existing "staff self-edit" RPC/permission model to reuse), matching
 * the explicit UI-only scope for this task. Bank Details and Emergency Contact have no schema in
 * this project today (confirmed by investigation) — shown honestly as "Contact HR", never
 * fabricated.
 */
export function StaffProfilePage() {
  const { user } = useAuth();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const employeeId = currentEmployeeQuery.data?.id;
  const employeeQuery = useEmployee(employeeId);
  const employee = employeeQuery.data;

  if (currentEmployeeQuery.isLoading || employeeQuery.isLoading) {
    return <LoadingState />;
  }

  if (!employee) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Your account is not linked to an employee profile. Contact your administrator.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="My Profile" description="View and update your personal information." />

      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
            {initialsFromName(employee.fullName)}
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">{employee.fullName}</p>
            <p className="text-sm text-muted-foreground">
              {employee.designationTitle ?? "—"}
              {employee.storeName ? ` · ${employee.storeName}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <Badge variant="outline">Employee Code: {employee.employeeCode ?? "—"}</Badge>
              <Badge variant={employee.status === "active" ? "default" : "secondary"} className="capitalize">
                {employee.status}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Full Name" value={employee.fullName} />
          <Field label="Date of Birth" value={employee.dateOfBirth} />
          <Field label="Gender" value={employee.gender} />
          <Field label="Phone" value={employee.mobile} />
          <Field label="Email" value={employee.email} />
          <Field label="Address" value={null} />
        </CardContent>
      </Card>

      <DocumentDetailsCard employeeId={employeeId} />

      <Card>
        <CardHeader>
          <CardTitle>Bank Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <LockedField label="Bank Name" />
          <LockedField label="IFSC" />
          <LockedField label="Account Number" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emergency Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" value={null} />
          <Field label="Relation" value={null} />
          <Field label="Phone" value={null} />
        </CardContent>
      </Card>

      {/* Same component/data/hooks that used to render inline on the Attendance page as
          "Attendance Information" — moved here per the Profile-page-restructuring task. Nothing
          recalculated: reads the exact same live rule-resolution (useExplainAttendanceRules ->
          attendance_explain_rules()) and shift/weekly-off/night-duty-config hooks, so a Shift or
          Attendance Rule change made by Admin shows up here automatically, same as it did before.
          The "Employee" identity group is hidden (showEmployeeSection=false) since the header card
          above already shows Name/Code/Store/Status. Read-only — no edit affordance exists in this
          component for any of these Admin-controlled values. */}
      <AttendanceInformationCard
        employeeId={employeeId}
        companyId={user?.companyId ?? undefined}
        title="Shift & Attendance Rules"
        showEmployeeSection={false}
      />
    </div>
  );
}
