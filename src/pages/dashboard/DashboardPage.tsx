import { Link } from "react-router-dom";
import { Store, Users, ArrowUpRight, ArrowDownRight, PlusCircle, UploadCloud, Network, UserCheck, UserMinus, CalendarClock, ShieldCheck, ShieldOff, Clock, Award, Target, CalendarRange, ListChecks, AlertTriangle, Activity, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingCards, LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useStores } from "@/hooks/useStores";
import { useEmployeeDashboardStats } from "@/hooks/useEmployeeDashboardStats";
import { useRoleDashboardStats } from "@/hooks/useRoleDashboardStats";
import { useKpiDashboardStats } from "@/hooks/useKpiDashboardStats";
import { useTaskDashboardStats } from "@/hooks/useTaskDashboardStats";
import { usePerformanceDashboardStats } from "@/hooks/usePerformanceDashboardStats";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  active: "success",
  onboarding: "warning",
  inactive: "secondary",
  closed: "destructive",
};

function StatCard({
  label,
  value,
  icon: Icon,
  isLoading,
}: {
  label: string;
  value: number | string;
  icon: typeof Store;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{isLoading ? "—" : value.toLocaleString("en-IN")}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: stores, isLoading: storesLoading } = useStores();
  const { data: employeeStats, isLoading: employeeStatsLoading } = useEmployeeDashboardStats(user?.companyId ?? undefined);
  const { data: roleStats, isLoading: roleStatsLoading } = useRoleDashboardStats(user?.companyId ?? undefined);
  const { data: kpiStats, isLoading: kpiStatsLoading } = useKpiDashboardStats(user?.companyId ?? undefined);
  const { data: taskStats, isLoading: taskStatsLoading } = useTaskDashboardStats(user?.companyId ?? undefined);
  const { data: performanceStats, isLoading: performanceStatsLoading } = usePerformanceDashboardStats(user?.companyId ?? undefined);

  const recentStores = (stores ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="A quick overview of your organization's footprint."
        actions={
          <Button asChild>
            <Link to={ROUTES.storeNew}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Store
            </Link>
          </Button>
        }
      />

      {statsLoading ? (
        <LoadingCards />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Stores" value={stats?.totalStores ?? 0} icon={Store} isLoading={statsLoading} />
          <StatCard label="Total Employees" value={stats?.totalEmployees ?? 0} icon={Users} isLoading={statsLoading} />
          <StatCard label="Frontend Employees" value={stats?.frontendEmployees ?? 0} icon={ArrowUpRight} isLoading={statsLoading} />
          <StatCard label="Backend Employees" value={stats?.backendEmployees ?? 0} icon={ArrowDownRight} isLoading={statsLoading} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recently Created Stores</CardTitle>
          </CardHeader>
          <CardContent>
            {storesLoading ? (
              <LoadingState rows={4} />
            ) : recentStores.length === 0 ? (
              <EmptyState
                icon={Store}
                title="No stores yet"
                description="Create your first store and its organization structure will be provisioned automatically."
                action={
                  <Button asChild size="sm">
                    <Link to={ROUTES.storeNew}>Create a store</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                {recentStores.map((store) => (
                  <div key={store.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{store.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {store.code} · Created {formatDate(store.createdAt)}
                      </p>
                    </div>
                    <Badge variant={STATUS_VARIANT[store.status] ?? "secondary"} className="capitalize">
                      {store.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to={ROUTES.storeNew}>
                <PlusCircle className="mr-2 h-4 w-4" /> Create Store
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to={ROUTES.employeeImport}>
                <UploadCloud className="mr-2 h-4 w-4" /> Import Staff
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to={ROUTES.organization}>
                <Network className="mr-2 h-4 w-4" /> View Organization
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Employees</h2>

        {employeeStatsLoading ? (
          <LoadingCards count={2} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Active Employees"
              value={employeeStats?.activeEmployees ?? 0}
              icon={UserCheck}
              isLoading={employeeStatsLoading}
            />
            <StatCard
              label="Inactive Employees"
              value={employeeStats?.inactiveEmployees ?? 0}
              icon={UserMinus}
              isLoading={employeeStatsLoading}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Employees by Store</CardTitle>
            </CardHeader>
            <CardContent>
              {employeeStatsLoading ? (
                <LoadingState rows={3} />
              ) : !employeeStats || employeeStats.storeWise.length === 0 ? (
                <p className="text-sm text-muted-foreground">No employees yet.</p>
              ) : (
                <div className="space-y-2">
                  {employeeStats.storeWise.slice(0, 6).map((row) => (
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
              <CardTitle>Employees by Department</CardTitle>
            </CardHeader>
            <CardContent>
              {employeeStatsLoading ? (
                <LoadingState rows={3} />
              ) : !employeeStats || employeeStats.departmentWise.length === 0 ? (
                <p className="text-sm text-muted-foreground">No employees yet.</p>
              ) : (
                <div className="space-y-2">
                  {employeeStats.departmentWise.slice(0, 6).map((row) => (
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
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" /> Recently Joined
              </CardTitle>
            </CardHeader>
            <CardContent>
              {employeeStatsLoading ? (
                <LoadingState rows={3} />
              ) : !employeeStats || employeeStats.recentlyJoined.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent joiners.</p>
              ) : (
                <div className="space-y-3">
                  {employeeStats.recentlyJoined.map((emp) => (
                    <Link
                      key={emp.id}
                      to={`/employees/${emp.id}`}
                      className="block rounded-lg border p-2 text-sm hover:bg-accent"
                    >
                      <p className="font-medium">{emp.fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {emp.designationTitle ?? "—"} · {emp.storeName ?? "—"} · {formatDate(emp.joiningDate)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Roles</h2>

        {roleStatsLoading ? (
          <LoadingCards count={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Roles" value={roleStats?.totalRoles ?? 0} icon={ShieldCheck} isLoading={roleStatsLoading} />
            <StatCard label="Assigned Roles" value={roleStats?.assignedRoles ?? 0} icon={UserCheck} isLoading={roleStatsLoading} />
            <StatCard label="Unassigned Roles" value={roleStats?.unassignedRoles ?? 0} icon={ShieldOff} isLoading={roleStatsLoading} />
            <StatCard label="Temporary Roles" value={roleStats?.temporaryRoles ?? 0} icon={Clock} isLoading={roleStatsLoading} />
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-4 w-4" /> Permanent Roles
              </CardTitle>
            </CardHeader>
            <CardContent>
              {roleStatsLoading ? (
                <LoadingState rows={2} />
              ) : (
                <p className="text-2xl font-semibold">{roleStats?.permanentRoles ?? 0}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Currently active assignments marked Permanent.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Most Assigned Roles</CardTitle>
            </CardHeader>
            <CardContent>
              {roleStatsLoading ? (
                <LoadingState rows={3} />
              ) : !roleStats || roleStats.mostAssignedRoles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No roles assigned yet.</p>
              ) : (
                <div className="space-y-2">
                  {roleStats.mostAssignedRoles.map((row) => (
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

      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">KPI &amp; Performance</h2>

        {kpiStatsLoading ? (
          <LoadingCards count={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total KPI" value={kpiStats?.totalKpi ?? 0} icon={Target} isLoading={kpiStatsLoading} />
            <StatCard label="Mapped KPI" value={kpiStats?.mappedKpi ?? 0} icon={Network} isLoading={kpiStatsLoading} />
            <StatCard label="Pending KPI" value={kpiStats?.pendingKpi ?? 0} icon={Clock} isLoading={kpiStatsLoading} />
            <StatCard
              label="Performance Cycle"
              value={kpiStats?.activeCycleName ?? "None active"}
              icon={CalendarRange}
              isLoading={kpiStatsLoading}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top Performing Roles</CardTitle>
            </CardHeader>
            <CardContent>
              {kpiStatsLoading ? (
                <LoadingState rows={3} />
              ) : !kpiStats || kpiStats.topPerformingRoles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No results calculated yet.</p>
              ) : (
                <div className="space-y-2">
                  {kpiStats.topPerformingRoles.map((row) => (
                    <div key={row.roleId} className="flex items-center justify-between text-sm">
                      <span className="truncate">{row.roleName}</span>
                      <Badge variant="secondary">{row.averageScore.toFixed(1)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Performing KPI</CardTitle>
            </CardHeader>
            <CardContent>
              {kpiStatsLoading ? (
                <LoadingState rows={3} />
              ) : !kpiStats || kpiStats.topPerformingKpi.length === 0 ? (
                <p className="text-sm text-muted-foreground">No results calculated yet.</p>
              ) : (
                <div className="space-y-2">
                  {kpiStats.topPerformingKpi.map((row) => (
                    <div key={row.kpiId} className="flex items-center justify-between text-sm">
                      <span className="truncate">{row.kpiName}</span>
                      <Badge variant="secondary">{row.averageAchievement.toFixed(1)}%</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Tasks</h2>
          <Button variant="outline" size="sm" asChild>
            <Link to={ROUTES.taskDashboard}>View Task Dashboard</Link>
          </Button>
        </div>

        {taskStatsLoading ? (
          <LoadingCards count={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Today's Tasks" value={taskStats?.todayTasks ?? 0} icon={CalendarClock} isLoading={taskStatsLoading} />
            <StatCard label="Pending Tasks" value={taskStats?.pendingTasks ?? 0} icon={Clock} isLoading={taskStatsLoading} />
            <StatCard label="Completed Tasks" value={taskStats?.completedTasks ?? 0} icon={ListChecks} isLoading={taskStatsLoading} />
            <StatCard label="Overdue Tasks" value={taskStats?.overdueTasks ?? 0} icon={AlertTriangle} isLoading={taskStatsLoading} />
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Performance Data</h2>
          <Button variant="outline" size="sm" asChild>
            <Link to={ROUTES.performanceDashboard}>View Performance Dashboard</Link>
          </Button>
        </div>

        {performanceStatsLoading ? (
          <LoadingCards count={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Today's Entries"
              value={performanceStats?.todaysEntries ?? 0}
              icon={CalendarClock}
              isLoading={performanceStatsLoading}
            />
            <StatCard
              label="Pending Entries"
              value={performanceStats?.pendingEntries ?? 0}
              icon={Activity}
              isLoading={performanceStatsLoading}
            />
            <StatCard
              label="Approved Entries"
              value={performanceStats?.approvedEntries ?? 0}
              icon={CheckCircle2}
              isLoading={performanceStatsLoading}
            />
            <StatCard
              label="Rejected Entries"
              value={performanceStats?.rejectedEntries ?? 0}
              icon={XCircle}
              isLoading={performanceStatsLoading}
            />
          </div>
        )}
      </div>
    </div>
  );
}
