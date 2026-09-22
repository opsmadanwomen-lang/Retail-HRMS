import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Plus, Search, History, Copy, CheckCheck, XCircle, RotateCcw, Pencil, Undo2 } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useManagedUsers } from "@/hooks/useUserManagement";
import { useStores } from "@/hooks/useStores";
import type { ManagedUser } from "@/types/userManagement";
import { USER_MANAGEMENT_ROLE_LABELS } from "@/types/userManagement";
import {
  usePermissionModules,
  usePermissionActions,
  usePermissionFields,
  usePermissionTabs,
  useDynamicRoles,
  useSetDynamicRoleStatus,
  useRolePermissions,
  useSetRolePermission,
  useClearRolePermission,
  useRoleTabPermissions,
  useSetRoleTabPermission,
  useClearRoleTabPermission,
  useRoleFieldPermissions,
  useSetRoleFieldPermission,
  useUserDynamicRole,
  useSetUserDynamicRole,
  useSetUserFieldOverride,
  usePermissionAuditHistory,
  useRoleScopes,
  useSetRoleScope,
  useCopyRole,
  useUpdateDynamicRole,
  useEffectiveActions,
  useSetUserOverride,
  useClearUserOverride,
  useSetUserTabOverride,
  useClearUserTabOverride,
} from "@/hooks/usePermissions";
import { formatDateTime } from "@/modules/advance/utils";
import type { PermissionModule, ScopeType, EffectiveActionRow } from "@/types/permission";
import { CreateRoleDialog, describeRoleError } from "@/modules/settings/components/CreateRoleDialog";
import { RoleSelector } from "@/modules/settings/components/RoleSelector";

// Role Templates (§16) — prefill ONLY. Never consulted at authorization time; after creation the
// Super Admin can change everything through the normal editor. Purely frontend data. Finance is
// deliberately NOT one of these — it is not a User Management role and must not be suggested as one.
const ROLE_TEMPLATES: Record<string, { label: string; allow: string[]; deny: string[] }> = {
  hr: {
    label: "HR",
    allow: ["employee", "employee_documents", "employee_transfer", "exit_request", "attendance", "leave", "leave_approval", "advance", "hr_advance_processing", "advance_management", "payroll", "reports"],
    deny: ["finance_advance_payment", "permission_management", "user_management"],
  },
  store_manager: {
    label: "Store Manager",
    allow: ["employee", "attendance", "leave", "leave_approval", "advance_management"],
    deny: ["finance_advance_payment", "hr_advance_processing", "payroll", "permission_management"],
  },
  manager: {
    label: "Manager",
    allow: ["attendance", "leave_approval", "advance_approval"],
    deny: ["finance_advance_payment", "hr_advance_processing", "permission_management"],
  },
  boss: {
    label: "Boss",
    allow: ["advance_approval", "leave_approval", "reports"],
    deny: ["finance_advance_payment", "permission_management"],
  },
  staff: {
    label: "Staff",
    allow: ["employee", "employee_documents", "attendance", "leave", "advance", "payroll", "reports"],
    deny: ["leave_approval", "advance_approval", "finance_advance_payment", "hr_advance_processing", "permission_management", "settings"],
  },
};

const SCOPE_LABEL: Record<ScopeType, string> = {
  company: "All Company",
  store: "Specific Store",
  multi_store: "Multiple Stores",
  department: "Own Department",
  own: "Own Employee",
  reporting: "Reporting Employees",
  team: "Own Team",
  custom: "Custom Group",
};

const SOURCE_LABEL: Record<EffectiveActionRow["source"], string> = {
  super_admin: "Super Admin (always allowed)",
  user_tab_override: "User Override (this tab)",
  role_tab: "Role (this tab)",
  user_module_override: "User Override",
  role_inactive: "Denied — assigned Role is Inactive",
  role_module: "Role",
  default: "System Default",
};

