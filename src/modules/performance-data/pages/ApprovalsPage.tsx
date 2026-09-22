import { useState } from "react";
import { CheckSquare } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EntryStatusBadge } from "../components/StatusBadges";
import { ApprovalDialog } from "../components/ApprovalDialog";
import { usePerformanceEntries } from "@/hooks/usePerformanceEntries";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";
import type { PerformanceEntry } from "@/types/performance";

export function ApprovalsPage() {
  const { user } = useAuth();
  const [reviewingEntry, setReviewingEntry] = useState<PerformanceEntry | null>(null);

  const { data: entries, isLoading } = usePerformanceEntries({
    companyId: user?.companyId ?? undefined,
    status: "submitted",
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Approvals" description="Entry → Verifier → Approved → Locked. Review pending entries below." />

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !entries || entries.length === 0 ? (
            <EmptyState
              icon={CheckSquare}
              title="Nothing pending"
              description="All caught up — no entries are waiting for review."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead>Employee / Store</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[1%] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(entry.entryDate)}</TableCell>
                    <TableCell className="font-medium">{entry.metricName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{entry.employeeName ?? entry.storeName}</TableCell>
                    <TableCell className="font-medium">
                      {entry.entryValue} <span className="text-xs text-muted-foreground">{entry.measurementUnit}</span>
                    </TableCell>
                    <TableCell>
                      <EntryStatusBadge status={entry.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setReviewingEntry(entry)}>
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ApprovalDialog entry={reviewingEntry} onOpenChange={(open) => !open && setReviewingEntry(null)} />
    </div>
  );
}
