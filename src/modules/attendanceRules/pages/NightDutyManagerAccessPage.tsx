import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Store as StoreIcon, UserCog } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useEmployees } from "@/hooks/useEmployees";
import { useStores } from "@/hooks/useStores";
import { supabase } from "@/lib/supabaseClient";
import {
  useAssignOperationsManager,
  useDesignateSuperManager,
  useOperationsManagerAssignments,
  useSetOperationsManagerActive,
  useSetSuperManagerActive,
  useSuperManagers,
} from "@/hooks/useExtendedAttendanceRules";

/**
 * Batched login-status lookup (Active / Disabled / No Login) for a set of employees, so this page
 * fires one query instead of one per row. Login accounts themselves are NOT created here — they
 * are created/reset/disabled from the Employee Profile page (EmployeeLoginAccountCard), which
 * already provisions an individual Supabase Auth user + profile row per employee via the
 * `staff-account` Edge Function. This page only links "Manage Login" to that existing flow, per the
 * explicit instruction to reuse the existing system rather than duplicate it.
 */
function useLoginStatuses(authUserIds: string[]) {
  const key = authUserIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["login-statuses", key],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, is_active").in("id", authUserIds);
      if (error) throw error;
      return new Map((data ?? []).map((p: any) => [p.id as string, Boolean(p.is_active)]));
    },
    enabled: authUserIds.length > 0,
  });
}

function LoginStatusBadge({ authUserId, statuses, loading }: { authUserId: string | null; statuses: Map<string, boolean> | undefined; loading: boolean }) {
  if (!authUserId) return <Badge variant="secondary">No Login</Badge>;
  if (loading) return <Badge variant="outline">…</Badge>;
  const active = statuses?.get(authUserId);
  return active ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">Disabled</Badge>;
}

/**
 * Super Admin manages WHO is an Operations Manager (per store) or a Super Manager (company-wide)
 * for the Night Duty approval hierarchy. Each manager's actual login is the same individual Staff
 * account used everywhere else in the app (Employee Profile -> Login Account) — there is no
 * separate/shared credential here. Their capability comes purely from an active row in
 * attendance_operations_manager_assignments / attendance_super_managers, checked server-side inside
 * attendance_night_duty_om_decide / attendance_night_duty_super_manager_decide.
 */
