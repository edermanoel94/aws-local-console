"use client";

import { useId } from "react";
import { ChevronDown, Globe } from "lucide-react";
import { usePreferences } from "@/stores/preferences";
import { useRegion, useRegions } from "@/hooks/use-region";

/** Top bar region selector bound to the persisted preferences store. */
export function RegionSelector() {
  const id = useId();
  const current = useRegion();
  const setRegion = usePreferences((s) => s.setRegion);
  const { data: regions } = useRegions();

  const options = regions?.length ? regions : [{ name: current, label: current, default: true }];
  const hasCurrent = options.some((r) => r.name === current);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only items-center gap-1 text-xs text-gray-300 lg:not-sr-only lg:flex">
        <Globe className="size-3.5" aria-hidden />
        Region
      </label>
      <div className="relative">
        <select
          id={id}
          value={current}
          onChange={(e) => setRegion(e.target.value)}
          className="h-8 cursor-pointer appearance-none rounded-md border border-white/15 bg-aws-navy-light py-0 pr-7 pl-2.5 text-sm font-bold text-white hover:border-white/40 focus:border-aws-orange focus:outline-none"
        >
          {!hasCurrent && <option value={current}>{current}</option>}
          {options.map((r) => (
            <option key={r.name} value={r.name} title={r.label}>
              {r.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-gray-300" aria-hidden />
      </div>
    </div>
  );
}
