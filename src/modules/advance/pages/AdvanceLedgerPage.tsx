import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ShieldAlert, Download, ChevronLeft, ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";

import { useAuth } from "@/hooks/useAuth";
import {
  useAdvanceLedgerStores,
  useLedgerStoreDepartments,
  useLedgerStoreDesignations,
  useAdvanceLedgerList,
  useAdvanceLedgerSummary,
  useAdvanceLedgerEmployeeAdvances,
} from "@/hooks/useAdvance";
import { advanceService } from "@/services/advanceService";
import { RecoveryDetailDialog } from "@/modules/advance/pages/AdvanceRecoveryPage";
import { AdvanceReceiptSection } from "@/modules/advance/components/AdvanceReceiptSection";
import { EmployeeSearchBar } from "@/modules/employees/components/EmployeeSearchBar";
import { formatAmount, formatDateTime, ADVANCE_STATUS_LABEL, ADVANCE_STATUS_VARIANT } from "@/modules/advance/utils";
import { formatDate } from "@/lib/utils";
import { exportAttendanceToExcel, type ExportColumn } from "@/lib/attendanceExport";
import type { AdvanceLedgerFilters, AdvanceLedgerRow, AdvanceRequestStatus } from "@/types/advance";

const PAGE_SIZE = 50;

/** Derived, display-only employee-level status (spec item 17 — never a stored DB column). */
const DERIVED_STATUS_LABEL: Record<string, string> = {
  no_advance: "No Advance",
  pending: "Pending",
  active: "Active",
  partially_recovered: "Partially Recovered",
  fully_recovered: "Fully Recovered",
  closed: "Closed",
};
const DERIVED_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  no_advance: "secondary",
  pending: "warning",
  active: "warning",
  partially_recovered: "warning",
  fully_recovered: "success",
  closed: "secondary",
};

/** advance_requests.status — the real, existing enum values (never duplicated/invented). */
const ADVANCE_STATUS_OPTIONS = Object.keys(ADVANCE_STATUS_LABEL) as AdvanceRequestStatus[];

/**
 * Advance Management — operational, staff-wise Advance Ledger (MAIN sidebar). Distinct from
 * Settings -> Advance Settings (configuration only — AdvanceManagementPage.tsx). Every amount here
 * is READ, never recomputed, from the existing Advance Recovery engine (migration 0136) via the
 * new read-only advance_ledger_* RPCs (migration 0154): no parallel recovery calculation, no new
 * Advance table. "Staff ID / Name / Mobile / Email" search (spec item 10) doubles as the Employee
 * filter (spec item 9) rather than loading all ~500 employees into a picker just to duplicate it.
 */
