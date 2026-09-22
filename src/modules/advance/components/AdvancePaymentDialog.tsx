import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { LoadingState } from "@/components/common/LoadingState";
import { useAdvanceFinancePayment, useAdvanceFinancePay, useAdvancePaymentModes } from "@/hooks/useAdvance";
import { advanceService } from "@/services/advanceService";
import { formatAmount } from "@/modules/advance/utils";

/** Minimal shape either the Finance Advance Payment page's own rows or the HR Panel's unified
 *  Advance Workflow rows already satisfy — no cross-import of either page's specific row type. */
interface AdvancePaymentTarget {
  id: string;
  employeeName: string;
  advanceTypeName: string;
  bossApprovedAmount: number | null;
}

/**
 * The existing Pay Advance dialog (Phase 3), extracted verbatim from
 * FinanceAdvancePaymentPage.tsx so the HR Panel's unified Advance Workflow page (migration 0168)
 * reuses the EXACT same payment engine/validation instead of a second implementation. No business
 * logic changed: Boss Approved Amount is still the hard cap, partial payment still follows the
 * resolved policy's allowPartialPayment flag, payment proof stays optional.
 */
export function AdvancePaymentDialog({
  target,
  companyId,
  activeModes,
  onClose,
}: {
  target: AdvancePaymentTarget | null;
  companyId?: string;
  activeModes: ReturnType<typeof useAdvancePaymentModes>["data"];
  onClose: () => void;
}) {
  const detailQuery = useAdvanceFinancePayment(target?.id);
  const payMutation = useAdvanceFinancePay();
  const d = detailQuery.data ?? null;
  const modes = activeModes ?? [];

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [modeId, setModeId] = useState("");
  const [txn, setTxn] = useState("");
  const [utr, setUtr] = useState("");
  const [bank, setBank] = useState("");
  const [remarks, setRemarks] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);

  // seed amount from the boss approved amount once the detail loads
  const maxPayable = d?.maxPayableAmount ?? target?.bossApprovedAmount ?? null;
  const allowPartial = d?.allowPartialPayment ?? false;
  const selectedMode = modes.find((m) => m.id === modeId) ?? null;
  const amountToUse = amount.trim() ? Number(amount) : maxPayable ?? 0;
  const overMax = maxPayable != null && amountToUse > maxPayable;
  const partialViolation = !allowPartial && maxPayable != null && amountToUse !== maxPayable;
  const needsRef = selectedMode?.requiresReference ?? false;
  const hasRef = Boolean(txn.trim() || utr.trim() || bank.trim());

  const reset = () => {
    setAmount(""); setDate(new Date().toISOString().slice(0, 10)); setModeId("");
    setTxn(""); setUtr(""); setBank(""); setRemarks(""); setProofFile(null); setConfirming(false);
  };
  const close = () => { reset(); onClose(); };

  const canSubmit =
    Boolean(target) &&
    Boolean(modeId) &&
    Number.isFinite(amountToUse) &&
    amountToUse > 0 &&
    !overMax &&
    !partialViolation &&
    (!needsRef || hasRef) &&
    !payMutation.isPending;

  const submit = async () => {
    if (!target || !companyId || !canSubmit) return;
    try {
      let proofPath: string | undefined;
      if (proofFile) {
        proofPath = await advanceService.uploadPaymentProof({ companyId, advanceRequestId: target.id, file: proofFile });
      }
      await payMutation.mutateAsync({
        requestId: target.id,
        paymentAmount: amountToUse,
        paymentDate: date,
        paymentModeId: modeId,
        transactionReference: txn.trim() || undefined,
        utrNumber: utr.trim() || undefined,
        bankReference: bank.trim() || undefined,
        paymentRemarks: remarks.trim() || undefined,
        paymentProofPath: proofPath,
      });
      toast({ title: `Payment of ${formatAmount(amountToUse)} recorded — status: Paid.`, variant: "success" });
      close();
    } catch (error) {
      toast({ title: "Payment failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
      setConfirming(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay Advance</DialogTitle>
          <DialogDescription>
            {target ? `${target.employeeName} — ${target.advanceTypeName}` : ""}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isLoading || !d ? (
          <LoadingState rows={4} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Requested</p><p className="font-medium">{formatAmount(d.requestedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Mgr Recommended</p><p className="font-medium">{formatAmount(d.managerRecommendedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Boss Approved</p><p className="font-medium">{formatAmount(d.bossApprovedAmount)}</p></div>
              <div className="col-span-3 rounded bg-emerald-50 px-2 py-1 text-emerald-800">
                Maximum Payable Amount: <span className="font-semibold">{formatAmount(maxPayable)}</span>
                {allowPartial ? " — partial payment allowed by policy" : " — must pay exactly this amount (partial not allowed)"}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Payment Amount (₹)</Label>
                <Input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={maxPayable != null ? String(maxPayable) : "0"}
                />
                {overMax && <p className="text-xs text-destructive">Cannot exceed the Maximum Payable Amount.</p>}
                {partialViolation && <p className="text-xs text-destructive">Partial payment is not allowed — must equal {formatAmount(maxPayable)}.</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Payment Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Payment Mode</Label>
              <Select value={modeId} onValueChange={setModeId}>
                <SelectTrigger><SelectValue placeholder="Select a payment mode" /></SelectTrigger>
                <SelectContent>
                  {modes.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {needsRef && <p className="text-xs text-muted-foreground">This mode requires a Transaction / UTR / Bank reference.</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label className="text-xs">Transaction Ref</Label><Input value={txn} onChange={(e) => setTxn(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">UTR Number</Label><Input value={utr} onChange={(e) => setUtr(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Bank Reference</Label><Input value={bank} onChange={(e) => setBank(e.target.value)} /></div>
            </div>
            {needsRef && !hasRef && <p className="text-xs text-destructive">Enter at least one reference for this payment mode.</p>}

            <div className="space-y-1.5">
              <Label>Payment Proof (optional)</Label>
              <Input type="file" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Remarks (optional)</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>

            {confirming && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Confirm payment of <span className="font-semibold">{formatAmount(amountToUse)}</span> to {target?.employeeName}? This marks the advance <span className="font-semibold">Paid</span>.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={payMutation.isPending}>Cancel</Button>
          {!confirming ? (
            <Button onClick={() => setConfirming(true)} disabled={!canSubmit}>Review Payment</Button>
          ) : (
            <Button onClick={submit} disabled={!canSubmit}>{payMutation.isPending ? "Recording…" : `Confirm — Pay ${formatAmount(amountToUse)}`}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
