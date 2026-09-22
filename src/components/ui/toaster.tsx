import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-end gap-2 p-4 sm:top-auto sm:bottom-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-background p-4 shadow-lg",
            t.variant === "destructive" && "border-destructive/50",
            t.variant === "success" && "border-emerald-500/50"
          )}
        >
          {t.variant === "destructive" && <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />}
          {t.variant === "success" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />}
          {(!t.variant || t.variant === "default") && <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
          <div className="flex-1">
            {t.title && <p className="text-sm font-semibold">{t.title}</p>}
            {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
