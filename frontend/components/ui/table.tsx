import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border-b border-aws-border-strong px-3 py-2 text-left font-bold whitespace-nowrap text-aws-ink", className)} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-aws-border px-3 py-2 align-top", className)} {...props} />;
}

export function Tr({ className, selected, ...props }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return <tr aria-selected={selected} className={cn("hover:bg-aws-panel", selected && "bg-blue-50", className)} {...props} />;
}
