"use client";

import Link from "next/link";
import { useFlociStatus } from "@/hooks/use-queries";
import { cn } from "@/lib/cn";

/** "Floci ● Healthy" pill in the top bar, polled every 10s. Links to the settings page with endpoint details. */
export function FlociStatusPill() {
  const { data, isPending, isError } = useFlociStatus();
  const state = isPending ? "checking" : isError ? "api-down" : data.healthy ? "healthy" : "unreachable";
  const text = { checking: "Checking", "api-down": "API offline", healthy: "Healthy", unreachable: "Unreachable" }[state];
  const title =
    state === "api-down"
      ? "The Go API is not reachable"
      : data
        ? `${data.endpoint}${data.version ? ` · v${data.version}` : ""} · ${data.latencyMs}ms`
        : "Checking Floci status";

  return (
    <Link
      href="/settings"
      title={title}
      className="flex h-8 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 text-xs text-white no-underline hover:border-white/40 hover:bg-white/10"
    >
      <span className="font-bold">Floci</span>
      <span className="relative flex size-2" aria-hidden>
        {state === "healthy" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            state === "healthy" && "bg-emerald-400",
            state === "checking" && "bg-gray-400",
            (state === "unreachable" || state === "api-down") && "bg-red-500",
          )}
        />
      </span>
      <span className={cn(state === "healthy" ? "text-emerald-300" : state === "checking" ? "text-gray-300" : "text-red-300")}>{text}</span>
    </Link>
  );
}
