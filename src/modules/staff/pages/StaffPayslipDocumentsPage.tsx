import { useState } from "react";
import { Download, Eye, FileText, Wallet, Printer } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import { useEmployeeDocuments } from "@/hooks/useEmployeeDocuments";
import { useMyPayslips, usePayslip } from "@/hooks/usePayroll";
import { employeeDocumentService } from "@/services/employeeDocumentService";
import { DOCUMENT_TYPE_LABELS } from "@/constants/documentTypes";
import { formatDate } from "@/lib/utils";
import { formatAmount } from "@/modules/advance/utils";

/**
 * Staff Panel — Payslip & Documents.
 *
 * Documents: REAL data — reuses the EXISTING employee_documents table/service/hook
 * (useEmployeeDocuments/employeeDocumentService, the same ones the admin Employee Documents tool
 * already uses), scoped ONLY to the logged-in Staff's own employeeId — resolved via
 * useCurrentEmployee() the same way every other Staff Panel page does, never from a URL/route
 * param, so there is no way to reach another employee's documents through this page. (Note: the
 * underlying employee_documents RLS SELECT policy is company-wide, not per-employee — a pre-
 * existing characteristic of that table, not something this UI-only task changes or weakens; this
 * page's own query is still always scoped to "self" at the application layer.)
 *
 * Payslip: REAL data from the Phase 5 Payroll Engine — payroll_list_my_payslips() /
 * payroll_get_payslip() are self-scoped (current_user_employee_id() server-side), so this page can
 * only ever show the logged-in employee's own finalized payslips. Historical payslips are immutable
 * snapshots and never change when salary later changes.
 */
export function StaffPayslipDocumentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const employeeId = currentEmployeeQuery.data?.id;
  const documentsQuery = useEmployeeDocuments(employeeId);
  const payslipsQuery = useMyPayslips();
  const [payslipResultId, setPayslipResultId] = useState<string | null>(null);

  const handleOpen = async (storagePath: string) => {
    try {
      const url = await employeeDocumentService.getSignedUrl(storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Could not open document",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Payslip & Documents" description="Download your monthly payslips and manage documents." />

      <Card>
        <CardHeader>
          <CardTitle>My Payslips</CardTitle>
        </CardHeader>
        <CardContent>
          {payslipsQuery.isLoading ? (
            <LoadingState />
          ) : (payslipsQuery.data ?? []).length === 0 ? (
            <EmptyState icon={Wallet} title="No payslips yet" description="Your monthly payslip appears here once payroll for that month is finalized." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead><TableHead>Gross</TableHead><TableHead>Deductions</TableHead>
                    <TableHead>Advance Recovery</TableHead><TableHead>Net Pay</TableHead><TableHead>Status</TableHead><TableHead>Payslip</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(payslipsQuery.data ?? []).map((p) => (
                    <TableRow key={p.resultId}>
                      <TableCell className="font-medium">{formatDate(p.periodMonth)}</TableCell>
                      <TableCell>{formatAmount(p.grossEarnings)}</TableCell>
                      <TableCell>{formatAmount(p.totalDeductions)}</TableCell>
                      <TableCell className="text-amber-700">{formatAmount(p.advanceRecoveryAmount)}</TableCell>
                      <TableCell className="font-medium">{formatAmount(p.netSalary)}</TableCell>
                      <TableCell>
                        <Badge variant={p.runStatus === "reversed" ? "destructive" : "success"} className="capitalize">
                          {p.runStatus === "reversed" ? "Reversed" : "Finalized"}
                        </Badge>
                      </TableCell>
                      <TableCell><Button size="sm" variant="ghost" onClick={() => setPayslipResultId(p.resultId)}><Eye className="mr-1 h-4 w-4" /> View</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PayslipDialog resultId={payslipResultId} onClose={() => setPayslipResultId(null)} />

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {documentsQuery.isLoading ? (
            <LoadingState />
          ) : documentsQuery.isError ? (
            <p className="text-sm text-destructive">Documents could not be loaded.</p>
          ) : (documentsQuery.data ?? []).length === 0 ? (
            <EmptyState icon={FileText} title="No documents yet" description="Documents uploaded by your administrator will appear here." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(documentsQuery.data ?? []).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType}</p>
                      <p className="text-xs text-muted-foreground">Uploaded {formatDate(doc.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" title="View" onClick={() => handleOpen(doc.storagePath)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Download" onClick={() => handleOpen(doc.storagePath)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PayslipDialog({ resultId, onClose }: { resultId: string | null; onClose: () => void }) {
  const q = usePayslip(resultId ?? undefined);
  const s = q.data ?? null;
  return (
    <Dialog open={Boolean(resultId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payslip</DialogTitle>
        </DialogHeader>
        {q.isLoading || !s ? (
          <LoadingState rows={6} />
        ) : (
          <div id="payslip-print" className="space-y-4 text-sm">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-base font-semibold">{s.company?.name}</p>
                <p className="text-xs text-muted-foreground">{[s.company?.city, s.company?.state].filter(Boolean).join(", ")}</p>
              </div>
              <div className="text-right text-xs">
                <p className="font-medium">Payslip — {s.period?.month}</p>
                <p className="text-muted-foreground">{formatDate(s.period?.start)} – {formatDate(s.period?.end)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div><span className="text-muted-foreground">Name: </span>{s.employee?.name}</div>
              <div><span className="text-muted-foreground">Code: </span>{s.employee?.code ?? "—"}</div>
              <div><span className="text-muted-foreground">Store: </span>{s.employee?.store ?? "—"}</div>
              <div><span className="text-muted-foreground">Department: </span>{s.employee?.department ?? "—"}</div>
              <div><span className="text-muted-foreground">Designation: </span>{s.employee?.designation ?? "—"}</div>
              <div><span className="text-muted-foreground">Paid / Unpaid days: </span>{s.days?.paid} / {s.days?.unpaid}</div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 font-medium">Earnings</p>
                <table className="w-full text-xs">
                  <tbody>
                    {(s.earnings ?? []).map((e, i) => (
                      <tr key={i}><td>{e.name}</td><td className="text-right">{formatAmount(e.amount)}</td></tr>
                    ))}
                    <tr className="border-t font-medium"><td>Gross Earnings</td><td className="text-right">{formatAmount(s.gross_earnings)}</td></tr>
                  </tbody>
                </table>
              </div>
              <div>
                <p className="mb-1 font-medium">Deductions</p>
                <table className="w-full text-xs">
                  <tbody>
                    {(s.deductions ?? []).map((e, i) => (
                      <tr key={i}><td>{e.name}</td><td className="text-right">{formatAmount(e.amount)}</td></tr>
                    ))}
                    <tr className="border-t font-medium"><td>Total Deductions</td><td className="text-right">{formatAmount(s.total_deductions)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center font-semibold text-emerald-800">
              Net Salary: {formatAmount(s.net_salary)}
            </div>
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" /> Print</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
