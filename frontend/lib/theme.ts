/**
 * Color theme: the user picks light, dark or system (follow the OS), persisted with the other preferences.
 * The resolved theme is the `dark` class on <html>, which switches the aws-* color tokens (app/globals.css).
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_OPTIONS: { value: ThemePreference; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Always use the light theme." },
  { value: "dark", label: "Dark", description: "Always use the dark theme." },
  { value: "system", label: "System", description: "Follow the light or dark setting of your operating system." },
];

/** localStorage key of the persisted preferences store (stores/preferences.ts). */
export const PREFERENCES_STORAGE_KEY = "aws-local-console-preferences";

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

/**
 * Inline script run before the first paint, so a dark page never flashes light while React loads.
 * It mirrors resolveTheme/applyTheme, reading the persisted preference straight from localStorage.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function () {
  try {
    var stored = JSON.parse(localStorage.getItem(${JSON.stringify(PREFERENCES_STORAGE_KEY)}) || "{}");
    var preference = (stored.state && stored.state.theme) || "system";
    var dark = preference === "dark" || (preference === "system" && window.matchMedia(${JSON.stringify(DARK_MEDIA_QUERY)}).matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {}
})();`;

/**
 * Theme colors for widgets painted outside CSS (Monaco, React Flow SVG attributes), kept in sync with the aws-* tokens of
 * app/globals.css.
 */
export const CANVAS_COLORS: Record<ResolvedTheme, { ink: string; muted: string; surface: string; panel: string; border: string; grid: string; link: string }> = {
  light: { ink: "#000716", muted: "#5f6b7a", surface: "#ffffff", panel: "#f4f4f4", border: "#e9ebed", grid: "#d5dbdb", link: "#0972d3" },
  dark: { ink: "#e9ebed", muted: "#9ba7b6", surface: "#161d26", panel: "#1b232d", border: "#2c3744", grid: "#2c3744", link: "#42b4ff" },
};
