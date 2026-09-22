import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Wallet, Upload, Download, CheckCircle2, AlertTriangle, ShieldAlert, Lock } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAssignableEmployees } from "@/hooks/useEmployees";
import { useHasPermission } from "@/hooks/usePermissions";
import {
  usePayrollAdmin,
  usePayrollPeriods,
  useComponentAmounts,
  useComponentImportCodes,
  useBulkSetComponentAmounts,
  usePreviewComponentImport,
  useCommitComponentImport,
} from "@/hooks/usePayroll";
import { formatDate } from "@/lib/utils";
import { formatAmount } from "@/modules/advance/utils";
import type { PayrollComponentImportPreview } from "@/types/payroll";

const IMMUTABLE = ["finalized", "locked", "reversed"];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Display label for a component code's Excel column / grid header. Falls back to a generic
 *  "Total <CODE> Amount" for any future Manual/Excel-import component a Super Admin configures
 *  (e.g. Bonus) — never a hard-coded, closed list. */
const COMPONENT_LABEL: Record<string, string> = { PF: "Total PF Amount", ESI: "Total ESIC Amount", INCENTIVE: "Total Incentive" };
const labelFor = (code: string) => COMPONENT_LABEL[code] ?? `Total ${code} Amount`;
const shortLabelFor = (code: string) => (code === "ESI" ? "ESIC" : code === "INCENTIVE" ? "Incentive" : code);

/**
 * Manual / Excel Import — the per-employee, per-payroll-period amount for any Salary/Statutory
 * component (PF, ESIC, Incentive, and any future one) whose calculation mode is set to "Manual /
 * Excel Import" in Payroll Settings → Salary Components. Manual grid + Excel import (template /
 * preview / validate / confirm). The SAME payroll pipeline consumes the stored amount on the next
 * Calculate — this is not a second payroll engine. OT is never eligible here — OT comes only from
 * Attendance → OT Rules.
 */
