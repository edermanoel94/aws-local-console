import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-aws-orange text-aws-ink border-aws-orange hover:bg-aws-orange-dark",
  secondary: "bg-white text-aws-ink border-aws-border-strong hover:bg-aws-panel",
  danger: "bg-white text-aws-red border-aws-red hover:bg-red-50",
  ghost: "bg-transparent text-aws-link border-transparent hover:bg-aws-panel",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, disabled, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full border font-bold whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aws-link",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
});
