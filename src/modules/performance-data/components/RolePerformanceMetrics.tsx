import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMetricMappings } from "@/hooks/useMetricMapping";
import { ROUTES } from "@/constants/routes";

export function RolePerformanceMetrics({ roleId }: { roleId: string }) {
  const { data: mappings, isLoading } = useMetricMappings({ roleId });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-3">
      {!mappings || mappings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No metrics mapped to this role yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {mappings.map((mapping) => (
            <Badge key={mapping.id} variant="secondary">
              {mapping.metricName}
            </Badge>
          ))}
        </div>
      )}
      <Button variant="outline" size="sm" asChild>
        <Link to={ROUTES.performanceData}>Manage Metric Mapping</Link>
      </Button>
    </div>
  );
}
