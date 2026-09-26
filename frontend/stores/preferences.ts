import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PreferencesState {
  region: string;
  favorites: string[];
  setRegion: (region: string) => void;
  toggleFavorite: (serviceId: string) => void;
  clearFavorites: () => void;
}

/** Client-side preferences, persisted in localStorage. */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      region: "us-east-1",
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
    { name: "aws-local-console-preferences" },
  ),
);
