import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AssignableEmployee } from "@/types/userManagement";

/**
 * The mandatory "Employee *" searchable dropdown for User Management (Create User / Relink
 * Employee). Only existing `employees` rows are ever selectable -- there is deliberately no way
 * to type a name that isn't in the list and have it accepted, since User Management must never
 * create a new employee (see supabase/functions/user-account/index.ts).
 *
 * Employees who already have a login (authUserId set) are shown, not hidden, so the admin can see
 * WHY a person they expect isn't pickable -- but they render disabled and can never be selected;
 * the backend enforces the same rule independently (`resolveSelectableEmployee`).
 */
interface EmployeeSearchSelectProps {
  employees: AssignableEmployee[];
  value: string | null;
  onChange: (employee: AssignableEmployee) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Employees who already have a login, but linked to THIS SAME user, remain selectable (relink no-op case). */
  allowAuthUserId?: string | null;
}

export function EmployeeSearchSelect({ employees, value, onChange, placeholder, disabled, allowAuthUserId }: EmployeeSearchSelectProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = employees.find((e) => e.id === value) ?? null;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter(
      (e) =>
        e.fullName.toLowerCase().includes(term) ||
        (e.employeeCode ?? "").toLowerCase().includes(term) ||
        (e.storeName ?? "").toLowerCase().includes(term)
    );
  }, [employees, query]);

  const labelFor = (e: AssignableEmployee) => `${e.fullName} — ${e.employeeCode ?? "No Code"} — ${e.storeName ?? "All Stores"}`;

  return (
    <div className="relative" ref={containerRef}>
      <Input
        value={open ? query : selected ? labelFor(selected) : ""}
        placeholder={placeholder ?? "Search employee by name, code, or store…"}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open ? (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matching employees found.</div>
          ) : (
            filtered.map((employee) => {
              const taken = Boolean(employee.authUserId) && employee.authUserId !== allowAuthUserId;
              return (
                <button
                  key={employee.id}
                  type="button"
                  disabled={taken}
                  onClick={() => {
                    if (taken) return;
                    onChange(employee);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent",
                    taken && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    employee.id === value && "bg-accent"
                  )}
                >
                  <span className="font-medium">{labelFor(employee)}</span>
                  {taken ? <span className="text-xs text-destructive">Already has a login{employee.email ? ` (${employee.email})` : ""}</span> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
