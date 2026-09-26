"use client";

import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

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
}

export { monaco };
