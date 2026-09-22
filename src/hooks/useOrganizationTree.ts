import { useQuery } from "@tanstack/react-query";
import { organizationService } from "@/services/organizationService";

export function useOrganizationTree(storeId?: string) {
  return useQuery({
    queryKey: ["organization-tree", storeId],
    queryFn: () => organizationService.getTreeForStore(storeId as string),
    enabled: Boolean(storeId),
  });
}
