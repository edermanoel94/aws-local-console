"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, CodeBlock, EmptyState, ErrorAlert, Loading, Panel, SelectField, Table, Td, TextAreaField, Th, Tr } from "@/components/ui";
import { api } from "@/lib/api";
import { useRegion } from "@/hooks/use-region";
import type { ApiGatewayInvokeResponse } from "@/types/api";
import { CopyableText, KeyValueEditor, SuggestField, fromKeyValues, type KeyValue } from "../_shared/controls";
import { prettyJson } from "../_shared/format";
import { DetailsGrid } from "../_shared/layout";
import { HTTP_METHODS } from "./apigw-types";
import { useApiResources } from "./resources-tab";
import { useStages } from "./stages-tab";

const schema = z.object({
  stage: z.string().min(1, "Deploy the API to a stage first."),
  method: z.string(),
  path: z.string().trim().regex(/^\//, 'The path must start with "/".'),
  body: z.string(),
});

type FormValues = z.infer<typeof schema>;

/** Calls a deployed stage through the Go API invoke proxy (Floci has no TestInvokeMethod). */
export function InvokeTab({ apiId }: { apiId: string }) {
  const region = useRegion();
  const qc = useQueryClient();
  const stages = useStages(apiId);
  const resources = useApiResources(apiId);
  const [headers, setHeaders] = useState<KeyValue[]>([{ key: "Content-Type", value: "application/json" }]);
  const stageNames = (stages.data?.Item ?? []).map((s) => s.StageName);
  const paths = [...new Set((resources.data?.Items ?? []).map((r) => r.Path))].sort();

  const form = useForm<FormValues>({ resolver: zodResolver(schema), values: { stage: stageNames[0] ?? "", method: "GET", path: paths.find((p) => p !== "/") ?? "/", body: "" }, resetOptions: { keepDirtyValues: true } });

  const invoke = useMutation<ApiGatewayInvokeResponse, Error, FormValues>({
    mutationFn: (v) =>
      api.apigatewayInvoke({
        restApiId: apiId,
        stage: v.stage,
        method: v.method,
        path: v.path,
        headers: fromKeyValues(headers),
        ...(v.body && v.method !== "GET" && v.method !== "HEAD" ? { body: v.body } : {}),
        region,
      }),
    onSuccess: () => {
      for (const key of [["logs"], ["events"], ["dashboard"]]) qc.invalidateQueries({ queryKey: key });
    },
  });

  const { errors } = form.formState;
  if (stages.isLoading) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Invoke API" description="Send an HTTP request to a deployed stage. The request goes through the AWS Local Console API to Floci.">
        {stageNames.length === 0 ? (
          <EmptyState title="No stages" description="Choose Deploy API to deploy the API to a stage before invoking it." />
        ) : (
          <form noValidate onSubmit={form.handleSubmit((v) => invoke.mutate(v))} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-[180px_140px_1fr]">
              <SelectField label="Stage" options={stageNames.map((s) => ({ value: s, label: s }))} error={errors.stage?.message} {...form.register("stage")} />
              <SelectField label="Method" options={HTTP_METHODS.filter((m) => m !== "ANY").map((m) => ({ value: m, label: m }))} {...form.register("method")} />
              <SuggestField label="Path" placeholder="/hello?name=world" suggestions={paths.map((p) => ({ value: p }))} error={errors.path?.message} {...form.register("path")} />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-bold">Headers</p>
              <KeyValueEditor rows={headers} onChange={setHeaders} keyLabel="Header name" valueLabel="Header value" addLabel="Add header" emptyText="No headers." />
            </div>
            <TextAreaField label="Request body" rows={5} placeholder='{"amount": 42}' description="Ignored for GET and HEAD requests." {...form.register("body")} />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={invoke.isPending}>
                Invoke
              </Button>
            </div>
          </form>
        )}
      </Panel>
      {invoke.error && <ErrorAlert error={invoke.error} />}
      {invoke.data && <InvokeResponse response={invoke.data} />}
    </div>
  );
}

function InvokeResponse({ response }: { response: ApiGatewayInvokeResponse }) {
  const ok = response.status < 400;
  const headers = Object.entries(response.headers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Response
          <Badge tone={ok ? "green" : "red"}>Status: {response.status}</Badge>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <DetailsGrid
          columns={4}
          items={[
            { label: "Status code", value: String(response.status) },
            { label: "Duration", value: `${response.durationMs} ms` },
            { label: "Request URL", value: <CopyableText value={response.url} label="Copy request URL" />, wide: true },
          ]}
        />
        <div>
          <p className="mb-1 text-sm font-bold">Response body</p>
          <CodeBlock text={response.body ? prettyJson(response.body) : "(empty)"} label="Response body" className="max-h-96 leading-normal whitespace-pre-wrap" />
        </div>
        <div>
          <p className="mb-1 text-sm font-bold">Response headers</p>
          <Table aria-label="Response headers">
            <thead>
              <tr>
                <Th>Header</Th>
                <Th>Value</Th>
              </tr>
            </thead>
            <tbody>
              {headers.map(([k, v]) => (
                <Tr key={k}>
                  <Td className="font-mono text-xs">{k}</Td>
                  <Td className="font-mono text-xs break-all">{v}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </Panel>
  );
}
