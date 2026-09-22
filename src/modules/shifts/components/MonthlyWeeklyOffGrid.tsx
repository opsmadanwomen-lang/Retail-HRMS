import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { employeeService } from "@/services/employeeService";
import { weeklyOffService } from "@/services/weeklyOffService";
import { enumerateMonthDates, currentMonthKey } from "@/lib/dateRange";
import { CalendarRange } from "lucide-react";

interface MonthlyWeeklyOffGridProps {
  storeId: string | undefined;
  companyId: string | undefined;
  defaultMonth: string;
}

/**
 * Read-only "who has which weekly off, this month" grid. Uses each employee's currently active
 * weekly-off pattern — if it changed mid-month, the grid reflects the current pattern for the
 * whole month (the per-date attendance status itself, shown elsewhere, is always fully
 * date-accurate via the history+override resolver; this grid is a planning convenience).
 */
export function MonthlyWeeklyOffGrid({ storeId, companyId, defaultMonth }: MonthlyWeeklyOffGridProps) {
  const [month, setMonth] = useState(defaultMonth);
  const [year, monthNumber] = useMemo(() => month.split("-").map(Number), [month]);
  const days = useMemo(() => enumerateMonthDates(year, monthNumber), [year, monthNumber]);

  const employeesQuery = useQuery({
    queryKey: ["employee-schedule", "grid-employees", companyId, storeId],
    queryFn: () => employeeService.list({ companyId, storeId, status: "active" }),
    enabled: Boolean(companyId),
  });

  const employeeIds = useMemo(() => (employeesQuery.data ?? []).map((e) => e.id), [employeesQuery.data]);

  const weeklyOffQuery = useQuery({
    queryKey: ["employee-schedule", "grid-weekly-off", employeeIds],
    queryFn: () => weeklyOffService.getCurrentForEmployees(employeeIds),
    enabled: employeeIds.length > 0,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4" />
          Monthly Weekly-Off Schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-[220px] space-y-1.5">
          <Label>Month</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} max={currentMonthKey()} />
        </div>

        {employeesQuery.isLoading ? (
          <LoadingState />
        ) : (employeesQuery.data ?? []).length === 0 ? (
          <EmptyState icon={CalendarRange} title="No employees" description="Select a store to see its weekly-off schedule." />
        ) : (
          <Table containerClassName="max-h-[420px]">
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-muted">Employee</TableHead>
                {days.map((d) => (
                  <TableHead key={d.dateKey} className="text-center">
                    {d.dateKey.slice(-2)}
                    <div className="text-[10px] font-normal text-muted-foreground">{d.day}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(employeesQuery.data ?? []).map((employee) => {
                const weeklyOff = weeklyOffQuery.data?.get(employee.id);
                return (
                  <TableRow key={employee.id}>
                    <TableCell className="sticky left-0 z-10 bg-background font-medium">{employee.fullName}</TableCell>
                    {days.map((d) => {
                      const [y, m, dayNum] = d.dateKey.split("-").map(Number);
                      const dayOfWeek = new Date(y, m - 1, dayNum).getDay();
                      const isOff = weeklyOff?.weeklyOffDay === dayOfWeek;
                      return (
                        <TableCell key={d.dateKey} className={cn("text-center text-xs", isOff && "bg-amber-100 font-semibold text-amber-900")}>
                          {isOff ? "WO" : ""}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
