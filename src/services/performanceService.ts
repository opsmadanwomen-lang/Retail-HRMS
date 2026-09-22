import { supabase } from "@/lib/supabaseClient";
import type {
  PerformanceCycleRow,
  PerformanceRatingRow,
  Json,
} from "@/types/database.types";
import type {
  PerformanceCycle,
  PerformanceRating,
  PerformanceSummary,
  RoleWiseScore,
} from "@/types/kpi";

function mapCycleRow(row: PerformanceCycleRow): PerformanceCycle {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    cycleType: row.cycle_type,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    isActive: row.is_active,
  };
}

function mapRatingRow(row: PerformanceRatingRow): PerformanceRating {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    minScore: Number(row.min_score),
    maxScore: Number(row.max_score),
    color: row.color,
  };
}

export const performanceService = {
  // ---------------------------------------------------------------------------
  // PERFORMANCE CYCLES
  // ---------------------------------------------------------------------------

  async listCycles(companyId?: string): Promise<PerformanceCycle[]> {
    let query = supabase
      .from("performance_cycle")
      .select("*")
      .order("start_date", { ascending: false });

    if (companyId) {
      query = query.or(
        `company_id.is.null,company_id.eq.${companyId}`
      );
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return (data ?? []).map(mapCycleRow);
  },

  async getActiveCycle(
    companyId?: string
  ): Promise<PerformanceCycle | null> {
    let query = supabase
      .from("performance_cycle")
      .select("*")
      .eq("status", "active")
      .order("start_date", { ascending: false })
      .limit(1);

    if (companyId) {
      query = query.or(
        `company_id.is.null,company_id.eq.${companyId}`
      );
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapCycleRow(data) : null;
  },

  // ---------------------------------------------------------------------------
  // PERFORMANCE RATINGS
  // ---------------------------------------------------------------------------

  async listRatings(): Promise<PerformanceRating[]> {
    const { data, error } = await supabase
      .from("performance_rating")
      .select("*")
      .eq("is_active", true)
      .order("display_order");

    if (error) {
      throw error;
    }

    return (data ?? []).map(mapRatingRow);
  },

  async resolveRating(
    score: number
  ): Promise<PerformanceRating | null> {
    const ratings = await this.listRatings();

    return (
      ratings.find(
        (r) => score >= r.minScore && score <= r.maxScore
      ) ?? null
    );
  },

  // ---------------------------------------------------------------------------
  // KPI SCORING
  // ---------------------------------------------------------------------------

  /**
   * Scoring Engine Foundation:
   *
   * Converts achievement percentage into a 0-5 score.
   *
   * If range_based scoring rules are configured,
   * the matching score_value is used.
   *
   * Otherwise:
   * achievement % / 20
   *
   * Maximum score = 5
   */
  async calculateScore(
    kpiId: string,
    achievementPercentage: number
  ): Promise<number> {
    const { data: rules, error } = await supabase
      .from("kpi_scoring_rules")
      .select("*")
      .eq("kpi_id", kpiId)
      .eq("is_active", true)
      .order("display_order");

    if (error) {
      throw error;
    }

    const rangeRule = (rules ?? []).find(
      (r) =>
        r.rule_type === "range_based" &&
        r.min_value !== null &&
        r.max_value !== null &&
        achievementPercentage >= r.min_value &&
        achievementPercentage <= r.max_value
    );

    if (
      rangeRule?.score_value !== null &&
      rangeRule?.score_value !== undefined
    ) {
      return Number(rangeRule.score_value);
    }

    return Math.max(
      0,
      Math.min(5, achievementPercentage / 20)
    );
  },

  // ---------------------------------------------------------------------------
  // KPI RESULT
  // ---------------------------------------------------------------------------

  /**
   * Calculates and stores one KPI result for:
   *
   * Employee + KPI + Performance Cycle
   */
  async calculateKpiResult(params: {
    employeeId: string;
    kpiId: string;
    roleId: string | null;
    companyId: string;
    cycleId: string;
    calculatedBy?: string;
  }): Promise<void> {
    const {
      employeeId,
      kpiId,
      roleId,
      companyId,
      cycleId,
      calculatedBy,
    } = params;

    // -------------------------------------------------------------------------
    // 1. Get performance cycle
    // -------------------------------------------------------------------------

    const { data: cycle, error: cycleError } = await supabase
      .from("performance_cycle")
      .select("start_date, end_date")
      .eq("id", cycleId)
      .single();

    if (cycleError) {
      throw cycleError;
    }

    // -------------------------------------------------------------------------
    // 2. Get latest active target
    // -------------------------------------------------------------------------

    const { data: target } = await supabase
      .from("kpi_target")
      .select("target_value")
      .eq("kpi_id", kpiId)
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    // -------------------------------------------------------------------------
    // 3. Get KPI actuals
    // -------------------------------------------------------------------------

    const { data: actuals, error: actualsError } = await supabase
      .from("kpi_actual")
      .select("actual_value")
      .eq("kpi_id", kpiId)
      .eq("employee_id", employeeId)
      .gte("period_start", cycle.start_date)
      .lte("period_end", cycle.end_date);

    if (actualsError) {
      throw actualsError;
    }

    // -------------------------------------------------------------------------
    // 4. Calculate actual value
    // -------------------------------------------------------------------------

    const actualRows = (actuals ?? []) as Array<{
      actual_value: number | string | null;
    }>;

    const hasActuals = actualRows.length > 0;

    const actualValue = actualRows.reduce(
      (sum, a) => sum + Number(a.actual_value ?? 0),
      0
    );

    const targetValue =
      target && (target as any).target_value !== null
        ? Number((target as any).target_value)
        : null;

    // -------------------------------------------------------------------------
    // 5. Calculate achievement percentage
    // -------------------------------------------------------------------------

    const achievementPercentage =
      targetValue !== null &&
      targetValue !== 0 &&
      hasActuals
        ? (actualValue / targetValue) * 100
        : null;

    // -------------------------------------------------------------------------
    // 6. Calculate score
    // -------------------------------------------------------------------------

    const score =
      achievementPercentage !== null
        ? await this.calculateScore(
            kpiId,
            achievementPercentage
          )
        : null;

    // -------------------------------------------------------------------------
    // 7. Get KPI weightage from role mapping
    // -------------------------------------------------------------------------

    let weightage: number | null = null;

    if (roleId) {
      const { data: mapping } = await supabase
        .from("role_kpi_mapping")
        .select(
          "id, kpi_weightage ( weightage, is_active )"
        )
        .eq("role_id", roleId)
        .eq("kpi_id", kpiId)
        .maybeSingle();

      const mappingData = mapping as any;

      const activeWeightage =
        mappingData?.kpi_weightage?.find(
          (w: any) => w.is_active
        );

      weightage = activeWeightage
        ? Number(activeWeightage.weightage)
        : null;
    }

    // -------------------------------------------------------------------------
    // 8. Calculate weighted score
    // -------------------------------------------------------------------------

    const weightedScore =
      score !== null && weightage !== null
        ? (score * weightage) / 100
        : null;

    // -------------------------------------------------------------------------
    // 9. Upsert KPI result
    // -------------------------------------------------------------------------

    const resultPayload = {
      employee_id: employeeId,
      kpi_id: kpiId,
      role_id: roleId,
      company_id: companyId,
      performance_cycle_id: cycleId,
      target_value: targetValue,
      actual_value: hasActuals ? actualValue : null,
      achievement_percentage: achievementPercentage,
      score,
      weightage,
      weighted_score: weightedScore,
      calculated_at: new Date().toISOString(),
      calculated_by: calculatedBy ?? null,
    };

    const { error } = await supabase
      .from("kpi_result")
      .upsert(
        resultPayload,
        {
          onConflict:
            "employee_id,kpi_id,performance_cycle_id",
        }
      );

    if (error) {
      throw error;
    }
  },

  // ---------------------------------------------------------------------------
  // PERFORMANCE SUMMARY
  // ---------------------------------------------------------------------------

  /**
   * Rolls up KPI results for an employee and cycle.
   *
   * Produces:
   * - Role-wise score
   * - Overall score
   * - Overall rating
   * - Performance summary
   */
  async calculatePerformanceSummary(params: {
    employeeId: string;
    companyId: string;
    cycleId: string;
    calculatedBy?: string;
  }): Promise<PerformanceSummary> {
    const {
      employeeId,
      companyId,
      cycleId,
      calculatedBy,
    } = params;

    // -------------------------------------------------------------------------
    // 1. Get KPI results
    // -------------------------------------------------------------------------

    const { data: results, error } = await supabase
      .from("kpi_result")
      .select("*, roles ( role_name )")
      .eq("employee_id", employeeId)
      .eq("performance_cycle_id", cycleId);

    if (error) {
      throw error;
    }

    const rows = (results ?? []) as any[];

    // -------------------------------------------------------------------------
    // 2. Group KPI results by role
    // -------------------------------------------------------------------------

    const byRole = new Map<
      string,
      {
        roleName: string;
        weightedSum: number;
        weightSum: number;
        kpiCount: number;
      }
    >();

    for (const row of rows) {
      if (row.score === null) {
        continue;
      }

      const key = row.role_id ?? "unassigned";

      const roleName =
        row.roles?.role_name ?? "General";

      const entry =
        byRole.get(key) ??
        {
          roleName,
          weightedSum: 0,
          weightSum: 0,
          kpiCount: 0,
        };

      const scoreOn100 =
        (Number(row.score) / 5) * 100;

      const weight =
        row.weightage !== null
          ? Number(row.weightage)
          : 100;

      entry.weightedSum +=
        scoreOn100 * weight;

      entry.weightSum += weight;

      entry.kpiCount += 1;

      byRole.set(key, entry);
    }

    // -------------------------------------------------------------------------
    // 3. Prepare role-wise scores
    // -------------------------------------------------------------------------

    const roleWiseScores: RoleWiseScore[] =
      Array.from(byRole.entries()).map(
        ([roleId, value]) => ({
          roleId,
          roleName: value.roleName,
          score:
            value.weightSum > 0
              ? Math.round(
                  (value.weightedSum /
                    value.weightSum) *
                    100
                ) / 100
              : 0,
          kpiCount: value.kpiCount,
        })
      );

    // -------------------------------------------------------------------------
    // 4. Calculate overall score
    // -------------------------------------------------------------------------

    const overallScore =
      roleWiseScores.length > 0
        ? Math.round(
            (roleWiseScores.reduce(
              (sum, r) => sum + r.score,
              0
            ) /
              roleWiseScores.length) *
              100
          ) / 100
        : null;

    // -------------------------------------------------------------------------
    // 5. Resolve rating
    // -------------------------------------------------------------------------

    const rating =
      overallScore !== null
        ? await this.resolveRating(
            overallScore
          )
        : null;

    // -------------------------------------------------------------------------
    // 6. Prepare summary payload
    // -------------------------------------------------------------------------

    const summaryPayload = {
      employee_id: employeeId,
      company_id: companyId,
      performance_cycle_id: cycleId,
      overall_score: overallScore,
      overall_rating_id:
        rating?.id ?? null,
      role_wise_scores: roleWiseScores as unknown as Json,
      calculated_at:
        new Date().toISOString(),
      calculated_by:
        calculatedBy ?? null,
    };

    // -------------------------------------------------------------------------
    // 7. Upsert performance summary
    // -------------------------------------------------------------------------

    const { data: summaryData, error: upsertError } =
      await supabase
        .from("performance_summary")
        .upsert(
          summaryPayload,
          {
            onConflict:
              "employee_id,performance_cycle_id",
          }
        )
        .select(
          "*, performance_cycle ( name )"
        )
        .single();

    if (upsertError) {
      throw upsertError;
    }

    // -------------------------------------------------------------------------
    // IMPORTANT:
    // Supabase generated Database type currently resolves this result
    // as "never" in some places. Convert it to a local safe type.
    // -------------------------------------------------------------------------

    const summary = summaryData as any;

    // -------------------------------------------------------------------------
    // 8. Return mapped performance summary
    // -------------------------------------------------------------------------

    return {
      id: summary.id,
      employeeId: summary.employee_id,
      performanceCycleId:
        summary.performance_cycle_id,

      cycleName:
        summary.performance_cycle?.name,

      overallScore:
        summary.overall_score,

      overallRatingId:
        summary.overall_rating_id,

      overallRatingLabel:
        rating?.label,

      overallRatingColor:
        rating?.color,

      roleWiseScores:
        (summary.role_wise_scores ??
          []) as RoleWiseScore[],

      calculatedAt:
        summary.calculated_at,
    };
  },

  // ---------------------------------------------------------------------------
  // GET PERFORMANCE SUMMARY
  // ---------------------------------------------------------------------------

  async getSummaryForEmployee(
    employeeId: string,
    cycleId: string
  ): Promise<PerformanceSummary | null> {
    const { data: summaryData, error } =
      await supabase
        .from("performance_summary")
        .select(
          "*, performance_cycle ( name ), performance_rating ( label, color )"
        )
        .eq("employee_id", employeeId)
        .eq(
          "performance_cycle_id",
          cycleId
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    if (!summaryData) {
      return null;
    }

    // -------------------------------------------------------------------------
    // IMPORTANT:
    // Prevent TypeScript "property does not exist on type never"
    // caused by incomplete/generated Supabase table typing.
    // -------------------------------------------------------------------------

    const data = summaryData as any;

    return {
      id: data.id,

      employeeId:
        data.employee_id,

      performanceCycleId:
        data.performance_cycle_id,

      cycleName:
        data.performance_cycle?.name,

      overallScore:
        data.overall_score,

      overallRatingId:
        data.overall_rating_id,

      overallRatingLabel:
        data.performance_rating?.label,

      overallRatingColor:
        data.performance_rating?.color,

      roleWiseScores:
        (data.role_wise_scores ??
          []) as RoleWiseScore[],

      calculatedAt:
        data.calculated_at,
    };
  },
};