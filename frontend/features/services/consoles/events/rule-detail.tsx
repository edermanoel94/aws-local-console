"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, ConfirmDeleteDialog, Dialog, ErrorAlert, Loading, Panel } from "@/components/ui";
import { nameFromArn, useAwsQuery, useConsoleAction } from "../_shared/aws";
import { ConfirmDialog, CopyableText, RemoveIconButton } from "../_shared/controls";
import { prettyJson } from "../_shared/format";
import { ConsoleHeader, DetailsGrid } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";
import { DEFAULT_BUS, targetTypeOf, type Rule, type Target, type TargetType } from "./events-types";
import { RuleStateBadge } from "./rule-list";
import { addTarget, TargetFields } from "./targets";

export function RuleDetail({ ruleName }: { ruleName: string }) {
  const { prefix, navigate } = useConsoleNav();
  const bus = prefix ?? DEFAULT_BUS;
  const busParam = bus === DEFAULT_BUS ? null : bus;
  const rule = useAwsQuery<Rule>("events", "DescribeRule", { Name: ruleName, EventBusName: bus });
  const targets = useAwsQuery<{ Targets?: Target[] | null }>("events", "ListTargetsByRule", { Rule: ruleName, EventBusName: bus });
  const [dialog, setDialog] = useState<"delete" | "add-target" | null>(null);
  const [removingTarget, setRemovingTarget] = useState<Target | null>(null);
  const enabled = rule.data?.State === "ENABLED";

  const toggle = useConsoleAction({
    run: (_: void, exec) => exec("events", enabled ? "DisableRule" : "EnableRule", { Name: ruleName, EventBusName: bus }),
    successMessage: () => `Rule ${ruleName} ${enabled ? "disabled" : "enabled"}`,
  });
  const remove = useConsoleAction({
    run: async (_: void, exec) => {
      const ids = (targets.data?.Targets ?? []).map((t) => t.Id);
      if (ids.length) await exec("events", "RemoveTargets", { Rule: ruleName, EventBusName: bus, Ids: ids });
      await exec("events", "DeleteRule", { Name: ruleName, EventBusName: bus });
    },
    successMessage: () => `Rule ${ruleName} deleted`,
    onSuccess: () => navigate({ prefix: busParam }),
  });
  const removeTarget = useConsoleAction<Target>({
    run: (t, exec) => exec("events", "RemoveTargets", { Rule: ruleName, EventBusName: bus, Ids: [t.Id] }),
    successMessage: (t) => `Target ${t.Id} removed`,
    onSuccess: () => setRemovingTarget(null),
  });

  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "Rules", to: { prefix: busParam } }, { label: ruleName }]}
        title={ruleName}
        badge={rule.data && <RuleStateBadge state={rule.data.State} />}
        actions={
          <>
            <Button onClick={() => toggle.mutate()} loading={toggle.isPending} disabled={!rule.data}>
              {enabled ? "Disable" : "Enable"}
            </Button>
            <Button variant="danger" onClick={() => setDialog("delete")} disabled={!rule.data}>
              Delete
            </Button>
          </>
        }
      />
      {toggle.error && <ErrorAlert error={toggle.error} />}
      {rule.error ? (
        <ErrorAlert error={rule.error} />
      ) : rule.isLoading || !rule.data ? (
        <Loading />
      ) : (
        <>
          <Panel title="Rule details">
            <DetailsGrid
              items={[
                { label: "Rule name", value: rule.data.Name },
                { label: "Status", value: <RuleStateBadge state={rule.data.State} /> },
                { label: "Event bus", value: rule.data.EventBusName ?? bus },
                { label: "Type", value: rule.data.ScheduleExpression ? "Scheduled" : "Standard" },
                { label: "Description", value: rule.data.Description },
                { label: "Rule ARN", value: rule.data.Arn ? <CopyableText value={rule.data.Arn} label="Copy rule ARN" /> : "-" },
              ]}
            />
          </Panel>
          <Panel title={rule.data.ScheduleExpression ? "Schedule" : "Event pattern"}>
            <pre aria-label={rule.data.ScheduleExpression ? "Schedule expression" : "Event pattern JSON"} className="max-h-80 overflow-auto rounded-lg border border-aws-border bg-aws-panel p-3 font-mono text-xs whitespace-pre-wrap">
              {rule.data.ScheduleExpression ?? prettyJson(rule.data.EventPattern ?? "")}
            </pre>
          </Panel>
        </>
      )}
      <ResourceTable<Target>
        title="Targets"
        items={targets.data ? (targets.data.Targets ?? []) : undefined}
        loading={targets.isLoading}
        fetching={targets.isFetching}
        error={targets.error}
        onRefresh={() => targets.refetch()}
        actions={
          <Button variant="primary" onClick={() => setDialog("add-target")} disabled={!rule.data}>
            <Plus className="size-4" aria-hidden />
            Add target
          </Button>
        }
        rowKey={(t) => t.Id}
        filterText={(t) => `${t.Id} ${t.Arn}`}
        searchPlaceholder="Find targets"
        emptyTitle="No targets"
        emptyDescription="Matching events are dropped until you add a target."
        columns={[
          { header: "Target ID", cell: (t) => <span className="font-mono text-xs">{t.Id}</span> },
          { header: "Type", cell: (t) => targetTypeOf(t.Arn) },
          { header: "Name", cell: (t) => <span className="font-bold">{nameFromArn(t.Arn)}</span> },
          { header: "ARN", cell: (t) => <span className="font-mono text-xs break-all">{t.Arn}</span> },
          { header: "Actions", className: "w-px text-right", cell: (t) => <RemoveIconButton label={`Remove target ${t.Id}`} onClick={() => setRemovingTarget(t)} /> },
        ]}
      />
      {dialog === "add-target" && rule.data && (
        <AddTargetDialog rule={{ name: ruleName, bus, arn: rule.data.Arn }} existingIds={(targets.data?.Targets ?? []).map((t) => t.Id)} onClose={() => setDialog(null)} />
      )}
      <ConfirmDeleteDialog
        open={dialog === "delete"}
        onClose={() => {
          setDialog(null);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        resourceKind="rule"
        resourceName={ruleName}
        loading={remove.isPending}
        error={remove.error}
      />
      <ConfirmDialog
        open={!!removingTarget}
        onClose={() => {
          setRemovingTarget(null);
          removeTarget.reset();
        }}
        onConfirm={() => removingTarget && removeTarget.mutate(removingTarget)}
        title="Remove target"
        confirmLabel="Confirm remove"
        loading={removeTarget.isPending}
        error={removeTarget.error}
      >
        <p>
          Stop sending events from <strong>{ruleName}</strong> to <strong className="break-all">{removingTarget ? nameFromArn(removingTarget.Arn) : ""}</strong>?
        </p>
      </ConfirmDialog>
    </>
  );
}

function AddTargetDialog({ rule, existingIds, onClose }: { rule: { name: string; bus: string; arn?: string }; existingIds: string[]; onClose: () => void }) {
  const [type, setType] = useState<TargetType>("sqs");
  const [arn, setArn] = useState("");
  const [error, setError] = useState<string>();
  const add = useConsoleAction<string>({
    run: (targetArn, exec) => addTarget(exec, rule, targetArn, existingIds),
    successMessage: (targetArn) => `Target ${nameFromArn(targetArn)} added to rule ${rule.name}`,
    onSuccess: onClose,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add target"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={add.isPending}
            onClick={() => {
              if (!arn) {
                setError("Choose a target.");
                return;
              }
              setError(undefined);
              add.mutate(arn);
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TargetFields type={type} arn={arn} onTypeChange={setType} onArnChange={setArn} error={error} />
        {add.error && <ErrorAlert error={add.error} />}
      </div>
    </Dialog>
  );
}
