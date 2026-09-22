import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, ShieldAlert, ChevronRight, History, Undo2 } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import {
  useAmIAdvanceManager,
  useAmIAdvanceBoss,
  useAdvanceManagerPending,
  useAdvanceBossPending,
  useAdvanceMyDecisions,
  useAdvanceManagerDecide,
  useAdvanceBossDecide,
  useMyAdvanceRequests,
} from "@/hooks/useAdvance";
import { formatDate } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";
import {
  formatAmount,
  formatDateTime,
  ADVANCE_STATUS_LABEL,
  ADVANCE_STATUS_VARIANT,
  advanceStageLabel,
  actionLabel,
  roleLabel,
} from "@/modules/advance/utils";
import type { AdvanceBossPendingRow, AdvanceManagerPendingRow, AdvanceMyDecisionRow } from "@/types/advance";

type Decision = "approved" | "rejected" | "sent_back";

/**
 * Advance Approval — role-detected, mirrors LeaveApprovalsPage:
 *   • Reporting Manager  -> Step 1 decide inbox (approve / recommend amount / reject / send back)
 *   • Final Approver (Boss) -> Step 2 decide inbox, incl. Modify & Approve (requested_amount is
 *     never overwritten; boss_approved_amount is a separate value; a modification reason is
 *     mandatory when the policy requires it — enforced server-side by advance_boss_decide()).
 *   • Everyone            -> their own decision history / (for plain staff) their own requests.
 * Every rule is re-checked in the SECURITY DEFINER RPC regardless of what this page renders.
 */
export function AdvanceApprovalsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const myEmployeeId = currentEmployeeQuery.data?.id;
  const isSuperAdmin = user?.role === "super_admin";

  const amIManagerQuery = useAmIAdvanceManager(myEmployeeId);
  const amIBossQuery = useAmIAdvanceBoss(myEmployeeId);
  const isManager = amIManagerQuery.data === true;
  const isBoss = amIBossQuery.data === true;
  const isApprover = isManager || isBoss;

  if (currentEmployeeQuery.isLoading || amIManagerQuery.isLoading || amIBossQuery.isLoading) {
    return <LoadingState />;
  }

  if (isApprover || isSuperAdmin) {
    return <ApproverView isManager={isManager} isBoss={isBoss} />;
  }
  if (myEmployeeId) {
    return <StaffSelfView />;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Advance Approval" description="Review advance requests awaiting your decision." />
      <EmptyState icon={ShieldAlert} title="No advance records" description="Your login is not linked to an employee record." />
      <Card className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => navigate(ROUTES.myAdvances)}>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm">Go to My Advances</p>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// Approver view
