import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, UploadCloud, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { EmployeeImportPreviewTable } from "../components/EmployeeImportPreviewTable";
import { DesignationCascadeSelect } from "../components/DesignationCascadeSelect";
import { useParseAndValidateImport, useCommitImport } from "@/hooks/useEmployeeImport";
import { employeeImportService } from "@/services/employeeImportService";
import { useStores } from "@/hooks/useStores";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { EmployeeImportPreviewRow, EmployeeImportSummary } from "@/types/employee";

export function EmployeeImportPage() {
  const { user } = useAuth();
  const { data: stores } = useStores(user?.companyId ?? undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<EmployeeImportPreviewRow[] | null>(null);
  const [summary, setSummary] = useState<EmployeeImportSummary | null>(null);
  const [mappingChoice, setMappingChoice] = useState<Record<number, string>>({});

  const validateImport = useParseAndValidateImport();
  const commitImport = useCommitImport();

  const counts = useMemo(() => {
    if (!rows) return null;
    return {
      total: rows.length,
      valid: rows.filter((r) => r.state === "valid").length,
      error: rows.filter((r) => r.state === "error").length,
      duplicate: rows.filter((r) => r.state === "duplicate").length,
      needsMapping: rows.filter((r) => r.state === "needs_mapping").length,
    };
  }, [rows]);

  const needsMappingRows = (rows ?? []).filter((r) => r.state === "needs_mapping");

  const handleValidate = async () => {
    if (!file || !user?.companyId) return;
    try {
      const result = await validateImport.mutateAsync({ file, companyId: user.companyId });
      setRows(result);
      setSummary(null);
    } catch (error) {
      toast({
        title: "Could not read file",
        description: error instanceof Error ? error.message : "Please check the file format and try again.",
        variant: "destructive",
      });
    }
  };

  const applyMapping = (rowNumber: number, storeId: string, storeDesignationId: string) => {
    setRows((prev) =>
      (prev ?? []).map((row) =>
        row.rowNumber === rowNumber
          ? { ...row, state: "valid", resolvedStoreId: storeId, resolvedDesignationId: storeDesignationId, errors: [] }
          : row
      )
    );
  };

  const handleImport = async () => {
    if (!rows || !file || !user?.companyId) return;
    try {
      const result = await commitImport.mutateAsync({
        fileName: file.name,
        companyId: user.companyId,
        rows,
        performedBy: user.id,
      });
      setSummary(result);
      toast({ title: "Import complete", description: `${result.importedRows} employee(s) imported.`, variant: "success" });
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.employees}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Employees
        </Link>
      </Button>

      <PageHeader
        title="Import Employees"
        description="Upload a CSV or Excel file. Store, Department, and Designation are matched automatically when they already exist."
        actions={
          <Button variant="outline" onClick={() => employeeImportService.downloadSampleTemplate()}>
            <Download className="mr-2 h-4 w-4" />
            Download Sample Format
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Upload File</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full max-w-sm text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
          />
          <Button onClick={handleValidate} disabled={!file || validateImport.isPending}>
            <UploadCloud className="mr-2 h-4 w-4" />
            {validateImport.isPending ? "Validating…" : "Validate File"}
          </Button>
        </CardContent>
      </Card>

      {counts && (
        <Card>
          <CardHeader>
            <CardTitle>2. Preview &amp; Validation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span>Total rows: <strong>{counts.total}</strong></span>
              <span className="text-emerald-600">Ready: <strong>{counts.valid}</strong></span>
              <span className="text-destructive">Errors: <strong>{counts.error}</strong></span>
              <span className="text-amber-600">Duplicates: <strong>{counts.duplicate}</strong></span>
              <span className="text-muted-foreground">Needs Mapping: <strong>{counts.needsMapping}</strong></span>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <EmployeeImportPreviewTable rows={rows ?? []} />
            </div>
          </CardContent>
        </Card>
      )}

      {needsMappingRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Resolve Mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              These rows reference a Department or Designation that doesn&apos;t exist yet in the target store. Pick
              the correct designation manually to include them in the import.
            </p>
            {needsMappingRows.map((row) => {
              const store = (stores ?? []).find((s) => s.name.trim().toLowerCase() === row.raw.store.trim().toLowerCase());
              return (
                <div key={row.rowNumber} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      Row {row.rowNumber} · {row.raw.employeeName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.raw.store} / {row.raw.department} / {row.raw.designation}
                    </p>
                  </div>
                  <div className="w-full sm:w-64">
                    <Label className="sr-only">Designation</Label>
                    <DesignationCascadeSelect
                      storeId={store?.id}
                      value={mappingChoice[row.rowNumber]}
                      onChange={(designationId) => {
                        setMappingChoice((prev) => ({ ...prev, [row.rowNumber]: designationId }));
                        if (store) applyMapping(row.rowNumber, store.id, designationId);
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {rows && (
        <div className="flex justify-end">
          <Button onClick={handleImport} disabled={commitImport.isPending}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {commitImport.isPending ? "Importing…" : "Import Valid Rows"}
          </Button>
        </div>
      )}

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Import Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div><p className="text-muted-foreground">Total</p><p className="text-lg font-semibold">{summary.totalRows}</p></div>
            <div><p className="text-muted-foreground">Valid</p><p className="text-lg font-semibold">{summary.validRows}</p></div>
            <div><p className="text-muted-foreground">Employees Created</p><p className="text-lg font-semibold text-emerald-600">{summary.importedRows}</p></div>
            <div><p className="text-muted-foreground">Codes Generated</p><p className="text-lg font-semibold text-emerald-600">{summary.codesGenerated}</p></div>
            <div><p className="text-muted-foreground">Existing/Skipped</p><p className="text-lg font-semibold">{summary.skippedRows}</p></div>
            <div><p className="text-muted-foreground">Failed</p><p className="text-lg font-semibold text-destructive">{summary.errorRows}</p></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
