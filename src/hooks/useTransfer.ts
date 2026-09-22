import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { transferService } from "@/services/transferService";

const XFER_KEY = ["employee-transfers"] as const;
function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: XFER_KEY });
  qc.invalidateQueries({ queryKey: ["payroll"] });
  qc.invalidateQueries({ queryKey: ["employees"] });
}

export function useTransferApprovers(companyId?: string) {
  return useQuery({ queryKey: [...XFER_KEY, "approvers", companyId], queryFn: () => transferService.listApprovers(companyId as string), enabled: Boolean(companyId) });
}
export function useTransferApproverMutations() {
  const qc = useQueryClient();
  const add = useMutation({ mutationFn: (p: { companyId: string; employeeId: string; stageNo: number; userId?: string | null }) => transferService.addApprover(p.companyId, p.employeeId, p.stageNo, p.userId), onSuccess: () => qc.invalidateQueries({ queryKey: XFER_KEY }) });
  const toggle = useMutation({ mutationFn: (p: { id: string; isActive: boolean }) => transferService.setApproverActive(p.id, p.isActive), onSuccess: () => qc.invalidateQueries({ queryKey: XFER_KEY }) });
  return { add, toggle };
}

export function useTransferList(companyId?: string) {
  const qc = useQueryClient();
  // best-effort sweep (once per mount) so approved-but-future-dated transfers that
  // have now come due show as "effective" — this project has no server cron.
  useEffect(() => {
    if (!companyId) return;
    transferService.applyDue(companyId).then((n) => { if (n > 0) qc.invalidateQueries({ queryKey: XFER_KEY }); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);
  return useQuery({ queryKey: [...XFER_KEY, "list", companyId], queryFn: () => transferService.list(companyId as string), enabled: Boolean(companyId) });
}
export function useTransferDetail(id?: string) {
  return useQuery({ queryKey: [...XFER_KEY, "detail", id], queryFn: () => transferService.get(id as string), enabled: Boolean(id) });
}
export function useTransferRegister(p: { companyId?: string; from?: string | null; to?: string | null; employeeId?: string | null; status?: string | null }) {
  return useQuery({
    queryKey: [...XFER_KEY, "register", p.companyId, p.from, p.to, p.employeeId, p.status],
    queryFn: () => transferService.register({ ...p, companyId: p.companyId as string }),
    enabled: Boolean(p.companyId),
  });
}
export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: Parameters<typeof transferService.create>[0]) => transferService.create(p), onSuccess: () => invalidate(qc) });
}
export function useTransferAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a:
      | { kind: "submit"; id: string }
      | { kind: "decide"; id: string; action: "approve" | "reject"; remark?: string }
      | { kind: "cancel"; id: string; reason: string }
    ) => {
      switch (a.kind) {
        case "submit": return transferService.submit(a.id);
        case "decide": return transferService.decide(a.id, a.action, a.remark);
        case "cancel": return transferService.cancel(a.id, a.reason);
      }
    },
    onSuccess: () => invalidate(qc),
  });
}
