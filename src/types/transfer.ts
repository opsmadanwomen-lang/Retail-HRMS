/** Employee Transfer module — types. */

export type TransferStatus = "draft" | "pending_approval" | "approved" | "rejected" | "cancelled" | "effective";

export interface TransferListRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  oldStore: string | null;
  newStore: string | null;
  oldDepartment: string | null;
  newDepartment: string | null;
  oldDesignation: string | null;
  newDesignation: string | null;
  effectiveDate: string;
  reason: string | null;
  status: TransferStatus;
  currentStep: number;
  decidedBy: string | null;
  createdAt: string;
}

export interface TransferDecision {
  id: string;
  stepNo: number;
  action: string;
  actor: string | null;
  remark: string | null;
  decidedAt: string;
}

export interface TransferDetail {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  effectiveDate: string;
  reason: string | null;
  status: TransferStatus;
  currentStep: number;
  maxStage: number;
  applied_at: string | null;
  newStoreId: string | null;
  newStoreDepartmentId: string | null;
  newStoreDesignationId: string | null;
  newStoreTeamId: string | null;
  newGradeId: string | null;
  newCategoryId: string | null;
  newReportingManagerId: string | null;
  newSuperManagerId: string | null;
  newEmploymentType: string | null;
  newSalaryStructureId: string | null;
  newShiftId: string | null;
  decisions: TransferDecision[];
}

export interface TransferRegisterRow {
  staffId: string | null;
  employeeName: string;
  oldStore: string | null;
  newStore: string | null;
  oldDepartment: string | null;
  newDepartment: string | null;
  oldDesignation: string | null;
  newDesignation: string | null;
  effectiveDate: string;
  reason: string | null;
  status: TransferStatus;
  approvedBy: string | null;
}
