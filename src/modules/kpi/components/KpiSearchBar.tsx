import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface KpiSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function KpiSearchBar({ value, onChange }: KpiSearchBarProps) {
  return (
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by KPI name or code…"
        className="pl-9"
      />
    </div>
  );
}
