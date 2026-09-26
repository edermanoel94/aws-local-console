# AWS Local Console - Shared Contract

This document is the single source of truth shared between the Go API (`backend/`), the Next.js app (`frontend/`) and the Playwright suite (`tests/e2e/`).
Every agent must follow it exactly.
If a change to the contract is needed, update this file in the same change and keep both sides consistent.

## 1. Runtime topology

| Component | Dev URL | Compose service |
|---|---|---|
| Floci | `http://localhost:4566` (health: `GET /_floci/health`) | `floci` (image `floci/floci:latest`, needs `/var/run/docker.sock` mounted for Lambda) |
| Go API | `http://localhost:8080` | `backend` |
| Next.js | `http://localhost:3000` | `frontend` |

Backend environment variables:

```env
FLOCI_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
PORT=8080
CORS_ORIGINS=http://localhost:3000
```

Frontend environment variable: `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`).
The browser calls the Go API directly; the Go API sends CORS headers for `CORS_ORIGINS`.

Floci account id is `000000000000`.
The Floci container resolves itself as `localhost.floci.io`; S3 must use path-style addressing.

## 2. General API rules

- Base path: `/api/v1`.
- JSON everywhere, `Content-Type: application/json`.
- Field naming in the API envelope: `camelCase`.
- AWS inputs and outputs are passed through with the AWS SDK Go v2 field names (`PascalCase`, e.g. `{"Bucket": "x"}`).
- Timestamps: RFC 3339 strings in UTC.
- Non-2xx API errors (validation, not found, internal) use:

```json
{ "error": { "code": "ServiceNotFound", "message": "service 'foo' is not registered" } }
```

## 3. Types

```ts
type ServiceCategory =
  | "Compute" | "Storage" | "Database" | "Networking" | "Security"
  | "Application Integration" | "Management" | "Analytics";

interface ServiceSummary {
  id: string;                 // "s3", "sqs", "sns", "dynamodb", "lambda", "apigateway", "events", "logs", "iam", ...
  name: string;               // "Amazon S3"
  shortName: string;          // "S3"
  description: string;
  category: ServiceCategory;
  available: boolean;         // Floci reports the service as running
  resourceTypes: string[];    // ["bucket"]
  operationCount: number;
  coverage: { supported: number; unsupported: number; untested: number };
  capabilities: string[];     // UI capabilities, e.g. ["console", "resources", "api-explorer"]
}

interface ServiceDetail extends ServiceSummary {
  operations: OperationInfo[];
}

interface OperationInfo {
  name: string;               // "CreateBucket"
  service: string;            // "s3"
  mutating: boolean;          // false for List*/Get*/Describe*/Head*/Scan/Query/Receive*
  coverage: "supported" | "unsupported" | "untested";
  inputExample: Record<string, unknown>;   // sensible example input (may be {})
  inputFields: { name: string; type: string; required: boolean }[];
}

type ExecutionStatus = "success" | "error";
type ErrorKind =
  | "aws"           // AWS/Floci returned a service error (e.g. BucketAlreadyOwnedByYou)
  | "unsupported"   // Floci does not implement the operation
  | "validation"    // input invalid before calling Floci (bad JSON shape, unknown operation)
  | "network"       // Floci unreachable / timeout
  | "application";  // unexpected internal error in the Go API

interface ExecuteRequest {
  service: string;            // "s3"
  operation: string;          // "ListBuckets"
  region?: string;            // default "us-east-1"
  input?: Record<string, unknown>;
}

interface ExecuteResponse {
  id: string;                 // audit id, e.g. "op_01J..."
  service: string;
  operation: string;
  region: string;
  status: ExecutionStatus;
  httpStatus: number;         // HTTP status Floci returned (200 on success; 0 when never reached)
  durationMs: number;
  requestId?: string;         // AWS request id when available
  timestamp: string;
  request: {
    input: Record<string, unknown>;
    method?: string;          // raw HTTP method sent to Floci
    url?: string;             // raw URL sent to Floci
    headers?: Record<string, string>;  // sent headers, Authorization redacted
  };
  response: {
    output?: unknown;         // SDK output struct serialized to JSON (ResultMetadata stripped)
    headers?: Record<string, string>;  // response headers from Floci
  };
  error?: { kind: ErrorKind; code: string; message: string };
}
```

`POST /api/v1/operations/execute` always returns HTTP 200 with an `ExecuteResponse` when the service/operation exist, even if the AWS call failed (`status: "error"`).
It returns 400/404 with the error envelope only for malformed requests or unknown service/operation.

Special input/output encoding for streaming fields:

- Input fields of type `io.Reader` (e.g. S3 `PutObject.Body`, Lambda `Invoke` is `[]byte Payload`) accept a string (UTF-8 text).
  `[]byte` fields accept a UTF-8 string too.
  Optionally `"<Field>Base64": "..."` may be sent for binary content.
