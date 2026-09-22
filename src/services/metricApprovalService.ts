import { supabase } from "@/lib/supabaseClient";
import type { MetricApprovalRow, MetricCommentRow, MetricHistoryRow } from "@/types/database.types";
import type { MetricApproval, MetricApprovalFormValues, MetricComment, MetricHistoryEntry } from "@/types/performance";

function mapApprovalRow(row: MetricApprovalRow & { profiles: { full_name: string } | null }): MetricApproval {
  return {
    id: row.id,
    performanceEntryId: row.performance_entry_id,
    verifierName: row.profiles?.full_name,
    decision: row.decision,
    remarks: row.remarks,
    decidedAt: row.decided_at,
  };
}

export const metricApprovalService = {
  async listForEntry(entryId: string): Promise<MetricApproval[]> {
    const { data, error } = await supabase
      .from("metric_approval")
      .select("*, profiles:verifier_id ( full_name )")
      .eq("performance_entry_id", entryId)
      .order("decided_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapApprovalRow(row as any));
  },

  /** Rejects re-verifying a locked entry — approving also locks the entry. */
  async decide(entryId: string, values: MetricApprovalFormValues, verifierId?: string): Promise<MetricApproval> {
    const { data: entry, error: entryError } = await supabase
      .from("performance_entries")
      .select("is_locked")
      .eq("id", entryId)
      .single();
    if (entryError) throw entryError;
    if (entry.is_locked) throw new Error("This entry is locked and cannot be re-verified.");

    const { data, error } = await supabase
      .from("metric_approval")
      .insert({
        performance_entry_id: entryId,
        verifier_id: verifierId ?? null,
        decision: values.decision,
        remarks: values.remarks || null,
      })
      .select("*, profiles:verifier_id ( full_name )")
      .single();
    if (error) throw error;

    await supabase
      .from("performance_entries")
      .update({
        status: values.decision === "approved" ? "approved" : "rejected",
        is_locked: values.decision === "approved",
        updated_by: verifierId ?? null,
      })
      .eq("id", entryId);

    return mapApprovalRow(data as any);
  },
};

export const metricCommentService = {
  async listForEntry(entryId: string): Promise<MetricComment[]> {
    const { data, error } = await supabase
      .from("metric_comments")
      .select("*, profiles:commented_by ( full_name )")
      .eq("performance_entry_id", entryId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: MetricCommentRow & { profiles: { full_name: string } | null }) => ({
      id: row.id,
      comment: row.comment,
      commentedByName: row.profiles?.full_name,
      createdAt: row.created_at,
    }));
  },

  async add(entryId: string, comment: string, commentedBy?: string): Promise<MetricComment> {
    const { data, error } = await supabase
      .from("metric_comments")
      .insert({ performance_entry_id: entryId, comment, commented_by: commentedBy ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return { id: data.id, comment: data.comment, createdAt: data.created_at };
  },
};

export const metricHistoryService = {
  async listForEntry(entryId: string): Promise<MetricHistoryEntry[]> {
    const { data, error } = await supabase
      .from("metric_history")
      .select("*")
      .eq("performance_entry_id", entryId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: MetricHistoryRow) => ({
      id: row.id,
      action: row.action as MetricHistoryEntry["action"],
      oldValue: row.old_value,
      newValue: row.new_value,
      createdAt: row.created_at,
    }));
  },
};
