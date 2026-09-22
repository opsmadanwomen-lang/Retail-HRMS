import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StoreMetrics } from "@/modules/performance-data/components/StoreMetrics";
import { STORE_STATUS_OPTIONS, storeFormSchema, type StoreFormSchema } from "../schema";
import { useCompanies } from "@/hooks/useCompanies";
import { useCreateStore, useStore, useUpdateStore } from "@/hooks/useStores";
import { storeService } from "@/services/storeService";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";

export function StoreFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const { data: companies, isLoading: isLoadingCompanies } = useCompanies();
  const { data: existingStore, isLoading: isLoadingStore } = useStore(id);
  const createStore = useCreateStore();
  const updateStore = useUpdateStore();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<StoreFormSchema>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: { status: "onboarding" },
  });

  useEffect(() => {
    if (existingStore) {
      reset({
        companyId: existingStore.companyId,
        name: existingStore.name,
        code: existingStore.code,
        storeType: existingStore.storeType ?? "",
        address: existingStore.address ?? "",
        city: existingStore.city ?? "",
        state: existingStore.state ?? "",
        country: existingStore.country ?? "",
        gstNumber: existingStore.gstNumber ?? "",
        phone: existingStore.phone ?? "",
        email: existingStore.email ?? "",
        status: existingStore.status,
      });
    }
  }, [existingStore, reset]);

  const onSubmit = async (values: StoreFormSchema) => {
    try {
      const codeTaken = await storeService.isCodeTaken(values.companyId, values.code, id);
      if (codeTaken) {
        setError("code", { message: "This store code is already used by another store in this company." });
        return;
      }

      const { companyId, ...storeValues } = values;

      if (isEditing && id) {
        await updateStore.mutateAsync({ id, values: storeValues });
        toast({ title: "Store updated", variant: "success" });
      } else {
        await createStore.mutateAsync({ companyId, values: storeValues });
        toast({
          title: "Store created",
          description: "Organization structure has been provisioned automatically.",
          variant: "success",
        });
      }
      navigate(ROUTES.stores);
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isEditing && isLoadingStore) {
    return <p className="text-sm text-muted-foreground">Loading store…</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEditing ? "Edit Store" : "Create Store"}
        description="On save, the complete Master Organization Template is copied into this store automatically — no manual setup required."
      />

      <Card>
        <CardContent className="p-6">
          <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="companyId">
                Company <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="companyId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={isEditing || isLoadingCompanies}>
                    <SelectTrigger id="companyId">
                      <SelectValue placeholder="Select a company" />
                    </SelectTrigger>
                    <SelectContent>
                      {(companies ?? []).map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.companyId && <p className="text-xs text-destructive">{errors.companyId.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="name">
                Store Name <span className="text-destructive">*</span>
              </Label>
              <Input id="name" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="code">
                Store Code <span className="text-destructive">*</span>
              </Label>
              <Input id="code" placeholder="e.g. DEL-01" {...register("code")} />
              {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="storeType">Store Type</Label>
              <Input id="storeType" placeholder="e.g. Flagship, Outlet" {...register("storeType")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="status">Store Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STORE_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status} value={status} className="capitalize">
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" {...register("address")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" {...register("city")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="state">State</Label>
              <Input id="state" {...register("state")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="country">Country</Label>
              <Input id="country" {...register("country")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gstNumber">GST Number</Label>
              <Input id="gstNumber" {...register("gstNumber")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register("phone")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => navigate(ROUTES.stores)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? "Save changes" : "Save & Provision Store"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isEditing && id && (
        <Card>
          <CardHeader>
            <CardTitle>Store Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <StoreMetrics storeId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
