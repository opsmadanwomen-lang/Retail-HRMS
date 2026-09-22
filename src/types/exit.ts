/** Employee Exit Request workflow — types. */

export type ExitRequestStatus =
  | "draft" | "submitted" | "under_approval" | "approved" | "rejected" | "sent_back" | "cancelled" | "completed";

export interface ExitType {
  id: string;
  companyId: string;
  code: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
}

export interface ExitRequestListRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  store: string | null;
  department: string | null;
  joiningDate: string | null;
  exitType: string;
  requestedLeavingDate: string;
  effectiveLeavingDate: string | null;
  status: ExitRequestStatus;
  currentStep: number;
  fnfSettlementId: string | null;
  createdAt: string;
}

export interface ExitRequestDecision {
  id: string;
  stepNo: number;
  action: string;
  actor: string | null;
  remark: string | null;
  decidedAt: string;
}

export interface ExitRequestDetail {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  store: string | null;
  department: string | null;
  designation: string | null;
  joiningDate: string | null;
  exitTypeId: string;
  exitType: ExitType | null;
  reason: string | null;
  notes: string | null;
  requestedLeavingDate: string;
  noticePeriodDays: number;
  noticeServedDays: number;
  expectedLastWorkingDate: string | null;
  status: ExitRequestStatus;
  currentStep: number;
  maxStage: number;
  effectiveLeavingDate: string | null;
  fnfSettlementId: string | null;
  decisions: ExitRequestDecision[];
}

export interface ExitRegisterRow {
  staffId: string | null;
  employeeName: string;
  store: string | null;
  department: string | null;
  joiningDate: string | null;
  leavingDate: string;
  exitType: string;
  reason: string | null;
  exitStatus: string | null;
  fnfStatus: string;
  fnfAmount: number | null;
  paymentStatus: string;
}
