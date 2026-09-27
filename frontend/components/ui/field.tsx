import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const CONTROL =
  "w-full rounded-lg border border-aws-border-strong bg-aws-surface px-2.5 py-1.5 text-sm text-aws-ink placeholder:text-aws-muted focus:border-aws-link focus:outline-none focus:ring-1 focus:ring-aws-link disabled:bg-aws-panel";

interface FieldShellProps {
  id: string;
  label: string;
  description?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}

function FieldShell({ id, label, description, error, children, className }: FieldShellProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-bold text-aws-ink">
        {label}
      </label>
      {description && <p className="text-xs text-aws-muted">{description}</p>}
      {children}
      {error && <p className="text-xs text-aws-red">{error}</p>}
    </div>
  );
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; description?: ReactNode; error?: string };

/** Labeled text input. The visible label is what Playwright's getByLabel uses. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, description, error, className, id, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <FieldShell id={inputId} label={label} description={description} error={error} className={className}>
      <input ref={ref} id={inputId} aria-invalid={!!error || undefined} className={CONTROL} {...props} />
    </FieldShell>
  );
});

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; description?: ReactNode; error?: string };

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField(
  { label, description, error, className, id, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <FieldShell id={inputId} label={label} description={description} error={error} className={className}>
      <textarea ref={ref} id={inputId} aria-invalid={!!error || undefined} className={cn(CONTROL, "font-mono")} {...props} />
    </FieldShell>
  );
});

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  description?: ReactNode;
  error?: string;
  options: { value: string; label: string }[];
};

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, description, error, className, id, options, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <FieldShell id={inputId} label={label} description={description} error={error} className={className}>
      <select ref={ref} id={inputId} className={CONTROL} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});