export function PayrollComponentAmountsPage() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;
  const adminQ = usePayrollAdmin(companyId);
  const isAdmin = adminQ.data === true || user?.role === "super_admin";

  const periodsQ = usePayrollPeriods(companyId, isAdmin);
  const periods = periodsQ.data ?? [];
  const [periodId, setPeriodId] = useState<string>("");
  const period = periods.find((p) => p.id === periodId) ?? periods[0];
  const editable = period ? !IMMUTABLE.includes(period.status) : false;

  const codesQ = useComponentImportCodes(companyId);
  const codes = codesQ.data ?? [];

  // Dynamic module/action permission (migration 0161/0176) — ADDITIVE on top of the Finance
  // Processor roster check above. Fails open (allowed=true) until a Super Admin explicitly
  // restricts module "payroll" action "EDIT"/"UPLOAD" for a dynamic role/user. Backend RPCs
  // enforce the same check independently — this is UI convenience, not the real gate.
  const canEdit = useHasPermission("payroll", "EDIT").allowed;
  const canUpload = useHasPermission("payroll", "UPLOAD").allowed;

  if (adminQ.isLoading) return <LoadingState />;
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Manual Component Amount Input" description="Enter or import per-employee, per-period amounts for components set to Manual / Excel Import." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="Payroll administration reuses the Finance Processor roster — you are not an active Finance Processor." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manual Component Amount Input"
        description="For any component set to “Manual / Excel Import” in Salary Components (PF, ESIC, Incentive, or a future one) — enter each employee’s amount for the payroll period, or import it from Excel. Re-run Payroll Calculate to fold the amounts into the payslips. Blank ≠ ₹0."
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm">Payroll period</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={period?.id ?? ""} onValueChange={setPeriodId}>
              <SelectTrigger className="h-9 w-56"><SelectValue placeholder="Pick a period" /></SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{formatDate(p.periodMonth)} — {p.status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {period && (
              <Badge variant={editable ? "warning" : "secondary"} className="capitalize">
                {!editable && <Lock className="mr-1 h-3 w-3" />}{period.status}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {periodsQ.isLoading || codesQ.isLoading ? (
            <LoadingState />
          ) : !period ? (
            <EmptyState icon={Wallet} title="No payroll period" description="Create a payroll period first." />
          ) : !editable ? (
            <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4" /> This period is <b className="mx-1 capitalize">{period.status}</b> — manual component amounts are immutable.
              Corrections go through the payroll reversal / correction process.
            </p>
          ) : (
            <Tabs defaultValue="manual">
              <TabsList>
                <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                <TabsTrigger value="import">Excel Import</TabsTrigger>
              </TabsList>
              <TabsContent value="manual" className="pt-3">
                <ManualGrid companyId={companyId as string} periodId={period.id} codes={codes} canEdit={canEdit} />
              </TabsContent>
              <TabsContent value="import" className="pt-3">
                <ExcelImport companyId={companyId as string} periodId={period.id} codes={codes} canUpload={canUpload} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------- manual grid ---------------------------------- */
function ManualGrid({ companyId, periodId, codes, canEdit }: { companyId: string; periodId: string; codes: string[]; canEdit: boolean }) {
  const empQ = useAssignableEmployees(companyId);
  const amtQ = useComponentAmounts(periodId);
  const save = useBulkSetComponentAmounts();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");

  const stored = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of amtQ.data ?? []) {
      if (a.employeeAmount != null) m[`${a.employeeId}:${a.componentCode}`] = String(a.employeeAmount);
    }
    return m;
  }, [amtQ.data]);

  // Source / last-updated per cell — for the tooltip only; the value itself comes from `stored`.
  const meta = useMemo(() => {
    const m: Record<string, { source: string; updatedAt: string | null }> = {};
    for (const a of amtQ.data ?? []) {
      m[`${a.employeeId}:${a.componentCode}`] = { source: a.source === "excel_import" ? "Excel Import" : "Manual", updatedAt: a.updatedAt };
    }
    return m;
  }, [amtQ.data]);
  const titleFor = (empId: string, code: string) => {
    const k = `${empId}:${code}`;
    const m = meta[k];
    if (!m) return undefined;
    return `Source: ${m.source}${m.updatedAt ? ` · Last updated ${formatDate(m.updatedAt)}` : ""}`;
  };

  const val = (empId: string, code: string) => {
    const k = `${empId}:${code}`;
    return k in draft ? draft[k] : (stored[k] ?? "");
  };
  const set = (empId: string, code: string, v: string) => setDraft((d) => ({ ...d, [`${empId}:${code}`]: v }));
  const dirty = Object.keys(draft).length > 0;

  const employees = (empQ.data ?? []).filter((e) =>
    !filter || e.fullName.toLowerCase().includes(filter.toLowerCase()) || (e.employeeCode ?? "").toLowerCase().includes(filter.toLowerCase()),
  );

  const totals = codes.map((c) => ({
    code: c,
    sum: (empQ.data ?? []).reduce((s, e) => {
      const v = val(e.id, c);
      return s + (v === "" ? 0 : Number(v) || 0);
    }, 0),
  }));

  const onSave = async () => {
    if (!canEdit) { toast({ title: "You do not have permission to edit payroll component amounts.", variant: "destructive" }); return; }
    const rows = Object.entries(draft).map(([k, v]) => {
      const [employeeId, componentCode] = k.split(":");
      return { employeeId, componentCode, employeeAmount: v.trim() === "" ? null : Number(v) };
    }).filter((r) => r.employeeAmount == null || (!Number.isNaN(r.employeeAmount) && r.employeeAmount >= 0));
    if (rows.length === 0) { toast({ title: "Nothing changed.", variant: "destructive" }); return; }
    try {
      const res = await save.mutateAsync({ periodId, rows });
      setDraft({});
      toast({ title: `Saved ${res.saved}, cleared ${res.cleared}. Re-run Payroll Calculate to apply.`, variant: "success" });
    } catch (e) { toast({ title: "Save failed", description: msg(e), variant: "destructive" }); }
  };

  if (empQ.isLoading || amtQ.isLoading) return <LoadingState rows={6} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input className="h-9 w-64" placeholder="Filter by name / staff ID…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {totals.map((t) => <span key={t.code}>Σ {shortLabelFor(t.code)}: <b className="text-foreground">{formatAmount(t.sum)}</b></span>)}
          <Button size="sm" onClick={onSave} disabled={!canEdit || !dirty || save.isPending}>{save.isPending ? "Saving…" : "Save amounts"}</Button>
        </div>
      </div>
      {!canEdit && (
        <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4" /> You have view-only access to Manual Component Amounts — editing is restricted for your role.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">Leave a cell blank = no amount supplied (the payroll result is flagged). Type <span className="font-mono">0</span> for an intentional zero. Hover an entered amount to see its source and last-updated date.</p>
      <div className="max-h-[55vh] overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow><TableHead>Employee</TableHead><TableHead>Staff ID</TableHead>{codes.map((c) => <TableHead key={c} className="w-32">{shortLabelFor(c)} Amount ₹</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.fullName}</TableCell>
                <TableCell className="font-mono text-xs">{e.employeeCode ?? "—"}</TableCell>
                {codes.map((c) => (
                  <TableCell key={c}>
                    <Input
                      type="number" className="h-8" value={val(e.id, c)} disabled={!canEdit}
                      onChange={(ev) => set(e.id, c, ev.target.value)} placeholder="—" title={titleFor(e.id, c)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ---------------------------------- excel import ---------------------------------- */
type RawRow = { rowNumber: number; staffId: string; staffName: string; amounts: Record<string, string> };

/** Header aliases a column is recognized under, per component code — generic for any future
 *  Manual/Excel-import component, not a hard-coded PF/ESI-only list. Keeps backward compatibility
 *  with the original "PF Amount"/"ESI Amount" style headers already in use. */
function aliasesFor(code: string): string[] {
  const label = labelFor(code); // "Total PF Amount" / "Total ESIC Amount" / "Total Incentive"
  const shortLabel = shortLabelFor(code); // "PF" / "ESIC" / "Incentive"
  return [label, `${shortLabel} Amount`, `${code} Amount`, code, `${code} Amt`, shortLabel];
}

function downloadTemplate(codes: string[]) {
  const headers = ["Employee Code", "Employee Name", ...codes.map(labelFor)];
  const sample = ["SAMPLE-001", "SAMPLE EMPLOYEE", ...codes.map(() => 0)];
  const notes = [
    [],
    ["The row above is a SAMPLE only — replace it with real rows before uploading."],
    ["Employee Code is authoritative. Employee Name is only a cross-check."],
    ["Blank amount = not supplied. Enter 0 for an intentional zero."],
    ["Overtime is NOT imported here — OT comes only from Attendance OT Rules."],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, sample, ...notes]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Manual Component Amounts");
  XLSX.writeFile(wb, "manual-component-amounts-template.xlsx");
}

function ExcelImport({ companyId, periodId, codes, canUpload }: { companyId: string; periodId: string; codes: string[]; canUpload: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [preview, setPreview] = useState<PayrollComponentImportPreview | null>(null);
  const previewMut = usePreviewComponentImport();
  const commitMut = useCommitComponentImport();
  const [done, setDone] = useState<string | null>(null);

  const pick = (k: Record<string, unknown>, ...names: string[]) => {
    for (const n of names) {
      const hit = Object.keys(k).find((h) => h.trim().toLowerCase() === n.toLowerCase());
      if (hit != null) return String(k[hit] ?? "").trim();
    }
    return "";
  };

  const onFile = async (file: File) => {
    setDone(null); setPreview(null);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const objs = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const parsed: RawRow[] = objs
      .map((o, i) => ({
        rowNumber: i + 2,
        staffId: pick(o, "Employee Code", "Staff ID", "StaffID", "Staff Id", "Employee ID", "Emp ID", "Code"),
        staffName: pick(o, "Employee Name", "Staff Name", "StaffName", "Name"),
        amounts: Object.fromEntries(codes.map((c) => [c, pick(o, ...aliasesFor(c))])),
      }))
      .filter((r) => r.staffId !== "" || r.staffName !== "" || Object.values(r.amounts).some((v) => v !== ""));
    setRows(parsed);
    setFileName(file.name);
    if (parsed.length === 0) { toast({ title: "No data rows found.", variant: "destructive" }); return; }
    try {
      const p = await previewMut.mutateAsync({ companyId, periodId, componentCodes: codes, rows: parsed });
      setPreview(p);
    } catch (e) { toast({ title: "Preview failed", description: msg(e), variant: "destructive" }); }
  };

  const errors = preview?.summary.errors ?? 0;
  const canConfirm = canUpload && preview != null && errors === 0 && rows.length > 0;

  const confirm = async () => {
    try {
      const res = await commitMut.mutateAsync({ companyId, periodId, componentCodes: codes, fileName, rows });
      setDone(`Imported ${res.imported}, updated ${res.updated}, blank skipped ${res.skippedBlank}. Σ ₹${formatAmount(res.employeeAmountTotal)}. ${res.note}`);
      setPreview(null); setRows([]); setFileName(null);
      toast({ title: "Import confirmed.", variant: "success" });
    } catch (e) { toast({ title: "Import failed", description: msg(e), variant: "destructive" }); }
  };

  const downloadErrors = () => {
    if (!preview) return;
    const bad = preview.rows.filter((r) => r.state === "error");
    const ws = XLSX.utils.json_to_sheet(bad.map((r) => ({
      "Row": r.rowNumber, "Employee Code": r.staffId, "Employee Name": r.staffName,
      ...Object.fromEntries(codes.map((c) => [labelFor(c), r.components[c]?.raw ?? ""])),
      "Errors": r.messages.join(" | "),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Errors");
    XLSX.writeFile(wb, "manual-component-import-errors.xlsx");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
        <p className="font-medium">Columns: Employee Code · Employee Name · {codes.map(labelFor).join(" · ")}</p>
        <p className="mt-1">Employee Code is the match key (company-scoped). Employee Name is a cross-check only. Blank ≠ ₹0. Overtime cannot be imported.</p>
      </div>

      {!canUpload && (
        <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4" /> Excel import is restricted for your role — you can still view this period, but Upload/Confirm are disabled.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => downloadTemplate(codes)}><Download className="mr-1 h-4 w-4" /> Download Template</Button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={!canUpload || previewMut.isPending}>
          <Upload className="mr-1 h-4 w-4" /> {previewMut.isPending ? "Reading…" : "Upload Excel"}
        </Button>
        {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
      </div>

      {done && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {done}
        </p>
      )}

      {preview && (
        <>
          <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-5">
            <div><p className="text-xs text-muted-foreground">Rows</p><p className="font-medium">{preview.summary.total_rows}</p></div>
            <div><p className="text-xs text-muted-foreground">Valid</p><p className="font-medium text-emerald-700">{preview.summary.valid}</p></div>
            <div><p className="text-xs text-muted-foreground">Warnings</p><p className="font-medium text-amber-700">{preview.summary.warnings}</p></div>
            <div><p className="text-xs text-muted-foreground">Errors</p><p className={`font-medium ${errors ? "text-destructive" : ""}`}>{errors}</p></div>
            <div><p className="text-xs text-muted-foreground">Σ amounts</p><p className="font-medium">{formatAmount(preview.summary.employee_amount_total)}</p></div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={confirm} disabled={!canConfirm || commitMut.isPending}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> {commitMut.isPending ? "Importing…" : `Confirm Import (${preview.summary.valid})`}
            </Button>
            {errors > 0 && <Button size="sm" variant="outline" onClick={downloadErrors}><Download className="mr-1 h-4 w-4" /> Download Error Report</Button>}
            {errors > 0 && <span className="self-center text-xs text-destructive">Fix {errors} error row(s) — nothing is imported until the file is clean.</span>}
          </div>

          <div className="max-h-[45vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Row</TableHead><TableHead>Employee Code</TableHead><TableHead>Employee Name</TableHead><TableHead>Matched</TableHead>
                  {codes.map((c) => <TableHead key={c}>{shortLabelFor(c)}</TableHead>)}
                  <TableHead>Status</TableHead><TableHead>Validation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.rowNumber} className={r.state === "error" ? "bg-destructive/5" : r.state === "warning" ? "bg-amber-50/60" : undefined}>
                    <TableCell className="text-xs">{r.rowNumber}</TableCell>
                    <TableCell className="font-mono text-xs">{r.staffId || "—"}</TableCell>
                    <TableCell className="text-xs">{r.staffName || "—"}</TableCell>
                    <TableCell className="text-xs">{r.matchedName ?? "—"}</TableCell>
                    {codes.map((c) => <TableCell key={c} className="text-xs">{cell(r.components[c])}</TableCell>)}
                    <TableCell>
                      <Badge variant={r.state === "error" ? "destructive" : r.state === "warning" ? "warning" : "success"} className="capitalize">{r.state}</Badge>
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{r.messages.join(" · ") || "OK"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function cell(c: { raw: string | null; value: number | null; supplied: boolean; zero: boolean } | undefined) {
  if (!c || !c.supplied) return <span className="text-muted-foreground">blank</span>;
  if (c.zero) return <span title="intentional zero">0</span>;
  return formatAmount(c.value ?? 0);
}
