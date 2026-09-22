import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storeService } from "@/services/storeService";
import type { StoreFormValues } from "@/types/store";

const STORES_KEY = ["stores"] as const;

export function useStores(companyId?: string) {
  return useQuery({
    queryKey: [...STORES_KEY, companyId ?? "all"],
    queryFn: () => storeService.list(companyId),
  });
}

export function useStore(id?: string) {
  return useQuery({
    queryKey: [...STORES_KEY, "detail", id],
    queryFn: () => storeService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, values }: { companyId: string; values: StoreFormValues }) =>
      storeService.create(companyId, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STORES_KEY }),
  });
}

export function useUpdateStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<StoreFormValues> }) => storeService.update(id, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STORES_KEY }),
  });
}

export function useDeleteStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storeService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STORES_KEY }),
  });
}
