import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReportingManagerOptions } from "@/hooks/useEmployees";

interface ReportingManagerSelectProps {
  storeId?: string;
  value?: string;
  onChange: (employeeId: string | undefined) => void;
  excludeEmployeeId?: string;
}

export function ReportingManagerSelect({ storeId, value, onChange, excludeEmployeeId }: ReportingManagerSelectProps) {
  const { data: managers, isLoading } = useReportingManagerOptions(storeId);
  const options = (managers ?? []).filter((m) => m.id !== excludeEmployeeId);

  return (
    <Select
      value={value ?? "none"}
      onValueChange={(v) => onChange(v === "none" ? undefined : v)}
      disabled={!storeId || isLoading}
    >
      <SelectTrigger>
        <SelectValue placeholder={!storeId ? "Select a store first" : "None"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">None</SelectItem>
        {options.map((manager) => (
          <SelectItem key={manager.id} value={manager.id}>
            {manager.fullName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
