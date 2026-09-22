import { useState } from "react";
import { Link } from "react-router-dom";
import { Store as StoreIcon, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StoreTable } from "../components/StoreTable";
import { useDeleteStore, useStores } from "@/hooks/useStores";
import { toast } from "@/components/ui/use-toast";
import type { Store } from "@/types/store";

export function StoresPage() {
  const { data: stores, isLoading } = useStores();
  const deleteStore = useDeleteStore();
  const [storeToDelete, setStoreToDelete] = useState<Store | null>(null);

  const handleDelete = async () => {
    if (!storeToDelete) return;
    try {
      await deleteStore.mutateAsync(storeToDelete.id);
      toast({ title: "Store deleted", description: `${storeToDelete.name} was removed.`, variant: "success" });
      setStoreToDelete(null);
    } catch (error) {
      toast({
        title: "Could not delete store",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stores"
        description="Every store automatically receives the full Master Organization structure."
        actions={
          <Button asChild>
            <Link to="/stores/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Store
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !stores || stores.length === 0 ? (
            <EmptyState
              icon={StoreIcon}
              title="No stores yet"
              description="Create your first store — teams, departments, and designations provision automatically."
              action={
                <Button asChild size="sm">
                  <Link to="/stores/new">Create a store</Link>
                </Button>
              }
            />
          ) : (
            <StoreTable stores={stores} onDelete={setStoreToDelete} />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(storeToDelete)}
        onOpenChange={(open) => !open && setStoreToDelete(null)}
        title="Delete this store?"
        description={`This will permanently remove "${storeToDelete?.name}" and its entire organization structure.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteStore.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
