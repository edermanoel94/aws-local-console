import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PreferencesState {
  /** Region picked by the user; null follows the server default (see hooks/use-region.ts). */
  region: string | null;
  favorites: string[];
  setRegion: (region: string) => void;
  toggleFavorite: (serviceId: string) => void;
  clearFavorites: () => void;
}

/** Client-side preferences, persisted in localStorage. */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      region: null,
      favorites: [],
      setRegion: (region) => set({ region }),
      toggleFavorite: (serviceId) =>
        set((s) => ({
          favorites: s.favorites.includes(serviceId)
            ? s.favorites.filter((f) => f !== serviceId)
            : [...s.favorites, serviceId],
        })),
      clearFavorites: () => set({ favorites: [] }),
    }),
    {
      name: "aws-local-console-preferences",
      // v0 stored "us-east-1" even when nobody picked a region; treat that as "follow the server".
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Partial<PreferencesState>;
        return (version < 1 && state.region === "us-east-1" ? { ...state, region: null } : state) as PreferencesState;
      },
    },
  ),
);
