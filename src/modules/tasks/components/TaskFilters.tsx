import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useTaskCategories } from "@/hooks/useTaskCategories";
import { useTaskFrequencies } from "@/hooks/useTaskLookups";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { TASK_PRIORITY_OPTIONS } from "../schema";
import type { TaskFilters as TaskFiltersValue } from "@/types/task";

interface TaskFiltersProps {
  value: TaskFiltersValue;
  onChange: (value: TaskFiltersValue) => void;
}

export function TaskFilters({ value, onChange }: TaskFiltersProps) {
  const { user } = useAuth();
  const { data: categories } = useTaskCategories();
  const { data: frequencies } = useTaskFrequencies();
  const { data: roles } = useRoles({ companyId: user?.companyId ?? undefined });

  const hasActiveFilters = Boolean(
    value.categoryId || value.frequencyId || value.roleId || value.priority || value.isActive !== undefined
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
        <Label>Frequency</Label>
        <Select
          value={value.frequencyId ?? "all"}
          onValueChange={(v) => onChange({ ...value, frequencyId: v === "all" ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All frequencies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All frequencies</SelectItem>
            {(frequencies ?? []).map((freq) => (
              <SelectItem key={freq.id} value={freq.id}>
                {freq.label}
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
        <Label>Priority</Label>
        <Select
          value={value.priority ?? "all"}
          onValueChange={(v) => onChange({ ...value, priority: v === "all" ? undefined : (v as TaskFiltersValue["priority"]) })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {TASK_PRIORITY_OPTIONS.map((p) => (
              <SelectItem key={p} value={p} className="capitalize">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
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
        {hasActiveFilters && (
          <Button variant="ghost" size="icon" title="Clear filters" onClick={() => onChange({ search: value.search })}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
