import { CalendarClock, CheckCircle2, Clock, ShieldCheck, XCircle, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingCards, LoadingState } from "@/components/common/LoadingState";
import { useTaskDashboardStats } from "@/hooks/useTaskDashboardStats";
import { useAuth } from "@/hooks/useAuth";

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

export function TaskDashboardPage() {
  const { user } = useAuth();
  const { data: stats, isLoading } = useTaskDashboardStats(user?.companyId ?? undefined);

  return (
    <div className="space-y-6">
      <PageHeader title="Task Dashboard" description="Operational overview of every task assignment across your stores." />

      {isLoading ? (
        <LoadingCards count={6} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Today's Tasks" value={stats?.todayTasks ?? 0} icon={CalendarClock} />
          <StatCard label="Pending Tasks" value={stats?.pendingTasks ?? 0} icon={Clock} />
          <StatCard label="Completed Tasks" value={stats?.completedTasks ?? 0} icon={CheckCircle2} />
          <StatCard label="Verified Tasks" value={stats?.verifiedTasks ?? 0} icon={ShieldCheck} />
          <StatCard label="Rejected Tasks" value={stats?.rejectedTasks ?? 0} icon={XCircle} />
          <StatCard label="Overdue Tasks" value={stats?.overdueTasks ?? 0} icon={AlertTriangle} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Category Wise Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState rows={3} />
            ) : !stats || stats.categoryWise.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {stats.categoryWise.map((row) => (
                  <div key={row.categoryId} className="flex items-center justify-between text-sm">
                    <span className="truncate">{row.categoryName}</span>
                    <Badge variant="secondary">{row.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role Wise Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState rows={3} />
            ) : !stats || stats.roleWise.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks assigned yet.</p>
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
