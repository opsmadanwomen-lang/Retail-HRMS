import { supabase } from "@/lib/supabaseClient";
import type { AuditLogRow } from "@/types/database.types";

export const auditService = {
  async recentForRecord(tableName: string, recordId: string): Promise<AuditLogRow[]> {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("table_name", tableName)
      .eq("record_id", recordId)
      .order("performed_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return data ?? [];
  },
};
