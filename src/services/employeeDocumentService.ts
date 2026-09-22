import { supabase } from "@/lib/supabaseClient";
import type {
  EmployeeDocumentRow,
  EmployeeDocumentType,
} from "@/types/database.types";
import type { EmployeeDocument } from "@/types/employee";

const BUCKET = "employee-documents";

function mapRow(row: EmployeeDocumentRow): EmployeeDocument {
  return {
    id: row.id,
    employeeId: row.employee_id,
    documentType: row.document_type,
    documentNumber: row.document_number ?? null,
    fileName: row.file_name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    notes: row.notes,
    expiryDate: row.expiry_date ?? null,
    createdAt: row.created_at,
  };
}

export const employeeDocumentService = {
  // ------------------------------------------------------------
  // LIST EMPLOYEE DOCUMENTS
  // ------------------------------------------------------------
  async listForEmployee(
    employeeId: string
  ): Promise<EmployeeDocument[]> {
    const { data, error } = await supabase
      .from("employee_documents")
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map(mapRow);
  },

  // ------------------------------------------------------------
  // UPLOAD EMPLOYEE DOCUMENT
  // ------------------------------------------------------------
  async upload(params: {
    companyId: string;
    employeeId: string;
    documentType: EmployeeDocumentType;
    file?: File;
    documentNumber?: string;
    expiryDate?: string;
    notes?: string;
    uploadedBy?: string;
    replaceDocumentId?: string;
  }): Promise<EmployeeDocument> {
    const {
      companyId,
      employeeId,
      documentType,
      file,
      documentNumber,
      expiryDate,
      notes,
      uploadedBy,
      replaceDocumentId,
    } = params;

    if (!file && !replaceDocumentId) {
      throw new Error("A file is required to create a new document.");
    }

    let existingDocument: EmployeeDocumentRow | null = null;
    if (replaceDocumentId) {
      const { data, error } = await supabase
        .from("employee_documents")
        .select("*")
        .eq("id", replaceDocumentId)
        .maybeSingle();

      if (error) throw error;
      existingDocument = data;
    }

    let storagePath = existingDocument?.storage_path ?? "";
    let fileName = existingDocument?.file_name ?? "";
    let mimeType = existingDocument?.mime_type ?? null;
    let fileSizeBytes = existingDocument?.file_size_bytes ?? null;

    if (file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      storagePath = `${companyId}/${employeeId}/${documentType}/${Date.now()}_${safeName}`;
      fileName = file.name;
      mimeType = file.type || null;
      fileSizeBytes = file.size;
    }

    // ----------------------------------------------------------
    // 1. Upload file to Supabase Storage
    // ----------------------------------------------------------

    if (file) {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || undefined,
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }
    }

    // ----------------------------------------------------------
    // 2. Save document information in database
    // ----------------------------------------------------------

    try {
      if (replaceDocumentId && existingDocument) {
        const oldStoragePath = existingDocument.storage_path;

        const { data, error } = await supabase
          .from("employee_documents")
          .update({
            document_type: documentType,
            document_number: documentNumber || null,
            file_name: fileName,
            storage_path: storagePath,
            mime_type: mimeType,
            file_size_bytes: fileSizeBytes,
            notes: notes || null,
            uploaded_by: uploadedBy ?? null,
            expiry_date: expiryDate || null,
          })
          .eq("id", replaceDocumentId)
          .select("*")
          .single();

        if (error) {
          await supabase.storage.from(BUCKET).remove([storagePath]);
          throw error;
        }

        if (oldStoragePath && oldStoragePath !== storagePath) {
          await supabase.storage.from(BUCKET).remove([oldStoragePath]);
        }

        return mapRow(data);
      }

      const { data, error } = await supabase
        .from("employee_documents")
        .insert({
          employee_id: employeeId,
          company_id: companyId,
          document_type: documentType,
          document_number: documentNumber || null,
          file_name: fileName,
          storage_path: storagePath,
          mime_type: mimeType,
          file_size_bytes: fileSizeBytes,
          notes: notes || null,
          uploaded_by: uploadedBy ?? null,
          expiry_date: expiryDate || null,
        })
        .select("*")
        .single();

      if (error) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        throw error;
      }

      return mapRow(data);
    } catch (error) {
      if (file && storagePath) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
      }
      throw error;
    }
  },

  // ------------------------------------------------------------
  // GET SIGNED URL
  // ------------------------------------------------------------
  async getSignedUrl(
    storagePath: string,
    expiresInSeconds = 300
  ): Promise<string> {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(
        storagePath,
        expiresInSeconds
      );

    if (error) {
      throw error;
    }

    return data.signedUrl;
  },

  // ------------------------------------------------------------
  // DELETE EMPLOYEE DOCUMENT
  // ------------------------------------------------------------
  async remove(
    document: EmployeeDocument
  ): Promise<void> {
    // ----------------------------------------------------------
    // 1. Delete file from Storage
    // ----------------------------------------------------------

    const { error: storageError } =
      await supabase.storage
        .from(BUCKET)
        .remove([document.storagePath]);

    if (storageError) {
      throw storageError;
    }

    // ----------------------------------------------------------
    // 2. Delete database record
    // ----------------------------------------------------------

    const { error } = await supabase
      .from("employee_documents")
      .delete()
      .eq("id", document.id);

    if (error) {
      throw error;
    }
  },
};