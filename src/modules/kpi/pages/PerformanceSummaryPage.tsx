import { useState } from "react";
import { RefreshCw, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RolePerformanceCard } from "../components/RolePerformanceCard";
import { useEmployees } from "@/hooks/useEmployees";
import { usePerformanceCycles, usePerformanceSummary, useCalculatePerformanceSummary } from "@/hooks/usePerformance";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

export function PerformanceSummaryPage() {
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState("");
  const [cycleId, setCycleId] = useState("");

  const { data: employees } = useEmployees({ companyId: user?.companyId ?? undefined });
  const { data: cycles } = usePerformanceCycles(user?.companyId ?? undefined);
  const { data: summary, isLoading } = usePerformanceSummary(employeeId || undefined, cycleId || undefined);
  const calculateSummary = useCalculatePerformanceSummary();

  const handleCalculate = async () => {
    if (!employeeId || !cycleId || !user?.companyId) return;
    try {
      await calculateSummary.mutateAsync({ employeeId, companyId: user.companyId, cycleId, calculatedBy: user.id });
      toast({ title: "Performance recalculated", variant: "success" });
    } catch (error) {
      toast({
        title: "Could not calculate performance",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Summary"
        description="Role-wise and overall performance, rolled up from KPI results."
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Employee</p>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an employee" />
              </SelectTrigger>
              <SelectContent>
                {(employees ?? []).map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Performance Cycle</p>
            <Select value={cycleId} onValueChange={setCycleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a cycle" />
              </SelectTrigger>
              <SelectContent>
                {(cycles ?? []).map((cycle) => (
                  <SelectItem key={cycle.id} value={cycle.id}>
                    {cycle.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              onClick={handleCalculate}
              disabled={!employeeId || !cycleId || calculateSummary.isPending}
              className="w-full sm:w-auto"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {calculateSummary.isPending ? "Calculating…" : "Calculate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {employeeId && cycleId && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Overall Score</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : !summary ? (
                <p className="text-sm text-muted-foreground">
                  No performance calculated yet for this cycle. Click Calculate above.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <p className="text-3xl font-semibold">{summary.overallScore?.toFixed(1) ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">out of 100</p>
                  </div>
                  {summary.overallRatingLabel && (
                    <Badge variant="secondary" className="text-sm">
                      {summary.overallRatingLabel}
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {summary && summary.roleWiseScores.length > 0 && (
            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">Role Wise Score</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {summary.roleWiseScores.map((role) => (
                  <RolePerformanceCard key={role.roleId} roleName={role.roleName} score={role.score} kpiCount={role.kpiCount} />
                ))}
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Performance Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Trend charts across performance cycles will appear here once the Performance Management System is built
                on top of this foundation.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
