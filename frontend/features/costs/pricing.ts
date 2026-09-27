import type { Resource } from "@/types/api";

/**
 * Cost model of the Cost Simulator: public on-demand list prices of US East (N. Virginia),
 * applied to the resources discovered in the environment and to monthly usage assumptions.
 * Free tier, data transfer and taxes are not included.
 */
export const PRICES = {
  lambda: { perMillionRequests: 0.2, perGbSecond: 0.0000166667 },
  s3: { perGbMonth: 0.023, perThousandPut: 0.005, perThousandGet: 0.0004 },
  sqs: { perMillionStandard: 0.4, perMillionFifo: 0.5 },
  sns: { perMillionPublishes: 0.5, perMillionHttp: 0.6, perMillionEmail: 20 },
  dynamodb: { perMillionWrites: 0.625, perMillionReads: 0.125, perGbMonth: 0.25 },
  apigateway: { perMillionRequests: 3.5 },
  apigatewayv2: { perMillionHttpRequests: 1, perMillionWebSocketMessages: 1 },
  events: { perMillionEvents: 1 },
  logs: { perGbIngested: 0.5, perGbStored: 0.03 },
} as const;

/** Monthly usage of one resource of each service, edited in the simulator. */
export interface UsageAssumptions {
  lambda: { invocations: number; durationMs: number };
  s3: { storageGb: number; putRequests: number; getRequests: number };
  sqs: { messages: number };
  sns: { publishes: number };
  dynamodb: { writes: number; reads: number; storageGb: number };
  apigateway: { requests: number };
  apigatewayv2: { requests: number };
  events: { events: number };
  logs: { ingestedGb: number; storedGb: number };
}

export type PricedService = keyof UsageAssumptions;

export const DEFAULT_ASSUMPTIONS: UsageAssumptions = {
  lambda: { invocations: 100_000, durationMs: 200 },
  s3: { storageGb: 10, putRequests: 10_000, getRequests: 100_000 },
  sqs: { messages: 100_000 },
  sns: { publishes: 100_000 },
  dynamodb: { writes: 100_000, reads: 1_000_000, storageGb: 1 },
  apigateway: { requests: 100_000 },
  apigatewayv2: { requests: 100_000 },
  events: { events: 100_000 },
  logs: { ingestedGb: 1, storedGb: 1 },
};

export interface AssumptionField<S extends PricedService = PricedService> {
  key: keyof UsageAssumptions[S] & string;
  label: string;
  unit: string;
}

/** Inputs shown for each service, in display order. Values are per resource and per month. */
export const ASSUMPTION_FIELDS: { [S in PricedService]: AssumptionField<S>[] } = {
  lambda: [
    { key: "invocations", label: "Invocations per function", unit: "/month" },
    { key: "durationMs", label: "Average duration", unit: "ms" },
  ],
  s3: [
    { key: "storageGb", label: "Storage per bucket", unit: "GB" },
    { key: "putRequests", label: "Write requests per bucket", unit: "/month" },
    { key: "getRequests", label: "Read requests per bucket", unit: "/month" },
  ],
  sqs: [{ key: "messages", label: "Messages per queue", unit: "/month" }],
  sns: [{ key: "publishes", label: "Publishes per topic", unit: "/month" }],
  dynamodb: [
    { key: "writes", label: "Writes per table", unit: "/month" },
    { key: "reads", label: "Reads per table", unit: "/month" },
    { key: "storageGb", label: "Storage per table", unit: "GB" },
  ],
  apigateway: [{ key: "requests", label: "Requests per API", unit: "/month" }],
  apigatewayv2: [{ key: "requests", label: "Requests or messages per API", unit: "/month" }],
  events: [{ key: "events", label: "Custom events per event bus", unit: "/month" }],
  logs: [
    { key: "ingestedGb", label: "Ingested per log group", unit: "GB/month" },
    { key: "storedGb", label: "Stored per log group", unit: "GB" },
  ],
};

export interface CostLine {
  item: string;
  quantity: string;
  price: string;
  cost: number;
}

export interface ServiceEstimate {
  service: string;
  resourceCount: number;
  lines: CostLine[];
  monthly: number;
  /** Null for services without charge (IAM) or without a price model. */
  assumptions: PricedService | null;
}

/** Display order of the services; services without resources are left out. */
const SERVICE_ORDER = ["lambda", "apigateway", "apigatewayv2", "dynamodb", "s3", "sqs", "sns", "events", "logs", "iam"];

