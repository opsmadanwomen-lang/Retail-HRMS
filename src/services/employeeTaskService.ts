import { supabase } from "@/lib/supabaseClient";
import type {
  EmployeeTaskAssignmentRow,
  TaskSubmissionRow,
  TaskVerificationRow,
  Json,
} from "@/types/database.types";
import type {
  AssignTaskFormValues,
  EmployeeTaskAssignment,
  TaskComment,
  TaskHistoryEntry,
  TaskSubmission,
  TaskSubmissionFormValues,
  TaskVerification,
  TaskVerificationFormValues,
} from "@/types/task";

const ASSIGNMENT_SELECT = `
  *,
  employees ( full_name ),
  roles ( role_name ),
  task_master ( task_name, task_code, requires_verification, allow_photo_upload, allow_document_upload, allow_remarks, task_categories ( name ) ),
  stores ( name ),
  task_status ( code, label )
`;

type AssignmentJoinRow = EmployeeTaskAssignmentRow & {
  employees: { full_name: string } | null;
  roles: { role_name: string } | null;
  task_master: {
    task_name: string;
    task_code: string;
    requires_verification: boolean;
    allow_photo_upload: boolean;
    allow_document_upload: boolean;
    allow_remarks: boolean;
    task_categories: { name: string } | null;
  } | null;
  stores: { name: string } | null;
  task_status: { code: string; label: string } | null;
};

function mapAssignmentRow(row: AssignmentJoinRow): EmployeeTaskAssignment {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employees?.full_name,
    roleId: row.role_id,
    roleName: row.roles?.role_name,
    taskId: row.task_id,
    taskName: row.task_master?.task_name,
    taskCode: row.task_master?.task_code,
    categoryName: row.task_master?.task_categories?.name,
    requiresVerification: row.task_master?.requires_verification,
    allowPhotoUpload: row.task_master?.allow_photo_upload,
    allowDocumentUpload: row.task_master?.allow_document_upload,
    allowRemarks: row.task_master?.allow_remarks,
    storeId: row.store_id,
    storeName: row.stores?.name,
    statusId: row.status_id,
    statusCode: row.task_status?.code,
    statusLabel: row.task_status?.label,
    priority: row.priority,
    dueDate: row.due_date,
    dueTime: row.due_time,
    assignedAt: row.assigned_at,
  };
}

function mapSubmissionRow(row: TaskSubmissionRow): TaskSubmission {
  return {
    id: row.id,
    employeeTaskAssignmentId: row.employee_task_assignment_id,
    submittedAt: row.submitted_at,
    completionTime: row.completion_time,
    remarks: row.remarks,
    checklistResponses: (row.checklist_responses as unknown as TaskSubmission["checklistResponses"]) ?? [],
  };
}

function mapVerificationRow(row: TaskVerificationRow): TaskVerification {
  return {
    id: row.id,
    taskSubmissionId: row.task_submission_id,
    verifiedAt: row.verified_at,
    decision: row.decision,
    remarks: row.remarks,
    score: row.score,
  };
}

