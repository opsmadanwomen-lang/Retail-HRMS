import { supabase } from "@/lib/supabaseClient";
import type { OrganizationTeamNode } from "@/types/organization";

export const organizationService = {
  /**
   * Calls the `get_store_organization_tree` Postgres function, which
   * assembles the full Team -> Department -> Designation -> employee-count
   * tree for a store in a single round trip.
   */
  async getTreeForStore(storeId: string): Promise<OrganizationTeamNode[]> {
    const { data, error } = await supabase.rpc("get_store_organization_tree", {
      p_store_id: storeId,
    });

    if (error) throw error;
    return (data as unknown as OrganizationTeamNode[]) ?? [];
  },
};
