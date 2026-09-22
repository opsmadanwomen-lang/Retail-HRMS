import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface EmployeeSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function EmployeeSearchBar({ value, onChange }: EmployeeSearchBarProps) {
  return (
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by code, name, mobile, or email…"
        className="pl-9"
      />
    </div>
  );
}
