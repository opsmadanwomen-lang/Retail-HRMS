import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { METRIC_CATEGORY_OPTIONS } from "../schema";
import type { MetricFilters as MetricFiltersValue } from "@/types/performance";

interface MetricFiltersProps {
  value: MetricFiltersValue;
  onChange: (value: MetricFiltersValue) => void;
}

export function MetricFilters({ value, onChange }: MetricFiltersProps) {
  const hasActiveFilters = Boolean(value.category || value.isActive !== undefined);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label>Category</Label>
        <Select
          value={value.category ?? "all"}
          onValueChange={(v) => onChange({ ...value, category: v === "all" ? undefined : (v as MetricFiltersValue["category"]) })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {METRIC_CATEGORY_OPTIONS.map((cat) => (
              <SelectItem key={cat} value={cat} className="capitalize">
                {cat}
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

export function MetricSearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search by metric name or code…" className="pl-9" />
    </div>
  );
}
