import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useKpiCategories } from "@/hooks/useKpiCategories";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import type { KpiFilters as KpiFiltersValue } from "@/types/kpi";

interface KpiFiltersProps {
  value: KpiFiltersValue;
  onChange: (value: KpiFiltersValue) => void;
}

export function KpiFilters({ value, onChange }: KpiFiltersProps) {
  const { user } = useAuth();
  const { data: categories } = useKpiCategories();
  const { data: roles } = useRoles({ companyId: user?.companyId ?? undefined });

  const hasActiveFilters = Boolean(value.categoryId || value.roleId || value.isActive !== undefined);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <Label>Role</Label>
        <Select
          value={value.roleId ?? "all"}
          onValueChange={(v) => onChange({ ...value, roleId: v === "all" ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {(roles ?? []).map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.roleName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Status</Label>
        <Select
          value={value.isActive === undefined ? "all" : value.isActive ? "active" : "inactive"}
          onValueChange={(v) => onChange({ ...value, isActive: v === "all" ? undefined : v === "active" })}
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
