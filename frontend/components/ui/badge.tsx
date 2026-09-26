import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "green" | "red" | "gray" | "blue" | "orange";

const TONES: Record<Tone, string> = {
  green: "bg-green-50 text-aws-green border-aws-green",
  red: "bg-red-50 text-aws-red border-aws-red",
  gray: "bg-aws-panel text-aws-muted border-aws-border-strong",
  blue: "bg-blue-50 text-aws-link border-aws-link",
  orange: "bg-orange-50 text-aws-orange-dark border-aws-orange",
};

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}
