import { useNavigate } from "react-router-dom";
import { Moon, CalendarClock, Banknote, ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import { useMyNightDutyApprovals, useAmISuperManager } from "@/hooks/useExtendedAttendanceRules";
import { useAmILeaveManager, useManagerPendingLeaveApplications, useSuperManagerPendingLeaveApplications } from "@/hooks/useLeave";
import { useAmIAdvanceManager, useAmIAdvanceBoss, useAmIAdvanceHr, useAmIAdvanceFinance, useAdvanceManagerPending, useAdvanceBossPending, useAdvanceHrPending, useAdvanceFinancePending } from "@/hooks/useAdvance";
import { collapseNightDutyStatus } from "@/modules/attendance/utils";
import { ROUTES } from "@/constants/routes";

/**
 * Staff Panel — Approvals (landing page). Night Duty Approval tracks the status of the CALLER's OWN
 * submitted requests (pending count reads the SAME useMyNightDutyApprovals() data that page uses).
 * Leave Approvals is a DIFFERENT kind of entry — it is the Direct Manager / Super Manager decide
 * inbox (leave_list_manager_pending()/leave_list_super_manager_pending(), the same queues
 * ROUTES.leaveApprovals itself renders) — its count is never combined with the Night Duty count
 * above, and never combined with each other, so no single number ever conflates two different
 * approval categories. Shown unconditionally, same as the Night Duty card, since either card's own
 * destination page role-detects and explains a lack of access — this landing page does not need to
 * duplicate that check.
 */
export function StaffApprovalsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const employeeId = currentEmployeeQuery.data?.id;
  const nightDutyQuery = useMyNightDutyApprovals(employeeId);
  const pendingCount = (nightDutyQuery.data ?? []).filter((a) => collapseNightDutyStatus(a.approvalStatus) === "pending").length;

  const isLeaveManagerQuery = useAmILeaveManager(employeeId);
  const isSuperManagerQuery = useAmISuperManager(employeeId);
  const managerQueueQuery = useManagerPendingLeaveApplications();
  const superManagerQueueQuery = useSuperManagerPendingLeaveApplications();
  const leavePendingCount = (isLeaveManagerQuery.data ? (managerQueueQuery.data ?? []).length : 0) + (isSuperManagerQuery.data ? (superManagerQueueQuery.data ?? []).length : 0);

  const isAdvanceManagerQuery = useAmIAdvanceManager(employeeId);
  const isAdvanceBossQuery = useAmIAdvanceBoss(employeeId);
  const advanceManagerQueueQuery = useAdvanceManagerPending();
  const advanceBossQueueQuery = useAdvanceBossPending();
  const advancePendingCount =
    (isAdvanceManagerQuery.data ? (advanceManagerQueueQuery.data ?? []).length : 0) +
    (isAdvanceBossQuery.data ? (advanceBossQueueQuery.data ?? []).length : 0);
  const isAdvanceApprover = isAdvanceManagerQuery.data === true || isAdvanceBossQuery.data === true;

  const isAdvanceHrQuery = useAmIAdvanceHr(employeeId);
  const isAdvanceHr = isAdvanceHrQuery.data === true;
  const advanceHrPendingQuery = useAdvanceHrPending(isAdvanceHr);
  const advanceHrPendingCount = isAdvanceHr ? (advanceHrPendingQuery.data ?? []).length : 0;

  const isAdvanceFinanceQuery = useAmIAdvanceFinance(employeeId);
  const isAdvanceFinance = isAdvanceFinanceQuery.data === true;
  const advanceFinancePendingQuery = useAdvanceFinancePending(isAdvanceFinance);
  const advanceFinancePendingCount = isAdvanceFinance ? (advanceFinancePendingQuery.data ?? []).length : 0;

  // Combined badge for the ONE consolidated "Advance" card (Approvals -> Advance) — sums every
  // stage the current user is actually authorized to act on, reusing the exact same counts above.
  const advanceWorkflowPendingCount = advancePendingCount + advanceHrPendingCount + advanceFinancePendingCount;

  return (
    <div className="space-y-6">
      <PageHeader title="Approvals" description="Track the status of your submitted requests, or review requests awaiting your decision." />

      <Card className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => navigate(ROUTES.nightDutyStaffApproval)}>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Moon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Night Duty Approval</p>
              <p className="text-xs text-muted-foreground">
                {pendingCount > 0 ? `${pendingCount} request(s) pending review` : "View your Night Duty request history and status"}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>

      <Card className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => navigate(ROUTES.leaveApprovals)}>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <CalendarClock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Leave Approval</p>
              <p className="text-xs text-muted-foreground">
                {leavePendingCount > 0
                  ? `${leavePendingCount} leave request(s) pending your review`
                  : isLeaveManagerQuery.data || isSuperManagerQuery.data
                  ? "Review leave requests awaiting your decision, and your approval history"
                  : "Track the approval status and history of your own leave applications"}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>

      <Card className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => navigate(ROUTES.advanceWorkflow)}>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Banknote className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Advance</p>
              <p className="text-xs text-muted-foreground">
                {advanceWorkflowPendingCount > 0
                  ? `${advanceWorkflowPendingCount} advance request(s) need attention`
                  : isAdvanceApprover || isAdvanceHr || isAdvanceFinance
                  ? "Boss approval, HR processing, payment, receipt and recovery — the complete Advance lifecycle in one place"
                  : "Track the approval status and history of your own advance requests"}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  );
}
