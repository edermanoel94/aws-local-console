# AWS Local Console - developer and CI entry points.
#
# Host ports can be overridden per invocation, e.g. `make up WEB_PORT=13000`.
# The same variables are read by docker-compose.yml.

SHELL := /bin/sh

FLOCI_PORT ?= 4566
WEB_PORT ?= 3000
export FLOCI_PORT WEB_PORT

FLOCI_URL := http://localhost:$(FLOCI_PORT)
WEB_URL := http://localhost:$(WEB_PORT)
# In the container the API is reached through the web server's /api/v1 proxy.
API_URL := $(WEB_URL)
# Port of the Go API when it runs on the host (dev-backend / dev-frontend).
DEV_API_PORT ?= 8080

# Seconds to wait for each service to become healthy.
WAIT_TIMEOUT ?= 180

# Unique id used by the Playwright suite to namespace resource names.
TEST_RUN_ID ?= $(shell date +%s)

# Prefer a pnpm on PATH (shim or global install); otherwise go through corepack,
# which honours the `packageManager` field in package.json.
PNPM ?= $(shell command -v pnpm >/dev/null 2>&1 && echo pnpm || echo corepack pnpm)

COMPOSE ?= docker compose
WAIT_FOR := ./scripts/wait-for.sh

# Published image (Go API + web console): $(IMAGE) on Docker Hub.
IMAGE_NAMESPACE ?= edercosta
IMAGE := $(IMAGE_NAMESPACE)/aws-local-console
RELEASE_PLATFORMS ?= amd64 arm64
# Release version without the leading "v"; defaults to the tag on HEAD (e.g. v1.2.3 -> 1.2.3).
VERSION ?= $(shell git describe --tags --exact-match 2>/dev/null | sed 's/^v//')

# Lambda functions are sibling containers started by Floci and labelled floci=true.
# Only the ones attached to this stack's network are removed, so other Floci instances are left alone.
define remove_lambda_containers
	@ids=$$(docker ps -aq --filter label=floci=true --filter network=aws-local-console); \
	if [ -n "$$ids" ]; then echo "Removing Floci Lambda containers"; docker rm -f $$ids >/dev/null; fi
endef

.DEFAULT_GOAL := help

.PHONY: help up down logs build wait e2e e2e-ui e2e-report e2e-install clean \
	dev-floci dev-backend dev-frontend deps release

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------------------
# Full stack (Docker Compose)
# ---------------------------------------------------------------------------

up: ## Build and start Floci and the console image, then wait until healthy
	$(COMPOSE) up -d --build --wait
	@$(MAKE) --no-print-directory wait
	@echo "AWS Local Console is running at $(WEB_URL)"

down: ## Stop the stack (keeps volumes)
	$(COMPOSE) stop
	$(remove_lambda_containers)
	$(COMPOSE) down --remove-orphans

logs: ## Follow logs of all services
	$(COMPOSE) logs -f

build: ## Build the console image (Go API + Next.js)
	$(COMPOSE) build

wait: ## Wait for Floci and the console (web server and API) to answer
	@$(WAIT_FOR) $(FLOCI_URL)/_floci/health $(WAIT_TIMEOUT) Floci
	@$(WAIT_FOR) $(WEB_URL)/api/v1/health $(WAIT_TIMEOUT) "Console (web + API)"

# ---------------------------------------------------------------------------
# End-to-end tests (Playwright, run from the repository root)
# ---------------------------------------------------------------------------

deps: ## Install root (Playwright) dependencies from the lockfile (no-op when up to date)
	$(PNPM) install --frozen-lockfile

e2e-install: deps ## Install the Playwright Chromium browser
	$(PNPM) exec playwright install chromium

e2e: deps up ## Start the stack and run the Playwright suite (report kept in playwright-report/)
	@echo "Running Playwright with TEST_RUN_ID=$(TEST_RUN_ID) against $(WEB_URL)"
	TEST_RUN_ID=$(TEST_RUN_ID) BASE_URL=$(WEB_URL) API_URL=$(API_URL) FLOCI_ENDPOINT=$(FLOCI_URL) \
		$(PNPM) exec playwright test $(ARGS) \
		|| { status=$$?; echo "Playwright failed; open the report with 'make e2e-report'"; exit $$status; }

e2e-ui: deps ## Open the Playwright UI mode against the running stack
	TEST_RUN_ID=$(TEST_RUN_ID) BASE_URL=$(WEB_URL) API_URL=$(API_URL) FLOCI_ENDPOINT=$(FLOCI_URL) \
		$(PNPM) exec playwright test --ui $(ARGS)

e2e-report: deps ## Open the last Playwright HTML report
	$(PNPM) exec playwright show-report

clean: ## Remove containers, volumes, Lambda containers and test artifacts
	-$(COMPOSE) stop
	$(remove_lambda_containers)
	$(COMPOSE) down --volumes --remove-orphans
	rm -rf playwright-report test-results blob-report playwright/.cache backend/bin

# ---------------------------------------------------------------------------
# Local development (Floci in Docker, API and web app on the host)
# ---------------------------------------------------------------------------

dev-floci: ## Start only Floci and wait until it is healthy
	$(COMPOSE) up -d --wait floci

dev-backend: ## Run the Go API on the host against Floci (go run)
	cd backend && \
		FLOCI_ENDPOINT=$(FLOCI_URL) AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
		PORT=$(DEV_API_PORT) CORS_ORIGINS=$(WEB_URL) go run ./cmd/api

dev-frontend: ## Run the Next.js dev server on the host
	cd frontend && API_INTERNAL_URL=http://localhost:$(DEV_API_PORT) PORT=$(WEB_PORT) $(PNPM) dev

# Publishes the multi-arch image from this machine (CI does the same in .github/workflows/release.yml).
# Each platform is built with the default builder (no emulation, see the Dockerfile, and no extra
# buildkit volume), pushed as <version>-<arch>, then joined into one multi-arch <version> and latest.
# Requires `docker login` as $(IMAGE_NAMESPACE).
release: ## Build and push the multi-arch image to Docker Hub (VERSION=1.2.3, default: tag on HEAD)
	@case "$(VERSION)" in [0-9]*.[0-9]*.[0-9]*) ;; *) echo "VERSION must be semver like 1.2.3 (got '$(VERSION)'); tag HEAD with v<version> or pass VERSION=" >&2; exit 1;; esac
	@test -z "$$(git status --porcelain)" || { echo "Working tree is dirty; commit before releasing" >&2; exit 1; }
	@set -e; image=$(IMAGE); refs=""; \
	for arch in $(RELEASE_PLATFORMS); do \
		echo "==> $$image:$(VERSION)-$$arch"; \
		docker buildx build --builder default --platform linux/$$arch --build-arg VERSION=$(VERSION) \
			--label org.opencontainers.image.revision=$$(git rev-parse HEAD) \
			--tag $$image:$(VERSION)-$$arch --push .; \
		refs="$$refs $$image:$(VERSION)-$$arch"; \
	done; \
	echo "==> $$image:$(VERSION) and latest"; \
	docker buildx imagetools create --tag $$image:$(VERSION) --tag $$image:latest $$refs
