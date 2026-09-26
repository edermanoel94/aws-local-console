# AWS Local Console

AWS Local Console is a web application to explore and operate AWS services visually, with an interface inspired by the AWS Management Console.
It uses [Floci](https://github.com/floci-io/floci) as the local AWS runtime, so everything runs on your machine without an AWS account.

You can list, create, inspect, edit and delete resources, run arbitrary AWS operations, inspect requests and responses, browse logs and events, and explore relationships between resources.

## Architecture

```text
            Browser
               |
               v
  +---------------------------+
  |  Next.js (frontend/)      |  http://localhost:3000
  |  App Router, React,       |
  |  TanStack Query, Zustand, |
  |  Monaco, React Flow,      |
  |  xterm.js                 |
  +-------------+-------------+
                | HTTP (browser -> API, CORS)
                v
  +---------------------------+
  |  Go API (backend/)        |  http://localhost:8080
  |  Service Registry,        |
  |  Operation Engine,        |
  |  Resource Explorer, Audit |
  +-------------+-------------+
                | AWS SDK for Go v2
                v
  +---------------------------+
  |  Floci (floci/floci)      |  http://localhost:4566
  |  S3, SQS, SNS, DynamoDB,  |
  |  Lambda, API Gateway,     |
  |  EventBridge, ...         |
  +-------------+-------------+
                | Docker socket
                v
      Lambda runtime containers
      (siblings on the same Docker network)


  Playwright (tests/e2e/) -> Browser -> Next.js -> Go API -> Floci
```

The browser calls the Go API directly, so the API URL is baked into the frontend bundle at build time (`NEXT_PUBLIC_API_URL`).
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

This builds the images, starts Floci, the Go API and the Next.js app, and waits until all of them are healthy.
Then open http://localhost:3000.

Other stack commands:

| Command | Description |
|---|---|
| `make up` | Build and start the full stack, then wait for health |
| `make down` | Stop the stack and remove leftover Lambda containers (volumes are kept) |
| `make logs` | Follow the logs of all services |
| `make build` | Build the backend and frontend images |
| `make wait` | Wait for Floci, the API and the web app to answer |
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
Floci health can be checked at http://localhost:4566/_floci/health and the API health at http://localhost:8080/api/v1/health.

Equivalent manual commands:

```bash
docker compose up -d --wait floci

cd backend
FLOCI_ENDPOINT=http://localhost:4566 AWS_REGION=us-east-1 \
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
PORT=8080 CORS_ORIGINS=http://localhost:3000 go run ./cmd/api

cd frontend
pnpm install
NEXT_PUBLIC_API_URL=http://localhost:8080 pnpm dev
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
| `API_PORT` | `8080` | Go API host port, also used to build `NEXT_PUBLIC_API_URL` |
| `WEB_PORT` | `3000` | Next.js host port, also used for the API `CORS_ORIGINS` |

Pass them to Make or export them before calling Docker Compose:

```bash
make up API_PORT=18080 WEB_PORT=13000
make e2e API_PORT=18080 WEB_PORT=13000
API_PORT=18080 WEB_PORT=13000 docker compose up -d --build --wait
```

Go API environment variables:

| Variable | Default | Description |
|---|---|---|
| `FLOCI_ENDPOINT` | `http://localhost:4566` | Floci endpoint (`http://floci:4566` inside Compose) |
| `AWS_REGION` | `us-east-1` | Default region |
| `AWS_ACCESS_KEY_ID` | `test` | Credentials accepted by Floci |
| `AWS_SECRET_ACCESS_KEY` | `test` | Credentials accepted by Floci |
| `PORT` | `8080` | Port the API listens on |
| `CORS_ORIGINS` | `http://localhost:3000` | Origins allowed to call the API from the browser |

Frontend environment variables:

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | Go API URL as seen by the browser, inlined at build time (Docker build arg) |

Playwright environment variables:

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | Web app URL used by the tests |
| `TEST_RUN_ID` | current time | Suffix that keeps resource names unique per run |

### Floci and Lambda networking

Lambda functions run as sibling Docker containers that Floci starts through the mounted Docker socket.
Compose pins the network name to `aws-local-console` and passes it to Floci with `FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK`, so Lambda containers join the same network as Floci.
Inside a Lambda, `AWS_ENDPOINT_URL` points to `http://localhost.floci.io:4566`, which the Floci embedded DNS resolves to the Floci container.
`FLOCI_HOSTNAME` is intentionally not set, so resource URLs returned by Floci (for example SQS queue URLs) stay usable from the host.
Lambda containers are labelled `floci=true`, and `make down` and `make clean` remove any leftovers.

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