/**
 * Settings -> User & Role Permissions (migrations 0161/0164-0167/0169, Dynamic Role & Permission
 * System). Super Admin only. ONE permission target at a time — Role OR User, never both — drilling
 * down Category (Module) -> Sub-Category (Tab, where configured) -> Permission Matrix. Every
 * permission defaults to ALLOWED (fail-open) until explicitly configured here, and is enforced
 * server-side (has_dynamic_permission/has_dynamic_tab_permission/has_field_permission + the
 * RESTRICTIVE RLS policies from migration 0162) — this page is only the configuration surface.
 */
export function PermissionManagementPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const companyId = user?.companyId ?? undefined;

  if (!isSuperAdmin) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Super Admin access required"
        description="Only Super Admin can view or manage role and user permissions."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User & Role Permissions"
        description="Control which modules, tabs, actions and sensitive fields each role or individual user can access. Nothing here is hard-coded — every permission is configurable and enforced on the backend, not just hidden in the UI."
      />
      <Tabs defaultValue="configure">
        <TabsList>
          <TabsTrigger value="configure">Permissions</TabsTrigger>
          <TabsTrigger value="audit"><History className="mr-1 h-4 w-4" /> Audit History</TabsTrigger>
        </TabsList>
        <TabsContent value="configure">
          <ConfigureTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permission Type — Role OR User, never both at once (§1).
