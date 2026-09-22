import { useState } from "react";
import { FileText, Upload, RefreshCw, ExternalLink } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { LoadingState } from "@/components/common/LoadingState";
import {
  useAdvancePaymentReceipt,
  usePaymentReceiptHistory,
  useUploadPaymentReceipt,
  useReplacePaymentReceipt,
} from "@/hooks/useAdvance";
import { advanceService } from "@/services/advanceService";
import { formatDateTime, RECEIPT_STATUS_LABEL, RECEIPT_STATUS_VARIANT, RECEIPT_ROW_STATUS_LABEL, RECEIPT_ROW_STATUS_VARIANT } from "@/modules/advance/utils";

interface AdvanceReceiptSectionProps {
  advanceRequestId: string;
  /** Required to upload/replace (used to build the storage path); may be omitted for a pure
   *  read-only viewer (canManage=false), where no upload control is rendered anyway. */
  companyId?: string;
  /** Whether the current viewer may Upload/Replace (authorized HR/Finance Processor or Super
   *  Admin — the RPCs re-enforce this regardless of what this prop allows through). Everyone
   *  else gets a read-only status + history view (§4/§7 — view/download always available to
   *  anyone who can already see this advance). */
  canManage: boolean;
}

/** Small, list-row-friendly Receipt Status badge (§25 — "clearly show receipt status" wherever a
 *  Paid advance is listed). Deliberately lightweight: one cached useQuery per row via
 *  useAdvancePaymentReceipt, so repeated renders across pages / re-opens never re-fetch. */
export function ReceiptStatusBadge({ advanceRequestId }: { advanceRequestId: string }) {
  const receiptQuery = useAdvancePaymentReceipt(advanceRequestId);
  const status = receiptQuery.data?.receiptStatus ?? "pending";
  if (receiptQuery.isLoading) return <span className="text-xs text-muted-foreground">…</span>;
  return <Badge variant={RECEIPT_STATUS_VARIANT[status]}>{RECEIPT_STATUS_LABEL[status]}</Badge>;
}

/**
 * Advance Payment Receipt Management (migration 0160) — the POST-payment signed employee
 * receipt, distinct from the at-payment-time optional "Payment Proof". Shared by the Finance
 * Advance Payment page, HR Advance Processing page, and the Advance Ledger's per-advance detail
 * (all three surfaces where an authorized user may reach a Paid advance), so the upload/replace/
 * view/history logic exists in exactly one place.
 */
export function AdvanceReceiptSection({ advanceRequestId, companyId, canManage }: AdvanceReceiptSectionProps) {
  const receiptQuery = useAdvancePaymentReceipt(advanceRequestId);
  const historyQuery = usePaymentReceiptHistory(advanceRequestId);
  const uploadMutation = useUploadPaymentReceipt();
  const replaceMutation = useReplacePaymentReceipt();

  const [mode, setMode] = useState<"view" | "upload" | "replace">("view");
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const receipt = receiptQuery.data ?? null;
  const history = historyQuery.data ?? [];
  const status = receipt?.receiptStatus ?? "pending";
  const hasActiveReceipt = status === "uploaded";

  const reset = () => {
    setMode("view");
    setFile(null);
    setReason("");
  };

  const openReceipt = async () => {
    if (!receipt?.storagePath) return;
    try {
      const url = await advanceService.getPaymentProofSignedUrl(receipt.storagePath);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast({ title: "Could not open receipt", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const submitUpload = async () => {
    if (!file || !companyId) return;
    setBusy(true);
    try {
      const storagePath = await advanceService.uploadPaymentReceiptFile({ companyId, advanceRequestId, file });
      await uploadMutation.mutateAsync({
        requestId: advanceRequestId,
        storagePath,
        fileName: file.name,
        mimeType: file.type || undefined,
        fileSizeBytes: file.size,
      });
      toast({ title: "Signed receipt uploaded.", variant: "success" });
      reset();
    } catch (error) {
      toast({ title: "Upload failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const submitReplace = async () => {
    if (!file || !companyId) return;
    if (!reason.trim()) {
      toast({ title: "A reason is required to replace a receipt.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const storagePath = await advanceService.uploadPaymentReceiptFile({ companyId, advanceRequestId, file });
      await replaceMutation.mutateAsync({
        requestId: advanceRequestId,
        storagePath,
        fileName: file.name,
        reason: reason.trim(),
        mimeType: file.type || undefined,
        fileSizeBytes: file.size,
      });
      toast({ title: "Receipt replaced.", variant: "success" });
      reset();
    } catch (error) {
      toast({ title: "Replace failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (receiptQuery.isLoading) return <LoadingState rows={2} />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Signed Staff Receipt</CardTitle>
        <Badge variant={RECEIPT_STATUS_VARIANT[status]}>{RECEIPT_STATUS_LABEL[status]}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {hasActiveReceipt && mode === "view" && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{receipt?.fileName}</span>
            <span className="text-xs text-muted-foreground">
              Uploaded by {receipt?.uploadedByName ?? "—"} on {formatDateTime(receipt?.uploadedAt)}
            </span>
            <Button size="sm" variant="secondary" onClick={openReceipt}>
              <ExternalLink className="mr-1 h-4 w-4" /> View / Download
            </Button>
            {canManage && (
              <Button size="sm" variant="ghost" onClick={() => setMode("replace")}>
                <RefreshCw className="mr-1 h-4 w-4" /> Replace Receipt
              </Button>
            )}
          </div>
        )}

        {!hasActiveReceipt && mode === "view" && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>No signed receipt uploaded yet — this does not block or delay the payment already recorded.</span>
            {canManage && (
              <Button size="sm" onClick={() => setMode("upload")}>
                <Upload className="mr-1 h-4 w-4" /> Upload Receipt
              </Button>
            )}
          </div>
        )}

        {mode === "upload" && (
          <div className="space-y-2 rounded-lg border p-3">
            <Label className="text-xs">Signed Staff Receipt File</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={reset} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={submitUpload} disabled={!file || busy}>{busy ? "Uploading…" : "Upload"}</Button>
            </div>
          </div>
        )}

        {mode === "replace" && (
          <div className="space-y-2 rounded-lg border p-3">
            <Label className="text-xs">New Signed Receipt File</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Label className="text-xs">Reason for Replacement (required)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Original scan was illegible." />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={reset} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={submitReplace} disabled={!file || !reason.trim() || busy}>{busy ? "Saving…" : "Replace"}</Button>
            </div>
          </div>
        )}

        {history.length > 1 && (
          <div className="pt-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Receipt History (audit trail)</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Uploaded By</TableHead>
                    <TableHead>Uploaded At</TableHead>
                    <TableHead>Replace Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs">{h.fileName}</TableCell>
                      <TableCell><Badge variant={RECEIPT_ROW_STATUS_VARIANT[h.status]}>{RECEIPT_ROW_STATUS_LABEL[h.status]}</Badge></TableCell>
                      <TableCell className="text-xs">{h.uploadedByName ?? "—"}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(h.uploadedAt)}</TableCell>
                      <TableCell className="max-w-[12rem] truncate text-xs" title={h.replaceReason ?? undefined}>{h.replaceReason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
