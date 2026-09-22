import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface OrganizationTreeNodeProps {
  label: string;
  badge?: string;
  count?: number;
  depth: number;
  defaultOpen?: boolean;
  children?: ReactNode;
}

export function OrganizationTreeNode({
  label,
  badge,
  count,
  depth,
  defaultOpen = false,
  children,
}: OrganizationTreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasChildren = Boolean(children);

  return (
    <div>
      <button
        type="button"
        onClick={() => hasChildren && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
          !hasChildren && "cursor-default hover:bg-transparent"
        )}
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      >
        {hasChildren ? (
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className={cn(depth === 0 && "font-semibold", depth === 1 && "font-medium")}>{label}</span>
        {badge && (
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
            {badge}
          </span>
        )}
        {typeof count === "number" && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {count}
          </span>
        )}
      </button>
      {open && hasChildren && <div>{children}</div>}
    </div>
  );
}