export function NightDutyManagerAccessPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const companyId = user?.companyId ?? undefined;

  const employeesQuery = useEmployees({ companyId, status: "active" });
  const storesQuery = useStores(companyId);
  const omAssignmentsQuery = useOperationsManagerAssignments(companyId);
  const superManagersQuery = useSuperManagers(companyId);

  const employees = employeesQuery.data ?? [];
  const employeeMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const authUserIds = useMemo(() => employees.map((e) => e.authUserId).filter((x): x is string => Boolean(x)), [employees]);
  const loginStatusesQuery = useLoginStatuses(authUserIds);

  const assignOm = useAssignOperationsManager();
  const setOmActive = useSetOperationsManagerActive();
  const designateSm = useDesignateSuperManager();
  const setSmActive = useSetSuperManagerActive();

  const [omEmployeeId, setOmEmployeeId] = useState<string>("");
  const [omStoreId, setOmStoreId] = useState<string>("");
  const [omRemark, setOmRemark] = useState("");

  const [smEmployeeId, setSmEmployeeId] = useState<string>("");
  const [smRemark, setSmRemark] = useState("");

  if (!isSuperAdmin) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Super Admin access required"
        description="Only Super Admin can assign Operations Managers or designate Super Managers."
      />
    );
  }

  const handleAssignOm = async () => {
    if (!companyId || !omEmployeeId || !omStoreId) {
      toast({ title: "Select an employee and a store.", variant: "destructive" });
      return;
    }
    try {
      await assignOm.mutateAsync({ companyId, employeeId: omEmployeeId, storeId: omStoreId, remark: omRemark || undefined, userId: user?.id });
      toast({ title: "Operations Manager assigned.", variant: "success" });
      setOmEmployeeId("");
      setOmStoreId("");
      setOmRemark("");
    } catch (error) {
      toast({ title: "Could not assign", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleDesignateSm = async () => {
    if (!companyId || !smEmployeeId) {
      toast({ title: "Select an employee.", variant: "destructive" });
      return;
    }
    try {
      await designateSm.mutateAsync({ companyId, employeeId: smEmployeeId, remark: smRemark || undefined, userId: user?.id });
      toast({ title: "Super Manager designated.", variant: "success" });
      setSmEmployeeId("");
      setSmRemark("");
    } catch (error) {
      toast({ title: "Could not designate", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Night Duty Manager Access"
        description="Assign Operations Managers to stores and designate Super Managers. Each manager needs their own individual login — use Manage Login to create or reset it (never a shared username/password)."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4" /> Operations Managers (by store)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={omEmployeeId} onValueChange={setOmEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.fullName} ({e.employeeCode ?? "—"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Store</Label>
              <Select value={omStoreId} onValueChange={setOmStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {(storesQuery.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Remark (optional)</Label>
              <Input value={omRemark} onChange={(e) => setOmRemark(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={handleAssignOm} disabled={assignOm.isPending}>
                {assignOm.isPending ? "Assigning…" : "Assign"}
              </Button>
            </div>
          </div>

          {omAssignmentsQuery.isLoading ? (
            <LoadingState />
          ) : (omAssignmentsQuery.data ?? []).length === 0 ? (
            <EmptyState icon={StoreIcon} title="No Operations Managers assigned yet" description="Assign an employee to a store above." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Login</TableHead>
                    <TableHead>Assignment Status</TableHead>
                    <TableHead>Remark</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(omAssignmentsQuery.data ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">
                        {a.employeeName ?? "—"} <span className="text-muted-foreground">({a.employeeCode ?? "—"})</span>
                      </TableCell>
                      <TableCell>{a.storeName ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <LoginStatusBadge
                            authUserId={employeeMap.get(a.employeeId)?.authUserId ?? null}
                            statuses={loginStatusesQuery.data}
                            loading={loginStatusesQuery.isLoading}
                          />
                          <Link to={`/employees/${a.employeeId}`} className="text-xs text-primary underline">
                            Manage Login
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.isActive ? "default" : "secondary"}>{a.isActive ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.remark ?? "—"}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant={a.isActive ? "destructive" : "outline"}
                          onClick={() => setOmActive.mutate({ id: a.id, isActive: !a.isActive, userId: user?.id })}
                          disabled={setOmActive.isPending}
                        >
                          {a.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Super Managers (company-wide)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={smEmployeeId} onValueChange={setSmEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.fullName} ({e.employeeCode ?? "—"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Remark (optional)</Label>
              <Input value={smRemark} onChange={(e) => setSmRemark(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={handleDesignateSm} disabled={designateSm.isPending}>
                {designateSm.isPending ? "Designating…" : "Designate"}
              </Button>
            </div>
          </div>

          {superManagersQuery.isLoading ? (
            <LoadingState />
          ) : (superManagersQuery.data ?? []).length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No Super Managers designated yet" description="Designate an employee above." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Login</TableHead>
                    <TableHead>Assignment Status</TableHead>
                    <TableHead>Remark</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(superManagersQuery.data ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {s.employeeName ?? "—"} <span className="text-muted-foreground">({s.employeeCode ?? "—"})</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">Company-wide</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <LoginStatusBadge
                            authUserId={employeeMap.get(s.employeeId)?.authUserId ?? null}
                            statuses={loginStatusesQuery.data}
                            loading={loginStatusesQuery.isLoading}
                          />
                          <Link to={`/employees/${s.employeeId}`} className="text-xs text-primary underline">
                            Manage Login
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.isActive ? "default" : "secondary"}>{s.isActive ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.remark ?? "—"}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant={s.isActive ? "destructive" : "outline"}
                          onClick={() => setSmActive.mutate({ id: s.id, isActive: !s.isActive, userId: user?.id })}
                          disabled={setSmActive.isPending}
                        >
                          {s.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
