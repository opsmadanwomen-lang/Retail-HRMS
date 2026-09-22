/** Full & Final Settlement (F&F) — types. */

export type FnfStatus =
  | "draft" | "under_review" | "calculated" | "pending_approval" | "sent_back"
  | "approved" | "payment_pending" | "partially_paid" | "paid" | "closed" | "rejected" | "reversed";

export interface FnfSettlement {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName?: string | null;
  employeeCode?: string | null;
  store?: string | null;
  department?: string | null;
  designation?: string | null;
  joiningDate?: string | null;
  version: number;
  reversesSettlementId: string | null;
  exitType: string;
  leavingDate: string;
  status: FnfStatus;
  noticeRequiredDays: number;
  noticeServedDays: number;
  noticeShortfallDays: number;
  noticeWaived: boolean;
  leavePolicyId: string | null;
  encashableLeaveDays: number;
  payrollPolicyId: string | null;
  salaryStructureId: string | null;
  basicSnapshot: number | null;
  daSnapshot: number | null;
  grossEarnings: number;
  totalDeductions: number;
  employerContributionTotal: number;
  advanceRecovered: number;
  advanceRemaining: number;
  netSettlement: number;
  amountPaid: number;
  hasNegativeNet: boolean;
  needsReview: boolean;
  reviewNotes: string | null;
  snapshot: unknown | null;
  monthsComputed: unknown | null;
  monthsConsumed: unknown | null;
  calculatedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface FnfLine {
  id: string;
  lineType: "earning" | "deduction" | "employer_contribution";
  code: string;
  name: string;
  quantity: number | null;
  rate: number | null;
  amount: number;
  source: string | null;
  calcType: string | null;
  calcNote: string | null;
  isAdjustment: boolean;
  isProtected: boolean;
  sortOrder: number;
}

export interface FnfAdjustment {
  id: string;
  lineType: "earning" | "deduction";
  code: string;
  name: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface FnfPayment {
  id: string;
  amount: number;
  paymentDate: string;
  paymentMode: string | null;
  transactionReference: string | null;
  bankDetails: string | null;
  notes: string | null;
  createdAt: string;
}

export interface FnfEvent {
  id: string;
  event: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string | null;
  reason: string | null;
  meta: unknown | null;
  createdAt: string;
}

export interface FnfDetail {
  settlement: FnfSettlement;
  lines: FnfLine[];
  adjustments: FnfAdjustment[];
  payments: FnfPayment[];
  events: FnfEvent[];
}

export interface FnfListRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  store: string | null;
  exitType: string;
  leavingDate: string;
  status: FnfStatus;
  grossEarnings: number;
  totalDeductions: number;
  advanceRecovered: number;
  netSettlement: number;
  amountPaid: number;
  version: number;
  createdAt: string;
  calculatedAt: string | null;
  approvedAt: string | null;
}

export interface FnfRegisterRow {
  employeeName: string;
  staffId: string | null;
  store: string | null;
  department: string | null;
  joiningDate: string | null;
  leavingDate: string;
  exitType: string;
  totalEarnings: number;
  totalDeductions: number;
  advanceRecovery: number;
  leaveEncashment: number;
  netFnf: number;
  status: FnfStatus;
  paymentDate: string | null;
}

export const EXIT_TYPES = [
  "resignation", "termination", "retirement", "absconded", "contract_end", "other",
] as const;
