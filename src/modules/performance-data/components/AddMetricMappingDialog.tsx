import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { metricMappingFormSchema, type MetricMappingFormSchema } from "../schema";
import { useMetrics } from "@/hooks/useMetrics";
import { useRoles } from "@/hooks/useRoles";
import { useStores } from "@/hooks/useStores";
import { useEmployees } from "@/hooks/useEmployees";
import { useCreateMetricMapping } from "@/hooks/useMetricMapping";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

interface AddMetricMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMetricMappingDialog({ open, onOpenChange }: AddMetricMappingDialogProps) {
  const { user } = useAuth();
  const { data: metrics } = useMetrics({ companyId: user?.companyId ?? undefined, isActive: true });
  const { data: roles } = useRoles({ companyId: user?.companyId ?? undefined });
  const { data: stores } = useStores();
  const { data: employees } = useEmployees({ companyId: user?.companyId ?? undefined });
  const createMapping = useCreateMetricMapping();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MetricMappingFormSchema>({
    resolver: zodResolver(metricMappingFormSchema),
  });

  const onSubmit = async (values: MetricMappingFormSchema) => {
    try {
      await createMapping.mutateAsync({ values, companyId: user?.companyId ?? null, userId: user?.id });
      toast({ title: "Mapping created", variant: "success" });
      reset({});
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not create mapping",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Map a Metric</DialogTitle>
          <DialogDescription>Scope a metric to a role, store, and/or employee.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Metric <span className="text-destructive">*</span>
            </Label>
            <Controller
              name="metricId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a metric" />
                  </SelectTrigger>
                  <SelectContent>
                    {(metrics ?? []).map((metric) => (
                      <SelectItem key={metric.id} value={metric.id}>
                        {metric.metricName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.metricId && <p className="text-xs text-destructive">{errors.metricId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Role</Label>
            <Controller
              name="roleId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {(roles ?? []).map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.roleName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Store</Label>
            <Controller
              name="storeId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {(stores ?? []).map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Employee (optional)</Label>
            <Controller
              name="employeeId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {(employees ?? []).map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {errors.roleId && <p className="text-xs text-destructive">{errors.roleId.message}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Create Mapping"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
