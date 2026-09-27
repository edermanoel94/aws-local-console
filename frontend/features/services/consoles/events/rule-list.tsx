"use client";

import { Plus, Send } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useAwsLoader } from "../_shared/aws";
import { listAllPages } from "../_shared/paginate";
import { ConsoleLink } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";
import { DEFAULT_BUS, type EventBus, type Rule } from "./events-types";

export function useEventBuses() {
  return useAwsLoader(["events", "buses"], async (exec) => ({
    EventBuses: await listAllPages<{ EventBuses?: EventBus[] | null; NextToken?: string | null }, EventBus>(exec, "events", "ListEventBuses", {}, {
      items: (out) => out.EventBuses,
      next: (out) => out.NextToken,
      tokenField: "NextToken",
    }),
  }));
}

export function RuleStateBadge({ state }: { state?: string }) {
  return <Badge tone={state === "ENABLED" ? "green" : "gray"}>{state === "ENABLED" ? "Enabled" : state === "DISABLED" ? "Disabled" : (state ?? "-")}</Badge>;
}

/** Rules of one event bus. With `fixedBus` the bus selector is hidden (bus detail page). */
export function RulesTable({ bus, fixedBus }: { bus: string; fixedBus?: boolean }) {
  const { navigate } = useConsoleNav();
  const buses = useEventBuses();
  const rules = useAwsLoader(["events", "rules", bus], async (exec) => {
    const list = await listAllPages<{ Rules?: Rule[] | null; NextToken?: string | null }, Rule>(exec, "events", "ListRules", { EventBusName: bus }, {
      items: (out) => out.Rules,
      next: (out) => out.NextToken,
      tokenField: "NextToken",
    });
    return list.sort((a, b) => a.Name.localeCompare(b.Name));
  });
  const items = rules.data;
  const busOptions = (buses.data?.EventBuses ?? [{ Name: DEFAULT_BUS }]).map((b) => ({ value: b.Name, label: b.Name }));
  if (!busOptions.some((b) => b.value === bus)) busOptions.unshift({ value: bus, label: bus });

  return (
    <ResourceTable<Rule>
      title="Rules"
      description={`Rules on the ${bus} event bus route matching events to targets.`}
      items={items}
      loading={rules.isLoading}
      fetching={rules.isFetching}
      error={rules.error}
      onRefresh={() => rules.refetch()}
      toolbar={
        !fixedBus && (
          <label className="flex items-center gap-2 text-sm font-bold whitespace-nowrap text-aws-ink">
            Event bus
            <select
              value={bus}
              onChange={(e) => navigate({ prefix: e.target.value === DEFAULT_BUS ? null : e.target.value })}
              className="w-56 rounded-lg border border-aws-border-strong bg-aws-surface px-2.5 py-1.5 text-sm font-normal text-aws-ink focus:border-aws-link focus:ring-1 focus:ring-aws-link focus:outline-none"
            >
              {busOptions.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )
      }
      actions={
        <>
          <Button onClick={() => navigate({ view: "send", prefix: bus === DEFAULT_BUS ? null : bus })}>
            <Send className="size-4" aria-hidden />
            Send events
          </Button>
          <Button variant="primary" onClick={() => navigate({ view: "create-rule", prefix: bus === DEFAULT_BUS ? null : bus })}>
            <Plus className="size-4" aria-hidden />
            Create rule
          </Button>
        </>
      }
      rowKey={(r) => r.Arn ?? r.Name}
      filterText={(r) => `${r.Name} ${r.Description ?? ""}`}
      searchPlaceholder="Find rules by name"
      emptyTitle="No rules"
      emptyDescription="Create a rule to match events and send them to queues, functions or topics."
      columns={[
        { header: "Name", cell: (r) => <ConsoleLink to={{ resource: r.Name, prefix: bus === DEFAULT_BUS ? null : bus }}>{r.Name}</ConsoleLink> },
        { header: "Status", cell: (r) => <RuleStateBadge state={r.State} /> },
        { header: "Type", cell: (r) => (r.ScheduleExpression ? "Scheduled" : "Standard") },
        { header: "Description", cell: (r) => <span className="text-aws-muted">{r.Description || "-"}</span> },
        { header: "Event pattern / schedule", cell: (r) => <span className="line-clamp-2 max-w-md font-mono text-xs leading-5 break-all">{r.ScheduleExpression ?? r.EventPattern ?? "-"}</span> },
      ]}
    />
  );
}

export function RuleList() {
  const { prefix } = useConsoleNav();
  return <RulesTable bus={prefix ?? DEFAULT_BUS} />;
}
