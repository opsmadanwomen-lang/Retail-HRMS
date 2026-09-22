import { useNavigate, useParams } from "react-router-dom";
import { Network } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OrganizationTree } from "../components/OrganizationTree";
import { useStores } from "@/hooks/useStores";
import { useOrganizationTree } from "@/hooks/useOrganizationTree";

export function OrganizationPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const { data: stores, isLoading: storesLoading } = useStores();
  const { data: tree, isLoading: treeLoading } = useOrganizationTree(storeId);

  const selectedStore = stores?.find((s) => s.id === storeId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization"
        description="The full Team → Department → Designation structure, provisioned automatically for every store."
        actions={
          <div className="w-56">
            <Select value={storeId} onValueChange={(value) => navigate(`/organization/${value}`)}>
              <SelectTrigger>
                <SelectValue placeholder={storesLoading ? "Loading stores…" : "Select a store"} />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <Card>
        <CardContent className="p-4">
          {!storeId ? (
            <EmptyState
              icon={Network}
              title="Select a store"
              description="Choose a store above to view its organization tree."
            />
          ) : treeLoading ? (
            <LoadingState rows={6} />
          ) : !tree || tree.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No organization structure found"
              description="This store may not have finished provisioning yet."
            />
          ) : (
            <OrganizationTree storeName={selectedStore?.name ?? "Store"} teams={tree} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
