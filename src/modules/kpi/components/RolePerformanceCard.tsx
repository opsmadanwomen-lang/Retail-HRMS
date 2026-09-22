import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface RolePerformanceCardProps {
  roleName: string;
  score: number;
  kpiCount: number;
}

export function RolePerformanceCard({ roleName, score, kpiCount }: RolePerformanceCardProps) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium">{roleName}</p>
          <Badge variant="secondary">{kpiCount} KPI{kpiCount === 1 ? "" : "s"}</Badge>
        </div>
        <div className="flex items-end justify-between">
          <p className="text-2xl font-semibold">{score.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">out of 100</p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}
