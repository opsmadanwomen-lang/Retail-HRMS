import { useMutation, useQueryClient } from "@tanstack/react-query";
import { attendanceImportService } from "@/services/attendanceImportService";
import type { AttendanceImportPreviewRow } from "@/types/attendanceImport";

export function useParseAndPreviewAttendanceImport() {
  return useMutation({
    mutationFn: async ({ file, companyId }: { file: File; companyId: string }) => {
      const rawRows = await attendanceImportService.parseFile(file);
      return attendanceImportService.buildPreview(rawRows, companyId);
    },
  });
}

export function useCommitAttendanceImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { rows: AttendanceImportPreviewRow[]; companyId: string }) =>
      attendanceImportService.commitImport(params.rows, params.companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-admin"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}
