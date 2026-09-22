import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { DailyEntryForm } from "../components/DailyEntryForm";
import { BulkEntryForm } from "../components/BulkEntryForm";
import { EntryTable } from "../components/EntryTable";
import { EntryFilters, EntrySearchBar } from "../components/EntryFilters";
import { usePerformanceEntries, useDeletePerformanceEntry } from "@/hooks/usePerformanceEntries";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { PerformanceEntry, PerformanceEntryFilters as EntryFiltersValue } from "@/types/performance";

export function DailyEntryPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<EntryFiltersValue>({});
  const [search, setSearch] = useState("");
  const [entryToDelete, setEntryToDelete] = useState<PerformanceEntry | null>(null);

  const effectiveFilters = useMemo<EntryFiltersValue>(
    () => ({ ...filters, companyId: user?.companyId ?? undefined, search: search || undefined }),
    [filters, search, user?.companyId]
  );

  const { data: entries, isLoading } = usePerformanceEntries(effectiveFilters);
  const deleteEntry = useDeletePerformanceEntry();

  const handleDelete = async () => {
    if (!entryToDelete) return;
    try {
      await deleteEntry.mutateAsync(entryToDelete.id);
      toast({ title: "Entry deleted", variant: "success" });
      setEntryToDelete(null);
    } catch (error) {
      toast({
        title: "Could not delete entry",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.performanceDashboard}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Performance Dashboard
        </Link>
      </Button>

      <PageHeader title="Daily Entry" description="Record operational data — manually, one at a time, or in bulk." />

      <Tabs defaultValue="manual">
        <TabsList>
          <TabsTrigger value="manual">Manual Entry</TabsTrigger>
          <TabsTrigger value="bulk">Bulk Entry</TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
          <DailyEntryForm />
        </TabsContent>
        <TabsContent value="bulk">
          <BulkEntryForm />
        </TabsContent>
      </Tabs>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-semibold tracking-tight">Recent Entries</h2>
          <EntrySearchBar value={search} onChange={setSearch} />
          <EntryFilters value={filters} onChange={setFilters} />

          {isLoading ? (
            <LoadingState />
          ) : !entries || entries.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No entries found"
              description="Record your first entry above, or adjust your filters."
            />
          ) : (
            <EntryTable entries={entries} onDelete={setEntryToDelete} />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(entryToDelete)}
        onOpenChange={(open) => !open && setEntryToDelete(null)}
        title="Delete this entry?"
        description="This cannot be undone. Locked (approved) entries cannot be deleted."
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteEntry.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
