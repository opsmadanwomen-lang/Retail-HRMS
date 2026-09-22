import type {
  KpiCalculationType,
  KpiTargetType,
  KpiMeasurementUnit,
  KpiFormulaType,
  PerformanceCycleType,
  PerformanceCycleStatus,
  KpiAssignmentSource,
} from "./database.types";

export type {
  KpiCalculationType,
  KpiTargetType,
  KpiMeasurementUnit,
  KpiFormulaType,
  PerformanceCycleType,
  PerformanceCycleStatus,
  KpiAssignmentSource,
};

export interface KpiCategory {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export interface Kpi {
  id: string;
  companyId: string | null;
  kpiCode: string;
  kpiName: string;
  categoryId: string | null;
  categoryName?: string;
  description: string | null;
  calculationType: KpiCalculationType;
  targetType: KpiTargetType;
  measurementUnit: KpiMeasurementUnit;
  dataSource: string;
  formulaType: KpiFormulaType;
  isSystemKpi: boolean;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;

  /** Populated by kpiService.list() — number of roles this KPI is mapped to. */
  mappedRoleCount?: number;
}

export interface KpiFormValues {
  kpiCode: string;
  kpiName: string;
  categoryId?: string;
  description?: string;
  calculationType: KpiCalculationType;
  targetType: KpiTargetType;
  measurementUnit: KpiMeasurementUnit;
  dataSource: string;
  formulaType: KpiFormulaType;
  isActive: boolean;
  displayOrder?: number;
}

export interface KpiFilters {
  companyId?: string;
  categoryId?: string;
  roleId?: string;
  storeId?: string;
  departmentId?: string;
  isActive?: boolean;
  search?: string;
}

export interface RoleKpiMapping {
  id: string;
  roleId: string;
  roleName?: string;
  kpiId: string;
  kpiName?: string;
  kpiCode?: string;
  categoryName?: string;
  calculationType?: KpiCalculationType;
  targetType?: KpiTargetType;
  isActive: boolean;
  currentWeightage: number | null;
}

export interface KpiWeightageDraft {
  roleKpiMappingId: string;
  kpiId: string;
  kpiName: string;
  weightage: number;
}

export interface EmployeeKpiAssignment {
  id: string;
  employeeId: string;
  kpiId: string;
  kpiName?: string;
  kpiCode?: string;
  categoryName?: string;
  roleId: string | null;
  roleName?: string;
  storeId: string;
  source: KpiAssignmentSource;
  isActive: boolean;
  assignedAt: string;

  // Enriched for the Employee KPI view.
  targetValue?: number | null;
  actualValue?: number | null;
  achievementPercentage?: number | null;
  score?: number | null;
  weightage?: number | null;
}

export interface KpiTarget {
  id: string;
  kpiId: string;
  storeId: string | null;
  departmentId: string | null;
  roleId: string | null;
  employeeId: string | null;
  targetValue: number;
  effectiveDate: string;
  expiryDate: string | null;
  isActive: boolean;
}

export interface KpiTargetFormValues {
  targetValue: number;
  effectiveDate: string;
  expiryDate?: string;
}

export interface KpiActualEntry {
  id: string;
  kpiId: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  actualValue: number;
  dataSource: string;
  notes: string | null;
  createdAt: string;
}

export interface KpiActualFormValues {
  periodStart: string;
  periodEnd: string;
  actualValue: number;
  notes?: string;
}

export interface PerformanceCycle {
  id: string;
  companyId: string | null;
  name: string;
  cycleType: PerformanceCycleType;
  startDate: string;
  endDate: string;
  status: PerformanceCycleStatus;
  isActive: boolean;
}

export interface PerformanceRating {
  id: string;
  code: string;
  label: string;
  minScore: number;
  maxScore: number;
  color: string | null;
}

export interface RoleWiseScore {
  roleId: string;
  roleName: string;
  score: number;
  kpiCount: number;
}

export interface PerformanceSummary {
  id: string;
  employeeId: string;
  performanceCycleId: string;
  cycleName?: string;
  overallScore: number | null;
  overallRatingId: string | null;
  overallRatingLabel?: string;
  overallRatingColor?: string | null;
  roleWiseScores: RoleWiseScore[];
  calculatedAt: string;
}

export interface KpiDashboardStats {
  totalKpi: number;
  mappedKpi: number;
  pendingKpi: number;
  activeCycleName: string | null;
  topPerformingRoles: Array<{ roleId: string; roleName: string; averageScore: number }>;
  topPerformingKpi: Array<{ kpiId: string; kpiName: string; averageAchievement: number }>;
}
