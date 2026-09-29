import { cn } from "@/lib/cn";
import { CopyButton } from "./copy-button";

/**
 * Accessible name of the copy button of code blocks and editors.
 * It deliberately does not repeat the block label: getByLabel("Response body") must keep matching only the block.
 */
export const COPY_CODE_LABEL = "Copy to clipboard";

/** Read-only monospace block (JSON documents, message bodies, object content) with a copy button in its top right corner. */
export function CodeBlock({ text, label, className }: { text: string; label?: string; className?: string }) {
  return (
    <div className="relative min-w-0">
      <pre aria-label={label} className={cn("max-h-[480px] overflow-auto rounded-lg border border-aws-border bg-aws-panel p-3 pr-11 font-mono text-xs leading-relaxed text-aws-ink", className)}>
        {text}
      </pre>
      {text && <CopyButton value={text} label={COPY_CODE_LABEL} className="absolute top-2 right-2 size-7 border border-aws-border bg-aws-surface shadow-sm hover:bg-aws-panel" />}
    </div>
  );
}

/** Read-only pretty JSON block with a copy button. Use the Monaco editor from components/editors for editable JSON. */
export function JsonView({ value, className, label }: { value: unknown; className?: string; label?: string }) {
  return <CodeBlock text={value === undefined ? "" : JSON.stringify(value, null, 2)} label={label} className={className} />;
}