// ---------------------------------------------------------------------------
function ConfigureTab({ companyId }: { companyId?: string }) {
  const [permissionType, setPermissionType] = useState<"role" | "user">("role");

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center gap-6 p-4">
          <Label className="text-sm font-medium">Permission Type</Label>
          <div className="flex gap-2">
            <button
              onClick={() => setPermissionType("role")}
              className={`rounded-md border px-4 py-1.5 text-sm font-medium transition-colors ${permissionType === "role" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              Role
            </button>
            <button
              onClick={() => setPermissionType("user")}
              className={`rounded-md border px-4 py-1.5 text-sm font-medium transition-colors ${permissionType === "user" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              User
            </button>
          </div>
        </CardContent>
      </Card>

      {permissionType === "role" ? <RolesTab companyId={companyId} /> : <UsersTab companyId={companyId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roles panel — list on the left, Category -> Sub-Category -> Matrix on the right.
// ---------------------------------------------------------------------------
function RolesTab({ companyId }: { companyId?: string }) {
  const rolesQuery = useDynamicRoles(companyId);
  const setRoleStatus = useSetDynamicRoleStatus();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const roles = rolesQuery.data ?? [];
  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  const toggleStatus = async (roleId: string, isActive: boolean) => {
    try {
      await setRoleStatus.mutateAsync({ roleId, isActive: !isActive });
    } catch (error) {
      toast({ title: "Could not update role status", description: describeRoleError(error), variant: "destructive" });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm">Role</CardTitle>
          <Button size="sm" variant="secondary" onClick={() => setShowCreate(true)}><Plus className="mr-1 h-4 w-4" /> New</Button>
        </CardHeader>
        <CardContent className="space-y-1 pt-0">
          {rolesQuery.isLoading ? (
            <LoadingState rows={3} />
          ) : roles.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No roles yet" description="Create one to get started." />
          ) : (
            roles.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRoleId(r.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors ${
                  selectedRoleId === r.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                <span className="truncate">{r.name}</span>
                <Badge variant={r.isActive ? "success" : "secondary"}>{r.isActive ? "Active" : "Inactive"}</Badge>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {selectedRole ? (
        <RolePermissionEditor
          key={selectedRole.id}
          role={selectedRole}
          allRoles={roles}
          onToggleStatus={() => toggleStatus(selectedRole.id, selectedRole.isActive)}
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <EmptyState icon={ShieldCheck} title="Select a Role" description="Choose a role on the left, then pick a Category and Sub-Category to configure its permissions." />
          </CardContent>
        </Card>
      )}

      <CreateRoleDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        companyId={companyId}
        templates={ROLE_TEMPLATES}
        onCreated={(role) => setSelectedRoleId(role.id)}
      />
    </div>
  );
}

function RolePermissionEditor({
  role,
  allRoles,
  onToggleStatus,
}: {
  role: { id: string; name: string; isActive: boolean; description?: string | null; displayOrder: number };
  allRoles: { id: string; name: string }[];
  onToggleStatus: () => void;
}) {
  const modulesQuery = usePermissionModules();
  const actionsQuery = usePermissionActions();
  const rolePermsQuery = useRolePermissions(role.id);
  const roleTabPermsQuery = useRoleTabPermissions(role.id);
  const roleFieldPermsQuery = useRoleFieldPermissions(role.id);
  const roleScopesQuery = useRoleScopes(role.id);
  const setPerm = useSetRolePermission();
  const clearPerm = useClearRolePermission();
  const setTabPerm = useSetRoleTabPermission();
  const clearTabPerm = useClearRoleTabPermission();
  const setFieldPerm = useSetRoleFieldPermission();
  const setScope = useSetRoleScope();
  const copyRole = useCopyRole();
  const updateRole = useUpdateDynamicRole();

  const [moduleCode, setModuleCode] = useState<string | null>(null);
  const [tabCode, setTabCode] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<"allow" | "deny" | "reset" | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<"allow" | "deny" | "reset" | null>(null);
  const [showCopyFrom, setShowCopyFrom] = useState(false);
  const [copySourceId, setCopySourceId] = useState<string>("");
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState(role.name);
  const [editDescription, setEditDescription] = useState(role.description ?? "");
  const [editDisplayOrder, setEditDisplayOrder] = useState(String(role.displayOrder));

  const modules = modulesQuery.data ?? [];
  const actions = actionsQuery.data ?? [];
  const rolePerms = rolePermsQuery.data ?? [];
  const roleTabPerms = roleTabPermsQuery.data ?? [];
  const roleFieldPerms = roleFieldPermsQuery.data ?? [];
  const roleScopes = roleScopesQuery.data ?? [];

  const { user: currentUser } = useAuth();
  const tabsQuery = usePermissionTabs(moduleCode ?? undefined);
  const tabs = tabsQuery.data ?? [];
  const fieldsQuery = usePermissionFields(moduleCode ?? undefined);
  const fields = fieldsQuery.data ?? [];
  const storesQuery = useStores(currentUser?.companyId ?? undefined);
  const stores = storesQuery.data ?? [];

  // Sub-Category resets whenever the Category changes.
  useEffect(() => setTabCode(null), [moduleCode]);

  const scope = roleScopes.find((s) => s.moduleCode === moduleCode) ?? null;
  const currentScope = scope?.scopeType ?? "company";

  const stateFor = (aCode: string): "allow" | "deny" | "clear" => {
    if (tabCode) {
      const t = roleTabPerms.find((x) => x.moduleCode === moduleCode && x.tabCode === tabCode && x.actionCode === aCode);
      if (t !== undefined) return t.isAllowed ? "allow" : "deny";
    }
    const p = rolePerms.find((x) => x.moduleCode === moduleCode && x.actionCode === aCode);
    return p === undefined ? "clear" : p.isAllowed ? "allow" : "deny";
  };

  const setState = async (aCode: string, next: "allow" | "deny" | "clear") => {
    if (!moduleCode) return;
    try {
      if (tabCode) {
        if (next === "clear") await clearTabPerm.mutateAsync({ roleId: role.id, moduleCode, tabCode, actionCode: aCode });
        else await setTabPerm.mutateAsync({ roleId: role.id, moduleCode, tabCode, actionCode: aCode, isAllowed: next === "allow" });
      } else {
        if (next === "clear") await clearPerm.mutateAsync({ roleId: role.id, moduleCode, actionCode: aCode });
        else await setPerm.mutateAsync({ roleId: role.id, moduleCode, actionCode: aCode, isAllowed: next === "allow" });
      }
    } catch (error) {
      toast({ title: "Could not update permission", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const runBulk = async (kind: "allow" | "deny" | "reset") => {
    setBulkBusy(kind);
    setConfirmBulk(null);
    try {
      const calls: Promise<unknown>[] = [];
      for (const m of modules) {
        for (const a of actions) {
          if (kind === "reset") calls.push(clearPerm.mutateAsync({ roleId: role.id, moduleCode: m.code, actionCode: a.code }));
          else calls.push(setPerm.mutateAsync({ roleId: role.id, moduleCode: m.code, actionCode: a.code, isAllowed: kind === "allow" }));
        }
      }
      const BATCH = 20;
      for (let i = 0; i < calls.length; i += BATCH) {
        await Promise.all(calls.slice(i, i + BATCH));
      }
      toast({ title: kind === "reset" ? "All modules reset to Inherit." : `All modules set to ${kind === "allow" ? "Allow" : "Deny"}.`, variant: "success" });
    } catch (error) {
      toast({ title: "Bulk update failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBulkBusy(null);
    }
  };

  const submitEdit = async () => {
    if (!editName.trim()) {
      toast({ title: "Role name is required.", variant: "destructive" });
      return;
    }
    try {
      await updateRole.mutateAsync({
        roleId: role.id, name: editName.trim(), description: editDescription.trim() || null,
        displayOrder: editDisplayOrder.trim() ? Number(editDisplayOrder) : undefined,
      });
      toast({ title: "Role updated.", variant: "success" });
      setShowEdit(false);
    } catch (error) {
      toast({ title: "Could not update role", description: describeRoleError(error), variant: "destructive" });
    }
  };

  const submitCopyFrom = async () => {
    if (!copySourceId) return;
    try {
      await copyRole.mutateAsync({ sourceRoleId: copySourceId, targetRoleId: role.id });
      toast({ title: "Permissions copied.", variant: "success" });
      setShowCopyFrom(false);
      setCopySourceId("");
    } catch (error) {
      toast({ title: "Copy failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-sm">{role.name}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}><Pencil className="mr-1 h-4 w-4" /> Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmBulk("allow")} disabled={Boolean(bulkBusy)}><CheckCheck className="mr-1 h-4 w-4" /> Allow All</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmBulk("deny")} disabled={Boolean(bulkBusy)}><XCircle className="mr-1 h-4 w-4" /> Deny All</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmBulk("reset")} disabled={Boolean(bulkBusy)}><RotateCcw className="mr-1 h-4 w-4" /> Reset to Inherit</Button>
          <Button size="sm" variant="outline" onClick={() => setShowCopyFrom(true)}><Copy className="mr-1 h-4 w-4" /> Copy From Role</Button>
          <Button size="sm" variant="secondary" onClick={onToggleStatus}>{role.isActive ? "Deactivate" : "Activate"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Category (Module)</Label>
            <Select value={moduleCode ?? undefined} onValueChange={setModuleCode}>
              <SelectTrigger><SelectValue placeholder="Select a module" /></SelectTrigger>
              <SelectContent>
                {modules.map((m: PermissionModule) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {tabs.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Sub-Category (Tab)</Label>
              <Select value={tabCode ?? "__module__"} onValueChange={(v) => setTabCode(v === "__module__" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="Whole module" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__module__">Whole module (all tabs)</SelectItem>
                  {tabs.map((t) => <SelectItem key={t.tabCode} value={t.tabCode}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {!moduleCode ? (
          <EmptyState icon={ShieldCheck} title="Select a Category" description="Choose a module above to see its Permission Matrix." />
        ) : (
          <>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Permission Matrix — {modules.find((m) => m.code === moduleCode)?.label}{tabCode ? ` → ${tabs.find((t) => t.tabCode === tabCode)?.label}` : ""}
              </p>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Action</TableHead><TableHead className="text-center">Allowed</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {actions.map((a) => {
                      const state = stateFor(a.code);
                      return (
                        <TableRow key={a.code}>
                          <TableCell className="text-sm">{a.label}</TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={state === "allow" || state === "clear"}
                              onCheckedChange={(checked) => setState(a.code, checked ? "allow" : "deny")}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Unchecked = explicitly denied. Checked with no prior configuration = System Default (allowed).</p>
            </div>

            {!tabCode && (
              <>
                <div className="space-y-1.5 border-t pt-3">
                  <Label className="text-xs">Data Scope for this module</Label>
                  <Select value={currentScope} onValueChange={(v) => setScope.mutate({ roleId: role.id, moduleCode, scopeType: v as ScopeType, storeIds: currentScope === v ? scope?.storeIds ?? null : null })}>
                    <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SCOPE_LABEL) as ScopeType[]).map((s) => <SelectItem key={s} value={s}>{SCOPE_LABEL[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {(currentScope === "store" || currentScope === "multi_store") && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {stores.map((s: any) => {
                        const checked = (scope?.storeIds ?? []).includes(s.id);
                        return (
                          <label key={s.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const current = scope?.storeIds ?? [];
                                const next = v ? [...current, s.id] : current.filter((id) => id !== s.id);
                                setScope.mutate({ roleId: role.id, moduleCode, scopeType: currentScope, storeIds: next });
                              }}
                            />
                            {s.name}
                          </label>
                        );
                      })}
                      {stores.length === 0 && <span className="text-xs text-muted-foreground">No stores found for this company.</span>}
                    </div>
                  )}
                </div>

                {fields.length > 0 && (
                  <div className="border-t pt-3">
                    <Label className="text-xs">Field-level access (sensitive fields are marked)</Label>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      {fields.map((f) => {
                        const fp = roleFieldPerms.find((x) => x.fieldCode === f.fieldCode);
                        const allowed = fp?.isAllowed ?? true;
                        return (
                          <label key={f.fieldCode} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
                            <span>{f.label} {f.isSensitive && <Badge variant="warning" className="ml-1 align-middle">Sensitive</Badge>}</span>
                            <Checkbox checked={allowed} onCheckedChange={(checked) => setFieldPerm.mutate({ roleId: role.id, moduleCode, fieldCode: f.fieldCode, isAllowed: Boolean(checked) })} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription>Code stays fixed; rename or re-describe this role.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Description</Label><Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Display Order</Label><Input type="number" value={editDisplayOrder} onChange={(e) => setEditDisplayOrder(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={updateRole.isPending}>{updateRole.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmBulk)} onOpenChange={(o) => !o && setConfirmBulk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmBulk === "allow" ? "Allow every action in every module?" : confirmBulk === "deny" ? "Deny every action in every module?" : "Reset every module to Inherit?"}
            </DialogTitle>
            <DialogDescription>
              This applies to ALL {modules.length} modules × {actions.length} actions for "{role.name}" (module level; sub-category tabs are unaffected) and cannot be undone automatically — you can always reconfigure afterward.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmBulk(null)}>Cancel</Button>
            <Button variant={confirmBulk === "deny" ? "destructive" : "default"} onClick={() => confirmBulk && runBulk(confirmBulk)}>
              {bulkBusy ? "Applying…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCopyFrom} onOpenChange={setShowCopyFrom}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy permissions from another role</DialogTitle>
            <DialogDescription>
              Copies all module/action, field and scope permissions from the source role onto "{role.name}", overwriting anything already configured here.
            </DialogDescription>
          </DialogHeader>
          <Select value={copySourceId} onValueChange={setCopySourceId}>
            <SelectTrigger><SelectValue placeholder="Select source role" /></SelectTrigger>
            <SelectContent>
              {allRoles.filter((r) => r.id !== role.id).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowCopyFrom(false)}>Cancel</Button>
            <Button onClick={submitCopyFrom} disabled={!copySourceId || copyRole.isPending}>{copyRole.isPending ? "Copying…" : `Copy to ${role.name}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Users panel — search on the left, Category -> Sub-Category -> Effective/Source on the right.
// ---------------------------------------------------------------------------
function UsersTab({ companyId }: { companyId?: string }) {
  const usersQuery = useManagedUsers(companyId);
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);

  const users = useMemo(() => (usersQuery.data ?? []).filter((u) => u.isActive), [usersQuery.data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.linkedEmployeeCode ?? "").toLowerCase().includes(q)
    );
  }, [users, query]);

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">User</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, employee code or email…" />
          </div>
          {usersQuery.isLoading ? (
            <LoadingState rows={3} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={Search} title="No matching users" />
          ) : (
            <div className="max-h-[28rem] space-y-1 overflow-y-auto">
              {filtered.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className={`flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    selectedUser?.id === u.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  }`}
                >
                  <span className="truncate font-medium">{u.fullName}</span>
                  <span className={`truncate text-xs ${selectedUser?.id === u.id ? "opacity-80" : "text-muted-foreground"}`}>
                    {u.linkedEmployeeCode ?? "—"} · {USER_MANAGEMENT_ROLE_LABELS[u.effectiveRole]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedUser ? (
        <UserPermissionEditor user={selectedUser} companyId={companyId} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <EmptyState icon={ShieldCheck} title="Select a User" description="Choose a user on the left to assign a permission role or set individual overrides." />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UserPermissionEditor({ user, companyId }: { user: ManagedUser; companyId?: string }) {
  const modulesQuery = usePermissionModules();
  const userRoleQuery = useUserDynamicRole(user.id);
  const setUserRole = useSetUserDynamicRole();
  const setOverride = useSetUserOverride();
  const clearOverride = useClearUserOverride();
  const setTabOverride = useSetUserTabOverride();
  const clearTabOverride = useClearUserTabOverride();
  const setFieldOverride = useSetUserFieldOverride();

  const [moduleCode, setModuleCode] = useState<string | null>(null);
  const [tabCode, setTabCode] = useState<string | null>(null);

  const modules = modulesQuery.data ?? [];
  const activeModule = moduleCode ?? modules[0]?.code ?? null;
  const tabsQuery = usePermissionTabs(activeModule ?? undefined);
  const tabs = tabsQuery.data ?? [];
  const fieldsQuery = usePermissionFields(!tabCode ? activeModule ?? undefined : undefined);
  const fields = fieldsQuery.data ?? [];
  const effectiveQuery = useEffectiveActions(user.id, activeModule ?? undefined, tabCode);

  useEffect(() => setTabCode(null), [activeModule]);

  const setState = async (aCode: string, next: "allow" | "deny") => {
    if (!activeModule) return;
    try {
      if (tabCode) await setTabOverride.mutateAsync({ userId: user.id, moduleCode: activeModule, tabCode, actionCode: aCode, isAllowed: next === "allow" });
      else await setOverride.mutateAsync({ userId: user.id, moduleCode: activeModule, actionCode: aCode, isAllowed: next === "allow" });
    } catch (error) {
      toast({ title: "Could not update override", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const resetState = async (aCode: string) => {
    if (!activeModule) return;
    try {
      if (tabCode) await clearTabOverride.mutateAsync({ userId: user.id, moduleCode: activeModule, tabCode, actionCode: aCode });
      else await clearOverride.mutateAsync({ userId: user.id, moduleCode: activeModule, actionCode: aCode });
    } catch (error) {
      toast({ title: "Could not reset override", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{user.fullName} <span className="font-normal text-muted-foreground">({user.email})</span></CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-2">
          <div><p className="text-xs text-muted-foreground">User Management Role (login)</p><p className="font-medium">{USER_MANAGEMENT_ROLE_LABELS[user.effectiveRole]}</p></div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Assigned Permission Role (Business Role)</p>
            <RoleSelector
              companyId={companyId}
              value={userRoleQuery.data?.dynamicRoleId ?? null}
              onChange={(roleId) => setUserRole.mutate({ userId: user.id, roleId })}
              disabled={userRoleQuery.isLoading || setUserRole.isPending}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The User Management role (above left) is this user's login/account role — unchanged here. The Permission Role (above right) is what
          drives inherited permissions below; individual overrides always take priority over it.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Category (Module)</Label>
            <Select value={activeModule ?? undefined} onValueChange={setModuleCode}>
              <SelectTrigger><SelectValue placeholder="Select a module" /></SelectTrigger>
              <SelectContent>
                {modules.map((m: PermissionModule) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {tabs.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Sub-Category (Tab)</Label>
              <Select value={tabCode ?? "__module__"} onValueChange={(v) => setTabCode(v === "__module__" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="Whole module" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__module__">Whole module (all tabs)</SelectItem>
                  {tabs.map((t) => <SelectItem key={t.tabCode} value={t.tabCode}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {activeModule && (
          <>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Effective Permissions — where each value comes from</p>
              {effectiveQuery.isLoading ? (
                <LoadingState rows={3} />
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Permission</TableHead><TableHead>Effective</TableHead><TableHead>Source</TableHead><TableHead>Override</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(effectiveQuery.data ?? []).map((r) => {
                        const isOverride = r.source === "user_tab_override" || r.source === "user_module_override";
                        return (
                          <TableRow key={r.actionCode}>
                            <TableCell className="text-sm">{r.label}</TableCell>
                            <TableCell><Badge variant={r.isAllowed ? "success" : "secondary"}>{r.isAllowed ? "✓ Allowed" : "✗ Denied"}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source]}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                <StateButton active={!r.isAllowed && isOverride} variant="destructive" label="Deny" onClick={() => setState(r.actionCode, "deny")} />
                                <StateButton active={r.isAllowed && isOverride} variant="success" label="Allow" onClick={() => setState(r.actionCode, "allow")} />
                                {isOverride && (
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => resetState(r.actionCode)}>
                                    <Undo2 className="mr-1 h-3 w-3" /> Reset to Role
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {!tabCode && fields.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <Label className="text-xs">Field-level override (e.g. "View Salary = YES" for this specific user)</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {fields.map((f) => (
                    <label key={f.fieldCode} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
                      <span>{f.label} {f.isSensitive && <Badge variant="warning" className="ml-1 align-middle">Sensitive</Badge>}</span>
                      <div className="flex gap-1">
                        <StateButton active={false} variant="destructive" label="Deny" onClick={() => setFieldOverride.mutate({ userId: user.id, moduleCode: activeModule, fieldCode: f.fieldCode, isAllowed: false })} />
                        <StateButton active={false} variant="success" label="Allow" onClick={() => setFieldOverride.mutate({ userId: user.id, moduleCode: activeModule, fieldCode: f.fieldCode, isAllowed: true })} />
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StateButton({ active, variant, label, onClick }: { active: boolean; variant: "destructive" | "secondary" | "success"; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
        active
          ? variant === "destructive"
            ? "bg-destructive text-destructive-foreground"
            : variant === "success"
            ? "bg-emerald-600 text-white"
            : "bg-secondary text-secondary-foreground"
          : "border text-muted-foreground hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Audit History tab (§28) — reuses the existing generic audit_logs mechanism.
// ---------------------------------------------------------------------------
function AuditTab() {
  const auditQuery = usePermissionAuditHistory(200);
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const allRows = auditQuery.data ?? [];

  const tables = useMemo(() => Array.from(new Set(allRows.map((r) => r.tableName))).sort(), [allRows]);
  const rows = useMemo(() => {
    let r = allRows;
    if (tableFilter !== "all") r = r.filter((x) => x.tableName === tableFilter);
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((x) => (x.performedByName ?? "").toLowerCase().includes(q) || JSON.stringify(x.changedData).toLowerCase().includes(q));
    return r;
  }, [allRows, tableFilter, query]);

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap gap-2">
          <Select value={tableFilter} onValueChange={setTableFilter}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Filter by table" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tables (Role/User/Module/Tab/Field/Scope)</SelectItem>
              {tables.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="w-64 pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by who changed / details…" />
          </div>
        </div>
        {auditQuery.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={History} title="No permission changes recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead><TableHead>Table</TableHead><TableHead>Action</TableHead>
                  <TableHead>By</TableHead><TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.performedAt)}</TableCell>
                    <TableCell className="text-xs">{r.tableName}</TableCell>
                    <TableCell className="text-xs capitalize">{r.action}</TableCell>
                    <TableCell className="text-xs">{r.performedByName ?? "—"}</TableCell>
                    <TableCell className="max-w-[24rem] truncate text-xs" title={JSON.stringify(r.changedData)}>
                      {JSON.stringify(r.changedData)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
