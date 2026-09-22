import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { performanceEntryFormSchema, type PerformanceEntryFormSchema } from "../schema";
import { useMetrics } from "@/hooks/useMetrics";
import { useStores } from "@/hooks/useStores";
import { useEmployees } from "@/hooks/useEmployees";
import { useCreatePerformanceEntry } from "@/hooks/usePerformanceEntries";
import { usePerformanceDataSources } from "@/hooks/usePerformanceDataLookups";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

export function DailyEntryForm() {
  const { user } = useAuth();
  const { data: metrics } = useMetrics({ companyId: user?.companyId ?? undefined, isActive: true });
  const { data: stores } = useStores();
  const { data: employees } = useEmployees({ companyId: user?.companyId ?? undefined });
  const { data: sources } = usePerformanceDataSources();
  const createEntry = useCreatePerformanceEntry();

  const manualSource = (sources ?? []).find((s) => s.code === "manual_entry");

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PerformanceEntryFormSchema>({
    resolver: zodResolver(performanceEntryFormSchema),
    defaultValues: { entryDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: PerformanceEntryFormSchema) => {
    if (!user?.companyId) return;
    try {
      await createEntry.mutateAsync({
        values,
        companyId: user.companyId,
        sourceId: manualSource?.id,
        enteredBy: user.id,
      });
      toast({ title: "Entry recorded", variant: "success" });
      reset({ entryDate: values.entryDate });
    } catch (error) {
      toast({
        title: "Could not save entry",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <Label>
              Store <span className="text-destructive">*</span>
            </Label>
            <Controller
              name="storeId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a store" />
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
            {errors.storeId && <p className="text-xs text-destructive">{errors.storeId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Employee (optional — leave blank for a store-wide value)</Label>
            <Controller
              name="employeeId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Store-wide" />
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

          <div className="space-y-1.5">
            <Label>
              Entry Date <span className="text-destructive">*</span>
            </Label>
            <Input type="date" max={new Date().toISOString().slice(0, 10)} {...register("entryDate")} />
            {errors.entryDate && <p className="text-xs text-destructive">{errors.entryDate.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>
              Value <span className="text-destructive">*</span>
            </Label>
            <Input type="number" step="0.01" {...register("entryValue")} />
            {errors.entryValue && <p className="text-xs text-destructive">{errors.entryValue.message}</p>}
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea placeholder="Optional context for this entry…" {...register("remarks")} />
          </div>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save Entry"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
