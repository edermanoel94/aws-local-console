"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCcw } from "lucide-react";
import type { ExecuteResponse, OperationInfo } from "@/types/api";
import { api } from "@/lib/api";
import { Badge, Button, ErrorAlert, Loading, Panel, SelectField } from "@/components/ui";
import { JsonEditor, parseJson } from "@/components/editors/json-editor";
import { RequestInspector, fromExecuteResponse } from "@/components/aws/request-inspector";
import { CoverageBadge } from "@/components/aws/status-badges";
import { useRegions, useService, useServices } from "@/hooks/use-queries";
import { useRegion } from "@/hooks/use-region";
import { toKebabCase } from "@/lib/format";

interface ApiExplorerProps {
  /** Locks the explorer to one service (used by the service detail "API Explorer" tab). */
  presetService?: string;
}

/** Simplest read-only List* operation (fewest required inputs, then shortest name), e.g. ListBuckets or ListQueues. */
function defaultOperation(operations: OperationInfo[]): OperationInfo | undefined {
  const required = (o: OperationInfo) => o.inputFields.filter((f) => f.required).length;
  const lists = operations.filter((o) => o.name.startsWith("List") && !o.mutating);
  return [...lists].sort((a, b) => required(a) - required(b) || a.name.length - b.name.length)[0] ?? operations[0];
}

function exampleText(op: OperationInfo | undefined): string {
  return JSON.stringify(op?.inputExample ?? {}, null, 2);
}

/**
 * Generic operation runner: pick service / operation / region, edit the JSON input, Execute,
 * then inspect Status, Duration, Request ID and the Request / Response / Headers tabs.
 * Standalone mode keeps ?service=&operation= in the URL.
 */
