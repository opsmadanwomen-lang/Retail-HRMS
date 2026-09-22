import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RoleTaskList } from "../components/RoleTaskList";
import { AddTaskToRoleDialog } from "../components/AddTaskToRoleDialog";
import { useRoles } from "@/hooks/useRoles";
import { useRoleTaskMappings, useRemoveTaskFromRole } from "@/hooks/useRoleTask";
import { useTaskAssignments } from "@/hooks/useEmployeeTask";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { RoleTaskMapping } from "@/types/task";

export function RoleTaskPage() {
  const { user } = useAuth();
  const [roleId, setRoleId] = useState<string>("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [mappingToRemove, setMappingToRemove] = useState<RoleTaskMapping | null>(null);

  const { data: roles } = useRoles({ companyId: user?.companyId ?? undefined, isActive: true });
  const selectedRole = (roles ?? []).find((r) => r.id === roleId);
  const { data: mappings, isLoading } = useRoleTaskMappings(roleId || undefined);
  const { data: assignments } = useTaskAssignments({ companyId: user?.companyId ?? undefined, roleId: roleId || undefined });
  const removeFromRole = useRemoveTaskFromRole();

  const stats = useMemo(() => {
    const rows = assignments ?? [];
    return {
      assigned: rows.length,
      pending: rows.filter((a) => a.statusCode === "pending" || a.statusCode === "in_progress").length,
      completed: rows.filter((a) => a.statusCode === "completed" || a.statusCode === "verified").length,
    };
  }, [assignments]);

  const handleRemove = async () => {
    if (!mappingToRemove) return;
    try {
      await removeFromRole.mutateAsync({ mappingId: mappingToRemove.id, roleId });
      toast({ title: "Task unmapped", variant: "success" });
      setMappingToRemove(null);
    } catch (error) {
      toast({
        title: "Could not remove task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.tasks}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Task Master
        </Link>
      </Button>

      <PageHeader title="Role Task Mapping" description="Assign tasks to a role — every employee holding it inherits them." />

      <Card>
        <CardHeader>
          <CardTitle>Select Role</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Choose a role" />
            </SelectTrigger>
            <SelectContent>
              {(roles ?? []).map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.roleName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {roleId && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Assigned Tasks</p>
                <p className="text-2xl font-semibold">{stats.assigned}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Pending Tasks</p>
                <p className="text-2xl font-semibold">{stats.pending}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Completed Tasks</p>
                <p className="text-2xl font-semibold">{stats.completed}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Mapped Tasks</CardTitle>
              <Button size="sm" onClick={() => setIsAddOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Task
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <RoleTaskList mappings={mappings ?? []} onRemove={setMappingToRemove} />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {roleId && (
        <AddTaskToRoleDialog
          open={isAddOpen}
          onOpenChange={setIsAddOpen}
          roleId={roleId}
          companyId={selectedRole?.companyId ?? null}
          existingMappings={mappings ?? []}
        />
      )}

      <ConfirmDialog
        open={Boolean(mappingToRemove)}
        onOpenChange={(open) => !open && setMappingToRemove(null)}
        title="Remove this task from the role?"
        description={`"${mappingToRemove?.taskName}" will no longer be assignable through this role.`}
        confirmLabel="Remove"
        variant="destructive"
        isLoading={removeFromRole.isPending}
        onConfirm={handleRemove}
      />
    </div>
  );
}