const MILLION = 1_000_000;
const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

/** "$1,234.56"; amounts that would round to zero but are not zero read "< $0.01". */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.005) return "< $0.01";
  return USD.format(value);
}

const UNIT_USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 10 });

/** Unit prices keep every digit of the list price ("$0.625 per 1M", "$0.0000166667 per GB-s"). */
function unitPrice(value: number, per: string): string {
  return `${UNIT_USD.format(value)} per ${per}`;
}

function perMillion(item: string, count: number, unit: string, price: number): CostLine {
  return { item, quantity: `${formatNumber(count)} ${unit}`, price: unitPrice(price, "1M"), cost: (count / MILLION) * price };
}

function noCharge(item: string, quantity: string): CostLine {
  return { item, quantity, price: "No charge", cost: 0 };
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

function attribute<T>(resource: Resource, key: string): T | undefined {
  return resource.attributes?.[key] as T | undefined;
}

type Estimator = (resources: Resource[], usage: UsageAssumptions) => CostLine[];

const ESTIMATORS: Record<string, { assumptions: PricedService | null; estimate: Estimator }> = {
  lambda: {
    assumptions: "lambda",
    estimate: (functions, { lambda }) => {
      const requests = functions.length * lambda.invocations;
      // Each function is billed with its own memory size (128 MB when unknown).
      const gbSeconds = functions.reduce((sum, fn) => {
        const memoryMb = Number(attribute<number>(fn, "memorySize")) || 128;
        return sum + (memoryMb / 1024) * (lambda.durationMs / 1000) * lambda.invocations;
      }, 0);
      return [
        perMillion("Requests", requests, "requests", PRICES.lambda.perMillionRequests),
        { item: "Compute (x86)", quantity: `${formatNumber(gbSeconds)} GB-s`, price: unitPrice(PRICES.lambda.perGbSecond, "GB-s"), cost: gbSeconds * PRICES.lambda.perGbSecond },
      ];
    },
  },
  s3: {
    assumptions: "s3",
    estimate: (buckets, { s3 }) => {
      const storage = buckets.length * s3.storageGb;
      const puts = buckets.length * s3.putRequests;
      const gets = buckets.length * s3.getRequests;
      return [
        { item: "Standard storage", quantity: `${formatNumber(storage)} GB`, price: unitPrice(PRICES.s3.perGbMonth, "GB-month"), cost: storage * PRICES.s3.perGbMonth },
        { item: "PUT, COPY, POST, LIST requests", quantity: `${formatNumber(puts)} requests`, price: unitPrice(PRICES.s3.perThousandPut, "1,000"), cost: (puts / 1000) * PRICES.s3.perThousandPut },
        { item: "GET and other read requests", quantity: `${formatNumber(gets)} requests`, price: unitPrice(PRICES.s3.perThousandGet, "1,000"), cost: (gets / 1000) * PRICES.s3.perThousandGet },
      ];
    },
  },
  sqs: {
    assumptions: "sqs",
    estimate: (queues, { sqs }) => {
      // Every message costs three requests: send, receive and delete.
      const fifo = queues.filter((q) => attribute<boolean>(q, "fifo") === true || q.name.endsWith(".fifo")).length;
      const standard = queues.length - fifo;
      const lines: CostLine[] = [];
      if (standard) lines.push(perMillion("Standard queue requests", standard * sqs.messages * 3, "requests", PRICES.sqs.perMillionStandard));
      if (fifo) lines.push(perMillion("FIFO queue requests", fifo * sqs.messages * 3, "requests", PRICES.sqs.perMillionFifo));
      return lines;
    },
  },
  sns: {
    assumptions: "sns",
    estimate: (topics, { sns }) => {
      const deliveries = { http: 0, email: 0, free: 0 };
      for (const topic of topics) {
        for (const subscription of attribute<{ protocol?: string }[]>(topic, "subscriptions") ?? []) {
          const protocol = subscription.protocol ?? "";
          if (protocol === "http" || protocol === "https") deliveries.http += sns.publishes;
          else if (protocol === "email" || protocol === "email-json") deliveries.email += sns.publishes;
          else if (protocol === "sqs" || protocol === "lambda") deliveries.free += sns.publishes;
        }
      }
      const lines = [perMillion("Publishes", topics.length * sns.publishes, "publishes", PRICES.sns.perMillionPublishes)];
      if (deliveries.http) lines.push(perMillion("HTTP/S deliveries", deliveries.http, "deliveries", PRICES.sns.perMillionHttp));
      if (deliveries.email) lines.push(perMillion("Email deliveries", deliveries.email, "deliveries", PRICES.sns.perMillionEmail));
      if (deliveries.free) lines.push(noCharge("SQS and Lambda deliveries", `${formatNumber(deliveries.free)} deliveries`));
      return lines;
    },
  },
  dynamodb: {
    assumptions: "dynamodb",
    estimate: (tables, { dynamodb }) => {
      const storage = tables.length * dynamodb.storageGb;
      return [
        perMillion("Write request units", tables.length * dynamodb.writes, "WRU", PRICES.dynamodb.perMillionWrites),
        perMillion("Read request units", tables.length * dynamodb.reads, "RRU", PRICES.dynamodb.perMillionReads),
        { item: "Storage", quantity: `${formatNumber(storage)} GB`, price: unitPrice(PRICES.dynamodb.perGbMonth, "GB-month"), cost: storage * PRICES.dynamodb.perGbMonth },
      ];
    },
  },
  apigateway: {
    assumptions: "apigateway",
    estimate: (apis, { apigateway }) => [perMillion("REST API requests", apis.length * apigateway.requests, "requests", PRICES.apigateway.perMillionRequests)],
  },
  apigatewayv2: {
    assumptions: "apigatewayv2",
    estimate: (apis, { apigatewayv2 }) => {
      const websocket = apis.filter((api) => attribute<string>(api, "protocolType") === "WEBSOCKET").length;
      const http = apis.length - websocket;
      const lines: CostLine[] = [];
      if (http) lines.push(perMillion("HTTP API requests", http * apigatewayv2.requests, "requests", PRICES.apigatewayv2.perMillionHttpRequests));
      if (websocket) lines.push(perMillion("WebSocket messages", websocket * apigatewayv2.requests, "messages", PRICES.apigatewayv2.perMillionWebSocketMessages));
      return lines;
    },
  },
  events: {
    assumptions: "events",
    estimate: (resources, { events }) => {
      const buses = resources.filter((r) => r.type === "event-bus").length;
      const rules = resources.filter((r) => r.type === "rule").length;
      const lines = [perMillion("Custom events", buses * events.events, "events", PRICES.events.perMillionEvents)];
      if (rules) lines.push(noCharge("Rules", plural(rules, "rule")));
      return lines;
    },
  },
  logs: {
    assumptions: "logs",
    estimate: (groups, { logs }) => {
      const ingested = groups.length * logs.ingestedGb;
      const stored = groups.length * logs.storedGb;
      return [
        { item: "Ingestion", quantity: `${formatNumber(ingested)} GB`, price: unitPrice(PRICES.logs.perGbIngested, "GB"), cost: ingested * PRICES.logs.perGbIngested },
        { item: "Storage", quantity: `${formatNumber(stored)} GB`, price: unitPrice(PRICES.logs.perGbStored, "GB-month"), cost: stored * PRICES.logs.perGbStored },
      ];
    },
  },
  iam: {
    assumptions: null,
    estimate: (roles) => [noCharge("Roles", plural(roles.length, "role"))],
  },
};

/** Monthly estimate of each service that has resources, in display order. */
export function estimateCosts(resources: Resource[], usage: UsageAssumptions): ServiceEstimate[] {
  const byService = new Map<string, Resource[]>();
  for (const resource of resources) {
    byService.set(resource.service, [...(byService.get(resource.service) ?? []), resource]);
  }
  const services = [...byService.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return services.map((service) => {
    const list = byService.get(service) ?? [];
    const estimator = ESTIMATORS[service];
    const lines = estimator ? estimator.estimate(list, usage) : [];
    return {
      service,
      resourceCount: list.length,
      lines,
      monthly: lines.reduce((sum, line) => sum + line.cost, 0),
      assumptions: estimator?.assumptions ?? null,
    };
  });
}

/** True when the simulator knows the price model of the service (IAM included, as free). */
export function isPriced(service: string): boolean {
  return service in ESTIMATORS;
}

function rank(service: string): number {
  const index = SERVICE_ORDER.indexOf(service);
  return index === -1 ? SERVICE_ORDER.length : index;
}
