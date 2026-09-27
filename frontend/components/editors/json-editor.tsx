"use client";

import dynamic from "next/dynamic";
import { useId, useMemo, useState, type ReactNode } from "react";
import { AlignLeft, CheckCircle2, Code2, Type, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

const MonacoJson = dynamic(() => import("./monaco-json"), { ssr: false, loading: () => null });

export interface JsonEditorProps {
  /** Visible label. It labels the plain-text mirror textarea, so `getByLabel(label).fill(json)` always works. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  height?: number;
  readOnly?: boolean;
  description?: ReactNode;
  /** Extra controls rendered in the label row (right side). */
  toolbar?: ReactNode;
  className?: string;
}

/** Parses JSON text; returns the error message when invalid. */
export function parseJson(text: string): { value?: unknown; error?: string } {
  if (!text.trim()) return { value: {} };
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * JSON editor: Monaco (client-only, bundled locally) with an accessible plain-text mirror.
 *
 * Accessibility / test contract:
 * - The visible <label> is bound to a <textarea> that always holds the same text as Monaco.
 *   While Monaco loads (or if it fails) and in "Text" mode, that textarea is the visible editor.
 *   When Monaco is active, the textarea stays in the DOM visually hidden and two-way synced,
 *   so Playwright can use `getByLabel("Input").fill("{...}")` and assistive tech gets a plain field.
 * - Monaco's own input is labeled "JSON code editor" to avoid clashing with the field label.
 * - The "Text" / "Editor" toggle switches between Monaco and the plain textarea for users who prefer it.
 */
export function JsonEditor({ label, value, onChange, height = 280, readOnly, description, toolbar, className }: JsonEditorProps) {
  const id = useId();
  const [monacoReady, setMonacoReady] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const validation = useMemo(() => parseJson(value), [value]);
  const showTextarea = textMode || !monacoReady;

  const format = () => {
    if (validation.error) return;
    onChange(JSON.stringify(validation.value, null, 2));
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <label htmlFor={id} className="text-sm font-bold text-aws-ink">
            {label}
          </label>
          {description && <p className="text-xs text-aws-muted">{description}</p>}
        </div>
        <div className="flex items-center gap-1">
          {toolbar}
          {!readOnly && (
            <button type="button" onClick={format} disabled={!!validation.error} className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-bold text-aws-link hover:bg-aws-panel disabled:opacity-40">
              <AlignLeft className="size-3.5" aria-hidden /> Format
            </button>
          )}
          <button
            type="button"
            onClick={() => setTextMode((t) => !t)}
            aria-pressed={textMode}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-bold text-aws-link hover:bg-aws-panel"
            title={textMode ? "Switch to the code editor" : "Edit as plain text"}
          >
            {textMode ? <Code2 className="size-3.5" aria-hidden /> : <Type className="size-3.5" aria-hidden />}
            {textMode ? "Code editor" : "Edit as text"}
          </button>
        </div>
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-lg border bg-aws-surface",
          validation.error ? "border-aws-red" : "border-aws-border-strong",
          "focus-within:border-aws-link focus-within:ring-1 focus-within:ring-aws-link",
        )}
        style={{ height }}
      >
        {!textMode && (
          <div className={cn("absolute inset-0", !monacoReady && "invisible")} aria-hidden={!monacoReady || undefined}>
            <MonacoJson value={value} onChange={onChange} onReady={() => setMonacoReady(true)} readOnly={readOnly} height={height - 2} />
          </div>
        )}
        <textarea
          id={id}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          tabIndex={showTextarea ? 0 : -1}
          className={cn(
            showTextarea
              ? "absolute inset-0 size-full resize-none bg-aws-surface px-3 py-2 font-mono text-[13px] leading-5 text-aws-ink focus:outline-none"
              : "visually-hidden",
          )}
        />
      </div>

      <p className={cn("flex items-center gap-1 text-xs", validation.error ? "text-aws-red" : "text-aws-muted")} aria-live="polite">
        {validation.error ? (
          <>
            <XCircle className="size-3.5" aria-hidden /> Invalid JSON: {validation.error}
          </>
        ) : (
          <>
            <CheckCircle2 className="size-3.5 text-aws-green" aria-hidden /> Valid JSON
          </>
        )}
      </p>
    </div>
  );
}
