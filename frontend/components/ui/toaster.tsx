"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToastStore } from "@/stores/toast";
import { cn } from "@/lib/cn";

export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-md",
            t.kind === "success" && "border-aws-green bg-green-50",
            t.kind === "error" && "border-aws-red bg-red-50",
            t.kind === "info" && "border-aws-link bg-blue-50",
          )}
        >
          {t.kind === "success" && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-aws-green" aria-hidden />}
          {t.kind === "error" && <XCircle className="mt-0.5 size-4 shrink-0 text-aws-red" aria-hidden />}
          {t.kind === "info" && <Info className="mt-0.5 size-4 shrink-0 text-aws-link" aria-hidden />}
          <p className="min-w-0 flex-1 break-words">{t.message}</p>
          <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="text-aws-muted">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
