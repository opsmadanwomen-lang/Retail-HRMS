import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Banknote, ShieldAlert, ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import { useAdvanceTypes, useAdvanceApplyContext, useApplyAdvance } from "@/hooks/useAdvance";
import { ROUTES } from "@/constants/routes";
import { formatAmount } from "@/modules/advance/utils";

/**
 * Staff Panel — Request Advance. Every eligibility rule (policy resolution, max amount, % of salary,
 * minimum service, active-advance limit, reporting-manager / Boss configuration) is resolved
 * server-side by advance_get_apply_context(); this form only presents it. Identity is always the
 * logged-in employee (advance_apply() takes NO employee_id and reads current_user_employee_id()).
 * Raw salary is never returned to this page — only the computed maximum allowed amount.
 */
export function StaffAdvanceRequestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const currentEmployeeQuery = useCurrentEmployee(user?.email, user?.companyId, user?.id);
  const employeeId = currentEmployeeQuery.data?.id;
  const companyId = user?.companyId ?? undefined;

  const typesQuery = useAdvanceTypes(companyId);
  const contextQuery = useAdvanceApplyContext(Boolean(employeeId));
  const applyMutation = useApplyAdvance();

  const ctx = contextQuery.data ?? null;
  const activeTypes = useMemo(() => (typesQuery.data ?? []).filter((t) => t.isActive), [typesQuery.data]);

  const [advanceTypeId, setAdvanceTypeId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");
  // Recovery / No. of Installments — choices come entirely from the resolved policy
  // (advance_get_apply_context), never hard-coded. Initialised once the policy resolves.
  const [installmentCount, setInstallmentCount] = useState<string>("");

  const selectedType = activeTypes.find((t) => t.id === advanceTypeId) ?? null;
  const numericAmount = Number(amount);
  const overLimit =
    ctx?.maxAllowedAmount != null && Number.isFinite(numericAmount) && numericAmount > ctx.maxAllowedAmount;

  const maxInstallments = ctx?.maxInstallments ?? 12;
  const installmentOptions = useMemo(() => Array.from({ length: maxInstallments }, (_, i) => i + 1), [maxInstallments]);
  const effectiveInstallmentCount = installmentCount ? Number(installmentCount) : ctx?.defaultInstallmentCount ?? null;
  const estimatedMonthlyDeduction =
    effectiveInstallmentCount && Number.isFinite(numericAmount) && numericAmount > 0
      ? Math.floor((numericAmount / effectiveInstallmentCount) * 100) / 100
      : null;
  const belowMinInstallment =
    ctx?.minInstallmentAmount != null && estimatedMonthlyDeduction != null && estimatedMonthlyDeduction < ctx.minInstallmentAmount;

  if (currentEmployeeQuery.isLoading || contextQuery.isLoading) return <LoadingState />;

  if (!employeeId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Request Advance" description="Submit a salary / expense advance request for approval." />
        <EmptyState
          icon={ShieldAlert}
          title="No employee record"
          description="Your login is not linked to an employee record, so an advance cannot be requested."
        />
      </div>
    );
  }

  const canSubmit =
    Boolean(ctx?.eligible) &&
    Boolean(advanceTypeId) &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    !overLimit &&
    reason.trim().length > 0 &&
    Boolean(effectiveInstallmentCount) &&
    !belowMinInstallment &&
    !applyMutation.isPending;

  const handleSubmit = async () => {
    if (!canSubmit || !effectiveInstallmentCount) return;
    try {
      await applyMutation.mutateAsync({
        advanceTypeId,
        requestedAmount: numericAmount,
        reason: reason.trim(),
        remarks: remarks.trim() || undefined,
        installmentCount: effectiveInstallmentCount,
      });
      toast({ title: "Advance request submitted.", variant: "success" });
      setAmount("");
      setReason("");
      setRemarks("");
      setInstallmentCount("");
      navigate(ROUTES.myAdvances);
    } catch (error) {
      toast({
        title: "Could not submit request",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request Advance"
        description="Submit a salary / expense advance request. Your Reporting Manager reviews it first, then the Final Approver (Boss) decides."
        actions={
          <Button variant="secondary" onClick={() => navigate(ROUTES.myAdvances)}>
            My Advances <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        }
      />

      {/* Eligibility summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Advance Policy</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Policy">
            {ctx?.policyName ? `${ctx.policyName} (v${ctx.policyVersion})` : "Not assigned"}
          </Field>
          <Field label="Maximum you can request">{formatAmount(ctx?.maxAllowedAmount ?? null)}</Field>
          <Field label="Minimum service required">
            {ctx?.minServiceMonths != null ? `${ctx.minServiceMonths} month(s)` : "—"} · you have {ctx?.serviceMonths ?? 0}
          </Field>
          <Field label="Active advances">
            {ctx?.activeAdvanceCount ?? 0}
            {ctx?.maxActiveAdvances != null ? ` / ${ctx.maxActiveAdvances} allowed` : ""}
          </Field>
          <Field label="Reporting Manager configured">{ctx?.reportingManagerConfigured ? "Yes" : "No"}</Field>
          <Field label="Final Approver (Boss) configured">{ctx?.bossConfigured ? "Yes" : "No"}</Field>
        </CardContent>
      </Card>

      {ctx && !ctx.eligible && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">You cannot request an advance right now.</p>
              <p>{ctx.ineligibleReason ?? "Please contact HR."}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Request form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Advance Type</Label>
              <Select value={advanceTypeId} onValueChange={setAdvanceTypeId} disabled={!ctx?.eligible}>
                <SelectTrigger>
                  <SelectValue placeholder={activeTypes.length ? "Select a type" : "No advance types available"} />
                </SelectTrigger>
                <SelectContent>
                  {activeTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedType?.requiresDocument && (
                <p className="text-xs text-amber-700">
                  This type normally requires a supporting document. Document upload is not part of Phase 1 — add it in a later phase or contact HR.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Requested Amount (₹)</Label>
              <Input
                type="number"
                min={1}
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={!ctx?.eligible}
                placeholder="0"
              />
              {overLimit && (
                <p className="text-xs text-destructive">
                  Exceeds the maximum you can request ({formatAmount(ctx?.maxAllowedAmount ?? null)}).
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                Recovery / No. of Installments <span className="text-destructive">*</span>
              </Label>
              <Select
                value={installmentCount || (ctx?.defaultInstallmentCount ? String(ctx.defaultInstallmentCount) : "")}
                onValueChange={setInstallmentCount}
                disabled={!ctx?.eligible}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select installments" />
                </SelectTrigger>
                <SelectContent>
                  {installmentOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} installment{n > 1 ? "s" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {belowMinInstallment && (
                <p className="text-xs text-destructive">
                  With {effectiveInstallmentCount} installments, each deduction (~{formatAmount(estimatedMonthlyDeduction)}) would fall below the
                  policy minimum installment amount ({formatAmount(ctx?.minInstallmentAmount ?? null)}). Choose fewer installments.
                </p>
              )}
            </div>

            <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-xs">
              <p className="font-medium text-sm">Recovery Preview</p>
              <p>Recovery Method: Fixed Number of Installments</p>
              <p>Installments: {effectiveInstallmentCount ?? "—"}</p>
              <p>Estimated Monthly Deduction: {formatAmount(estimatedMonthlyDeduction)}</p>
              <p>Recovery Start: according to configured policy</p>
              <p className="pt-1 text-muted-foreground">
                This is only a preview. Final recovery is based on the Boss-approved terms and the Actual Paid Amount.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={!ctx?.eligible} placeholder="Why do you need this advance?" />
          </div>

          <div className="space-y-1.5">
            <Label>Remarks (optional)</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!ctx?.eligible} placeholder="Anything else the approver should know." />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {applyMutation.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            The amount you request here is recorded permanently and never changes. A Reporting Manager may recommend a different amount and
            the Boss may approve a different amount — all three are preserved and shown to you.
          </p>
        </CardContent>
      </Card>

      {activeTypes.length === 0 && (
        <EmptyState icon={Banknote} title="No advance types configured" description="Your company has not set up any advance types yet. Contact HR." />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{children}</p>
    </div>
  );
}
