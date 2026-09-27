// Mirrors docs/CONTRACT.md section 3. Keep both in sync.

export type ServiceCategory =
  | "Compute"
  | "Storage"
  | "Database"
  | "Networking"
  | "Security"
  | "Application Integration"
  | "Management"
  | "Analytics";

export type Coverage = "supported" | "unsupported" | "untested";

export interface ServiceSummary {
  id: string;
  name: string;
  shortName: string;
  description: string;
  category: ServiceCategory;
  available: boolean;
  resourceTypes: string[];
  operationCount: number;
  coverage: { supported: number; unsupported: number; untested: number };
  capabilities: string[];
}

export interface OperationInfo {
  name: string;
  service: string;
  mutating: boolean;
  coverage: Coverage;
  inputExample: Record<string, unknown>;
  /** enum: allowed values when the member is an SDK enum (or a list of enums). */
  inputFields: { name: string; type: string; required: boolean; enum?: string[] }[];
}

export interface ServiceDetail extends ServiceSummary {
  operations: OperationInfo[];
}

export type ExecutionStatus = "success" | "error";
export type ErrorKind = "aws" | "unsupported" | "validation" | "network" | "application";
export type ConsoleSource = "api-explorer" | "console" | "cli" | "system";

export interface ExecuteRequest {
  service: string;
  operation: string;
  region?: string;
  input?: Record<string, unknown>;
}

export interface ExecutionError {
  kind: ErrorKind;
  code: string;
  message: string;
}

export interface ExecuteResponse {
  id: string;
  service: string;
  operation: string;
  region: string;
  status: ExecutionStatus;
  httpStatus: number;
  durationMs: number;
  requestId?: string;
  timestamp: string;
  request: {
    input: Record<string, unknown>;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
  };
  response: {
    output?: unknown;
    headers?: Record<string, string>;
    /** Raw error body from Floci or AWS, only when httpStatus >= 400. */
    body?: string;
  };
  error?: ExecutionError;
}

export interface ResourceTag {
  key: string;
  value: string;
}

export interface Resource {
  id: string;
  arn: string;
  name: string;
  service: string;
  type: string;
  region: string;
  createdAt?: string;
  tags: ResourceTag[];
  attributes: Record<string, unknown>;
}

export interface ResourceList {
  resources: Resource[];
  total: number;
  errors: { service: string; message: string }[];
}

export interface Region {
  name: string;
  label: string;
  default: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  service: string;
  operation: string;
  region: string;
  status: ExecutionStatus;
  httpStatus: number;
  durationMs: number;
  requestId?: string;
  errorKind?: ErrorKind;
  errorCode?: string;
  errorMessage?: string;
  source: ConsoleSource;
  resourceName?: string;
  request: ExecuteResponse["request"];
  response: ExecuteResponse["response"];
}

export interface ResourceEvent {
  id: string;
  timestamp: string;
  service: string;
  type: string;
  operation: string;
  region: string;
  resourceName?: string;
  resourceArn?: string;
  logId: string;
  related: { service: string; name: string; arn?: string }[];
  detail: Record<string, unknown>;
}

export interface ArchitectureGraph {
  nodes: { id: string; service: string; type: string; name: string; arn: string }[];
  edges: { id: string; source: string; target: string; label: string }[];
  /** Partial failures while collecting (the graph is still returned). */
  errors?: { service: string; message: string }[];
}

/** What the console operates: a local Floci emulator or a real AWS account. */
export type TargetKind = "floci" | "aws";

export interface TargetStatus {
  target: TargetKind;
  /** Display name: "Floci" or "AWS". */
  name: string;
  /** Floci endpoint as configured on the Go API (Floci only). */
  endpoint?: string;
  /** Default region of the Go API. */
  region: string;
  /** Floci: always 000000000000. AWS: account of the credentials, empty until they work. */
  accountId: string;
  /** AWS only: ARN of the caller identity (sts:GetCallerIdentity). */
  identityArn?: string;
  /** AWS only: SDK credentials provider, e.g. "EnvConfigCredentials" or "SSOProvider". */
  credentialSource?: string;
  healthy: boolean;
  status: "Healthy" | "Unreachable" | "Unauthorized";
  version?: string;
  edition?: string;
  /** Floci only: services reported by /_floci/health. */
  services: { id: string; status: string }[];
  latencyMs: number;
  error?: string;
}

export interface DashboardSummary {
  serviceCount: number;
  availableServiceCount: number;
  resourceCount: number;
  regionCount: number;
  resourcesByService: { service: string; count: number }[];
  recentOperations: LogEntry[];
  /** Resource discovery failures (e.g. AWS credentials without permission). */
  errors: { service: string; message: string }[];
}

export interface CliResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  logId?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// POST /api/v1/apigateway/invoke - proxies a request to a deployed REST API stage.
export interface ApiGatewayInvokeRequest {
  restApiId: string;
  stage: string;
  /** Default GET. */
  method?: string;
  /** Resource path with optional query string, e.g. "/hello?x=1". */
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  region?: string;
}

export interface ApiGatewayInvokeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  url: string;
  logId: string;
}
