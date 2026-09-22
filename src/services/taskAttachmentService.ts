import { supabase } from "@/lib/supabaseClient";
import type { TaskAttachmentRow } from "@/types/database.types";
import type { TaskAttachment, TaskAttachmentType } from "@/types/task";

const BUCKET = "task-attachments";

function mapRow(row: TaskAttachmentRow): TaskAttachment {
  return {
    id: row.id,
    attachmentType: row.attachment_type,
    fileName: row.file_name,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  };
}

export const taskAttachmentService = {
  async listForAssignment(assignmentId: string): Promise<TaskAttachment[]> {
    const { data, error } = await supabase
      .from("task_attachments")
      .select("*")
      .eq("employee_task_assignment_id", assignmentId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async upload(params: {
    companyId: string;
    assignmentId: string;
    submissionId?: string;
    attachmentType: TaskAttachmentType;
    file: File;
    uploadedBy?: string;
  }): Promise<TaskAttachment> {
    const { companyId, assignmentId, submissionId, attachmentType, file, uploadedBy } = params;
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const storagePath = `${companyId}/${assignmentId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("task_attachments")
      .insert({
        employee_task_assignment_id: assignmentId,
        task_submission_id: submissionId ?? null,
        company_id: companyId,
        attachment_type: attachmentType,
        file_name: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size_bytes: file.size,
        uploaded_by: uploadedBy ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapRow(data);
  },

  async getSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  },

  async remove(attachment: TaskAttachment): Promise<void> {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([attachment.storagePath]);
    if (storageError) throw storageError;
    const { error } = await supabase.from("task_attachments").delete().eq("id", attachment.id);
    if (error) throw error;
  },
};
