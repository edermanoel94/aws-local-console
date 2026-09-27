import type {
  ApiGatewayInvokeRequest,
  ApiGatewayInvokeResponse,
  ArchitectureGraph,
  CliResult,
  ConsoleSource,
  DashboardSummary,
  ExecuteRequest,
  ExecuteResponse,
  TargetStatus,
  LogEntry,
  Region,
  ResourceEvent,
  ResourceList,
  ServiceDetail,
  ServiceSummary,
} from "@/types/api";

/**
 * The browser calls the Go API through the same-origin proxy at `/api/v1` (app/api/v1/[...path]/route.ts),
 * so the console works on any host it is opened from. On the server, requests go straight to API_INTERNAL_URL.
 */
export const API_BASE_PATH = "/api/v1";

function apiOrigin(): string {
  return typeof window === "undefined" ? (process.env.API_INTERNAL_URL ?? "http://localhost:8080") : window.location.origin;
}

/** Error for non-2xx responses of the Go API itself (not AWS errors, which come inside ExecuteResponse). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${API_BASE_PATH}${path}`, apiOrigin());
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function request<T>(path: string, init?: RequestInit & { query?: Query }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, init?.query), {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiError(0, "NetworkError", `Console server unreachable: ${(err as Error).message}`);
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "ApiError", body?.error?.message ?? res.statusText);
  }
  return body as T;
}

export const api = {
  health: () => request<{ status: string; version: string }>("/health"),
  target: () => request<TargetStatus>("/target"),
  dashboard: () => request<DashboardSummary>("/dashboard"),
  services: () => request<{ services: ServiceSummary[] }>("/services").then((r) => r.services),
  service: (id: string) => request<ServiceDetail>(`/services/${id}`),
  operations: (id: string) => request<{ operations: ServiceDetail["operations"] }>(`/services/${id}/operations`).then((r) => r.operations),
  regions: () => request<{ regions: Region[] }>("/regions").then((r) => r.regions),
  resources: (query?: { region?: string; service?: string; q?: string; tag?: string; type?: string }) =>
    request<ResourceList>("/resources", { query }),
  serviceResources: (service: string, region?: string) =>
    request<ResourceList>(`/resources/${service}`, { query: { region } }),
  logs: (query?: { service?: string; operation?: string; status?: string; source?: string; q?: string; limit?: number }) =>
    request<{ logs: LogEntry[] }>("/logs", { query }).then((r) => r.logs),
  log: (id: string) => request<LogEntry>(`/logs/${id}`),
  events: (query?: { service?: string; type?: string; q?: string; limit?: number }) =>
    request<{ events: ResourceEvent[] }>("/events", { query }).then((r) => r.events),
  architecture: (region?: string) => request<ArchitectureGraph>("/architecture", { query: { region } }),
  execute: (req: ExecuteRequest, source: ConsoleSource = "api-explorer") =>
    request<ExecuteResponse>("/operations/execute", {
      method: "POST",
      body: JSON.stringify(req),
      headers: { "X-Console-Source": source },
    }),
  cli: (command: string, region?: string) =>
    request<CliResult>("/cli/execute", { method: "POST", body: JSON.stringify({ command, region }) }),
  /** Calls a deployed API Gateway REST API stage through the Go API (Floci has no TestInvokeMethod). */
  apigatewayInvoke: (req: ApiGatewayInvokeRequest, source: ConsoleSource = "console") =>
    request<ApiGatewayInvokeResponse>("/apigateway/invoke", {
      method: "POST",
      body: JSON.stringify(req),
      headers: { "X-Console-Source": source },
    }),
};

/**
 * Error raised by `executeOrThrow` when the AWS call failed.
 * Carries the full ExecuteResponse so UIs can show kind/code/message.
 */
export class OperationError extends Error {
  constructor(public readonly result: ExecuteResponse) {
    super(result.error ? `${result.error.code}: ${result.error.message}` : "Operation failed");
    this.name = "OperationError";
  }
}

/** Runs an operation from a service console and throws OperationError when the target returned an error. */
export async function executeOrThrow<T = unknown>(req: ExecuteRequest): Promise<{ output: T; result: ExecuteResponse }> {
  const result = await api.execute(req, "console");
  if (result.status === "error") throw new OperationError(result);
  return { output: result.response.output as T, result };
}