export function AdvanceLedgerPage() {
  const { user } = useAuth();
  const isStaff = user?.role === "staff";

  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [departmentId, setDepartmentId] = useState<string | undefined>(undefined);
  const [designationId, setDesignationId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [detailEmployee, setDetailEmployee] = useState<AdvanceLedgerRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const storesQ = useAdvanceLedgerStores(!isStaff);
  const storesData = storesQ.data;
  const stores = storesData ?? [];

  // Auto-select the caller's single authorized store (HR Store-access restriction, enforced
  // server-side regardless — see migration 0154 — this only pre-fills the dropdown).
  useEffect(() => {
    if (storesData && storesData.length === 1 && !storeId) setStoreId(storesData[0].id);
  }, [storesData, storeId]);

  // Debounce the free-text search, same idea as every other list page's typed filter.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [storeId, departmentId, designationId, status, dateFrom, dateTo, showAll, search]);

  const deptQ = useLedgerStoreDepartments(!isStaff ? storeId : undefined);
  const desigQ = useLedgerStoreDesignations(!isStaff ? storeId : undefined);

  const filters: AdvanceLedgerFilters = useMemo(
    () => ({
      storeId: storeId ?? null,
      departmentId: departmentId ?? null,
      designationId: designationId ?? null,
      status: status ?? null,
      search: search || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      showAll,
    }),
    [storeId, departmentId, designationId, status, search, dateFrom, dateTo, showAll]
  );

  const listQ = useAdvanceLedgerList(filters, { limit: PAGE_SIZE, offset: page * PAGE_SIZE }, !isStaff);
  const summaryQ = useAdvanceLedgerSummary(filters, !isStaff);

  const rows = listQ.data?.rows ?? [];
  const totalCount = listQ.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const summary = summaryQ.data;

  const hasActiveFilters = Boolean(departmentId || designationId || status || dateFrom || dateTo || search || showAll || (stores.length > 1 && storeId));
  const clearFilters = () => {
    setStoreId(stores.length === 1 ? stores[0].id : undefined);
    setDepartmentId(undefined);
    setDesignationId(undefined);
    setStatus(undefined);
    setDateFrom("");
    setDateTo("");
    setShowAll(false);
    setSearchInput("");
    setSearch("");
  };

  const exportLedger = async () => {
    setExporting(true);
    try {
      const full = await advanceService.ledgerList(filters, { limit: 5000, offset: 0 });
      const columns: ExportColumn[] = [
        { header: "Staff ID", key: "staffId" },
        { header: "Staff Name", key: "staffName" },
        { header: "Store", key: "store" },
        { header: "Department", key: "department" },
        { header: "Designation", key: "designation" },
        { header: "Total Approved", key: "approved" },
        { header: "Total Paid", key: "paid" },
        { header: "Total Recovered", key: "recovered" },
        { header: "Outstanding", key: "outstanding" },
        { header: "Status", key: "status" },
      ];
      const exportRows = full.rows.map((r) => ({
        staffId: r.employeeCode ?? "—",
        staffName: r.fullName,
        store: r.storeName ?? "—",
        department: r.departmentName ?? "—",
        designation: r.designationTitle ?? "—",
        approved: r.totalApproved,
        paid: r.totalPaid,
        recovered: r.totalRecovered,
        outstanding: r.totalOutstanding,
        status: DERIVED_STATUS_LABEL[r.status] ?? r.status,
      }));
      exportAttendanceToExcel({
        fileNameBase: "advance-ledger",
        reportTitle: "Advance Management — Staff-wise Advance Ledger",
        metaLines: [
          `Store: ${storeId ? stores.find((s) => s.id === storeId)?.name ?? "—" : "All Stores"}`,
          `Generated: ${formatDateTime(new Date().toISOString())}`,
        ],
        columns,
        rows: exportRows,
      });
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (isStaff) {
    return (
      <div className="space-y-6">
        <PageHeader title="Advance Management" description="View and manage employee advance ledger, deductions and outstanding balances." />
        <EmptyState
          icon={ShieldAlert}
          title="Restricted"
          description="The Advance Ledger is available to HR / Admin users only. Your own advances are under Advances in the sidebar."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advance Management"
        description="View and manage employee advance ledger, deductions and outstanding balances."
        actions={
          <Button variant="secondary" onClick={exportLedger} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Exporting…" : "Export Excel"}
          </Button>
        }
      />

      {/* Summary cards — spec item 11. Built from the same rows the table shows (advance_ledger_
          summary shares advance_ledger_rows with advance_ledger_list), so these can never disagree
          with what's listed below. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Total Staff with Advance" value={summary ? String(summary.totalStaff) : "—"} loading={summaryQ.isLoading} />
        <SummaryCard label="Total Approved Advance" value={formatAmount(summary?.totalApproved ?? null)} loading={summaryQ.isLoading} />
        <SummaryCard label="Total Paid" value={formatAmount(summary?.totalPaid ?? null)} loading={summaryQ.isLoading} />
        <SummaryCard label="Total Recovered" value={formatAmount(summary?.totalRecovered ?? null)} loading={summaryQ.isLoading} />
        <SummaryCard label="Total Outstanding" value={formatAmount(summary?.totalOutstanding ?? null)} loading={summaryQ.isLoading} accent />
      </div>

      {/* Filters — spec item 9. Store is first and drives Department/Designation (spec item 3). */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Store</Label>
              <Select
                value={storeId ?? "all"}
                onValueChange={(v) => {
                  setStoreId(v === "all" ? undefined : v);
                  setDepartmentId(undefined);
                  setDesignationId(undefined);
                }}
                disabled={stores.length === 1}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Store" />
                </SelectTrigger>
                <SelectContent>
                  {stores.length !== 1 && <SelectItem value="all">All Stores</SelectItem>}
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={departmentId ?? "all"} onValueChange={(v) => setDepartmentId(v === "all" ? undefined : v)} disabled={!storeId}>
                <SelectTrigger>
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {(deptQ.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Designation</Label>
              <Select value={designationId ?? "all"} onValueChange={(v) => setDesignationId(v === "all" ? undefined : v)} disabled={!storeId}>
                <SelectTrigger>
                  <SelectValue placeholder="All Designations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Designations</SelectItem>
                  {(desigQ.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Advance Status</Label>
              <Select value={status ?? "all"} onValueChange={(v) => setStatus(v === "all" ? undefined : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {ADVANCE_STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {ADVANCE_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Date From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Date To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Search (Staff ID, Name, Mobile, Email)</Label>
              <EmployeeSearchBar value={searchInput} onChange={setSearchInput} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={showAll} onCheckedChange={(v) => setShowAll(Boolean(v))} />
              Show All Staff (including employees with no Advance)
            </label>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Staff-wise ledger table — spec item 4 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff-wise Advance Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <LoadingState rows={8} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="No matching staff."
              description={showAll ? "No employees match these filters." : "No employees with an Advance match these filters. Try 'Show All Staff'."}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff ID</TableHead>
                      <TableHead>Staff Name</TableHead>
                      <TableHead>Store</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Designation</TableHead>
                      <TableHead className="text-right">Total Advance Approved</TableHead>
                      <TableHead className="text-right">Total Amount Paid</TableHead>
                      <TableHead className="text-right">Total Recovered / Deducted</TableHead>
                      <TableHead className="text-right">Remaining Outstanding</TableHead>
                      <TableHead>Current Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.employeeId}>
                        <TableCell className="font-mono text-xs">{r.employeeCode ?? "—"}</TableCell>
                        <TableCell className="font-medium">{r.fullName}</TableCell>
                        <TableCell className="text-xs">{r.storeName ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.departmentName ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.designationTitle ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">{formatAmount(r.totalApproved)}</TableCell>
                        <TableCell className="text-right text-xs">{formatAmount(r.totalPaid)}</TableCell>
                        <TableCell className="text-right text-xs">{formatAmount(r.totalRecovered)}</TableCell>
                        <TableCell className="text-right text-xs font-medium text-amber-700">{formatAmount(r.totalOutstanding)}</TableCell>
                        <TableCell>
                          <Badge variant={DERIVED_STATUS_VARIANT[r.status] ?? "secondary"}>{DERIVED_STATUS_LABEL[r.status] ?? r.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setDetailEmployee(r)} disabled={r.advanceCount === 0}>
                            View Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {totalCount} staff{hasActiveFilters ? " (filtered)" : ""}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                  <span>
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page + 1 >= totalPages}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {detailEmployee && (
        <EmployeeAdvanceDetailDialog row={detailEmployee} companyId={user?.companyId ?? undefined} onClose={() => setDetailEmployee(null)} />
      )}
    </div>
  );
}

function SummaryCard({ label, value, accent, loading }: { label: string; value: string; accent?: boolean; loading?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-semibold ${accent ? "text-amber-700" : ""}`}>{loading ? "…" : value}</p>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Employee Advance Detail — per-advance breakdown + recovery history (spec item 8). Reuses the
// EXISTING RecoveryDetailDialog / Advance Recovery engine (migration 0136) read-only — Early
// Settlement / Close Advance remain on the dedicated Advance Recovery page, same convention
// AdvanceManagementPage.tsx's own Recovery tab already uses.
// ===========================================================================
// Statuses reachable only AFTER Finance has recorded a payment — the point at which a Signed
// Staff Receipt could exist. Mirrors ADVANCE_STATUS_LABEL's own Phase 3/4 grouping.
const PAID_OR_LATER_STATUS = new Set<AdvanceRequestStatus>(["paid", "recovery_pending", "recovering", "settled", "closed"]);

function EmployeeAdvanceDetailDialog({ row, companyId, onClose }: { row: AdvanceLedgerRow; companyId?: string; onClose: () => void }) {
  const advancesQ = useAdvanceLedgerEmployeeAdvances(row.employeeId);
  const [recoveryDetailId, setRecoveryDetailId] = useState<string | null>(null);
  const [receiptDetailId, setReceiptDetailId] = useState<string | null>(null);
  const advances = advancesQ.data ?? [];

  const exportDetail = () => {
    const columns: ExportColumn[] = [
      { header: "Advance ID", key: "id" },
      { header: "Advance Type", key: "type" },
      { header: "Request Date", key: "requestDate" },
      { header: "Requested Amount", key: "requested" },
      { header: "Manager Recommended", key: "managerRec" },
      { header: "Boss Approved", key: "bossApproved" },
      { header: "Actual Paid", key: "paid" },
      { header: "Payment Date", key: "paymentDate" },
      { header: "Recovery Start", key: "recoveryStart" },
      { header: "Recovered Amount", key: "recovered" },
      { header: "Outstanding", key: "outstanding" },
      { header: "Status", key: "status" },
    ];
    const exportRows = advances.map((a) => ({
      id: a.advanceRequestId,
      type: a.advanceTypeName,
      requestDate: formatDate(a.requestDate),
      requested: a.requestedAmount,
      managerRec: a.managerRecommendedAmount ?? "",
      bossApproved: a.bossApprovedAmount ?? "",
      paid: a.actualPaidAmount ?? "",
      paymentDate: a.paymentDate ? formatDate(a.paymentDate) : "",
      recoveryStart: a.recoveryStartDate ? formatDate(a.recoveryStartDate) : "",
      recovered: a.totalRecovered,
      outstanding: a.outstandingAmount,
      status: ADVANCE_STATUS_LABEL[a.status] ?? a.status,
    }));
    exportAttendanceToExcel({
      fileNameBase: `advance-ledger-${row.employeeCode ?? row.employeeId}`,
      reportTitle: `Advance Ledger — ${row.fullName}`,
      metaLines: [`Staff ID: ${row.employeeCode ?? "—"}`, `Store: ${row.storeName ?? "—"}`],
      columns,
      rows: exportRows,
    });
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{row.fullName} — Advance Ledger</DialogTitle>
            <DialogDescription>
              Staff ID: {row.employeeCode ?? "—"} · {row.storeName ?? "—"} · {row.departmentName ?? "—"} · {row.designationTitle ?? "—"}
            </DialogDescription>
          </DialogHeader>

          <section className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-4">
            <Amt label="Total Approved" v={row.totalApproved} />
            <Amt label="Total Paid" v={row.totalPaid} />
            <Amt label="Total Recovered" v={row.totalRecovered} />
            <Amt label="Total Outstanding" v={row.totalOutstanding} amber />
          </section>

          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={exportDetail} disabled={advances.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export Ledger
            </Button>
          </div>

          {advancesQ.isLoading ? (
            <LoadingState rows={3} />
          ) : advances.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No advances for this employee." />
          ) : (
            <div className="space-y-3">
              {advances.map((a, i) => (
                <Card key={a.advanceRequestId}>
                  <CardHeader className="flex flex-row items-center justify-between py-3">
                    <CardTitle className="text-sm">
                      Advance {i + 1} — {a.advanceTypeName}
                    </CardTitle>
                    <Badge variant={ADVANCE_STATUS_VARIANT[a.status] ?? "secondary"}>{ADVANCE_STATUS_LABEL[a.status] ?? a.status}</Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                      <Field label="Request Date">{formatDate(a.requestDate)}</Field>
                      <Field label="Requested Amount">{formatAmount(a.requestedAmount)}</Field>
                      <Field label="Manager Recommended">{formatAmount(a.managerRecommendedAmount)}</Field>
                      <Field label="Boss Approved Amount">{formatAmount(a.bossApprovedAmount)}</Field>
                      <Field label="Actual Paid Amount">{formatAmount(a.actualPaidAmount)}</Field>
                      <Field label="Payment Date">{a.paymentDate ? formatDate(a.paymentDate) : "—"}</Field>
                      <Field label="Recovery Start">{a.recoveryStartDate ? formatDate(a.recoveryStartDate) : "—"}</Field>
                      <Field label="Total Recovered">{formatAmount(a.totalRecovered)}</Field>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                      <span className="text-xs font-medium">
                        Remaining Outstanding: <span className="text-amber-700">{formatAmount(a.outstandingAmount)}</span>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setRecoveryDetailId(a.advanceRequestId)}>
                        Recovery History
                      </Button>
                      {PAID_OR_LATER_STATUS.has(a.status) && (
                        <Button size="sm" variant="ghost" onClick={() => setReceiptDetailId(a.advanceRequestId)}>
                          Receipt
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Recovery installments / transaction history — the EXISTING Advance Recovery engine
          (advance_get_recovery_detail / advance_list_recovery_installments / advance_list_recovery_
          transactions, migration 0136), read-only here. Early Settlement / Close Advance are
          intentionally NOT exposed on this reporting page — see the dedicated Advance Recovery
          page for those actions. */}
      <RecoveryDetailDialog requestId={recoveryDetailId} activeModes={[]} onClose={() => setRecoveryDetailId(null)} readOnly />

      {/* Signed Staff Receipt (migration 0160) — read-only from the Ledger; Upload/Replace stays
          on the Finance / HR pages where the authorized processor actually handles the payment. */}
      <Dialog open={Boolean(receiptDetailId)} onOpenChange={(o) => !o && setReceiptDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Signed Staff Receipt</DialogTitle>
          </DialogHeader>
          {receiptDetailId && <AdvanceReceiptSection advanceRequestId={receiptDetailId} companyId={companyId} canManage={false} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Amt({ label, v, amber }: { label: string; v: number; amber?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold ${amber ? "text-amber-700" : ""}`}>{formatAmount(v)}</p>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">{children}</p>
    </div>
  );
}
