import type { AdvanceRequestStatus, AdvanceReceiptDisplayStatus, AdvanceReceiptRowStatus } from "@/types/advance";

/** ₹ formatting, en-IN grouping, no forced decimals unless present. */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export const ADVANCE_STATUS_LABEL: Record<AdvanceRequestStatus, string> = {
  manager_pending: "Reporting Manager Pending",
  boss_pending: "Final Approval Pending",
  approved: "Approved",
  rejected: "Rejected",
  sent_back: "Sent Back",
  cancelled: "Cancelled",
  // Phase 2 — HR Process Execution
  hr_pending: "HR Processing",
  hr_on_hold: "HR On Hold",
  hr_sent_back: "HR Sent Back",
  finance_pending: "Ready for Finance",
  // Phase 3 — Finance Payment
  finance_processing: "Finance Processing",
  paid: "Paid",
  finance_on_hold: "Finance On Hold",
  // Phase 4 — Payroll Recovery
  recovery_pending: "Recovery Pending",
  recovering: "Recovering",
  settled: "Settled",
  closed: "Closed",
};

export const ADVANCE_STATUS_VARIANT: Record<AdvanceRequestStatus, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  manager_pending: "warning",
  boss_pending: "warning",
  approved: "success",
  rejected: "destructive",
  sent_back: "secondary",
  cancelled: "secondary",
  hr_pending: "warning",
  hr_on_hold: "warning",
  hr_sent_back: "secondary",
  finance_pending: "success",
  finance_processing: "warning",
  paid: "success",
  finance_on_hold: "warning",
  recovery_pending: "warning",
  recovering: "warning",
  settled: "success",
  closed: "secondary",
};

// Advance Payment Receipt Management (migration 0160) — the POST-payment signed employee
// receipt. Distinct enum from ADVANCE_STATUS_* above (a Receipt has its own tiny lifecycle,
// independent of the advance request's own status).
export const RECEIPT_STATUS_LABEL: Record<AdvanceReceiptDisplayStatus, string> = {
  pending: "Receipt Pending",
  uploaded: "Receipt Uploaded",
};

export const RECEIPT_STATUS_VARIANT: Record<AdvanceReceiptDisplayStatus, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  pending: "warning",
  uploaded: "success",
};

export const RECEIPT_ROW_STATUS_LABEL: Record<AdvanceReceiptRowStatus, string> = {
  active: "Active",
  replaced: "Replaced",
};

export const RECEIPT_ROW_STATUS_VARIANT: Record<AdvanceReceiptRowStatus, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  active: "success",
  replaced: "secondary",
};

export const RECOVERY_METHOD_LABEL: Record<string, string> = {
  fixed_installments: "Fixed number of installments",
  fixed_monthly: "Fixed monthly deduction",
  custom: "Custom schedule",
  full: "Full deduction",
};

/** Statuses that mean "the Boss has finally decided in the employee's favor" and the advance is
 *  still moving toward payment — grouped under the My Advances "Approved / In Progress" tab. The
 *  terminal `paid` gets its own tab; the granular label always shows exactly where it stands. */
export function isBossApprovedFamily(status: AdvanceRequestStatus): boolean {
  return (
    status === "approved" ||
    status === "hr_pending" ||
    status === "hr_on_hold" ||
    status === "hr_sent_back" ||
    status === "finance_pending" ||
    status === "finance_processing" ||
    status === "finance_on_hold"
  );
}

export function advanceStageLabel(status: AdvanceRequestStatus, currentStep: number): string {
  if (status === "manager_pending") return "Step 1 of 5 — Reporting Manager";
  if (status === "boss_pending") return "Step 2 of 5 — Final Approval (Boss)";
  if (status === "approved") return "Step 3 of 5 — Awaiting HR Processing";
  if (status === "hr_pending") return "Step 3 of 5 — HR Processing";
  if (status === "hr_on_hold") return "Step 3 of 5 — On Hold by HR";
  if (status === "hr_sent_back") return "Step 3 of 5 — Sent Back by HR";
  if (status === "finance_pending") return "Step 4 of 5 — Ready for Finance";
  if (status === "finance_processing") return "Step 4 of 5 — Finance Processing";
  if (status === "finance_on_hold") return "Step 4 of 5 — On Hold by Finance";
  if (status === "paid") return "Step 5 of 5 — Paid (awaiting recovery setup)";
  if (status === "recovery_pending") return "Step 5 of 5 — Recovery scheduled";
  if (status === "recovering") return "Step 5 of 5 — Payroll Recovery in progress";
  if (status === "settled") return "Step 5 of 5 — Settled (early settlement)";
  if (status === "closed") return "Completed — Advance closed";
  if (status === "rejected") return "Completed";
  if (status === "sent_back") return `Sent back at Step ${currentStep}`;
  if (status === "cancelled") return "Cancelled by employee";
  return "—";
}

export function financeActionLabel(action: string): string {
  switch (action) {
    case "started":
      return "Started Processing";
    case "paid":
      return "Payment Recorded";
    case "on_hold":
      return "Put On Hold";
    case "resumed":
      return "Resumed";
    case "commented":
      return "Commented";
    default:
      return action;
  }
}

export function hrActionLabel(action: string): string {
  switch (action) {
    case "processed":
      return "Processed";
    case "on_hold":
      return "Put On Hold";
    case "sent_back":
      return "Sent Back";
    case "resumed":
      return "Resumed to HR Pending";
    case "commented":
      return "Commented";
    default:
      return action;
  }
}

export function actionLabel(action: string): string {
  switch (action) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "sent_back":
      return "Sent Back";
    case "amount_modified":
      return "Amount Modified";
    case "commented":
      return "Commented";
    default:
      return action;
  }
}

export function roleLabel(role: string): string {
  return role === "boss" ? "Final Approver (Boss)" : "Reporting Manager";
}
