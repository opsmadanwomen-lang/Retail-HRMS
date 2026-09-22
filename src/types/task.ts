import type { TaskPriority, TaskAttachmentType, TaskVerificationDecision, TaskHistoryAction } from "./database.types";

export type { TaskPriority, TaskAttachmentType, TaskVerificationDecision, TaskHistoryAction };

export interface TaskCategory {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export interface TaskFrequencyOption {
  id: string;
  code: string;
  label: string;
  displayOrder: number;
}

export interface TaskStatusOption {
  id: string;
  code: string;
  label: string;
  displayOrder: number;
}

export interface TaskTemplate {
  id: string;
  companyId: string | null;
  templateCode: string;
  templateName: string;
  categoryId: string | null;
  categoryName?: string;
  description: string | null;
  isSystemTemplate: boolean;
  isActive: boolean;
  displayOrder: number;
}

export interface TaskTemplateFormValues {
  templateCode: string;
  templateName: string;
  categoryId?: string;
  description?: string;
  isActive: boolean;
  displayOrder?: number;
}

export interface Task {
  id: string;
  companyId: string | null;
  taskCode: string;
  taskName: string;
  categoryId: string | null;
  categoryName?: string;
  frequencyId: string | null;
  frequencyLabel?: string;
  templateId: string | null;
  templateName?: string;
  priority: TaskPriority;
  description: string | null;
  estimatedTimeMinutes: number | null;
  requiresVerification: boolean;
  allowPhotoUpload: boolean;
  allowDocumentUpload: boolean;
  allowRemarks: boolean;
  allowGpsPlaceholder: boolean;
  allowQrPlaceholder: boolean;
  weightage: number;
  isSystemTask: boolean;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;

  /** Populated by taskMasterService.list() — number of roles this task is mapped to. */
  mappedRoleCount?: number;
}

export interface TaskFormValues {
  taskCode: string;
  taskName: string;
  categoryId?: string;
  frequencyId?: string;
  templateId?: string;
  priority: TaskPriority;
  description?: string;
  estimatedTimeMinutes?: number;
  requiresVerification: boolean;
  allowPhotoUpload: boolean;
  allowDocumentUpload: boolean;
  allowRemarks: boolean;
  allowGpsPlaceholder: boolean;
  allowQrPlaceholder: boolean;
  weightage?: number;
  isActive: boolean;
  displayOrder?: number;
}

export interface TaskFilters {
  companyId?: string;
  storeId?: string;
  departmentId?: string;
  roleId?: string;
  categoryId?: string;
  frequencyId?: string;
  priority?: TaskPriority;
  isActive?: boolean;
  search?: string;
}

export interface RoleTaskMapping {
  id: string;
  roleId: string;
  roleName?: string;
  taskId: string;
  taskName?: string;
  taskCode?: string;
  categoryName?: string;
  frequencyLabel?: string;
  priority?: TaskPriority;
  isActive: boolean;
}

export interface TaskChecklistItem {
  id: string;
  taskChecklistId: string;
  itemName: string;
  description: string | null;
  isMandatory: boolean;
  weightage: number;
  sequence: number;
  isActive: boolean;
}

export interface TaskChecklistItemFormValues {
  itemName: string;
  description?: string;
  isMandatory: boolean;
  weightage?: number;
  sequence?: number;
}

export interface TaskChecklist {
  id: string;
  taskId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  displayOrder: number;
  items: TaskChecklistItem[];
}

export interface TaskChecklistFormValues {
  name: string;
  description?: string;
  displayOrder?: number;
}

export interface EmployeeTaskAssignment {
  id: string;
  employeeId: string;
  employeeName?: string;
  roleId: string | null;
  roleName?: string;
  taskId: string;
  taskName?: string;
  taskCode?: string;
  categoryName?: string;
  requiresVerification?: boolean;
  allowPhotoUpload?: boolean;
  allowDocumentUpload?: boolean;
  allowRemarks?: boolean;
  storeId: string;
  storeName?: string;
  statusId: string;
  statusCode?: string;
  statusLabel?: string;
  priority: TaskPriority;
  dueDate: string;
  dueTime: string | null;
  assignedAt: string;
}

export interface AssignTaskFormValues {
  taskId: string;
  statusId: string;
  priority: TaskPriority;
  dueDate: string;
  dueTime?: string;
}

export interface ChecklistResponseValue {
  itemId: string;
  checked: boolean;
}

export interface TaskSubmission {
  id: string;
  employeeTaskAssignmentId: string;
  submittedAt: string;
  completionTime: string | null;
  remarks: string | null;
  checklistResponses: ChecklistResponseValue[];
}

export interface TaskSubmissionFormValues {
  completionTime?: string;
  remarks?: string;
  checklistResponses: ChecklistResponseValue[];
}

export interface TaskVerification {
  id: string;
  taskSubmissionId: string;
  verifiedAt: string;
  decision: TaskVerificationDecision;
  remarks: string | null;
  score: number | null;
}

export interface TaskVerificationFormValues {
  decision: TaskVerificationDecision;
  remarks?: string;
  score?: number;
}

export interface TaskComment {
  id: string;
  comment: string;
  commentedByName?: string;
  createdAt: string;
}

export interface TaskAttachment {
  id: string;
  attachmentType: TaskAttachmentType;
  fileName: string;
  storagePath: string;
  createdAt: string;
}

export interface TaskHistoryEntry {
  id: string;
  action: TaskHistoryAction;
  statusLabel?: string;
  remarks: string | null;
  createdAt: string;
}

export interface TaskScore {
  id: string;
  employeeTaskAssignmentId: string;
  weightage: number | null;
  completionPercentage: number | null;
  verificationPercentage: number | null;
  qualityScore: number | null;
  finalScore: number | null;
  calculatedAt: string;
}

export interface TaskDashboardStats {
  todayTasks: number;
  pendingTasks: number;
  completedTasks: number;
  verifiedTasks: number;
  rejectedTasks: number;
  overdueTasks: number;
  categoryWise: Array<{ categoryId: string; categoryName: string; count: number }>;
  roleWise: Array<{ roleId: string; roleName: string; count: number }>;
}
