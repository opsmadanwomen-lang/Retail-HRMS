import { supabase } from "@/lib/supabaseClient";
import type { TaskScoreRow } from "@/types/database.types";
import type { TaskScore } from "@/types/task";

function mapRow(row: TaskScoreRow): TaskScore {
  return {
    id: row.id,
    employeeTaskAssignmentId: row.employee_task_assignment_id,
    weightage: row.weightage,
    completionPercentage: row.completion_percentage,
    verificationPercentage: row.verification_percentage,
    qualityScore: row.quality_score,
    finalScore: row.final_score,
    calculatedAt: row.calculated_at,
  };
}

export const taskScoreService = {
  async getForAssignment(assignmentId: string): Promise<TaskScore | null> {
    const { data, error } = await supabase
      .from("task_score")
      .select("*")
      .eq("employee_task_assignment_id", assignmentId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : null;
  },

  /**
   * Scoring Engine Foundation for tasks: reads the task's own weightage,
   * the latest submission's checklist responses (completion %), and the
   * latest verification (verification % + quality score), then upserts
   * one task_score row. Intentionally simple, matching the KPI engine's
   * calculateKpiResult — a full formula-based engine is future work.
   */
  async calculate(assignmentId: string, calculatedBy?: string): Promise<TaskScore> {
    const { data: assignment, error: assignmentError } = await supabase
      .from("employee_task_assignment")
      .select("task_id, task_master ( weightage )")
      .eq("id", assignmentId)
      .single();
    if (assignmentError) throw assignmentError;
    const weightage = Number((assignment as any)?.task_master?.weightage ?? 0);

    const { data: checklists } = await supabase
      .from("task_checklists")
      .select("id, task_checklist_items ( id, is_mandatory )")
      .eq("task_id", (assignment as any).task_id)
      .eq("is_active", true);

    const mandatoryItemIds = ((checklists ?? []) as any[]).flatMap((c) =>
      (c.task_checklist_items ?? []).filter((i: any) => i.is_mandatory).map((i: any) => i.id)
    );

    const { data: latestSubmission } = await supabase
      .from("task_submission")
      .select("*")
      .eq("employee_task_assignment_id", assignmentId)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let completionPercentage: number | null = null;
    if (latestSubmission) {
      const responses = (latestSubmission.checklist_responses as Array<{ itemId: string; checked: boolean }>) ?? [];
      const checkedIds = new Set(responses.filter((r) => r.checked).map((r) => r.itemId));
      completionPercentage =
        mandatoryItemIds.length > 0
          ? (mandatoryItemIds.filter((id: string) => checkedIds.has(id)).length / mandatoryItemIds.length) * 100
          : 100;
    }

    let verificationPercentage: number | null = null;
    let qualityScore: number | null = null;
    if (latestSubmission) {
      const { data: verification } = await supabase
        .from("task_verification")
        .select("*")
        .eq("task_submission_id", latestSubmission.id)
        .order("verified_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (verification) {
        verificationPercentage = verification.decision === "approved" ? 100 : 0;
        qualityScore = verification.score;
      }
    }

    const parts = [completionPercentage, verificationPercentage].filter((v): v is number => v !== null);
    const finalScore = parts.length > 0 ? parts.reduce((sum, v) => sum + v, 0) / parts.length : null;

    const { data, error } = await supabase
      .from("task_score")
      .upsert(
        {
          employee_task_assignment_id: assignmentId,
          weightage,
          completion_percentage: completionPercentage,
          verification_percentage: verificationPercentage,
          quality_score: qualityScore,
          final_score: finalScore,
          calculated_at: new Date().toISOString(),
          calculated_by: calculatedBy ?? null,
        },
        { onConflict: "employee_task_assignment_id" }
      )
      .select("*")
      .single();
    if (error) throw error;
    return mapRow(data);
  },
};
