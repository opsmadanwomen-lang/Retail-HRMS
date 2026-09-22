import { useEffect, useState } from "react";
import { AlertTriangle, Wand2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingState } from "@/components/common/LoadingState";
import { useHasPermission } from "@/hooks/usePermissions";
import { useEmployeeSalaryAssignments, usePayrollAdmin, useSalaryPreviewForGross, useSalarySlabRules } from "@/hooks/usePayroll";
import { formatAmount } from "@/modules/advance/utils";
import { ReadOnlyField, PreviewBlock, ReviewIssues } from "@/modules/payroll/components/SalaryPreviewParts";
import { errText, reviewIssues, slabText, splitPreview } from "@/modules/payroll/salaryPreview";
import { computeSalaryIntent, type SalaryDraft, type SalaryIntent } from "@/modules/employees/salaryDraft";


/**
 * Payroll Salary — the ONLY place salary is maintained (Employees → Add / Edit). The user enters Gross Salary and Effective From;
 * Grade, Salary Structure and Salary Slab are RESULTS of the server-side resolver, and the bifurcation is the server's salary_bifurcate.
 * Saving goes through the existing salary revision function (salary_assign_employee), so history, closed-period protection and
 * permissions are exactly the existing ones. employees.grade_id is never touched: the payroll "Auto Grade" is derived, not stored.
 */
