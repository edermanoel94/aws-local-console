import { cn } from "@/lib/cn";

/** Read-only pretty JSON block. Use the Monaco editor from components/editors for editable JSON. */
export function JsonView({ value, className, label }: { value: unknown; className?: string; label?: string }) {
  return (
    <pre aria-label={label} className={cn("max-h-[480px] overflow-auto rounded-lg border border-aws-border bg-aws-panel p-3 font-mono text-xs leading-relaxed text-aws-ink", className)}>
      {value === undefined ? "" : JSON.stringify(value, null, 2)}
    </pre>
  );
}
