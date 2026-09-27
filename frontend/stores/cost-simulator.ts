import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_ASSUMPTIONS, type PricedService, type UsageAssumptions } from "@/features/costs/pricing";

interface CostSimulatorState {
  assumptions: UsageAssumptions;
  setAssumption: <S extends PricedService>(service: S, key: keyof UsageAssumptions[S], value: number) => void;
  reset: () => void;
}

/** Usage assumptions of the Cost Simulator, persisted in localStorage. */
export const useCostSimulator = create<CostSimulatorState>()(
  persist(
    (set) => ({
      assumptions: DEFAULT_ASSUMPTIONS,
      setAssumption: (service, key, value) =>
        set((s) => ({ assumptions: { ...s.assumptions, [service]: { ...s.assumptions[service], [key]: value } } })),
      reset: () => set({ assumptions: DEFAULT_ASSUMPTIONS }),
    }),
    {
      name: "aws-local-console-cost-simulator",
      version: 1,
      // Services and fields added after a value was stored start from their defaults.
      merge: (persisted, current) => {
        const stored = (persisted as Partial<CostSimulatorState> | undefined)?.assumptions ?? {};
        const assumptions = Object.fromEntries(
          Object.entries(DEFAULT_ASSUMPTIONS).map(([service, defaults]) => [service, { ...defaults, ...(stored as Record<string, object>)[service] }]),
        ) as unknown as UsageAssumptions;
        return { ...current, assumptions };
      },
    },
  ),
);
