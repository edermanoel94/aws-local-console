import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True once running in the browser after hydration.
 * Use it to gate UI that depends on persisted client state (localStorage) to avoid hydration mismatches.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
