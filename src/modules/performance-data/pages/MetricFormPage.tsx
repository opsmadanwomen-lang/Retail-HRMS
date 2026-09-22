import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  metricFormSchema,
  type MetricFormSchema,
  METRIC_CATEGORY_OPTIONS,
  MEASUREMENT_UNIT_OPTIONS,
  CALCULATION_TYPE_OPTIONS,
} from "../schema";
import { useCreateMetric, useMetric, useUpdateMetric } from "@/hooks/useMetrics";
import { metricMasterService } from "@/services/metricMasterService";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";

export function MetricFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: existingMetric, isLoading: isLoadingMetric } = useMetric(id);
  const createMetric = useCreateMetric();
  const updateMetric = useUpdateMetric();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MetricFormSchema>({
    resolver: zodResolver(metricFormSchema),
    defaultValues: {
      category: "custom",
      measurementUnit: "number",
      calculationType: "manual",
      isActive: true,
      displayOrder: 0,
    },
  });

  useEffect(() => {
    if (existingMetric) {
      reset({
        metricCode: existingMetric.metricCode,
        metricName: existingMetric.metricName,
        category: existingMetric.category,
        measurementUnit: existingMetric.measurementUnit as MetricFormSchema["measurementUnit"],
        calculationType: existingMetric.calculationType,
        isActive: existingMetric.isActive,
        displayOrder: existingMetric.displayOrder,
      });
    }
  }, [existingMetric, reset]);

  const onSubmit = async (values: MetricFormSchema) => {
    try {
      const codeTaken = await metricMasterService.isCodeTaken(values.metricCode, user?.companyId ?? null, id);
      if (codeTaken) {
        setError("metricCode", { message: "This metric code is already in use." });
        return;
      }

      if (isEditing && id) {
        await updateMetric.mutateAsync({ id, values, userId: user?.id });
        toast({ title: "Metric updated", variant: "success" });
      } else {
        await createMetric.mutateAsync({ values, companyId: user?.companyId ?? null, userId: user?.id });
        toast({ title: "Metric created", variant: "success" });
      }
      navigate(ROUTES.metrics);
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isEditing && isLoadingMetric) {
    return <p className="text-sm text-muted-foreground">Loading metric…</p>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.metrics}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Metrics
        </Link>
      </Button>

      <PageHeader
        title={isEditing ? "Edit Metric" : "New Metric"}
        description="Metrics are structured data points collected daily and mapped to roles, stores, and employees."
      />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                Metric Name <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. Daily Sale" {...register("metricName")} />
              {errors.metricName && <p className="text-xs text-destructive">{errors.metricName.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Metric Code <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. DAILY_SALE" {...register("metricCode")} disabled={existingMetric?.isSystemMetric} />
              {errors.metricCode && <p className="text-xs text-destructive">{errors.metricCode.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Category <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="category"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METRIC_CATEGORY_OPTIONS.map((cat) => (
                        <SelectItem key={cat} value={cat} className="capitalize">
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Measurement Unit <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="measurementUnit"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEASUREMENT_UNIT_OPTIONS.map((unit) => (
                        <SelectItem key={unit} value={unit} className="capitalize">
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Calculation Type <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="calculationType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CALCULATION_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type} className="capitalize">
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Display Order</Label>
              <Input type="number" min={0} {...register("displayOrder")} />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                name="isActive"
                control={control}
                render={({ field }) => (
                  <Select value={field.value ? "active" : "inactive"} onValueChange={(v) => field.onChange(v === "active")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(ROUTES.metrics)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Create Metric"}
          </Button>
        </div>
      </form>
    </div>
  );
}
