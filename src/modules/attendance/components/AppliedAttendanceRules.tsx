import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import type { AttendanceRuleExplanation, AttendanceRuleKind } from "@/types/attendance";

interface AppliedAttendanceRulesProps {
  explanations: AttendanceRuleExplanation[] | undefined;
  isLoading: boolean;
  /** Loaded but no shift could be resolved for this employee/date — nothing to explain. */
  unavailableReason?: string | null;
  employeeId: string;
  employeeName: string;
  storeId: string;
  storeName: string;
  attendanceDate: string;
  /** The attendance_records row this panel is explaining — null when nothing is saved for this date
   *  yet (e.g. a still-Absent day), in which case "Use Information" has nothing to act on. */
  attendanceRecordId: string | null;
  /** Super Admin gate for the manual "Use Information" action — decided by the caller via the
   *  existing role/permission system; this component renders nothing extra when false. */
  canUseInformation: boolean;
  /** Performs the actual RPC call (attendance_use_information) — this component only collects
   *  confirmation, it never decides eligibility/quota/recalculation itself. */
  onUseInformation?: (remark?: string) => Promise<void>;
  isUsingInformation?: boolean;
}

const KIND_ORDER: AttendanceRuleKind[] = ["late", "weekly_off_late", "information", "penalty", "half_day", "early_going", "overtime", "extended_duty"];

const KIND_LABELS: Record<AttendanceRuleKind, string> = {
  late: "Normal Late Rule",
  weekly_off_late: "Weekly Off Late Rule",
  information: "Information / Intimation Rule",
  penalty: "Penalty Rule",
  half_day: "Half Day Rule",
  early_going: "Early Going Rule",
  overtime: "Normal Overtime Rule",
  extended_duty: "Extended Duty Rule",
};

const time5 = (value: unknown) => (typeof value === "string" ? value.slice(0, 5) : "—");

/** The "important configured value" line per rule kind — every value comes straight from the
 *  resolved rule's own row (via attendance_explain_rules' `config`), never hard-coded here. */
function configSummary(kind: AttendanceRuleKind, config: Record<string, unknown> | null): string {
  if (!config) return "—";
  switch (kind) {
    case "late":
      return `Grace: ${config.graceMinutes ?? "—"} min${config.maximumLateMinutes ? `, Max: ${config.maximumLateMinutes} min` : ""}`;
    case "weekly_off_late":
      return `Cutoff: ${time5(config.cutoffTime)}`;
    case "information":
      return `Cutoff: ${time5(config.cutoffTime)}, Limit: ${config.monthlyLimit ?? "—"}/mo, Usage: ${config.monthlyUsage ?? 0}/${config.monthlyLimit ?? "—"}`;
    case "penalty": {
      const amount = config.method === "fixed" || config.method === "custom_fixed" ? `${config.fixedMinutes ?? 0} min` : config.multiplier ? `${config.multiplier}x` : String(config.method ?? "—");
      return `${config.method ?? "—"} (${amount}), ${String(config.applicability ?? "—").replace(/_/g, " ")}`;
    }
    case "half_day":
      return `Late ≥ ${time5(config.lateArrivalCutoffTime)}, Early ≤ ${time5(config.earlyGoingCutoffTime)}`;
    case "early_going":
      return `Grace: ${config.graceMinutes ?? "—"} min`;
    case "overtime":
      return `Min: ${config.minimumOvertimeMinutes ?? 0} min${config.maximumOvertimeMinutes ? `, Max: ${config.maximumOvertimeMinutes} min` : ""}`;
    case "extended_duty":
      return `Midnight cutoff ${time5(config.midnightThresholdTime)} → ${config.midnightExtraDutyValue ?? "—"}x`;
    default:
      return "—";
  }
}

function scopeLabel(exp: AttendanceRuleExplanation, employeeId: string, employeeName: string, storeId: string, storeName: string): string {
  switch (exp.scopeSource) {
    case "all_stores_all_employees":
      return "All Stores + All Employees";
    case "store_all_employees":
      return `${exp.resolvedStoreId === storeId ? storeName : "This Store"} + All Employees`;
    case "employee_store":
      return exp.resolvedEmployeeId === employeeId
        ? `${employeeName}${exp.resolvedStoreId ? ` @ ${exp.resolvedStoreId === storeId ? storeName : "This Store"}` : " (All Stores)"}`
        : "Employee-specific";
    case "legacy":
      return "Legacy assignment (Employee/Shift/Store/Company)";
    default:
      return "—";
  }
}

function resultSummary(exp: AttendanceRuleExplanation): string {
  if (exp.resultNote && exp.resultValue === null) return exp.resultNote;
  if (exp.kind === "extended_duty") return exp.resultNote ?? "Not Triggered";
  if (exp.resultValue !== null) return `${exp.resultValue} min`;
  return exp.triggered ? "Triggered" : "Not Triggered";
}

