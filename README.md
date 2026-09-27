# AWS Local Console

AWS Local Console is a web application to explore and operate AWS services visually, with an interface inspired by the AWS Management Console.
It uses [Floci](https://github.com/floci-io/floci) as the local AWS runtime, so everything runs on your machine without an AWS account.

![AWS Local Console dashboard with recent operations across DynamoDB, SQS and SNS](docs/screenshots/dashboard.png)

You can list, create, inspect, edit and delete resources, run arbitrary AWS operations, inspect requests and responses, browse logs and events, and explore relationships between resources.
The console has a light and a dark theme, and by default follows the one of your operating system; pick one from the top bar or in Settings.
The Cost Simulator estimates what the resources of the selected region would cost per month on AWS: it applies public on-demand list prices of US East (N. Virginia) to the resources it finds and to the monthly usage you type for each service.

## Why use it

Local AWS emulators are great for tests, but they have no console: you end up reading JSON from the CLI to find out what a queue holds or which items a table has.
AWS Local Console gives your local environment the console experience you already know from AWS, so you can:

- **See your whole environment at a glance**: services, resources, recent operations and the health of Floci on one dashboard.
- **Develop and debug without an AWS account or bill**: create tables, queues and topics, send test messages and edit items in seconds, all on your machine.
- **Understand what your code does**: every operation is recorded with its request, response, status and duration, whether it came from the console, the API Explorer or the CLI.
- **Explore event-driven flows**: follow a message from an SNS topic to its SQS subscribers, and from a DynamoDB stream to its Lambda trigger.
- **Plan before you deploy**: the Cost Simulator estimates what the same resources would cost per month on AWS.

## A quick tour

### DynamoDB

Browse tables with their keys, item counts and capacity mode, then scan or query items, filter them and edit them in place.

| Tables | Items |
|---|---|
| ![DynamoDB tables with partition and sort keys](docs/screenshots/dynamodb-tables.png) | ![DynamoDB items explorer showing the orders of a demo shop](docs/screenshots/dynamodb-items.png) |

### SQS

List standard and FIFO queues with their message counts, then send, receive and delete messages from the browser.
Dead-letter queues, redrive policies and Lambda triggers are one click away.

| Queues | Messages |
|---|---|
| ![SQS queues with available and in-flight messages](docs/screenshots/sqs-queues.png) | ![Messages received from an SQS queue](docs/screenshots/sqs-messages.png) |

### SNS

Create topics, subscribe queues, Lambda functions, HTTP endpoints or email addresses, see which subscriptions are confirmed and publish messages to test the fan-out.

| Topics | Subscriptions |
|---|---|
| ![SNS topics](docs/screenshots/sns-topics.png) | ![SNS topic with SQS and email subscriptions](docs/screenshots/sns-topic.png) |

### Dark theme

![AWS Local Console dashboard in the dark theme](docs/screenshots/dashboard-dark.png)

## Run the published images

No checkout or build needed: download [`compose.release.yaml`](compose.release.yaml) and start it.
It runs Floci plus the published [`edercosta/aws-local-console`](https://hub.docker.com/r/edercosta/aws-local-console) image, a single image with the Go API and the web console (linux/amd64 and linux/arm64).

```bash
curl -fsSLO https://raw.githubusercontent.com/edermanoel94/aws-local-console/main/compose.release.yaml
docker compose -f compose.release.yaml up -d --wait
```

Then open http://localhost:4500.
Stop it with `docker compose -f compose.release.yaml down` (add `-v` to also delete persisted Floci data).

Settings (shell variables or an `.env` file next to the compose file):

| Variable | Default | Description |
|---|---|---|
| `FLOCI_STORAGE_MODE` | `memory` | `memory` loses all resources on restart; `persistent` (or `hybrid`) keeps them in the `floci-data` volume |
| `FLOCI_ENDPOINT` | `http://floci:4566` | Floci URL used by the console |
| `LOG_LEVEL` | `info` | Go API log level: `trace`, `debug`, `info`, `warning` (or `warn`) or `error` |

The Docker Hub page text lives in [`docker/README.dockerhub.md`](docker/README.dockerhub.md).

## Architecture

```text
              Browser
                 |  http://localhost:4500 (the only published port)
                 v
  +-- console image: edercosta/aws-local-console ---+
  |                                                 |
  |   +-----------------------------------------+   |
  |   |  Next.js (frontend/)                    |   |
  |   |  App Router, React, TanStack Query,     |   |
  |   |  Zustand, Monaco, React Flow, xterm.js  |   |
  |   +--------------------+--------------------+   |
  |                        | /api/v1 proxy          |
  |                        v 127.0.0.1:8080         |
  |   +-----------------------------------------+   |
  |   |  Go API (backend/)                      |   |
  |   |  Service Registry, Operation Engine,    |   |
  |   |  Resource Explorer, Audit               |   |
  |   +--------------------+--------------------+   |
  |                        |                        |
  +------------------------|------------------------+
                           | AWS SDK for Go v2
                           v
  +-------------------------------------------------+
  |  Floci (floci/floci)     http://localhost:4566  |
  |  S3, SQS, SNS, DynamoDB, Lambda, API Gateway,   |
  |  EventBridge, ...                               |
  +------------------------+------------------------+
                           | Docker socket
                           v
                Lambda runtime containers
             (siblings on the same Docker network)


  Playwright (tests/e2e/) -> Browser -> Next.js -> Go API -> Floci
```

The Go API and the Next.js server ship together in one image (root [`Dockerfile`](Dockerfile)); [`docker/entrypoint.mjs`](docker/entrypoint.mjs) starts both and stops the container if the API dies.
The browser only talks to Next.js: it calls `/api/v1/*` on the same origin, and a Next.js route handler proxies those requests to the Go API (`API_INTERNAL_URL`, read at runtime).
So the console works however it is opened (localhost, 127.0.0.1, a LAN IP, a tunnel or another device), with no CORS setup and no API URL baked into the image.
The shared contract between the three parts lives in [docs/CONTRACT.md](docs/CONTRACT.md), and the product specification in [SPEC.md](SPEC.md).

## Requirements

- Docker with Docker Compose v2
- GNU Make
- Node.js 24 with corepack (the pnpm version is pinned in `packageManager`)
- Go (version from `backend/go.mod`) for local API development
- curl (or wget) for the wait script

## Quick start

```bash
make up
```

This builds the console image (Go API + Next.js), starts it with Floci, and waits until both are healthy.
Then open http://localhost:4500.

Other stack commands:

| Command | Description |
|---|---|
| `make up` | Build and start the full stack, then wait for health |
| `make down` | Stop the stack and remove leftover Lambda containers (volumes are kept) |
| `make logs` | Follow the logs of all services |
| `make build` | Build the console image |
| `make wait` | Wait for Floci and the console (web server and API) to answer |
| `make clean` | Remove containers, volumes, Lambda containers and test artifacts |
| `make help` | List all targets |

## Local development workflow

For day-to-day work run Floci in Docker and the API and web app on the host, with hot reload:

```bash
make dev-floci      # Floci only, via docker compose
make dev-backend    # go run ./cmd/api against http://localhost:4566
make dev-frontend   # pnpm dev (Next.js) against http://localhost:8080
```

Run `make dev-backend` and `make dev-frontend` in separate terminals.
Floci health can be checked at http://localhost:4566/_floci/health and the API health at http://localhost:8080/api/v1/health (in Docker, through the console at http://localhost:4500/api/v1/health).

Equivalent manual commands:

```bash
docker compose up -d --wait floci

cd backend
FLOCI_ENDPOINT=http://localhost:4566 AWS_REGION=us-east-1 \
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
PORT=8080 CORS_ORIGINS=http://localhost:4500 go run ./cmd/api

cd frontend
pnpm install
API_INTERNAL_URL=http://localhost:8080 pnpm dev
```

If `pnpm` is not on your `PATH`, run `corepack enable pnpm` once, or prefix the commands with `corepack`.

## Testing

The project is validated through end-to-end tests only: Playwright drives a real browser against the real stack (Next.js, Go API and Floci).
There are no unit tests by design.

```bash
make e2e-install   # once: download the Playwright Chromium browser
make e2e           # start the stack, wait for health, run the whole suite
make e2e-ui        # Playwright UI mode against the running stack
make e2e-report    # open the last HTML report
```

`make e2e` sets a unique `TEST_RUN_ID` so every run creates uniquely named resources, and forwards extra Playwright arguments through `ARGS`, for example `make e2e ARGS="tests/e2e/s3 --headed"`.
The HTML report is written to `playwright-report/`, and screenshots, videos and traces of failed tests to `test-results/`.

The same pipeline runs in GitHub Actions ([.github/workflows/e2e.yml](.github/workflows/e2e.yml)), which uploads `playwright-report/` and `test-results/` as artifacts and attaches the Docker Compose logs when a run fails.

## Configuration

Host ports are configurable, which helps when a default port is already taken:

| Variable | Default | Used for |
|---|---|---|
| `FLOCI_PORT` | `4566` | Floci host port |
| `WEB_PORT` | `4500` | Next.js host port |

Pass them to Make or export them before calling Docker Compose:

```bash
make up WEB_PORT=13000
make e2e WEB_PORT=13000
WEB_PORT=13000 docker compose up -d --build --wait
```

Console image environment variables (defaults already suit Compose):

| Variable | Default | Description |
|---|---|---|
| `FLOCI_ENDPOINT` | `http://floci:4566` | Floci endpoint as seen from the container |
| `PORT` | `4500` | Port the web console listens on (the published port) |
| `API_PORT` | `8080` | Internal port of the Go API inside the container (not published) |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `us-east-1`, `test`, `test` | Region and credentials used against Floci |
| `LOG_LEVEL` | `info` | Go API log level (see below) |

Go API environment variables (when running it on the host):

| Variable | Default | Description |
|---|---|---|
| `FLOCI_ENDPOINT` | `http://localhost:4566` | Floci endpoint (`http://floci:4566` inside Compose) |
| `AWS_REGION` | `us-east-1` | Default region |
| `AWS_ACCESS_KEY_ID` | `test` | Credentials accepted by Floci |
| `AWS_SECRET_ACCESS_KEY` | `test` | Credentials accepted by Floci |
| `PORT` | `8080` | Port the API listens on |
| `CORS_ORIGINS` | `http://localhost:4500` | Origins allowed to call the API directly from a browser (not needed by the console) |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warning` (or `warn`) or `error`; an unknown value logs a warning and falls back to `info` |

The Go API logs to stdout, one line per record, at five levels:

| Level | What is logged |
|---|---|
| `TRACE` | Every request's query and caller, the AWS wire exchange of each operation (URL, headers with credentials redacted, input and output payloads) and every Floci health check |
| `DEBUG` | Every HTTP request with its status and duration, and each service's resource discovery |
| `INFO` | Startup, successful operations and Floci becoming reachable |
| `WARNING` | Operations rejected by AWS or by input validation, failed resource discovery, Floci becoming unreachable and an unknown `LOG_LEVEL` |
| `ERROR` | Operations that failed because Floci was unreachable or the console failed, panics and HTTP 5xx answers |

Frontend environment variables (when running it on the host):

| Variable | Default | Description |
|---|---|---|
| `API_INTERNAL_URL` | `http://localhost:8080` | Go API URL as seen by the Next.js server, read at runtime (set by the entrypoint in the image) |

Playwright environment variables:

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | `http://localhost:4500` | Web app URL used by the tests |
| `TEST_RUN_ID` | current time | Suffix that keeps resource names unique per run |
| `E2E_HOST_FROM_FLOCI` | `host.docker.internal` | Host name under which Floci reaches HTTP servers started by the tests (SNS HTTP subscriptions) |

### Floci and Lambda networking

Lambda functions run as sibling Docker containers that Floci starts through the mounted Docker socket.
Compose pins the network name to `aws-local-console` and passes it to Floci with `FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK`, so Lambda containers join the same network as Floci.
Inside a Lambda, `AWS_ENDPOINT_URL` points to `http://localhost.floci.io:4566`, which the Floci embedded DNS resolves to the Floci container.
`FLOCI_HOSTNAME` is intentionally not set, so resource URLs returned by Floci (for example SQS queue URLs) stay usable from the host.
Lambda containers are labelled `floci=true`, and `make down` and `make clean` remove any leftovers.

### SNS HTTP subscriptions to apps on your machine

Both compose files map `host.docker.internal` to the host gateway in the Floci container, so an SNS HTTP or HTTPS subscription can deliver to an app running on the host, for example `http://host.docker.internal:3000/webhook`.
SNS first posts a `SubscriptionConfirmation` message to the endpoint; paste its `Token` or `SubscribeURL` in the subscription page of the SNS console (Confirm subscription) to start receiving notifications.

## Releasing

The image is published to Docker Hub as `edercosta/aws-local-console`, for linux/amd64 and linux/arm64.
The Dockerfile cross-builds on the build machine's native platform, so no emulation (QEMU) is needed for arm64.

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) runs the full E2E suite and only then builds and pushes the image, with SBOM and provenance attestations:

| Event | Tags published |
|---|---|
| Push to `main` | `edge` |
| Push of a tag `v1.2.3` | `1.2.3`, `1.2`, `latest` |
| Pull request | none (E2E only, [`.github/workflows/e2e.yml`](.github/workflows/e2e.yml)) |

`latest` only moves on version tags, so it always points at a release; `edge` follows `main`.
Cutting a release from CI is just:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The workflow needs the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token, not the password).

