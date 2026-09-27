"use client";

import { Fragment, forwardRef, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Check, Copy, Plus, X } from "lucide-react";
import { Button, Dialog, ErrorAlert, TextField } from "@/components/ui";
import { cn } from "@/lib/cn";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; description?: ReactNode };

/** Checkbox wrapped by its label (getByLabel works). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, className, ...props }, ref) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2 text-sm", className)}>
      <input ref={ref} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-aws-link" {...props} />
      <span>
        <span className="font-bold text-aws-ink">{label}</span>
        {description && <span className="block text-xs text-aws-muted">{description}</span>}
      </span>
    </label>
  );
});

/** Group of large radio "cards" (AWS style) as a fieldset with legend. */
export function RadioCards<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  columns = 2,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; description?: string }[];
  columns?: 2 | 3;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-bold text-aws-ink">{legend}</legend>
      <div className={cn("grid gap-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm",
              value === o.value ? "border-aws-link bg-aws-info-bg" : "border-aws-border-strong bg-aws-surface hover:bg-aws-panel",
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-0.5 accent-aws-link" />
            <span>
              <span className="font-bold">{o.label}</span>
              {o.description && <span className="block text-xs text-aws-muted">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Code editor field: monospace textarea with a line number gutter and Tab indentation.
 * A native textarea keeps it accessible and scriptable (getByLabel("Function code").fill(...)).
 */
export function CodeField({
  label,
  value,
  onChange,
  description,
  error,
  rows = 14,
  fileName,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: ReactNode;
  error?: string;
  rows?: number;
  fileName?: string;
  readOnly?: boolean;
}) {
  const id = useId();
  const gutterRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const lines = Math.max(value.split("\n").length, rows);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.shiftKey || readOnly) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart, selectionEnd } = el;
    onChange(value.slice(0, selectionStart) + "  " + value.slice(selectionEnd));
    requestAnimationFrame(() => {
      areaRef.current?.setSelectionRange(selectionStart + 2, selectionStart + 2);
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold text-aws-ink">
        {label}
      </label>
      {description && <p className="text-xs text-aws-muted">{description}</p>}
      <div className={cn("overflow-hidden rounded-lg border bg-aws-squid", error ? "border-aws-red" : "border-aws-border-strong focus-within:border-aws-link focus-within:ring-1 focus-within:ring-aws-link")}>
        {fileName && (
          <div className="flex items-center gap-2 border-b border-white/10 bg-aws-navy px-3 py-1.5 font-mono text-xs text-white/80">
            <span className="size-2 rounded-full bg-aws-orange" aria-hidden />
            {fileName}
          </div>
        )}
        <div className="flex">
          <div
            ref={gutterRef}
            aria-hidden
            className="shrink-0 overflow-hidden border-r border-white/10 bg-aws-squid py-2 pr-2 pl-3 text-right font-mono text-xs leading-5 text-white/35 select-none"
            style={{ height: `${rows * 20 + 16}px` }}
          >
            {Array.from({ length: lines }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={areaRef}
            id={id}
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-invalid={!!error || undefined}
            wrap="off"
            className="block w-full resize-none bg-aws-squid px-3 py-2 font-mono text-xs leading-5 text-[#e6edf3] caret-aws-orange outline-none"
            style={{ height: `${rows * 20 + 16}px` }}
          />
        </div>
      </div>
      {error && <p className="text-xs text-aws-red">{error}</p>}
    </div>
  );
}

export interface KeyValue {
  key: string;
  value: string;
}

/** Editable list of key/value pairs (tags, environment variables). Inputs are labeled "<keyLabel> N" / "<valueLabel> N". */
export function KeyValueEditor({
  rows,
  onChange,
  keyLabel = "Key",
  valueLabel = "Value",
  addLabel = "Add new tag",
  emptyText = "No tags",
  max,
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  emptyText?: string;
  max?: number;
}) {
  const update = (index: number, patch: Partial<KeyValue>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const input =
    "w-full rounded-lg border border-aws-border-strong bg-aws-surface px-2.5 py-1.5 text-sm text-aws-ink placeholder:text-aws-muted focus:border-aws-link focus:outline-none focus:ring-1 focus:ring-aws-link";
  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <p className="text-sm text-aws-muted">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <span className="text-sm font-bold">{keyLabel}</span>
          <span className="text-sm font-bold">{valueLabel}</span>
          <span />
          {rows.map((row, i) => (
            <div key={i} className="contents">
              <input aria-label={`${keyLabel} ${i + 1}`} className={input} value={row.key} onChange={(e) => update(i, { key: e.target.value })} placeholder="Enter key" />
              <input aria-label={`${valueLabel} ${i + 1}`} className={input} value={row.value} onChange={(e) => update(i, { value: e.target.value })} placeholder="Enter value" />
              <Button aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      <div>
        <Button onClick={() => onChange([...rows, { key: "", value: "" }])} disabled={max !== undefined && rows.length >= max}>
          <Plus className="size-4" aria-hidden />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

export function toKeyValues(record: Record<string, string> | undefined | null): KeyValue[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

export function fromKeyValues(rows: KeyValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.key.trim()) out[r.key.trim()] = r.value;
  return out;
}

/** Text input with suggestions (native datalist), e.g. an ARN picker that still accepts free text. */
export const SuggestField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; suggestions: { value: string; label?: string }[]; description?: ReactNode; error?: string }>(
  function SuggestField({ suggestions, ...props }, ref) {
    const listId = useId();
    return (
      <>
        <TextField ref={ref} list={listId} autoComplete="off" {...props} />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </datalist>
      </>
    );
  },
);

/** Copies text to the clipboard with a short check-mark confirmation. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access denied (e.g. insecure context); nothing else to do.
        }
      }}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-aws-muted hover:bg-aws-panel hover:text-aws-ink"
    >
      {copied ? <Check className="size-3.5 text-aws-green" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

/** Monospace value with a copy button (ARNs, URLs, ids). */
/** ARNs and URLs wrap after ":" and "/" (never inside an account id); other long values wrap anywhere as a last resort. */
export function CopyableText({ value, label }: { value: string; label: string }) {
  const parts = value.split(/(?<=[:/])/);
  return (
    <span className="inline-flex max-w-full items-start gap-1">
      <span className="min-w-0 font-mono text-xs leading-6 [overflow-wrap:anywhere]">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {part}
            {i < parts.length - 1 && <wbr />}
          </Fragment>
        ))}
      </span>
      <CopyButton value={value} label={label} />
    </span>
  );
}

/** Generic confirmation dialog (no name typing), e.g. for purge, empty, remove target. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  loading,
  error,
  confirmText,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  loading?: boolean;
  error?: unknown;
  /** When set, the user must type this word in an input labeled `Type "<word>" to confirm`. */
  confirmText?: string;
}) {
  const [typed, setTyped] = useState("");
  const close = () => {
    setTyped("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={loading} disabled={confirmText !== undefined && typed !== confirmText} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {children}
        {confirmText !== undefined && (
          <TextField label={`Type "${confirmText}" to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText} autoComplete="off" />
        )}
        {error ? <ErrorAlert error={error} /> : null}
      </div>
    </Dialog>
  );
}

/** Small inline remove icon button for table rows. */
export function RemoveIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex size-7 items-center justify-center rounded text-aws-muted hover:bg-aws-error-bg hover:text-aws-red">
      <X className="size-4" aria-hidden />
    </button>
  );
}

/** Compact segmented radio group (e.g. Scan / Query, JSON / DynamoDB JSON). Each option is a labeled radio. */
export function SegmentedControl<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  hideLegend,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  hideLegend?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={cn("mb-1 text-sm font-bold text-aws-ink", hideLegend && "sr-only")}>{legend}</legend>
      <div className="inline-flex w-fit overflow-hidden rounded-full border border-aws-border-strong">
        {options.map((o, i) => (
          <label
            key={o.value}
            className={cn(
              "relative cursor-pointer px-4 py-1 text-sm font-bold focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-aws-link",
              i > 0 && "border-l border-aws-border-strong",
              value === o.value ? "bg-aws-navy text-white" : "bg-aws-surface text-aws-ink hover:bg-aws-panel",
            )}
          >
            {/* Transparent radio covering the whole segment: clicks land on the real input (keyboard and pointer), no visual radio. */}
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
