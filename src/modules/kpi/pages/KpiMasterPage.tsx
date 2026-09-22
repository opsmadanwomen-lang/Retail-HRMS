import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Target, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiTable } from "../components/KpiTable";
import { KpiFilters } from "../components/KpiFilters";
import { KpiSearchBar } from "../components/KpiSearchBar";
import { useDeleteKpi, useKpis } from "@/hooks/useKpis";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { Kpi, KpiFilters as KpiFiltersValue } from "@/types/kpi";

export function KpiMasterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<KpiFiltersValue>({});
  const [search, setSearch] = useState("");
  const [kpiToDelete, setKpiToDelete] = useState<Kpi | null>(null);

  const effectiveFilters = useMemo<KpiFiltersValue>(
    () => ({ ...filters, companyId: user?.companyId ?? undefined, search: search || undefined }),
    [filters, search, user?.companyId]
  );

  const { data: kpis, isLoading } = useKpis(effectiveFilters);
  const deleteKpi = useDeleteKpi();

  const handleDelete = async () => {
    if (!kpiToDelete) return;
    try {
      await deleteKpi.mutateAsync(kpiToDelete.id);
      toast({ title: "KPI deleted", description: `${kpiToDelete.kpiName} was removed.`, variant: "success" });
      setKpiToDelete(null);
    } catch (error) {
      toast({
        title: "Could not delete KPI",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="KPI Master"
        description="Every measurable KPI available to map onto roles and employees."
        actions={
          <Button asChild>
            <Link to={ROUTES.kpiNew}>
              <PlusCircle className="mr-2 h-4 w-4" />
              New KPI
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-6">
          <KpiSearchBar value={search} onChange={setSearch} />
          <KpiFilters value={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !kpis || kpis.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No KPIs found"
              description="Create a custom KPI, or adjust your filters."
              action={
                <Button asChild size="sm">
                  <Link to={ROUTES.kpiNew}>Create a KPI</Link>
                </Button>
              }
            />
          ) : (
            <KpiTable kpis={kpis} onEdit={(kpi) => navigate(`/kpi/${kpi.id}/edit`)} onDelete={setKpiToDelete} />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(kpiToDelete)}
        onOpenChange={(open) => !open && setKpiToDelete(null)}
        title="Delete this KPI?"
        description={`This will permanently remove "${kpiToDelete?.kpiName}". Existing results and history are preserved.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteKpi.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
