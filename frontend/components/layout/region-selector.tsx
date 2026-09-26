"use client";

import { useId } from "react";
import { ChevronDown, Globe } from "lucide-react";
import { usePreferences } from "@/stores/preferences";
import { useHydrated } from "@/hooks/use-hydrated";
import { useRegions } from "@/hooks/use-queries";

/** Top bar region selector bound to the persisted preferences store. */
export function RegionSelector() {
  const id = useId();
  const hydrated = useHydrated();
  const region = usePreferences((s) => s.region);
  const setRegion = usePreferences((s) => s.setRegion);
  const { data: regions } = useRegions();

  const current = hydrated ? region : "us-east-1";
  const options = regions?.length ? regions : [{ name: current, label: current, default: true }];
  const hasCurrent = options.some((r) => r.name === current);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="flex items-center gap-1 text-xs text-gray-300">
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
