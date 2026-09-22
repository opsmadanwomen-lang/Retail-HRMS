import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStores } from "@/hooks/useStores";
import { useRoles } from "@/hooks/useRoles";
import { useMetrics } from "@/hooks/useMetrics";
import { useAuth } from "@/hooks/useAuth";
import type { PerformanceEntryFilters as EntryFiltersValue } from "@/types/performance";

interface EntryFiltersProps {
  value: EntryFiltersValue;
  onChange: (value: EntryFiltersValue) => void;
}

export function EntryFilters({ value, onChange }: EntryFiltersProps) {
  const { user } = useAuth();
  const { data: stores } = useStores();
  const { data: roles } = useRoles({ companyId: user?.companyId ?? undefined });
  const { data: metrics } = useMetrics({ companyId: user?.companyId ?? undefined });

  const hasActiveFilters = Boolean(
    value.storeId || value.roleId || value.metricId || value.status || value.dateFrom || value.dateTo
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="space-y-1.5">
        <Label>Store</Label>
        <Select value={value.storeId ?? "all"} onValueChange={(v) => onChange({ ...value, storeId: v === "all" ? undefined : v })}>
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
        <Label>Role</Label>
        <Select value={value.roleId ?? "all"} onValueChange={(v) => onChange({ ...value, roleId: v === "all" ? undefined : v })}>
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
        <Label>Metric</Label>
        <Select value={value.metricId ?? "all"} onValueChange={(v) => onChange({ ...value, metricId: v === "all" ? undefined : v })}>
          <SelectTrigger>
            <SelectValue placeholder="All metrics" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All metrics</SelectItem>
            {(metrics ?? []).map((metric) => (
              <SelectItem key={metric.id} value={metric.id}>
                {metric.metricName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Status</Label>
        <Select
          value={value.status ?? "all"}
          onValueChange={(v) => onChange({ ...value, status: v === "all" ? undefined : (v as EntryFiltersValue["status"]) })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="submitted">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="locked">Locked</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Date From</Label>
        <Input type="date" value={value.dateFrom ?? ""} onChange={(e) => onChange({ ...value, dateFrom: e.target.value || undefined })} />
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label>Date To</Label>
          <Input type="date" value={value.dateTo ?? ""} onChange={(e) => onChange({ ...value, dateTo: e.target.value || undefined })} />
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

export function EntrySearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by employee, store, role, or metric…"
        className="pl-9"
      />
    </div>
  );
}
