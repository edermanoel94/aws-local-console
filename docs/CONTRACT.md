# AWS Local Console - Shared Contract

This document is the single source of truth shared between the Go API (`backend/`), the Next.js app (`frontend/`) and the Playwright suite (`tests/e2e/`).
Every agent must follow it exactly.
If a change to the contract is needed, update this file in the same change and keep both sides consistent.

## 1. Runtime topology

| Component | Dev URL (host) | Compose service |
|---|---|---|
| Floci | `http://localhost:4566` (health: `GET /_floci/health`) | `floci` (image `floci/floci:2.1.0`, needs `/var/run/docker.sock` mounted for Lambda) |
| Go API | `http://localhost:8080` | `console` (same container as Next.js, `127.0.0.1:8080`, not published) |
| Next.js | `http://localhost:4500` | `console` (image `edercosta/aws-local-console`, port 4500) |

The Go API and Next.js ship as one image (root `Dockerfile`); `docker/entrypoint.mjs` runs the API as a child process on `API_PORT` and exits the container if it dies.

Backend environment variables:

```env
FLOCI_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
PORT=8080
CORS_ORIGINS=http://localhost:4500
```

Frontend environment variable: `API_INTERNAL_URL` (default `http://localhost:8080`; set to `http://127.0.0.1:${API_PORT}` by the image entrypoint), read at runtime.
The browser never calls the Go API directly: it calls `/api/v1/*` on the Next.js origin, and the route handler `frontend/app/api/v1/[...path]/route.ts` proxies the request to `API_INTERNAL_URL`.
This keeps the console working from any host name, IP, tunnel or device without CORS, and the frontend image carries no environment-specific URL.
When the Go API cannot be reached, the proxy answers 502 with the error envelope and code `ApiUnreachable`.
`CORS_ORIGINS` on the Go API only matters for browsers calling it directly.

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
  id: string;                 // "s3", "sqs", "sns", "dynamodb", "dynamodbstreams", "lambda", "apigateway", "events", "logs", "iam", ...
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
  inputFields: { name: string; type: string; required: boolean; enum?: string[] }[];
  // type: "string" | "integer" | "long" | "double" | "boolean" | "timestamp" | "blob" | "list<T>" | "map<string,T>" | <StructureName>
  // required: exact for top-level members (asked from the SDK's own input validator)
  // enum: allowed values when the member is an SDK enum (or a list of enums)
}
// GET /api/v1/services                               -> { services: ServiceSummary[] }
// GET /api/v1/services/:service                      -> ServiceDetail
// GET /api/v1/services/:service/operations           -> { operations: OperationInfo[] }
// GET /api/v1/services/:service/operations/:operation -> OperationInfo

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
    body?: string;            // raw error body from Floci, only when httpStatus >= 400
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
- Any `[]byte` field may also be given as `{"zipFiles": {"index.mjs": "export const handler = ..."}}`; the backend builds a zip archive with those files.
  This is how the Lambda console sends inline code (`CreateFunction.Code.ZipFile`, `UpdateFunctionCode.ZipFile`).
- Output fields of type `io.ReadCloser` (S3 `GetObject.Body`) and `[]byte` (Lambda `Invoke.Payload`) are returned as UTF-8 string when valid UTF-8, else as `{"base64": "..."}`.
- `[]byte` input fields also accept `{"base64": "..."}` (symmetric with the output), and any other JSON object/array is sent as its JSON text (so `Invoke.Payload` may be a JSON object).
- String input fields accept numbers/booleans (stringified) and JSON objects/arrays (serialized), e.g. `EventPattern`, `Policy`.
- Member names are matched exactly, then case-insensitively; unknown members are a `validation` error listing the valid ones.
- Timestamps in input accept RFC 3339 strings or epoch seconds.
- Output omits absent members (nil pointers/maps, unset enums); lists are always present (`[]` when empty).