- Output fields of type `io.ReadCloser` (S3 `GetObject.Body`) and `[]byte` (Lambda `Invoke.Payload`) are returned as UTF-8 string when valid UTF-8, else as `{"base64": "..."}`.

```ts
interface ResourceTag { key: string; value: string }

interface Resource {
  id: string;                 // stable id: `${service}:${type}:${region}:${name}`
  arn: string;
  name: string;
  service: string;            // "sqs"
  type: string;               // "queue"
  region: string;
  createdAt?: string;
  tags: ResourceTag[];
  attributes: Record<string, unknown>;   // service specific details (url, runtime, keySchema, ...)
}

// GET /api/v1/resources?region=&service=&q=&tag=key%3Dvalue&type=
interface ResourceList { resources: Resource[]; total: number; errors: { service: string; message: string }[] }

// GET /api/v1/resources/:service?region=  -> ResourceList filtered by service

interface Region { name: string; label: string; default: boolean }
// GET /api/v1/regions -> { regions: Region[] }

// Audit log entry (one per executed operation, including ones triggered by UI consoles and the CLI)
interface LogEntry {
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
  source: "api-explorer" | "console" | "cli" | "system";
  resourceName?: string;      // best effort (Bucket, QueueName, TableName, FunctionName, Name, ...)
  request: ExecuteResponse["request"];
  response: ExecuteResponse["response"];
}
// GET /api/v1/logs?service=&operation=&status=success|error&source=&q=&limit=200 -> { logs: LogEntry[] } newest first
// GET /api/v1/logs/:id -> LogEntry

// Resource lifecycle event, derived from successful mutating operations
interface ResourceEvent {
  id: string;
  timestamp: string;
  service: string;
  type: string;               // "ResourceCreated" | "ResourceDeleted" | "ResourceUpdated" | "MessagePublished" | "FunctionInvoked" | "ObjectUploaded" | ...
  operation: string;          // "CreateBucket"
  region: string;
  resourceName?: string;
  resourceArn?: string;
  logId: string;              // relationship to the LogEntry that produced it
  related: { service: string; name: string; arn?: string }[];   // other resources involved (e.g. subscription topic + queue)
  detail: Record<string, unknown>;
}
// GET /api/v1/events?service=&type=&q=&limit=200 -> { events: ResourceEvent[] } newest first

// GET /api/v1/architecture?region= -> ArchitectureGraph
interface ArchitectureGraph {
  nodes: { id: string; service: string; type: string; name: string; arn: string }[];    // id = Resource.id
  edges: { id: string; source: string; target: string; label: string }[];                // e.g. "event source", "subscription", "rule target", "integration", "notification"
}
// Edges are discovered from real Floci state:
//   Lambda event source mappings (SQS/DynamoDB stream -> Lambda), SNS subscriptions (topic -> sqs/lambda),
//   EventBridge rule targets (rule -> target), API Gateway integrations (api -> lambda),
//   S3 bucket notification configuration (bucket -> sqs/sns/lambda/eventbridge),
//   Lambda environment variables referencing a known resource name (lambda -> table/queue/topic/bucket, label "env reference").

// GET /api/v1/health -> { status: "ok", version: string }
// GET /api/v1/floci/status -> { endpoint: string; healthy: boolean; status: "Healthy" | "Unreachable"; version?: string; edition?: string; services: { id: string; status: string }[]; latencyMs: number }

// GET /api/v1/dashboard -> DashboardSummary
interface DashboardSummary {
  serviceCount: number;       // registered services
  availableServiceCount: number;
  resourceCount: number;
  regionCount: number;
  resourcesByService: { service: string; count: number }[];
  recentOperations: LogEntry[];   // latest 10
}

// POST /api/v1/cli/execute  { command: "aws s3 ls", region?: string } -> CliResult
interface CliResult { command: string; exitCode: number; stdout: string; stderr: string; logId?: string }
```

### 3.1 Source header

The frontend sends `X-Console-Source: api-explorer` from the API Explorer page and `X-Console-Source: console` from service consoles.
The backend records it in `LogEntry.source` (default `api-explorer` when missing).

### 3.2 CLI

The CLI endpoint parses `aws <service> <command> [--flag value ...]` and maps it to the operation engine (so it is audited like everything else).
Required subset:

- `aws s3 ls`, `aws s3 ls s3://bucket`, `aws s3 mb s3://bucket`, `aws s3 rb s3://bucket`
- Generic form for any registered service: `aws <service> <kebab-case-operation> --kebab-flag value` (e.g. `aws sqs list-queues`, `aws dynamodb list-tables`, `aws sqs create-queue --queue-name x`, `aws lambda list-functions`).
  Flags map to PascalCase input fields (`--queue-name` -> `QueueName`); a value that parses as JSON is used as JSON.
- `help` lists supported syntax.
- Output: pretty JSON of the operation output on stdout (like the real AWS CLI), error text on stderr with exit code 254 for AWS errors, 252 for parse errors.

