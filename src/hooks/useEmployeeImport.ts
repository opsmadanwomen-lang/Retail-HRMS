import { useMutation, useQueryClient } from "@tanstack/react-query";
import { employeeImportService } from "@/services/employeeImportService";
import type { EmployeeImportPreviewRow } from "@/types/employee";

export function useParseAndValidateImport() {
  return useMutation({
    mutationFn: async ({ file, companyId }: { file: File; companyId: string }) => {
      const rows = await employeeImportService.parseFile(file);
      return employeeImportService.validateAndResolve(rows, companyId);
    },
  });
}

export function useCommitImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      fileName: string;
      companyId: string;
      rows: EmployeeImportPreviewRow[];
      performedBy?: string;
    }) => employeeImportService.importValidRows(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });
}
