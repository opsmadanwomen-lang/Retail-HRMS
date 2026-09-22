import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useDynamicRoles } from "@/hooks/usePermissions";
import type { DynamicRole } from "@/types/permission";

/**
 * The ONE reusable Business Role picker (spec §18) — every page that lets a Super Admin pick a
 * business/permission role (User Management's "Business Role", Permission Management's role list,
 * any future screen) should use this, never a page-local hard-coded role array. Backed entirely by
 * the centralized Role Master (`dynamic_roles`, via `useDynamicRoles()` — migration 0161/0172): a
 * role created anywhere shows up here immediately (same React Query cache key), with zero
 * per-page code change (spec §7/§8/§29).
 *
 * Inactive roles are hidden from the pickable list (a deactivated role "cannot be newly assigned",
 * spec §10) UNLESS it is the CURRENTLY assigned value — then it still renders, clearly marked
 * Inactive, so an existing assignment is never silently hidden or force-cleared by this component.
 *
 * This is a BUSINESS role selector only — it is never used for `profiles.role` (the System/login
 * role, still its own fixed dropdown in User Management, see CREATABLE_ROLES) and never for a
 * business-authority roster (Boss / HR Processor / Finance Processor / Reporting Manager), which
 * remain employee-based, not role-based (spec §17/§28).
 */
interface RoleSelectorProps {
  companyId?: string;
  /** dynamic_roles.id, or null for "no role assigned". */
  value: string | null;
  onChange: (roleId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Shows a "No Role" option to explicitly clear the assignment. Default true. */
  allowClear?: boolean;
  /** Show the role Code alongside its Name. Default true. */
  showCode?: boolean;
  className?: string;
}

export function RoleSelector({
  companyId,
  value,
  onChange,
  placeholder,
  disabled,
  allowClear = true,
  showCode = true,
  className,
}: RoleSelectorProps) {
  const rolesQuery = useDynamicRoles(companyId);
  const allRoles = rolesQuery.data ?? [];

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = allRoles.find((r) => r.id === value) ?? null;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Pickable = active roles, PLUS the currently-assigned role even if it has since been
  // deactivated (so the existing assignment is always visible/selectable-as-is, never hidden —
  // re-selecting the SAME still-inactive role is a no-op, but nothing forces it to change here).
  const pickable = useMemo(
    () => allRoles.filter((r) => r.isActive || r.id === value).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [allRoles, value]
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return pickable;
    return pickable.filter((r) => r.name.toLowerCase().includes(term) || r.code.toLowerCase().includes(term));
  }, [pickable, query]);

  const labelFor = (r: DynamicRole) => (showCode ? `${r.name} (${r.code})` : r.name);

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <Input
        value={open ? query : selected ? labelFor(selected) : ""}
        placeholder={rolesQuery.isLoading ? "Loading roles…" : placeholder ?? "Search or select a role…"}
        disabled={disabled || rolesQuery.isLoading}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open ? (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {allowClear && (
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); setQuery(""); }}
              className={cn("flex w-full items-center px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent", value === null && "bg-accent")}
            >
              No Role
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matching roles found.</div>
          ) : (
            filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { onChange(r.id); setOpen(false); setQuery(""); }}
                className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent", r.id === value && "bg-accent")}
              >
                <span>{labelFor(r)}</span>
                {!r.isActive && <Badge variant="secondary" className="shrink-0">Inactive</Badge>}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
