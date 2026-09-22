import { useMemo, useState } from "react";
import { Download, FileBarChart, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";
import { exportRowsToCsv } from "@/lib/csvExport";
import {
  useLeaveFinancialYears,
  useLeaveReportLedger,
  useLeaveReportApplications,
  useLeaveReportBalances,
  useLeaveReportProbation,
  useFyClosingBatchesForCompany,
  useFyClosingLines,
  useLeaveReportPolicyChanges,
  useLeaveReportAudit,
} from "@/hooks/useLeave";

const REPORTS = [
  { value: "ledger", label: "Employee Leave Ledger" },
  { value: "balance", label: "Employee Leave Balance" },
  { value: "store", label: "Store-wise Leave Report" },
  { value: "department", label: "Department-wise Leave Report" },
  { value: "monthly", label: "Monthly Leave Report" },
  { value: "short", label: "Short Leave Report" },
  { value: "long", label: "Long Leave Report" },
  { value: "pending", label: "Pending Leave Report" },
  { value: "approval", label: "Approval / Rejection Report" },
  { value: "encashment", label: "Leave Encashment Report" },
  { value: "lapse", label: "Leave Lapse Report" },
  { value: "fyclosing", label: "Financial Year Closing Report" },
  { value: "probation", label: "Probation Employee Report" },
  { value: "policychange", label: "Policy Change Report" },
  { value: "audit", label: "Leave Audit Report" },
] as const;

type ReportKey = (typeof REPORTS)[number]["value"];

/**
 * Leave Reports (Phase 5) — Super Admin only. Every report reads an EXISTING authoritative
 * source (leave_ledger, leave_applications, leave_get_balance(), leave_resolve_eligibility(),
 * leave_fy_closing_lines, audit_logs) via a thin reporting RPC/query — Store/Department/Monthly
 * grouping is a client-side group-by over already-correct rows, never a second calculation.
 */
export function LeaveReportsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const companyId = user?.companyId ?? undefined;

  // Hooks must run unconditionally (rules of hooks) — the Super-Admin gate is applied to the
  // rendered output below, and every report RPC re-enforces the same gate server-side anyway.
  const [reportKey, setReportKey] = useState<ReportKey>("ledger");
  const fyQuery = useLeaveFinancialYears(companyId);
  const [fyId, setFyId] = useState("");
  const effectiveFyId = fyId || fyQuery.data?.find((f) => f.status === "active")?.id || fyQuery.data?.[0]?.id || "";

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  if (!isSuperAdmin) {
    return <EmptyState icon={ShieldAlert} title="Super Admin access required" description="Only Super Admin can view company-wide Leave Reports." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Reports" description="Company-wide Leave reporting — every figure reads directly from the authoritative Leave engine." />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-sm text-muted-foreground">Report</Label>
          <Select value={reportKey} onValueChange={(v) => setReportKey(v as ReportKey)}>
            <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REPORTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {["ledger", "balance", "fyclosing", "encashment", "lapse"].includes(reportKey) && (
          <div>
            <Label className="text-sm text-muted-foreground">Financial Year</Label>
            <Select value={effectiveFyId} onValueChange={setFyId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Select FY" /></SelectTrigger>
              <SelectContent>
                {(fyQuery.data ?? []).map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {["monthly", "short", "long", "pending", "approval", "store", "department"].includes(reportKey) && (
          <>
            <div>
              <Label className="text-sm text-muted-foreground">From</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">To</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
            </div>
          </>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          {reportKey === "ledger" && <LedgerReport companyId={companyId} financialYearId={effectiveFyId} />}
          {reportKey === "balance" && <BalanceReport financialYearId={effectiveFyId} />}
          {reportKey === "store" && <GroupedApplicationsReport groupBy="storeName" title="Store" fromDate={fromDate} toDate={toDate} />}
          {reportKey === "department" && <GroupedApplicationsReport groupBy="departmentName" title="Department" fromDate={fromDate} toDate={toDate} />}
          {reportKey === "monthly" && <MonthlyReport fromDate={fromDate} toDate={toDate} />}
          {reportKey === "short" && <ApplicationsListReport fromDate={fromDate} toDate={toDate} filter={(r) => r.shortOrLong === "short"} />}
          {reportKey === "long" && <ApplicationsListReport fromDate={fromDate} toDate={toDate} filter={(r) => r.shortOrLong === "long"} extendedColumns />}
          {reportKey === "pending" && <ApplicationsListReport fromDate={fromDate} toDate={toDate} filter={(r) => r.status === "manager_pending" || r.status === "super_manager_pending"} pendingView />}
          {reportKey === "approval" && <ApprovalRejectionReport fromDate={fromDate} toDate={toDate} />}
          {reportKey === "encashment" && <ClosingLinesReport companyId={companyId} financialYearId={effectiveFyId} mode="encashment" />}
          {reportKey === "lapse" && <ClosingLinesReport companyId={companyId} financialYearId={effectiveFyId} mode="lapse" />}
          {reportKey === "fyclosing" && <ClosingLinesReport companyId={companyId} financialYearId={effectiveFyId} mode="all" />}
          {reportKey === "probation" && <ProbationReport companyId={companyId} />}
          {reportKey === "policychange" && <PolicyChangeReport companyId={companyId} />}
          {reportKey === "audit" && <AuditReport companyId={companyId} fromDate={fromDate} toDate={toDate} />}
        </CardContent>
      </Card>
    </div>
  );
}

function ExportButton({ rows, filename }: { rows: Record<string, unknown>[]; filename: string }) {
  return (
    <Button variant="outline" size="sm" onClick={() => exportRowsToCsv(filename, rows)} disabled={rows.length === 0}>
      <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
    </Button>
  );
}

function ReportShell({ title, rows, csvName, children }: { title: string; rows: Record<string, unknown>[]; csvName: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{title} ({rows.length})</p>
        <ExportButton rows={rows} filename={csvName} />
      </div>
      {rows.length === 0 ? <EmptyState icon={FileBarChart} title="No data" description="No records match the current filters." /> : <div className="overflow-x-auto">{children}</div>}
    </div>
  );
}

// ============================================================================
// Employee Leave Ledger (§15)
//
// "Summary" is the §15 view: one row per Employee + Leave Type with the Opening
// / Earned / Carry Forward / Used / Adjustment / Encashment / Lapse / Closing
// buckets. Every figure is a pure group-by/sum over the AUTHORITATIVE
// leave_ledger rows (transaction_type is the only thing switched on — never a
// re-derivation), with Pending/Closing-Available taken straight from
// leave_get_balance() (via leave_report_balances) and Encashment/Lapse from the
// confirmed FY-closing lines — no second balance calculation anywhere.
// "Transactions" is the raw append-only event log for the same scope.
// ============================================================================
function LedgerReport({ companyId, financialYearId }: { companyId?: string; financialYearId: string }) {
  const [view, setView] = useState<"summary" | "transactions">("summary");
  const query = useLeaveReportLedger(companyId, financialYearId || undefined);
  const balancesQuery = useLeaveReportBalances(financialYearId || undefined);
  const batchesQuery = useFyClosingBatchesForCompany(companyId);
  const closedBatch = (batchesQuery.data ?? []).find((b) => b.financialYearId === financialYearId && b.status === "closed");
  const closingLinesQuery = useFyClosingLines(closedBatch?.id);

  const summaryRows = useMemo(() => {
    const ledger = query.data ?? [];
    const balByKey = new Map((balancesQuery.data ?? []).map((b) => [`${b.employeeId}::${b.leaveTypeId}`, b]));
    const closingByKey = new Map((closingLinesQuery.data ?? []).map((l) => [`${l.employeeId}::${l.leaveTypeId}`, l]));
    const map = new Map<string, {
      key: string; employeeName: string; employeeCode: string; leaveTypeName: string;
      opening: number; earned: number; carryForward: number; used: number; adjustment: number;
      encashment: number; lapse: number; pending: number; closing: number;
    }>();
    for (const r of ledger) {
      const key = `${r.employeeId}::${r.leaveTypeId}`;
      if (!map.has(key)) {
        const bal = balByKey.get(key);
        const cl = closingByKey.get(key);
        map.set(key, {
          key, employeeName: r.employeeName, employeeCode: r.employeeCode, leaveTypeName: r.leaveTypeName,
          opening: 0, earned: 0, carryForward: 0, used: 0, adjustment: 0,
          encashment: cl?.encashmentDays ?? 0, lapse: cl?.lapseDays ?? 0,
          pending: bal?.pending ?? 0, closing: bal?.available ?? 0,
        });
      }
      const g = map.get(key)!;
      switch (r.transactionType) {
        case "opening": g.opening += r.days; break;
        case "accrual": g.earned += r.days; break;
        case "carry_forward": g.carryForward += r.days; break;
        case "used": g.used += r.days; break;
        case "adjustment": g.adjustment += r.days; break;
        default: break; // reversal/pending_reservation/lwp_conversion/closing are reflected in the balance-derived Pending/Closing
      }
    }
    // When no balances RPC row exists (e.g. all-zero), fall back to SUM(days) — the same definition leave_get_balance() uses.
    for (const g of map.values()) {
      if (g.closing === 0 && !balByKey.has(g.key)) {
        g.closing = (ledger.filter((r) => `${r.employeeId}::${r.leaveTypeId}` === g.key).reduce((s, r) => s + r.days, 0));
      }
    }
    return Array.from(map.values());
  }, [query.data, balancesQuery.data, closingLinesQuery.data]);

  if (query.isLoading || balancesQuery.isLoading) return <LoadingState />;

  if (view === "transactions") {
    const rows = query.data ?? [];
    return (
      <div className="space-y-3">
        <LedgerViewToggle view={view} onChange={setView} />
        <ReportShell title="Employee Leave Ledger — Transactions" rows={rows} csvName="leave-ledger-transactions">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead><TableHead>Leave Type</TableHead><TableHead>Transaction</TableHead>
                <TableHead>Date</TableHead><TableHead>Days</TableHead><TableHead>Remark</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode})</span></TableCell>
                  <TableCell>{r.leaveTypeName}</TableCell>
                  <TableCell className="capitalize">{r.transactionType.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-xs">{formatDate(r.transactionDate)}</TableCell>
                  <TableCell className={r.days < 0 ? "text-destructive" : "text-green-600"}>{r.days}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={r.remark}>{r.remark ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ReportShell>
      </div>
    );
  }

  const csvRows = summaryRows.map((g) => ({
    Employee: `${g.employeeName} (${g.employeeCode})`, "Leave Type": g.leaveTypeName,
    Opening: g.opening, "Earned / Accrued": g.earned, "Carry Forward": g.carryForward,
    Used: Math.abs(g.used), Pending: g.pending, Adjustment: g.adjustment,
    Encashment: g.encashment, Lapse: g.lapse, "Closing / Available": g.closing,
  }));
  return (
    <div className="space-y-3">
      <LedgerViewToggle view={view} onChange={setView} />
      <ReportShell title="Employee Leave Ledger" rows={csvRows} csvName="leave-ledger">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead><TableHead>Leave Type</TableHead><TableHead>Opening</TableHead>
              <TableHead>Earned</TableHead><TableHead>Carry Fwd</TableHead><TableHead>Used</TableHead>
              <TableHead>Pending</TableHead><TableHead>Adjustment</TableHead><TableHead>Encashment</TableHead>
              <TableHead>Lapse</TableHead><TableHead>Closing / Available</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summaryRows.map((g) => (
              <TableRow key={g.key}>
                <TableCell className="font-medium">{g.employeeName} <span className="text-xs text-muted-foreground">({g.employeeCode})</span></TableCell>
                <TableCell>{g.leaveTypeName}</TableCell>
                <TableCell>{g.opening}</TableCell>
                <TableCell>{g.earned}</TableCell>
                <TableCell>{g.carryForward}</TableCell>
                <TableCell>{Math.abs(g.used)}</TableCell>
                <TableCell>{g.pending}</TableCell>
                <TableCell>{g.adjustment}</TableCell>
                <TableCell>{g.encashment}</TableCell>
                <TableCell>{g.lapse}</TableCell>
                <TableCell className="font-semibold">{g.closing}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportShell>
    </div>
  );
}

function LedgerViewToggle({ view, onChange }: { view: "summary" | "transactions"; onChange: (v: "summary" | "transactions") => void }) {
  return (
    <div className="flex gap-2">
      <Button variant={view === "summary" ? "default" : "outline"} size="sm" onClick={() => onChange("summary")}>Summary (§15)</Button>
      <Button variant={view === "transactions" ? "default" : "outline"} size="sm" onClick={() => onChange("transactions")}>Transactions</Button>
    </div>
  );
}

// ============================================================================
// Employee Leave Balance — pure display of leave_get_balance() batched server-side
// ============================================================================
function BalanceReport({ financialYearId }: { financialYearId: string }) {
  const query = useLeaveReportBalances(financialYearId || undefined);
  if (!financialYearId) return <EmptyState icon={FileBarChart} title="Select a Financial Year" description="Choose a Financial Year above." />;
  if (query.isLoading) return <LoadingState />;
  const rows = query.data ?? [];
  return (
    <ReportShell title="Employee Leave Balance" rows={rows} csvName="leave-balance">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Employee</TableHead><TableHead>Leave Type</TableHead><TableHead>Earned</TableHead><TableHead>Used</TableHead><TableHead>Pending</TableHead><TableHead>Available</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={`${r.employeeId}-${r.leaveTypeId}-${i}`}>
              <TableCell className="font-medium">{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode})</span></TableCell>
              <TableCell>{r.leaveTypeName}</TableCell>
              <TableCell>{r.earned}</TableCell><TableCell>{r.used}</TableCell><TableCell>{r.pending}</TableCell><TableCell className="font-semibold">{r.available}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// ============================================================================
// Short / Long / Pending — all the SAME leave_report_applications() rows, filtered
// ============================================================================
function ApplicationsListReport({ fromDate, toDate, filter, extendedColumns, pendingView }: { fromDate: string; toDate: string; filter: (r: any) => boolean; extendedColumns?: boolean; pendingView?: boolean }) {
  const query = useLeaveReportApplications(fromDate || undefined, toDate || undefined);
  if (query.isLoading) return <LoadingState />;
  const rows = (query.data ?? []).filter(filter);
  return (
    <ReportShell title="Applications" rows={rows} csvName="leave-applications">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead><TableHead>Store</TableHead><TableHead>Leave Type</TableHead>
            <TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Days</TableHead>
            <TableHead>Paid</TableHead><TableHead>Unpaid</TableHead>
            {pendingView && <TableHead>Pending With</TableHead>}
            <TableHead>Status</TableHead><TableHead>Applied</TableHead>
            {extendedColumns && <><TableHead>Decided By</TableHead><TableHead>Decided At</TableHead></>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.employeeName}</TableCell>
              <TableCell>{r.storeName ?? "—"}</TableCell>
              <TableCell>{r.leaveTypeName}</TableCell>
              <TableCell className="text-xs">{formatDate(r.fromDate)}</TableCell>
              <TableCell className="text-xs">{formatDate(r.toDate)}</TableCell>
              <TableCell>{r.totalDays}</TableCell>
              <TableCell>{r.status === "approved" ? (r.paidDays ?? 0) : "—"}</TableCell>
              <TableCell>{r.status === "approved" ? (r.unpaidDays ?? 0) : "—"}</TableCell>
              {pendingView && <TableCell><Badge variant="warning">{r.pendingWith ?? "—"}</Badge></TableCell>}
              <TableCell className="capitalize">{r.status.replace(/_/g, " ")}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatDate(r.appliedAt)}</TableCell>
              {extendedColumns && <><TableCell className="font-mono text-xs">{r.decidedBy ? r.decidedBy.slice(0, 8) + "…" : "—"}</TableCell><TableCell className="text-xs">{r.decidedAt ? formatDate(r.decidedAt) : "—"}</TableCell></>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// ============================================================================
// Approval / Rejection Report
// ============================================================================
function ApprovalRejectionReport({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const query = useLeaveReportApplications(fromDate || undefined, toDate || undefined);
  if (query.isLoading) return <LoadingState />;
  const rows = (query.data ?? []).filter((r) => r.status === "approved" || r.status === "rejected");
  return (
    <ReportShell title="Approval / Rejection" rows={rows} csvName="leave-approval-rejection">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Employee</TableHead><TableHead>Leave Type</TableHead><TableHead>Days</TableHead><TableHead>Applied</TableHead><TableHead>Decision</TableHead><TableHead>Decided By</TableHead><TableHead>Decided At</TableHead><TableHead>Remark</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.employeeName}</TableCell>
              <TableCell>{r.leaveTypeName}</TableCell>
              <TableCell>{r.totalDays}</TableCell>
              <TableCell className="text-xs">{formatDate(r.appliedAt)}</TableCell>
              <TableCell><Badge variant={r.status === "approved" ? "success" : "destructive"} className="capitalize">{r.status}</Badge></TableCell>
              <TableCell className="font-mono text-xs">{r.decidedBy ? r.decidedBy.slice(0, 8) + "…" : "—"}</TableCell>
              <TableCell className="text-xs">{r.decidedAt ? formatDate(r.decidedAt) : "—"}</TableCell>
              <TableCell className="max-w-xs truncate text-xs" title={r.decisionRemark ?? undefined}>{r.decisionRemark ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// ============================================================================
// Store-wise / Department-wise — client-side group-by over the SAME applications rows
// ============================================================================
function GroupedApplicationsReport({ groupBy, title, fromDate, toDate }: { groupBy: "storeName" | "departmentName"; title: string; fromDate: string; toDate: string }) {
  const query = useLeaveReportApplications(fromDate || undefined, toDate || undefined);
  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; employees: Set<string>; applications: number; approvedDays: number; pendingDays: number; rejectedDays: number; cancelledDays: number }>();
    for (const r of query.data ?? []) {
      const key = r[groupBy] ?? "Unassigned";
      if (!map.has(key)) map.set(key, { key, employees: new Set(), applications: 0, approvedDays: 0, pendingDays: 0, rejectedDays: 0, cancelledDays: 0 });
      const g = map.get(key)!;
      g.employees.add(r.employeeId);
      g.applications += 1;
      if (r.status === "approved") g.approvedDays += r.totalDays;
      else if (r.status === "manager_pending" || r.status === "super_manager_pending") g.pendingDays += r.totalDays;
      else if (r.status === "rejected") g.rejectedDays += r.totalDays;
      else if (r.status === "cancelled") g.cancelledDays += r.totalDays;
    }
    return Array.from(map.values());
  }, [query.data, groupBy]);

  if (query.isLoading) return <LoadingState />;
  const rows = grouped.map((g) => ({ [title]: g.key, Employees: g.employees.size, Applications: g.applications, "Approved Days": g.approvedDays, "Pending Days": g.pendingDays, "Rejected Days": g.rejectedDays, "Cancelled Days": g.cancelledDays }));
  return (
    <ReportShell title={`${title}-wise Leave`} rows={rows} csvName={`leave-${title.toLowerCase()}-wise`}>
      <Table>
        <TableHeader><TableRow><TableHead>{title}</TableHead><TableHead>Employees</TableHead><TableHead>Applications</TableHead><TableHead>Approved Days</TableHead><TableHead>Pending Days</TableHead><TableHead>Rejected Days</TableHead><TableHead>Cancelled Days</TableHead></TableRow></TableHeader>
        <TableBody>
          {grouped.map((g) => (
            <TableRow key={g.key}>
              <TableCell className="font-medium">{g.key}</TableCell>
              <TableCell>{g.employees.size}</TableCell>
              <TableCell>{g.applications}</TableCell>
              <TableCell>{g.approvedDays}</TableCell>
              <TableCell>{g.pendingDays}</TableCell>
              <TableCell>{g.rejectedDays}</TableCell>
              <TableCell>{g.cancelledDays}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// ============================================================================
// Monthly Leave Report — grouped by calendar month of from_date, never a hard-coded FY range
// ============================================================================
function MonthlyReport({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const query = useLeaveReportApplications(fromDate || undefined, toDate || undefined);
  const grouped = useMemo(() => {
    const map = new Map<string, { month: string; applied: number; approved: number; rejected: number; cancelled: number; pending: number; approvedDays: number }>();
    for (const r of query.data ?? []) {
      const month = r.fromDate.slice(0, 7);
      if (!map.has(month)) map.set(month, { month, applied: 0, approved: 0, rejected: 0, cancelled: 0, pending: 0, approvedDays: 0 });
      const g = map.get(month)!;
      g.applied += 1;
      if (r.status === "approved") { g.approved += 1; g.approvedDays += r.totalDays; }
      else if (r.status === "rejected") g.rejected += 1;
      else if (r.status === "cancelled") g.cancelled += 1;
      else g.pending += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [query.data]);

  if (query.isLoading) return <LoadingState />;
  return (
    <ReportShell title="Monthly Leave Report" rows={grouped} csvName="leave-monthly">
      <Table>
        <TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Applied</TableHead><TableHead>Approved</TableHead><TableHead>Rejected</TableHead><TableHead>Cancelled</TableHead><TableHead>Pending</TableHead><TableHead>Total Approved Days</TableHead></TableRow></TableHeader>
        <TableBody>
          {grouped.map((g) => (
            <TableRow key={g.month}>
              <TableCell className="font-medium">{g.month}</TableCell>
              <TableCell>{g.applied}</TableCell><TableCell>{g.approved}</TableCell><TableCell>{g.rejected}</TableCell><TableCell>{g.cancelled}</TableCell><TableCell>{g.pending}</TableCell><TableCell>{g.approvedDays}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// ============================================================================
// Encashment / Lapse / FY Closing — all read leave_fy_closing_lines, filtered
// ============================================================================
function ClosingLinesReport({ companyId, financialYearId, mode }: { companyId?: string; financialYearId: string; mode: "encashment" | "lapse" | "all" }) {
  const batchesQuery = useFyClosingBatchesForCompany(companyId);
  const batch = (batchesQuery.data ?? []).find((b) => b.financialYearId === financialYearId && b.status === "closed");
  const linesQuery = useFyClosingLines(batch?.id);

  if (!financialYearId) return <EmptyState icon={FileBarChart} title="Select a Financial Year" description="Choose a Financial Year above." />;
  if (batchesQuery.isLoading || linesQuery.isLoading) return <LoadingState />;
  if (!batch) return <EmptyState icon={FileBarChart} title="Not closed yet" description="This Financial Year has not been closed — no Encashment/Lapse/Closing data exists yet." />;

  const rows = (linesQuery.data ?? []).filter((l) => (mode === "encashment" ? l.encashmentDays > 0 : mode === "lapse" ? l.lapseDays > 0 : true));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground" title={`Batch ID: ${batch.id}`}>Closed by {batch.closedBy ?? "—"} on {batch.closedAt ? formatDate(batch.closedAt) : "—"}</p>
      <ReportShell title={mode === "encashment" ? "Leave Encashment" : mode === "lapse" ? "Leave Lapse" : "Financial Year Closing"} rows={rows as unknown as Record<string, unknown>[]} csvName={`leave-${mode}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead><TableHead>Opening</TableHead><TableHead>Earned</TableHead><TableHead>Used</TableHead>
              <TableHead>Carry Fwd</TableHead>
              {mode !== "lapse" && <><TableHead>Encash Days</TableHead><TableHead>Basic</TableHead><TableHead>DA</TableHead><TableHead>Divisor</TableHead><TableHead>Daily Rate</TableHead><TableHead>Amount</TableHead></>}
              {mode !== "encashment" && <TableHead>Lapse Days</TableHead>}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.employeeId}-${r.leaveTypeId}-${i}`}>
                <TableCell className="font-mono text-xs">{r.employeeId.slice(0, 8)}…</TableCell>
                <TableCell>{r.opening}</TableCell><TableCell>{r.earned}</TableCell><TableCell>{r.used}</TableCell>
                <TableCell>{r.carryForwardDays}</TableCell>
                {mode !== "lapse" && (
                  <>
                    <TableCell>{r.encashmentDays}</TableCell>
                    <TableCell>{r.basicSalarySnapshot ?? "—"}</TableCell>
                    <TableCell>{r.daSnapshot ?? "—"}</TableCell>
                    <TableCell>{r.divisorSnapshot ?? "—"}</TableCell>
                    <TableCell>{r.dailyRate ?? "—"}</TableCell>
                    <TableCell>{r.encashmentAmount !== null ? `₹${r.encashmentAmount.toFixed(2)}` : "—"}</TableCell>
                  </>
                )}
                {mode !== "encashment" && <TableCell>{r.lapseDays}</TableCell>}
                <TableCell><Badge variant="secondary" className="capitalize">{r.finalStatus.replace(/_/g, " ")}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportShell>
    </div>
  );
}

// ============================================================================
// Probation Employee Report
// ============================================================================
function ProbationReport({ companyId }: { companyId?: string }) {
  const query = useLeaveReportProbation(companyId);
  if (query.isLoading) return <LoadingState />;
  const rows = (query.data ?? []).filter((r) => r.isCurrentlyInProbation);
  return (
    <ReportShell title="Probation Employees" rows={rows} csvName="leave-probation">
      <Table>
        <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Joining Date</TableHead><TableHead>Probation</TableHead><TableHead>Eligibility Date</TableHead><TableHead>Rule</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.employeeId}>
              <TableCell className="font-medium">{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeCode})</span></TableCell>
              <TableCell className="text-xs">{formatDate(r.joiningDate)}</TableCell>
              <TableCell>{r.probationDurationValue} {r.probationDurationUnit}</TableCell>
              <TableCell className="text-xs">{r.eligibilityStart ? formatDate(r.eligibilityStart) : "—"}</TableCell>
              <TableCell className="text-xs capitalize">{r.postProbationStartRule?.replace(/_/g, " ")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// ============================================================================
// Policy Change Report
// ============================================================================
function PolicyChangeReport({ companyId }: { companyId?: string }) {
  const query = useLeaveReportPolicyChanges(companyId);
  if (query.isLoading) return <LoadingState />;
  const rows = query.data ?? [];
  return (
    <ReportShell title="Policy Change History" rows={rows} csvName="leave-policy-changes">
      <Table>
        <TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Change Reason</TableHead><TableHead>Audit Action</TableHead><TableHead>Performed By</TableHead><TableHead>Performed At</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={`${r.policyId}-${i}`}>
              <TableCell className="font-medium">{r.policyName}</TableCell>
              <TableCell>v{r.versionNumber}</TableCell>
              <TableCell><Badge variant="secondary" className="capitalize">{r.status}</Badge></TableCell>
              <TableCell className="max-w-xs truncate text-xs">{r.changeReason ?? "—"}</TableCell>
              <TableCell className="text-xs capitalize">{r.auditAction ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{r.auditPerformedBy ? r.auditPerformedBy.slice(0, 8) + "…" : "—"}</TableCell>
              <TableCell className="text-xs">{r.auditPerformedAt ? formatDate(r.auditPerformedAt) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// ============================================================================
// Leave Audit Report
// ============================================================================
function AuditReport({ companyId, fromDate, toDate }: { companyId?: string; fromDate: string; toDate: string }) {
  const query = useLeaveReportAudit(companyId, fromDate ? `${fromDate}T00:00:00Z` : undefined, toDate ? `${toDate}T23:59:59Z` : undefined);
  if (query.isLoading) return <LoadingState />;
  const rows = query.data ?? [];
  return (
    <ReportShell title="Leave Audit Trail" rows={rows} csvName="leave-audit">
      <Table>
        <TableHeader><TableRow><TableHead>Date/Time</TableHead><TableHead>Table</TableHead><TableHead>Action</TableHead><TableHead>Record ID</TableHead><TableHead>Performed By</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs">{formatDate(r.performedAt)}</TableCell>
              <TableCell className="text-xs">{r.tableName}</TableCell>
              <TableCell className="capitalize">{r.action}</TableCell>
              <TableCell className="font-mono text-xs">{r.recordId.slice(0, 8)}…</TableCell>
              <TableCell className="font-mono text-xs">{r.performedBy ? r.performedBy.slice(0, 8) + "…" : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}
