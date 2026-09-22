import { useEffect, useState } from "react";
import { KeyRound, Pencil, ShieldCheck, ShieldPlus, UserPlus, Users } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useStores } from "@/hooks/useStores";
import { useAssignableEmployees } from "@/hooks/useEmployees";
import { useCreateUser, useManagedUsers, useRelinkEmployee, useResetUserPassword, useSetUserActive, useUpdateUser } from "@/hooks/useUserManagement";
import { formatDate } from "@/lib/utils";
import { CREATABLE_ROLES, USER_MANAGEMENT_ROLE_LABELS, type AssignableEmployee, type ManagedUser, type UserManagementRole } from "@/types/userManagement";
import { useUserDynamicRole, useSetUserDynamicRole } from "@/hooks/usePermissions";
import { EmployeeSearchSelect } from "../components/EmployeeSearchSelect";
import { RoleSelector } from "../components/RoleSelector";
import { CreateRoleDialog, describeRoleError } from "../components/CreateRoleDialog";

/**
 * Settings -> User Management. Super Admin only (re-enforced server-side by the user-account Edge
 * Function and by profiles' own RLS write policies — hiding this page is not the real security
 * boundary). Creates/edits users through the SAME Supabase Auth + profiles architecture used
 * everywhere else in this app; "Operations Manager (SOM)"/"Super Manager" role choices bridge into
 * the EXISTING Night Duty approval system (attendance_operations_manager_assignments /
 * attendance_super_managers) rather than inventing a second one — see userManagementService.ts.
 */
