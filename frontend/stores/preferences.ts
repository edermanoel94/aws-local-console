import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PREFERENCES_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

interface PreferencesState {
  /** Region picked by the user; null follows the server default (see hooks/use-region.ts). */
  region: string | null;
  favorites: string[];
  /** Color theme; "system" follows the operating system. */
  theme: ThemePreference;
  setRegion: (region: string) => void;
  setTheme: (theme: ThemePreference) => void;
  toggleFavorite: (serviceId: string) => void;
  clearFavorites: () => void;
}

/** Client-side preferences, persisted in localStorage. */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      region: null,
      favorites: [],
      theme: "system",
      setRegion: (region) => set({ region }),
      setTheme: (theme) => set({ theme }),
      toggleFavorite: (serviceId) =>
        set((s) => ({
          favorites: s.favorites.includes(serviceId)
            ? s.favorites.filter((f) => f !== serviceId)
            : [...s.favorites, serviceId],
        })),
      clearFavorites: () => set({ favorites: [] }),
    }),
    {
      // Also read by the theme bootstrap script (lib/theme.ts) before React loads.
      name: PREFERENCES_STORAGE_KEY,
      // v0 stored "us-east-1" even when nobody picked a region; treat that as "follow the server".
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Partial<PreferencesState>;
        return (version < 1 && state.region === "us-east-1" ? { ...state, region: null } : state) as PreferencesState;
      },
    },
  ),
);
