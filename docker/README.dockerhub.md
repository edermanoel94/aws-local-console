# AWS Local Console

A web console to explore and operate AWS services running locally on [Floci](https://hub.docker.com/r/floci/floci), with an interface inspired by the AWS Management Console.
No AWS account needed: everything runs on your machine.

- **Services and consoles** for S3, SQS, SNS, DynamoDB, Lambda, API Gateway and EventBridge: create, inspect, edit and delete resources.
- **API Explorer**: run any AWS SDK operation and inspect the raw request, response, headers and request id.
- **Resource Explorer** with search by name, ARN and tags, across services and regions.
- **Architecture** graph discovered from real state (event source mappings, subscriptions, rule targets, integrations, notifications).
- **Logs and Events**: an audit trail of every operation, with a request inspector.
- **CLI** in the browser: `aws s3 ls`, `aws sqs list-queues`, `aws <service> <operation> --flags`.

This single image contains the Go API and the Next.js web console.
Only port `3000` is exposed; the browser reaches the API through the web server's `/api/v1` proxy, so the console works from any host name or device.

## Quick start

Save this as `compose.yaml` and run `docker compose up -d --wait`, then open http://localhost:3000.

```yaml
# Optional settings (environment variables or an .env file next to this file):
#   AWS_LOCAL_CONSOLE_VERSION  console image tag (default: latest), e.g. 1.2.3
#   FLOCI_VERSION              Floci image tag (default: 2.1.0, the version the console is tested with)
#   AWS_REGION                 default region of Floci and of the console (default: us-east-1)
#   FLOCI_STORAGE_MODE         memory (default, state is lost on restart), persistent or hybrid;
#                              persistent state lives in the floci-data volume
#   FLOCI_ENDPOINT             Floci URL used by the console (default: the floci service)
#   WEB_PORT (3000), FLOCI_PORT (4566)  host ports
# Any other Floci setting can be added under floci.environment (FLOCI_* variables).
#
# edercosta/aws-local-console is a single image with the Go API and the web
# console; the browser calls /api/v1 on the web port, which the web server
# proxies to the API inside the container, so it works from any host name.
# Lambda functions run as sibling containers that Floci starts through the
# Docker socket, on the network named below.

name: aws-local-console

services:
  floci:
    image: floci/floci:${FLOCI_VERSION:-2.1.0}
    restart: unless-stopped
    ports:
      - "${FLOCI_PORT:-4566}:4566"
    environment:
      FLOCI_DEFAULT_REGION: ${AWS_REGION:-us-east-1}
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
    image: edercosta/aws-local-console:${AWS_LOCAL_CONSOLE_VERSION:-latest}
    # The container exits if its API process dies; come back automatically.
    restart: unless-stopped
    ports:
      - "${WEB_PORT:-3000}:3000"
    environment:
      FLOCI_ENDPOINT: ${FLOCI_ENDPOINT:-http://floci:4566}
      AWS_REGION: ${AWS_REGION:-us-east-1}
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
docker run -d -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e FLOCI_ENDPOINT=http://host.docker.internal:4566 \
  edercosta/aws-local-console
```

## Configuration

Set these in the shell or in an `.env` file next to `compose.yaml`, e.g. `AWS_REGION=sa-east-1 FLOCI_STORAGE_MODE=persistent docker compose up -d --wait`.

| Variable | Default | Description |
|---|---|---|
| `AWS_LOCAL_CONSOLE_VERSION` | `latest` | Console image tag, e.g. `0.1.0` |
| `FLOCI_VERSION` | `2.1.0` | Floci image tag (the version the console is tested with) |
| `AWS_REGION` | `us-east-1` | Default region of Floci and of the console (the region selector starts there) |
| `FLOCI_STORAGE_MODE` | `memory` | `memory` loses all resources on restart; `persistent` (or `hybrid`) keeps them in the `floci-data` volume |
| `FLOCI_ENDPOINT` | `http://floci:4566` | Floci URL used by the console, e.g. to point it at another Floci |
| `WEB_PORT` / `FLOCI_PORT` | `3000` / `4566` | Host ports |

Any other [Floci setting](https://hub.docker.com/r/floci/floci) can be added under `floci.environment` as a `FLOCI_*` variable (for example `FLOCI_SERVICES_LAMBDA_EPHEMERAL=true`).
Remove persisted resources with `docker compose down -v`.

Environment of the console image itself (already set by the compose file above):

| Variable | Default | Description |
|---|---|---|
| `FLOCI_ENDPOINT` | `http://floci:4566` | Floci endpoint as seen from the container |
| `AWS_REGION` | `us-east-1` | Default region |
| `PORT` | `3000` | Port of the web console (the one to publish) |
| `API_PORT` | `8080` | Internal port of the Go API inside the container (not published) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `test` / `test` | Credentials sent to Floci |

The console assumes Floci's default account id `000000000000`.
The container runs as the unprivileged `node` user and has a healthcheck that is healthy only when both the web server and the API answer.
If the API process stops, the container exits, so a restart policy brings it back.

## Tags and platforms

- `latest`: the most recent release.
- `<major>.<minor>.<patch>` (e.g. `0.1.0`): a specific release; pin this for reproducible setups.
- Every tag is multi-arch: `linux/amd64` and `linux/arm64` (Apple Silicon, ARM servers).

## License

MIT.
This project is not affiliated with or endorsed by Amazon Web Services.
