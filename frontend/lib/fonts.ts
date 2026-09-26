/**
 * Resolves the next/font generated monospace family (CSS variable --font-jetbrains-mono) to a concrete
 * font-family list. Canvas/measurement based widgets (Monaco, xterm.js) cannot use var() in their font options.
 */
export function monospaceFontFamily(): string {
  const fallback = "ui-monospace, Menlo, Consolas, monospace";
  if (typeof document === "undefined") return fallback;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue("--font-jetbrains-mono").trim();
  return resolved ? `${resolved}, ${fallback}` : fallback;
}
