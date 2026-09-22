import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { exitService } from "@/services/exitService";

const EXIT_KEY = ["exit-requests"] as const;
function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: EXIT_KEY });
  qc.invalidateQueries({ queryKey: ["fnf"] });
  qc.invalidateQueries({ queryKey: ["payroll"] });
  qc.invalidateQueries({ queryKey: ["employees"] });
}

export function useExitTypes(companyId?: string) {
  return useQuery({ queryKey: [...EXIT_KEY, "types", companyId], queryFn: () => exitService.listTypes(companyId as string), enabled: Boolean(companyId) });
}
export function useUpsertExitType() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof exitService.upsertType>[0]) => exitService.upsertType(p), onSuccess: () => qc.invalidateQueries({ queryKey: EXIT_KEY }) });
}
// Exit / F&F approver roster management: see useFnf.ts (useExitApprovers / useExitApproverMutations)
// — this workflow and F&F Core share the SAME roster.

export function useExitRequestList(companyId?: string) {
  return useQuery({ queryKey: [...EXIT_KEY, "list", companyId], queryFn: () => exitService.list(companyId as string), enabled: Boolean(companyId) });
}
export function useExitRequestDetail(id?: string) {
  return useQuery({ queryKey: [...EXIT_KEY, "detail", id], queryFn: () => exitService.get(id as string), enabled: Boolean(id) });
}
export function useExitRegister(companyId?: string, from?: string | null, to?: string | null) {
  return useQuery({ queryKey: [...EXIT_KEY, "register", companyId, from, to], queryFn: () => exitService.register(companyId as string, from, to), enabled: Boolean(companyId) });
}
export function useCreateExitRequest() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof exitService.create>[0]) => exitService.create(p), onSuccess: () => invalidate(qc) });
}
export function useExitRequestAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a:
      | { kind: "submit"; id: string }
      | { kind: "decide"; id: string; action: "approve" | "reject" | "send_back"; remark?: string }
      | { kind: "cancel"; id: string; reason: string }
      | { kind: "correct"; id: string; newDate: string; reason: string }
      | { kind: "create_fnf"; id: string }
    ) => {
      switch (a.kind) {
        case "submit": return exitService.submit(a.id);
        case "decide": return exitService.decide(a.id, a.action, a.remark);
        case "cancel": return exitService.cancel(a.id, a.reason);
        case "correct": return exitService.correctLeavingDate(a.id, a.newDate, a.reason);
        case "create_fnf": return exitService.createFnf(a.id);
      }
    },
    onSuccess: () => invalidate(qc),
  });
}
