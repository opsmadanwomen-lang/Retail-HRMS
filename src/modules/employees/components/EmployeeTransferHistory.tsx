import { ArrowRight } from "lucide-react";
import { useEmployeeTransfers } from "@/hooks/useEmployeeTransfers";
import { formatDate } from "@/lib/utils";

export function EmployeeTransferHistory({ employeeId }: { employeeId: string }) {
  const { data: transfers, isLoading } = useEmployeeTransfers(employeeId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading transfer history…</p>;
  if (!transfers || transfers.length === 0) {
    return <p className="text-sm text-muted-foreground">No transfers recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {transfers.map((transfer) => (
        <div key={transfer.id} className="rounded-lg border p-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Store transfer</span>
            <ArrowRight className="h-3.5 w-3.5" />
            <span>{formatDate(transfer.transferDate)}</span>
          </div>
          {transfer.reason && <p className="mt-1">{transfer.reason}</p>}
        </div>
      ))}
    </div>
  );
}
