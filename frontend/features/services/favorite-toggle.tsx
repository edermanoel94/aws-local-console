"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePreferences } from "@/stores/preferences";
import { useHydrated } from "@/hooks/use-hydrated";

/** Star button toggling a service in the persisted favorites (aria-pressed reflects the state). */
export function FavoriteToggle({ serviceId, label, className }: { serviceId: string; label: string; className?: string }) {
  const hydrated = useHydrated();
  const favorite = usePreferences((s) => s.favorites.includes(serviceId));
  const toggle = usePreferences((s) => s.toggleFavorite);
  const pressed = hydrated && favorite;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`Favorite ${label}`}
      title={pressed ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(serviceId);
      }}
      className={cn("relative z-10 rounded-md p-1.5 transition-colors hover:bg-aws-panel", pressed ? "text-aws-orange" : "text-aws-border-strong hover:text-aws-muted", className)}
    >
      <Star className="size-4" fill={pressed ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}
