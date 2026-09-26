"use client";

import { useState } from "react";
import { Badge, Button, ConfirmDeleteDialog, ErrorAlert, Loading, Panel, Tabs } from "@/components/ui";
import { useRegion } from "@/hooks/use-region";
import { useAwsQuery, useConsoleAction } from "../_shared/aws";
import { CopyableText } from "../_shared/controls";
import { formatBytes, formatDateTime } from "../_shared/format";
import { ConsoleHeader, DetailsGrid } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { runtimeLabel } from "./function-list";
import type { FunctionConfiguration } from "./lambda-types";
import { forgetCode } from "./runtimes";
import { CodeTab } from "./code-tab";
import { TestTab } from "./test-tab";
import { ConfigurationTab } from "./configuration-tab";
import { TriggersTab } from "./triggers-tab";
import { LogsTab } from "./logs-tab";

type FunctionTab = "code" | "test" | "configuration" | "triggers" | "logs";

const TABS: { value: FunctionTab; label: string }[] = [
  { value: "code", label: "Code" },
  { value: "test", label: "Test" },
  { value: "configuration", label: "Configuration" },
  { value: "triggers", label: "Triggers" },
  { value: "logs", label: "Logs" },
];

export function FunctionDetail({ functionName }: { functionName: string }) {
  const { detail, navigate } = useConsoleNav();
  const region = useRegion();
  const tab: FunctionTab = TABS.some((t) => t.value === detail) ? (detail as FunctionTab) : "code";
  const fn = useAwsQuery<FunctionConfiguration>("lambda", "GetFunctionConfiguration", { FunctionName: functionName });
  const [deleting, setDeleting] = useState(false);

  const remove = useConsoleAction({
    run: (_: void, exec) => exec("lambda", "DeleteFunction", { FunctionName: functionName }),
    successMessage: () => `Function ${functionName} deleted`,
    onSuccess: () => {
      forgetCode(region, functionName);
      navigate({});
    },
  });

  const f = fn.data;
  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "Functions", to: {} }, { label: functionName }]}
        title={functionName}
        badge={f?.State && <Badge tone={f.State === "Active" ? "green" : f.State === "Failed" ? "red" : "orange"}>{f.State}</Badge>}
        actions={
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
      />
      {fn.error ? (
        <ErrorAlert error={fn.error} />
      ) : fn.isLoading || !f ? (
        <Loading />
      ) : (
        <>
          <Panel title="Function overview">
            <DetailsGrid
              columns={4}
              items={[
                { label: "Runtime", value: runtimeLabel(f.Runtime) },
                { label: "Handler", value: f.Handler, mono: true },
                { label: "Memory", value: f.MemorySize ? `${f.MemorySize} MB` : "-" },
                { label: "Timeout", value: f.Timeout ? `${f.Timeout} sec` : "-" },
                { label: "Description", value: f.Description },
                { label: "Last modified", value: formatDateTime(f.LastModified) },
                { label: "Code size", value: formatBytes(f.CodeSize) },
                { label: "Package type", value: f.PackageType ?? "Zip" },
                { label: "Function ARN", value: <CopyableText value={f.FunctionArn} label="Copy function ARN" />, wide: true },
                { label: "Execution role", value: f.Role ? <CopyableText value={f.Role} label="Copy execution role ARN" /> : undefined, wide: true },
              ]}
            />
          </Panel>
          <Tabs label="Function sections" tabs={TABS} value={tab} onChange={(t) => navigate({ resource: functionName, detail: t })} />
          {tab === "code" && <CodeTab fn={f} />}
          {tab === "test" && <TestTab fn={f} />}
          {tab === "configuration" && <ConfigurationTab key={f.LastModified} fn={f} />}
          {tab === "triggers" && <TriggersTab fn={f} />}
          {tab === "logs" && <LogsTab fn={f} />}
        </>
      )}
      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        resourceKind="function"
        resourceName={functionName}
        loading={remove.isPending}
        error={remove.error}
      />
    </>
  );
}
