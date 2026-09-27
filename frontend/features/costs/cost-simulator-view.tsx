"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { Button, EmptyState, ErrorAlert, Loading, Panel, Table, Td, Th, Tr } from "@/components/ui";
import { PageHeader } from "@/components/layout/page-header";
import { ServiceIcon, SERVICE_SHORT_NAMES, serviceColor } from "@/components/aws/service-icon";
import { useResources } from "@/hooks/use-queries";
import { useRegion } from "@/hooks/use-region";
import { useHydrated } from "@/hooks/use-hydrated";
import { useCostSimulator } from "@/stores/cost-simulator";
import { toast } from "@/stores/toast";
import { ASSUMPTION_FIELDS, estimateCosts, formatUsd, type AssumptionField, type PricedService, type ServiceEstimate } from "./pricing";

/** Monthly AWS cost estimate of the resources of the selected region, from editable usage assumptions. */
export function CostSimulatorView() {
  const region = useRegion();
  const hydrated = useHydrated();
  const resources = useResources({ region });
  const assumptions = useCostSimulator((s) => s.assumptions);
  const reset = useCostSimulator((s) => s.reset);
  // Usage inputs are uncontrolled while typing; a new key remounts them with the defaults after a reset.
  const [revision, setRevision] = useState(0);

  const estimates = resources.data ? estimateCosts(resources.data.resources, assumptions) : [];
  const monthly = estimates.reduce((sum, e) => sum + e.monthly, 0);
  const resourceCount = estimates.reduce((sum, e) => sum + e.resourceCount, 0);
  const ready = hydrated && !!resources.data;
  const refreshing = resources.isFetching && !resources.isPending;

  return (
    <>
      <PageHeader
        title="Cost Simulator"
        description={`What the resources of ${region} would cost per month on AWS, for the usage you expect.`}
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "Cost Simulator" }]}
        actions={
          <>
            <Button
              onClick={() => {
                reset();
                setRevision((r) => r + 1);
                toast.success("Usage assumptions reset to the defaults");
              }}
            >
              <RotateCcw className="size-4" aria-hidden />
              Reset usage
            </Button>
            <Button onClick={() => resources.refetch()} loading={refreshing}>
              {!refreshing && <RefreshCw className="size-4" aria-hidden />}
              Refresh
            </Button>
          </>
        }
      />

      {resources.isError && <ErrorAlert error={resources.error} className="mb-4" />}
      {resources.data && resources.data.errors.length > 0 && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-aws-border bg-aws-warning-bg px-5 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-aws-orange-dark" aria-hidden />
          <p>
            Some services could not be listed, so their cost is missing:{" "}
            {resources.data.errors.map((e) => (
              <span key={e.service} className="mr-2">
                <strong>{e.service}</strong> ({e.message})
              </span>
            ))}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard label="Monthly estimate" loading={!ready} value={formatUsd(monthly)} hint="On-demand list prices" />
        <SummaryCard label="Yearly estimate" loading={!ready} value={formatUsd(monthly * 12)} hint="12 months at the same usage" />
        <SummaryCard label="Resources priced" loading={!ready} value={String(resourceCount)} hint={ready ? `across ${estimates.length} ${estimates.length === 1 ? "service" : "services"} in ${region}` : `in ${region}`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          {!ready ? (
            <Panel>
              <Loading />
            </Panel>
          ) : estimates.length === 0 ? (
            <Panel>
              <EmptyState
                title="No resources to price yet"
                description={`Create a function, bucket, queue or table in ${region} and its monthly cost shows up here.`}
                action={<Link href="/services">Browse services</Link>}
              />
            </Panel>
          ) : (
            estimates.map((estimate) => <ServiceCostPanel key={`${estimate.service}-${revision}`} estimate={estimate} />)
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <CostByService estimates={estimates} monthly={monthly} loading={!ready} />
          <PricingNotes />
        </div>
      </div>
    </>
  );
}

function SummaryCard({ label, value, hint, loading }: { label: string; value: string; hint: string; loading: boolean }) {
  const id = `cost-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-aws-border bg-aws-surface px-5 py-4 shadow-sm">
      <h2 id={id} className="text-sm font-bold text-aws-muted">
        {label}
      </h2>
      <p className="mt-1 text-4xl leading-none font-light text-aws-ink tabular-nums" data-testid={`${id}-value`}>
        {loading ? <span className="inline-block h-9 w-24 animate-pulse rounded bg-aws-panel" aria-label="Loading" /> : value}
      </p>
      <p className="mt-2 text-xs text-aws-muted">{hint}</p>
    </section>
  );
}

function serviceName(service: string): string {
  return SERVICE_SHORT_NAMES[service] ?? service;
}

function ServiceCostPanel({ estimate }: { estimate: ServiceEstimate }) {
  const name = serviceName(estimate.service);
  const priced = estimate.lines.length > 0;
  return (
    <section aria-label={`${name} cost`}>
      <Panel
        title={
          <span className="inline-flex items-center gap-2 align-middle">
            <ServiceIcon service={estimate.service} size="sm" />
            {name}
          </span>
        }
        count={estimate.resourceCount}
        actions={
          <p className="text-right">
            <span className="block text-lg leading-tight font-bold tabular-nums" data-testid={`cost-${estimate.service}-monthly`}>
              {priced ? formatUsd(estimate.monthly) : "-"}
            </span>
            <span className="text-xs text-aws-muted">per month</span>
          </p>
        }
        bodyClassName="p-0"
      >
        {estimate.assumptions && <UsageFields service={estimate.assumptions} />}
        {priced ? (
          <Table aria-label={`${name} cost breakdown`} className="[&_td]:align-middle [&_tr:last-child_td]:border-b-0">
            <thead>
              <tr>
                <Th className="pl-5">Item</Th>
                <Th className="text-right">Quantity</Th>
                <Th className="text-right">Price</Th>
                <Th className="pr-5 text-right">Monthly</Th>
              </tr>
            </thead>
            <tbody>
              {estimate.lines.map((line) => (
                <Tr key={line.item}>
                  <Td className="pl-5">{line.item}</Td>
                  <Td className="text-right tabular-nums">{line.quantity}</Td>
                  <Td className="text-right text-aws-muted tabular-nums">{line.price}</Td>
                  <Td className="pr-5 text-right font-bold tabular-nums">{formatUsd(line.cost)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="px-5 py-4 text-sm text-aws-muted">The simulator has no price model for this service yet.</p>
        )}
      </Panel>
    </section>
  );
}

function UsageFields<S extends PricedService>({ service }: { service: S }) {
  const fields = ASSUMPTION_FIELDS[service] as AssumptionField<S>[];
  return (
    <fieldset className="grid grid-cols-1 gap-3 border-b border-aws-border px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="sr-only">{`${serviceName(service)} monthly usage`}</legend>
      {fields.map((field) => (
        <UsageField key={field.key} service={service} field={field} />
      ))}
    </fieldset>
  );
}

function UsageField<S extends PricedService>({ service, field }: { service: S; field: AssumptionField<S> }) {
  const id = useId();
  const value = useCostSimulator((s) => s.assumptions[service][field.key] as number);
  const setAssumption = useCostSimulator((s) => s.setAssumption);
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold text-aws-ink">
        {field.label}
      </label>
      <div className="flex items-center rounded-lg border border-aws-border-strong bg-aws-surface focus-within:border-aws-link focus-within:ring-1 focus-within:ring-aws-link aria-invalid:border-aws-red" aria-invalid={invalid || undefined}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          defaultValue={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            // An empty field counts as zero; negative or malformed values keep the last valid one.
            const next = e.target.value === "" ? 0 : Number(e.target.value);
            const valid = Number.isFinite(next) && next >= 0;
            setInvalid(!valid);
            if (valid) setAssumption(service, field.key, next);
          }}
          className="h-[34px] w-full min-w-0 rounded-lg bg-transparent px-2.5 text-sm text-aws-ink tabular-nums focus:outline-none"
        />
        <span className="shrink-0 pr-2.5 text-xs text-aws-muted" aria-hidden>
          {field.unit}
        </span>
      </div>
      {invalid && <p className="text-xs text-aws-red">Enter zero or a positive number.</p>}
    </div>
  );
}

function CostByService({ estimates, monthly, loading }: { estimates: ServiceEstimate[]; monthly: number; loading: boolean }) {
  const rows = estimates.filter((e) => e.lines.length > 0).sort((a, b) => b.monthly - a.monthly);
  return (
    <section aria-label="Cost by service">
      <Panel title="Cost by service">
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-aws-muted">No costs to break down.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.map((e) => (
              <li key={e.service} className="grid grid-cols-[8.5rem_1fr_5.5rem] items-center gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <ServiceIcon service={e.service} size="sm" />
                  <span className="truncate font-bold">{serviceName(e.service)}</span>
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-aws-panel" aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: `${monthly > 0 ? (e.monthly / monthly) * 100 : 0}%`, background: serviceColor(e.service) }} />
                </span>
                <span className="text-right font-bold tabular-nums">{formatUsd(e.monthly)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

function PricingNotes() {
  return (
    <section aria-label="About these estimates">
      <Panel title="About these estimates">
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm text-aws-muted">
          <li>Public on-demand list prices of US East (N. Virginia), whatever region is selected.</li>
          <li>Usage values are per resource and per month; each resource of a service uses the same values.</li>
          <li>Lambda compute uses the memory size configured on each function.</li>
          <li>Each SQS message counts as three requests: send, receive and delete.</li>
          <li>DynamoDB tables are priced with on-demand capacity.</li>
          <li>Free tier, data transfer, SMS deliveries and taxes are not included.</li>
        </ul>
      </Panel>
    </section>
  );
}
