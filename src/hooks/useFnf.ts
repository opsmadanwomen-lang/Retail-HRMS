import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fnfService } from "@/services/fnfService";

const FNF_KEY = ["fnf"] as const;
function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: FNF_KEY });
  qc.invalidateQueries({ queryKey: ["payroll"] });
  qc.invalidateQueries({ queryKey: ["employees"] });
}

export function useFnfAmIApprover(companyId?: string) {
  return useQuery({ queryKey: [...FNF_KEY, "approver", companyId], queryFn: () => fnfService.amIApprover(companyId as string), enabled: Boolean(companyId) });
}
export function useFnfList(companyId?: string) {
  return useQuery({ queryKey: [...FNF_KEY, "list", companyId], queryFn: () => fnfService.list(companyId as string), enabled: Boolean(companyId) });
}
export function useFnfDetail(id?: string) {
  return useQuery({ queryKey: [...FNF_KEY, "detail", id], queryFn: () => fnfService.get(id as string), enabled: Boolean(id) });
}
export function useFnfRegister(companyId?: string, from?: string | null, to?: string | null) {
  return useQuery({
    queryKey: [...FNF_KEY, "register", companyId, from, to],
    queryFn: () => fnfService.register(companyId as string, from, to),
    enabled: Boolean(companyId),
  });
}

export function useCreateFnf() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof fnfService.create>[0]) => fnfService.create(p), onSuccess: () => invalidate(qc) });
}
export function useAddFnfAdjustment() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof fnfService.addAdjustment>[0]) => fnfService.addAdjustment(p), onSuccess: () => invalidate(qc) });
}
export function useCalculateFnf() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => fnfService.calculate(id), onSuccess: () => invalidate(qc) });
}
export function useFnfAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a:
      | { kind: "submit"; id: string }
      | { kind: "approve"; id: string; note?: string }
      | { kind: "reject"; id: string; reason: string }
      | { kind: "send_back"; id: string; reason: string }
      | { kind: "reverse"; id: string; reason: string }
      | { kind: "pay"; id: string; amount: number; paymentDate: string; paymentMode?: string; transactionReference?: string; bankDetails?: string; notes?: string }
    ) => {
      switch (a.kind) {
        case "submit": return fnfService.submit(a.id);
        case "approve": return fnfService.approve(a.id, a.note);
        case "reject": return fnfService.reject(a.id, a.reason);
        case "send_back": return fnfService.sendBack(a.id, a.reason);
        case "reverse": return fnfService.reverse(a.id, a.reason);
        case "pay": return fnfService.pay(a);
      }
    },
    onSuccess: () => invalidate(qc),
  });
}

// ---- exit / F&F configuration ----
const CFG_KEY = ["fnf-config"] as const;
export function useFnfSettings(companyId?: string) {
  return useQuery({ queryKey: [...CFG_KEY, "settings", companyId], queryFn: () => fnfService.getSettings(companyId as string), enabled: Boolean(companyId) });
}
export function useSaveFnfSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof fnfService.saveSettings>[0]) => fnfService.saveSettings(p), onSuccess: () => qc.invalidateQueries({ queryKey: CFG_KEY }) });
}
export function useExitApprovers(companyId?: string) {
  return useQuery({ queryKey: [...CFG_KEY, "approvers", companyId], queryFn: () => fnfService.listApprovers(companyId as string), enabled: Boolean(companyId) });
}
export function useExitApproverMutations() {
  const qc = useQueryClient();
  const add = useMutation({ mutationFn: (p: { companyId: string; employeeId: string; userId?: string | null; stageNo?: number }) => fnfService.addApprover(p.companyId, p.employeeId, p.userId, p.stageNo ?? 1), onSuccess: () => qc.invalidateQueries({ queryKey: CFG_KEY }) });
  const toggle = useMutation({ mutationFn: (p: { id: string; isActive: boolean }) => fnfService.setApproverActive(p.id, p.isActive), onSuccess: () => qc.invalidateQueries({ queryKey: CFG_KEY }) });
  return { add, toggle };
}
export function useExitNoticePolicies(companyId?: string) {
  return useQuery({ queryKey: [...CFG_KEY, "notice", companyId], queryFn: () => fnfService.listNoticePolicies(companyId as string), enabled: Boolean(companyId) });
}
export function useSaveExitNoticePolicy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: any) => fnfService.saveNoticePolicy(p), onSuccess: () => qc.invalidateQueries({ queryKey: CFG_KEY }) });
}
