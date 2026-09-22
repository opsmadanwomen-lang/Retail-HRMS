import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ShieldAlert, CheckCircle2, XCircle } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAssignableEmployees } from "@/hooks/useEmployees";
import {
  useAdvanceTypes,
  useUpsertAdvanceType,
  useAdvancePolicies,
  useCreateAdvancePolicy,
  useSetAdvancePolicyStatus,
  useAdvancePolicyConfig,
  useUpsertAdvancePolicyConfig,
  useAdvanceAssignments,
  useCreateAdvanceAssignment,
  useSetAdvanceAssignmentActive,
  useAdvanceFinalApprovers,
  useUpsertAdvanceFinalApprover,
  useRemoveAdvanceFinalApprover,
  useAdvanceProcessors,
  useAddAdvanceProcessor,
  useSetAdvanceProcessorActive,
  useRemoveAdvanceProcessor,
  useAdvanceNotificationSettings,
  useUpsertAdvanceNotificationSetting,
  useAdvanceStores,
  useAdvanceStoreDepartments,
  useAdvanceStoreDesignations,
  useAdvancePaymentModes,
  useUpsertAdvancePaymentMode,
  useAdvanceRecoveryPlans,
  useAdvancePolicyTypes,
  useSetAdvancePolicyTypes,
  useValidateAdvancePolicy,
  useActivateAdvancePolicy,
} from "@/hooks/useAdvance";
import { useEmployeeGrades, useEmployeeCategories } from "@/hooks/usePayroll";
import { advanceService } from "@/services/advanceService";
import { formatDate } from "@/lib/utils";
import { formatAmount, ADVANCE_STATUS_LABEL, ADVANCE_STATUS_VARIANT, RECOVERY_METHOD_LABEL } from "@/modules/advance/utils";
import { RecoveryDetailDialog } from "@/modules/advance/pages/AdvanceRecoveryPage";
import type { AdvancePolicy, AdvanceScopeType } from "@/types/advance";

const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "consultant"];

/**
 * Advance Settings (Admin, route /settings/advance-management — the component/file name predates
 * this label and is kept to avoid an unrelated import-path churn) — Super Admin only. Eight
 * configuration areas: Advance Types, Advance Policies (+ versioned config), Policy Assignment
 * (6-tier), Final Approver (Boss) roster, HR Processors, Finance Processors, Payment Modes
 * (Phase 3), Notification Settings. Every business value lives in these config rows — nothing is
 * hard-coded. For the OPERATIONAL, staff-wise Advance Ledger (view/monitor/filter/export), see
 * the separate AdvanceLedgerPage — main sidebar "Advance Management", route /advance/ledger.
 */