export const employeeTaskService = {
  async listForEmployee(employeeId: string): Promise<EmployeeTaskAssignment[]> {
    const { data, error } = await supabase
      .from("employee_task_assignment")
      .select(ASSIGNMENT_SELECT)
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .order("due_date", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => mapAssignmentRow(row as unknown as AssignmentJoinRow));
  },

  async list(
    filters: {
      companyId?: string;
      storeId?: string;
      roleId?: string;
      statusId?: string;
      priority?: string;
    } = {}
  ): Promise<EmployeeTaskAssignment[]> {
    let query = supabase.from("employee_task_assignment").select(ASSIGNMENT_SELECT).order("due_date", { ascending: true });
    if (filters.companyId) query = query.eq("company_id", filters.companyId);
    if (filters.storeId) query = query.eq("store_id", filters.storeId);
    if (filters.roleId) query = query.eq("role_id", filters.roleId);
    if (filters.statusId) query = query.eq("status_id", filters.statusId);
    if (filters.priority) {
  query = query.eq("priority", filters.priority as never);
}
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => mapAssignmentRow(row as unknown as AssignmentJoinRow));
  },

  async hasActiveAssignment(employeeId: string, taskId: string): Promise<boolean> {
    const { count, error } = await supabase
      .from("employee_task_assignment")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", employeeId)
      .eq("task_id", taskId)
      .eq("is_active", true);
    if (error) throw error;
    return (count ?? 0) > 0;
  },

  async assign(params: {
    employeeId: string;
    roleId: string | null;
    storeId: string;
    companyId: string;
    values: AssignTaskFormValues;
    assignedBy?: string;
  }): Promise<EmployeeTaskAssignment> {
    const alreadyActive = await this.hasActiveAssignment(params.employeeId, params.values.taskId);
    if (alreadyActive) throw new Error("This task is already assigned to this employee.");

    const { data: task, error: taskError } = await supabase
      .from("task_master")
      .select("id, is_active")
      .eq("id", params.values.taskId)
      .maybeSingle();
    if (taskError) throw taskError;
    if (!task) throw new Error("Task not found.");
    if (!task.is_active) throw new Error("This task is inactive and cannot be assigned.");

    const { data, error } = await supabase
      .from("employee_task_assignment")
      .insert({
        employee_id: params.employeeId,
        role_id: params.roleId,
        task_id: params.values.taskId,
        store_id: params.storeId,
        company_id: params.companyId,
        status_id: params.values.statusId,
        priority: params.values.priority,
        due_date: params.values.dueDate,
        due_time: params.values.dueTime || null,
        assigned_by: params.assignedBy ?? null,
        created_by: params.assignedBy ?? null,
        updated_by: params.assignedBy ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: created, error: fetchError } = await supabase
      .from("employee_task_assignment")
      .select(ASSIGNMENT_SELECT)
      .eq("id", data.id)
      .single();
    if (fetchError) throw fetchError;
    return mapAssignmentRow(created as unknown as AssignmentJoinRow);
  },

  async cancel(assignmentId: string, userId?: string): Promise<void> {
    const { data: statuses } = await supabase.from("task_status").select("id, code").eq("code", "cancelled").maybeSingle();
    const { error } = await supabase
      .from("employee_task_assignment")
      .update({ is_active: false, status_id: statuses?.id, updated_by: userId ?? null })
      .eq("id", assignmentId);
    if (error) throw error;
  },

  // -- Submission -------------------------------------------------------------

  async listSubmissions(assignmentId: string): Promise<TaskSubmission[]> {
    const { data, error } = await supabase
      .from("task_submission")
      .select("*")
      .eq("employee_task_assignment_id", assignmentId)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapSubmissionRow);
  },

  /**
   * Submits a task: validates every mandatory checklist item is checked
   * ("Mandatory checklist must be completed"), writes the submission, and
   * flips the assignment to Completed. Verification is a separate,
   * explicit step below.
   */
  async submit(params: {
    assignment: EmployeeTaskAssignment;
    mandatoryItemIds: string[];
    values: TaskSubmissionFormValues;
    submittedBy?: string;
  }): Promise<TaskSubmission> {
    const { assignment, mandatoryItemIds, values, submittedBy } = params;

    const checkedIds = new Set(values.checklistResponses.filter((r) => r.checked).map((r) => r.itemId));
    const missingMandatory = mandatoryItemIds.filter((id) => !checkedIds.has(id));
    if (missingMandatory.length > 0) {
      throw new Error("All mandatory checklist items must be completed before submitting.");
    }

    const { data, error } = await supabase
      .from("task_submission")
      .insert({
        employee_task_assignment_id: assignment.id,
        submitted_by: submittedBy ?? null,
        completion_time: values.completionTime || new Date().toISOString(),
        remarks: values.remarks || null,
        checklist_responses: values.checklistResponses as unknown as Json,
      })
      .select("*")
      .single();
    if (error) throw error;

    const { data: completedStatus } = await supabase.from("task_status").select("id").eq("code", "completed").maybeSingle();
    if (completedStatus) {
      await supabase
        .from("employee_task_assignment")
        .update({ status_id: completedStatus.id, updated_by: submittedBy ?? null })
        .eq("id", assignment.id);
    }

    await supabase.from("task_history").insert({
      employee_task_assignment_id: assignment.id,
      action: "submitted",
      status_id: completedStatus?.id ?? null,
      performed_by: submittedBy ?? null,
    });

    return mapSubmissionRow(data);
  },

  // -- Verification -------------------------------------------------------------

  /** Cannot verify an incomplete task — the caller must pass a real submission. */
  async verify(params: {
    submission: TaskSubmission;
    assignmentId: string;
    values: TaskVerificationFormValues;
    verifiedBy?: string;
  }): Promise<TaskVerification> {
    const { submission, assignmentId, values, verifiedBy } = params;

    const { data, error } = await supabase
      .from("task_verification")
      .insert({
        task_submission_id: submission.id,
        verified_by: verifiedBy ?? null,
        decision: values.decision,
        remarks: values.remarks || null,
        score: values.score ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    const newStatusCode = values.decision === "approved" ? "verified" : "rejected";
    const { data: newStatus } = await supabase.from("task_status").select("id").eq("code", newStatusCode).maybeSingle();
    if (newStatus) {
      await supabase
        .from("employee_task_assignment")
        .update({ status_id: newStatus.id, updated_by: verifiedBy ?? null })
        .eq("id", assignmentId);
    }

    await supabase.from("task_history").insert({
      employee_task_assignment_id: assignmentId,
      action: values.decision === "approved" ? "verified" : "rejected",
      status_id: newStatus?.id ?? null,
      performed_by: verifiedBy ?? null,
      remarks: values.remarks || null,
    });

    return mapVerificationRow(data);
  },

  // -- Comments -----------------------------------------------------------------

  async listComments(assignmentId: string): Promise<TaskComment[]> {
  const { data, error } = await supabase
    .from("task_comments")
    .select("*")
    .eq("employee_task_assignment_id", assignmentId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    comment: row.comment,
    commentedByName: undefined,
    createdAt: row.created_at,
  }));
},

  async addComment(assignmentId: string, comment: string, commentedBy?: string): Promise<TaskComment> {
    const { data, error } = await supabase
      .from("task_comments")
      .insert({ employee_task_assignment_id: assignmentId, comment, commented_by: commentedBy ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return { id: data.id, comment: data.comment, createdAt: data.created_at };
  },

  // -- History -------------------------------------------------------------------

  async listHistory(assignmentId: string): Promise<TaskHistoryEntry[]> {
    const { data, error } = await supabase
      .from("task_history")
      .select("*")
      .eq("employee_task_assignment_id", assignmentId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => ({
  id: row.id,
  action: row.action,
  statusLabel: undefined,
  remarks: row.remarks,
  createdAt: row.created_at,
}));
  },
};
