import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Download, Eye, FileDown, UploadCloud } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { attendanceImportService } from "@/services/attendanceImportService";
import { useParseAndPreviewAttendanceImport, useCommitAttendanceImport } from "@/hooks/useAttendanceImport";
import { AttendanceImportPreviewTable } from "@/modules/attendance/components/AttendanceImportPreviewTable";
import { exportAttendanceToExcel } from "@/lib/attendanceExport";
import { ROUTES } from "@/constants/routes";
import type { AttendanceImportPreviewRow, AttendanceImportResult, AttendanceImportSummary } from "@/types/attendanceImport";

export function AttendanceImportPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "company_admin" || user?.role === "super_admin";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<AttendanceImportPreviewRow[] | null>(null);
  const [summary, setSummary] = useState<AttendanceImportSummary | null>(null);
  const [result, setResult] = useState<AttendanceImportResult | null>(null);

  const previewImport = useParseAndPreviewAttendanceImport();
  const commitImport = useCommitAttendanceImport();

  const validCount = useMemo(
    () => (rows ?? []).filter((r) => r.state === "valid" || r.state === "warning" || r.state === "update").length,
    [rows],
  );
  const hasErrors = useMemo(() => (rows ?? []).some((r) => r.state === "error"), [rows]);

  const handlePreview = async () => {
    if (!file || !user?.companyId) return;
    setResult(null);
    try {
      const { rows: previewRows, summary: previewSummary } = await previewImport.mutateAsync({ file, companyId: user.companyId });
      setRows(previewRows);
      setSummary(previewSummary);
    } catch (error) {
      toast({
        title: "Could not read file",
        description: error instanceof Error ? error.message : "Please check the file format and try again.",
        variant: "destructive",
      });
    }
  };

  const handleImport = async () => {
    if (!rows || !user?.companyId) return;
    try {
      const importResult = await commitImport.mutateAsync({ rows, companyId: user.companyId });
      setResult(importResult);
      toast({
        title: "Attendance Import Completed",
        description: `${importResult.imported} created, ${importResult.updated} updated. ${importResult.note}`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadErrorReport = () => {
    const errRows = (rows ?? []).filter((r) => r.state === "error");
    if (errRows.length === 0) return;
    exportAttendanceToExcel({
      fileNameBase: "attendance-import-errors",
      reportTitle: "Attendance Import — Error Report",
      metaLines: [`Rows with errors: ${errRows.length}`],
      columns: [
        { header: "Row", key: "rowNumber" },
        { header: "Staff ID", key: "staffId" },
        { header: "Staff Name", key: "staffName" },
        { header: "Date", key: "dateText" },
        { header: "Reason", key: "reason" },
      ],
      rows: errRows.map((r) => ({
        rowNumber: r.rowNumber,
        staffId: r.staffId || r.raw.staffId || "—",
        staffName: r.staffName || r.raw.staffName || "—",
        dateText: r.date ?? r.raw.date ?? "—",
        reason: r.errors.join(" ") || "Invalid row.",
      })),
    });
  };

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild className="w-fit">
          <Link to={ROUTES.attendance}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Attendance
          </Link>
        </Button>
        <EmptyState
          icon={ShieldAlert}
          title="Access restricted"
          description="Attendance import is only available to company administrators and super admins."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.attendance}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Attendance
        </Link>
      </Button>

      <PageHeader
        title="Import Attendance"
        description="Upload raw punches (Staff ID, Staff Name, Date, Punch In, Punch Out). Everything else is calculated automatically by HRMS."
      />

      <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
        Upload <strong>Staff ID, Staff Name, Date, Punch In and Punch Out only</strong>. Attendance status, late,
        overtime, weekly off, half day and other calculations are generated automatically from the configured
        Shift, Employee Schedule, Attendance Rules, Weekly Off, Holiday and Leave configuration — using the same
        engine as a manual attendance correction. Payroll is not changed by this import; re-run the Payroll
        Calculate step for the affected period afterwards.
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 1: Download Sample File</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => attendanceImportService.downloadSampleTemplate()}>
            <Download className="mr-2 h-4 w-4" />
            Download Sample Excel
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            Columns: <strong>Staff ID, Staff Name, Date, Punch In, Punch Out</strong>. Staff ID (employee code) is
            the authoritative match key — Staff Name is a cross-check only. Date format DD/MM/YYYY; times like
            <span className="font-mono"> 02:30 PM</span> or <span className="font-mono">14:30</span>. Do NOT include
            a Status column.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 2: Upload Attendance File</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setRows(null);
              setSummary(null);
              setResult(null);
            }}
            className="block w-full max-w-sm text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
          />
          <Button onClick={handlePreview} disabled={!file || previewImport.isPending}>
            <Eye className="mr-2 h-4 w-4" />
            {previewImport.isPending ? "Reading file…" : "Preview Import"}
          </Button>
        </CardContent>
      </Card>

      {summary && rows && (
        <Card>
          <CardHeader>
            <CardTitle>Step 3: Review Calculated Attendance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span>Total: <strong>{summary.total}</strong></span>
              <span className="text-emerald-600">New: <strong>{summary.new}</strong></span>
              <span className="text-blue-600">Updates: <strong>{summary.updates}</strong></span>
              <span className="text-amber-600">Warnings: <strong>{summary.warnings}</strong></span>
              <span className="text-destructive">Errors: <strong>{summary.errors}</strong></span>
            </div>
            <AttendanceImportPreviewTable rows={rows} />
          </CardContent>
        </Card>
      )}

      {rows && !result && (
        <div className="flex flex-col items-end gap-2">
          {hasErrors && (
            <p className="text-sm text-destructive">
              Fix every error row and preview again — the import is all-or-nothing and will not partially save.
            </p>
          )}
          <div className="flex gap-2">
            {hasErrors && (
              <Button variant="outline" onClick={handleDownloadErrorReport}>
                <FileDown className="mr-2 h-4 w-4" />
                Download Error Report
              </Button>
            )}
            <Button onClick={handleImport} disabled={commitImport.isPending || validCount === 0 || hasErrors}>
              <UploadCloud className="mr-2 h-4 w-4" />
              {commitImport.isPending ? "Importing…" : `Confirm Import (${validCount})`}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Attendance Import Completed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Created</p>
                <p className="text-lg font-semibold text-emerald-600">{result.imported}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Updated</p>
                <p className="text-lg font-semibold text-blue-600">{result.updated}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Skipped</p>
                <p className="text-lg font-semibold text-amber-600">{result.skipped}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{result.note}</p>
            {result.affectedPeriods.length > 0 && (
              <p className="text-sm">
                Affected payroll period(s): <strong>{result.affectedPeriods.join(", ")}</strong> — re-run
                Payroll Calculate to refresh salary.
              </p>
            )}
            <Button asChild>
              <Link to={ROUTES.attendance}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                View Attendance
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
