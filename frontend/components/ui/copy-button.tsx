"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Writes text to the clipboard. The Clipboard API only exists in secure contexts (HTTPS or localhost), and the console
 * is often opened over plain HTTP through a network address, so it falls back to copying the selection of a hidden
 * textarea, which browsers still allow there during a click.
 */
async function writeClipboard(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  const focused = document.activeElement as HTMLElement | null;
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy command rejected");
  } finally {
    area.remove();
    focused?.focus();
  }
}

/** Copies text to the clipboard with a short check-mark confirmation. The label is the accessible name ("Copy queue ARN"). */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={label}
      title={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await writeClipboard(value);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access denied by the browser; nothing else to do.
        }
      }}
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded text-aws-muted hover:bg-aws-panel hover:text-aws-ink", className)}
    >
      {copied ? <Check className="size-3.5 text-aws-green" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}
