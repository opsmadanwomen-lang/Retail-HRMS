import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useStores } from "@/hooks/useStores";
import { useOrganizationTree } from "@/hooks/useOrganizationTree";
import { EMPLOYEE_STATUS_OPTIONS } from "../schema";
import type { EmployeeFilters as EmployeeFiltersValue } from "@/types/employee";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  on_leave: "On Leave",
  notice_period: "Notice Period",
  resigned: "Resigned",
  terminated: "Terminated",
  transferred: "Transferred",
};

interface EmployeeFiltersProps {
  value: EmployeeFiltersValue;
  onChange: (value: EmployeeFiltersValue) => void;
}

export function EmployeeFilters({ value, onChange }: EmployeeFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { data: stores } = useStores();
  const { data: orgTree } = useOrganizationTree(value.storeId);

  const departments = (orgTree ?? []).flatMap((team) => team.departments);
  const designations = departments
    .filter((d) => !value.storeDepartmentId || d.id === value.storeDepartmentId)
    .flatMap((d) => d.designations);

  const hasActiveFilters = Boolean(
    value.storeId || value.storeDepartmentId || value.storeDesignationId || value.status || value.joiningFrom || value.joiningTo
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
        <Label>Store</Label>
        <Select
          value={value.storeId ?? "all"}
          onValueChange={(v) =>
            onChange({ ...value, storeId: v === "all" ? undefined : v, storeDepartmentId: undefined, storeDesignationId: undefined })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="All stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            {(stores ?? []).map((store) => (
              <SelectItem key={store.id} value={store.id}>
                {store.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select
            value={value.status ?? "all"}
            onValueChange={(v) => onChange({ ...value, status: v === "all" ? undefined : (v as EmployeeFiltersValue["status"]) })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {EMPLOYEE_STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowAdvanced((s) => !s)}>
            {showAdvanced ? "Hide advanced" : "Advanced filters"}
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="icon" title="Clear filters" onClick={() => onChange({ search: value.search })}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {showAdvanced && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select
              value={value.storeDepartmentId ?? "all"}
              onValueChange={(v) => onChange({ ...value, storeDepartmentId: v === "all" ? undefined : v, storeDesignationId: undefined })}
              disabled={!value.storeId}
            >
              <SelectTrigger>
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Designation</Label>
            <Select
              value={value.storeDesignationId ?? "all"}
              onValueChange={(v) => onChange({ ...value, storeDesignationId: v === "all" ? undefined : v })}
              disabled={!value.storeId}
            >
              <SelectTrigger>
                <SelectValue placeholder="All designations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All designations</SelectItem>
                {designations.map((designation) => (
                  <SelectItem key={designation.id} value={designation.id}>
                    {designation.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Joining From</Label>
            <Input type="date" value={value.joiningFrom ?? ""} onChange={(e) => onChange({ ...value, joiningFrom: e.target.value || undefined })} />
          </div>

          <div className="space-y-1.5">
            <Label>Joining To</Label>
            <Input type="date" value={value.joiningTo ?? ""} onChange={(e) => onChange({ ...value, joiningTo: e.target.value || undefined })} />
          </div>
        </div>
      )}
    </div>
  );
}
