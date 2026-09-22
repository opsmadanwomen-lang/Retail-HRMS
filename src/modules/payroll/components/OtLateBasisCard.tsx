import { AlertTriangle } from "lucide-react";
import { formatAmount } from "@/modules/advance/utils";
import type { OtLateBasis } from "@/types/payroll";

// Pure display of the server's ot_late_basis block (payroll_ot_late_basis via payroll_policy_preview). Nothing here calculates a rate,
// a day count or an amount — the same database function feeds the payroll run, the Payroll Preview and the Salary Structure Test.
// Migration 0185: the wage basis and day divisor are policy CONFIGURATION (Payroll Rules -> Overtime), not fixed to Basic+DA / calendar days.

const BASIS_LABEL: Record<string, string> = { basic: "Basic", da: "DA", basic_da: "Basic + DA", gross: "Gross", component: "Another Salary Component", custom: "Custom Formula" };
const DIVISOR_LABEL: Record<string, string> = { calendar_days: "Payroll Month Calendar Days", working_days: "Working Days", custom: "Custom Divisor" };
const monthLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const num = (v: number, dp = 2) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: dp });

function Row({ label, value, strong, muted }: { label: string; value: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right tabular-nums ${strong ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>{value}</span>
    </div>
  );
}

/**
 * OT / Late hourly basis: (Basic + DA) ÷ calendar days of the payroll month ÷ standard hours/day.
 * `showAmounts` adds the payable OT / Late minutes and amounts (Payroll Preview); the Salary Structure Test shows the basis only.
 */
export function OtLateBasisCard({ basis: b, showAmounts = false }: { basis: OtLateBasis; showAmounts?: boolean }) {
  const hoursMissing = b.std_hours_per_day == null;
  const basisLabel = BASIS_LABEL[b.basis_method] ?? b.basis_method;
  const divisorLabel = DIVISOR_LABEL[b.divisor_method] ?? b.divisor_method;
  const wageBaseLabel = b.basis_method === "basic_da" ? "Basic + DA" : b.basis_method === "basic" ? "Basic" : b.basis_method === "da" ? "DA" : basisLabel;
  return (
    <div className="rounded-lg border p-3 text-xs" aria-label="OT and Late hourly basis">
      <p className="mb-1 text-sm font-medium">OT / Late hourly basis</p>
      <p className="mb-2 text-[11px] text-muted-foreground">
        {basisLabel} ÷ {divisorLabel.replace(/ \(.*\)$/, "")} ÷ standard hours/day — configured under Payroll Rules → Overtime. Rates are shown to 2 decimals; the calculation keeps full precision and rounds only the final amount.
      </p>
      <div className="grid gap-x-8 sm:grid-cols-2">
        <div>
          <Row label="Payroll Month" value={monthLabel(b.period_month)} />
          <Row label="Day Divisor" value={`${divisorLabel}${b.divisor == null ? "" : ` (${num(b.divisor, 2)})`}`} />
          {b.basis_method !== "gross" && b.basis_method !== "component" && b.basis_method !== "custom" && <Row label="Basic" value={formatAmount(Number(b.basic))} />}
          {(b.basis_method === "basic_da" || b.basis_method === "da") && <Row label="DA" value={formatAmount(Number(b.da))} />}
          <Row label={wageBaseLabel} value={b.wage_base == null ? "Not resolved" : formatAmount(Number(b.wage_base))} strong />
        </div>
        <div>
          <Row label="Standard Hours/Day" value={hoursMissing ? "Not configured" : num(Number(b.std_hours_per_day), 2)} />
          <Row label="Daily Rate" value={b.daily_rate == null ? "—" : formatAmount(Number(b.daily_rate))} />
          <Row label="Hourly Rate" value={b.hourly_rate == null ? "—" : formatAmount(Number(b.hourly_rate))} strong />
        </div>
      </div>
      {(hoursMissing || b.wage_base == null || b.divisor == null) && (
        <p className="mt-2 flex items-start gap-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />The configured hourly wage basis, day divisor or standard hours/day is incomplete in the payroll policy (Payroll Rules → Overtime), so OT and Late cannot be valued.
        </p>
      )}
      {showAmounts && (
        <div className="mt-3 grid gap-x-8 gap-y-2 border-t pt-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-medium">Overtime</p>
            <Row label="Payable OT Minutes" value={num(Number(b.ot_minutes), 0)} />
            <Row label="OT Hours" value={num(Number(b.ot_hours), 4)} />
            <Row label="OT Multiplier / Rule" value={b.ot_multiplier == null ? "Not separately configured" : `${b.ot_multiplier}×`} muted={b.ot_multiplier == null} />
            <Row label="OT Amount" value={!b.ot_enabled ? "OT line is off in this policy" : b.ot_amount == null ? "—" : formatAmount(Number(b.ot_amount))} strong={b.ot_enabled && b.ot_amount != null} muted={!b.ot_enabled} />
            {b.ot_multiplier == null && <p className="mt-1 text-[11px] text-muted-foreground">OT hourly base calculated, but no OT multiplier is configured: payable minutes are valued at 1× the hourly base. Any premium comes from the Attendance OT Rule.</p>}
          </div>
          <div>
            <p className="mb-1 font-medium">Late</p>
            <Row label="Payable Late Minutes" value={num(Number(b.late_minutes), 0)} />
            <Row label="Late Hours" value={num(Number(b.late_hours), 4)} />
            <Row label="Late Amount" value={!b.late_enabled ? "Late deduction is off in this policy" : b.late_amount == null ? "—" : `− ${formatAmount(Number(b.late_amount))}`} strong={b.late_enabled && b.late_amount != null} muted={!b.late_enabled} />
          </div>
        </div>
      )}
    </div>
  );
}
