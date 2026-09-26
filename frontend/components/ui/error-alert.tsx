import { AlertTriangle } from "lucide-react";
import { toDisplayError } from "@/lib/errors";
import { cn } from "@/lib/cn";

/** Renders any error as role="alert" with its title, code and message (CONTRACT section 6). */
export function ErrorAlert({ error, className }: { error: unknown; className?: string }) {
  const e = toDisplayError(error);
  return (
    <div role="alert" className={cn("flex gap-2 rounded-lg border border-aws-red bg-red-50 px-3 py-2 text-sm text-aws-ink", className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-aws-red" aria-hidden />
      <div className="min-w-0">
        <p className="font-bold">{e.title}</p>
        <p className="break-words">
          <span className="font-mono font-bold">{e.code}</span>: {e.message}
        </p>
      </div>
    </div>
  );
}
