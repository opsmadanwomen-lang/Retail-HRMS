import { Download, Eye, FileText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/common/LoadingState";
import { useToast } from "@/components/ui/use-toast";
import { useEmployeeDocuments } from "@/hooks/useEmployeeDocuments";
import { employeeDocumentService } from "@/services/employeeDocumentService";
import { DOCUMENT_TYPE_LABELS, REQUIRED_DOCUMENT_TYPES } from "@/constants/documentTypes";
import { formatDate } from "@/lib/utils";
import type { EmployeeDocument } from "@/types/employee";
import type { EmployeeDocumentType } from "@/types/database.types";

/**
 * Staff Profile — "Document Details". READ-ONLY status list of the Staff's own documents.
 *
 * DATA SOURCE: the EXISTING employee_documents table via the EXISTING
 * useEmployeeDocuments()/employeeDocumentService — the SAME hook/service the admin Employee
 * Documents tool and the Staff Payslip & Documents page already use. No new table, service, hook,
 * or upload/download implementation is introduced here.
 *
 * DOCUMENT LIST: REQUIRED_DOCUMENT_TYPES (the same checklist the admin Employee Documents page
 * already uses to compute "X/Y Complete") is shown as the baseline checklist — each either
 * "Submitted" (a real employee_documents row exists) or "Not Submitted". Any OTHER document type
 * actually uploaded for this employee (joining_letter, appointment_letter, certificate, other) is
 * appended below so a genuinely-submitted optional document is never hidden. Nothing is hardcoded —
 * every row's presence/status/date comes directly from the query result.
 *
 * STATUS: this project's employee_documents table has no verification/approval status column
 * (confirmed by inspection — only document_type/file_name/storage_path/expiry_date/created_at) —
 * there is no "Verified/Rejected" concept to reuse, so none is invented. "Expired" is derived from
 * the EXISTING expiry_date column (a pure date comparison for display, not a new business rule).
 *
 * ACTIONS: View/Download reuse the EXACT same employeeDocumentService.getSignedUrl() +
 * window.open() pattern already used by the admin Employee Documents uploader and the Staff
 * Payslip & Documents page — no new storage/signing logic. No delete/replace/approve/reject
 * action exists on this card, by design.
 *
 * SECURITY: this component only ever receives `employeeId` from its caller (StaffProfilePage,
 * which resolves it via useCurrentEmployee() — never a URL/route param), so it can never be made
 * to load another employee's documents by manipulating this page. Note (pre-existing, not
 * introduced or weakened here): the employee_documents RLS SELECT policy is company-wide, not
 * employee-scoped — already disclosed on the Payslip & Documents page; this component adds no new
 * exposure since it never accepts an employeeId from anywhere but its own caller.
 */
export function DocumentDetailsCard({ employeeId }: { employeeId?: string }) {
  const { toast } = useToast();
  const documentsQuery = useEmployeeDocuments(employeeId);

  const handleOpen = async (storagePath: string) => {
    try {
      const url = await employeeDocumentService.getSignedUrl(storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Could not open document",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const documents = documentsQuery.data ?? [];
  // Latest row per document type — listForEmployee() is already ordered newest-first.
  const latestByType = new Map<string, EmployeeDocument>();
  for (const doc of documents) {
    if (!latestByType.has(doc.documentType)) latestByType.set(doc.documentType, doc);
  }

  const checklistTypes: EmployeeDocumentType[] = REQUIRED_DOCUMENT_TYPES;
  const extraTypes = Array.from(latestByType.keys()).filter((t) => !checklistTypes.includes(t as EmployeeDocumentType));

  const rows = [...checklistTypes, ...extraTypes].map((type) => {
    const doc = latestByType.get(type);
    const isExpired = Boolean(doc?.expiryDate && doc.expiryDate < new Date().toISOString().slice(0, 10));
    return { type, doc, isExpired };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document Details</CardTitle>
      </CardHeader>
      <CardContent>
        {documentsQuery.isLoading ? (
          <LoadingState />
        ) : documentsQuery.isError ? (
          <p className="text-sm text-destructive">Document details could not be loaded.</p>
        ) : (
          <div className="space-y-2">
            {rows.map(({ type, doc, isExpired }) => (
              <div key={type} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{DOCUMENT_TYPE_LABELS[type] ?? type}</p>
                    <p className="text-xs text-muted-foreground">{doc ? `Submitted ${formatDate(doc.createdAt)}` : "Not Submitted"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <Badge variant={!doc ? "secondary" : isExpired ? "destructive" : "success"}>
                    {!doc ? "Not Submitted" : isExpired ? "Expired" : "Submitted"}
                  </Badge>
                  {doc ? (
                    <>
                      <Button variant="ghost" size="icon" title="View" onClick={() => handleOpen(doc.storagePath)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Download" onClick={() => handleOpen(doc.storagePath)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
