import { Link } from "react-router-dom";
import { CalendarClock, Clock, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingCards, LoadingState } from "@/components/common/LoadingState";
import { usePerformanceDashboardStats } from "@/hooks/usePerformanceDashboardStats";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/constants/routes";

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Clock }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PerformanceDashboardPage() {
  const { user } = useAuth();
  const { data: stats, isLoading } = usePerformanceDashboardStats(user?.companyId ?? undefined);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Dashboard"
        description="Operational overview of every collected data point across your stores."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={ROUTES.approvals}>Approvals</Link>
            </Button>
            <Button asChild>
              <Link to={ROUTES.dailyEntry}>Daily Entry</Link>
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <LoadingCards count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Today's Entries" value={stats?.todaysEntries ?? 0} icon={CalendarClock} />
          <StatCard label="Pending Entries" value={stats?.pendingEntries ?? 0} icon={Clock} />
          <StatCard label="Approved Entries" value={stats?.approvedEntries ?? 0} icon={CheckCircle2} />
          <StatCard label="Rejected Entries" value={stats?.rejectedEntries ?? 0} icon={XCircle} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Store Wise Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState rows={3} />
            ) : !stats || stats.storeWise.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries yet.</p>
            ) : (
              <div className="space-y-2">
                {stats.storeWise.map((row) => (
                  <div key={row.storeId} className="flex items-center justify-between text-sm">
                    <span className="truncate">{row.storeName}</span>
                    <Badge variant="secondary">{row.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Department Wise Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState rows={3} />
            ) : !stats || stats.departmentWise.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries yet.</p>
            ) : (
              <div className="space-y-2">
                {stats.departmentWise.map((row) => (
                  <div key={row.departmentId} className="flex items-center justify-between text-sm">
                    <span className="truncate">{row.departmentName}</span>
                    <Badge variant="secondary">{row.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role Wise Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState rows={3} />
            ) : !stats || stats.roleWise.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries yet.</p>
            ) : (
              <div className="space-y-2">
                {stats.roleWise.map((row) => (
                  <div key={row.roleId} className="flex items-center justify-between text-sm">
                    <span className="truncate">{row.roleName}</span>
                    <Badge variant="secondary">{row.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
