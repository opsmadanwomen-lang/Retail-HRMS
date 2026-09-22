import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { WeightageEditor } from "../components/WeightageEditor";
import { AddKpiToRoleDialog } from "../components/AddKpiToRoleDialog";
import { useRoles } from "@/hooks/useRoles";
import { useRoleKpiMappings, useRemoveKpiFromRole, useSaveWeightageBatch } from "@/hooks/useRoleKpi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { RoleKpiMapping } from "@/types/kpi";

export function RoleKpiPage() {
  const { user } = useAuth();
  const [roleId, setRoleId] = useState<string>("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [mappingToRemove, setMappingToRemove] = useState<RoleKpiMapping | null>(null);

  const { data: roles } = useRoles({ companyId: user?.companyId ?? undefined, isActive: true });
  const selectedRole = (roles ?? []).find((r) => r.id === roleId);
  const { data: mappings, isLoading } = useRoleKpiMappings(roleId || undefined);
  const removeFromRole = useRemoveKpiFromRole();
  const saveWeightages = useSaveWeightageBatch();

  const handleSave = async (entries: Array<{ roleKpiMappingId: string; weightage: number }>) => {
    try {
      await saveWeightages.mutateAsync({ roleId, entries, companyId: selectedRole?.companyId ?? null, userId: user?.id });
      toast({ title: "Weightages saved", variant: "success" });
    } catch (error) {
      toast({
        title: "Could not save weightages",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleRemove = async () => {
    if (!mappingToRemove) return;
    try {
      await removeFromRole.mutateAsync({ mappingId: mappingToRemove.id, roleId });
      toast({ title: "KPI unmapped", variant: "success" });
      setMappingToRemove(null);
    } catch (error) {
      toast({
        title: "Could not remove KPI",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.kpi}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to KPI Master
        </Link>
      </Button>

      <PageHeader
        title="Role KPI"
        description="Assign KPIs to a role and set the weightage each one carries toward that role's overall score."
      />

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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Assigned KPIs</CardTitle>
            <Button size="sm" onClick={() => setIsAddOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add KPI
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <WeightageEditor
                mappings={mappings ?? []}
                onSave={handleSave}
                onRemove={setMappingToRemove}
                isSaving={saveWeightages.isPending}
              />
            )}
          </CardContent>
        </Card>
      )}

      {roleId && (
        <AddKpiToRoleDialog
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
        title="Remove this KPI from the role?"
        description={`"${mappingToRemove?.kpiName}" will no longer be part of this role's scoring.`}
        confirmLabel="Remove"
        variant="destructive"
        isLoading={removeFromRole.isPending}
        onConfirm={handleRemove}
      />
    </div>
  );
}