From a workstation: after `docker login`, tag the release commit and run `make release`.

```bash
git tag v1.2.3
make release            # or: make release VERSION=1.2.3
```

`make release` builds each platform separately and pushes `<version>-<arch>` tags, then joins them into the multi-arch `<version>` and `latest` tags.
It refuses to run with a dirty working tree or a non-semver version.

## Project structure

```text
.
├── backend/                 Go API (AWS SDK for Go v2)
│   ├── cmd/api/             API entry point
│   ├── internal/            Service registry, operation engine, discovery, audit
│   └── Dockerfile
├── frontend/                Next.js app (App Router, TypeScript, Tailwind CSS)
│   ├── app/                 Routes
│   ├── components/          Shared UI components
│   ├── features/            Feature modules (services, explorer, CLI, ...)
│   └── Dockerfile           Multi-stage build on `output: "standalone"`
├── tests/e2e/               Playwright end-to-end suite
├── docs/CONTRACT.md         API and UI contract shared by all parts
├── scripts/wait-for.sh      Wait until an HTTP endpoint is healthy
├── docker-compose.yml       Floci + Go API + Next.js
├── playwright.config.ts     Playwright configuration
├── Makefile                 Developer and CI entry points
└── SPEC.md                  Product specification
```

## License

[MIT](LICENSE)
