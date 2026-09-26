"use client";

import "./monaco-setup";
import Editor, { type OnMount } from "@monaco-editor/react";
import { monospaceFontFamily } from "@/lib/fonts";

export interface MonacoJsonProps {
  value: string;
  onChange: (value: string) => void;
  onReady: () => void;
  readOnly?: boolean;
  height: number | string;
  language?: string;
}

/** Monaco instance configured for compact JSON editing. Loaded client-only by JsonEditor. */
export default function MonacoJson({ value, onChange, onReady, readOnly, height, language = "json" }: MonacoJsonProps) {
  const handleMount: OnMount = () => onReady();
  return (
    <Editor
      height={height}
      language={language}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={handleMount}
      loading={null}
      theme="vs"
      options={{
        ariaLabel: "JSON code editor",
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: monospaceFontFamily(),
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        renderLineHighlight: "line",
        padding: { top: 8, bottom: 8 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        formatOnPaste: true,
        fixedOverflowWidgets: true,
      }}
    />
  );
}
