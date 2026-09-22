import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Gauge, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MetricTable } from "../components/MetricTable";
import { MetricFilters, MetricSearchBar } from "../components/MetricFilters";
import { useDeleteMetric, useMetrics } from "@/hooks/useMetrics";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { Metric, MetricFilters as MetricFiltersValue } from "@/types/performance";

export function MetricsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<MetricFiltersValue>({});
  const [search, setSearch] = useState("");
  const [metricToDelete, setMetricToDelete] = useState<Metric | null>(null);

  const effectiveFilters = useMemo<MetricFiltersValue>(
    () => ({ ...filters, companyId: user?.companyId ?? undefined, search: search || undefined }),
    [filters, search, user?.companyId]
  );

  const { data: metrics, isLoading } = useMetrics(effectiveFilters);
  const deleteMetric = useDeleteMetric();

  const handleDelete = async () => {
    if (!metricToDelete) return;
    try {
      await deleteMetric.mutateAsync(metricToDelete.id);
      toast({ title: "Metric deleted", description: `${metricToDelete.metricName} was removed.`, variant: "success" });
      setMetricToDelete(null);
    } catch (error) {
      toast({
        title: "Could not delete metric",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metrics"
        description="Every metric available for data collection, mapping, and future performance calculation."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={ROUTES.performanceData}>Metric Mapping</Link>
            </Button>
            <Button asChild>
              <Link to={ROUTES.metricNew}>
                <PlusCircle className="mr-2 h-4 w-4" />
                New Metric
              </Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-6">
          <MetricSearchBar value={search} onChange={setSearch} />
          <MetricFilters value={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !metrics || metrics.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title="No metrics found"
              description="Create a custom metric, or adjust your filters."
              action={
                <Button asChild size="sm">
                  <Link to={ROUTES.metricNew}>Create a metric</Link>
                </Button>
              }
            />
          ) : (
            <MetricTable
              metrics={metrics}
              onEdit={(metric) => navigate(`/performance-data/metrics/${metric.id}/edit`)}
              onDelete={setMetricToDelete}
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(metricToDelete)}
        onOpenChange={(open) => !open && setMetricToDelete(null)}
        title="Delete this metric?"
        description={`This will permanently remove "${metricToDelete?.metricName}". Existing entries and history are preserved.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteMetric.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
