import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeeDocumentService } from "@/services/employeeDocumentService";
import type { EmployeeDocumentType } from "@/types/database.types";
import type { EmployeeDocument } from "@/types/employee";

export function useEmployeeDocuments(employeeId?: string) {
  return useQuery({
    queryKey: ["employee-documents", employeeId],
    queryFn: () => employeeDocumentService.listForEmployee(employeeId as string),
    enabled: Boolean(employeeId),
  });
}

export function useUploadEmployeeDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      companyId: string;
      employeeId: string;
      documentType: EmployeeDocumentType;
      file: File;
      documentNumber?: string;
      expiryDate?: string;
      notes?: string;
      uploadedBy?: string;
      replaceDocumentId?: string;
    }) => employeeDocumentService.upload(params),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["employee-documents", variables.employeeId] }),
  });
}

export function useDeleteEmployeeDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (document: EmployeeDocument) => employeeDocumentService.remove(document),
    onSuccess: (_, document) =>
      queryClient.invalidateQueries({ queryKey: ["employee-documents", document.employeeId] }),
  });
}
