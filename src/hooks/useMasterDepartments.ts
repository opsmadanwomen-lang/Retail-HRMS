import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";

export interface MasterDepartmentOption {
  id: string;
  name: string;
}

export function useMasterDepartments() {
  return useQuery({
    queryKey: ["master-departments"],
    queryFn: async (): Promise<MasterDepartmentOption[]> => {
      const { data, error } = await supabase
        .from("master_departments")
        .select("id, name")
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as MasterDepartmentOption[];
    },
  });
}
