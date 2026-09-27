"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { Eraser, TerminalSquare } from "lucide-react";
import { Button, Loading } from "@/components/ui";
import { useRegion } from "@/hooks/use-region";
import type { CliTerminalHandle, TranscriptEntry } from "./terminal";

const CliTerminal = dynamic(() => import("./terminal"), { ssr: false, loading: () => <Loading label="Starting terminal" className="px-4 text-gray-400" /> });

const EXAMPLES = ["aws s3 ls", "aws sqs list-queues", "aws dynamodb list-tables", "aws lambda list-functions", "aws sns list-topics", "help"];

/**
 * CLI page body: toolbar, xterm terminal and an accessible transcript.
 * The transcript (role="log", aria-live) mirrors commands and output as plain text for screen readers and Playwright.
 */
export function CliConsole() {
  const region = useRegion();
  const handle = useRef<CliTerminalHandle | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);

  const onTranscript = useCallback((entry: Omit<TranscriptEntry, "id">) => {
    const id = nextId.current++;
    setTranscript((t) => [...t.slice(-400), { ...entry, id }]);
  }, []);
  const onClearTranscript = useCallback(() => setTranscript([]), []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-aws-muted">Examples:</span>
        {EXAMPLES.map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={() => handle.current?.setLine(cmd)}
            className="h-7 rounded-full border border-aws-border-strong bg-aws-surface px-3 font-mono text-[12px] text-aws-ink hover:border-aws-link hover:text-aws-link"
          >
            {cmd}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-aws-muted">
            Region <strong className="text-aws-ink">{region}</strong>
          </span>
          <Button size="sm" onClick={() => handle.current?.clear()}>
            <Eraser className="size-3.5" aria-hidden /> Clear
          </Button>
        </div>
      </div>

      <section aria-label="Terminal" className="overflow-hidden rounded-2xl border border-aws-squid bg-aws-squid shadow-lg">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2 text-xs text-gray-400">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <TerminalSquare className="ml-2 size-3.5" aria-hidden />
          <span>aws-local-console - bash</span>
          {busy && <span className="ml-auto text-aws-orange">running...</span>}
        </div>
        <div className="h-[calc(100vh-19rem)] min-h-[420px] px-3 py-2">
          <CliTerminal handleRef={handle} onTranscript={onTranscript} onClearTranscript={onClearTranscript} onBusyChange={setBusy} />
        </div>
      </section>

      <div role="log" aria-live="polite" aria-label="Terminal output" className="visually-hidden">
        {transcript.map((e) => (
          <pre key={e.id} data-kind={e.kind}>
            {e.text}
          </pre>
        ))}
      </div>
    </div>
  );
}
