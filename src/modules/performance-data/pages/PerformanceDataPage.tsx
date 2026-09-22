import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { MetricMappingList } from "../components/MetricMappingList";
import { AddMetricMappingDialog } from "../components/AddMetricMappingDialog";
import { useMetricMappings, useRemoveMetricMapping } from "@/hooks/useMetricMapping";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { MetricMapping } from "@/types/performance";

export function PerformanceDataPage() {
  const { user } = useAuth();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [mappingToRemove, setMappingToRemove] = useState<MetricMapping | null>(null);

  const { data: mappings, isLoading } = useMetricMappings({ companyId: user?.companyId ?? undefined });
  const removeMapping = useRemoveMetricMapping();

  const handleRemove = async () => {
    if (!mappingToRemove) return;
    try {
      await removeMapping.mutateAsync(mappingToRemove.id);
      toast({ title: "Mapping removed", variant: "success" });
      setMappingToRemove(null);
    } catch (error) {
      toast({
        title: "Could not remove mapping",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.metrics}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Metrics
        </Link>
      </Button>

      <PageHeader
        title="Performance Data"
        description="Scope which metrics apply to which role, department, store, or employee."
        actions={
          <Button onClick={() => setIsAddOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Map a Metric
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Metric Mappings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <MetricMappingList mappings={mappings ?? []} onRemove={setMappingToRemove} />
          )}
        </CardContent>
      </Card>

      <AddMetricMappingDialog open={isAddOpen} onOpenChange={setIsAddOpen} />

      <ConfirmDialog
        open={Boolean(mappingToRemove)}
        onOpenChange={(open) => !open && setMappingToRemove(null)}
        title="Remove this mapping?"
        description={`"${mappingToRemove?.metricName}" will no longer be scoped to this selection.`}
        confirmLabel="Remove"
        variant="destructive"
        isLoading={removeMapping.isPending}
        onConfirm={handleRemove}
      />
    </div>
  );
}
