import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useRoleCategories } from "@/hooks/useRoleLookups";
import { useMasterDepartments } from "@/hooks/useMasterDepartments";
import { useStores } from "@/hooks/useStores";
import { useEmployees } from "@/hooks/useEmployees";
import { useAuth } from "@/hooks/useAuth";
import type { RoleFilters as RoleFiltersValue } from "@/types/role";

interface RoleFiltersProps {
  value: RoleFiltersValue;
  onChange: (value: RoleFiltersValue) => void;
}

export function RoleFilters({ value, onChange }: RoleFiltersProps) {
  const { user } = useAuth();
  const { data: categories } = useRoleCategories();
  const { data: departments } = useMasterDepartments();
  const { data: stores } = useStores();
  const { data: employees } = useEmployees({ companyId: user?.companyId ?? undefined });

  const hasActiveFilters = Boolean(
    value.categoryId || value.departmentId || value.storeId || value.isActive !== undefined || value.employeeId
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="space-y-1.5">
        <Label>Employee</Label>
        <Select
          value={value.employeeId ?? "all"}
          onValueChange={(v) => onChange({ ...value, employeeId: v === "all" ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All employees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All employees</SelectItem>
            {(employees ?? []).map((emp) => (
              <SelectItem key={emp.id} value={emp.id}>
                {emp.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Category</Label>
        <Select
          value={value.categoryId ?? "all"}
          onValueChange={(v) => onChange({ ...value, categoryId: v === "all" ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(categories ?? []).map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Department</Label>
        <Select
          value={value.departmentId ?? "all"}
          onValueChange={(v) => onChange({ ...value, departmentId: v === "all" ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {(departments ?? []).map((dept) => (
              <SelectItem key={dept.id} value={dept.id}>
                {dept.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Store</Label>
        <Select
          value={value.storeId ?? "all"}
          onValueChange={(v) => onChange({ ...value, storeId: v === "all" ? undefined : v })}
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
          value={value.isActive === undefined ? "all" : value.isActive ? "active" : "inactive"}
          onValueChange={(v) =>
            onChange({ ...value, isActive: v === "all" ? undefined : v === "active" })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-end">
        {hasActiveFilters && (
          <Button variant="ghost" onClick={() => onChange({ search: value.search })} className="gap-2">
            <X className="h-4 w-4" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
