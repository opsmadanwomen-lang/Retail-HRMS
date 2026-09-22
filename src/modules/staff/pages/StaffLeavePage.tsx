import { useMemo, useState } from "react";
import { CalendarClock, Download, Paperclip } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import {
  useLeaveTypes,
  useActiveLeaveFinancialYear,
  useLeavePreviewTotalDays,
  useLeaveBalance,
  useMyLeaveApplications,
  useLeaveApplicationDocuments,
  useApplyLeave,
  useCancelLeaveApplication,
  useMyLeaveLedger,
  usePaidDaySelection,
  useSetPaidDays,
} from "@/hooks/useLeave";
import { leaveService } from "@/services/leaveService";
import { formatDate } from "@/lib/utils";
import type { LeaveApplication } from "@/types/leave";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  manager_pending: "warning",
  super_manager_pending: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
};

const STATUS_LABEL: Record<string, string> = {
  manager_pending: "Manager Pending",
  super_manager_pending: "Super Manager Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

// Phase 5 — an already-approved leave can now also be cancelled (leave_cancel() extended to accept
// 'approved'), so Cancel is offered here too — never for rejected/cancelled, which are already final
// with nothing left to release.
const CANCELLABLE_STATUSES = new Set(["manager_pending", "super_manager_pending", "approved"]);

/** Step X of Y — never hardcodes which day-count makes a leave "short" or "long"; it just reads the
 *  already-resolved short_or_long/status the backend snapshotted, exactly per "no duplicate status
 *  systems" (§ Phase 3 scope). */
function approvalStageLabel(status: string, shortOrLong: string | null): string {
  if (status === "manager_pending") return shortOrLong === "long" ? "Step 1 of 2 — Direct Manager" : "Step 1 of 1 — Direct Manager";
  if (status === "super_manager_pending") return "Step 2 of 2 — Super Manager";
  if (status === "approved" || status === "rejected") return "Completed";
  return "—";
}

/**
 * Staff Panel — Leave. Real Apply Leave + My Leave Requests, backed entirely by the Phase 1/2
 * Leave Policy Engine (leave_apply/leave_cancel/leave_get_balance RPCs) — no calculation happens in
 * this component; Total Days, Short/Long classification, eligibility, and balance are all resolved
 * server-side. Identity is always the logged-in Staff's own employee (useCurrentEmployee), never a
 * route/URL param, matching every other Staff Panel page.
 */
export function StaffLeavePage() {
  const { user } = useAuth();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const employeeId = currentEmployeeQuery.data?.id;
  const companyId = user?.companyId ?? undefined;

  const typesQuery = useLeaveTypes(companyId);
  // Root cause of the old "No active Financial Year" bug: leave_financial_years RLS excluded Staff,
  // so a direct table read always returned empty. Resolve the authoritative active FY via the
  // SECURITY DEFINER RPC instead (the same row leave_apply() resolves server-side).
  const fyQuery = useActiveLeaveFinancialYear(Boolean(user));
  const activeFy = fyQuery.data ?? null;

  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const activeTypes = (typesQuery.data ?? []).filter((t) => t.isActive);
  const effectiveTypeId = selectedTypeId || activeTypes[0]?.id || "";

  const balanceQuery = useLeaveBalance(
    employeeId && effectiveTypeId && activeFy ? { employeeId, leaveTypeId: effectiveTypeId, financialYearId: activeFy.id } : null
  );

  const applicationsQuery = useMyLeaveApplications();
  const applyLeave = useApplyLeave();
  const cancelLeave = useCancelLeaveApplication();
  const [managePaidTarget, setManagePaidTarget] = useState<LeaveApplication | null>(null);

  // ---- Apply form state ----
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState("first_half");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [priorNoticeReason, setPriorNoticeReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedType = activeTypes.find((t) => t.id === effectiveTypeId);

  // Effective To Date the backend will see (half-day is always a single date).
  const effectiveToDate = isHalfDay ? fromDate : toDate || fromDate;
  const dateOrderInvalid = Boolean(fromDate && toDate && !isHalfDay && toDate < fromDate);

  // "Leave Duration [automatically calculated]" — resolved entirely by the backend
  // (leave_compute_total_days via leave_preview_total_days). Never computed in this component.
  const durationQuery = useLeavePreviewTotalDays(
    effectiveTypeId && fromDate && effectiveToDate && !dateOrderInvalid
      ? { leaveTypeId: effectiveTypeId, fromDate, toDate: effectiveToDate, isHalfDay }
      : null
  );

  // Lightweight pre-submit validation only. Eligibility, balance sufficiency, overlap, probation,
  // weekly-off/holiday and short/long classification all stay with leave_apply() (surfaced via toast).
  const validationError = !effectiveTypeId
    ? "Select a Leave Type."
    : !fromDate
    ? "Select a From Date."
    : !isHalfDay && !toDate
    ? "Select a To Date."
    : dateOrderInvalid
    ? "To Date cannot be before From Date."
    : null;

  const resetForm = () => {
    setFromDate(""); setToDate(""); setIsHalfDay(false); setReason(""); setRemarks(""); setPriorNoticeReason(""); setFile(null);
  };

  const handleSubmit = async () => {
    if (!employeeId || !companyId || !effectiveTypeId || !fromDate) return;
    setSubmitting(true);
    try {
      let document: { storagePath: string; fileName: string; mimeType: string | null; fileSizeBytes: number } | undefined;
      if (file) {
        document = await leaveService.uploadApplicationFile({ companyId, employeeId, file });
      }
      await applyLeave.mutateAsync({
        leaveTypeId: effectiveTypeId,
        fromDate,
        toDate: isHalfDay ? fromDate : toDate || fromDate,
        isHalfDay,
        halfDaySession: isHalfDay ? halfDaySession : undefined,
        reason: reason || undefined,
        remarks: remarks || undefined,
        priorNoticeReason: priorNoticeReason || undefined,
        document,
      });
      toast({ title: "Leave application submitted", variant: "success" });
      resetForm();
    } catch (error) {
      toast({ title: "Could not submit leave application", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (applicationId: string) => {
    try {
      await cancelLeave.mutateAsync({ applicationId });
      toast({ title: "Leave application cancelled", variant: "success" });
    } catch (error) {
      toast({ title: "Could not cancel", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleViewDocument = async (storagePath: string) => {
    try {
      const url = await leaveService.getDocumentSignedUrl(storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({ title: "Could not open document", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const balanceCards = useMemo(
    () => [
      { label: "Earned", value: balanceQuery.data?.earned },
      { label: "Used", value: balanceQuery.data?.used },
      { label: "Pending", value: balanceQuery.data?.pending },
      { label: "Available", value: balanceQuery.data?.available },
    ],
    [balanceQuery.data]
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Leave" description="Apply for leave and track your requests." />

      {activeFy ? (
        <p className="text-sm text-muted-foreground">
          Current Financial Year:{" "}
          <span className="font-medium text-foreground">
            {activeFy.label || `${formatDate(activeFy.startDate)} to ${formatDate(activeFy.endDate)}`}
          </span>
        </p>
      ) : null}

      {fyQuery.isLoading ? (
        <Card>
          <CardContent className="p-6">
            <LoadingState />
          </CardContent>
        </Card>
      ) : !activeFy ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={CalendarClock}
              title="No active Financial Year"
              description="Your company has no Financial Year marked active, so Leave cannot be applied for yet. An administrator must open Leave Management → Financial Years and activate the current year."
            />
          </CardContent>
        </Card>
      ) : activeTypes.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState icon={CalendarClock} title="No Leave Types configured" description="Contact your administrator to configure Leave Types." />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Label className="text-sm text-muted-foreground">Leave Type:</Label>
            <Select value={effectiveTypeId} onValueChange={setSelectedTypeId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{activeTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            {balanceCards.map((c) => (
              <Card key={c.label}>
                <CardContent className="space-y-1.5 p-4">
                  <p className="text-sm text-muted-foreground">{c.label}</p>
                  <p className="text-xl font-semibold text-foreground">{balanceQuery.isLoading ? "…" : c.value ?? "—"}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <Card>
              <CardHeader><CardTitle>Apply Leave</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>From</Label>
                    <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} max={toDate || undefined} />
                  </div>
                  <div>
                    <Label>To</Label>
                    <Input type="date" value={isHalfDay ? fromDate : toDate} onChange={(e) => setToDate(e.target.value)} min={fromDate || undefined} disabled={isHalfDay} />
                  </div>
                </div>
                {selectedType?.halfDayAllowed ? (
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={isHalfDay} onCheckedChange={(v) => setIsHalfDay(Boolean(v))} /> Half Day
                    </label>
                    {isHalfDay ? (
                      <Select value={halfDaySession} onValueChange={setHalfDaySession}>
                        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="first_half">First Half</SelectItem>
                          <SelectItem value="second_half">Second Half</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                ) : null}
                <div>
                  <Label>Reason</Label>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for leave" rows={2} />
                </div>
                <div>
                  <Label>Remarks (optional)</Label>
                  <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
                </div>
                <div>
                  <Label>Reason for Short Notice (only if applicable)</Label>
                  <Textarea
                    value={priorNoticeReason}
                    onChange={(e) => setPriorNoticeReason(e.target.value)}
                    placeholder="Required only for Long Leave applied without the configured prior notice period — leave blank otherwise."
                    rows={2}
                  />
                </div>
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Leave Duration: </span>
                  <span className="font-medium text-foreground">
                    {!effectiveTypeId || !fromDate
                      ? "—"
                      : durationQuery.isFetching
                      ? "Calculating…"
                      : durationQuery.data == null
                      ? "—"
                      : `${durationQuery.data} day${durationQuery.data === 1 ? "" : "s"}`}
                  </span>
                  <span className="ml-1 text-xs text-muted-foreground">(calculated by the Leave engine — excludes Weekly Off/Holiday per policy)</span>
                </div>
                <div>
                  <Label>Supporting Document {selectedType?.documentRequired ? "(required)" : "(optional)"}</Label>
                  <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
                {validationError ? <p className="text-sm text-destructive">{validationError}</p> : null}
                <Button
                  className="w-full"
                  onClick={handleSubmit}
                  disabled={Boolean(validationError) || submitting}
                >
                  {submitting ? "Submitting…" : "Apply Leave"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>My Leave Requests</CardTitle></CardHeader>
              <CardContent>
                {applicationsQuery.isLoading ? (
                  <LoadingState />
                ) : (applicationsQuery.data ?? []).length === 0 ? (
                  <EmptyState icon={CalendarClock} title="No leave requests yet" description="Your submitted leave requests will appear here." />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Leave Type</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead>To</TableHead>
                          <TableHead>Days</TableHead>
                          <TableHead>Short/Long</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Current Status</TableHead>
                          <TableHead>Current Approval Stage</TableHead>
                          <TableHead>Applied Date</TableHead>
                          <TableHead>Paid Days</TableHead>
                          <TableHead>Unpaid Days</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(applicationsQuery.data ?? []).map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="font-medium">{a.leaveTypeName ?? "—"}</TableCell>
                            <TableCell className="text-xs">{formatDate(a.fromDate)}</TableCell>
                            <TableCell className="text-xs">{formatDate(a.toDate)}</TableCell>
                            <TableCell>{a.totalDays}</TableCell>
                            <TableCell className="text-xs capitalize">{a.shortOrLong ?? "—"}</TableCell>
                            <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground" title={a.reason ?? undefined}>{a.reason ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>{STATUS_LABEL[a.status] ?? a.status}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{approvalStageLabel(a.status, a.shortOrLong)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatDate(a.appliedAt)}</TableCell>
                            <TableCell className="text-xs">{a.status === "approved" ? (a.paidDays ?? 0) : "—"}</TableCell>
                            <TableCell className="text-xs">{a.status === "approved" ? (a.unpaidDays ?? 0) : "—"}</TableCell>
                            <TableCell>
                              {a.status === "approved" && (a.approvedEffectDays ?? 0) > 0 ? (
                                <Button variant="outline" size="sm" onClick={() => setManagePaidTarget(a)}>
                                  Manage Paid Leave
                                </Button>
                              ) : null}
                              {CANCELLABLE_STATUSES.has(a.status) ? (
                                <Button variant="ghost" size="sm" onClick={() => handleCancel(a.id)} disabled={cancelLeave.isPending}>
                                  Cancel
                                </Button>
                              ) : null}
                              <ApplicationDocumentsButton applicationId={a.id} onView={handleViewDocument} />
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

          <LeaveLedgerCard financialYearId={activeFy?.id} />
        </>
      )}

      {managePaidTarget ? (
        <ManagePaidLeaveDialog application={managePaidTarget} onOpenChange={(open) => !open && setManagePaidTarget(null)} />
      ) : null}
    </div>
  );
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Manage Paid Leave — date-wise selection of which APPROVED leave dates should be adjusted against
 * the employee's available paid-leave balance. This does NOT create a new leave application and does
 * NOT change the approval; it only calls leave_set_paid_days(), the single thing that consumes paid
 * leave. Half day / half-paid = 0.5. Selection can be changed until payroll lock.
 */
function ManagePaidLeaveDialog({ application, onOpenChange }: { application: LeaveApplication; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const employeeId = currentEmployeeQuery.data?.id;

  const selectionQuery = usePaidDaySelection(application.id);
  const balanceQuery = useLeaveBalance(
    employeeId ? { employeeId, leaveTypeId: application.leaveTypeId, financialYearId: application.financialYearId } : null
  );
  const save = useSetPaidDays();

  const rows = selectionQuery.data ?? [];
  const locked = rows.some((r) => r.payrollLocked);

  // local selection: date -> 'full' | 'half' | 'none'
  const [sel, setSel] = useState<Record<string, "full" | "half" | "none">>({});
  const initialised = rows.length > 0 && Object.keys(sel).length === rows.length;
  if (rows.length > 0 && Object.keys(sel).length === 0) {
    const init: Record<string, "full" | "half" | "none"> = {};
    for (const r of rows) init[r.attendanceDate] = r.paidStatus === "paid" ? (r.paidUnits === 0.5 ? "half" : "full") : "none";
    setSel(init);
  }

  const unitsFor = (r: (typeof rows)[number], mode: "full" | "half" | "none") =>
    mode === "none" ? 0 : mode === "half" ? 0.5 : r.isHalfDay ? 0.5 : 1;

  const approvedUnits = rows.reduce((s, r) => s + (r.isHalfDay ? 0.5 : 1), 0);
  const selectedUnits = rows.reduce((s, r) => s + unitsFor(r, sel[r.attendanceDate] ?? "none"), 0);
  const committedAppUnits = rows.reduce((s, r) => s + (r.paidStatus === "paid" ? r.paidUnits : 0), 0);
  const headroom = (balanceQuery.data?.available ?? 0) + committedAppUnits;
  const remaining = headroom - selectedUnits;

  const setMode = (date: string, mode: "full" | "half" | "none") => setSel((prev) => ({ ...prev, [date]: mode }));

  const handleSave = async () => {
    const fullPaidDates = rows.filter((r) => (sel[r.attendanceDate] ?? "none") === "full").map((r) => r.attendanceDate);
    const halfPaidDates = rows.filter((r) => (sel[r.attendanceDate] ?? "none") === "half").map((r) => r.attendanceDate);
    try {
      const res = await save.mutateAsync({ applicationId: application.id, fullPaidDates, halfPaidDates });
      toast({ title: `Paid Leave saved — ${res.paidDays} paid, ${res.unpaidDays} unpaid.`, variant: "success" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not save Paid Leave", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Paid Leave</DialogTitle>
          <DialogDescription>
            Approved Leave {formatDate(application.fromDate)} → {formatDate(application.toDate)} ({application.leaveTypeName ?? "Leave"}). Choose which
            approved dates are paid; the rest remain Unpaid for payroll.
          </DialogDescription>
        </DialogHeader>

        {selectionQuery.isLoading || balanceQuery.isLoading ? (
          <LoadingState />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Approved Days</p><p className="font-semibold">{approvedUnits}</p></div>
              <div><p className="text-xs text-muted-foreground">Paid Selected</p><p className="font-semibold">{selectedUnits}</p></div>
              <div><p className="text-xs text-muted-foreground">Unpaid</p><p className="font-semibold">{approvedUnits - selectedUnits}</p></div>
              <div><p className="text-xs text-muted-foreground">Available Paid Balance</p><p className={`font-semibold ${remaining < 0 ? "text-destructive" : ""}`}>{remaining}</p></div>
            </div>

            {locked ? (
              <p className="text-sm text-amber-700">Payroll for this period has been processed — this selection is read-only.</p>
            ) : remaining < 0 ? (
              <p className="text-sm text-destructive">You have selected more paid days than your available paid leave balance.</p>
            ) : null}

            <div className="max-h-[50vh] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>Leave Day</TableHead>
                    <TableHead>Paid Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const mode = sel[r.attendanceDate] ?? "none";
                    const noHeadroomForFull = mode !== "full" && remaining - (r.isHalfDay ? 0.5 : 1) < 0;
                    return (
                      <TableRow key={r.effectId}>
                        <TableCell className="text-xs">{formatDate(r.attendanceDate)}</TableCell>
                        <TableCell className="text-xs">{WEEKDAY[new Date(r.attendanceDate + "T00:00:00").getDay()]}</TableCell>
                        <TableCell className="text-xs">{r.isHalfDay ? `Half Day${r.halfDaySession ? ` (${r.halfDaySession.replace("_", " ")})` : ""}` : "Full Day"}</TableCell>
                        <TableCell>
                          <Select
                            value={mode}
                            onValueChange={(v) => setMode(r.attendanceDate, v as "full" | "half" | "none")}
                            disabled={locked}
                          >
                            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Unpaid</SelectItem>
                              <SelectItem value="full" disabled={r.isHalfDay || noHeadroomForFull}>Paid (Full)</SelectItem>
                              <SelectItem value="half" disabled={mode !== "half" && remaining - 0.5 < 0}>Paid (Half — 0.5)</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleSave} disabled={locked || save.isPending || remaining < 0 || !initialised}>
            {save.isPending ? "Saving…" : "Save Paid Leave Selection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Employee's own raw Leave Ledger — reads the SAME authoritative leave_ledger table
 *  leave_get_balance() itself sums, never a second calculation; RLS already scopes this to "self"
 *  for a staff caller. */
function LeaveLedgerCard({ financialYearId }: { financialYearId?: string }) {
  const ledgerQuery = useMyLeaveLedger(financialYearId);
  const rows = ledgerQuery.data ?? [];

  return (
    <Card>
      <CardHeader><CardTitle>Leave History / Ledger</CardTitle></CardHeader>
      <CardContent>
        {ledgerQuery.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No ledger entries yet" description="Every credit, debit, and adjustment to your leave balance will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.leaveTypeName ?? "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{r.transactionType.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs">{formatDate(r.transactionDate)}</TableCell>
                    <TableCell className={r.days < 0 ? "text-destructive" : "text-green-600"}>{r.days > 0 ? `+${r.days}` : r.days}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={r.remark ?? undefined}>{r.remark ?? "—"}</TableCell>
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

/** Only queries documents once the Paperclip button is clicked, so listing many applications
 *  doesn't fire a document query per row up front. */
function ApplicationDocumentsButton({ applicationId, onView }: { applicationId: string; onView: (storagePath: string) => void }) {
  const [open, setOpen] = useState(false);
  const documentsQuery = useLeaveApplicationDocuments(open ? applicationId : undefined);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title="View documents">
        <Paperclip className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {(documentsQuery.data ?? []).map((d) => (
        <Button key={d.id} variant="ghost" size="sm" onClick={() => onView(d.storagePath)} title={d.fileName}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      ))}
      {(documentsQuery.data ?? []).length === 0 && !documentsQuery.isLoading ? <span className="text-xs text-muted-foreground">No document</span> : null}
    </div>
  );
}