export function UserManagementPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const companyId = user?.companyId ?? undefined;

  const usersQuery = useManagedUsers(companyId);
  const storesQuery = useStores(companyId);

  const [showCreate, setShowCreate] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);

  if (!isSuperAdmin) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Super Admin access required"
        description="Only Super Admin can view or manage users."
      />
    );
  }

  const users = usersQuery.data ?? [];
  const stores = storesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Create and manage application logins, roles, and store scope. Reuses the same Supabase Auth login every user in this app already uses."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowCreate(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" /> Create User
            </Button>
            <Button variant="outline" onClick={() => setShowCreateRole(true)}>
              <ShieldPlus className="mr-1.5 h-4 w-4" /> Create Role
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {usersQuery.isLoading ? (
            <LoadingState />
          ) : users.length === 0 ? (
            <EmptyState icon={Users} title="No users yet" description="Create the first user above." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User Name</TableHead>
                    <TableHead>Employee Code</TableHead>
                    <TableHead>Email / Login ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created Date</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.fullName}</TableCell>
                      <TableCell>
                        {u.linkedEmployeeCode ? (
                          <span className="font-mono text-xs">{u.linkedEmployeeCode}</span>
                        ) : (
                          <Badge variant="outline" className="text-xs">Not linked</Badge>
                        )}
                      </TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>
                        <div className="text-sm">{USER_MANAGEMENT_ROLE_LABELS[u.effectiveRole]}</div>
                        {u.effectiveRole === "operations_manager" && u.operationsManagerStoreNames.length > 0 ? (
                          <div className="text-xs text-muted-foreground">{u.operationsManagerStoreNames.join(", ")}</div>
                        ) : null}
                        <BusinessRoleBadge userId={u.id} />
                      </TableCell>
                      <TableCell>{u.storeId ? u.storeName ?? "—" : "All Stores"}</TableCell>
                      <TableCell>
                        <Badge variant={u.isActive ? "default" : "secondary"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(u.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">Not available</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setEditUser(u)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setResetUser(u)}>
                            <KeyRound className="mr-1 h-3.5 w-3.5" /> Reset Password
                          </Button>
                          <SetActiveButton user={u} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog open={showCreate} onOpenChange={setShowCreate} companyId={companyId} stores={stores} />
      <EditUserDialog user={editUser} onOpenChange={(open) => !open && setEditUser(null)} stores={stores} companyId={companyId} />
      <ResetPasswordDialog user={resetUser} onOpenChange={(open) => !open && setResetUser(null)} />
      <CreateRoleDialog open={showCreateRole} onOpenChange={setShowCreateRole} companyId={companyId} />
    </div>
  );
}

function SetActiveButton({ user }: { user: ManagedUser }) {
  const setActive = useSetUserActive();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = async () => {
    try {
      await setActive.mutateAsync({ userId: user.id, isActive: !user.isActive });
      toast({ title: user.isActive ? "User deactivated." : "User activated.", variant: "success" });
      setConfirmOpen(false);
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <>
      <Button size="sm" variant={user.isActive ? "destructive" : "outline"} onClick={() => setConfirmOpen(true)}>
        {user.isActive ? "Deactivate" : "Activate"}
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{user.isActive ? "Deactivate User?" : "Activate User?"}</DialogTitle>
            <DialogDescription>
              {user.fullName} ({user.email}).
              {user.isActive
                ? " This immediately signs them out of the app and, if they hold Operations Manager / Super Manager approval authority, revokes it. Their historical records are preserved."
                : " This restores their login. Any previous Operations Manager / Super Manager approval authority is NOT automatically restored — assign it again via Night Duty Manager Access if needed."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={setActive.isPending}>
              Cancel
            </Button>
            <Button variant={user.isActive ? "destructive" : "default"} onClick={handleConfirm} disabled={setActive.isPending}>
              {setActive.isPending ? "Saving…" : user.isActive ? "Confirm Deactivate" : "Confirm Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Small secondary line under the System Role (spec §6/§42) showing the user's centralized Business
 * Role (dynamic_roles), if any — read-only here; edited from Edit User's "Business Role" field
 * below. Deliberately per-row (React Query dedupes/caches), matching the existing per-row badge
 * pattern already used elsewhere in this app (e.g. ReceiptStatusBadge).
 */
function BusinessRoleBadge({ userId }: { userId: string }) {
  const query = useUserDynamicRole(userId);
  if (query.isLoading || !query.data) return null;
  return <div className="text-xs text-muted-foreground">Business Role: {query.data.roleName}</div>;
}

function RoleSelect({ value, onChange, roles }: { value: UserManagementRole; onChange: (v: UserManagementRole) => void; roles: UserManagementRole[] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as UserManagementRole)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r} value={r}>
            {USER_MANAGEMENT_ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StoreSelect({ value, onChange, stores }: { value: string | null; onChange: (v: string | null) => void; stores: { id: string; name: string }[] }) {
  return (
    <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? null : v)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Stores</SelectItem>
        {stores.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  companyId,
  stores,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId?: string;
  stores: { id: string; name: string }[];
}) {
  const createUser = useCreateUser();
  const employeesQuery = useAssignableEmployees(companyId);
  const employees = employeesQuery.data ?? [];

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<UserManagementRole>("staff");
  const [storeId, setStoreId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const selectedEmployee = employees.find((e) => e.id === employeeId) ?? null;

  const reset = () => {
    setEmployeeId(null);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setRole("staff");
    setStoreId(null);
    setIsActive(true);
  };

  const handleEmployeeChange = (employee: AssignableEmployee) => {
    setEmployeeId(employee.id);
    // Prefill from the master employee record -- the admin is not asked to re-type what already
    // exists. Store scope defaults to the employee's own store; still editable below (e.g. to
    // grant an Operations Manager "All Stores" scope).
    setEmail(employee.email ?? "");
    setStoreId(employee.storeId);
  };

  const handleSave = async () => {
    if (!companyId) return;
    if (!employeeId || !selectedEmployee) return toast({ title: "Employee is required.", description: "Select an existing employee before creating a login.", variant: "destructive" });
    if (selectedEmployee.authUserId) return toast({ title: "This employee already has a user account.", description: selectedEmployee.email ?? undefined, variant: "destructive" });
    if (!email.trim()) return toast({ title: "Email / Login ID is required.", variant: "destructive" });
    if (password !== confirmPassword) return toast({ title: "Passwords do not match.", variant: "destructive" });
    if (password.length < 8) return toast({ title: "Password must be at least 8 characters.", variant: "destructive" });

    try {
      await createUser.mutateAsync({ employeeId, email: email.trim(), password, role, storeId, isActive });
      toast({ title: "User created successfully.", description: `${selectedEmployee.fullName} can now log in.`, variant: "success" });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not create user", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>Gives an existing employee a login. This never creates a new employee record.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            <EmployeeSearchSelect
              employees={employees}
              value={employeeId}
              onChange={handleEmployeeChange}
              disabled={employeesQuery.isLoading}
              placeholder={employeesQuery.isLoading ? "Loading employees…" : "Search by name, employee code, or store…"}
            />
          </div>

          {selectedEmployee ? (
            selectedEmployee.authUserId ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                This employee already has a user account{selectedEmployee.email ? ` (${selectedEmployee.email})` : ""}. Select a different employee, or use Edit User for the existing login.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/40 p-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Employee Code</div>
                  <div className="font-mono">{selectedEmployee.employeeCode ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Store</div>
                  <div>{selectedEmployee.storeName ?? "All Stores"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Employee Status</div>
                  <div className="capitalize">{selectedEmployee.status}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Existing Employee Email</div>
                  <div>{selectedEmployee.email ?? "None on file"}</div>
                </div>
              </div>
            )
          ) : null}

          <div className="space-y-1.5">
            <Label>Email / Login ID *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {selectedEmployee?.email ? <p className="text-xs text-muted-foreground">Prefilled from the employee's record. Edit only if this login should use a different address.</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Password *</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm Password *</Label>
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">At least 8 characters, with a letter and a number. The user must change it on first login.</p>
          <div className="space-y-1.5">
            <Label>Role *</Label>
            <RoleSelect value={role} onChange={setRole} roles={CREATABLE_ROLES} />
          </div>
          <div className="space-y-1.5">
            <Label>Store Scope</Label>
            <StoreSelect value={storeId} onChange={setStoreId} stores={stores} />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={isActive ? "active" : "inactive"} onValueChange={(v) => setIsActive(v === "active")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={createUser.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={createUser.isPending || !employeeId || Boolean(selectedEmployee?.authUserId)}>
            {createUser.isPending ? "Saving…" : "Save User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onOpenChange,
  stores,
  companyId,
}: {
  user: ManagedUser | null;
  onOpenChange: (open: boolean) => void;
  stores: { id: string; name: string }[];
  companyId?: string;
}) {
  const updateUser = useUpdateUser();
  const businessRoleQuery = useUserDynamicRole(user?.id);
  const setBusinessRole = useSetUserDynamicRole();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserManagementRole>("staff");
  const [storeId, setStoreId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [showRelink, setShowRelink] = useState(false);

  const handleBusinessRoleChange = async (roleId: string | null) => {
    if (!user) return;
    try {
      await setBusinessRole.mutateAsync({ userId: user.id, roleId });
      toast({ title: roleId ? "Business Role assigned." : "Business Role cleared.", variant: "success" });
    } catch (error) {
      toast({ title: "Could not update Business Role", description: describeRoleError(error), variant: "destructive" });
    }
  };

  // Re-seed local state whenever a different user is opened for editing.
  useEffect(() => {
    if (!user) return;
    setFullName(user.fullName);
    setEmail(user.email);
    setRole(user.effectiveRole);
    setStoreId(user.storeId);
    setIsActive(user.isActive);
  }, [user]);

  const handleClose = (next: boolean) => {
    onOpenChange(next);
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      // Full Name is only sent when this login has no linked employee -- once linked, the employee
      // record is the single source of truth for the name (see supabase/functions/user-account).
      const payload: Parameters<typeof updateUser.mutateAsync>[0] = { userId: user.id, email: email.trim(), role, storeId, isActive };
      if (!user.linkedEmployeeId) payload.fullName = fullName.trim();
      const result = await updateUser.mutateAsync(payload);
      if (result?.warning) {
        toast({ title: "User updated", description: result.warning, variant: "default" });
      } else {
        toast({ title: "User updated.", variant: "success" });
      }
      handleClose(false);
    } catch (error) {
      toast({ title: "Could not update user", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <>
      <Dialog open={Boolean(user)} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>{user ? `${user.fullName} (${user.email})` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Linked Employee</Label>
              {user?.linkedEmployeeId ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm">
                  <div>
                    <div className="font-medium">{user.fullName}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.linkedEmployeeCode ?? "No Code"} — {user.linkedEmployeeStoreName ?? "All Stores"}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShowRelink(true)}>
                    Relink Employee
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <span className="text-muted-foreground">Not linked to any employee.</span>
                  <Button size="sm" variant="outline" onClick={() => setShowRelink(true)}>
                    Link Employee
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Changing the linked employee is a separate, audited action — it never happens as a side effect of Save Changes below.
              </p>
            </div>

            {!user?.linkedEmployeeId ? (
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <RoleSelect value={role} onChange={setRole} roles={CREATABLE_ROLES} />
              {(role === "operations_manager" || role === "super_manager") && !user?.linkedEmployeeId ? (
                <p className="text-xs text-amber-600">This login has no linked employee yet — link one above before this role can grant real approval authority.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Business Role</Label>
              <RoleSelector
                companyId={companyId}
                value={businessRoleQuery.data?.dynamicRoleId ?? null}
                onChange={handleBusinessRoleChange}
                disabled={businessRoleQuery.isLoading || setBusinessRole.isPending}
              />
              <p className="text-xs text-muted-foreground">
                From the centralized Role Master (Settings → Permissions → Roles). Drives this user's effective permissions
                (Module/Tab/Action/Field), independent of the System Role above. Saves immediately.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Store Scope</Label>
              <StoreSelect value={storeId} onChange={setStoreId} stores={stores} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={isActive ? "active" : "inactive"} onValueChange={(v) => setIsActive(v === "active")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => handleClose(false)} disabled={updateUser.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updateUser.isPending}>
              {updateUser.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RelinkEmployeeDialog user={user} open={showRelink} onOpenChange={setShowRelink} companyId={companyId} />
    </>
  );
}

/**
 * The controlled "Relink Employee" operation — the ONLY supported way to change which employee a
 * login is linked to after creation. Explicit confirmation + duplicate protection (an
 * already-linked employee can't be picked) + old-employee unlink, all server-side in the
 * `relink_employee` action.
 */
function RelinkEmployeeDialog({
  user,
  open,
  onOpenChange,
  companyId,
}: {
  user: ManagedUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId?: string;
}) {
  const relinkEmployee = useRelinkEmployee();
  const employeesQuery = useAssignableEmployees(companyId);
  const employees = employeesQuery.data ?? [];
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setEmployeeId(user?.linkedEmployeeId ?? null);
  }, [open, user]);

  const selectedEmployee = employees.find((e) => e.id === employeeId) ?? null;

  const handleConfirm = async () => {
    if (!user || !employeeId) return;
    try {
      await relinkEmployee.mutateAsync({ userId: user.id, employeeId });
      toast({ title: "Employee relinked.", description: selectedEmployee ? `${user.fullName}'s login is now linked to ${selectedEmployee.fullName} (${selectedEmployee.employeeCode ?? "no code"}).` : undefined, variant: "success" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not relink employee", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Relink Employee</DialogTitle>
          <DialogDescription>
            {user ? `Change which employee ${user.email} is linked to.` : ""} The previously linked employee (if any) is unlinked and its Operations Manager / Super Manager approval authority is revoked — it is never left silently active.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            <EmployeeSearchSelect
              employees={employees}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.id)}
              allowAuthUserId={user?.id ?? null}
              disabled={employeesQuery.isLoading}
              placeholder={employeesQuery.isLoading ? "Loading employees…" : "Search by name, employee code, or store…"}
            />
          </div>
          {selectedEmployee ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Employee Code</div>
                <div className="font-mono">{selectedEmployee.employeeCode ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Store</div>
                <div>{selectedEmployee.storeName ?? "All Stores"}</div>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={relinkEmployee.isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={relinkEmployee.isPending || !employeeId}>
            {relinkEmployee.isPending ? "Relinking…" : "Confirm Relink"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onOpenChange }: { user: ManagedUser | null; onOpenChange: (open: boolean) => void }) {
  const resetPassword = useResetUserPassword();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleClose = (next: boolean) => {
    if (!next) {
      setPassword("");
      setConfirmPassword("");
    }
    onOpenChange(next);
  };

  const handleReset = async () => {
    if (!user) return;
    if (password !== confirmPassword) return toast({ title: "Passwords do not match.", variant: "destructive" });
    if (password.length < 8) return toast({ title: "Password must be at least 8 characters.", variant: "destructive" });
    try {
      await resetPassword.mutateAsync({ userId: user.id, password });
      toast({ title: "Password reset.", description: `${user.fullName} must sign in with the new password and will be prompted to change it.`, variant: "success" });
      handleClose(false);
    } catch (error) {
      toast({ title: "Could not reset password", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>{user ? `${user.fullName} (${user.email}). The user will be required to change this password on next login.` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm New Password</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => handleClose(false)} disabled={resetPassword.isPending}>
            Cancel
          </Button>
          <Button onClick={handleReset} disabled={resetPassword.isPending}>
            {resetPassword.isPending ? "Resetting…" : "Reset Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
