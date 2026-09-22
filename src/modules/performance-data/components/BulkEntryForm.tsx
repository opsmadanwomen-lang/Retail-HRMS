import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMetrics } from "@/hooks/useMetrics";
import { useStores } from "@/hooks/useStores";
import { useEmployees } from "@/hooks/useEmployees";
import { useBulkCreatePerformanceEntries } from "@/hooks/usePerformanceEntries";
import { usePerformanceDataSources } from "@/hooks/usePerformanceDataLookups";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

export function BulkEntryForm() {
  const { user } = useAuth();
  const { data: metrics } = useMetrics({ companyId: user?.companyId ?? undefined, isActive: true });
  const { data: stores } = useStores();
  const { data: sources } = usePerformanceDataSources();
  const bulkCreate = useBulkCreatePerformanceEntries();

  const [metricId, setMetricId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState<Record<string, string>>({});

  const { data: employees } = useEmployees({ storeId: storeId || undefined });
  const bulkSource = (sources ?? []).find((s) => s.code === "bulk_entry");

  const handleSubmit = async () => {
    if (!user?.companyId || !metricId || !storeId) return;
    const rows = Object.entries(values)
      .filter(([, v]) => v.trim() !== "")
      .map(([employeeId, v]) => ({ employeeId, entryValue: Number(v) }));

    if (rows.length === 0) {
      toast({ title: "Enter at least one value", variant: "destructive" });
      return;
    }

    try {
      const result = await bulkCreate.mutateAsync({
        metricId,
        storeId,
        entryDate,
        companyId: user.companyId,
        sourceId: bulkSource?.id,
        enteredBy: user.id,
        rows,
      });
      toast({
        title: "Bulk entry complete",
        description: `${result.created} saved${result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : ""}.`,
        variant: "success",
      });
      setValues({});
    } catch (error) {
      toast({
        title: "Could not save bulk entry",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Entry</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Metric</Label>
            <Select value={metricId} onValueChange={setMetricId}>
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
          </div>
          <div className="space-y-1.5">
            <Label>Store</Label>
            <Select value={storeId} onValueChange={setStoreId}>
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
          </div>
          <div className="space-y-1.5">
            <Label>Entry Date</Label>
            <Input
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>
        </div>

        {storeId && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="w-40">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(employees ?? []).map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell>{emp.fullName}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={values[emp.id] ?? ""}
                        onChange={(e) => setValues((prev) => ({ ...prev, [emp.id]: e.target.value }))}
                        className="w-32"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(!employees || employees.length === 0) && (
              <p className="text-sm text-muted-foreground">No employees found for this store.</p>
            )}
            <Button onClick={handleSubmit} disabled={!metricId || bulkCreate.isPending}>
              {bulkCreate.isPending ? "Saving…" : "Save Bulk Entries"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
