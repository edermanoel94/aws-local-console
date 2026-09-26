"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button, ErrorAlert, Loading, Panel } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAwsQuery, useConsoleAction } from "../_shared/aws";
import { CodeField } from "../_shared/controls";
import { isJson, prettyJson } from "../_shared/format";
import { DetailsGrid } from "../_shared/layout";
import { logGroupOf, type FunctionConfiguration } from "./lambda-types";

const DEFAULT_EVENT = `{
  "key1": "value1",
  "key2": "value2",
  "key3": "value3"
}`;

interface InvokeOutput {
  StatusCode?: number;
  FunctionError?: string | null;
  ExecutedVersion?: string;
  LogResult?: string | null;
  Payload?: string | { base64: string } | null;
}

interface InvokeResult {
  output: InvokeOutput;
  startedAt: number;
  durationMs: number;
}

function payloadText(payload: InvokeOutput["Payload"]): string {
  if (payload === undefined || payload === null) return "";
  if (typeof payload === "string") return payload;
  try {
    return atob(payload.base64);
  } catch {
    return payload.base64;
  }
}

function decodeLogResult(value: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
  } catch {
    return value;
  }
}

export function TestTab({ fn }: { fn: FunctionConfiguration }) {
  const [event, setEvent] = useState(DEFAULT_EVENT);
  const [eventError, setEventError] = useState<string>();

  const invoke = useConsoleAction<string, InvokeResult>({
    run: async (payload, exec) => {
      const startedAt = Date.now();
      const output = await exec<InvokeOutput>("lambda", "Invoke", { FunctionName: fn.FunctionName, Payload: payload, LogType: "Tail" });
      return { output, startedAt, durationMs: Date.now() - startedAt };
    },
  });

  const submit = () => {
    if (!isJson(event)) {
      setEventError("The event must be valid JSON.");
      return;
    }
    setEventError(undefined);
    invoke.mutate(event);
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Test event"
        description="Invoke the function synchronously (RequestResponse) with a JSON event."
        actions={
          <Button variant="primary" loading={invoke.isPending} onClick={submit}>
            Invoke
          </Button>
        }
      >
        <CodeField label="Event JSON" value={event} onChange={setEvent} rows={10} error={eventError} />
      </Panel>
      {invoke.error && <ErrorAlert error={invoke.error} />}
      {invoke.isPending && (
        <Panel title="Execution result">
          <Loading label="Invoking function" />
        </Panel>
      )}
      {invoke.data && !invoke.isPending && <ExecutionResult key={invoke.data.startedAt} fn={fn} result={invoke.data} />}
    </div>
  );
}

function ExecutionResult({ fn, result }: { fn: FunctionConfiguration; result: InvokeResult }) {
  const { output } = result;
  const failed = !!output.FunctionError;
  const payload = payloadText(output.Payload);
  const tail = output.LogResult ? decodeLogResult(output.LogResult) : null;

  return (
    <Panel
      title={
        <span className={cn("flex items-center gap-2", failed ? "text-aws-red" : "text-aws-green")}>
          {failed ? <XCircle className="size-5" aria-hidden /> : <CheckCircle2 className="size-5" aria-hidden />}
          Execution result: {failed ? "failed" : "succeeded"}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <DetailsGrid
          columns={4}
          items={[
            { label: "Status code", value: String(output.StatusCode ?? "-") },
            { label: "Function error", value: output.FunctionError || "None" },
            { label: "Executed version", value: output.ExecutedVersion },
            { label: "Duration", value: `${result.durationMs} ms` },
          ]}
        />
        <div>
          <p className="mb-1 text-sm font-bold">Response</p>
          <pre aria-label="Response payload" className="max-h-80 overflow-auto rounded-lg border border-aws-border bg-aws-panel p-3 font-mono text-xs whitespace-pre-wrap">
            {payload ? prettyJson(payload) : "null"}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-sm font-bold">Log output</p>
          {tail !== null ? <LogBlock text={tail} /> : <LogsSince fn={fn} since={result.startedAt} />}
        </div>
      </div>
    </Panel>
  );
}

function LogBlock({ text }: { text: string }) {
  return (
    <pre aria-label="Log output" className="max-h-80 overflow-auto rounded-lg bg-aws-squid p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-[#e6edf3]">
      {text || "No log output."}
    </pre>
  );
}

interface LogEvents {
  events?: { timestamp?: number; message?: string }[] | null;
}

/** Floci does not return LogResult; tail the function's CloudWatch Logs group instead (polls for up to ~10 seconds). */
function LogsSince({ fn, since }: { fn: FunctionConfiguration; since: number }) {
  const logs = useAwsQuery<LogEvents>(
    "logs",
    "FilterLogEvents",
    { LogGroupName: logGroupOf(fn), StartTime: since - 1000 },
    {
      retry: false,
      refetchInterval: (query) => ((query.state.data?.events?.length ?? 0) > 0 || query.state.dataUpdateCount + query.state.errorUpdateCount >= 10 ? false : 1000),
    },
  );
  const events = logs.data?.events ?? [];
  const gaveUp = Math.max(logs.dataUpdatedAt, logs.errorUpdatedAt) - since > 9000;
  if (logs.isLoading) return <Loading label="Loading logs" />;
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-aws-border bg-aws-panel px-3 py-2 text-sm text-aws-muted">
        {gaveUp ? `No log events found in ${logGroupOf(fn)} for this invocation.` : "Waiting for log events..."}
      </p>
    );
  }
  return <LogBlock text={events.map((e) => (e.message ?? "").trimEnd()).join("\n")} />;
}
