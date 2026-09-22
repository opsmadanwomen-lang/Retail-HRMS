import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronRight, Moon, XCircle } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import { useAmISuperManager, useMyNightDutyHistory, useMyOperationsManagerStores } from "@/hooks/useExtendedAttendanceRules";
import { formatDateTime } from "@/modules/attendance/utils";
import { formatDate } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";
import type { MyNightDutyRow } from "@/types/attendanceRules";

const PENDING = new Set(["pending", "pending_om", "pending_super_manager"]);
const APPROVED = new Set(["approved", "om_approved", "super_manager_approved"]);
const DISALLOWED = new Set(["disallowed", "om_disallowed", "super_manager_disallowed"]);

/** Existing Night Duty terminology (unchanged from the previous card view). */
function statusLabel(status: string): string {
  switch (status) {
    case "pending":
    case "pending_om":
      return "Pending with Operations Manager";
    case "pending_super_manager":
      return "Pending with Super Manager";
    case "approved":
    case "om_approved":
      return "Approved by Operations Manager";
    case "super_manager_approved":
      return "Approved by Super Manager";
    case "disallowed":
    case "om_disallowed":
      return "Disallowed by Operations Manager";
    case "super_manager_disallowed":
      return "Disallowed by Super Manager";
    default:
      return status;
  }
}

function NightDutyStatusBadge({ status }: { status: string }) {
  const variant = APPROVED.has(status) ? "success" : DISALLOWED.has(status) ? "destructive" : "warning";
  return <Badge variant={variant}>{statusLabel(status)}</Badge>;
}

function approvalStage(status: string): string {
  if (status === "pending" || status === "pending_om") return "Pending with Operations Manager";
  if (status === "pending_super_manager") return "Pending with Super Manager";
  return "Completed";
}

function payrollLabel(status: string): string {
  if (APPROVED.has(status)) return "Included / Payable";
  if (DISALLOWED.has(status)) return "Based on Confirmed Out Time";
  return "Not yet payable";
}

/**
 * Staff Panel — Approvals → Night Duty Approval.
 *
 * Mirrors the Leave Approval page: role‑based, dual purpose.
 *   • Every employee sees "My Night Duty" — their OWN requests, in Pending / Approved / Disallowed
 *     tabs with dynamic counts. Records stay visible after a decision. Strictly self‑scoped by
 *     attendance_night_duty_list_mine() (current_user_employee_id() server‑side; no client id).
 *     No Approve/Reject controls here.
 *   • An Operations Manager / Super Manager also gets a card linking to their full approval queue
 *     (kept on its own route, /attendance/night-duty-approvals — the OM → Super Manager workflow,
 *     Approve / Disallow / Carry Forward / Confirm Payable Out Time, is completely unchanged).
 * No Night Duty calculation, threshold, payable rule or decide RPC is touched.
 */
export function StaffNightDutyApprovalPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const myEmployeeId = currentEmployeeQuery.data?.id;

  const omStoresQuery = useMyOperationsManagerStores(myEmployeeId);
  const amISuperManagerQuery = useAmISuperManager(myEmployeeId);
  const isApprover = (omStoresQuery.data?.length ?? 0) > 0 || amISuperManagerQuery.data === true;

  const historyQuery = useMyNightDutyHistory();
  const rows = historyQuery.data ?? [];

  const pending = useMemo(() => rows.filter((r) => PENDING.has(r.approvalStatus)), [rows]);
  const approved = useMemo(() => rows.filter((r) => APPROVED.has(r.approvalStatus)), [rows]);
  const disallowed = useMemo(() => rows.filter((r) => DISALLOWED.has(r.approvalStatus)), [rows]);

  const [activeTab, setActiveTab] = useState("pending");

  if (currentEmployeeQuery.isLoading) return <LoadingState />;

  if (!myEmployeeId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Night Duty Approval" description="Track the approval status and history of your Night Duty requests." />
        <EmptyState icon={Moon} title="No Night Duty records" description="Your login is not linked to an employee record, so there is nothing to show here." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Night Duty Approval" description="Track the approval status and history of your Night Duty requests." />

      {isApprover && (
        <Card className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => navigate(ROUTES.nightDutyApprovals)}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Night Duty Approvals queue</p>
              <p className="text-xs text-muted-foreground">
                You review Night Duty requests as an Operations Manager / Super Manager — open your approval queue and decision history.
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="disallowed">Disallowed ({disallowed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <NightDutyHistoryTable loading={historyQuery.isLoading} rows={pending} variant="pending"
            emptyTitle="No pending Night Duty requests." emptyDescription="Night Duty requests awaiting a decision will appear here." />
        </TabsContent>
        <TabsContent value="approved">
          <NightDutyHistoryTable loading={historyQuery.isLoading} rows={approved} variant="approved"
            emptyTitle="No approved Night Duty records." emptyDescription="Your approved Night Duty requests will appear here." />
        </TabsContent>
        <TabsContent value="disallowed">
          <NightDutyHistoryTable loading={historyQuery.isLoading} rows={disallowed} variant="disallowed"
            emptyTitle="No disallowed Night Duty records." emptyDescription="Your disallowed Night Duty requests will appear here." />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NightDutyHistoryTable({
  loading,
  rows,
  variant,
  emptyTitle,
  emptyDescription,
}: {
  loading: boolean;
  rows: MyNightDutyRow[];
  variant: "pending" | "approved" | "disallowed";
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        {loading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={variant === "disallowed" ? XCircle : variant === "approved" ? CheckCircle2 : Moon} title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Night Duty Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Actual Punch Out</TableHead>
                  <TableHead>Extra Duty</TableHead>
                  <TableHead>Payable</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Approval Stage</TableHead>
                  {variant !== "pending" && <TableHead>{variant === "approved" ? "Approved By" : "Disallowed By"}</TableHead>}
                  {variant !== "pending" && <TableHead>Decision Date</TableHead>}
                  {variant === "disallowed" && <TableHead>Confirmed Payable Out</TableHead>}
                  <TableHead>Remark</TableHead>
                  <TableHead>Payroll</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{formatDate(r.attendanceDate)}</TableCell>
                    <TableCell className="text-xs">{r.employeeName}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(r.actualPunchOutAt)}</TableCell>
                    <TableCell className="text-xs">
                      {r.extraDutyValue} Day{r.extraDutyValue === 1 ? "" : "s"} + {r.nightOtMinutes} min
                    </TableCell>
                    <TableCell className="text-xs">
                      {(r.payableExtraDutyValue ?? r.extraDutyValue)} Day{(r.payableExtraDutyValue ?? r.extraDutyValue) === 1 ? "" : "s"} + {r.payableOvertimeMinutes ?? r.nightOtMinutes} min
                    </TableCell>
                    <TableCell><NightDutyStatusBadge status={r.approvalStatus} /></TableCell>
                    <TableCell className="text-xs">{approvalStage(r.approvalStatus)}</TableCell>
                    {variant !== "pending" && <TableCell className="text-xs">{r.decidedByName ?? "—"}{r.decidedStage ? ` (${r.decidedStage})` : ""}</TableCell>}
                    {variant !== "pending" && <TableCell className="text-xs text-muted-foreground">{r.decidedAt ? formatDate(r.decidedAt) : "—"}</TableCell>}
                    {variant === "disallowed" && (
                      <TableCell className="text-xs text-muted-foreground">{r.managerConfirmedPayableOutAt ? formatDateTime(r.managerConfirmedPayableOutAt) : "—"}</TableCell>
                    )}
                    <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground" title={r.decidedRemark ?? undefined}>{r.decidedRemark ?? "—"}</TableCell>
                    <TableCell className="text-xs">{payrollLabel(r.approvalStatus)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
