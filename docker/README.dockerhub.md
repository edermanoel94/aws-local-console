# AWS Local Console

A web console to explore and operate AWS services running locally on [Floci](https://hub.docker.com/r/floci/floci), with an interface inspired by the AWS Management Console.
No AWS account needed: everything runs on your machine.

- **Services and consoles** for S3, SQS, SNS, DynamoDB, Lambda, API Gateway and EventBridge: create, inspect, edit and delete resources.
- **API Explorer**: run any AWS SDK operation and inspect the raw request, response, headers and request id.
- **Resource Explorer** with search by name, ARN and tags, across services and regions.
- **Architecture** graph discovered from real state (event source mappings, subscriptions, rule targets, integrations, notifications).
- **Logs and Events**: an audit trail of every operation, with a request inspector.
- **CLI** in the browser: `aws s3 ls`, `aws sqs list-queues`, `aws <service> <operation> --flags`.

Source code, issues and releases: https://github.com/edermanoel94/aws-local-console

This single image contains the Go API and the Next.js web console.
Only port `4500` is exposed; the browser reaches the API through the web server's `/api/v1` proxy, so the console works from any host name or device.

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/edermanoel94/aws-local-console/main/compose.release.yaml -o compose.yaml
docker compose up -d --wait
```

Then open http://localhost:4500.
The file is shown below, if you prefer to create it yourself.

```yaml
# Optional settings (environment variables or an .env file next to this file):
#   FLOCI_STORAGE_MODE  memory (default, state is lost on restart), persistent or hybrid;
#                       persistent state lives in the floci-data volume
#   FLOCI_ENDPOINT      Floci URL used by the console (default: the floci service)
#
# edercosta/aws-local-console is a single image with the Go API and the web
# console; the browser calls /api/v1 on the web port, which the web server
# proxies to the API inside the container, so it works from any host name.
# Lambda functions run as sibling containers that Floci starts through the
# Docker socket, on the network named below.

name: aws-local-console

services:
  floci:
    image: floci/floci:2.1.0
    restart: unless-stopped
    ports:
      - "4566:4566"
    environment:
      FLOCI_STORAGE_MODE: ${FLOCI_STORAGE_MODE:-memory}
      # Fixed: Lambda containers must join this compose network to reach Floci.
      FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK: aws-local-console
    volumes:
      - floci-data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    healthcheck:
      # The Floci image ships no curl/wget/grep; probe with bash /dev/tcp and check the HTTP status line.
      test: ["CMD-SHELL", "exec 3<>/dev/tcp/127.0.0.1/4566 && printf 'GET /_floci/health HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && read -r status <&3 && case \"$$status\" in *200*) exit 0;; esac; exit 1"]
      interval: 3s
      timeout: 3s
      retries: 40

  console:
    image: edercosta/aws-local-console:latest
    # The container exits if its API process dies; come back automatically.
    restart: unless-stopped
    ports:
      - "4500:4500"
    environment:
      FLOCI_ENDPOINT: ${FLOCI_ENDPOINT:-http://floci:4566}
    depends_on:
      floci:
        condition: service_healthy

volumes:
  floci-data:

networks:
  default:
    name: aws-local-console
```

Already running Floci on the host?

```bash
docker run -d -p 4500:4500 \
  --add-host=host.docker.internal:host-gateway \
  -e FLOCI_ENDPOINT=http://host.docker.internal:4566 \
  edercosta/aws-local-console
```

## Configuration

Set these in the shell or in an `.env` file next to `compose.yaml`, e.g. `FLOCI_STORAGE_MODE=persistent docker compose up -d --wait`.

| Variable | Default | Description |
|---|---|---|
| `FLOCI_STORAGE_MODE` | `memory` | `memory` loses all resources on restart; `persistent` (or `hybrid`) keeps them in the `floci-data` volume (remove it with `docker compose down -v`) |
| `FLOCI_ENDPOINT` | `http://floci:4566` | Floci URL used by the console, e.g. to point it at another Floci |

The console assumes Floci's defaults: region `us-east-1` and account id `000000000000`.
The container runs as the unprivileged `node` user and has a healthcheck that is healthy only when both the web server and the API answer.
If the API process stops, the container exits, so the restart policy brings it back.

## Tags and platforms

- `latest`: the most recent release.
- `<major>.<minor>.<patch>` (e.g. `0.1.3`): a specific release; pin this for reproducible setups.
- `<major>.<minor>` (e.g. `0.1`): the latest patch of that minor version.
- `edge`: the current `main` branch, published after every successful E2E run; may change at any time.
- Every tag is multi-arch: `linux/amd64` and `linux/arm64` (Apple Silicon, ARM servers).

## License

MIT.
This project is not affiliated with or endorsed by Amazon Web Services.
