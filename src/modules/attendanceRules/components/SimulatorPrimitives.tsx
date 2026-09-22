import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One labeled value in a simulator's output panel. `highlight` marks the final/most important
 *  figure (rendered larger, in the primary color) — used consistently across every Test Rule
 *  simulator so results are visually scannable the same way everywhere. */
export function Stat({ label, value, highlight, muted }: { label: string; value: ReactNode; highlight?: boolean; muted?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-medium", highlight && "text-lg font-semibold text-primary", muted && "text-muted-foreground")}>{value}</p>
    </div>
  );
}

/** The plain-English "why" block every simulator ends with (Part 13 of the spec: "Every simulator
 *  must show an easy-to-understand calculation breakdown"). */
export function Explanation({ lines }: { lines: (string | null | undefined | false)[] }) {
  const visible = lines.filter((l): l is string => Boolean(l));
  if (visible.length === 0) return null;
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <p className="mb-1 font-medium">Reason</p>
      <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
        {visible.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** Read-only-preview notice shown at the top of every simulator (Part 14: never touches real data). */
export function PreviewOnlyNotice() {
  return (
    <p className="text-xs text-muted-foreground">
      Preview only — runs the identical calculation engine used for real attendance, purely locally. Nothing here reads or writes any
      attendance, information usage, or employee record.
    </p>
  );
}