function RuleCard({
  exp,
  employeeId,
  employeeName,
  storeId,
  storeName,
  attendanceDate,
  attendanceRecordId,
  canUseInformation,
  onUseInformation,
  isUsingInformation,
}: { exp: AttendanceRuleExplanation } & Omit<AppliedAttendanceRulesProps, "explanations" | "isLoading">) {
  const notApplicable = exp.isAssigned && exp.resultNote?.startsWith("Not applicable");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // "Use Information" eligibility -- purely a READ of what attendance_explain_rules() already
  // resolved (isAssigned/triggered/config.monthlyUsage/monthlyLimit/eligibleNow); this component
  // never decides eligibility or quota itself, it only shows/hides the button based on the same
  // authoritative values already rendered above. config.eligibleNow (migration 0087) is the ONE
  // signal mirroring compute_late_and_penalty_facts()'s own eligibility check (rule configured, late
  // > 0, not Half Day, within the Information cutoff, Weekly-Off-applicability, balance remaining) --
  // showing the button only when it is true means clicking it can never fail with "could not be
  // applied" purely due to cutoff/applicability, only ever due to a genuine race with another edit.
  const monthlyUsage = typeof exp.config?.monthlyUsage === "number" ? exp.config.monthlyUsage : null;
  const monthlyLimit = typeof exp.config?.monthlyLimit === "number" ? exp.config.monthlyLimit : null;
  const eligibleNow = exp.config?.eligibleNow === true;
  const showUseInformationButton =
    exp.kind === "information" &&
    canUseInformation &&
    exp.isAssigned &&
    !exp.triggered && // triggered === already used for THIS attendance date
    eligibleNow &&
    Boolean(attendanceRecordId) &&
    Boolean(onUseInformation);

  const handleConfirm = async () => {
    if (!onUseInformation) return;
    try {
      await onUseInformation();
      setConfirmOpen(false);
    } catch {
      // Stays open on failure — the caller already surfaced an error toast; nothing else to do here.
    }
  };

  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{KIND_LABELS[exp.kind]}</p>
        {!exp.isAssigned ? (
          <Badge variant="outline">Not Assigned</Badge>
        ) : notApplicable ? (
          <Badge variant="secondary">Applied</Badge>
        ) : (
          <Badge variant={exp.triggered ? "default" : "secondary"}>{exp.triggered ? "Triggered" : "Applied"}</Badge>
        )}
      </div>

      {exp.isAssigned ? (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>Scope: {scopeLabel(exp, employeeId, employeeName, storeId, storeName)}</p>
          <p>{configSummary(exp.kind, exp.config)}</p>
          {exp.effectiveFrom ? (
            <p>
              Effective: {exp.effectiveFrom}
              {exp.effectiveTo ? ` – ${exp.effectiveTo}` : " (ongoing)"}
            </p>
          ) : null}
          <p className="font-medium text-foreground">Result: {resultSummary(exp)}</p>

          {exp.kind === "information" && exp.triggered ? (
            <p className="pt-1 font-medium text-foreground">Used on this Attendance</p>
          ) : null}

          {showUseInformationButton ? (
            <div className="pt-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
                Use Information
              </Button>
            </div>
          ) : exp.kind === "information" && canUseInformation && exp.isAssigned && !exp.triggered && !eligibleNow ? (
            <p className="pt-1 text-xs text-destructive">
              {monthlyUsage !== null && monthlyLimit !== null && monthlyUsage >= monthlyLimit
                ? "Information Limit Reached"
                : "Not Eligible (no late arrival, past cutoff, or not applicable for this day type)"}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No rule resolved for this employee/store/date.</p>
      )}

      {exp.kind === "information" ? (
        <Dialog open={confirmOpen} onOpenChange={(next) => !isUsingInformation && setConfirmOpen(next)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Use Information?</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-left text-sm text-foreground">
                  <p>Employee: {employeeName}</p>
                  <p>Date: {formatDate(attendanceDate)}</p>
                  <p>This will use 1 Information from the employee's monthly Information limit.</p>
                  <p>
                    Current Usage: {monthlyUsage}/{monthlyLimit}
                  </p>
                  <p>
                    After Use: {monthlyUsage !== null ? monthlyUsage + 1 : "—"}/{monthlyLimit}
                  </p>
                  <p>This action will recalculate the attendance and applicable penalty.</p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={isUsingInformation}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={isUsingInformation}>
                {isUsingInformation ? "Using…" : "Confirm & Use Information"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * Read-only "why was this attendance calculated this way" panel for the Edit Attendance dialog.
 * Every value shown here comes from attendance_explain_rules() — the same
 * resolve_attendance_rule()/compute_extended_attendance_facts() chain attendance_admin_upsert()
 * itself uses. This component never computes anything; it only formats what the RPC already
 * resolved. Collapsed by default so the edit form stays compact.
 */
export function AppliedAttendanceRules({
  explanations,
  isLoading,
  unavailableReason,
  employeeId,
  employeeName,
  storeId,
  storeName,
  attendanceDate,
  attendanceRecordId,
  canUseInformation,
  onUseInformation,
  isUsingInformation,
}: AppliedAttendanceRulesProps) {
  const [expanded, setExpanded] = useState(false);

  const byKind = new Map((explanations ?? []).map((e) => [e.kind, e]));

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Applied Attendance Rules
        </span>
        {isLoading && expanded ? <span className="text-xs font-normal text-muted-foreground">Loading…</span> : null}
      </button>

      {expanded ? (
        <div className="border-t p-3">
          {unavailableReason ? (
            <p className="text-xs text-muted-foreground">{unavailableReason}</p>
          ) : isLoading ? (
            <p className="text-xs text-muted-foreground">Resolving rules…</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {KIND_ORDER.map((kind) => {
                const exp = byKind.get(kind);
                if (!exp) return null;
                return (
                  <RuleCard
                    key={kind}
                    exp={exp}
                    employeeId={employeeId}
                    employeeName={employeeName}
                    storeId={storeId}
                    storeName={storeName}
                    attendanceDate={attendanceDate}
                    attendanceRecordId={attendanceRecordId}
                    canUseInformation={canUseInformation}
                    onUseInformation={onUseInformation}
                    isUsingInformation={isUsingInformation}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
