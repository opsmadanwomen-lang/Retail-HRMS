import { TrendingUp } from "lucide-react";
import { useEmployeePromotions } from "@/hooks/useEmployeePromotions";
import { formatDate } from "@/lib/utils";

export function EmployeePromotionHistory({ employeeId }: { employeeId: string }) {
  const { data: promotions, isLoading } = useEmployeePromotions(employeeId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading promotion history…</p>;
  if (!promotions || promotions.length === 0) {
    return <p className="text-sm text-muted-foreground">No promotions recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {promotions.map((promotion) => (
        <div key={promotion.id} className="rounded-lg border p-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Promotion</span>
            <span>· {formatDate(promotion.promotionDate)}</span>
          </div>
          {promotion.remarks && <p className="mt-1">{promotion.remarks}</p>}
        </div>
      ))}
    </div>
  );
}