Smithy unions (Go interfaces with one struct per member) use the AWS wire JSON shape in both input and output: an object with exactly one key, the member name.
The main case is DynamoDB `AttributeValue`, everywhere it appears (`Item`, `Key`, `ExpressionAttributeValues`, `ExclusiveStartKey`, outputs `Item`, `Items`, `Attributes`, `LastEvaluatedKey`, batch and transact operations):
`{"S":"x"}`, `{"N":"1"}`, `{"BOOL":true}`, `{"NULL":true}`, `{"L":[...]}`, `{"M":{...}}`, `{"SS":[...]}`, `{"NS":[...]}`, `{"B":"<base64>"}`, `{"BS":["<base64>"]}`.
Binary union members (`B`, `BS`) are always base64, as on the AWS wire.
Other registered unions: S3 `AnalyticsFilter`, `MetricsFilter`, `ObjectEncryption`; IAM `PolicyIdentifier`; CloudWatch Logs `IntegrationDetails`, `ResourceConfig`.
New unions plug into `backend/internal/operations/unions.go`.
None of the registered services use `document.Interface` members in their inputs.

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
//
// Without `region` (or with region=all) every region of /regions is scanned; S3 buckets are listed once and placed in their bucket region.
// IAM roles are global: region "global", always included regardless of the region filter.
// `q` matches name, ARN, type, service and tag key/value (case-insensitive); `tag` is "key=value" or just "key".
// Attributes per type (all optional, best effort):
//   bucket:    region, versioning
//   queue:     url, fifo, plus every SQS attribute with a lower-camel key (queueArn, approximateNumberOfMessages, visibilityTimeout, redrivePolicy, ...)
//   topic:     fifo, subscriptions: {subscriptionArn, protocol, endpoint}[], plus SNS topic attributes (lower-camel keys)
//   table:     status, keySchema: {attributeName, keyType}[], attributeDefinitions: {attributeName, attributeType}[], itemCount, sizeBytes, billingMode, streamArn, globalSecondaryIndexes
//   function:  runtime, handler, role, memorySize, timeout, codeSize, lastModified, state, packageType, description, environment (Record<string,string>)
//   restapi:   id, description, rootResourceId, endpointType, stages: {stageName, deploymentId, invokeUrl}[]   (Resource.name is the API name; use attributes.id for API calls)
//   api (apigatewayv2): id, protocolType, apiEndpoint
//   event-bus: description
//   rule:      ruleName, eventBusName, eventPattern, scheduleExpression, state, description   (Resource.name is "ruleName" on the default bus, "busName/ruleName" otherwise)
//   log-group: retentionInDays, storedBytes, logGroupClass
//   role:      roleId, path, description, assumeRolePolicyDocument

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
  errors: { service: string; message: string }[];   // partial failures while collecting (graph is still returned)
}
// Edges are discovered from real Floci state:
//   Lambda event source mappings (SQS/DynamoDB stream -> Lambda), SNS subscriptions (topic -> sqs/lambda),
//   EventBridge rule targets (rule -> target), API Gateway integrations (api -> lambda),
//   S3 bucket notification configuration (bucket -> sqs/sns/lambda/eventbridge),
//   Lambda environment variables referencing a known resource name (lambda -> table/queue/topic/bucket, label "env reference").
// Additional labels: "rule" (event bus -> rule), "dead-letter" (queue -> DLQ from RedrivePolicy), "logs" (function -> /aws/lambda/<name> log group).
// Without `region` the default region is used. IAM roles are not graph nodes.

// GET /api/v1/health -> { status: "ok", version: string }
// GET /api/v1/floci/status -> { endpoint: string; healthy: boolean; status: "Healthy" | "Unreachable"; version?: string; edition?: string; services: { id: string; status: string }[]; latencyMs: number; error?: string }

// GET /api/v1/dashboard -> DashboardSummary
interface DashboardSummary {
  serviceCount: number;       // registered services
  availableServiceCount: number;
  resourceCount: number;
  regionCount: number;
  resourcesByService: { service: string; count: number }[];
  recentOperations: LogEntry[];   // latest 10
  errors: { service: string; message: string }[];   // resource discovery failures
}
// GET /api/v1/dashboard accepts an optional ?region= (resource counts for that region; all regions by default).

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
- Additions: exit code 255 for network/internal errors; `aws s3 rm s3://bucket/key`; `aws s3 rb s3://bucket --force` (deletes objects first); `aws s3 ls s3://bucket/prefix --recursive`; `aws <service> help` and `aws <service> <operation> help`; global `--region` (overrides the request `region`) and `--output json`; aliases `s3api` -> `s3`, `eventbridge` -> `events`; structure/map flags also accept the shorthand `Key=Value,Other=Value`; `--no-<flag>` sets a boolean to false.
- `logId` is the id of the last operation the command executed.

### 3.3 API Gateway stage invoke

Floci does not implement `TestInvokeMethod` (HTTP 406), so deployed REST APIs are executed through a proxy:

```ts
// POST /api/v1/apigateway/invoke   (honors X-Console-Source)
interface ApiInvokeRequest { restApiId: string; stage: string; method?: string /* default GET */; path?: string /* e.g. "/hello?x=1" */; headers?: Record<string, string>; body?: string; region?: string }
interface ApiInvokeResponse { status: number; headers: Record<string, string>; body: string; durationMs: number; url: string; logId: string }
```

It forwards to `{FLOCI_ENDPOINT}/restapis/{restApiId}/{stage}/_user_request_{path}` and always answers HTTP 200 with the upstream status inside (502 envelope `FlociUnreachable` only when Floci cannot be reached).
It is audited as a LogEntry with `service: "apigateway"`, `operation: "Invoke"`, `resourceName` = restApiId (status `error` with `errorKind: "aws"` when the upstream status is >= 400) and a successful call emits a ResourceEvent of type `ApiInvoked`.
Calling an undefined method/path returns 403 `{"message":"Missing Authentication Token"}`, like AWS.

## 4. Service registry (MVP + extras)

