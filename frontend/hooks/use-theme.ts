"use client";

import { useEffect, useSyncExternalStore } from "react";
import { applyTheme, DARK_MEDIA_QUERY, resolveTheme, type ResolvedTheme } from "@/lib/theme";
import { usePreferences } from "@/stores/preferences";
import { useHydrated } from "./use-hydrated";

/** Keeps the `dark` class of <html> in sync with the preference and, for "system", with the OS setting. */
export function useThemeController() {
  const preference = usePreferences((s) => s.theme);
  const hydrated = useHydrated();
  useEffect(() => {
    // Before hydration the store still holds its default; the bootstrap script already applied the stored theme.
    if (!hydrated) return;
    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const apply = () => applyTheme(resolveTheme(preference, media.matches));
    apply();
    if (preference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference, hydrated]);
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** The theme in effect ("light" or "dark"), for widgets styled outside CSS (Monaco, React Flow). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light",
  );
}
