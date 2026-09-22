import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  kpiFormSchema,
  type KpiFormSchema,
  CALCULATION_TYPE_OPTIONS,
  TARGET_TYPE_OPTIONS,
  MEASUREMENT_UNIT_OPTIONS,
  FORMULA_TYPE_OPTIONS,
} from "../schema";
import { useCreateKpi, useKpi, useUpdateKpi } from "@/hooks/useKpis";
import { useKpiCategories } from "@/hooks/useKpiCategories";
import { kpiMasterService } from "@/services/kpiMasterService";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";

export function KpiFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: categories } = useKpiCategories();
  const { data: existingKpi, isLoading: isLoadingKpi } = useKpi(id);
  const createKpi = useCreateKpi();
  const updateKpi = useUpdateKpi();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<KpiFormSchema>({
    resolver: zodResolver(kpiFormSchema),
    defaultValues: {
      calculationType: "manual",
      targetType: "monthly",
      measurementUnit: "percentage",
      formulaType: "percentage_based",
      dataSource: "Manual Entry",
      isActive: true,
      displayOrder: 0,
    },
  });

  useEffect(() => {
    if (existingKpi) {
      reset({
        kpiCode: existingKpi.kpiCode,
        kpiName: existingKpi.kpiName,
        categoryId: existingKpi.categoryId ?? undefined,
        description: existingKpi.description ?? "",
        calculationType: existingKpi.calculationType,
        targetType: existingKpi.targetType,
        measurementUnit: existingKpi.measurementUnit,
        dataSource: existingKpi.dataSource,
        formulaType: existingKpi.formulaType,
        isActive: existingKpi.isActive,
        displayOrder: existingKpi.displayOrder,
      });
    }
  }, [existingKpi, reset]);

  const onSubmit = async (values: KpiFormSchema) => {
    try {
      const codeTaken = await kpiMasterService.isCodeTaken(values.kpiCode, user?.companyId ?? null, id);
      if (codeTaken) {
        setError("kpiCode", { message: "This KPI code is already in use." });
        return;
      }

      if (isEditing && id) {
        await updateKpi.mutateAsync({ id, values, userId: user?.id });
        toast({ title: "KPI updated", variant: "success" });
      } else {
        await createKpi.mutateAsync({ values, companyId: user?.companyId ?? null, userId: user?.id });
        toast({ title: "KPI created", variant: "success" });
      }
      navigate(ROUTES.kpi);
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isEditing && isLoadingKpi) {
    return <p className="text-sm text-muted-foreground">Loading KPI…</p>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.kpi}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to KPI Master
        </Link>
      </Button>

      <PageHeader
        title={isEditing ? "Edit KPI" : "New KPI"}
        description="Define a measurable KPI that can be mapped onto roles and employees."
      />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                KPI Name <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. Department Sale" {...register("kpiName")} />
              {errors.kpiName && <p className="text-xs text-destructive">{errors.kpiName.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                KPI Code <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. DEPT_SALE" {...register("kpiCode")} disabled={existingKpi?.isSystemKpi} />
              {errors.kpiCode && <p className="text-xs text-destructive">{errors.kpiCode.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Controller
                name="categoryId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {(categories ?? []).map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
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
              <Label>
                Target Type <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="targetType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TARGET_TYPE_OPTIONS.map((type) => (
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
                Data Source <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. Manual Entry, POS System" {...register("dataSource")} />
              {errors.dataSource && <p className="text-xs text-destructive">{errors.dataSource.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Formula Type <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="formulaType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMULA_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type} className="capitalize">
                          {type.replace(/_/g, " ")}
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

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea placeholder="What does this KPI measure?" {...register("description")} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(ROUTES.kpi)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Create KPI"}
          </Button>
        </div>
      </form>
    </div>
  );
}