## 4. Service registry (MVP + extras)

| id | shortName | Category | Resource types | Console in UI |
|---|---|---|---|---|
| s3 | S3 | Storage | bucket | yes |
| sqs | SQS | Application Integration | queue | yes |
| sns | SNS | Application Integration | topic | yes |
| dynamodb | DynamoDB | Database | table | yes |
| lambda | Lambda | Compute | function | yes |
| apigateway | API Gateway | Networking | restapi | yes |
| events | EventBridge | Application Integration | event-bus, rule | yes |
| logs | CloudWatch Logs | Management | log-group | no (API Explorer only) |
| iam | IAM | Security | role | no (API Explorer only) |

Operations are discovered by reflection on the SDK v2 client type (every exported method with signature `(ctx, *XInput, ...func(*Options)) (*XOutput, error)`), so every SDK operation is executable through the generic engine.
Coverage per operation: `supported` once it has succeeded (or failed with a regular AWS error) against Floci, `unsupported` once Floci answered it as not implemented, `untested` otherwise.
Coverage is kept in memory in the backend.

## 5. Frontend routes

| Route | Content |
|---|---|
| `/` | redirects to `/dashboard` |
| `/dashboard` | cards: Services, Resources, Regions; Recent Operations; Floci Status; Favorites |
| `/services` | services grouped by category, search box |
| `/services/[service]` | tabs: Overview, Resources, Operations, API Explorer, Activity, Coverage. `?tab=` query selects tab. Resources tab hosts the service console when available |
| `/resources` | Resource Explorer: search, filters (service, region, tag), table with name/type/service/region/ARN |
| `/api-explorer` | service, operation, region selectors; Monaco JSON input; Execute; result with Status, Duration, Request, Response, Headers, Request ID. Supports `?service=&operation=` |
| `/architecture` | React Flow graph from `/api/v1/architecture` |
| `/events` | events table with filters and detail |
| `/logs` | logs table with filters (service, operation, status) and detail drawer |
| `/logs/[id]` | request inspector for one log entry (optional; the drawer is required) |
| `/cli` | xterm.js terminal backed by `/api/v1/cli/execute` |
| `/settings` | endpoint info (read only), default region, clear favorites |

Global layout: top bar (Global Search button showing `Ctrl K`, region selector, Floci status pill `Floci ●`), left sidebar (Dashboard, Services, Resources, API Explorer, Architecture, Events, Logs, CLI, Settings).

Visual style: inspired by the AWS Management Console (dark navy top bar `#232f3e`, orange accent `#ff9900` for primary buttons, white content area, light gray panels, compact tables).

## 6. UI accessibility contract (used by Playwright)

Tests use roles and labels, never CSS classes.
Rules every UI must follow:

- Every form input has a visible `<label>` (so `getByLabel` works). Standard labels: `Bucket name`, `Queue name`, `Topic name`, `Table name`, `Partition key`, `Sort key`, `Function name`, `Runtime`, `Handler`, `Function code`, `API name`, `Event bus name`, `Rule name`, `Event pattern`, `Message body`, `Search`, `Region`, `Service`, `Operation`, `Status`.
- Primary action buttons use exact names: `Create bucket` (opens form), `Create` (submits a create form), `Delete` (opens confirm), `Confirm delete` (in confirm dialog), `Upload`, `Download`, `Send message`, `Receive messages`, `Purge`, `Publish message`, `Invoke`, `Execute`, `Refresh`, `Save`.
- The confirm dialog is a `role="dialog"`; delete confirmation requires typing the resource name in an input labeled `Type the name to confirm`.
- Success feedback: a toast/alert with `role="status"` containing text like `Bucket playwright-x created`.
- Error feedback: an element with `role="alert"` that contains the AWS error code and message (e.g. `BucketAlreadyOwnedByYou`), and for `errorKind === "unsupported"` the text `Floci Unsupported Operation` (distinct from `Application Error` for `errorKind === "application"`).
- Tables are real `<table>` elements; each resource row contains the resource name as a link or text.
- Loading states render an element with `role="progressbar"` or text `Loading`; empty states render text starting with `No ` (e.g. `No buckets`).
- Tabs use `role="tablist"` / `role="tab"`.
- The sidebar is a `<nav aria-label="Main">` with links by name.
- API Explorer result area shows `Status: 200` and `Duration: 14ms` style text, and tabs `Request`, `Response`, `Headers`, and a `Request ID` field.

## 7. Test isolation

Every Playwright test creates resources with a unique name using `tests/e2e/support/names.ts` -> `uniqueName("e2e-s3")` producing `e2e-s3-<runId>-<random>` (lowercase, DNS compatible, <= 63 chars).
Tests never mock network calls and never call Floci directly to create data; all data is created through the UI.
Tests may call the Go API in `afterAll` only for best-effort cleanup.
