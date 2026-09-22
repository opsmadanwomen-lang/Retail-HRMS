import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RotateCcw, SlidersHorizontal } from "lucide-react";

export interface AttendanceFilterDraft {
  storeId?: string;
  departmentId?: string;
  search: string;
  fromDate: string;
  toDate: string;
}

interface AttendanceFiltersCardProps {
  stores: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  draft: AttendanceFilterDraft;
  onDraftChange: (patch: Partial<AttendanceFilterDraft>) => void;
  onApply: () => void;
  onReset: () => void;
  error: string | null;
  maxDate: string;
}

/** Professional HRMS-style filter card: Store / Department / Employee Search / Date Range + Apply/Reset. */
export function AttendanceFiltersCard({
  stores,
  departments,
  draft,
  onDraftChange,
  onApply,
  onReset,
  error,
  maxDate,
}: AttendanceFiltersCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Store</Label>
            <Select
              value={draft.storeId ?? "all"}
              onValueChange={(value) => onDraftChange({ storeId: value === "all" ? undefined : value })}
            >
              <SelectTrigger className="h-10 w-full rounded-lg">
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select
              value={draft.departmentId ?? "all"}
              onValueChange={(value) => onDraftChange({ departmentId: value === "all" ? undefined : value })}
            >
              <SelectTrigger className="h-10 w-full rounded-lg">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Employee Search</Label>
            <Input
              className="h-10 rounded-lg"
              value={draft.search}
              onChange={(event) => onDraftChange({ search: event.target.value })}
              placeholder="Search Employee..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>&nbsp;</Label>
            <div className="flex h-10 gap-2">
              <Button className="flex-1 rounded-lg" onClick={onApply}>
                Apply Filters
              </Button>
              <Button variant="outline" className="rounded-lg" onClick={onReset} title="Reset">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Date Range</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>From Date</Label>
              <Input
                className="h-10 rounded-lg"
                type="date"
                value={draft.fromDate}
                max={maxDate}
                onChange={(event) => onDraftChange({ fromDate: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>To Date</Label>
              <Input
                className="h-10 rounded-lg"
                type="date"
                value={draft.toDate}
                max={maxDate}
                onChange={(event) => onDraftChange({ toDate: event.target.value })}
              />
            </div>
          </div>
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