export function ApiExplorer({ presetService }: ApiExplorerProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const globalRegion = useRegion();
  const qc = useQueryClient();

  const embedded = !!presetService;
  const [service, setService] = useState(presetService ?? searchParams.get("service") ?? "s3");
  const [requestedOperation, setRequestedOperation] = useState(searchParams.get("operation") ?? "");
  const [regionOverride, setRegionOverride] = useState<string | null>(null);
  const region = regionOverride ?? globalRegion;
  // Edited input text, remembered per operation; falls back to the operation's inputExample.
  const [edited, setEdited] = useState<{ key: string; text: string } | null>(null);
  const [result, setResult] = useState<ExecuteResponse | null>(null);

  const services = useServices();
  const detail = useService(service);
  const regions = useRegions();

  const operations = useMemo(() => [...(detail.data?.operations ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [detail.data]);
  // Unknown or empty selection falls back to the first read-only List* operation.
  const selectedOp = operations.find((o) => o.name === requestedOperation) ?? defaultOperation(operations);
  const operation = selectedOp?.name ?? requestedOperation;
  const opKey = `${service}:${operation}`;
  const inputText = edited?.key === opKey ? edited.text : exampleText(selectedOp);
  const setInputText = (text: string) => setEdited({ key: opKey, text });

  // Keep the URL shareable in standalone mode.
  useEffect(() => {
    if (embedded || !selectedOp) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("service") === service && params.get("operation") === operation) return;
    params.set("service", service);
    params.set("operation", operation);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [embedded, selectedOp, service, operation, pathname, router, searchParams]);

  const parsed = useMemo(() => parseJson(inputText), [inputText]);
  const inputIsObject = parsed.value !== undefined && typeof parsed.value === "object" && !Array.isArray(parsed.value) && parsed.value !== null;

  const execute = useMutation({
    mutationFn: () => api.execute({ service, operation, region, input: parsed.value as Record<string, unknown> }, "api-explorer"),
    onSuccess: (res) => {
      setResult(res);
      for (const key of [["logs"], ["events"], ["dashboard"], ["resources"], ["architecture"], ["services"]]) qc.invalidateQueries({ queryKey: key });
    },
    onError: () => setResult(null),
  });

  const canExecute = !!selectedOp && !parsed.error && inputIsObject && !execute.isPending;
  const run = () => {
    if (canExecute) execute.mutate();
  };

  const serviceOptions = (services.data ?? []).map((s) => ({ value: s.id, label: `${s.shortName} (${s.id})` }));
  if (!serviceOptions.some((o) => o.value === service)) serviceOptions.unshift({ value: service, label: service });
  const regionOptions = (regions.data ?? [{ name: region, label: region, default: true }]).map((r) => ({ value: r.name, label: r.name }));
  if (!regionOptions.some((o) => o.value === region)) regionOptions.unshift({ value: region, label: region });
  const operationOptions = operations.map((o) => ({ value: o.name, label: o.name }));

  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          run();
        }
      }}
    >
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Request" description="Choose an operation, adjust the JSON input and execute it against Floci.">
          <div className="flex flex-col gap-4">
            <div className={`grid grid-cols-1 gap-3 ${embedded ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
              {!embedded && (
                <SelectField
                  label="Service"
                  value={service}
                  onChange={(e) => {
                    setService(e.target.value);
                    setRequestedOperation("");
                    setResult(null);
                  }}
                  options={serviceOptions}
                />
              )}
              <SelectField
                label="Operation"
                value={operation}
                disabled={detail.isPending || operationOptions.length === 0}
                onChange={(e) => {
                  setRequestedOperation(e.target.value);
                  setResult(null);
                }}
                options={operationOptions.length ? operationOptions : [{ value: operation, label: detail.isPending ? "Loading operations..." : operation || "No operations" }]}
              />
              <SelectField label="Region" value={region} onChange={(e) => setRegionOverride(e.target.value)} options={regionOptions} />
            </div>

            {detail.isError && <ErrorAlert error={detail.error} />}

            <JsonEditor
              label="Input"
              value={inputText}
              onChange={setInputText}
              height={300}
              description={selectedOp ? `${selectedOp.name} input as AWS SDK JSON (PascalCase fields).` : undefined}
              toolbar={
                selectedOp && (
                  <button
                    type="button"
                    onClick={() => setInputText(exampleText(selectedOp))}
                    className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-bold text-aws-link hover:bg-aws-panel"
                  >
                    <RotateCcw className="size-3.5" aria-hidden /> Reset example
                  </button>
                )
              }
            />
            {!parsed.error && !inputIsObject && <p className="text-xs text-aws-red">The input must be a JSON object.</p>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-aws-muted">
                <kbd className="rounded border border-aws-border-strong px-1">Ctrl</kbd> + <kbd className="rounded border border-aws-border-strong px-1">Enter</kbd> to execute
              </p>
              <Button variant="primary" onClick={run} disabled={!canExecute} loading={execute.isPending}>
                {!execute.isPending && <Play className="size-3.5" aria-hidden />}
                Execute
              </Button>
            </div>
          </div>
        </Panel>

        <OperationDetails operation={selectedOp} loading={detail.isPending} service={service} />
      </div>

      <Panel title="Result" actions={result && <Link href={`/logs?id=${encodeURIComponent(result.id)}`} className="text-sm font-bold">Open in Logs</Link>}>
        {execute.isPending ? (
          <Loading label="Executing" />
        ) : execute.isError ? (
          <ErrorAlert error={execute.error} />
        ) : result ? (
          <RequestInspector execution={fromExecuteResponse(result)} />
        ) : (
          <p className="py-6 text-center text-sm text-aws-muted">Execute an operation to see the status, duration, request, response and headers.</p>
        )}
      </Panel>
    </div>
  );
}

function OperationDetails({ operation, loading, service }: { operation?: OperationInfo; loading: boolean; service: string }) {
  return (
    <Panel title="Operation details">
      {loading ? (
        <Loading />
      ) : !operation ? (
        <p className="text-sm text-aws-muted">No operation selected.</p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <p className="font-mono text-[15px] font-bold break-all">{operation.name}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <CoverageBadge coverage={operation.coverage} />
              <Badge tone={operation.mutating ? "orange" : "blue"}>{operation.mutating ? "Write" : "Read"}</Badge>
            </div>
          </div>
          <div>
            <p className="text-xs text-aws-muted">CLI</p>
            <p className="mt-0.5 font-mono text-[12px] [overflow-wrap:anywhere]">
              aws {service} {toKebabCase(operation.name)}
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-aws-muted">Input fields ({operation.inputFields.length})</p>
            {operation.inputFields.length === 0 ? (
              <p className="text-aws-muted">This operation takes no input.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-aws-border overflow-y-auto rounded-lg border border-aws-border">
                {[...operation.inputFields]
                  .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name))
                  .map((f) => (
                    <li key={f.name} className="px-3 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-mono text-[12px]">
                          {f.name}
                          {f.required && <span className="ml-1 text-aws-red" title="Required">*</span>}
                        </span>
                        <span className="max-w-[45%] shrink-0 truncate text-[11px] text-aws-muted" title={f.type}>
                          {f.type}
                        </span>
                      </div>
                      {f.enum && f.enum.length > 0 && (
                        <p className="mt-0.5 truncate text-[11px] text-aws-muted" title={f.enum.join(", ")}>
                          {f.enum.join(" | ")}
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
