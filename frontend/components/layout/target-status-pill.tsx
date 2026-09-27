"use client";

import Link from "next/link";
import { useTargetStatus } from "@/hooks/use-queries";
import { cn } from "@/lib/cn";
import type { TargetStatus } from "@/types/api";

/** "Floci ● Healthy" (or "AWS ● Healthy") pill in the top bar, polled every 10s. Links to the settings page with the target details. */
export function TargetStatusPill() {
  const { data, isPending, isError } = useTargetStatus();
  const state = isPending ? "checking" : isError ? "api-down" : data.healthy ? "healthy" : "failing";
  const text = isPending ? "Checking" : isError ? "API offline" : data.status;

  return (
    <Link
      href="/settings"
      title={state === "api-down" ? "The Go API is not reachable" : data ? describe(data) : "Checking target status"}
      className="flex h-8 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-2.5 text-xs whitespace-nowrap sm:px-3 text-white no-underline hover:border-white/40 hover:bg-white/10"
    >
      {data && <span className="font-bold">{data.name}</span>}
      <span className="relative flex size-2" aria-hidden>
        {state === "healthy" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            state === "healthy" && "bg-emerald-400",
            state === "checking" && "bg-gray-400",
            (state === "failing" || state === "api-down") && "bg-red-500",
          )}
        />
      </span>
      <span className={cn("sr-only sm:not-sr-only", state === "healthy" ? "text-emerald-300" : state === "checking" ? "text-gray-300" : "text-red-300")}>{text}</span>
    </Link>
  );
}

function describe(status: TargetStatus) {
  if (status.target === "aws") {
    const who = status.identityArn ?? (status.accountId ? `account ${status.accountId}` : status.error ?? "credentials not resolved");
    return `${who} · ${status.region} · ${status.latencyMs}ms`;
  }
  return `${status.endpoint}${status.version ? ` · v${status.version}` : ""} · ${status.latencyMs}ms`;
}