export function AdvanceManagementPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const companyId = user?.companyId ?? undefined;

  if (!isSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Advance Settings" description="Advance Types, Policies, Assignment, Approvers & Processors." />
        <EmptyState icon={ShieldAlert} title="Restricted" description="Advance configuration is available to Super Admin only." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advance Settings"
        description="Configure Advance Types, versioned Policies, 6-tier Assignment, the Final Approver (Boss) roster, HR / Finance Processors and Notifications. For the operational staff-wise Advance Ledger, see Advance Management in the main sidebar."
      />
      <Tabs defaultValue="types">
        <TabsList className="flex-wrap">
          <TabsTrigger value="types">Advance Types</TabsTrigger>
          <TabsTrigger value="policies">Advance Policies</TabsTrigger>
          <TabsTrigger value="assignment">Policy Assignment</TabsTrigger>
          <TabsTrigger value="boss">Final Approver (Boss)</TabsTrigger>
          <TabsTrigger value="hr">HR Processors</TabsTrigger>
          <TabsTrigger value="finance">Finance Processors</TabsTrigger>
          <TabsTrigger value="payment-modes">Payment Modes</TabsTrigger>
          <TabsTrigger value="recovery">Recovery</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="types"><AdvanceTypesTab companyId={companyId} /></TabsContent>
        <TabsContent value="policies"><PoliciesTab companyId={companyId} /></TabsContent>
        <TabsContent value="assignment"><AssignmentTab companyId={companyId} /></TabsContent>
        <TabsContent value="boss"><FinalApproverTab companyId={companyId} /></TabsContent>
        <TabsContent value="hr"><ProcessorTab companyId={companyId} table="advance_hr_processors" title="HR Processors" note="HR Processors execute the advance after final approval (Phase 2). They are NOT approvers and never appear in the approval chain." /></TabsContent>
        <TabsContent value="finance"><ProcessorTab companyId={companyId} table="advance_finance_processors" title="Finance Processors" note="Finance Processors release payment (Phase 3). They are NOT approvers." /></TabsContent>
        <TabsContent value="payment-modes"><PaymentModesTab companyId={companyId} /></TabsContent>
        <TabsContent value="recovery"><RecoveryTab companyId={companyId} /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab companyId={companyId} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ===========================================================================
// Advance Types
// ===========================================================================
function AdvanceTypesTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const typesQuery = useAdvanceTypes(companyId);
  const upsert = useUpsertAdvanceType();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [requiresDocument, setRequiresDocument] = useState(false);
  const [allowsMultiple, setAllowsMultiple] = useState(false);

  const reset = () => {
    setEditId(null); setCode(""); setName(""); setDescription("");
    setIsActive(true); setRequiresDocument(false); setAllowsMultiple(false);
  };
  const openNew = () => { reset(); setOpen(true); };
  const openEdit = (t: NonNullable<typeof typesQuery.data>[number]) => {
    setEditId(t.id); setCode(t.code); setName(t.name); setDescription(t.description ?? "");
    setIsActive(t.isActive); setRequiresDocument(t.requiresDocument); setAllowsMultiple(t.allowsMultiple);
    setOpen(true);
  };

  const save = async () => {
    if (!companyId || !code.trim() || !name.trim()) {
      toast({ title: "Code and name are required.", variant: "destructive" });
      return;
    }
    try {
      await upsert.mutateAsync({
        id: editId ?? undefined,
        companyId,
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
        isActive, requiresDocument, allowsMultiple,
        userId: user?.id,
      });
      toast({ title: editId ? "Advance type updated." : "Advance type created.", variant: "success" });
      setOpen(false); reset();
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Advance Types</CardTitle>
        <Button size="sm" onClick={openNew}>New Type</Button>
      </CardHeader>
      <CardContent>
        {typesQuery.isLoading ? (
          <LoadingState />
        ) : (typesQuery.data ?? []).length === 0 ? (
          <EmptyState icon={ShieldAlert} title="No advance types yet." description="Create at least one so employees can request an advance." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Document Required</TableHead>
                  <TableHead>Allows Multiple</TableHead><TableHead>Active</TableHead><TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(typesQuery.data ?? []).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.requiresDocument ? "Yes" : "No"}</TableCell>
                    <TableCell>{t.allowsMultiple ? "Yes" : "No"}</TableCell>
                    <TableCell>{t.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => openEdit(t)}>Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Advance Type" : "New Advance Type"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} disabled={Boolean(editId)} /></div>
            <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} /> Active</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={requiresDocument} onCheckedChange={(v) => setRequiresDocument(Boolean(v))} /> Requires document</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={allowsMultiple} onCheckedChange={(v) => setAllowsMultiple(Boolean(v))} /> Allows multiple</label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={upsert.isPending}>Cancel</Button>
            <Button onClick={save} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ===========================================================================
// Policies + Config
// ===========================================================================
function PoliciesTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const policiesQuery = useAdvancePolicies(companyId);
  const createPolicy = useCreateAdvancePolicy();
  const setStatus = useSetAdvancePolicyStatus();
  const activatePolicy = useActivateAdvancePolicy();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [configurePolicy, setConfigurePolicy] = useState<AdvancePolicy | null>(null);
  const [checklistPolicy, setChecklistPolicy] = useState<AdvancePolicy | null>(null);

  const create = async () => {
    if (!companyId || !name.trim() || !code.trim()) {
      toast({ title: "Name and code are required.", variant: "destructive" });
      return;
    }
    try {
      await createPolicy.mutateAsync({ companyId, name: name.trim(), code: code.trim(), description: description.trim() || null, effectiveFrom, userId: user?.id });
      toast({ title: "Draft policy created. Configure it, then activate.", variant: "success" });
      setOpen(false); setName(""); setCode(""); setDescription("");
    } catch (error) {
      toast({ title: "Create failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const archive = async (policy: AdvancePolicy) => {
    try {
      await setStatus.mutateAsync({ policyId: policy.id, status: "archived", userId: user?.id });
      toast({ title: "Policy archived.", variant: "success" });
    } catch (error) {
      toast({ title: "Archive failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  // Activate now ALWAYS goes through advance_activate_policy() (migration 0155) — server-side
  // validated (§13), and archives the prior active version of the same code atomically (§14).
  // A raw client-side status flip is no longer used for the 'active' transition.
  const activate = async (policy: AdvancePolicy) => {
    try {
      await activatePolicy.mutateAsync({ policyId: policy.id });
      toast({ title: "Policy activated.", variant: "success" });
    } catch (error) {
      toast({ title: "Cannot activate", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Advance Policies</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>New Policy</Button>
      </CardHeader>
      <CardContent>
        {policiesQuery.isLoading ? (
          <LoadingState />
        ) : (policiesQuery.data ?? []).length === 0 ? (
          <EmptyState icon={ShieldAlert} title="No policies yet." description="Create a policy, configure its rules, then activate it. Only one active version per code." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Version</TableHead>
                  <TableHead>Effective From</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(policiesQuery.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>v{p.versionNumber}</TableCell>
                    <TableCell className="text-xs">{formatDate(p.effectiveFrom)}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "success" : p.status === "archived" ? "secondary" : "warning"} className="capitalize">{p.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setConfigurePolicy(p)}>Configure</Button>
                        {p.status === "draft" && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setChecklistPolicy(p)}>Validate</Button>
                            <Button size="sm" onClick={() => activate(p)} disabled={activatePolicy.isPending}>
                              {activatePolicy.isPending ? "Activating…" : "Activate"}
                            </Button>
                          </>
                        )}
                        {p.status === "active" && <Button size="sm" variant="secondary" onClick={() => archive(p)}>Archive</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* New policy dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Advance Policy</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={createPolicy.isPending}>Cancel</Button>
            <Button onClick={create} disabled={createPolicy.isPending}>{createPolicy.isPending ? "Creating…" : "Create Draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {configurePolicy && <ConfigurePolicyDialog policy={configurePolicy} onClose={() => setConfigurePolicy(null)} />}
      {checklistPolicy && <PolicyValidationDialog policy={checklistPolicy} onClose={() => setChecklistPolicy(null)} />}
    </Card>
  );
}

// ===========================================================================
// §13 activation checklist — read-only preview of exactly what
// advance_activate_policy() will check server-side before allowing Activate.
// ===========================================================================
function PolicyValidationDialog({ policy, onClose }: { policy: AdvancePolicy; onClose: () => void }) {
  const validationQuery = useValidateAdvancePolicy(policy.id);
  const items = validationQuery.data ?? [];
  const allPassed = items.length > 0 && items.every((i) => i.passed);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activation Checklist — {policy.name} (v{policy.versionNumber})</DialogTitle>
          <DialogDescription>The exact same checks advance_activate_policy() runs server-side. Activate is blocked until every item passes.</DialogDescription>
        </DialogHeader>
        {validationQuery.isLoading ? (
          <LoadingState rows={4} />
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.checkKey} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                {item.passed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                )}
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
            <p className={`pt-1 text-sm font-medium ${allPassed ? "text-emerald-600" : "text-destructive"}`}>
              {allPassed ? "Ready to activate." : "Not ready — resolve the item(s) marked above."}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigurePolicyDialog({ policy, onClose }: { policy: AdvancePolicy; onClose: () => void }) {
  const { user } = useAuth();
  const configQuery = useAdvancePolicyConfig(policy.id);
  const upsert = useUpsertAdvancePolicyConfig();
  const cfg = configQuery.data ?? null;
  const validationQuery = useValidateAdvancePolicy(policy.id);

  const typesQuery = useAdvanceTypes(policy.companyId);
  const policyTypesQuery = useAdvancePolicyTypes(policy.id);
  const setPolicyTypes = useSetAdvancePolicyTypes();
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[] | null>(null);
  const restrictedTypeIds = selectedTypeIds ?? (policyTypesQuery.data ?? []).map((t) => t.advanceTypeId);

  // form state — initialised from the loaded config once
  const [form, setForm] = useState<Record<string, string | boolean> | null>(null);
  const state = useMemo(() => {
    if (form) return form;
    if (!cfg) return null;
    return {
      max_amount: cfg.maxAmount?.toString() ?? "",
      min_amount: cfg.minAmount?.toString() ?? "",
      max_pct_of_salary: cfg.maxPctOfSalary?.toString() ?? "",
      min_service_months: String(cfg.minServiceMonths),
      max_active_advances: String(cfg.maxActiveAdvances),
      max_installments: String(cfg.maxInstallments),
      min_installment_amount: cfg.minInstallmentAmount?.toString() ?? "",
      allow_multiple_advances: cfg.allowMultipleAdvances,
      allow_early_settlement: cfg.allowEarlySettlement,
      allow_partial_payment: cfg.allowPartialPayment,
      allow_partial_recovery: cfg.allowPartialRecovery,
      manager_approval_required: cfg.managerApprovalRequired,
      boss_final_approval_required: cfg.bossFinalApprovalRequired,
      boss_can_modify_amount: cfg.bossCanModifyAmount,
      boss_can_increase_amount: cfg.bossCanIncreaseAmount,
      max_boss_approval_limit: cfg.maxBossApprovalLimit?.toString() ?? "",
      modification_reason_mandatory: cfg.modificationReasonMandatory,
      recovery_start_rule: cfg.recoveryStartRule,
      recovery_enabled: cfg.recoveryEnabled,
      recovery_method: cfg.recoveryMethod,
      recovery_installment_count: cfg.recoveryInstallmentCount?.toString() ?? "",
      recovery_monthly_amount: cfg.recoveryMonthlyAmount?.toString() ?? "",
      recovery_start_specific: cfg.recoveryStartSpecific ?? "",
      existing_outstanding_rule: cfg.existingOutstandingRule,
      max_total_outstanding_limit: cfg.maxTotalOutstandingLimit?.toString() ?? "",
    } as Record<string, string | boolean>;
  }, [form, cfg]);

  const set = (key: string, value: string | boolean) => setForm({ ...(state as Record<string, string | boolean>), [key]: value });
  const numOrNull = (v: unknown) => {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const toggleType = (id: string, checked: boolean) => {
    const current = restrictedTypeIds;
    setSelectedTypeIds(checked ? [...current, id] : current.filter((t) => t !== id));
  };

  const save = async () => {
    if (!state) return;
    try {
      await upsert.mutateAsync({
        policyId: policy.id,
        companyId: policy.companyId,
        userId: user?.id,
        values: {
          max_amount: numOrNull(state.max_amount),
          min_amount: numOrNull(state.min_amount),
          max_pct_of_salary: numOrNull(state.max_pct_of_salary),
          min_service_months: numOrNull(state.min_service_months) ?? 0,
          max_active_advances: numOrNull(state.max_active_advances) ?? 1,
          max_installments: numOrNull(state.max_installments) ?? 12,
          min_installment_amount: numOrNull(state.min_installment_amount),
          allow_multiple_advances: Boolean(state.allow_multiple_advances),
          allow_early_settlement: Boolean(state.allow_early_settlement),
          allow_partial_payment: Boolean(state.allow_partial_payment),
          allow_partial_recovery: Boolean(state.allow_partial_recovery),
          manager_approval_required: Boolean(state.manager_approval_required),
          boss_final_approval_required: Boolean(state.boss_final_approval_required),
          boss_can_modify_amount: Boolean(state.boss_can_modify_amount),
          boss_can_increase_amount: Boolean(state.boss_can_increase_amount),
          max_boss_approval_limit: numOrNull(state.max_boss_approval_limit),
          modification_reason_mandatory: Boolean(state.modification_reason_mandatory),
          recovery_start_rule: String(state.recovery_start_rule || "next_payroll"),
          recovery_enabled: Boolean(state.recovery_enabled),
          recovery_method: String(state.recovery_method || "fixed_installments"),
          recovery_installment_count: numOrNull(state.recovery_installment_count),
          recovery_monthly_amount: numOrNull(state.recovery_monthly_amount),
          recovery_start_specific: String(state.recovery_start_specific || "").trim() || null,
          existing_outstanding_rule: String(state.existing_outstanding_rule || "allowed_unrestricted"),
          max_total_outstanding_limit: numOrNull(state.max_total_outstanding_limit),
        },
      });
      if (selectedTypeIds !== null) {
        await setPolicyTypes.mutateAsync({ policyId: policy.id, companyId: policy.companyId, advanceTypeIds: selectedTypeIds, userId: user?.id });
      }
      toast({ title: "Policy configuration saved.", variant: "success" });
      onClose();
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const recoveryMethod = String(state?.recovery_method || "fixed_installments");
  const recoveryStartRule = String(state?.recovery_start_rule || "next_payroll");
  const outstandingRule = String(state?.existing_outstanding_rule || "allowed_unrestricted");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure — {policy.name} (v{policy.versionNumber})</DialogTitle>
          <DialogDescription>Every rule the workflow enforces. Nothing is hard-coded — these values drive advance_apply / advance_manager_decide / advance_boss_decide.</DialogDescription>
        </DialogHeader>
        {configQuery.isLoading || !state ? (
          <LoadingState rows={6} />
        ) : (
          <Tabs defaultValue="general">
            <TabsList className="flex-wrap">
              <TabsTrigger value="general">A. General</TabsTrigger>
              <TabsTrigger value="eligibility">B. Eligibility</TabsTrigger>
              <TabsTrigger value="approval">C. Approval</TabsTrigger>
              <TabsTrigger value="payment">D. Payment</TabsTrigger>
              <TabsTrigger value="recovery">E. Recovery</TabsTrigger>
              <TabsTrigger value="outstanding">F. Outstanding Advance</TabsTrigger>
              <TabsTrigger value="validation">G. Validation</TabsTrigger>
            </TabsList>

            {/* A. General — the policy's own identity + which Advance Types it applies to. */}
            <TabsContent value="general" className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Field label="Name">{policy.name}</Field>
                <Field label="Code">{policy.code}</Field>
                <Field label="Version">v{policy.versionNumber}</Field>
                <Field label="Effective From">{formatDate(policy.effectiveFrom)}</Field>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Applies to Advance Types</p>
                <p className="text-xs text-muted-foreground">Leave every box unchecked to apply this policy to ALL Advance Types (default). Check specific types to restrict it to only those.</p>
                {typesQuery.isLoading || policyTypesQuery.isLoading ? (
                  <LoadingState rows={2} />
                ) : (typesQuery.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No Advance Types exist yet — create one under Advance Types first.</p>
                ) : (
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    {(typesQuery.data ?? []).map((t) => (
                      <label key={t.id} className="flex items-center gap-2">
                        <Checkbox checked={restrictedTypeIds.includes(t.id)} onCheckedChange={(v) => toggleType(t.id, Boolean(v))} />
                        {t.name}
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {restrictedTypeIds.length === 0 ? "Currently: all Advance Types." : `Currently restricted to ${restrictedTypeIds.length} type(s).`}
                </p>
              </div>
            </TabsContent>

            {/* B. Eligibility */}
            <TabsContent value="eligibility" className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <NumField label="Min Amount (₹)" value={state.min_amount as string} onChange={(v) => set("min_amount", v)} />
                <NumField label="Max Amount (₹)" value={state.max_amount as string} onChange={(v) => set("max_amount", v)} />
                <NumField label="Max % of Salary" value={state.max_pct_of_salary as string} onChange={(v) => set("max_pct_of_salary", v)} />
                <NumField label="Min Service (months)" value={state.min_service_months as string} onChange={(v) => set("min_service_months", v)} />
                <NumField label="Max Active Advances" value={state.max_active_advances as string} onChange={(v) => set("max_active_advances", v)} />
                <NumField label="Min Installment Amount (₹)" value={state.min_installment_amount as string} onChange={(v) => set("min_installment_amount", v)} />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <BoolField label="Allow multiple different Advance Types simultaneously" checked={Boolean(state.allow_multiple_advances)} onChange={(v) => set("allow_multiple_advances", v)} />
              </div>
              <p className="text-xs text-muted-foreground">
                "Multiple advances of the SAME Advance Type" is controlled per Advance Type (Advance Types tab -&gt; "Allows Multiple"), not here.
              </p>
            </TabsContent>

            {/* C. Approval Workflow */}
            <TabsContent value="approval" className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <BoolField label="Reporting Manager approval required" checked={Boolean(state.manager_approval_required)} onChange={(v) => set("manager_approval_required", v)} />
                <BoolField label="Boss final approval required" checked={Boolean(state.boss_final_approval_required)} onChange={(v) => set("boss_final_approval_required", v)} />
                <BoolField label="Boss can modify amount" checked={Boolean(state.boss_can_modify_amount)} onChange={(v) => set("boss_can_modify_amount", v)} />
                <BoolField label="Boss can increase above requested" checked={Boolean(state.boss_can_increase_amount)} onChange={(v) => set("boss_can_increase_amount", v)} />
                <BoolField label="Modification reason mandatory" checked={Boolean(state.modification_reason_mandatory)} onChange={(v) => set("modification_reason_mandatory", v)} />
              </div>
              <div className="max-w-xs">
                <NumField label="Max Boss Approval Limit (₹)" value={state.max_boss_approval_limit as string} onChange={(v) => set("max_boss_approval_limit", v)} />
              </div>
              <p className="text-xs text-muted-foreground">
                HR is never an approval level — HR only processes an already Boss-approved request (Phase 2). The Boss is whoever is configured in
                the Final Approver (Boss) tab, never assumed from any other role.
              </p>
            </TabsContent>

            {/* D. Payment */}
            <TabsContent value="payment" className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <BoolField label="Allow partial payment" checked={Boolean(state.allow_partial_payment)} onChange={(v) => set("allow_partial_payment", v)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Requested Amount, Manager Recommended Amount, Boss Approved Amount and Actual Paid Amount are always kept separately visible — Finance
                may pay up to the Boss Approved Amount, in full or (if allowed here) in part; the Actual Paid Amount never automatically becomes the
                requested or approved amount, and Advance Recovery is always based on the Actual Paid Amount.
              </p>
            </TabsContent>

            {/* E. Recovery — conditional fields, only the ones the selected method/rule need. */}
            <TabsContent value="recovery" className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <BoolField label="Recovery enabled" checked={Boolean(state.recovery_enabled)} onChange={(v) => set("recovery_enabled", v)} />
                <BoolField label="Allow early settlement" checked={Boolean(state.allow_early_settlement)} onChange={(v) => set("allow_early_settlement", v)} />
                <BoolField label="Allow partial recovery" checked={Boolean(state.allow_partial_recovery)} onChange={(v) => set("allow_partial_recovery", v)} />
              </div>
              {Boolean(state.recovery_enabled) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Recovery Method</Label>
                    <Select value={recoveryMethod} onValueChange={(v) => set("recovery_method", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed_installments">Fixed number of installments</SelectItem>
                        <SelectItem value="fixed_monthly">Fixed monthly deduction</SelectItem>
                        <SelectItem value="custom">Custom schedule</SelectItem>
                        <SelectItem value="full">Full deduction</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Recovery Start Rule</Label>
                    <Select value={recoveryStartRule} onValueChange={(v) => set("recovery_start_rule", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="same_payroll">Same payroll (month paid)</SelectItem>
                        <SelectItem value="next_payroll">Next payroll</SelectItem>
                        <SelectItem value="specific_date">Specific date</SelectItem>
                        <SelectItem value="specific_month">Specific month</SelectItem>
                        <SelectItem value="manual">Manual (start entered when generating)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Conditional — only the field the selected Recovery Method actually needs (§9). */}
                  {recoveryMethod === "fixed_installments" && (
                    <NumField label="Installment Count" value={state.recovery_installment_count as string} onChange={(v) => set("recovery_installment_count", v)} />
                  )}
                  {recoveryMethod === "fixed_monthly" && (
                    <NumField label="Monthly Deduction (₹)" value={state.recovery_monthly_amount as string} onChange={(v) => set("recovery_monthly_amount", v)} />
                  )}
                  {(recoveryStartRule === "specific_date" || recoveryStartRule === "specific_month") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Specific Start Date / Month</Label>
                      <Input type="date" value={String(state.recovery_start_specific || "")} onChange={(e) => set("recovery_start_specific", e.target.value)} />
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Recovery is always based on the <span className="font-medium">actual paid amount</span> — never the requested or Boss-approved
                amount unless they happen to be equal. These values drive advance_recovery_generate_plan() (Phase 4); installments always total
                exactly the actual paid amount, with any rounding remainder absorbed by the final installment. An authorised user may still override
                the count / monthly amount / start when generating a plan.
              </p>
            </TabsContent>

            {/* F. Existing Outstanding Advance — §10, new. */}
            <TabsContent value="outstanding" className="space-y-4">
              <p className="text-sm font-medium">Can an employee request a new advance while a previous advance is outstanding?</p>
              <Select value={outstandingRule} onValueChange={(v) => set("existing_outstanding_rule", v)}>
                <SelectTrigger className="max-w-md"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_allowed">No — not while any advance is outstanding</SelectItem>
                  <SelectItem value="allowed_within_limit">Yes, if total outstanding is below a configured limit</SelectItem>
                  <SelectItem value="allowed_unrestricted">Yes, without restriction (default)</SelectItem>
                </SelectContent>
              </Select>
              {outstandingRule === "allowed_within_limit" && (
                <div className="max-w-xs">
                  <NumField label="Maximum Total Outstanding Advance (₹)" value={state.max_total_outstanding_limit as string} onChange={(v) => set("max_total_outstanding_limit", v)} />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                "Outstanding" here means the employee's total outstanding balance across every PAID advance still being recovered
                (advance_recovery_plans, status Recovery Pending / Recovering) — evaluated server-side in advance_apply(), never only in the UI.
              </p>
            </TabsContent>

            {/* G. Validation — live preview of advance_activate_policy()'s server-side checklist. */}
            <TabsContent value="validation" className="space-y-2">
              {validationQuery.isLoading ? (
                <LoadingState rows={4} />
              ) : (
                (validationQuery.data ?? []).map((item) => (
                  <div key={item.checkKey} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                    {item.passed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    )}
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                ))
              )}
              <p className="text-xs text-muted-foreground">Save your changes below first — this reflects the last saved configuration, not unsaved edits.</p>
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={upsert.isPending}>Cancel</Button>
          <Button onClick={save} disabled={upsert.isPending || !state}>{upsert.isPending ? "Saving…" : "Save Configuration"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder="—" />
    </div>
  );
}
function BoolField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} /> {label}
    </label>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{children}</p>
    </div>
  );
}

// ===========================================================================
// Policy Assignment (6-tier)
// ===========================================================================
function AssignmentTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const assignmentsQuery = useAdvanceAssignments(companyId);
  const policiesQuery = useAdvancePolicies(companyId);
  const employeesQuery = useAssignableEmployees(companyId);
  const storesQuery = useAdvanceStores(companyId);
  const departmentsQuery = useAdvanceStoreDepartments(companyId);
  const designationsQuery = useAdvanceStoreDesignations(companyId);
  const gradesQuery = useEmployeeGrades(companyId);
  const categoriesQuery = useEmployeeCategories(companyId);
  const create = useCreateAdvanceAssignment();
  const setActive = useSetAdvanceAssignmentActive();

  const activePolicies = (policiesQuery.data ?? []).filter((p) => p.status === "active");

  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState<AdvanceScopeType>("company");
  const [policyId, setPolicyId] = useState("");
  const [scopeValue, setScopeValue] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const nameForEmployee = useMemo(() => new Map((employeesQuery.data ?? []).map((e) => [e.id, e.fullName])), [employeesQuery.data]);
  const nameForStore = useMemo(() => new Map((storesQuery.data ?? []).map((s) => [s.id, s.name])), [storesQuery.data]);
  const labelForDept = useMemo(() => new Map((departmentsQuery.data ?? []).map((d) => [d.id, d.label])), [departmentsQuery.data]);
  const labelForDesig = useMemo(() => new Map((designationsQuery.data ?? []).map((d) => [d.id, d.label])), [designationsQuery.data]);
  const labelForGrade = useMemo(() => new Map((gradesQuery.data ?? []).map((g) => [g.id, g.name])), [gradesQuery.data]);
  const labelForCategory = useMemo(() => new Map((categoriesQuery.data ?? []).map((c) => [c.id, c.name])), [categoriesQuery.data]);

  const scopeDisplay = (a: NonNullable<typeof assignmentsQuery.data>[number]) => {
    switch (a.scopeType) {
      case "company": return "Whole company";
      case "employee": return nameForEmployee.get(a.employeeId ?? "") ?? "Employee";
      case "store": return nameForStore.get(a.storeId ?? "") ?? "Store";
      case "store_department": return labelForDept.get(a.storeDepartmentId ?? "") ?? "Department";
      case "store_designation": return labelForDesig.get(a.storeDesignationId ?? "") ?? "Designation";
      case "grade": return labelForGrade.get(a.gradeId ?? "") ?? "Grade";
      case "category": return labelForCategory.get(a.categoryId ?? "") ?? "Category";
      case "employment_type": return a.employmentType ?? "Employment type";
      default: return a.scopeType;
    }
  };

  const submit = async () => {
    if (!companyId || !policyId) {
      toast({ title: "Pick an active policy.", variant: "destructive" });
      return;
    }
    const payload: Record<string, unknown> = {
      company_id: companyId,
      policy_id: policyId,
      scope_type: scopeType,
      effective_from: effectiveFrom,
      is_active: true,
      userId: user?.id,
    };
    if (scopeType === "employee") payload.employee_id = scopeValue;
    if (scopeType === "store") payload.store_id = scopeValue;
    if (scopeType === "store_department") payload.store_department_id = scopeValue;
    if (scopeType === "store_designation") payload.store_designation_id = scopeValue;
    if (scopeType === "grade") payload.grade_id = scopeValue;
    if (scopeType === "category") payload.category_id = scopeValue;
    if (scopeType === "employment_type") payload.employment_type = employmentType;
    if (scopeType !== "company" && scopeType !== "employment_type" && !scopeValue) {
      toast({ title: "Select the scope target.", variant: "destructive" });
      return;
    }
    try {
      await create.mutateAsync(payload);
      toast({ title: "Assignment added.", variant: "success" });
      setOpen(false); setScopeValue("");
    } catch (error) {
      toast({ title: "Add failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Policy Assignment</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)} disabled={activePolicies.length === 0}>New Assignment</Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Resolution order (first match wins): Employee → Store → Store Designation → Store Department → Grade → Category → Employment Type → Company.
        </p>
        {assignmentsQuery.isLoading ? (
          <LoadingState />
        ) : (assignmentsQuery.data ?? []).length === 0 ? (
          <EmptyState icon={ShieldAlert} title="No assignments yet." description="Assign at least a company-wide policy so every employee resolves one." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead><TableHead>Target</TableHead><TableHead>Policy</TableHead>
                  <TableHead>Effective From</TableHead><TableHead>Active</TableHead><TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(assignmentsQuery.data ?? []).map((a) => {
                  const policy = (policiesQuery.data ?? []).find((p) => p.id === a.policyId);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="capitalize">{a.scopeType.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-xs">{scopeDisplay(a)}</TableCell>
                      <TableCell className="text-xs">{policy ? `${policy.name} (v${policy.versionNumber})` : "—"}</TableCell>
                      <TableCell className="text-xs">{formatDate(a.effectiveFrom)}</TableCell>
                      <TableCell>{a.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => setActive.mutate({ id: a.id, isActive: !a.isActive, userId: user?.id })}>
                          {a.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Policy Assignment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={scopeType} onValueChange={(v) => { setScopeType(v as AdvanceScopeType); setScopeValue(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="store">Store</SelectItem>
                  <SelectItem value="store_designation">Store Designation</SelectItem>
                  <SelectItem value="store_department">Store Department</SelectItem>
                  <SelectItem value="grade">Grade</SelectItem>
                  <SelectItem value="category">Employee Category</SelectItem>
                  <SelectItem value="employment_type">Employment Type</SelectItem>
                  <SelectItem value="company">Whole Company</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scopeType === "employee" && (
              <ScopePicker label="Employee" value={scopeValue} onChange={setScopeValue} options={(employeesQuery.data ?? []).map((e) => ({ id: e.id, label: `${e.fullName}${e.employeeCode ? ` (${e.employeeCode})` : ""}` }))} />
            )}
            {scopeType === "store" && (
              <ScopePicker label="Store" value={scopeValue} onChange={setScopeValue} options={(storesQuery.data ?? []).map((s) => ({ id: s.id, label: s.name }))} />
            )}
            {scopeType === "store_department" && (
              <ScopePicker label="Store Department" value={scopeValue} onChange={setScopeValue} options={departmentsQuery.data ?? []} />
            )}
            {scopeType === "store_designation" && (
              <ScopePicker label="Store Designation" value={scopeValue} onChange={setScopeValue} options={designationsQuery.data ?? []} />
            )}
            {scopeType === "grade" && (
              <ScopePicker label="Grade" value={scopeValue} onChange={setScopeValue} options={(gradesQuery.data ?? []).map((g) => ({ id: g.id, label: g.name }))} />
            )}
            {scopeType === "category" && (
              <ScopePicker label="Employee Category" value={scopeValue} onChange={setScopeValue} options={(categoriesQuery.data ?? []).map((c) => ({ id: c.id, label: c.name }))} />
            )}
            {scopeType === "employment_type" && (
              <div className="space-y-1.5">
                <Label>Employment Type</Label>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Policy (active only)</Label>
              <Select value={policyId} onValueChange={setPolicyId}>
                <SelectTrigger><SelectValue placeholder="Select an active policy" /></SelectTrigger>
                <SelectContent>
                  {activePolicies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} (v{p.versionNumber})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={create.isPending}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending}>{create.isPending ? "Adding…" : "Add Assignment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ScopePicker({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ id: string; label: string }> }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// ===========================================================================
// Final Approver (Boss) roster
// ===========================================================================
function FinalApproverTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const approversQuery = useAdvanceFinalApprovers(companyId);
  const employeesQuery = useAssignableEmployees(companyId);
  const upsert = useUpsertAdvanceFinalApprover();
  const remove = useRemoveAdvanceFinalApprover();

  const empName = useMemo(() => new Map((employeesQuery.data ?? []).map((e) => [e.id, `${e.fullName}${e.employeeCode ? ` (${e.employeeCode})` : ""}`])), [employeesQuery.data]);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [maxLimit, setMaxLimit] = useState("");
  const [canModify, setCanModify] = useState(true);
  const [canIncrease, setCanIncrease] = useState(false);
  const [backupId, setBackupId] = useState("");
  const [remark, setRemark] = useState("");

  const reset = () => { setEditId(null); setEmployeeId(""); setIsActive(true); setMaxLimit(""); setCanModify(true); setCanIncrease(false); setBackupId(""); setRemark(""); };

  const save = async () => {
    if (!companyId || !employeeId) { toast({ title: "Pick an employee.", variant: "destructive" }); return; }
    try {
      await upsert.mutateAsync({
        id: editId ?? undefined,
        companyId,
        employeeId,
        isActive,
        maxApprovalLimit: maxLimit.trim() ? Number(maxLimit) : null,
        canModifyAmount: canModify,
        canIncreaseAmount: canIncrease,
        backupApproverEmployeeId: backupId || null,
        remark: remark.trim() || null,
        userId: user?.id,
      });
      toast({ title: editId ? "Final approver updated." : "Final approver added.", variant: "success" });
      setOpen(false); reset();
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Final Approver (Boss)</CardTitle>
        <Button size="sm" onClick={() => { reset(); setOpen(true); }}>Add Approver</Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          The Boss is the Step 2 (final) approver. Configured here — <span className="font-medium">not</span> in attendance_super_managers. The
          earliest active row is the primary approver; a backup may act in their place.
        </p>
        {approversQuery.isLoading ? (
          <LoadingState />
        ) : (approversQuery.data ?? []).length === 0 ? (
          <EmptyState icon={ShieldAlert} title="No Final Approver configured." description="Without one, employees cannot submit advances that require Boss approval." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead><TableHead>Approval Limit</TableHead><TableHead>Can Modify</TableHead>
                  <TableHead>Can Increase</TableHead><TableHead>Backup</TableHead><TableHead>Active</TableHead><TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(approversQuery.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{empName.get(a.employeeId) ?? "Unknown Employee"}</TableCell>
                    <TableCell className="text-xs">{a.maxApprovalLimit != null ? formatAmount(a.maxApprovalLimit) : "No limit"}</TableCell>
                    <TableCell>{a.canModifyAmount ? "Yes" : "No"}</TableCell>
                    <TableCell>{a.canIncreaseAmount ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-xs">{a.backupApproverEmployeeId ? empName.get(a.backupApproverEmployeeId) ?? "—" : "—"}</TableCell>
                    <TableCell>{a.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => {
                          setEditId(a.id); setEmployeeId(a.employeeId); setIsActive(a.isActive);
                          setMaxLimit(a.maxApprovalLimit?.toString() ?? ""); setCanModify(a.canModifyAmount);
                          setCanIncrease(a.canIncreaseAmount); setBackupId(a.backupApproverEmployeeId ?? ""); setRemark(a.remark ?? "");
                          setOpen(true);
                        }}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.id)}>Remove</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit Final Approver" : "Add Final Approver"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId} disabled={Boolean(editId)}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {(employeesQuery.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName}{e.employeeCode ? ` (${e.employeeCode})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Approval Limit (₹, blank = no limit)</Label><Input type="number" value={maxLimit} onChange={(e) => setMaxLimit(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Backup Approver</Label>
                <Select value={backupId} onValueChange={setBackupId}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    {(employeesQuery.data ?? []).filter((e) => e.id !== employeeId).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-6 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} /> Active</label>
              <label className="flex items-center gap-2"><Checkbox checked={canModify} onCheckedChange={(v) => setCanModify(Boolean(v))} /> Can modify amount</label>
              <label className="flex items-center gap-2"><Checkbox checked={canIncrease} onCheckedChange={(v) => setCanIncrease(Boolean(v))} /> Can increase above requested</label>
            </div>
            <div className="space-y-1.5"><Label>Remark</Label><Textarea value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={upsert.isPending}>Cancel</Button>
            <Button onClick={save} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ===========================================================================
// HR / Finance Processor rosters
// ===========================================================================
function ProcessorTab({
  companyId,
  table,
  title,
  note,
}: {
  companyId?: string;
  table: "advance_hr_processors" | "advance_finance_processors";
  title: string;
  note: string;
}) {
  const { user } = useAuth();
  const processorsQuery = useAdvanceProcessors(table, companyId);
  const employeesQuery = useAssignableEmployees(companyId);
  const add = useAddAdvanceProcessor();
  const setActive = useSetAdvanceProcessorActive();
  const remove = useRemoveAdvanceProcessor();

  const empName = useMemo(() => new Map((employeesQuery.data ?? []).map((e) => [e.id, `${e.fullName}${e.employeeCode ? ` (${e.employeeCode})` : ""}`])), [employeesQuery.data]);

  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [remark, setRemark] = useState("");

  const save = async () => {
    if (!companyId || !employeeId) { toast({ title: "Pick an employee.", variant: "destructive" }); return; }
    try {
      await add.mutateAsync({ table, companyId, employeeId, remark: remark.trim() || null, userId: user?.id });
      toast({ title: `${title} added.`, variant: "success" });
      setOpen(false); setEmployeeId(""); setRemark("");
    } catch (error) {
      toast({ title: "Add failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>Add</Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">{note}</p>
        {processorsQuery.isLoading ? (
          <LoadingState />
        ) : (processorsQuery.data ?? []).length === 0 ? (
          <EmptyState icon={ShieldAlert} title={`No ${title.toLowerCase()} yet.`} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Employee</TableHead><TableHead>Active</TableHead><TableHead>Remark</TableHead><TableHead>Action</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(processorsQuery.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{empName.get(p.employeeId) ?? "Unknown Employee"}</TableCell>
                    <TableCell>{p.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.remark ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setActive.mutate({ table, id: p.id, isActive: !p.isActive, userId: user?.id })}>
                          {p.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate({ table, id: p.id })}>Remove</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add {title}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {(employeesQuery.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.fullName}{e.employeeCode ? ` (${e.employeeCode})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Remark</Label><Textarea value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={add.isPending}>Cancel</Button>
            <Button onClick={save} disabled={add.isPending}>{add.isPending ? "Adding…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ===========================================================================
// Recovery view (Phase 4) — read-only admin overview. All recovery actions
// (generate plan, run payroll period, settle, close, reverse) live on the
// dedicated Advance Recovery page, gated to the Finance Processor roster.
// ===========================================================================
function RecoveryTab({ companyId }: { companyId?: string }) {
  const [status, setStatus] = useState<string>("recovering");
  const plansQ = useAdvanceRecoveryPlans(status, Boolean(companyId));
  const [detailId, setDetailId] = useState<string | null>(null);
  const rows = plansQ.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Advance Recovery</CardTitle>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="recovery_pending">Recovery Pending</SelectItem>
            <SelectItem value="recovering">Recovering</SelectItem>
            <SelectItem value="settled">Settled</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Read-only overview. Recovery is based on the actual paid amount; an advance closes only when the outstanding is zero. Run payroll
          deduction periods, record settlements and close advances from the dedicated <span className="font-medium">Advance Recovery</span> page.
        </p>
        {plansQ.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldAlert} title="Nothing in this status." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead><TableHead>Code</TableHead><TableHead>Type</TableHead>
                  <TableHead>Actual Paid</TableHead><TableHead>Recovered</TableHead><TableHead>Outstanding</TableHead>
                  <TableHead>Method</TableHead><TableHead>Monthly</TableHead><TableHead>Start</TableHead>
                  <TableHead>Next Due</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.advanceRequestId}>
                    <TableCell className="font-medium">{p.employeeName}</TableCell>
                    <TableCell className="text-xs">{p.employeeCode ?? "—"}</TableCell>
                    <TableCell>{p.advanceTypeName}</TableCell>
                    <TableCell className="font-medium">{formatAmount(p.actualPaidAmount)}</TableCell>
                    <TableCell className="text-xs">{formatAmount(p.totalRecovered + p.totalSettled)}</TableCell>
                    <TableCell className="font-medium text-amber-700">{formatAmount(p.outstandingAmount)}</TableCell>
                    <TableCell className="text-xs">{RECOVERY_METHOD_LABEL[p.recoveryMethod] ?? p.recoveryMethod}</TableCell>
                    <TableCell className="text-xs">{formatAmount(p.monthlyAmount)}</TableCell>
                    <TableCell className="text-xs">{formatDate(p.recoveryStartDate)}</TableCell>
                    <TableCell className="text-xs">{p.nextDueMonth ? formatDate(p.nextDueMonth) : "—"}</TableCell>
                    <TableCell><Badge variant={ADVANCE_STATUS_VARIANT[p.status]}>{ADVANCE_STATUS_LABEL[p.status]}</Badge></TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => setDetailId(p.advanceRequestId)}>View</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <RecoveryDetailDialog requestId={detailId} activeModes={[]} onClose={() => setDetailId(null)} readOnly />
    </Card>
  );
}

// ===========================================================================
// Payment Modes master (Phase 3)
// ===========================================================================
function PaymentModesTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const modesQuery = useAdvancePaymentModes(companyId, false);
  const upsert = useUpsertAdvancePaymentMode();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [requiresReference, setRequiresReference] = useState(true);
  const [sortOrder, setSortOrder] = useState("100");

  const reset = () => {
    setEditId(null); setCode(""); setName(""); setDescription("");
    setIsActive(true); setRequiresReference(true); setSortOrder("100");
  };

  const save = async () => {
    if (!companyId || !code.trim() || !name.trim()) {
      toast({ title: "Code and name are required.", variant: "destructive" });
      return;
    }
    try {
      await upsert.mutateAsync({
        id: editId ?? undefined,
        companyId,
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
        isActive,
        requiresReference,
        sortOrder: Number(sortOrder) || 100,
        userId: user?.id,
      });
      toast({ title: editId ? "Payment mode updated." : "Payment mode created.", variant: "success" });
      setOpen(false); reset();
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Payment Modes</CardTitle>
        <Button size="sm" onClick={() => { reset(); setOpen(true); }}>New Mode</Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Finance selects one of these when recording a payment. "Requires reference" drives whether a Transaction / UTR / Bank
          reference is mandatory for that mode — it is configuration, never hard-coded. Historical payments keep the mode they were
          paid with even if it is later renamed or deactivated; deactivating a mode only hides it from new payments.
        </p>
        {modesQuery.isLoading ? (
          <LoadingState />
        ) : (modesQuery.data ?? []).length === 0 ? (
          <EmptyState icon={ShieldAlert} title="No payment modes." description="Add at least one so Finance can record payments." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sort</TableHead><TableHead>Code</TableHead><TableHead>Name</TableHead>
                  <TableHead>Requires Reference</TableHead><TableHead>Active</TableHead><TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(modesQuery.data ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">{m.sortOrder}</TableCell>
                    <TableCell className="font-mono text-xs">{m.code}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.requiresReference ? "Yes" : "No"}</TableCell>
                    <TableCell>{m.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => {
                        setEditId(m.id); setCode(m.code); setName(m.name); setDescription(m.description ?? "");
                        setIsActive(m.isActive); setRequiresReference(m.requiresReference); setSortOrder(String(m.sortOrder));
                        setOpen(true);
                      }}>Edit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit Payment Mode" : "New Payment Mode"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} disabled={Boolean(editId)} /></div>
            <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Sort Order</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} /> Active</label>
            <label className="flex items-center gap-2"><Checkbox checked={requiresReference} onCheckedChange={(v) => setRequiresReference(Boolean(v))} /> Requires transaction / UTR / bank reference</label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={upsert.isPending}>Cancel</Button>
            <Button onClick={save} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ===========================================================================
// Notification settings
// ===========================================================================
function NotificationsTab({ companyId }: { companyId?: string }) {
  const { user } = useAuth();
  const settingsQuery = useAdvanceNotificationSettings(companyId);
  const upsert = useUpsertAdvanceNotificationSetting();

  const eventTypes = advanceService.configEventTypes();
  const byEvent = useMemo(() => new Map((settingsQuery.data ?? []).map((s) => [s.eventType, s])), [settingsQuery.data]);

  const toggle = async (eventType: string, field: "inAppEnabled" | "pushEnabled" | "emailEnabled" | "smsEnabled", value: boolean) => {
    if (!companyId) return;
    const cur = byEvent.get(eventType);
    try {
      await upsert.mutateAsync({
        companyId,
        eventType,
        inAppEnabled: field === "inAppEnabled" ? value : cur?.inAppEnabled ?? true,
        pushEnabled: field === "pushEnabled" ? value : cur?.pushEnabled ?? false,
        emailEnabled: field === "emailEnabled" ? value : cur?.emailEnabled ?? false,
        smsEnabled: field === "smsEnabled" ? value : cur?.smsEnabled ?? false,
        userId: user?.id,
      });
    } catch (error) {
      toast({ title: "Update failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Notification Settings</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          In-app notifications reuse the shared <span className="font-mono">notifications</span> table. Only in-app is delivered today; the other
          channels are stored for a future dispatcher. An event with no row here defaults to in-app ON.
        </p>
        {settingsQuery.isLoading ? (
          <LoadingState />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Event</TableHead><TableHead>In-App</TableHead><TableHead>Push</TableHead><TableHead>Email</TableHead><TableHead>SMS</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {eventTypes.map((et) => {
                  const s = byEvent.get(et);
                  return (
                    <TableRow key={et}>
                      <TableCell className="font-mono text-xs">{et}</TableCell>
                      <TableCell><Checkbox checked={s?.inAppEnabled ?? true} onCheckedChange={(v) => toggle(et, "inAppEnabled", Boolean(v))} /></TableCell>
                      <TableCell><Checkbox checked={s?.pushEnabled ?? false} onCheckedChange={(v) => toggle(et, "pushEnabled", Boolean(v))} /></TableCell>
                      <TableCell><Checkbox checked={s?.emailEnabled ?? false} onCheckedChange={(v) => toggle(et, "emailEnabled", Boolean(v))} /></TableCell>
                      <TableCell><Checkbox checked={s?.smsEnabled ?? false} onCheckedChange={(v) => toggle(et, "smsEnabled", Boolean(v))} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
