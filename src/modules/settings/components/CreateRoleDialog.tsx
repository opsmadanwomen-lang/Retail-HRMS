import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useCreateDynamicRole, useSetDynamicRoleStatus, useSetRolePermission } from "@/hooks/usePermissions";
import type { DynamicRole } from "@/types/permission";

/**
 * The ONE "Create Role" dialog for the centralized Dynamic Role Master (spec §1/§19) — used from
 * BOTH Settings -> User Management and Settings -> Permissions -> Roles, so there is exactly one
 * create-role form in the codebase, not two that could drift apart. Calls the SAME
 * permission_create_role RPC (migration 0161/0172) either caller already used; a role created here
 * is immediately visible everywhere else that queries `useDynamicRoles()` (same React Query cache
 * key), with no page reload and no per-page code change.
 */
/**
 * Translates a raw Supabase/Postgres error into a safe, useful, business-level message for a Super
 * Admin — never the raw SQL/stack trace, but never just a generic "something went wrong" either
 * (spec §8). Known error codes get a specific message; anything else falls back to the RPC's own
 * RAISE EXCEPTION text (already a short, human-written string in this codebase, e.g. "Role code is
 * required.") when it looks safe to show, and a generic message otherwise.
 */
export function describeRoleError(error: unknown): string {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "23505") return "Role Code already exists. Please choose a different Role Code.";
  if (err?.code === "42501") return "You are not authorized to perform this action.";
  if (err?.message && err.message.length > 0 && err.message.length < 200 && !/\bSELECT\b|\bFROM\b|\bpg_/i.test(err.message)) {
    return err.message;
  }
  return "Please try again, or contact your administrator if the problem continues.";
}

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId?: string;
  /** Optional "start from template" prefill (Permission Management only) — pure convenience, never
   *  consulted again after creation; the same set-permission RPC a human clicking Allow/Deny would
   *  call. */
  templates?: Record<string, { label: string; allow: string[]; deny: string[] }>;
  onCreated?: (role: DynamicRole) => void;
}

export function CreateRoleDialog({ open, onOpenChange, companyId, templates, onCreated }: CreateRoleDialogProps) {
  const createRole = useCreateDynamicRole();
  const setRoleStatus = useSetDynamicRoleStatus();
  const setPerm = useSetRolePermission();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [displayOrder, setDisplayOrder] = useState("");
  const [templateKey, setTemplateKey] = useState<string>("none");

  const reset = () => {
    setCode(""); setName(""); setDescription(""); setIsActive(true); setDisplayOrder(""); setTemplateKey("none");
  };

  const submit = async () => {
    if (!companyId || !code.trim() || !name.trim()) {
      toast({ title: "Role Code and Role Name are required.", variant: "destructive" });
      return;
    }
    try {
      const role = await createRole.mutateAsync({
        companyId, code: code.trim(), name: name.trim(), description: description.trim() || null,
        displayOrder: displayOrder.trim() ? Number(displayOrder) : undefined,
      });

      if (!isActive) {
        await setRoleStatus.mutateAsync({ roleId: role.id, isActive: false });
      }

      const tpl = templates && templateKey !== "none" ? templates[templateKey] : null;
      if (tpl) {
        await Promise.all([
          ...tpl.allow.map((moduleCode) => setPerm.mutateAsync({ roleId: role.id, moduleCode, actionCode: "VIEW", isAllowed: true })),
          ...tpl.deny.map((moduleCode) => setPerm.mutateAsync({ roleId: role.id, moduleCode, actionCode: "VIEW", isAllowed: false })),
        ]);
      }

      toast({ title: "Role created successfully.", variant: "success" });
      reset();
      onOpenChange(false);
      onCreated?.({ ...role, isActive });
    } catch (error) {
      toast({ title: "Could not create role", description: describeRoleError(error), variant: "destructive" });
    }
  };

  const busy = createRole.isPending || setRoleStatus.isPending || setPerm.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Role</DialogTitle>
          <DialogDescription>
            A business role any Super Admin can create — e.g. "HR Manager", "Payroll Manager", "IT Manager". It becomes available
            immediately wherever a role is assigned, displayed or configured, with no code change.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Role Code *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, "_"))} placeholder="HR_MANAGER" />
            <p className="text-xs text-muted-foreground">Stable, internal, unique — never shown to end users. Cannot be changed after creation.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Role Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="HR Manager" />
            <p className="text-xs text-muted-foreground">The display name shown everywhere. Can be renamed later without affecting existing assignments.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Handles employee HR operations and related workflows." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={isActive ? "active" : "inactive"} onValueChange={(v) => setIsActive(v === "active")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Display Order (optional)</Label>
              <Input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} placeholder="100" />
            </div>
          </div>
          {templates && (
            <div className="space-y-1.5">
              <Label>Start from template (optional — just prefills, you can change everything after)</Label>
              <Select value={templateKey} onValueChange={setTemplateKey}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Blank (no prefill)</SelectItem>
                  {Object.entries(templates).map(([key, t]) => <SelectItem key={key} value={key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create Role"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
