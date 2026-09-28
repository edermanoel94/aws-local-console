# AWS Local Console

AWS Local Console is a web application to explore and operate AWS services visually, with an interface inspired by the AWS Management Console.
It uses [Floci](https://github.com/floci-io/floci) as the local AWS runtime, so everything runs on your machine without an AWS account.

![AWS Local Console dashboard with recent operations across DynamoDB, SQS and SNS](docs/screenshots/dashboard.png)

You can list, create, inspect, edit and delete resources, run arbitrary AWS operations, inspect requests and responses, browse logs and events, and explore relationships between resources.
The console has a light and a dark theme, and by default follows the one of your operating system; pick one from the top bar or in Settings.
The Cost Simulator estimates what the resources of the selected region would cost per month on AWS: it applies public on-demand list prices of US East (N. Virginia) to the resources it finds and to the monthly usage you type for each service.

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

## Run it with Docker

The console is published on Docker Hub as [`edercosta/aws-local-console`](https://hub.docker.com/r/edercosta/aws-local-console): one image with the web console and its API, for `linux/amd64` and `linux/arm64`.
It needs [Floci](https://hub.docker.com/r/floci/floci), the local AWS runtime, next to it.
You only need Docker; no checkout, build, Node.js or Go.

### With Docker Compose

```yaml
services:
  floci:
    image: floci/floci:2.1.0
    ports:
      - "4566:4566"
    environment:
      FLOCI_STORAGE_MODE: memory # or persistent, to keep resources between restarts
      FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK: aws-local-console
    volumes:
      - floci-data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock # Floci runs Lambda functions as containers
    extra_hosts:
      - "host.docker.internal:host-gateway"

  console:
    image: edercosta/aws-local-console:latest
    ports:
      - "4500:4500"
    environment:
      FLOCI_ENDPOINT: http://floci:4566
    depends_on:
      - floci

volumes:
  floci-data:

networks:
  default:
    name: aws-local-console
```

```bash
docker compose up -d
```

Open http://localhost:4500.
Your code and the AWS CLI talk to Floci at http://localhost:4566 with any credentials, for example `aws --endpoint-url http://localhost:4566 sqs list-queues`.

### With Docker only

Pull the images, create a network and start Floci and the console on it:

```bash
docker pull floci/floci:2.1.0
docker pull edercosta/aws-local-console:latest

docker network create aws-local-console

docker run -d --name floci --network aws-local-console -p 4566:4566 \
  -e FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK=aws-local-console \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --add-host=host.docker.internal:host-gateway \
  floci/floci:2.1.0

docker run -d --name aws-local-console --network aws-local-console -p 4500:4500 \
  -e FLOCI_ENDPOINT=http://floci:4566 \
  edercosta/aws-local-console:latest
```

Open http://localhost:4500.
To keep resources between restarts, add `-e FLOCI_STORAGE_MODE=persistent -v floci-data:/app/data` to the Floci command.

Already running Floci on your machine? Start only the console and point it at the host:

```bash
docker run -d --name aws-local-console -p 4500:4500 \
  --add-host=host.docker.internal:host-gateway \
  -e FLOCI_ENDPOINT=http://host.docker.internal:4566 \
  edercosta/aws-local-console:latest
```

### Settings

| Variable | Default | Description |
|---|---|---|
| `FLOCI_ENDPOINT` | `http://floci:4566` | Floci URL used by the console |
| `LOG_LEVEL` | `info` | Console API log level: `trace`, `debug`, `info`, `warning` (or `warn`) or `error` |
| `FLOCI_STORAGE_MODE` (Floci) | `memory` | `memory` loses all resources on restart; `persistent` (or `hybrid`) keeps them in `/app/data` |

The console works however it is opened (localhost, 127.0.0.1, a LAN IP, a tunnel or another device), with no extra setup.
Pin a version such as `edercosta/aws-local-console:0.1.4` instead of `latest` for reproducible setups, or use `edge` to follow the `main` branch with the features that are not released yet.
The Docker Hub page text lives in [`docker/README.dockerhub.md`](docker/README.dockerhub.md).

## Requirements

- Docker with Docker Compose v2
- GNU Make
- Node.js 24 with corepack (the pnpm version is pinned in `packageManager`)
- Go (version from `backend/go.mod`) for local API development
- curl (or wget) for the wait script

## License

[MIT](LICENSE)