| id | shortName | Category | Resource types | Console in UI |
|---|---|---|---|---|
| s3 | S3 | Storage | bucket | yes |
| sqs | SQS | Application Integration | queue | yes |
| sns | SNS | Application Integration | topic | yes |
| dynamodb | DynamoDB | Database | table | yes |
| dynamodbstreams | DynamoDB Streams | Database | - | no (API Explorer, and the Streams tab of the DynamoDB console) |
| lambda | Lambda | Compute | function | yes |
| apigateway | API Gateway | Networking | restapi | yes |
| events | EventBridge | Application Integration | event-bus, rule | yes |
| logs | CloudWatch Logs | Management | log-group | no (API Explorer only) |
| iam | IAM | Security | role | no (API Explorer only) |
| apigatewayv2 | API Gateway V2 | Networking | api | no (API Explorer only) |

Operations are discovered by reflection on the SDK v2 client type (every exported method with signature `(ctx, *XInput, ...func(*Options)) (*XOutput, error)`), so every SDK operation is executable through the generic engine.
Coverage per operation: `supported` once it has succeeded (or failed with a regular AWS error) against Floci, `unsupported` once Floci answered it as not implemented, `untested` otherwise.
Coverage is kept in memory in the backend.
Only `aws` and `unsupported` error kinds (and successes) change coverage; `validation`, `network` and `application` errors say nothing about Floci.

`mutating` is false for operation names starting with List, Get, Describe, Head, Receive, Scan, Query, BatchGet, Search, Lookup, Select, Filter, Test, Validate, Estimate, Check, Detect, Preview.
ResourceEvent types emitted: `ResourceCreated`, `ResourceDeleted`, `ResourceUpdated` (generic by Create*/Delete*/other), `ObjectUploaded`, `ObjectDeleted`, `MessageSent`, `MessageDeleted`, `QueuePurged`, `MessagePublished`, `SubscriptionCreated`, `SubscriptionDeleted`, `ItemWritten`, `ItemDeleted`, `FunctionInvoked`, `TargetsAdded`, `TargetsRemoved`, `EventPublished`, `ApiDeployed`, `ApiInvoked`, `LogEventsWritten`.
`events.PutRule` emits `ResourceCreated`.

### 4.1 Floci behavior notes (verified against Floci 2.1.0 community)

- Duplicate `CreateBucket` in **us-east-1** for a bucket already in us-east-1 returns **HTTP 200** (no error), exactly like real AWS (legacy us-east-1 behavior).
  In any other case (request region other than us-east-1, or the bucket lives in another region) it returns HTTP 409 `BucketAlreadyOwnedByYou` ("Your previous request to create the named bucket succeeded and you already own it.").
  A UI flow that must show the duplicate-bucket error has to create the bucket in a region other than us-east-1 (e.g. us-east-2), or check existence first.
- `CreateBucket` in a non us-east-1 region works with or without `CreateBucketConfiguration`; sending `LocationConstraint: "us-east-1"` fails with `InvalidLocationConstraint`.
- Unimplemented operations (classified `unsupported`): JSON protocols answer HTTP 400 `UnknownOperationException` / `UnsupportedOperation`; query protocols answer 400 `UnsupportedOperation` or `InvalidAction`; REST protocols answer 404 with an HTML body, 405/406 with an empty body (e.g. API Gateway `GetClientCertificates`, `TestInvokeMethod`), or `UnknownOperationException`; S3 answers 501 `NotImplemented`.
  Good examples for tests: `dynamodb DescribeContributorInsights`, `sns GetSMSSandboxAccountStatus`, `events ListEndpoints`, `logs DescribeDeliveries`, `iam GetAccountAuthorizationDetails`, `lambda ListCodeSigningConfigs`.
- SQS queue URLs have no region: `http://localhost:4566/000000000000/<queue>`.
- Lambda: runtimes nodejs20.x/22.x, python3.12/3.13, java21, ruby3.3, provided.al2023, go1.x are accepted; functions run in sibling Docker containers (first invoke of a runtime pulls its image; later invokes take ~100 ms).
  Floci injects `AWS_ENDPOINT_URL=http://localhost.floci.io:4566` (plus `FLOCI_ENDPOINT`, `FLOCI_HOSTNAME`, `AWS_REGION`, credentials) into the function environment, so the AWS SDK inside a Lambda reaches Floci DynamoDB/SQS/S3 with a plain `new DynamoDBClient({})`; no endpoint configuration is needed in function code.
  `Invoke` with `LogType: "Tail"` does not return `LogResult`.
  Function error messages come as `{"__type": ..., "message": ...}`; the backend reads the message from the raw body.
- API Gateway: invoke URL format `{FLOCI_ENDPOINT}/restapis/{restApiId}/{stage}/_user_request_/{path}` (AWS_PROXY Lambda and MOCK integrations work); `GetResources` never returns `resourceMethods` (not even with `embed=methods`), use `GetMethod`/`GetIntegration`.
- S3 -> EventBridge: `PutBucketNotificationConfiguration` with `EventBridgeConfiguration: {}` delivers `source: "aws.s3"`, `detail-type: "Object Created"` events to the default bus of the bucket region.

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
