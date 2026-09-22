import type {
  EmployeeStatus,
  EmploymentType,
  SalaryType,
  GenderType,
  EmployeeDocumentType,
} from "./database.types";

export type {
  EmployeeStatus,
  EmploymentType,
  SalaryType,
  GenderType,
  EmployeeDocumentType,
};

export type EmployeeScope = "store_specific" | "company_wide";

export interface Employee {
  id: string;
  companyId: string;
  storeId: string | null;
  employeeScope: EmployeeScope;
  storeTeamId: string | null;
  storeDepartmentId: string | null;
  storeDesignationId: string | null;
  reportingManagerId: string | null;
  employeeCode: string | null;
  authUserId: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  fullName: string;
  gender: GenderType | null;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  mobile: string | null;
  alternateMobile: string | null;
  email: string | null;
  photoUrl: string | null;
  joiningDate: string | null;
  confirmationDate: string | null;
  leavingDate: string | null;
  exitReason: string | null;
  exitStatus: string | null;
  gradeId: string | null;
  categoryId: string | null;
  employmentType: EmploymentType | null;
  salaryType: SalaryType | null;
  status: EmployeeStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;

// Denormalized display fields, populated by employeeService for list/profile views.
storeName?: string | null;
teamName?: string | null;
departmentName?: string | null;
designationTitle?: string | null;
reportingManagerName?: string | null;
}

export interface EmployeeFormValues {
  employeeScope: EmployeeScope;
  /** Required when employeeScope is "store_specific"; must be omitted/null for "company_wide". */
  storeId?: string;
  /** Store-scoped org-tree designation — not applicable for "company_wide" employees (no store to
   *  cascade from), so optional there. */
  storeDesignationId?: string;
  reportingManagerId?: string | null;
  employeeCode?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender?: GenderType;
  dateOfBirth?: string;
  bloodGroup?: string;
  mobile?: string;
  alternateMobile?: string;
  email?: string;
  joiningDate?: string;
  confirmationDate?: string;
  leavingDate?: string;
  exitReason?: string;
  exitStatus?: "resigned" | "terminated" | "retired" | "absconded" | "contract_end" | "other";
  gradeId?: string;
  categoryId?: string;
  employmentType?: EmploymentType;
  salaryType?: SalaryType;
  status: EmployeeStatus;
}

export interface EmployeeFilters {
  companyId?: string;
  storeId?: string;
  storeTeamId?: string;
  storeDepartmentId?: string;
  storeDesignationId?: string;
  status?: EmployeeStatus;
  joiningFrom?: string;
  joiningTo?: string;
  search?: string;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  documentType: EmployeeDocumentType;
  documentNumber: string | null;
  fileName: string;
  storagePath: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  notes: string | null;
  expiryDate: string | null;
  createdAt: string;
}

export interface EmployeeTransfer {
  id: string;
  employeeId: string;
  fromStoreId: string | null;
  toStoreId: string | null;
  fromStoreDesignationId: string | null;
  toStoreDesignationId: string | null;
  transferDate: string;
  reason: string | null;
  createdAt: string;
}

export interface EmployeePromotion {
  id: string;
  employeeId: string;
  fromStoreDesignationId: string | null;
  toStoreDesignationId: string | null;
  promotionDate: string;
  remarks: string | null;
  createdAt: string;
}

export interface EmployeeNote {
  id: string;
  employeeId: string;
  note: string;
  createdAt: string;
}

export interface EmployeeSummary {
  id: string;
  fullName: string;
  employeeCode: string | null;
  designationTitle?: string;
  status: EmployeeStatus;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
export interface EmployeeImportRow {
  employeeCode?: string;
  employeeName: string;
  mobile?: string;
  email?: string;
  gender?: string;
  dob?: string;
  joiningDate?: string;
  store: string;
  department: string;
  designation: string;
  reportingManager?: string;
  status?: string;
}

export type ImportRowState = "valid" | "error" | "duplicate" | "needs_mapping";

export interface EmployeeImportPreviewRow {
  rowNumber: number;
  raw: EmployeeImportRow;
  state: ImportRowState;
  errors: string[];
  resolvedStoreId?: string;
  resolvedDesignationId?: string;
  resolvedReportingManagerId?: string | null;
}

export interface EmployeeImportSummary {
  totalRows: number;
  validRows: number;
  importedRows: number;
  /** Employees Created and Employee Codes Generated are always equal — every created employee gets an auto-generated code. */
  codesGenerated: number;
  skippedRows: number;
  errorRows: number;
}