export function EmployeePayrollSalarySection({ employeeId, companyId, joiningDate, draft, onDraftChange, onIntentChange }: {
  employeeId?: string; companyId?: string; joiningDate?: string; draft: SalaryDraft;
  onDraftChange: (d: SalaryDraft) => void; onIntentChange: (i: SalaryIntent) => void;
}) {
  const adminQ = usePayrollAdmin(companyId);
  const perm = useHasPermission("payroll", "EDIT");
  const canEdit = Boolean(adminQ.data) && perm.allowed;
  const asgQ = useEmployeeSalaryAssignments(employeeId);
  const slabQ = useSalarySlabRules(companyId);
  const rows = asgQ.data ?? [];
  const current = rows.find((a) => a.effectiveTo == null) ?? null;
  const isEdit = Boolean(employeeId);

  // Fields are shown for a new employee, for an employee with no salary yet, or after "Update Salary".
  const showFields = canEdit && (!isEdit || (!asgQ.isLoading && (current == null || draft.editing)));
  const hasGross = draft.gross.trim() !== "";
  const grossNum = Number(draft.gross);

  const [debounced, setDebounced] = useState<number | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(showFields && Number.isFinite(grossNum) && grossNum > 0 ? grossNum : undefined), 400);
    return () => clearTimeout(t);
  }, [draft.gross, showFields, grossNum]);

  // The payroll month the preview is calculated for = month of Effective From (never "today").
  const periodMonth = /^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom) ? `${draft.effectiveFrom.slice(0, 7)}-01` : undefined;
  const previewQ = useSalaryPreviewForGross({ employeeId, companyId, periodMonth, gross: debounced, joiningDate: joiningDate || null });
  const p = previewQ.data;
  const struct = p?.salary_structure;
  const structLabel = struct?.id ? `${struct.code ?? ""} - ${struct.name ?? ""}` : null;
  const parts = splitPreview(p);
  const issues = reviewIssues(p);
  const settled = debounced === grossNum && !previewQ.isFetching;

  // ---- what should the parent do on submit?
  const { save, blocking } = computeSalaryIntent({
    showFields, hasGross, grossNum, effectiveFrom: draft.effectiveFrom, settled, isError: previewQ.isError, errorText: previewQ.isError ? errText(previewQ.error) : "",
    structId: struct?.id, ambiguous: Boolean(struct?.ambiguous), note: struct?.note, currentGross: current ? current.grossSalary : null,
  });
  const reason = draft.reason.trim() || (current == null && save ? "Initial salary" : null);
  useEffect(() => {
    onIntentChange({ save, gross: grossNum, effectiveFrom: draft.effectiveFrom, reason, blocking });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, grossNum, draft.effectiveFrom, reason, blocking]);

  const currentSlab = current ? slabText(slabQ.data ?? [], current.resolvedStructureId) : null;
  const previous = current?.resolvedStructureCode ? `${current.resolvedStructureCode} - ${current.resolvedStructureName ?? ""}` : null;
  const changed = Boolean(current && structLabel && previous && previous !== structLabel);

  return (
    <Card id="payroll-salary">
      <CardHeader>
        <CardTitle>Payroll Salary</CardTitle>
        <p className="text-xs text-muted-foreground">Enter the Gross Salary and the date it applies from. The Grade, Salary Structure and Salary Slab are worked out automatically from the salary slabs — you do not choose them.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEdit && asgQ.isLoading ? <LoadingState rows={2} /> : null}

        {/* Current salary (Edit) */}
        {isEdit && !asgQ.isLoading && (
          current ? (
            <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-4" aria-label="Current salary">
              <div><p className="text-[11px] text-muted-foreground">Current Gross Salary</p><p className="text-lg font-semibold">{formatAmount(current.grossSalary)}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Current Grade</p><p className="text-sm">{previous ?? "—"}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Salary Structure</p><p className="text-sm">{previous ?? "—"}{currentSlab ? <span className="block text-[11px] text-muted-foreground">Slab {currentSlab}</span> : null}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Effective From</p><p className="text-sm">{current.effectiveFrom}</p></div>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" /> Salary not configured{canEdit ? " — enter the Gross Salary below." : "."}</p>
          )
        )}

        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            {adminQ.isLoading || perm.isLoading ? "Checking your payroll access…" : isEdit ? "Salary is maintained by payroll administrators." : "Salary can be added later by a payroll administrator, from Edit Employee."}
          </p>
        )}

        {canEdit && isEdit && current && !draft.editing && (
          <Button type="button" variant="outline" size="sm" onClick={() => onDraftChange({ ...draft, editing: true, gross: String(current.grossSalary), reason: "" })}>Update Salary</Button>
        )}

        {showFields && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="ps-gross">{isEdit && current ? "New Gross Salary (₹)" : "Gross Salary (₹)"}</Label>
                <Input id="ps-gross" type="number" inputMode="decimal" min={0} step="0.01" value={draft.gross} placeholder="e.g. 11000" onChange={(e) => onDraftChange({ ...draft, gross: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ps-eff">Effective From</Label>
                <Input id="ps-eff" type="date" value={draft.effectiveFrom} onChange={(e) => onDraftChange({ ...draft, effectiveFrom: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ps-reason" className="text-muted-foreground">Reason (optional)</Label>
                <Input id="ps-reason" value={draft.reason} placeholder="Annual revision / promotion" onChange={(e) => onDraftChange({ ...draft, reason: e.target.value })} />
              </div>
            </div>

            {isEdit && current && draft.editing && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onDraftChange({ ...draft, editing: false, gross: "" })}>Cancel salary change</Button>
            )}

            {/* Auto-resolved, read only */}
            <div className="grid gap-3 sm:grid-cols-3">
              <ReadOnlyField label="Auto Grade" value={structLabel} loading={hasGross && !settled} id="ps-grade" />
              <ReadOnlyField label="Salary Structure" value={structLabel} loading={hasGross && !settled} id="ps-structure" />
              <ReadOnlyField label="Salary Slab" value={slabText(slabQ.data ?? [], struct?.id)} loading={hasGross && !settled} id="ps-slab" />
            </div>

            {!hasGross ? (
              <p className="text-xs text-muted-foreground">{isEdit ? "" : "Salary not configured yet — you can add it now or later from Edit Employee."}</p>
            ) : blocking && settled ? (
              <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{blocking}</span>
              </p>
            ) : p && struct?.id ? (
              <>
                {changed && (
                  <p className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900" role="status">
                    Previous: <b>{previous}</b> → New: <b>{structLabel}</b> — the salary structure changes from {draft.effectiveFrom}.
                  </p>
                )}
                <div className="grid gap-3 lg:grid-cols-2">
                  <PreviewBlock
                    title="Salary Bifurcation"
                    rows={parts.structureEarnings.map((e) => ({ code: e.code, name: e.name || e.code, amount: e.amount }))}
                    total={parts.structureEarnings.reduce((a, e) => a + Number(e.amount), 0)}
                    totalLabel="Gross"
                  />
                  <div className="text-[11px] leading-relaxed text-muted-foreground">
                    <Wand2 className="mr-1 inline h-3 w-3" />The split comes from the {struct.code} structure configuration (the same calculation payroll uses). Common components (PF, ESI, Medical Fund …), overtime, loss of pay and advance recovery are applied by payroll each month and are not entered here.
                  </div>
                </div>
                <ReviewIssues issues={issues} />
              </>
            ) : null}
          </>
        )}

        {/* History (Edit) */}
        {isEdit && rows.length > 0 && (
          <details className="rounded-md border p-2">
            <summary className="cursor-pointer text-sm font-medium">Salary history ({rows.length})</summary>
            <div className="mt-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Effective From</TableHead><TableHead>To</TableHead><TableHead>Gross</TableHead><TableHead>Previous Gross</TableHead><TableHead>Grade / Structure</TableHead><TableHead>Previous</TableHead><TableHead>Reason</TableHead><TableHead>Saved by</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.effectiveFrom}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.effectiveTo ?? "open"}</TableCell>
                      <TableCell>{formatAmount(a.grossSalary)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.previousGross == null ? "—" : formatAmount(a.previousGross)}</TableCell>
                      <TableCell className="text-xs">
                        {a.resolvedStructureCode ? `${a.resolvedStructureCode} - ${a.resolvedStructureName ?? ""}` : <span className="text-muted-foreground">by slab</span>}
                        {a.salaryStructureId ? <Badge variant="secondary" className="ml-1 text-[10px]">manual override</Badge> : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.previousStructureName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.reason ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.assignedByName ?? "—"}<br />{new Date(a.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
