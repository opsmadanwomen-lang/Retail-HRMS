import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCog } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useStores } from "@/hooks/useStores";
import { useShifts } from "@/hooks/useShifts";
import { employeeService } from "@/services/employeeService";
import { shiftService } from "@/services/shiftService";
import { weeklyOffService } from "@/services/weeklyOffService";
import { WEEKDAY_LABELS } from "@/lib/weeklyOffResolver";
import { formatDate } from "@/lib/utils";
import { currentMonthKey } from "@/lib/dateRange";
import { ChangeShiftDialog } from "../components/ChangeShiftDialog";
import { ChangeWeeklyOffDialog } from "../components/ChangeWeeklyOffDialog";
import { ScheduleHistoryDialog } from "../components/ScheduleHistoryDialog";
import { MonthlyWeeklyOffGrid } from "../components/MonthlyWeeklyOffGrid";

export function EmployeeSchedulePage() {
  const { user } = useAuth();
  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [changeShiftFor, setChangeShiftFor] = useState<string[] | null>(null);
  const [changeWeeklyOffFor, setChangeWeeklyOffFor] = useState<string[] | null>(null);
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);

  const storesQuery = useStores(user?.companyId ?? undefined);
  useShifts(user?.companyId ?? undefined); // warms the shift list cache for the Change Shift dialog

  const employeesQuery = useQuery({
    queryKey: ["employee-schedule", "employees", user?.companyId, storeId, search],
    queryFn: () =>
      employeeService.list({
        companyId: user?.companyId ?? undefined,
        storeId,
        search: search.trim() || undefined,
      }),
    enabled: Boolean(user?.companyId),
  });

  const employees = useMemo(
    () => (employeesQuery.data ?? []).filter((e) => !activeOnly || e.isActive),
    [employeesQuery.data, activeOnly]
  );
  const employeeIds = useMemo(() => employees.map((e) => e.id), [employees]);

  const assignmentsQuery = useQuery({
    queryKey: ["employee-schedule", "assignments", employeeIds],
    queryFn: () => shiftService.getCurrentAssignmentsForEmployees(employeeIds),
    enabled: employeeIds.length > 0,
  });

  const weeklyOffQuery = useQuery({
    queryKey: ["employee-schedule", "weekly-off", employeeIds],
    queryFn: () => weeklyOffService.getCurrentForEmployees(employeeIds),
    enabled: employeeIds.length > 0,
  });

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === employees.length ? new Set() : new Set(employeeIds)));
  };

  const selectedEmployees = employees.filter((e) => selected.has(e.id));
  const selectedLabel =
    selectedEmployees.length === 1 ? selectedEmployees[0].fullName : `${selectedEmployees.length} employees selected`;

  const isLoading = employeesQuery.isLoading || (employeeIds.length > 0 && (assignmentsQuery.isLoading || weeklyOffQuery.isLoading));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee Schedule Management"
        description="Assign and change shifts and weekly offs. Past attendance is never recalculated when a schedule changes."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Store</Label>
            <Select value={storeId ?? "all"} onValueChange={(v) => setStoreId(v === "all" ? undefined : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {(storesQuery.data ?? []).map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Employee Search</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee code" />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={activeOnly ? "active" : "all"} onValueChange={(v) => setActiveOnly(v === "active")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="all">All (incl. inactive)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm font-medium">{selected.size} employee(s) selected</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setChangeShiftFor(Array.from(selected))}>
                Change Shift
              </Button>
              <Button size="sm" variant="outline" onClick={() => setChangeWeeklyOffFor(Array.from(selected))}>
                Change Weekly Off
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6">
              <LoadingState />
            </div>
          ) : employees.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={CalendarCog} title="No employees found" description="Adjust your filters to see employees here." />
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[1%]">
                      <input type="checkbox" checked={selected.size === employees.length} onChange={toggleSelectAll} />
                    </TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Current Shift</TableHead>
                    <TableHead>Shift Timing</TableHead>
                    <TableHead>Weekly Off</TableHead>
                    <TableHead>Effective From</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((employee) => {
                    const assignment = assignmentsQuery.data?.get(employee.id);
                    const weeklyOff = weeklyOffQuery.data?.get(employee.id);
                    return (
                      <TableRow key={employee.id}>
                        <TableCell>
                          <input type="checkbox" checked={selected.has(employee.id)} onChange={() => toggleSelected(employee.id)} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{employee.fullName}</div>
                          <div className="text-xs text-muted-foreground">{employee.employeeCode}</div>
                        </TableCell>
                        <TableCell>{employee.storeName ?? "—"}</TableCell>
                        <TableCell>{employee.departmentName ?? "—"}</TableCell>
                        <TableCell>{assignment?.shift.name ?? "Not assigned"}</TableCell>
                        <TableCell>
                          {assignment ? `${assignment.shift.startTime.slice(0, 5)}–${assignment.shift.endTime.slice(0, 5)}` : "—"}
                        </TableCell>
                        <TableCell>{weeklyOff ? WEEKDAY_LABELS[weeklyOff.weeklyOffDay] : "Not set"}</TableCell>
                        <TableCell>{assignment ? formatDate(assignment.effectiveFrom) : "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setChangeShiftFor([employee.id])}>
                              Shift
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setChangeWeeklyOffFor([employee.id])}>
                              Weekly Off
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setHistoryFor({ id: employee.id, name: employee.fullName })}>
                              History
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <MonthlyWeeklyOffGrid storeId={storeId} companyId={user?.companyId ?? undefined} defaultMonth={currentMonthKey()} />

      <ChangeShiftDialog
        open={Boolean(changeShiftFor)}
        onOpenChange={(open) => !open && setChangeShiftFor(null)}
        employeeIds={changeShiftFor ?? []}
        employeeLabel={changeShiftFor && changeShiftFor.length === 1 ? (employees.find((e) => e.id === changeShiftFor[0])?.fullName ?? "") : selectedLabel}
        onDone={() => setSelected(new Set())}
      />
      <ChangeWeeklyOffDialog
        open={Boolean(changeWeeklyOffFor)}
        onOpenChange={(open) => !open && setChangeWeeklyOffFor(null)}
        employeeIds={changeWeeklyOffFor ?? []}
        employeeLabel={
          changeWeeklyOffFor && changeWeeklyOffFor.length === 1 ? (employees.find((e) => e.id === changeWeeklyOffFor[0])?.fullName ?? "") : selectedLabel
        }
        onDone={() => setSelected(new Set())}
      />
      <ScheduleHistoryDialog employeeId={historyFor?.id ?? null} employeeName={historyFor?.name ?? ""} onClose={() => setHistoryFor(null)} />
    </div>
  );
}
