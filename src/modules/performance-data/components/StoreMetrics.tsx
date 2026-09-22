import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EntryTable } from "@/modules/performance-data/components/EntryTable";
import { usePerformanceEntries } from "@/hooks/usePerformanceEntries";
import { ROUTES } from "@/constants/routes";

export function StoreMetrics({ storeId }: { storeId: string }) {
  const { data: entries, isLoading } = usePerformanceEntries({ storeId });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-3">
      {!entries || entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No performance entries recorded for this store yet.</p>
      ) : (
        <EntryTable entries={entries.slice(0, 10)} />
      )}
      <Button variant="outline" size="sm" asChild>
        <Link to={ROUTES.dailyEntry}>Record an Entry</Link>
      </Button>
    </div>
  );
}