// ===========================================================================
function ApproverView({ isManager, isBoss }: { isManager: boolean; isBoss: boolean }) {
  const managerQueue = useAdvanceManagerPending();
  const bossQueue = useAdvanceBossPending();
  const decisionsQuery = useAdvanceMyDecisions();

  const managerDecide = useAdvanceManagerDecide();
  const bossDecide = useAdvanceBossDecide();

  const [mgrTarget, setMgrTarget] = useState<AdvanceManagerPendingRow | null>(null);
  const [mgrAction, setMgrAction] = useState<Decision | null>(null);
  const [mgrRecommended, setMgrRecommended] = useState("");
  const [mgrRecommendedInstallments, setMgrRecommendedInstallments] = useState("");
  const [mgrRemark, setMgrRemark] = useState("");

  const [bossTarget, setBossTarget] = useState<AdvanceBossPendingRow | null>(null);
  const [bossAction, setBossAction] = useState<Decision | null>(null);
  const [bossApproved, setBossApproved] = useState("");
  const [bossInstallments, setBossInstallments] = useState("");
  const [bossModReason, setBossModReason] = useState("");
  const [bossRemark, setBossRemark] = useState("");

  const managerRows = managerQueue.data ?? [];
  const bossRows = bossQueue.data ?? [];
  const decisions = decisionsQuery.data ?? [];

  const defaultTab = isManager ? "manager" : isBoss ? "boss" : "history";
  const [activeTab, setActiveTab] = useState(defaultTab);

  // ---- manager dialog ----
  const openMgr = (row: AdvanceManagerPendingRow, action: Decision) => {
    setMgrTarget(row);
    setMgrAction(action);
    setMgrRecommended("");
    setMgrRecommendedInstallments("");
    setMgrRemark("");
  };
  const submitMgr = async () => {
    if (!mgrTarget || !mgrAction) return;
    if ((mgrAction === "rejected" || mgrAction === "sent_back") && !mgrRemark.trim()) {
      toast({ title: "A remark is required to reject or send back.", variant: "destructive" });
      return;
    }
    const recommended = mgrRecommended.trim() ? Number(mgrRecommended) : undefined;
    if (recommended !== undefined && (!Number.isFinite(recommended) || recommended <= 0 || recommended > mgrTarget.requestedAmount)) {
      toast({ title: `Recommended amount must be between ₹1 and ${formatAmount(mgrTarget.requestedAmount)}.`, variant: "destructive" });
      return;
    }
    const recommendedInstallments = mgrRecommendedInstallments.trim() ? Number(mgrRecommendedInstallments) : undefined;
    if (recommendedInstallments !== undefined && (!Number.isInteger(recommendedInstallments) || recommendedInstallments < 1)) {
      toast({ title: "Recommended installments must be a whole number of at least 1.", variant: "destructive" });
      return;
    }
    try {
      await managerDecide.mutateAsync({
        requestId: mgrTarget.id,
        decision: mgrAction,
        recommendedAmount: mgrAction === "approved" ? recommended : undefined,
        recommendedInstallmentCount: mgrAction === "approved" ? recommendedInstallments : undefined,
        remark: mgrRemark.trim() || undefined,
      });
      toast({
        title:
          mgrAction === "approved"
            ? "Approved and forwarded for final approval."
            : mgrAction === "rejected"
            ? "Request rejected."
            : "Request sent back to the employee.",
        variant: "success",
      });
      setMgrTarget(null);
      setMgrAction(null);
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  // ---- boss dialog ----
  const openBoss = (row: AdvanceBossPendingRow, action: Decision) => {
    setBossTarget(row);
    setBossAction(action);
    setBossApproved(String(row.managerRecommendedAmount ?? row.requestedAmount));
    setBossInstallments(String(row.managerRecommendedInstallmentCount ?? row.requestedInstallmentCount ?? 1));
    setBossModReason("");
    setBossRemark("");
  };
  const bossApprovedNum = Number(bossApproved);
  const bossInstallmentsNum = Number(bossInstallments);
  const bossAmountChanged = Boolean(bossTarget) && Number.isFinite(bossApprovedNum) && bossApprovedNum !== bossTarget!.requestedAmount;
  const bossInstallmentsChanged =
    Boolean(bossTarget) && Number.isFinite(bossInstallmentsNum) && bossInstallmentsNum !== (bossTarget!.requestedInstallmentCount ?? bossInstallmentsNum);
  const bossTermsChanged = bossAmountChanged || bossInstallmentsChanged;
  const submitBoss = async () => {
    if (!bossTarget || !bossAction) return;
    if ((bossAction === "rejected" || bossAction === "sent_back") && !bossRemark.trim()) {
      toast({ title: "A remark is required to reject or send back.", variant: "destructive" });
      return;
    }
    if (bossAction === "approved") {
      if (!Number.isFinite(bossApprovedNum) || bossApprovedNum <= 0) {
        toast({ title: "Enter a valid approved amount.", variant: "destructive" });
        return;
      }
      if (!Number.isInteger(bossInstallmentsNum) || bossInstallmentsNum < 1) {
        toast({ title: "Final installment count must be a whole number of at least 1.", variant: "destructive" });
        return;
      }
      if (bossTermsChanged && !bossModReason.trim()) {
        toast({ title: "A modification reason is required when changing the approved amount or installment count.", variant: "destructive" });
        return;
      }
    }
    try {
      await bossDecide.mutateAsync({
        requestId: bossTarget.id,
        decision: bossAction,
        approvedAmount: bossAction === "approved" ? bossApprovedNum : undefined,
        finalInstallmentCount: bossAction === "approved" ? bossInstallmentsNum : undefined,
        modificationReason: bossAction === "approved" && bossTermsChanged ? bossModReason.trim() : undefined,
        remark: bossRemark.trim() || undefined,
      });
      toast({
        title:
          bossAction === "approved"
            ? bossAmountChanged
              ? "Modified and approved."
              : "Advance approved."
            : bossAction === "rejected"
            ? "Request rejected."
            : "Request sent back.",
        variant: "success",
      });
      setBossTarget(null);
      setBossAction(null);
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advance Approval"
        description="Reporting Manager reviews first (Step 1); the Final Approver (Boss) decides (Step 2). HR is not an approval level."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {isManager && <TabsTrigger value="manager">Reporting Manager ({managerRows.length})</TabsTrigger>}
          {isBoss && <TabsTrigger value="boss">Final Approval ({bossRows.length})</TabsTrigger>}
          <TabsTrigger value="history">My Decision History ({decisions.length})</TabsTrigger>
        </TabsList>

        {/* ---------------- Manager queue ---------------- */}
        {isManager && (
          <TabsContent value="manager">
            <Card>
              <CardContent className="pt-6">
                {managerQueue.isLoading ? (
                  <LoadingState />
                ) : managerRows.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="No advance requests awaiting your review." />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Requested</TableHead>
                          <TableHead>Installments</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Requested On</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {managerRows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium">
                              {row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span>
                            </TableCell>
                            <TableCell>{row.advanceTypeName}</TableCell>
                            <TableCell>{formatAmount(row.requestedAmount)}</TableCell>
                            <TableCell className="text-xs">{row.requestedInstallmentCount ?? "—"}</TableCell>
                            <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground" title={row.reason}>{row.reason}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatDate(row.requestedAt)}</TableCell>
                            <TableCell className="text-xs">Step 1 of 2 — Reporting Manager</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" onClick={() => openMgr(row, "approved")}>
                                  <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => openMgr(row, "sent_back")}>
                                  <Undo2 className="mr-1 h-4 w-4" /> Send Back
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => openMgr(row, "rejected")}>
                                  <XCircle className="mr-1 h-4 w-4" /> Reject
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ---------------- Boss queue ---------------- */}
        {isBoss && (
          <TabsContent value="boss">
            <Card>
              <CardContent className="pt-6">
                {bossQueue.isLoading ? (
                  <LoadingState />
                ) : bossRows.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="No advance requests awaiting final approval." />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Requested</TableHead>
                          <TableHead>Mgr Recommended</TableHead>
                          <TableHead>Employee Installments</TableHead>
                          <TableHead>Mgr Installments</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Requested On</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bossRows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium">
                              {row.employeeName} <span className="text-xs text-muted-foreground">({row.employeeCode ?? "—"})</span>
                            </TableCell>
                            <TableCell>{row.advanceTypeName}</TableCell>
                            <TableCell>{formatAmount(row.requestedAmount)}</TableCell>
                            <TableCell className="text-xs">{formatAmount(row.managerRecommendedAmount)}</TableCell>
                            <TableCell className="text-xs">{row.requestedInstallmentCount ?? "—"}</TableCell>
                            <TableCell className="text-xs">{row.managerRecommendedInstallmentCount ?? "—"}</TableCell>
                            <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground" title={row.reason}>{row.reason}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatDate(row.requestedAt)}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" onClick={() => openBoss(row, "approved")}>
                                  <CheckCircle2 className="mr-1 h-4 w-4" /> Approve / Modify
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => openBoss(row, "sent_back")}>
                                  <Undo2 className="mr-1 h-4 w-4" /> Send Back
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => openBoss(row, "rejected")}>
                                  <XCircle className="mr-1 h-4 w-4" /> Reject
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ---------------- Decision history ---------------- */}
        <TabsContent value="history">
          <Card>
            <CardContent className="pt-6">
              {decisionsQuery.isLoading ? (
                <LoadingState />
              ) : decisions.length === 0 ? (
                <EmptyState icon={History} title="No decisions yet." description="Advances you approve, reject or send back appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Requested</TableHead>
                        <TableHead>Mgr Recommended</TableHead>
                        <TableHead>Boss Approved</TableHead>
                        <TableHead>My Role</TableHead>
                        <TableHead>My Action</TableHead>
                        <TableHead>Decided On</TableHead>
                        <TableHead>My Remark</TableHead>
                        <TableHead>Current Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {decisions.map((d: AdvanceMyDecisionRow) => (
                        <TableRow key={`${d.advanceRequestId}-${d.actedAt}`}>
                          <TableCell className="font-medium">
                            {d.employeeName} <span className="text-xs text-muted-foreground">({d.employeeCode ?? "—"})</span>
                          </TableCell>
                          <TableCell>{d.advanceTypeName}</TableCell>
                          <TableCell>{formatAmount(d.requestedAmount)}</TableCell>
                          <TableCell className="text-xs">{formatAmount(d.managerRecommendedAmount)}</TableCell>
                          <TableCell className="text-xs">{formatAmount(d.bossApprovedAmount)}</TableCell>
                          <TableCell className="text-xs">{roleLabel(d.myRole)}</TableCell>
                          <TableCell className="text-xs">{actionLabel(d.myAction)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDateTime(d.actedAt)}</TableCell>
                          <TableCell className="max-w-[16rem] truncate text-xs" title={d.myRemark ?? undefined}>{d.myRemark ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={ADVANCE_STATUS_VARIANT[d.status]}>{ADVANCE_STATUS_LABEL[d.status]}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---------------- Manager decision dialog ---------------- */}
      <Dialog open={Boolean(mgrTarget && mgrAction)} onOpenChange={(open) => !open && (setMgrTarget(null), setMgrAction(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mgrAction === "approved" ? "Approve & Forward" : mgrAction === "sent_back" ? "Send Back to Employee" : "Reject Advance Request"}
            </DialogTitle>
            <DialogDescription>
              {mgrTarget
                ? `${mgrTarget.employeeName} — ${mgrTarget.advanceTypeName} — requested ${formatAmount(mgrTarget.requestedAmount)} in ${
                    mgrTarget.requestedInstallmentCount ?? "—"
                  } installment(s).`
                : ""}
              {mgrAction === "approved" ? " Approving forwards this to the Final Approver (Boss) — it is not the final decision." : ""}
            </DialogDescription>
          </DialogHeader>
          {mgrAction === "approved" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Recommended Amount (₹, optional — cannot exceed the requested amount)</Label>
                <Input
                  type="number"
                  min={1}
                  value={mgrRecommended}
                  onChange={(e) => setMgrRecommended(e.target.value)}
                  placeholder={`Defaults to ${formatAmount(mgrTarget?.requestedAmount ?? null)}`}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Recommended Installments (optional)</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={mgrRecommendedInstallments}
                  onChange={(e) => setMgrRecommendedInstallments(e.target.value)}
                  placeholder={`Employee requested ${mgrTarget?.requestedInstallmentCount ?? "—"}`}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                The employee's requested amount and installment count are never changed — these are only your recommendations to the Boss, who
                makes the final decision on both.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Remark {mgrAction === "approved" ? "(optional)" : "(required)"}</Label>
            <Textarea value={mgrRemark} onChange={(e) => setMgrRemark(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => (setMgrTarget(null), setMgrAction(null))} disabled={managerDecide.isPending}>
              Cancel
            </Button>
            <Button
              variant={mgrAction === "rejected" ? "destructive" : "default"}
              onClick={submitMgr}
              disabled={managerDecide.isPending}
            >
              {managerDecide.isPending ? "Saving…" : mgrAction === "approved" ? "Approve & Forward" : mgrAction === "sent_back" ? "Send Back" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Boss decision dialog ---------------- */}
      <Dialog open={Boolean(bossTarget && bossAction)} onOpenChange={(open) => !open && (setBossTarget(null), setBossAction(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bossAction === "approved" ? "Final Approval" : bossAction === "sent_back" ? "Send Back" : "Reject Advance Request"}
            </DialogTitle>
            <DialogDescription>
              {bossTarget
                ? `${bossTarget.employeeName} — ${bossTarget.advanceTypeName} — requested ${formatAmount(bossTarget.requestedAmount)}${
                    bossTarget.managerRecommendedAmount != null ? `, manager recommended ${formatAmount(bossTarget.managerRecommendedAmount)}` : ""
                  }. Employee requested ${bossTarget.requestedInstallmentCount ?? "—"} installment(s)${
                    bossTarget.managerRecommendedInstallmentCount != null ? `, manager recommended ${bossTarget.managerRecommendedInstallmentCount}` : ""
                  }.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {bossAction === "approved" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Approved Amount (₹)</Label>
                  <Input type="number" min={1} value={bossApproved} onChange={(e) => setBossApproved(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Final Installment Count</Label>
                  <Input type="number" min={1} step={1} value={bossInstallments} onChange={(e) => setBossInstallments(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Requested {formatAmount(bossTarget?.requestedAmount ?? null)} / {bossTarget?.requestedInstallmentCount ?? "—"} installment(s) is
                recorded permanently and unchanged. Both fields above are subject to the configured Advance Policy (max amount, Boss approval
                limit, max installments) — enforced server-side. This becomes the FINAL approved recovery plan.
              </p>
              {bossTermsChanged && (
                <div className="space-y-1.5">
                  <Label>Modification Reason (required when changing the amount or installment count)</Label>
                  <Textarea value={bossModReason} onChange={(e) => setBossModReason(e.target.value)} />
                </div>
              )}
            </>
          )}
          <div className="space-y-1.5">
            <Label>Remark {bossAction === "approved" ? "(optional)" : "(required)"}</Label>
            <Textarea value={bossRemark} onChange={(e) => setBossRemark(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => (setBossTarget(null), setBossAction(null))} disabled={bossDecide.isPending}>
              Cancel
            </Button>
            <Button
              variant={bossAction === "rejected" ? "destructive" : "default"}
              onClick={submitBoss}
              disabled={bossDecide.isPending}
            >
              {bossDecide.isPending
                ? "Saving…"
                : bossAction === "approved"
                ? bossAmountChanged
                  ? "Modify & Approve"
                  : "Approve"
                : bossAction === "sent_back"
                ? "Send Back"
                : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// Plain-staff self view (no approve/reject controls)
// ===========================================================================
function StaffSelfView() {
  const navigate = useNavigate();
  const requestsQuery = useMyAdvanceRequests();
  const rows = requestsQuery.data ?? [];
  const pending = useMemo(() => rows.filter((r) => r.status === "manager_pending" || r.status === "boss_pending" || r.status === "sent_back"), [rows]);
  const decided = useMemo(() => rows.filter((r) => r.status === "approved" || r.status === "rejected" || r.status === "cancelled"), [rows]);
  const [activeTab, setActiveTab] = useState("pending");

  const Section = ({ list, empty }: { list: typeof rows; empty: string }) => (
    <Card>
      <CardContent className="pt-6">
        {requestsQuery.isLoading ? (
          <LoadingState />
        ) : list.length === 0 ? (
          <EmptyState icon={History} title={empty} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Mgr Recommended</TableHead>
                  <TableHead>Boss Approved</TableHead>
                  <TableHead>Requested On</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.advanceTypeName}</TableCell>
                    <TableCell>{formatAmount(r.requestedAmount)}</TableCell>
                    <TableCell className="text-xs">{formatAmount(r.managerRecommendedAmount)}</TableCell>
                    <TableCell className="text-xs">{formatAmount(r.bossApprovedAmount)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(r.requestedAt)}</TableCell>
                    <TableCell className="text-xs">{advanceStageLabel(r.status, r.currentStep)}</TableCell>
                    <TableCell>
                      <Badge variant={ADVANCE_STATUS_VARIANT[r.status]}>{ADVANCE_STATUS_LABEL[r.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advance Approval"
        description="Track the approval status and history of your own advance requests."
        actions={
          <Button variant="secondary" onClick={() => navigate(ROUTES.myAdvances)}>
            Manage in My Advances <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        }
      />
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="decided">Decided ({decided.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          <Section list={pending} empty="No pending advance requests." />
        </TabsContent>
        <TabsContent value="decided">
          <Section list={decided} empty="No decided advance requests." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
