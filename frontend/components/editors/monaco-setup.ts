"use client";

import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import { CANVAS_COLORS } from "@/lib/theme";

/**
 * Bundles Monaco locally instead of @monaco-editor/react's default jsdelivr CDN,
 * so the editor works offline and inside the Docker network.
 */
if (typeof window !== "undefined") {
  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "json") {
        return new Worker(new URL("monaco-editor/language/json/json.worker.js", import.meta.url), { type: "module" });
      }
      return new Worker(new URL("monaco-editor/editor/editor.worker.js", import.meta.url), { type: "module" });
    },
  };
  loader.config({ monaco });

  // Editor backgrounds match the console surface of each theme (lib/theme.ts).
  for (const theme of ["light", "dark"] as const) {
    const c = CANVAS_COLORS[theme];
    monaco.editor.defineTheme(`aws-${theme}`, {
      base: theme === "dark" ? "vs-dark" : "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": c.surface,
        "editorGutter.background": c.surface,
        "editor.lineHighlightBackground": c.panel,
        "editor.lineHighlightBorder": c.panel,
        "editorLineNumber.foreground": c.muted,
        "editorWidget.background": c.panel,
        "editorWidget.border": c.border,
      },
    });
  }
}

export { monaco };
