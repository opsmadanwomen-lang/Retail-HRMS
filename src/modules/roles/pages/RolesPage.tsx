import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, PlusCircle, UserCog } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RoleTable } from "../components/RoleTable";
import { RoleFilters } from "../components/RoleFilters";
import { RoleSearchBar } from "../components/RoleSearchBar";
import { useDeleteRole, useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { Role, RoleFilters as RoleFiltersValue } from "@/types/role";

export function RolesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<RoleFiltersValue>({});
  const [search, setSearch] = useState("");
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);

  const effectiveFilters = useMemo<RoleFiltersValue>(
    () => ({ ...filters, companyId: user?.companyId ?? undefined, search: search || undefined }),
    [filters, search, user?.companyId]
  );

  const { data: roles, isLoading } = useRoles(effectiveFilters);
  const deleteRole = useDeleteRole();

  const handleDelete = async () => {
    if (!roleToDelete) return;
    try {
      await deleteRole.mutateAsync(roleToDelete.id);
      toast({ title: "Role deleted", description: `${roleToDelete.roleName} was removed.`, variant: "success" });
      setRoleToDelete(null);
    } catch (error) {
      toast({
        title: "Could not delete role",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role Master"
        description="Additional responsibilities employees can hold alongside their primary designation."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={ROUTES.roleAssignment}>
                <UserCog className="mr-2 h-4 w-4" />
                Assign Role
              </Link>
            </Button>
            <Button asChild>
              <Link to={ROUTES.roleNew}>
                <PlusCircle className="mr-2 h-4 w-4" />
                New Role
              </Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-6">
          <RoleSearchBar value={search} onChange={setSearch} />
          <RoleFilters value={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !roles || roles.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No roles found"
              description="Create a custom role, or adjust your filters."
              action={
                <Button asChild size="sm">
                  <Link to={ROUTES.roleNew}>Create a role</Link>
                </Button>
              }
            />
          ) : (
            <RoleTable
              roles={roles}
              onEdit={(role) => navigate(`/roles/${role.id}/edit`)}
              onDelete={setRoleToDelete}
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(roleToDelete)}
        onOpenChange={(open) => !open && setRoleToDelete(null)}
        title="Delete this role?"
        description={`This will permanently remove "${roleToDelete?.roleName}". Existing assignment history is preserved.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteRole.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
