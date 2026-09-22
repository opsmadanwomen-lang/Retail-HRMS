import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { companyService } from "@/services/companyService";
import type { CompanyFormValues } from "@/types/company";

const COMPANIES_KEY = ["companies"] as const;

export function useCompanies() {
  return useQuery({ queryKey: COMPANIES_KEY, queryFn: companyService.list });
}

export function useCompany(id?: string) {
  return useQuery({
    queryKey: [...COMPANIES_KEY, id],
    queryFn: () => companyService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CompanyFormValues) => companyService.create(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMPANIES_KEY }),
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<CompanyFormValues> }) =>
      companyService.update(id, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMPANIES_KEY }),
  });
}

export function useDeleteCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => companyService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMPANIES_KEY }),
  });
}
