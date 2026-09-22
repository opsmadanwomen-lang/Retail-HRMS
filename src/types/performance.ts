import type {
  PerformanceCycleGrain,
  MetricCategory,
  MetricCalculationType,
  PerformanceEntryStatus,
  MetricApprovalDecision,
} from "./database.types";

export type { PerformanceCycleGrain, MetricCategory, MetricCalculationType, PerformanceEntryStatus, MetricApprovalDecision };

export interface PerformanceDataCycle {
  id: string;
  companyId: string | null;
  name: string;
  cycleType: PerformanceCycleGrain;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface PerformanceDataSource {
  id: string;
  code: string;
  label: string;
  isAutomated: boolean;
}

export interface Metric {
  id: string;
  companyId: string | null;
  metricCode: string;
  metricName: string;
  category: MetricCategory;
  measurementUnit: string;
  calculationType: MetricCalculationType;
  isSystemMetric: boolean;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;

  /** Populated by metricMasterService.list() — number of active mappings. */
  mappingCount?: number;
}

export interface MetricFormValues {
  metricCode: string;
  metricName: string;
  category: MetricCategory;
  measurementUnit: string;
  calculationType: MetricCalculationType;
  isActive: boolean;
  displayOrder?: number;
}

export interface MetricFilters {
  companyId?: string;
  category?: MetricCategory;
  isActive?: boolean;
  search?: string;
}

export interface MetricMapping {
  id: string;
  metricId: string;
  metricName?: string;
  metricCode?: string;
  roleId: string | null;
  roleName?: string;
  departmentId: string | null;
  departmentName?: string;
  storeId: string | null;
  storeName?: string;
  employeeId: string | null;
  employeeName?: string;
  isActive: boolean;
}

export interface MetricMappingFormValues {
  metricId: string;
  roleId?: string;
  departmentId?: string;
  storeId?: string;
  employeeId?: string;
}

export interface PerformanceEntry {
  id: string;
  metricId: string;
  metricName?: string;
  metricCode?: string;
  measurementUnit?: string;
  employeeId: string | null;
  employeeName?: string;
  storeId: string;
  storeName?: string;
  departmentId: string | null;
  departmentName?: string;
  roleId: string | null;
  roleName?: string;
  sourceId: string | null;
  sourceLabel?: string;
  entryDate: string;
  entryValue: number;
  remarks: string | null;
  status: PerformanceEntryStatus;
  isLocked: boolean;
  createdAt: string;
}

export interface PerformanceEntryFormValues {
  metricId: string;
  employeeId?: string;
  storeId: string;
  departmentId?: string;
  roleId?: string;
  entryDate: string;
  entryValue: number;
  remarks?: string;
}

export interface BulkEntryRow {
  employeeId: string;
  employeeName: string;
  entryValue: string;
}

export interface PerformanceEntryFilters {
  companyId?: string;
  storeId?: string;
  departmentId?: string;
  roleId?: string;
  metricId?: string;
  employeeId?: string;
  status?: PerformanceEntryStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface MetricApproval {
  id: string;
  performanceEntryId: string;
  verifierName?: string;
  decision: MetricApprovalDecision;
  remarks: string | null;
  decidedAt: string;
}

export interface MetricApprovalFormValues {
  decision: MetricApprovalDecision;
  remarks?: string;
}

export interface MetricComment {
  id: string;
  comment: string;
  commentedByName?: string;
  createdAt: string;
}

export interface MetricHistoryEntry {
  id: string;
  action: "created" | "updated" | "approved" | "rejected" | "locked";
  oldValue: number | null;
  newValue: number | null;
  createdAt: string;
}

export interface PerformanceDashboardStats {
  todaysEntries: number;
  pendingEntries: number;
  approvedEntries: number;
  rejectedEntries: number;
  storeWise: Array<{ storeId: string; storeName: string; count: number }>;
  departmentWise: Array<{ departmentId: string; departmentName: string; count: number }>;
  roleWise: Array<{ roleId: string; roleName: string; count: number }>;
}
