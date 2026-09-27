"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { monospaceFontFamily } from "@/lib/fonts";
import { usePreferences } from "@/stores/preferences";

const PROMPT = "$ ";
const HISTORY_KEY = "aws-local-console-cli-history";

export interface TranscriptEntry {
  id: number;
  kind: "command" | "stdout" | "stderr" | "info";
  text: string;
}

export interface CliTerminalHandle {
  /** Replaces the current input line (used by the example chips). */
  setLine: (text: string) => void;
  clear: () => void;
  focus: () => void;
}

interface CliTerminalProps {
  /** Receives the imperative handle (explicit prop: refs are not forwarded through next/dynamic reliably). */
  handleRef: RefObject<CliTerminalHandle | null>;
  onTranscript: (entry: Omit<TranscriptEntry, "id">) => void;
  onClearTranscript: () => void;
  onBusyChange: (busy: boolean) => void;
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * xterm.js terminal backed by POST /api/v1/cli/execute.
 * Line editing (arrows, Home/End, Backspace/Delete, Ctrl+A/E/U/C/L), persisted history (Up/Down), `clear`.
 * Every command and its output is also reported through onTranscript for the accessible log mirror.
 */
export default function CliTerminal({ handleRef, onTranscript, onClearTranscript, onBusyChange }: CliTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const lineRef = useRef({ text: "", cursor: 0 });
  const historyRef = useRef<{ items: string[]; index: number; draft: string }>({ items: [], index: 0, draft: "" });
  const busyRef = useRef(false);
  const callbacks = useRef({ onTranscript, onClearTranscript, onBusyChange });

  useEffect(() => {
    callbacks.current = { onTranscript, onClearTranscript, onBusyChange };
  }, [onTranscript, onClearTranscript, onBusyChange]);

  const redraw = () => {
    const term = termRef.current;
    if (!term) return;
    const { text, cursor } = lineRef.current;
    term.write(`\r\x1b[K\x1b[1;32m${PROMPT}\x1b[0m${text}`);
    const back = text.length - cursor;
    if (back > 0) term.write(`\x1b[${back}D`);
  };

  const setLine = (text: string, cursor = text.length) => {
    lineRef.current = { text, cursor };
    redraw();
  };

  const clearScreen = () => {
    termRef.current?.clear();
    termRef.current?.write("\x1b[2J\x1b[H");
    callbacks.current.onClearTranscript();
  };

  useImperativeHandle(handleRef, () => ({
    setLine: (text) => {
      if (busyRef.current) return;
      setLine(text);
      termRef.current?.focus();
    },
    clear: () => {
      clearScreen();
      redraw();
      termRef.current?.focus();
    },
    focus: () => termRef.current?.focus(),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    historyRef.current = { items: loadHistory(), index: 0, draft: "" };
    historyRef.current.index = historyRef.current.items.length;

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: monospaceFontFamily(),
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: "#16191f",
        foreground: "#e9ebed",
        cursor: "#ff9900",
        cursorAccent: "#16191f",
        selectionBackground: "#2f3d4f",
        green: "#3fb950",
        red: "#ff6b6b",
        yellow: "#ff9900",
        blue: "#539fe5",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    const textarea = container.querySelector("textarea");
    textarea?.setAttribute("aria-label", "Terminal input");
    try {
      fit.fit();
    } catch {
      // container not measurable yet
    }

    const intro = "AWS Local Console CLI - commands run against Floci through the Go API.\r\nType \x1b[1mhelp\x1b[0m for the supported syntax, \x1b[1mclear\x1b[0m to clear the screen.\r\n";
    term.write(`\x1b[2m${intro}\x1b[0m\r\n`);
    redraw();
    term.focus();

    const writeOutput = (text: string, color?: "red" | "dim") => {
      if (!text) return;
      const body = text.endsWith("\n") ? text : `${text}\n`;
      if (color === "red") term.write(`\x1b[31m${body}\x1b[0m`);
      else if (color === "dim") term.write(`\x1b[2m${body}\x1b[0m`);
      else term.write(body);
    };

    const run = async (command: string) => {
      const trimmed = command.trim();
      term.write("\r\n");
      if (!trimmed) {
        redraw();
        return;
      }
      const history = historyRef.current;
      if (history.items[history.items.length - 1] !== trimmed) history.items.push(trimmed);
      history.items = history.items.slice(-200);
      history.index = history.items.length;
      history.draft = "";
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history.items));
      } catch {
        // storage unavailable
      }

      if (trimmed === "clear") {
        clearScreen();
        redraw();
        return;
      }
      callbacks.current.onTranscript({ kind: "command", text: `${PROMPT}${trimmed}` });
      if (trimmed === "history") {
        const out = history.items.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join("\n");
        writeOutput(out);
        callbacks.current.onTranscript({ kind: "stdout", text: out });
        redraw();
        return;
      }

      busyRef.current = true;
      callbacks.current.onBusyChange(true);
      try {
        // No explicit choice (null) -> omit it and the API applies its default region (AWS_REGION).
        const region = usePreferences.getState().region ?? undefined;
        const res = await api.cli(trimmed, region);
        writeOutput(res.stdout);
        writeOutput(res.stderr, "red");
        if (res.stdout) callbacks.current.onTranscript({ kind: "stdout", text: res.stdout });
        if (res.stderr) callbacks.current.onTranscript({ kind: "stderr", text: res.stderr });
        if (res.exitCode !== 0) {
          writeOutput(`exit code ${res.exitCode}`, "dim");
          callbacks.current.onTranscript({ kind: "info", text: `exit code ${res.exitCode}` });
        }
      } catch (err) {
        const e = toDisplayError(err);
        const text = `${e.title}: ${e.code}: ${e.message}`;
        writeOutput(text, "red");
        callbacks.current.onTranscript({ kind: "stderr", text });
      } finally {
        busyRef.current = false;
        callbacks.current.onBusyChange(false);
        lineRef.current = { text: "", cursor: 0 };
        redraw();
      }
    };

    const historyMove = (delta: number) => {
      const h = historyRef.current;
      if (h.items.length === 0) return;
      if (h.index === h.items.length) h.draft = lineRef.current.text;
      h.index = Math.max(0, Math.min(h.items.length, h.index + delta));
      setLine(h.index === h.items.length ? h.draft : h.items[h.index]);
    };

    const disposable = term.onData((data) => {
      if (busyRef.current) {
        if (data === "\x03") term.write("^C");
        return;
      }
      const { text, cursor } = lineRef.current;
      switch (data) {
        case "\r":
          lineRef.current = { text: "", cursor: 0 };
          void run(text);
          return;
        case "\x7f": // Backspace
        case "\b":
          if (cursor > 0) setLine(text.slice(0, cursor - 1) + text.slice(cursor), cursor - 1);
          return;
        case "\x1b[3~": // Delete
          if (cursor < text.length) setLine(text.slice(0, cursor) + text.slice(cursor + 1), cursor);
          return;
        case "\x1b[A":
          historyMove(-1);
          return;
        case "\x1b[B":
          historyMove(1);
          return;
        case "\x1b[C":
          if (cursor < text.length) setLine(text, cursor + 1);
          return;
        case "\x1b[D":
          if (cursor > 0) setLine(text, cursor - 1);
          return;
        case "\x1b[H":
        case "\x01": // Ctrl+A
          setLine(text, 0);
          return;
        case "\x1b[F":
        case "\x05": // Ctrl+E
          setLine(text, text.length);
          return;
        case "\x15": // Ctrl+U
          setLine(text.slice(cursor), 0);
          return;
        case "\x03": // Ctrl+C
          term.write("^C\r\n");
          lineRef.current = { text: "", cursor: 0 };
          redraw();
          return;
        case "\x0c": // Ctrl+L
          clearScreen();
          redraw();
          return;
      }
      if (data.startsWith("\x1b")) return; // other escape sequences
      // Printable input (typing or paste). Newlines in a paste execute line by line is not supported; keep first line.
      const printable = data.replace(/[\r\n][\s\S]*$/, "").replace(/[\x00-\x1f\x7f]/g, "");
      if (!printable) return;
      setLine(text.slice(0, cursor) + printable + text.slice(cursor), cursor + printable.length);
      if (/\r|\n/.test(data)) {
        const full = lineRef.current.text;
        lineRef.current = { text: "", cursor: 0 };
        void run(full);
      }
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore transient layout states
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      disposable.dispose();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the terminal is created once per mount
  }, []);

  return <div ref={containerRef} className="size-full" onClick={() => termRef.current?.focus()} />;
}
